import { prisma } from '@/lib/prisma'
import { releaseQueueSlot } from '@/lib/admin-queue-helpers'

/*
 * Saving a finished fal video exactly once (2026-10-22).
 *
 * The status routes (/api/admin/video-status, which the page polls, and
 * /api/video/status, which the cron and the jobs poll use) each checked
 * "already saved?" and then spent minutes copying the video before saving.
 * A Wan Animate run whose file fal served slowly was polled by the page, by
 * each reload's restored tile and by the cron at once: every one of them got
 * past the check, waited on the same download, and saved - five rows, all
 * pointing at fal's link (the copy had failed), so five black tiles.
 *
 * Now: fal's file has to answer first (no row is ever saved for a link that
 * doesn't), then the job is CLAIMED - releaseQueueSlot's guarded status flip,
 * which exactly one call wins - and only the winner downloads and saves.
 */

/** A media link answers: its first KB arrives within `ms`. */
export async function mediaAnswers(url: string, ms = 15_000): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(ms) })
    await r.arrayBuffer().catch(() => {})
    return r.ok
  } catch {
    return false
  }
}

/** A job whose fal file never answers is failed (and refunded) this long after it was queued. */
const DEAD_FILE_FAIL_MS = 60 * 60 * 1000
/** A claim this old with no saved row: the claimer died mid-save, so the job is saved again. */
const ORPHAN_CLAIM_MS = 10 * 60 * 1000
export const DEAD_FILE_ERROR = "fal finished this video but its file never became downloadable - your tickets are back"

export type VideoSaveClaim =
  /** This call downloads and saves (the job is already marked completed). */
  | { kind: 'save' }
  /** Already saved - answer with this row. */
  | { kind: 'saved'; id: number; imageUrl: string }
  /** Not yet: another call is saving it, or fal's file isn't answering yet. Poll again. */
  | { kind: 'wait' }
  /** Given up on (the job is failed and refunded). */
  | { kind: 'failed'; error: string }

export async function claimVideoSave(requestId: string, falVideoUrl: string): Promise<VideoSaveClaim> {
  const queueRow = () => prisma.generationQueue.findFirst({
    where: { falRequestId: requestId },
    select: { status: true, createdAt: true, completedAt: true, errorMessage: true },
    orderBy: { id: 'desc' },
  })
  const savedRow = () => prisma.generatedImage.findFirst({
    where: { falRequestId: requestId, isDeleted: false },
    orderBy: { id: 'asc' },
    select: { id: true, imageUrl: true },
  })
  const saved = await savedRow()
  if (saved) return { kind: 'saved', ...saved }
  if (!(await mediaAnswers(falVideoUrl))) {
    const row = await queueRow()
    if (row && Date.now() - row.createdAt.getTime() > DEAD_FILE_FAIL_MS) {
      await releaseQueueSlot(requestId, true, DEAD_FILE_ERROR)
      return { kind: 'failed', error: DEAD_FILE_ERROR }
    }
    return { kind: 'wait' }
  }
  if (await releaseQueueSlot(requestId, false)) return { kind: 'save' }
  const row = await queueRow()
  // No queue row to claim against (older paths): save as before
  if (!row) return { kind: 'save' }
  const again = await savedRow()
  if (again) return { kind: 'saved', ...again }
  if (row.status === 'failed') return { kind: 'failed', error: row.errorMessage || 'Generation failed' }
  if (row.status === 'completed' && row.completedAt && Date.now() - row.completedAt.getTime() > ORPHAN_CLAIM_MS) return { kind: 'save' }
  return { kind: 'wait' }
}
