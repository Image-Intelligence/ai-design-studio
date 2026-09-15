import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { presignGetUrl, deleteFromR2 } from '@/lib/r2'
import { keyFromUrl } from '@/lib/media-url'
import { inspectSafetensors } from '@/lib/safetensors'

export const runtime = 'nodejs'

/** The header is at the front, so a megabyte is far more than enough. */
const HEAD_BYTES = 1024 * 1024

/**
 * Check an uploaded LoRA by reading the bytes that actually landed.
 *
 * The browser checks the file before uploading it, but that check can only
 * see what the browser can read — and on iOS it sometimes cannot read a local
 * file at all, which came out looking like "your file is corrupt" for files
 * that were fine. Guessing from the browser's side was the mistake; this asks
 * R2 what it is holding.
 *
 * Range-reads the first megabyte and takes the object's real length from the
 * Content-Range, so a 70 MB file costs a megabyte to verify. A file that fails
 * is deleted: it is unusable, it is already paid for in storage, and leaving
 * it there would let a later request record it as a working LoRA.
 */
export async function POST(req: NextRequest) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

  let url: string
  try {
    const body = await req.json() as { url?: string }
    url = (body.url ?? '').trim()
  } catch {
    return jsonPrivate({ error: 'Invalid body' }, { status: 400 })
  }

  const key = keyFromUrl(url)
  // Only the caller's own uploads. Without this the endpoint would read any
  // object on the bucket a megabyte at a time.
  if (!new RegExp(`^user-loras/${user.id}/`).test(key)) {
    return jsonPrivate({ error: 'Not your upload' }, { status: 403 })
  }

  let head: Buffer, total: number
  try {
    const res = await fetch(await presignGetUrl(key, 300), {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    })
    if (!res.ok && res.status !== 206) {
      return jsonPrivate({ error: 'The upload did not arrive. Try again.' }, { status: 502 })
    }
    head = Buffer.from(await res.arrayBuffer())
    // "bytes 0-1048575/73400320" — the part after the slash is the real size.
    const range = res.headers.get('content-range')
    total = Number(range?.split('/')[1]) || head.length
  } catch {
    return jsonPrivate({ error: 'Could not read the upload back' }, { status: 502 })
  }

  const verdict = inspectSafetensors(head, total)
  if (verdict.complete) return jsonPrivate({ ok: true, bytes: total })

  const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`
  // An incomplete file has a measurable shortfall; say it, because it is the
  // difference between "download it again" and "this was never a model".
  const detail = verdict.kind === 'empty'
    ? 'Nothing arrived. If the file lives in iCloud, open it in Files first so it downloads to this device, then try again.'
    : verdict.expected
      ? `${verdict.reason} It is ${mb(verdict.size)} and should be ${mb(verdict.expected)}.`
      : verdict.reason ?? 'That file is not a usable .safetensors.'

  await deleteFromR2(key).catch(() => {})
  return jsonPrivate({ ok: false, error: detail, kind: verdict.kind }, { status: 400 })
}
