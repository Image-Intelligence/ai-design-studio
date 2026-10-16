import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { uploadToR2, userKey } from '@/lib/r2'
import { ensureThumbnail } from '@/lib/thumbnail'
import { signMediaUrl, canonicalMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

/**
 * POST /api/realtime/krea/save - keeps a frame of a Krea 3 Realtime session.
 *
 * ONE FEED TILE PER SESSION (2026-10-16, owner): every frame a session keeps
 * goes into the same GeneratedImage row - videoMetadata.liveFrames, newest
 * last - and the feed tile / viewer flip through them (like a Storyboard
 * shot's stills). The row's imageUrl is its cover: the newest frame, until
 * one is chosen (PATCH).
 *
 * Body: { image: the frame's JPEG data URL (fal sends frames that way, 768px),
 *         prompt, seed, session: the panel's session key }
 * The panel saves on its own (components/realtime/KreaLiveSession): each
 * frame you settle on (a pause after a change) and the last one when the
 * session ends - plus "Save this frame". Free: the session's time is what
 * was paid for (./meter). ADMIN ONLY while under test.
 *
 * PATCH { id, index } - makes frame `index` the tile's cover.
 */
const MAX_FRAMES = 300
type Frame = { url: string; prompt: string; seed: number | null; at: number }

async function who() {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return { error: jsonPrivate({ error: 'Not signed in' }, { status: 401 }) }
  if (!(await checkIsAdmin(user.email))) return { error: jsonPrivate({ error: 'Krea 3 Realtime is not available' }, { status: 403 }) }
  return { user }
}

const out = (row: { id: number; imageUrl: string; prompt: string; aspectRatio: string | null; videoMetadata: unknown }) => {
  const frames = (((row.videoMetadata as any)?.liveFrames ?? []) as Frame[])
  return {
    ok: true, id: row.id, url: signMediaUrl(row.imageUrl), prompt: row.prompt, aspectRatio: row.aspectRatio,
    frames: frames.map(f => ({ ...f, url: signMediaUrl(f.url) })), count: frames.length,
  }
}

export async function POST(req: NextRequest) {
  const w = await who()
  if ('error' in w) return w.error
  const user = w.user!

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const image = typeof body.image === 'string' ? body.image : ''
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image)
  if (!m || image.length > 6_000_000) return jsonPrivate({ error: 'Send the frame as an image data URL' }, { status: 400 })
  const buf = Buffer.from(m[2], 'base64')
  const meta = await sharp(buf).metadata().catch(() => null)
  if (!meta?.width || !meta?.height) return jsonPrivate({ error: 'That frame is not an image' }, { status: 400 })

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  const seed = Number.isFinite(Number(body.seed)) ? Math.trunc(Number(body.seed)) : null
  const session = typeof body.session === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.session) ? body.session : null
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const url = await uploadToR2(userKey(user.id, `realtime/krea3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`), buf, `image/${m[1]}`)
  const frame: Frame = { url, prompt, seed, at: Date.now() }
  const caption = `${prompt || 'Live edit'}${seed !== null ? ` (seed ${seed})` : ''} - Krea 3 Realtime`

  // The session's tile, when it has one already: the frame joins it and becomes its cover
  const existing = session ? await prisma.generatedImage.findFirst({
    where: { userId: user.id, model: 'krea-3-realtime', isDeleted: false, videoMetadata: { path: ['liveSession'], equals: session } },
    select: { id: true, videoMetadata: true },
  }) : null
  if (existing) {
    const vm = (existing.videoMetadata ?? {}) as Record<string, any>
    const frames = [...((vm.liveFrames ?? []) as Frame[]), frame].slice(-MAX_FRAMES)
    const row = await prisma.generatedImage.update({
      where: { id: existing.id },
      data: { imageUrl: url, prompt: caption, thumbnailUrl: null, videoMetadata: { ...vm, liveFrames: frames, coverIndex: frames.length - 1 } },
      select: { id: true, imageUrl: true, prompt: true, aspectRatio: true, videoMetadata: true },
    })
    await ensureThumbnail(row.id).catch(() => {})
    return jsonPrivate(out(row))
  }

  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(meta.width, meta.height)
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id, prompt: caption, imageUrl: url, model: 'krea-3-realtime', ticketCost: 0,
      aspectRatio: `${meta.width / d}:${meta.height / d}`,
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      ...(session ? { videoMetadata: { liveSession: session, liveFrames: [frame], coverIndex: 0 } } : {}),
    },
    select: { id: true, imageUrl: true, prompt: true, aspectRatio: true, videoMetadata: true },
  })
  await ensureThumbnail(row.id).catch(() => {})
  return jsonPrivate(out(row))
}

export async function PATCH(req: NextRequest) {
  const w = await who()
  if ('error' in w) return w.error
  const user = w.user!
  const body = await req.json().catch(() => ({})) as { id?: unknown; index?: unknown }
  const id = Math.trunc(Number(body.id)), index = Math.trunc(Number(body.index))
  const row = Number.isFinite(id) ? await prisma.generatedImage.findFirst({ where: { id, userId: user.id, model: 'krea-3-realtime' }, select: { id: true, videoMetadata: true } }) : null
  const vm = (row?.videoMetadata ?? {}) as Record<string, any>
  const frames = (vm.liveFrames ?? []) as Frame[]
  if (!row || !frames[index]) return jsonPrivate({ error: 'No such frame' }, { status: 404 })
  const f = frames[index]
  const saved = await prisma.generatedImage.update({
    where: { id: row.id },
    data: { imageUrl: canonicalMediaUrl(f.url), prompt: `${f.prompt || 'Live edit'}${f.seed !== null ? ` (seed ${f.seed})` : ''} - Krea 3 Realtime`, thumbnailUrl: null, videoMetadata: { ...vm, coverIndex: index } },
    select: { id: true, imageUrl: true, prompt: true, aspectRatio: true, videoMetadata: true },
  })
  await ensureThumbnail(saved.id).catch(() => {})
  return jsonPrivate(out(saved))
}
