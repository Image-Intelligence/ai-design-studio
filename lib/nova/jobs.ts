/**
 * Nova Studio - renders that finish after the turn, and where results are filed
 * (server only).
 *
 * Every generation Nova starts is a GenerationQueue row owned by the user
 * (images, video, audio and 3D alike), created and billed by the site's own
 * route. Settling one reuses the same settlers the rest of the site uses - the
 * video status handler (re-host, feed row, refund on failure), lib/audio-settle
 * and lib/threed's settleThreeD - so a Nova render ends exactly like one
 * started anywhere else, including the refund when it fails.
 */
import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'

export type SettleResult =
  | { status: 'pending' }
  | { status: 'done'; url: string; posterUrl?: string; generationId?: number }
  | { status: 'error'; error: string }

/** The saved feed row for a fal request id, if it exists yet. */
export async function rowForRequest(userId: number, falRequestId: string | null | undefined) {
  if (!falRequestId) return null
  return prisma.generatedImage.findFirst({
    where: { userId, falRequestId, isDeleted: false },
    orderBy: { id: 'desc' },
    select: { id: true, imageUrl: true, model: true, videoMetadata: true },
  })
}

function posterOf(meta: unknown): string | undefined {
  const m = (meta ?? {}) as Record<string, any>
  const p = m.thumbnailUrl ?? m.threed?.poster ?? m.posterUrl
  return typeof p === 'string' ? p : undefined
}

/** Settle one queue job of this user's, whatever kind it is. */
/**
 * `headers`: with no browser session (the background runner) the user's own
 * Nova API key (lib/nova/background) - the video status route accepts keys
 * that may read jobs.
 */
export async function settleQueueJob(user: { id: number; email: string }, queueId: number, headers?: Record<string, string>): Promise<SettleResult> {
  const job = await prisma.generationQueue.findFirst({
    where: { id: queueId, userId: user.id },
    select: { id: true, status: true, errorMessage: true, falRequestId: true, modelType: true, modelId: true, prompt: true, ticketCost: true, createdAt: true, parameters: true, userId: true },
  })
  if (!job) return { status: 'error', error: 'Job not found' }
  const p = (job.parameters ?? {}) as Record<string, any>

  const finished = async (): Promise<SettleResult> => {
    const row = await rowForRequest(user.id, job.falRequestId)
    const urls = Array.isArray(p.completedImageUrls) ? p.completedImageUrls : []
    const url = row?.imageUrl ?? (typeof urls[0] === 'string' ? urls[0] : undefined)
    if (!url) return { status: 'pending' } // the feed row is still being written
    return { status: 'done', url, posterUrl: posterOf(row?.videoMetadata), generationId: row?.id }
  }

  if (job.status === 'completed') return finished()
  if (job.status === 'failed') return { status: 'error', error: job.errorMessage || 'Generation failed' }

  // Audio: lib/audio-settle (exactly-once, refund on failure)
  if (job.modelType === 'audio') {
    const { settleAudioRun } = await import('@/lib/audio-settle')
    const r = await settleAudioRun(job as any, user.email)
    if (r.status === 'completed') return finished()
    if (r.status === 'failed') return { status: 'error', error: r.error || 'Generation failed' }
    return { status: 'pending' }
  }

  // 3D: the shared settler, limited to this user's jobs and a short budget
  if (job.modelType === 'threed') {
    const { settleThreeD } = await import('@/lib/threed/pipeline')
    await settleThreeD({ userId: user.id, budgetMs: 20_000, limit: 5 }).catch(() => 0)
    const again = await prisma.generationQueue.findUnique({ where: { id: job.id }, select: { status: true, errorMessage: true } })
    if (again?.status === 'completed') return finished()
    if (again?.status === 'failed') return { status: 'error', error: again.errorMessage || 'Generation failed' }
    return { status: 'pending' }
  }

  // Video still rendering: ask fal through the site's status handler, which
  // re-hosts the clip, writes the feed row and refunds a failure
  if (job.modelType === 'video' && job.falRequestId && p.falEndpoint) {
    try {
      const { POST: videoStatus } = await import('@/app/api/video/status/route')
      const res = await videoStatus(new NextRequest('http://internal/api/video/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify({
          requestId: job.falRequestId, falEndpoint: p.falEndpoint, prompt: job.prompt, model: job.modelId,
          duration: p.duration, resolution: p.resolution, ticketCost: job.ticketCost, queuedAt: job.createdAt.getTime(),
        }),
      }))
      const data = (await res.json()) as Record<string, any>
      if (data?.status === 'completed' && typeof data.videoUrl === 'string') {
        const row = await rowForRequest(user.id, job.falRequestId)
        return { status: 'done', url: row?.imageUrl ?? data.videoUrl, posterUrl: posterOf(row?.videoMetadata), generationId: row?.id }
      }
      if (data?.status === 'failed') return { status: 'error', error: String(data.error || 'Generation failed') }
    } catch { /* try again on the next poll */ }
    return { status: 'pending' }
  }

  // Images settle by fal's webhook (and the cron); nothing to push here
  return { status: 'pending' }
}

// ── Filing ───────────────────────────────────────────────────────────────────

const ROOT_FOLDER = 'Nova Studio'

/** The chat's own folder: My Generations / Nova Studio / <chat title>, made on first use. */
export async function ensureChatFolder(userId: number, title: string): Promise<number> {
  const find = async (name: string, parentId: number | null) =>
    (await prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId }, select: { id: true } }))?.id
    ?? (await prisma.userGenerationFolder.create({ data: { userId, name, parentId }, select: { id: true } })).id
  const root = await find(ROOT_FOLDER, null)
  const name = (title || 'Untitled chat').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled chat'
  return find(name, root)
}

/** Put a new generation in the chat's folder - only if it is still unfiled (never moves what the user filed). */
export async function fileGeneration(userId: number, generationId: number | undefined, folderId: number | null): Promise<void> {
  if (!generationId || !folderId) return
  await prisma.generatedImage.updateMany({ where: { id: generationId, userId, folderId: null }, data: { folderId } }).catch(() => {})
}
