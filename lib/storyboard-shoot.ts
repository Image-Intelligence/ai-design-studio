import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { canonicalMediaUrl } from '@/lib/media-url'
import { getCreateModel } from '@/lib/chat-hub-models'
import { submitChatVideo } from '@/lib/chat-video-submit'
import { promoteNextQueuedJob } from '@/lib/fal-queue'
import { STORYBOARD_VIDEO_IDS, SHOOT_RESOLUTIONS, pickDuration, sanitizeShots, type ShotVideo, type StoryboardShot } from '@/lib/storyboard'

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

/** Write video states onto the board, re-reading it first so concurrent edits are kept. */
async function writeVideos(boardId: number, videos: Record<string, ShotVideo>) {
  if (!Object.keys(videos).length) return
  const fresh = await prisma.storyboard.findUnique({ where: { id: boardId }, select: { shots: true } })
  const shots = sanitizeShots(fresh?.shots).map(s => (videos[s.id] ? { ...s, video: videos[s.id] } : s))
  await prisma.storyboard.update({ where: { id: boardId }, data: { shots: shots as object[] } })
}

/** Animate each listed shot's still with its planned prompt and model. */
export async function submitShots(user: User, board: Board, ids: string[], resolution?: string): Promise<Record<string, ShotVideo | { error: string }>> {
  const wantRes = (SHOOT_RESOLUTIONS as readonly string[]).includes(String(resolution)) ? String(resolution) : '720p'
  const shots = sanitizeShots(board.shots)
  const out: Record<string, ShotVideo | { error: string }> = {}
  const written: Record<string, ShotVideo> = {}

  // One at a time: the route claims a fal slot per call, and queues the rest
  for (const shot of shots.filter(s => ids.includes(s.id))) {
    if (shot.video?.status === 'rendering') { out[shot.id] = { error: 'Already shooting' }; continue }
    if (!shot.stillUrl) { out[shot.id] = { error: 'Make the still first' }; continue }
    const modelId = STORYBOARD_VIDEO_IDS[shot.videoModel]
    const spec = modelId ? getCreateModel(modelId) : undefined
    if (!spec) { out[shot.id] = { error: `${shot.videoModel} can't shoot from a still` }; continue }
    const disabled = (spec as { disabled?: string }).disabled
    if (disabled) { out[shot.id] = { error: disabled }; continue }
    const durField = spec.fields?.find(f => f.key === 'duration')
    const resField = spec.fields?.find(f => f.key === 'resolution')
    const duration = durField ? pickDuration(durField.options, shot.duration) : String(shot.duration)
    const res = resField ? (resField.options.includes(wantRes) ? wantRes : resField.def) : wantRes
    const prompt = (shot.videoPrompt || shot.description).trim()
    if (!prompt) { out[shot.id] = { error: 'Write the video prompt first' }; continue }
    // The still is the first frame (image-to-video), whatever the model's default mode
    const sub = await submitChatVideo(spec, prompt, [], { duration, resolution: res, aspect: board.aspect, audio: 'on' }, { userId: user.id, imageUrl: shot.stillUrl, sd20Mode: 'i2v' })
    if (!sub.ok || !sub.queueId) { out[shot.id] = { error: sub.ok ? 'The render was not queued' : sub.error }; continue }
    const v: ShotVideo = {
      queueId: sub.queueId, status: 'rendering', url: null, error: null, model: spec.id, seconds: Number(duration) || shot.duration,
      fromStill: shot.stillUrl, fromPrompt: prompt, at: Date.now(),
    }
    out[shot.id] = v
    written[shot.id] = v
  }
  await writeVideos(board.id, written)
  return out
}

/** Settle the board's renders. Returns every shot's video state. */
export async function settleShots(user: User, board: Board): Promise<Record<string, ShotVideo>> {
  const shots = sanitizeShots(board.shots)
  const rendering = shots.filter((s): s is StoryboardShot & { video: ShotVideo } => s.video?.status === 'rendering')
  const videos: Record<string, ShotVideo> = Object.fromEntries(shots.filter(s => s.video).map(s => [s.id, s.video as ShotVideo]))
  if (!rendering.length) return videos

  const jobs = await prisma.generationQueue.findMany({
    where: { id: { in: rendering.map(s => s.video.queueId) }, userId: user.id },
    select: { id: true, status: true, errorMessage: true, falRequestId: true, modelId: true, prompt: true, ticketCost: true, createdAt: true, parameters: true },
  })
  const byId = new Map(jobs.map(j => [j.id, j]))
  const { POST: videoStatus } = await import('@/app/api/video/status/route')
  const changed: Record<string, ShotVideo> = {}
  let folderId: number | null = null
  const finish = async (shot: StoryboardShot & { video: ShotVideo }, url: string | null, error: string | null, falRequestId?: string | null) => {
    // Stored canonical: the status handler answers with a signed (expiring) link
    if (url) url = canonicalMediaUrl(url)
    const v: ShotVideo = { ...shot.video, status: url ? 'done' : 'failed', url, error: url ? null : (error ?? 'The render failed') }
    changed[shot.id] = v
    videos[shot.id] = v
    // File the clip with the board's stills
    if (url && falRequestId) {
      folderId ??= await boardFolder(user.id, board.title)
      await prisma.generatedImage.updateMany({ where: { userId: user.id, falRequestId }, data: { folderId } }).catch(() => {})
    }
  }

  let waiting = false
  for (const shot of rendering) {
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
    if (job.status === 'queued' || !job.falRequestId || !p.falEndpoint) {
      // Waiting for a free fal slot - the cron fills them on Vercel; filling
      // them here too keeps a board moving locally and between cron ticks
      if (age > STALLED_AFTER_MS) await finish(shot, null, 'Waited too long for a free render slot - shoot it again')
      else waiting = true
      continue
    }
    try {
      const res = await videoStatus(new NextRequest('http://internal/api/video/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: job.falRequestId, falEndpoint: p.falEndpoint, prompt: job.prompt, model: job.modelId,
          duration: p.duration, resolution: p.resolution, ticketCost: job.ticketCost, queuedAt: job.createdAt.getTime(),
        }),
      }))
      const data = await res.json() as Record<string, any>
      if (data?.status === 'completed' && typeof data.videoUrl === 'string') await finish(shot, data.videoUrl, null, job.falRequestId)
      else if (data?.status === 'failed') await finish(shot, null, String(data.error || 'The render failed'))
      else if (age > STALLED_AFTER_MS) await finish(shot, null, 'Still rendering long past the expected time - shoot it again')
    } catch {
      // A transient fal/network error is not a failed shot - try again next poll
    }
  }
  if (waiting) await promoteNextQueuedJob().catch(() => {})
  await writeVideos(board.id, changed)
  return videos
}
