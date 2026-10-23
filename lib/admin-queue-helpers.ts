/**
 * admin-queue-helpers.ts
 *
 * Shared helpers for admin portal-v2 status routes (NB2, Kling, Video).
 * These routes use polling rather than FAL webhooks, so they must manually
 * decrement the global concurrency counter and promote the next queued job
 * when a generation completes or fails.
 */

import { OWN_QUEUE_MODEL_IDS } from '@/lib/runpod-video-models'
import prisma from '@/lib/prisma'
import { FAL_GLOBAL_ID, promoteNextQueuedJob } from '@/lib/fal-queue'
import { returnJobTickets } from '@/lib/queue-settle'

/*
 * Who holds one of fal's global slots (2026-10-23 billing sweep).
 *
 * Non-admin video is sent straight to fal without claiming a slot, but its
 * release still decremented the counter - every finished clip pulled it one
 * lower than the work really running, and the promoter then sent more than
 * maxConcurrent at once. A row now says so: parameters.slotClaimed = true
 * where a slot was taken (or will be, by the promoter, for a 'queued' row),
 * false where none was. Only an explicit `false` skips the decrement - rows
 * made before this (and by the routes that don't write the flag yet) keep the
 * old behaviour, so nothing that DID claim a slot stops giving it back.
 */
type SlotRow = { modelId?: string | null; modelType?: string | null; parameters?: unknown }

/** Whether a 'processing' row holds one of fal's global slots. */
export function holdsFalSlot(row: SlotRow): boolean {
  // Higgsfield's and RunPod's jobs run on their own queues (lib/higgsfield, lib/runpod-video)
  if (row.modelId && OWN_QUEUE_MODEL_IDS.includes(row.modelId)) return false
  // 3D jobs aren't counted against fal's slots either (as syncActiveCounters)
  if (row.modelType === 'threed') return false
  return ((row.parameters ?? {}) as { slotClaimed?: unknown }).slotClaimed !== false
}

/**
 * The ground truth for fal's global counter: 'processing' rows that hold a
 * slot. syncActiveCounters (/api/admin/queue/stats) should count the same way.
 */
export async function countFalSlotHolders(): Promise<number> {
  const [all, slotless] = await Promise.all([
    // 3D excluded, as syncActiveCounters does (/api/admin/queue/stats)
    prisma.generationQueue.count({ where: { status: 'processing', modelType: { not: 'threed' }, modelId: { notIn: OWN_QUEUE_MODEL_IDS } } }),
    prisma.generationQueue.count({ where: { status: 'processing', modelType: { not: 'threed' }, modelId: { notIn: OWN_QUEUE_MODEL_IDS }, parameters: { path: ['slotClaimed'], equals: false } } }),
  ])
  return Math.max(0, all - slotless)
}

/**
 * Give back the slot a row held (floored at 0) and promote the next waiting
 * job. The caller must have just moved the row out of 'processing' with a
 * guarded flip, so this runs once per job.
 */
export async function freeFalSlot(row: SlotRow): Promise<void> {
  if (holdsFalSlot(row)) {
    await prisma.$executeRaw`
      UPDATE "ModelConcurrencyLimit"
      SET "currentActive" = GREATEST(0, "currentActive" - 1)
      WHERE "modelId" = ${FAL_GLOBAL_ID}
    `
  }
  await promoteNextQueuedJob()
}

/**
 * Syncs the global FAL concurrency counter from ground truth (actual DB count of
 * 'processing' rows), then atomically claims a slot.
 *
 * Why sync first: the counter can drift upward when a serverless function times
 * out, crashes, or loses its DB connection after incrementing but before the
 * corresponding decrement — leaving the counter permanently inflated.  An inflated
 * counter causes subsequent submissions to be falsely queued even when FAL has
 * plenty of capacity.  Syncing at submit time self-heals any drift without needing
 * a manual admin action.
 *
 * Returns { claimed: true } when a slot was successfully reserved, or
 * { claimed: false } when the queue is genuinely at capacity.
 */
export async function syncAndClaimFalSlot(): Promise<{ claimed: boolean; maxConcurrent: number }> {
  const globalLimit = await prisma.modelConcurrencyLimit.findUnique({ where: { modelId: FAL_GLOBAL_ID } })
  if (!globalLimit) return { claimed: true, maxConcurrent: 999 } // No limit row — allow

  // Sync counter to ground truth AND check for waiting jobs in one pass.
  const [actualProcessing, queuedCount] = await Promise.all([
    // fal's own jobs only: Higgsfield's and RunPod's run on their own queues (lib/higgsfield, lib/runpod-video);
    // and only the ones holding a slot (slotClaimed: false = non-admin video, which never takes one)
    countFalSlotHolders(),
    prisma.generationQueue.count({ where: { status: 'queued', modelId: { notIn: OWN_QUEUE_MODEL_IDS } } }),
  ])

  if (actualProcessing !== globalLimit.currentActive) {
    console.log(`[syncAndClaimFalSlot] Counter drift: stored=${globalLimit.currentActive}, actual=${actualProcessing}. Syncing.`)
    await prisma.modelConcurrencyLimit.updateMany({
      where: { modelId: FAL_GLOBAL_ID },
      data: { currentActive: actualProcessing },
    })

    // Drift correction freed up slots. If there are queued jobs waiting, promote
    // them now rather than letting new submissions jump ahead of the backlog.
    if (queuedCount > 0) {
      const freeSlots = globalLimit.maxConcurrent - actualProcessing
      for (let i = 0; i < Math.min(freeSlots, queuedCount); i++) {
        await promoteNextQueuedJob()
      }
    }
  }

  // FIFO enforcement: if there are already queued jobs, this new submission must
  // also queue — don't allow it to skip ahead of older waiting generations.
  if (queuedCount > 0) {
    return { claimed: false, maxConcurrent: globalLimit.maxConcurrent }
  }

  // No backlog — atomically claim a direct slot for this submission.
  const claim = await prisma.modelConcurrencyLimit.updateMany({
    where: { modelId: FAL_GLOBAL_ID, currentActive: { lt: globalLimit.maxConcurrent } },
    data: { currentActive: { increment: 1 } },
  })

  return { claimed: claim.count > 0, maxConcurrent: globalLimit.maxConcurrent }
}

/**
 * Called once per FAL job when its polling status route detects COMPLETED or FAILED.
 * Atomically marks the GenerationQueue entry, decrements the global slot counter,
 * and promotes the next waiting job.
 *
 * Uses `updateMany` with a `status: 'processing'` guard so concurrent poll calls
 * can't double-decrement.
 *
 * Resolves true for the one call that settled the job, false when it was
 * already settled - the video status routes call it just before they save,
 * so only that one call saves (2026-10-22: five polls waiting on one slow fal
 * download each saved the same Wan Animate video). (Since the 2026-10-23
 * billing sweep the video routes claim through lib/video-save-guard instead,
 * into 'saving' - see there.)
 */
export async function releaseQueueSlot(falRequestId: string, failed: boolean, errorMessage?: string): Promise<boolean> {
  let claimed = false
  try {
    // The row first: its charge mode decides how tickets go back, and its
    // slotClaimed flag whether the counter comes down (2026-10-23 billing sweep)
    const row = await prisma.generationQueue.findFirst({
      where: { falRequestId, status: 'processing' },
      select: { id: true, userId: true, ticketCost: true, modelId: true, modelType: true, parameters: true },
      orderBy: { id: 'desc' },
    })
    if (!row) return false // Already settled (e.g., duplicate poll call) — nothing to do
    const updated = await prisma.generationQueue.updateMany({
      where: { id: row.id, status: 'processing' },
      data: {
        status: failed ? 'failed' : 'completed',
        completedAt: new Date(),
        ...(failed && errorMessage ? { errorMessage: errorMessage.slice(0, 500) } : {}),
      },
    })

    if (updated.count === 0) {
      // Already settled (e.g., duplicate poll call) — nothing to do
      return false
    }
    claimed = true

    // Server-authoritative ticket return on failure. Because the status flip
    // above is guarded by `status: 'processing'`, exactly one poll call reaches
    // this branch per job, so it can never double-fire. It runs regardless of
    // whether the user's tab is open — fixing tickets silently lost on
    // tab-close/crash. `ticketCost` on the row is the amount actually taken (0
    // for models the user was never charged for, e.g. admin image gens), so
    // this never credits an uncharged user. A row charged at submit is
    // refunded; one that only RESERVED is released (lib/queue-settle
    // chargeModeOf) - this used to add to the balance for both.
    if (failed) {
      try {
        await returnJobTickets(row)
      } catch (refundErr) {
        console.error('[admin-queue-helpers] refund on failure error:', refundErr)
      }
    }

    // The slot back (only if the row held one - holdsFalSlot) and the next
    // waiting job promoted
    await freeFalSlot(row)
  } catch (err) {
    console.error('[admin-queue-helpers] releaseQueueSlot error:', err)
  }
  return claimed
}
