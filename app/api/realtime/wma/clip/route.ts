import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { uploadToR2, userKey } from '@/lib/r2'
import { canonicalMediaUrl, keyFromUrl, signMediaUrl } from '@/lib/media-url'
import { isWmaModelId, WMA_MODELS } from '@/lib/realtime-wma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/realtime/wma/clip - keeps a recording of a live-video session
 * (a world walk, or a stretch of H3 Max Director's film) as a video in the
 * feed. Free: the session's time is what was paid for (./meter).
 *
 * FormData:
 *   video     the recording itself - OR -
 *   videoUrl  where it was already uploaded (/api/upload-video-media/presign:
 *             big recordings go straight to storage, past Vercel's ~4.5 MB
 *             body cap; the phone over Tailscale can't PUT there, so it sends
 *             the file here instead)
 *   poster    a JPEG data URL of one frame (the feed's thumbnail)
 *   model, prompt, durationSec, aspectRatio, resolution
 *
 * Saved as model `${model}` (e.g. 'lingbot-world-2'). ADMIN ONLY while under test.
 */
const VIDEO_TYPES: Record<string, string> = { 'video/webm': 'webm', 'video/mp4': 'mp4' }

export async function POST(req: NextRequest) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Live video models are not available' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return jsonPrivate({ error: 'Send the recording as form data' }, { status: 400 })
  const model = String(form.get('model') ?? '')
  if (!isWmaModelId(model)) return jsonPrivate({ error: 'Unknown live model' }, { status: 400 })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let videoUrl = ''
  const file = form.get('video')
  if (file instanceof Blob && file.size > 0) {
    const type = (file.type || 'video/webm').split(';')[0]
    const ext = VIDEO_TYPES[type]
    if (!ext) return jsonPrivate({ error: 'Recordings are WebM or MP4' }, { status: 400 })
    if (file.size > 500 * 1024 * 1024) return jsonPrivate({ error: 'That recording is too large' }, { status: 413 })
    videoUrl = await uploadToR2(userKey(user.id, `realtime/${model}-${stamp}.${ext}`), Buffer.from(await file.arrayBuffer()), type)
  } else {
    // An upload made through the presign route: only this account's own
    const given = canonicalMediaUrl(String(form.get('videoUrl') ?? ''))
    if (!given || !keyFromUrl(given).startsWith(`admin-upload-${user.id}-`)) return jsonPrivate({ error: 'Send the recording' }, { status: 400 })
    videoUrl = given
  }

  let thumbnailUrl: string | null = null
  const poster = String(form.get('poster') ?? '')
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(poster)
  if (m && poster.length < 4_000_000) {
    thumbnailUrl = await uploadToR2(userKey(user.id, `realtime/${model}-${stamp}-poster.jpg`), Buffer.from(m[1], 'base64'), 'image/jpeg').catch(() => null)
  }

  const prompt = String(form.get('prompt') ?? '').trim().slice(0, 4000)
  const durationSec = Math.max(0, Math.round(Number(form.get('durationSec')) || 0))
  const aspectRatio = /^\d+:\d+$/.test(String(form.get('aspectRatio') ?? '')) ? String(form.get('aspectRatio')) : '16:9'
  const resolution = String(form.get('resolution') ?? '').slice(0, 16) || null
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id,
      prompt: `${prompt || 'Live session'} - ${WMA_MODELS[model].name}`,
      imageUrl: videoUrl, model, ticketCost: 0, referenceImageUrls: [],
      quality: resolution, aspectRatio,
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      videoMetadata: { isVideo: true, duration: String(durationSec), thumbnailUrl: thumbnailUrl ?? undefined, live: true },
    },
  })
  return jsonPrivate({ ok: true, id: row.id, url: signMediaUrl(videoUrl), thumbnailUrl: thumbnailUrl ? signMediaUrl(thumbnailUrl) : null, prompt: row.prompt, aspectRatio, durationSec })
}
