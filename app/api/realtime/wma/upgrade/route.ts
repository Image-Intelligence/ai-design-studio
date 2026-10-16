import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { uploadToR2, userKey, deleteFromR2 } from '@/lib/r2'
import { canonicalMediaUrl, isOurMedia, signMediaUrl } from '@/lib/media-url'
import { probeRemoteMediaSeconds } from '@/lib/video-probe'
import { WMA_MODELS, WMA_MODEL_IDS } from '@/lib/realtime-wma'
import { WMA_SESS_COOKIE, decodePass, findSession, type WmaSessList } from '@/lib/realtime-wma-pass'

export const runtime = 'nodejs'
// Waits for fal to publish the recording, then cuts and stores it
export const maxDuration = 300

/**
 * POST /api/realtime/wma/upgrade - swaps a live session's saved clips for
 * fal's own FULL-QUALITY recording of the session (2026-10-16).
 *
 * What the page records is the WebRTC stream: compressed for live delivery
 * (VP8 at ~1.5 Mbit/s measured), so a saved clip looks soft. fal records every
 * session at full quality and publishes it when the session ends (the queue
 * result: { video: [{ url, segment_index }] }, ~40 MB per 40 s). This route
 * finds that recording, cuts the stretch each clip covered out of it (by
 * seconds since the first frame, which is where fal's recording starts), and
 * points the feed row at the sharp version.
 *
 * Body: { sessionId, clips?: [{ id, from, to }], whole?: boolean }
 *   clips   feed rows saved during the session, with the stretch they cover
 *   whole   also save the whole session, full quality, as new feed rows (one per
 *           recording segment)
 * Returns: { upgraded: [{ id, url, thumbnailUrl }], added: [...], note? }
 *
 * The session must be one of this account's recent ones (the signed wma_sess
 * list). fal files sessions under an internal id (lib/realtime-wma `history`,
 * e.g. fal-ai/minimax-h3-max-reference-director/start-session - the public
 * endpoint id answers "not found" there), matched by the session id in the
 * request's input.
 *
 * EVERY live model saves its WHOLE session this way, automatically, when it
 * ends (the user pays for every second - owner's call, 2026-10-16: the
 * director first, then the worlds): body { sessionId, whole: true, prompt,
 * aspectRatio, resolution, setup? }. `setup` (a world's starting picture,
 * description, actions...) is kept on the saved video so the world it came
 * from is on record.
 *
 * Resumable: each recording segment becomes its own feed row, tagged with its
 * session and segment. A save that runs out of time (a long session is ~1 MB
 * per second of video to copy) answers { partial: true } and the page asks
 * again; segments already saved are skipped, never duplicated.
 *
 * ADMIN ONLY while under test. The cuts run through /api/video/assemble (in-process).
 */
const fal = (path: string) => fetch(`https://api.fal.ai/v1/models/requests/${path}`, {
  headers: { Authorization: `Key ${process.env.FAL_KEY}` }, signal: AbortSignal.timeout(20_000),
})

type Segment = { url: string; index: number; seconds: number }

async function findRecording(history: string, sid: string): Promise<{ segments: { url: string; index: number }[] } | 'unlisted' | null> {
  const r = await fal(`by-endpoint?endpoint_id=${history}&limit=20&expand=payloads`).catch(() => null)
  if (!r) return null
  const j = await r.json().catch(() => null) as any
  if (j?.error?.type === 'not_found') return 'unlisted'
  const hit = (j?.items ?? []).find((x: any) => x?.json_input?.session_id === sid || x?.json_output?.session_id === sid)
  const out = hit?.json_output
  if (!out || out.recording_status !== 'complete' || !Array.isArray(out.video)) return null
  // Worlds number segments segment_index (1..); the director metadata.index (0..)
  const order = (v: any) => Number(v?.segment_index ?? (v?.metadata?.index != null ? Number(v.metadata.index) + 1 : 1)) || 1
  return { segments: out.video.filter((v: any) => typeof v?.url === 'string').map((v: any) => ({ url: v.url, index: order(v) })).sort((a: any, b: any) => a.index - b.index) }
}

/** /api/video/assemble's handler, called in-process with the admin password (the Final Cut does the same). */
async function assemble(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { POST } = await import('@/app/api/video/assemble/route')
  const res = await POST(new NextRequest('http://internal/api/video/assemble', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD ?? '' },
    body: JSON.stringify(body),
  }))
  const data = await res.json() as Record<string, any>
  if (!res.ok) throw new Error(String(data?.error || `Assembly failed (${res.status})`).slice(0, 300))
  return data
}

/** The pieces of the recording a stretch [from, to] (seconds) covers, as stitch clips. */
function piecesFor(segments: Segment[], from: number, to: number) {
  const out: { url: string; trimStart: number; trimEnd: number }[] = []
  let t0 = 0
  for (const s of segments) {
    const t1 = t0 + s.seconds
    const a = Math.max(from, t0), b = Math.min(to, t1)
    if (b - a > 0.2) out.push({ url: s.url, trimStart: Math.round((a - t0) * 100) / 100, trimEnd: Math.round((b - t0) * 100) / 100 })
    t0 = t1
  }
  return out
}

async function poster(videoUrl: string): Promise<string | null> {
  const f = await assemble({ op: 'frames', videoUrl, at: ['mid'] }).catch(() => null)
  return typeof f?.frames?.mid === 'string' ? canonicalMediaUrl(f.frames.mid) : null
}

export async function POST(req: NextRequest) {
  const jar = await cookies()
  const token = jar.get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Live video models are not available' }, { status: 403 })

  const startedAt = Date.now()
  const body = await req.json().catch(() => ({})) as { sessionId?: unknown; clips?: unknown; whole?: unknown; prompt?: unknown; aspectRatio?: unknown; resolution?: unknown; setup?: unknown }
  const sess = findSession(decodePass<WmaSessList>(jar.get(WMA_SESS_COOKIE)?.value), user.id, body.sessionId)
  if (!sess || !WMA_MODEL_IDS.includes(sess.m)) return jsonPrivate({ error: 'That session is not one of yours (or is too old)' }, { status: 404 })
  const model = WMA_MODELS[sess.m]
  const clips = (Array.isArray(body.clips) ? body.clips : [])
    .map((c: any) => ({ id: Math.trunc(Number(c?.id)), from: Math.max(0, Number(c?.from) || 0), to: Number(c?.to) || 0 }))
    .filter(c => c.id > 0 && c.to > c.from)
    .slice(0, 20)
  const whole = body.whole === true
  if (!clips.length && !whole) return jsonPrivate({ error: 'Nothing to upgrade' }, { status: 400 })

  // Already saved (a retry, or the page asked twice - the popup's close and its
  // unmount can both fire): hand back the rows instead of duplicating them
  // What of this session is saved already (rows tagged with it)
  const done = whole ? await prisma.generatedImage.findMany({ where: { userId: user.id, model: sess.m, isDeleted: false, videoMetadata: { path: ['sessionId'], equals: sess.sid } }, select: { id: true, imageUrl: true, videoMetadata: true } }) : []
  const rowOut = (d: { id: number; imageUrl: string; videoMetadata: unknown }) => ({ id: d.id, url: signMediaUrl(d.imageUrl), thumbnailUrl: (d.videoMetadata as any)?.thumbnailUrl ? signMediaUrl((d.videoMetadata as any).thumbnailUrl) : null, durationSec: Number((d.videoMetadata as any)?.duration) || 0 })
  // All of it (every segment it had): nothing to do - a retry, or the page asked twice
  if (whole && !clips.length && done.length && done.length >= (Number((done[0].videoMetadata as any)?.segments) || 1)) {
    return jsonPrivate({ upgraded: [], added: done.map(rowOut) })
  }

  // fal publishes the recording a little after the session ends - wait for it (up to ~2 min)
  let rec: Awaited<ReturnType<typeof findRecording>> = null
  for (let i = 0; i < 24; i++) {
    rec = await findRecording(model.history, sess.sid)
    if (rec) break
    await new Promise(r => setTimeout(r, 5_000))
  }
  if (rec === 'unlisted') return jsonPrivate({ error: `fal does not list ${model.name}'s recordings - nothing could be saved in full quality` }, { status: 404 })
  if (!rec || !rec.segments.length) return jsonPrivate({ error: 'fal has not published the recording yet - try again in a minute' }, { status: 409 })

  const segments: Segment[] = []
  for (const s of rec.segments) segments.push({ ...s, seconds: (await probeRemoteMediaSeconds(s.url, 30_000)) ?? 0 })
  const fps = model.id === 'lingbot-world-2' ? 48 : model.id === 'abot-world-0' ? 16 : 24

  const upgraded: { id: number; url: string; thumbnailUrl: string | null }[] = []
  const failed: number[] = []
  for (const c of clips) {
    const row = await prisma.generatedImage.findFirst({ where: { id: c.id, userId: user.id, model: sess.m, isDeleted: false } })
    const pieces = row ? piecesFor(segments, c.from, c.to) : []
    if (!row || !pieces.length) { failed.push(c.id); continue }
    try {
      const cut = await assemble({ op: 'stitch', clips: pieces, fps })
      const url = canonicalMediaUrl(String(cut.url))
      const thumb = await poster(url)
      const meta = (row.videoMetadata ?? {}) as Record<string, any>
      await prisma.generatedImage.update({
        where: { id: row.id },
        data: { imageUrl: url, quality: 'full', videoMetadata: { ...meta, isVideo: true, duration: String(Math.round(c.to - c.from)), thumbnailUrl: thumb ?? meta.thumbnailUrl, fullQuality: true, liveCopy: row.imageUrl } },
      })
      upgraded.push({ id: row.id, url: signMediaUrl(url), thumbnailUrl: thumb ? signMediaUrl(thumb) : null })
    } catch (e) {
      console.error('[wma-upgrade] clip', c.id, e)
      failed.push(c.id)
    }
  }

  // The whole session, segment by segment, copied as fal recorded it (no re-encode)
  const added: { id: number; url: string; thumbnailUrl: string | null; durationSec: number }[] = []
  const filmPrompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 3000) : ''
  const shape = typeof body.aspectRatio === 'string' && /^\d+:\d+$/.test(body.aspectRatio) ? body.aspectRatio : null
  const size = typeof body.resolution === 'string' ? body.resolution.slice(0, 12) : null
  let partial = false
  if (whole) {
    // The world's setup (starting picture, description, actions...) - kept on the video, small
    let setup: unknown = null
    try { const j = JSON.stringify(body.setup ?? null); if (j && j.length <= 12_000) setup = JSON.parse(j) } catch {}
    // Stored links, not signed ones (a signed link expires)
    if (setup && typeof (setup as any).picture === 'string') (setup as any).picture = canonicalMediaUrl((setup as any).picture)
    const savedIdx = new Set(done.map(d => Number((d.videoMetadata as any)?.segmentIndex)).filter(Number.isFinite))
    // One poster for the session (each one means downloading a segment again) - reused by every part
    let thumb: string | null = done.map(d => (d.videoMetadata as any)?.thumbnailUrl).find((u: unknown): u is string => typeof u === 'string') ?? null
    for (const d of done) added.push(rowOut(d))
    for (const s of segments) {
      if (savedIdx.has(s.index)) continue
      // Out of time (Vercel stops at 300s): the page asks again and this carries on
      if (Date.now() - startedAt > 220_000) { partial = true; break }
      try {
        const r = await fetch(s.url, { signal: AbortSignal.timeout(120_000) })
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        const url = await uploadToR2(userKey(user.id, `realtime/${sess.m}-full-${Date.now()}-${s.index}.mp4`), Buffer.from(await r.arrayBuffer()), 'video/mp4')
        if (!thumb) thumb = await poster(url)
        const part = segments.length > 1 ? ` (part ${s.index} of ${segments.length})` : ''
        const row = await prisma.generatedImage.create({ data: {
          userId: user.id, prompt: `${filmPrompt || 'Live session'}${part} - ${model.name}`,
          imageUrl: url, model: sess.m, ticketCost: 0, referenceImageUrls: [], quality: size ?? 'full',
          aspectRatio: shape ?? (sess.m === 'abot-world-0' ? '20:11' : sess.m === 'lingbot-world-2' ? '26:15' : '16:9'),
          expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
          videoMetadata: {
            isVideo: true, duration: String(Math.round(s.seconds)), thumbnailUrl: thumb ?? undefined, live: true, fullQuality: true,
            sessionId: sess.sid, segmentIndex: s.index, segments: segments.length, ...(setup ? { worldSetup: setup } : {}),
          } as object,
        } })
        added.push({ id: row.id, url: signMediaUrl(url), thumbnailUrl: thumb ? signMediaUrl(thumb) : null, durationSec: Math.round(s.seconds) })
      } catch (e) {
        console.error('[wma-upgrade] segment', s.index, e)
      }
    }
  }

  // The soft live copies are not needed once replaced
  for (const u of upgraded) {
    const row = await prisma.generatedImage.findUnique({ where: { id: u.id }, select: { videoMetadata: true } })
    const old = (row?.videoMetadata as any)?.liveCopy
    if (typeof old === 'string' && isOurMedia(old)) await deleteFromR2(old).catch(() => {})
  }
  return jsonPrivate({ upgraded, added, ...(partial ? { partial: true } : {}), ...(failed.length ? { note: `${failed.length} clip(s) kept their live copy` } : {}) })
}
