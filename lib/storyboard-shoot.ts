import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { withShotsLock } from '@/lib/storyboard-store'
import { canonicalMediaUrl } from '@/lib/media-url'
import { getCreateModel } from '@/lib/chat-hub-models'
import { submitChatVideo } from '@/lib/chat-video-submit'
import { promoteNextQueuedJob } from '@/lib/fal-queue'
import { SAVING_STATUS } from '@/lib/video-save-guard'
import { STORYBOARD_VIDEO_IDS, SHOOT_RESOLUTIONS, pickDuration, sanitizeShots, isAssetShot, shootAspect, addVideoTake, stillKey, type ShotVideo, type StoryboardShot } from '@/lib/storyboard'

/**
 * Storyboard Studio - shooting (server only).
 *
 * Shared by the per-shot Shoot buttons (/api/employees/storyboards/[id]/shoot)
 * and the Final Cut, which shoots whatever is still missing first.
 *
 * Shots go through the site's OWN video path (lib/chat-video-submit calls
 * /api/video/generate as a function, as the signed-in admin), so every model's
 * input shape, the queue slots and the admin gate are the ones the rest of the
 * site uses. They settle through /api/video/status's handler - re-hosted to R2,
 * saved as a GeneratedImage - exactly as the Movie Studio's film-status does;
 * the clip is then filed into My Generations > Storyboards > <title>.
 *
 * A shot's `video` is written ONLY here (the board's PATCH keeps the stored
 * copy), so the page's debounced autosave cannot clobber a finished render.
 */

type User = { id: number }
type Board = { id: number; title: string; aspect: string; shots: unknown }

/** A render running far longer than any model takes is not coming back. */
const STALLED_AFTER_MS = 20 * 60 * 1000

export async function boardFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Storyboards', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Storyboards', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled storyboard'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

/*
 * 2026-10-23 billing sweep - renders claimed and landed under the row lock.
 *
 * Starting a render used to check "already shooting" on the board as read
 * at the top of the request, with nothing claimed: two tabs (or a tab and
 * the Final Cut's shoot step) pressing Shoot together both passed and both
 * paid. Settling had the same shape: the page's 8s poll, the Final Cut and
 * other tabs all settled the same finished render, each conformed it to a
 * new random file and each added it as a take.
 *
 * Now a render is CLAIMED before anything is charged: under the row lock
 * (withShotsLock) the slot's `video` becomes a placeholder "rendering" one
 * whose queueId is a negative token - only if no render is live on it - and
 * the clip it replaces is kept as a take. The submit's result replaces the
 * placeholder (or, if nothing was started, the old clip comes back). A
 * placeholder whose request died (the function was killed) is given up by
 * settleShots after RENDER_CLAIM_STALE_MS. A finished render is applied only
 * while the slot still shows THAT render rendering, and a settler takes a
 * short claim on it (video.settlingAt) before conforming, so it is conformed
 * and kept once - and an old render finishing never replaces a newer one.
 */
const RENDER_CLAIM_STALE_MS = 6 * 60_000
const SETTLE_CLAIM_MS = 3 * 60_000
/** A placeholder's token: negative, so never a GenerationQueue id. */
const claimToken = () => -(1 + Math.floor(Math.random() * 2_000_000_000))
const isPlaceholder = (v: ShotVideo | null | undefined) => !!v && v.status === 'rendering' && v.queueId <= 0
/** The marker a claim's render carries on its queue row (parameters.clientSlotId), to find it if the request dies before landing it. */
const claimSlotId = (token: number) => `storyboard-claim${token}`

/**
 * Claim these shots for a render: under the row lock, a slot with no live
 * render that passes `check` (null = fine, else the reason it cannot) gets a
 * placeholder from `make`. Returns the claimed shots as they stood (fresh).
 */
async function claimRenders(
  boardId: number, ids: string[],
  check: (s: StoryboardShot) => string | null,
  make: (s: StoryboardShot, token: number) => ShotVideo,
): Promise<{ claimed: Map<string, { shot: StoryboardShot; token: number }>; errors: Record<string, string> }> {
  let claimed = new Map<string, { shot: StoryboardShot; token: number }>()
  let errors: Record<string, string> = {}
  await withShotsLock(boardId, current => {
    claimed = new Map(); errors = {}
    const now = Date.now()
    const shots = current.map(s => {
      if (!ids.includes(s.id)) return s
      // A live render (or claim) - a stale placeholder counts as none
      if (s.video?.status === 'rendering' && !(isPlaceholder(s.video) && now - s.video.at > RENDER_CLAIM_STALE_MS)) { errors[s.id] = 'Already shooting'; return s }
      const why = check(s)
      if (why) { errors[s.id] = why; return s }
      const token = claimToken()
      claimed.set(s.id, { shot: s, token })
      const takes = s.video && !isPlaceholder(s.video) ? addVideoTake(s.videos, s.video) : s.videos ?? []
      return { ...s, video: make(s, token), videos: takes.length ? takes : undefined }
    })
    return claimed.size ? { shots } : null
  })
  return { claimed, errors }
}

/**
 * A claim's outcome, under the row lock: the render started (`v`) replaces
 * the placeholder; nothing started (`v` null) puts the slot's earlier clip
 * back (`prev`). Only while the placeholder is still this claim's - or, for
 * a started render, while nothing else is rendering there (it is paid for:
 * never dropped for a claim that went stale meanwhile).
 */
async function landClaim(boardId: number, shotId: string, token: number, v: ShotVideo | null, prev: ShotVideo | null) {
  await withShotsLock(boardId, current => {
    let hit = false
    const shots = current.map(s => {
      if (s.id !== shotId) return s
      const mine = s.video?.queueId === token
      if (v && (mine || s.video?.status !== 'rendering')) {
        hit = true
        const takes = s.video && !mine ? addVideoTake(s.videos, s.video) : s.videos ?? []
        return { ...s, video: v, videos: takes.length ? takes : undefined }
      }
      if (!v && mine) { hit = true; return { ...s, video: prev } }
      return s
    })
    return hit ? { shots } : null
  })
}

/**
 * Finished renders onto the board (settleShots), keyed by shot: `from` is the
 * queueId of the render that finished. Applied only while the slot still
 * shows THAT render rendering - a second settler, or an old render finishing
 * after a reshoot, changes nothing. Every finished clip is kept as one of the
 * slot's takes, so an earlier clip is always a tap away.
 */
async function writeVideos(boardId: number, videos: Record<string, { from: number; v: ShotVideo }>) {
  if (!Object.keys(videos).length) return
  // Under the row lock (lib/storyboard-store): a still landing meanwhile is kept
  await withShotsLock(boardId, current => {
    let hit = false
    const shots = current.map(s => {
      const x = videos[s.id]
      if (!x || s.video?.status !== 'rendering' || s.video.queueId !== x.from) return s
      hit = true
      const takes = addVideoTake(s.videos, x.v)
      return { ...s, video: x.v, videos: takes.length ? takes : undefined }
    })
    return hit ? { shots } : null
  })
}

/**
 * Take a finished render for settling (one statement): only while the slot
 * still shows it rendering and no other settler took it in the last
 * SETTLE_CLAIM_MS. False = someone else is settling it (or it is settled).
 */
async function claimSettle(boardId: number, shotId: string, queueId: number): Promise<boolean> {
  const now = Date.now()
  const n = await prisma.$executeRaw`
    UPDATE "Storyboard" SET shots = (
      SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${shotId}
        THEN jsonb_set(t.s, '{video,settlingAt}', to_jsonb(${now}::bigint)) ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
    WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(shots) x
        WHERE x->>'id' = ${shotId} AND x->'video'->>'status' = 'rendering'
          AND x->'video'->>'queueId' = ${String(queueId)}
          AND COALESCE((x->'video'->>'settlingAt')::bigint, 0) < ${String(now - SETTLE_CLAIM_MS)}::bigint)`
  return n > 0
}

/** Every slot's takes, for the page (it shows them; the server owns them). */
export async function boardTakes(boardId: number): Promise<Record<string, ShotVideo[]>> {
  const fresh = await prisma.storyboard.findUnique({ where: { id: boardId }, select: { shots: true } })
  return Object.fromEntries(sanitizeShots(fresh?.shots).filter(s => s.videos?.length).map(s => [s.id, s.videos!]))
}

/**
 * Play an earlier take on a slot: `video` becomes that take. Only one of the
 * slot's own takes, and never over a render in progress (it would orphan it).
 */
export async function pickTake(boardId: number, shotId: string, url: string): Promise<{ video: ShotVideo } | { error: string }> {
  /*
   * Decided under the row lock (2026-10-23 billing sweep): checked on a plain
   * read, a pick landing just after a Shoot press replaced the new (paid)
   * render's "rendering" video, and nothing ever settled it.
   */
  let out: { video: ShotVideo } | { error: string } = { error: 'No such shot' }
  const k = stillKey(url)
  await withShotsLock(boardId, shots => {
    const shot = shots.find(s => s.id === shotId)
    if (!shot) { out = { error: 'No such shot' }; return null }
    if (shot.video?.status === 'rendering') { out = { error: 'This shot is still shooting' }; return null }
    const take = (shot.videos ?? []).find(t => t.url && stillKey(t.url) === k)
    if (!take) { out = { error: 'That clip is not one of this shot\'s takes' }; return null }
    out = { video: take }
    return { shots: shots.map(s => (s.id === shotId ? { ...s, video: take } : s)) }
  })
  return out
}

/** Animate each listed shot's still with its planned prompt and model. */
export async function submitShots(user: User, board: Board, ids: string[], resolution?: string): Promise<Record<string, ShotVideo | { error: string }>> {
  const wantRes = (SHOOT_RESOLUTIONS as readonly string[]).includes(String(resolution)) ? String(resolution) : '720p'
  const out: Record<string, ShotVideo | { error: string }> = {}
  const specOf = (s: StoryboardShot) => { const m = STORYBOARD_VIDEO_IDS[s.videoModel]; return m ? getCreateModel(m) : undefined }

  /*
   * Claimed first, under the row lock (2026-10-23 billing sweep - see
   * claimRenders): a slot already shooting - from another tab, or the Final
   * Cut - is refused here, before anything is charged. The checks run on the
   * board as it stands now, not as this request read it.
   */
  const { claimed, errors } = await claimRenders(board.id, ids, s => {
    if (isAssetShot(s)) return 'Scene 0 is for asset pictures - it is not shot'
    if (!s.stillUrl) return 'Make the still first'
    const spec = specOf(s)
    if (!spec) return `${s.videoModel} can't shoot from a still`
    const disabled = (spec as { disabled?: string }).disabled
    if (disabled) return disabled
    if (!(s.videoPrompt || s.description).trim()) return 'Write the video prompt first'
    return null
  }, (s, token) => ({
    queueId: token, status: 'rendering', url: null, error: null, model: specOf(s)?.id ?? s.videoModel, seconds: s.duration,
    fromStill: s.stillUrl, fromPrompt: (s.videoPrompt || s.description).trim(), at: Date.now(),
  }))
  for (const [id, error] of Object.entries(errors)) out[id] = { error }

  // One at a time: the route claims a fal slot per call, and queues the rest.
  // Each claim is landed as soon as its submit answers, so a request cut off
  // part-way never leaves a paid render unrecorded on its slot.
  for (const { shot, token } of claimed.values()) {
    const release = async (error: string) => { out[shot.id] = { error }; await landClaim(board.id, shot.id, token, null, isPlaceholder(shot.video) ? null : shot.video ?? null).catch(() => {}) }
    const spec = specOf(shot)!
    const durField = spec.fields?.find(f => f.key === 'duration')
    const resField = spec.fields?.find(f => f.key === 'resolution')
    // A frame the model takes (the nearest to the board's); settleShots
    // conforms the clip to the board's frame when they differ
    const aspect = shootAspect(spec.fields?.find(f => f.key === 'aspect')?.options, board.aspect)
    const duration = durField ? pickDuration(durField.options, shot.duration) : String(shot.duration)
    const res = resField ? (resField.options.includes(wantRes) ? wantRes : resField.def) : wantRes
    const prompt = (shot.videoPrompt || shot.description).trim()
    // The still is the first frame (image-to-video), whatever the model's default mode
    const sub = await submitChatVideo(spec, prompt, [], { duration, resolution: res, aspect, audio: 'on' }, { userId: user.id, imageUrl: shot.stillUrl!, sd20Mode: 'i2v', clientSlotId: claimSlotId(token) })
      .catch((e: any) => ({ ok: false as const, error: String(e?.message || e).slice(0, 300), queueId: undefined }))
    if (!sub.ok || !sub.queueId) { await release(sub.ok ? 'The render was not queued' : sub.error); continue }
    const v: ShotVideo = {
      queueId: sub.queueId, status: 'rendering', url: null, error: null, model: spec.id, seconds: Number(duration) || shot.duration,
      fromStill: shot.stillUrl, fromPrompt: prompt, at: Date.now(),
    }
    out[shot.id] = v
    await landClaim(board.id, shot.id, token, v, null)
  }
  return out
}

/**
 * A Shot edit (2026-10-19): one of the site's video-to-video tools run on a
 * shot's current clip (lib/storyboard-tools CLIP_TOOLS). It goes through
 * /api/video/generate like every render - the route measures the clip,
 * prices it, charges it, gates admin-only tools and checks the media is the
 * account's own - and lands on the slot as a rendering `video`, so the
 * shoot route's polling settles it into a new take (settleShots) exactly as
 * a shot. The clip it edits stays one of the slot's takes.
 *
 * The source is the clip as the model rendered it (`rawUrl`) when there is
 * one: that is the file saved in My Generations (the ownership check reads
 * those), and the result is conformed to the board's frame on settling anyway.
 */
export async function submitClipTool(
  user: User,
  board: Board,
  shotId: string,
  tool: { id: string; label: string; prompt?: string; refs?: string[]; settings?: Record<string, unknown>; seconds?: number; line?: { id: string; url: string } },
): Promise<{ video: ShotVideo; ticketCost: number } | { error: string; status?: number }> {
  if (!sanitizeShots(board.shots).some(s => s.id === shotId)) return { error: 'No such shot' }
  const prompt = (tool.prompt ?? '').trim().slice(0, 2000)
  /*
   * Claimed under the row lock before /api/video/generate charges it
   * (2026-10-23 billing sweep - see claimRenders): two tabs pressing the same
   * tool both passed a check made on their own reads, and both paid. The
   * placeholder carries the edit (`of` the clip), so a claim whose request
   * died is given back as that clip by settleShots.
   */
  const { claimed, errors } = await claimRenders(board.id, [shotId],
    s => (s.video?.status !== 'done' || !s.video.url ? 'Shoot this shot first - the tools work on its clip' : null),
    (s, token) => ({
      ...s.video!, queueId: token, status: 'rendering', url: null, rawUrl: null, rawSize: null, error: null, at: Date.now(), settlingAt: undefined,
      edit: { tool: tool.id, label: tool.label, of: s.video!.url!, ...(s.video!.edit?.lineId ? { lineId: s.video!.edit.lineId } : {}) },
    }))
  const mine = claimed.get(shotId)
  if (!mine) {
    const why = errors[shotId]
    return { error: why === 'Already shooting' ? 'This shot is still rendering - wait for it first' : why || 'No such shot', status: why === 'Already shooting' ? 409 : 400 }
  }
  const shot = mine.shot
  const cur = shot.video!
  // Nothing started: the clip goes back on the slot
  const release = () => landClaim(board.id, shotId, mine.token, null, cur).catch(() => {})
  if (!cur.url) { await release(); return { error: 'Shoot this shot first - the tools work on its clip' } }
  const src = cur.rawUrl || cur.url
  const body: Record<string, unknown> = {
    model: tool.id, prompt, adminMode: false,
    // Finds this render if the request dies before landing it (settleShots)
    clientSlotId: claimSlotId(mine.token),
    duration: tool.seconds ? String(tool.seconds) : '5',
    resolution: '1080p', klingAspectRatio: board.aspect,
    ...(tool.settings ?? {}),
  }
  if (tool.line) {
    body.lipsyncVideoUrl = src
    body.lipsyncAudioUrl = tool.line.url
    body.lipsyncSyncMode = 'cut_off'
  } else {
    body.editVideoUrl = src
    if (tool.refs?.length) body.referenceImageUrls = tool.refs
  }
  let res: Response
  try {
    const { POST } = await import('@/app/api/video/generate/route')
    res = await POST(new NextRequest('http://internal/api/video/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
  } catch (e: any) {
    await release()
    return { error: String(e?.message || e || `The ${tool.label} failed to start`).slice(0, 400) }
  }
  const data = await res.json().catch(() => ({})) as Record<string, any>
  if (!res.ok || data?.success === false) {
    await release()
    return { error: String(data?.error || `The ${tool.label} failed to start (${res.status})`).slice(0, 400), status: res.status === 402 ? 402 : res.status === 403 ? 403 : 400 }
  }
  const queueId = Number(data?.queueJobId ?? data?.queueId ?? 0)
  if (!Number.isInteger(queueId) || queueId <= 0) { await release(); return { error: 'The render was not queued' } }
  const v: ShotVideo = {
    queueId, status: 'rendering', url: null, error: null, model: tool.id,
    // An extend adds its seconds; a reshoot from the clip (Kling O3 reference)
    // is as long as was asked; the rest keep the clip's length
    seconds: tool.id.endsWith('-reference') && Number(tool.settings?.duration) > 0
      ? Number(tool.settings?.duration)
      : Math.round(((cur.seconds || shot.duration) + (tool.id.includes('extend') ? Number(tool.seconds) || 0 : 0)) * 10) / 10,
    // Still the same shot: an edit never makes it "out of date" with its still
    fromStill: cur.fromStill, fromPrompt: cur.fromPrompt, at: Date.now(),
    // A lip-synced line stays "in the clip" through later edits (an upscale of it still speaks it)
    edit: { tool: tool.id, label: tool.label, of: cur.url, ...(prompt ? { prompt } : {}), ...(tool.line ? { lineId: tool.line.id } : cur.edit?.lineId ? { lineId: cur.edit.lineId } : {}) },
  }
  await landClaim(board.id, shot.id, mine.token, v, null)
  return { video: v, ticketCost: Number(data?.ticketCost ?? 0) }
}

/** A clip in the board's frame (crop, or fit over a blurred fill) - /api/video/assemble's conform op. */
async function conform(url: string, aspect: string): Promise<{ url: string; srcSize: string | null }> {
  const { POST } = await import('@/app/api/video/assemble/route')
  const res = await POST(new NextRequest('http://internal/api/video/assemble', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD ?? '' },
    body: JSON.stringify({ op: 'conform', videoUrl: url, aspect }),
  }))
  const data = await res.json() as { url?: string; error?: string; srcWidth?: number; srcHeight?: number }
  if (!res.ok || !data.url) throw new Error(data.error || `Conform failed (${res.status})`)
  return { url: canonicalMediaUrl(data.url), srcSize: data.srcWidth && data.srcHeight ? `${data.srcWidth}x${data.srcHeight}` : null }
}

/** Settle the board's renders. Returns every shot's video state. */
export async function settleShots(user: User, board: Board): Promise<Record<string, ShotVideo>> {
  const shots = sanitizeShots(board.shots)
  // A placeholder (a render being started - claimRenders) is not settled while
  // its request may still be running; one whose request died is given up below
  const rendering = shots.filter((s): s is StoryboardShot & { video: ShotVideo } =>
    s.video?.status === 'rendering' && !(isPlaceholder(s.video) && Date.now() - s.video.at <= RENDER_CLAIM_STALE_MS))
  const videos: Record<string, ShotVideo> = Object.fromEntries(shots.filter(s => s.video).map(s => [s.id, s.video as ShotVideo]))
  if (!rendering.length) return videos

  const jobs = await prisma.generationQueue.findMany({
    where: { id: { in: rendering.map(s => s.video.queueId).filter(q => q > 0) }, userId: user.id },
    select: { id: true, status: true, errorMessage: true, falRequestId: true, modelId: true, prompt: true, ticketCost: true, createdAt: true, parameters: true },
  })
  const byId = new Map(jobs.map(j => [j.id, j]))
  const { POST: videoStatus } = await import('@/app/api/video/status/route')
  const changed: Record<string, { from: number; v: ShotVideo }> = {}
  let folderId: number | null = null
  const finish = async (shot: StoryboardShot & { video: ShotVideo }, url: string | null, error: string | null, falRequestId?: string | null) => {
    // Stored canonical: the status handler answers with a signed (expiring) link
    if (url) url = canonicalMediaUrl(url)
    // A finished clip is conformed and kept by ONE settler (2026-10-23 billing
    // sweep): the page's poll, the Final Cut and other tabs all get here - the
    // rest leave it (it shows as rendering until the winner writes it)
    if (url && !(await claimSettle(board.id, shot.id, shot.video.queueId).catch(() => false))) return
    // The model may have rendered another frame than the board's (no 3:4 on
    // Kling 3.0): conform it, keeping the original. A failed conform keeps the
    // clip as rendered - the Final Cut still pads it into the frame.
    // Both are kept: `url` is the board's frame (what the Final Cut uses),
    // `rawUrl` the clip as rendered - the card toggles between them, and the
    // original is also in My Generations (saved by the status handler)
    let rawUrl: string | null = null
    let rawSize: string | null = null
    if (url) {
      const fitted = await conform(url, board.aspect).catch(() => null)
      if (fitted && fitted.url !== url) { rawUrl = url; rawSize = fitted.srcSize; url = fitted.url }
    }
    let v: ShotVideo = { ...shot.video, status: url ? 'done' : 'failed', url, rawUrl, rawSize, error: url ? null : (error ?? 'The render failed'), settlingAt: undefined }
    // A Shot edit that failed puts the clip it was editing back on the slot
    // (with the reason), so the board stays ready for the Final Cut
    if (!url && shot.video.edit) {
      const ofKey = stillKey(shot.video.edit.of)
      const back = (shot.videos ?? []).find(t => t.url && stillKey(t.url) === ofKey)
      if (back) v = { ...back, error: `${shot.video.edit.label} failed: ${(error ?? 'the render failed').slice(0, 300)}` }
    }
    changed[shot.id] = { from: shot.video.queueId, v }
    videos[shot.id] = v
    // File the clip with the board's stills
    if (url && falRequestId) {
      folderId ??= await boardFolder(user.id, board.title)
      await prisma.generatedImage.updateMany({ where: { userId: user.id, falRequestId }, data: { folderId } }).catch(() => {})
    }
  }

  let waiting = false
  for (const shot of rendering) {
    /*
     * A render that was being started when its request died. The request may
     * have been killed AFTER /api/video/generate charged and queued it, before
     * the slot was given the queue id (2026-10-23 billing sweep): the render is
     * looked for first - its queue row carries this claim's token as its
     * clientSlotId (submitShots / submitClipTool send it) - and, found, it is
     * put on the slot and settled like any other. Only with no row was nothing
     * started.
     */
    if (isPlaceholder(shot.video)) {
      const row = await prisma.generationQueue.findFirst({
        where: { userId: user.id, createdAt: { gte: new Date(shot.video.at - 60_000) }, parameters: { path: ['clientSlotId'], equals: claimSlotId(shot.video.queueId) } },
        orderBy: { id: 'desc' }, select: { id: true },
      }).catch(() => null)
      if (row) {
        const v: ShotVideo = { ...shot.video, queueId: row.id, at: Date.now() }
        await landClaim(board.id, shot.id, shot.video.queueId, v, null).catch(() => {})
        videos[shot.id] = v
      } else await finish(shot, null, 'The render never started - shoot it again')
      continue
    }
    const job = byId.get(shot.video.queueId)
    if (!job) { await finish(shot, null, 'The render job is gone'); continue }
    const p = (job.parameters ?? {}) as Record<string, any>
    const age = Date.now() - job.createdAt.getTime()

    if (job.status === 'completed' || job.status === 'failed') {
      let url: string | null = Array.isArray(p.completedImageUrls) && typeof p.completedImageUrls[0] === 'string' ? p.completedImageUrls[0] : null
      if (!url && job.status === 'completed' && job.falRequestId) {
        url = (await prisma.generatedImage.findFirst({ where: { falRequestId: job.falRequestId, userId: user.id }, select: { imageUrl: true }, orderBy: { id: 'desc' } }))?.imageUrl ?? null
      }
      await finish(shot, job.status === 'completed' ? url : null, job.errorMessage ?? (job.status === 'completed' ? 'Finished with no output' : 'The render failed'), job.falRequestId)
      continue
    }
    /*
     * 'saving' (lib/video-save-guard): fal has finished it and a status call
     * is storing it - or will re-claim a stalled save. Waiting, never
     * "stalled" (2026-10-23 billing sweep): telling the user to shoot again
     * here invited a paid reshoot of a render that was about to land.
     */
    const saving = job.status === SAVING_STATUS
    if (job.status === 'queued' || !job.falRequestId || !p.falEndpoint) {
      // Waiting for a free fal slot - the cron fills them on Vercel; filling
      // them here too keeps a board moving locally and between cron ticks
      if (age > STALLED_AFTER_MS && !saving) await finish(shot, null, 'Waited too long for a free render slot - shoot it again')
      else waiting = true
      continue
    }
    try {
      const res = await videoStatus(new NextRequest('http://internal/api/video/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // A short-lived caller never claims a video's save it could be killed in the middle of (lib/video-save-guard); page polls and the cron save it
          mayClaimSave: false,
          requestId: job.falRequestId, falEndpoint: p.falEndpoint, prompt: job.prompt, model: job.modelId,
          duration: p.duration, resolution: p.resolution, ticketCost: job.ticketCost, queuedAt: job.createdAt.getTime(),
        }),
      }))
      const data = await res.json() as Record<string, any>
      if (data?.status === 'completed' && typeof data.videoUrl === 'string') await finish(shot, data.videoUrl, null, job.falRequestId)
      else if (data?.status === 'failed') await finish(shot, null, String(data.error || 'The render failed'))
      else if (age > STALLED_AFTER_MS && !saving) await finish(shot, null, 'Still rendering long past the expected time - shoot it again')
    } catch {
      // A transient fal/network error is not a failed shot - try again next poll
    }
  }
  if (waiting) await promoteNextQueuedJob().catch(() => {})
  await writeVideos(board.id, changed)
  return videos
}
