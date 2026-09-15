import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { uploadToR2 } from '@/lib/r2'
import { inspectSafetensors } from '@/lib/safetensors'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Weights are large, but not unboundedly so. */
const MAX_BYTES = 600 * 1024 * 1024

/**
 * Copy a LoRA from a link into the caller's own library.
 *
 * The upload path assumes you can hand the browser a file, and on iOS that is
 * often untrue: Safari leaves a finished download named `<name>.safetensors
 * .download`, and the Files picker will not let you select it. Renaming works,
 * but it should not be the only way in.
 *
 * So the server fetches it instead — no picker, no iOS file semantics — checks
 * the bytes really are a whole safetensors before storing anything, and writes
 * it under user-loras/<id>/ so lib/lora-access.ts can tell whose it is. The
 * result is indistinguishable from an upload, including that nobody else can
 * use it.
 */
export async function POST(req: NextRequest) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

  let url: string, name: string
  try {
    const body = await req.json() as { url?: string; name?: string }
    url = (body.url ?? '').trim()
    name = (body.name ?? '').trim()
  } catch {
    return jsonPrivate({ error: 'Invalid body' }, { status: 400 })
  }

  if (!/^https:\/\//i.test(url)) {
    return jsonPrivate({ error: 'Give an https link to the .safetensors file' }, { status: 400 })
  }

  const count = await prisma.userLora.count({ where: { userId: user.id } })
  if (count >= 20) return jsonPrivate({ error: 'Max 20 LoRAs per account' }, { status: 400 })

  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(240_000) })
  } catch {
    return jsonPrivate({ error: 'Could not reach that link' }, { status: 502 })
  }
  if (!res.ok) {
    return jsonPrivate({ error: `That link returned ${res.status}` }, { status: 502 })
  }

  // Refuse something obviously too big before reading it into memory.
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) {
    return jsonPrivate({ error: 'That file is larger than 600 MB' }, { status: 400 })
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    return jsonPrivate({ error: 'That file is larger than 600 MB' }, { status: 400 })
  }

  /*
   * Verify before storing.
   *
   * A link that quietly returns an HTML login page, or a transfer that stopped
   * early, both produce a plausible-looking file. Checking here means the
   * failure is reported now, in words, rather than at generation time as an
   * error about the model.
   */
  const verdict = inspectSafetensors(buf)
  if (!verdict.complete) {
    const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`
    return jsonPrivate({
      error: verdict.expected
        ? `${verdict.reason} — got ${mb(verdict.size)}, expected ${mb(verdict.expected)}`
        : verdict.reason ?? 'That file is not a usable .safetensors',
    }, { status: 400 })
  }

  const fromUrl = (() => {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch { return '' }
  })()
  const filename = (fromUrl || 'lora.safetensors').replace(/\.download$/i, '')
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  // Same prefix the upload writes, so lib/lora-access.ts decides this by
  // the key alone rather than by the row we are about to create.
  const key = `user-loras/${user.id}/${Date.now()}-${safe}`
  const loraUrl = await uploadToR2(key, buf, 'application/octet-stream')

  const lora = await prisma.userLora.create({
    data: {
      userId: user.id,
      name: name || filename.replace(/\.[^.]+$/, ''),
      loraUrl,
      modelIds: 'flux-2,flux-1-dev,z-image-base,z-image-turbo',
    },
    select: { id: true, name: true, loraUrl: true, modelIds: true, createdAt: true },
  })

  return jsonPrivate({ lora, bytes: buf.length })
}
