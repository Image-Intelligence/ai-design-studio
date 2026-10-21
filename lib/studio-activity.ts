import prisma from '@/lib/prisma'

/*
 * Studio generations in the feed (2026-10-21, owner: "it says I have
 * generations running in the storyboard studio, but on the portal v2 page I do
 * not see their 'generating…' tiles ... the same goes for all of the studio ai
 * generation").
 *
 * Most studio work runs inside one request (fal.subscribe, then a
 * GeneratedImage row) - a Storyboard still or edit, an asset's pictures, a
 * Final Cut, an Image Studio AI tool, a face swap - so there was no queue row
 * for the feed to see. Each of those now writes a GenerationQueue row for the
 * length of the run:
 *
 *   status 'studio-running'   while it runs (a status nothing else touches:
 *                             the fal pollers, harvesters, cron promotion and
 *                             the per-user concurrency count all look at
 *                             queued / processing only)
 *   parameters.source 'studio' + studio (which one) - the feed's job poll
 *                             passes these rows like its own
 *   'completed'               with resultImageId + parameters.completedImageIds,
 *                             the exact rows the feed tile becomes
 *   'failed'                  with the error
 *
 * ticketCost 0: the studio charged (and refunds) on its own; the row is only
 * the feed's record. A row left running by a crashed request is failed after
 * STUDIO_STALE_MS without a sign of life (expireStudioJobs, run by the feed's
 * job routes) - judged on updatedAt, which a long job (a Final Cut, advanced
 * step by step) refreshes with touchStudioJob.
 *
 * Tracking never blocks the generation: every call here swallows its errors.
 */

export const STUDIO_RUNNING = 'studio-running'
/** Longer than any studio request runs (their routes stop at 300-800s), and than a Final Cut step. */
export const STUDIO_STALE_MS = 15 * 60_000

export type StudioJob = number | null

export async function startStudioJob(o: {
  userId: number
  modelType: 'image' | 'video'
  /** The model the result will be saved under (the feed tile's label). */
  modelId: string
  prompt: string
  /** e.g. 'storyboard-still', 'image-studio', 'final-cut' */
  studio: string
  aspectRatio?: string
  quality?: string
  duration?: string | number
}): Promise<StudioJob> {
  try {
    const row = await prisma.generationQueue.create({
      data: {
        userId: o.userId,
        modelId: o.modelId,
        modelType: o.modelType,
        prompt: (o.prompt || '').slice(0, 4000),
        parameters: {
          source: 'studio', studio: o.studio, model: o.modelId,
          ...(o.aspectRatio ? { aspectRatio: o.aspectRatio } : {}),
          ...(o.quality ? { quality: o.quality } : {}),
          ...(o.duration != null ? { duration: String(o.duration) } : {}),
        },
        status: STUDIO_RUNNING,
        ticketCost: 0,
        startedAt: new Date(),
      },
      select: { id: true },
    })
    return row.id
  } catch (e) {
    console.error('[studio-activity] start failed (the generation goes on untracked):', e)
    return null
  }
}

/** The run finished: the feed tile becomes these saved rows. */
export async function finishStudioJob(job: StudioJob | undefined, imageIds: number[], resultUrl?: string | null) {
  if (!job) return
  const ids = imageIds.filter(n => Number.isFinite(n))
  try {
    const row = await prisma.generationQueue.findUnique({ where: { id: job }, select: { parameters: true } })
    await prisma.generationQueue.update({
      where: { id: job },
      data: {
        status: ids.length ? 'completed' : 'failed',
        completedAt: new Date(),
        resultImageId: ids[0] ?? null,
        resultUrl: resultUrl ?? null,
        ...(ids.length ? {} : { errorMessage: 'Nothing was saved' }),
        parameters: { ...((row?.parameters ?? {}) as Record<string, unknown>), completedImageIds: ids },
      },
    })
  } catch (e) {
    console.error('[studio-activity] finish failed:', e)
  }
}

/** Still going (a long job between its steps): keeps it from being expired. */
export async function touchStudioJob(job: StudioJob | undefined) {
  if (!job) return
  try {
    await prisma.generationQueue.updateMany({ where: { id: job, status: STUDIO_RUNNING }, data: { updatedAt: new Date() } })
  } catch { /* a missed touch only shortens its grace */ }
}

export async function failStudioJob(job: StudioJob | undefined, error: string) {
  if (!job) return
  try {
    await prisma.generationQueue.updateMany({
      where: { id: job, status: STUDIO_RUNNING },
      data: { status: 'failed', completedAt: new Date(), errorMessage: String(error || 'Generation failed').slice(0, 1000) },
    })
  } catch (e) {
    console.error('[studio-activity] fail failed:', e)
  }
}

/**
 * Runs `fn` as a tracked studio job: started before, failed if it throws (and
 * rethrown), finished by the caller with the saved row ids it returns.
 */
export async function trackStudioRun<T extends { imageIds: number[]; resultUrl?: string | null }>(
  start: Parameters<typeof startStudioJob>[0],
  fn: (job: StudioJob) => Promise<T>,
): Promise<T> {
  const job = await startStudioJob(start)
  try {
    const out = await fn(job)
    await finishStudioJob(job, out.imageIds, out.resultUrl)
    return out
  } catch (e: any) {
    await failStudioJob(job, e?.message || String(e))
    throw e
  }
}

/** Rows a crashed or timed-out request left running: failed, so their tiles stop spinning. */
export async function expireStudioJobs(userId: number) {
  try {
    await prisma.generationQueue.updateMany({
      where: { userId, status: STUDIO_RUNNING, updatedAt: { lt: new Date(Date.now() - STUDIO_STALE_MS) } },
      data: { status: 'failed', completedAt: new Date(), errorMessage: 'The studio stopped answering - check the studio for this one' },
    })
  } catch { /* the next poll tries again */ }
}
