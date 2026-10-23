import { prisma } from '@/lib/prisma'
import { releaseQueueSlot, freeFalSlot } from '@/lib/admin-queue-helpers'
import { returnJobTickets } from '@/lib/queue-settle'

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
 * doesn't), then the job is CLAIMED - a guarded status flip, which exactly
 * one call wins - and only the winner downloads and saves.
 *
 * The claim goes to 'saving', not 'completed' (2026-10-23 billing sweep). It
 * used to be releaseQueueSlot's flip straight to 'completed' BEFORE the
 * download: a function killed mid-copy (Vercel's limit, a deploy) left a
 * completed row with no video - never saved, never refunded, and the cron
 * only looks at 'processing'. Now:
 *   processing -> saving    the claim (completedAt = claim time; fal's slot is
 *                           given back here - fal's part is over)
 *   saving -> completed     finishVideoSave, only once the GeneratedImage row
 *                           exists
 *   saving (stale) -> saving   a re-claim, by a poll or the cron's sweeper
 *                           (settleStrandedVideoSaves) - guarded on the old
 *                           claim time, so one caller wins. Refunded only when
 *                           fal's file is gone (DEAD_FILE_FAIL_MS) or after
 *                           STRANDED_GIVE_UP_MS - never for a count of tries
 * A caller that will be cut off passes its deadline (saveDeadlineAt on
 * /api/video/status): it claims only with SAVE_CLAIM_MIN_MS left, bounds its
 * download to fit, and hands the claim back if the save still can't finish.
 * 'saving' holds no fal slot: syncAndClaimFalSlot / syncActiveCounters count
 * 'processing' only. (lib/threed/pipeline uses the same status and claim-time
 * convention for 3D.)
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

/**
 * The video link in a fal result - shared by /api/video/status and
 * /api/admin/video-status (2026-10-23: only the admin route read `videos[]`,
 * so the cron's route failed those jobs as "no video"). Most models return one
 * `video`; a few (Mirelo SFX) return a list of takes; some a `videos` list.
 */
export function falVideoUrlOf(data: any): string | undefined {
  const v = data?.video
  const url = (Array.isArray(v) ? v[0]?.url : v?.url) ?? (Array.isArray(data?.videos) ? data.videos[0]?.url : undefined)
  return typeof url === 'string' && url ? url : undefined
}

export const SAVING_STATUS = 'saving'
/** A job whose fal file never answers is failed (and refunded) this long after it was queued. */
const DEAD_FILE_FAIL_MS = 60 * 60 * 1000
/** A claim this old with no saved row: the claimer died mid-save, so the job is saved again. */
const ORPHAN_CLAIM_MS = 10 * 60 * 1000
/**
 * A 'saving' row this old (from its submit) is given up on and refunded -
 * fal keeps results ~24-48 h. The ONLY give-up besides a dead file
 * (DEAD_FILE_FAIL_MS): claims are counted (saveAttempts) for the record, but a
 * count is no reason to refund - short-lived callers used to burn attempts on
 * a finished, paid video until it was refunded and lost.
 */
const STRANDED_GIVE_UP_MS = 12 * 3600 * 1000
/**
 * An in-process caller that will be cut off (it passes saveDeadlineAt to
 * /api/video/status) only claims with at least this long left: the download
 * is then bounded to fit (saveDownloadMs), and a save that still can't finish
 * hands its claim back (releaseSaveClaim) instead of dying holding it.
 */
export const SAVE_CLAIM_MIN_MS = 150_000
/** Left for the probe, re-time, faststart, upload and row after the download. */
const SAVE_TAIL_MS = 60_000
/** The download's time limit for a caller that ends at `deadlineAt` (none: the usual 240 s). */
export const saveDownloadMs = (deadlineAt: number | null) =>
  deadlineAt ? Math.max(15_000, Math.min(240_000, deadlineAt - Date.now() - SAVE_TAIL_MS)) : 240_000
/** Whether a caller ending at `deadlineAt` (null: unknown, a page's own request) may claim a save. */
export const mayClaimBy = (deadlineAt: number | null) => !deadlineAt || deadlineAt - Date.now() >= SAVE_CLAIM_MIN_MS
export const DEAD_FILE_ERROR = "fal finished this video but its file never became downloadable - your tickets are back"
const SAVE_GAVE_UP_ERROR = "fal finished this video but it could not be saved - your tickets are back"

export type VideoSaveClaim =
  /** This call downloads and saves, then calls finishVideoSave. */
  | { kind: 'save' }
  /** Already saved - answer with this row. */
  | { kind: 'saved'; id: number; imageUrl: string }
  /** Not yet: another call is saving it, or fal's file isn't answering yet. Poll again. */
  | { kind: 'wait' }
  /** Given up on (the job is failed and refunded). */
  | { kind: 'failed'; error: string }

type ClaimRow = {
  id: number; userId: number; ticketCost: number; modelId: string; modelType: string
  parameters: unknown; status: string; createdAt: Date; completedAt: Date | null; errorMessage: string | null
}
const CLAIM_ROW_SELECT = {
  id: true, userId: true, ticketCost: true, modelId: true, modelType: true,
  parameters: true, status: true, createdAt: true, completedAt: true, errorMessage: true,
} as const

const attemptsOf = (row: { parameters: unknown }) => Number(((row.parameters ?? {}) as { saveAttempts?: unknown }).saveAttempts) || 0
const withClaim = (row: { parameters: unknown }, attempts: number) =>
  ({ ...((row.parameters ?? {}) as object), saveClaimedAt: Date.now(), saveAttempts: attempts }) as object
const isStale = (row: { completedAt: Date | null }) => !row.completedAt || Date.now() - row.completedAt.getTime() > ORPHAN_CLAIM_MS

/**
 * The save is done: close the claim ('saving' -> 'completed') now that the
 * GeneratedImage row exists. Safe to call more than once.
 */
export async function finishVideoSave(requestId: string, imageId?: number | null): Promise<void> {
  await prisma.generationQueue.updateMany({
    where: { falRequestId: requestId, status: SAVING_STATUS },
    data: { status: 'completed', completedAt: new Date(), ...(imageId ? { resultImageId: imageId } : {}) },
  }).catch(e => console.error(`[video-save-guard] finishing ${requestId} failed:`, e))
}

/**
 * Hand a claim back without saving (a deadline-bounded caller whose download
 * didn't fit): backdated so the next caller with time re-claims it at once.
 */
export async function releaseSaveClaim(requestId: string): Promise<void> {
  await prisma.generationQueue.updateMany({
    where: { falRequestId: requestId, status: SAVING_STATUS },
    data: { completedAt: new Date(Date.now() - ORPHAN_CLAIM_MS - 60_000) },
  }).catch(e => console.error(`[video-save-guard] handing back ${requestId} failed:`, e))
}

/**
 * Fail a 'saving' row - only the exact claim the caller looked at (same
 * status AND claim time), so a poll that re-claimed it in between keeps it:
 * the user can never get the video AND a refund. Tickets go back only for
 * the one flip that won.
 */
async function failSavingClaim(row: { id: number; userId: number; ticketCost: number; modelType: string; parameters: unknown; completedAt: Date | null }, error: string): Promise<boolean> {
  const flipped = await prisma.generationQueue.updateMany({
    where: { id: row.id, status: SAVING_STATUS, completedAt: row.completedAt },
    data: { status: 'failed', completedAt: new Date(), errorMessage: error.slice(0, 500) },
  })
  if (flipped.count !== 1) return false
  try {
    await returnJobTickets(row)
  } catch (e) {
    console.error(`[video-save-guard] tickets for failed save #${row.id} could not be returned:`, e)
  }
  return true
}

/**
 * Fail a fal video job and give its tickets back - from 'processing'
 * (releaseQueueSlot: slot freed too) or from a STALE 'saving' claim (no live
 * saver; its slot was freed at the claim). A fresh claim is left to its
 * saver. True for the one caller that settled it.
 */
export async function failVideoJob(requestId: string, error: string): Promise<boolean> {
  if (await releaseQueueSlot(requestId, true, error)) return true
  const row = await prisma.generationQueue.findFirst({
    where: { falRequestId: requestId, status: SAVING_STATUS },
    select: { id: true, userId: true, ticketCost: true, modelType: true, parameters: true, completedAt: true },
    orderBy: { id: 'desc' },
  })
  if (row && isStale(row)) return failSavingClaim(row, error)
  return false
}

/** Re-claim a stale 'saving' row (one caller wins), or give it up past STRANDED_GIVE_UP_MS. */
async function reclaimStale(row: ClaimRow): Promise<VideoSaveClaim> {
  if (Date.now() - row.createdAt.getTime() > STRANDED_GIVE_UP_MS) {
    if (await failSavingClaim(row, SAVE_GAVE_UP_ERROR)) return { kind: 'failed', error: SAVE_GAVE_UP_ERROR }
    return { kind: 'wait' }
  }
  const won = await prisma.generationQueue.updateMany({
    where: { id: row.id, status: SAVING_STATUS, completedAt: { lt: new Date(Date.now() - ORPHAN_CLAIM_MS) } },
    data: { completedAt: new Date(), parameters: withClaim(row, attemptsOf(row) + 1) },
  })
  return won.count === 1 ? { kind: 'save' } : { kind: 'wait' }
}

/**
 * `mayClaim: false` (a caller about to be cut off - mayClaimBy): answers
 * 'saved' / 'failed' as usual, but never takes a claim - 'wait' instead.
 */
export async function claimVideoSave(requestId: string, falVideoUrl: string, opts: { mayClaim?: boolean } = {}): Promise<VideoSaveClaim> {
  const mayClaim = opts.mayClaim !== false
  const queueRow = (): Promise<ClaimRow | null> => prisma.generationQueue.findFirst({
    where: { falRequestId: requestId },
    select: CLAIM_ROW_SELECT,
    orderBy: { id: 'desc' },
  })
  const savedRow = () => prisma.generatedImage.findFirst({
    where: { falRequestId: requestId, isDeleted: false },
    orderBy: { id: 'asc' },
    select: { id: true, imageUrl: true },
  })
  const saved = await savedRow()
  if (saved) {
    // Saved, but the saver may have died before closing its claim (or a poll
    // that never claimed got here first): close the row either way
    await finishVideoSave(requestId, saved.id)
    await releaseQueueSlot(requestId, false)
    return { kind: 'saved', ...saved }
  }
  if (!(await mediaAnswers(falVideoUrl))) {
    const row = await queueRow()
    if (row && Date.now() - row.createdAt.getTime() > DEAD_FILE_FAIL_MS) {
      if (await failVideoJob(requestId, DEAD_FILE_ERROR)) return { kind: 'failed', error: DEAD_FILE_ERROR }
      const now = await queueRow()
      if (now?.status === 'failed') return { kind: 'failed', error: now.errorMessage || DEAD_FILE_ERROR }
    }
    return { kind: 'wait' }
  }

  const row = await queueRow()
  // No queue row to claim against (older paths): save as before
  if (!row) return mayClaim ? { kind: 'save' } : { kind: 'wait' }
  if (row.status === 'processing' && mayClaim) {
    const won = await prisma.generationQueue.updateMany({
      where: { id: row.id, status: 'processing' },
      data: { status: SAVING_STATUS, completedAt: new Date(), parameters: withClaim(row, 1) },
    })
    if (won.count === 1) {
      // fal's part is over: its slot goes back now (the save can take minutes)
      await freeFalSlot(row).catch(e => console.error('[video-save-guard] freeing the slot failed:', e))
      return { kind: 'save' }
    }
  }

  // Someone else got it - see where it stands
  const cur = await queueRow()
  if (!cur) return { kind: 'wait' }
  const again = await savedRow()
  if (again) {
    await finishVideoSave(requestId, again.id)
    return { kind: 'saved', ...again }
  }
  if (cur.status === 'failed' || cur.status === 'cancelled') return { kind: 'failed', error: cur.errorMessage || 'Generation failed' }
  // A row saved and since deleted by its owner is not saved again
  const anyRow = await prisma.generatedImage.findFirst({ where: { falRequestId: requestId }, orderBy: { id: 'asc' }, select: { id: true, imageUrl: true } })
  if (anyRow) {
    await finishVideoSave(requestId, anyRow.id)
    return { kind: 'saved', ...anyRow }
  }
  if (!mayClaim) return { kind: 'wait' }
  if (cur.status === SAVING_STATUS && isStale(cur)) return reclaimStale(cur)
  // A claim made before 2026-10-23 went straight to 'completed': with no row
  // at all after ORPHAN_CLAIM_MS its claimer died. Re-claimed with a guarded
  // flip on the exact claim time (the orphan rule used to let every poll past
  // it at once - and each one saved)
  if (cur.status === 'completed' && cur.completedAt && Date.now() - cur.completedAt.getTime() > ORPHAN_CLAIM_MS) {
    const won = await prisma.generationQueue.updateMany({
      where: { id: cur.id, status: 'completed', completedAt: cur.completedAt },
      data: { status: SAVING_STATUS, completedAt: new Date(), parameters: withClaim(cur, attemptsOf(cur) + 1) },
    })
    if (won.count === 1) return { kind: 'save' }
  }
  return { kind: 'wait' }
}

/**
 * The cron's half (2026-10-23 billing sweep): finish fal video saves whose
 * claimer died. A 'saving' row older than ORPHAN_CLAIM_MS is closed if its
 * video was saved after all, failed and refunded only when it is
 * STRANDED_GIVE_UP_MS old (or lost its endpoint), and otherwise saved again
 * through /api/video/status's own handler - whose claimVideoSave re-claims the
 * row (one winner), or fails it if fal's file is really gone - as the cron's
 * other video passes do. `deadlineAt` is when the calling function is cut off
 * (the cron: its start + maxDuration): passed on as saveDeadlineAt, so the
 * handler only claims with time to finish, and the pass stops once there
 * isn't. Needs CRON_SECRET (the handler's internal-caller check). Resolves to
 * the number of rows settled.
 */
export async function settleStrandedVideoSaves(opts: { limit?: number; budgetMs?: number; deadlineAt?: number } = {}): Promise<number> {
  const { limit = 4, budgetMs = 30_000 } = opts
  const deadlineAt = opts.deadlineAt && opts.deadlineAt > 0 ? opts.deadlineAt : null
  const t0 = Date.now()
  const rows = await prisma.generationQueue.findMany({
    where: {
      modelType: 'video',
      status: SAVING_STATUS,
      falRequestId: { not: null },
      completedAt: { lt: new Date(Date.now() - ORPHAN_CLAIM_MS) },
    },
    select: { ...CLAIM_ROW_SELECT, falRequestId: true, prompt: true },
    orderBy: { completedAt: 'asc' },
    take: limit,
  })
  let settled = 0
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs || !mayClaimBy(deadlineAt)) break
    const rid = r.falRequestId!
    try {
      // Saved after all: the saver died between the row and closing the claim
      const saved = await prisma.generatedImage.findFirst({ where: { falRequestId: rid }, orderBy: { id: 'asc' }, select: { id: true } })
      if (saved) { await finishVideoSave(rid, saved.id); settled++; continue }
      const p = (r.parameters ?? {}) as { falEndpoint?: string }
      if (!p.falEndpoint || Date.now() - r.createdAt.getTime() > STRANDED_GIVE_UP_MS) {
        // Guarded on the claim this pass read (failSavingClaim)
        if (await failSavingClaim(r, SAVE_GAVE_UP_ERROR)) settled++
        continue
      }
      if (!process.env.CRON_SECRET) {
        console.warn(`[video-save-guard] stranded save #${r.id} waits: CRON_SECRET is not set, so it can't be re-saved as its owner`)
        continue
      }
      const { NextRequest } = await import('next/server')
      const { POST: videoStatus } = await import('@/app/api/video/status/route')
      const res = await videoStatus(new NextRequest('http://internal/api/video/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': process.env.CRON_SECRET, 'x-internal-user': String(r.userId) },
        body: JSON.stringify({
          requestId: rid, falEndpoint: p.falEndpoint, prompt: r.prompt, model: r.modelId,
          ticketCost: r.ticketCost, queuedAt: r.createdAt.getTime(),
          ...(deadlineAt ? { saveDeadlineAt: deadlineAt } : {}),
        }),
      }))
      const data = (await res.json()) as { status?: string }
      if (data?.status === 'completed' || data?.status === 'failed') settled++
      console.log(`[video-save-guard] stranded save #${r.id} (${r.modelId}) -> ${data?.status ?? 'unknown'}`)
    } catch (e) {
      console.error(`[video-save-guard] stranded save #${r.id} failed:`, e)
    }
  }
  return settled
}
