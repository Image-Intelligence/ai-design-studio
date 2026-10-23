/**
 * fal-queue.ts
 *
 * Helper for promoting the next waiting job from our internal queue to FAL.ai
 * when a global concurrency slot opens up (after a job completes or fails).
 *
 * The global FAL concurrency limit is stored in ModelConcurrencyLimit under
 * the synthetic modelId 'fal-global'.  When a generation request arrives and
 * that counter is already at its max, the generate route creates a
 * GenerationQueue row with status='queued' (not submitted to FAL yet) and
 * stores the full FAL endpoint + input in the row's `parameters` field.
 * When a slot opens this helper picks up the oldest waiting row and submits it.
 *
 * IMPORTANT: This function does NOT sync the counter internally.  Callers
 * that need counter-drift correction should call syncActiveCounters() first
 * (e.g. the /kick and /cron-drain endpoints).  The in-function sync was
 * removed because concurrent calls would race on the SET and undo each
 * other's slot increments, causing all but one concurrent promotion to fail.
 *
 * The function also does NOT cascade additional promotions.  Callers that
 * need to fill multiple slots should call promoteNextQueuedJob() once per
 * free slot — the retry loop inside handles concurrent races between calls.
 */

import { OWN_QUEUE_MODEL_IDS } from '@/lib/runpod-video-models'
import { fal } from '@/lib/fal-client'
import prisma from '@/lib/prisma'
import { failQueueRow } from '@/lib/queue-settle'

fal.config({ credentials: process.env.FAL_KEY })

export const FAL_GLOBAL_ID = 'fal-global'

/**
 * Give back one concurrency slot, never below 0 (2026-10-23 billing sweep).
 * Prisma's `decrement` has no floor, and a counter driven negative reads as
 * spare capacity - so every give-back in the queue code goes through here.
 */
export async function releaseFalSlot(modelId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ModelConcurrencyLimit"
    SET "currentActive" = GREATEST(0, "currentActive" - 1)
    WHERE "modelId" = ${modelId}
  `
}

/**
 * Which concurrency counters a job bumped when it went to fal - so whoever
 * settles it gives back exactly those (2026-10-23 billing sweep). Settlers
 * used to decrement BOTH the model's counter and the global one, but
 * SeeDream 5 / Recraft only bump the global counter and polled jobs only the
 * global one, so every such settle pushed a counter below what was really
 * running (and, unfloored, below 0 - which reads as spare capacity).
 *   parameters.slots    explicit ('both' | 'global' | 'none'), newer submit routes
 *   GLOBAL_ONLY_MODELS  SeeDream 5 / Recraft rows from before that marker
 *   usePolling          promoted or claimed via syncAndClaimFalSlot: global only
 *   canvas rows         'processing' ones were submitted by the current canvas
 *                       route, which bumps model + global; legacy canvas rows
 *                       left 'queued' while fal ran them bumped nothing
 *   status 'queued'     still waiting in our queue: holds nothing
 *   everything else     /api/generate and the promoter: model + global
 * Pass the row's status as it was when the caller WON its settle flip.
 */
const GLOBAL_ONLY_MODELS = new Set(['seedream-5-lite', 'seedream-5-pro', 'recraft-v4.1'])
export function heldSlots(row: { modelId: string; parameters: unknown; status: string }): { model: boolean; global: boolean } {
  const p = (row.parameters ?? {}) as { slots?: unknown; usePolling?: unknown; slotClaimed?: unknown }
  // The same rules as lib/admin-queue-helpers holdsFalSlot (2026-10-23 review): Higgsfield's and
  // RunPod's jobs run on their own queues, and a row marked slotClaimed:false never took one
  if (OWN_QUEUE_MODEL_IDS.includes(row.modelId)) return { model: false, global: false }
  if (p.slotClaimed === false) return { model: false, global: false }
  if (p.slots === 'both') return { model: true, global: true }
  if (p.slots === 'global') return { model: false, global: true }
  if (p.slots === 'none') return { model: false, global: false }
  if (row.status !== 'processing') return { model: false, global: false }
  if (GLOBAL_ONLY_MODELS.has(row.modelId)) return { model: false, global: true }
  if (p.usePolling === true) return { model: false, global: true }
  return { model: true, global: true }
}

/** Give back the slots a settled job held (floored). Call only as the winner of the row's settle flip. */
export async function releaseHeldSlots(row: { modelId: string; parameters: unknown; status: string }): Promise<void> {
  const held = heldSlots(row)
  await Promise.all([
    held.model ? releaseFalSlot(row.modelId) : null,
    held.global ? releaseFalSlot(FAL_GLOBAL_ID) : null,
  ])
}

/**
 * Called after any FAL job completes or fails (webhook / polling), or from the
 * kick/cron endpoints to fill free slots.
 *
 * Atomically claims one global slot, then finds and claims the oldest queued
 * job.  Uses a retry loop on the job-claim step so that when multiple calls
 * race for the same oldest job, the losers skip to the next oldest rather than
 * releasing their slot and returning — this lets N concurrent calls each
 * promote a different job.
 */
export async function promoteNextQueuedJob(): Promise<void> {
  try {
    // Read current global limit
    const globalLimit = await prisma.modelConcurrencyLimit.findUnique({
      where: { modelId: FAL_GLOBAL_ID },
    })
    if (!globalLimit) return

    // Atomically claim a global slot — only succeeds if currentActive < maxConcurrent
    const slotClaim = await prisma.modelConcurrencyLimit.updateMany({
      where: {
        modelId: FAL_GLOBAL_ID,
        currentActive: { lt: globalLimit.maxConcurrent },
      },
      data: { currentActive: { increment: 1 } },
    })
    if (slotClaim.count === 0) return // At capacity

    // Find and claim the oldest queued job.
    // Retry loop: if a concurrent call already claimed the candidate job, skip
    // it and try the next oldest — prevents all concurrent callers from piling
    // up on the same row and releasing their slots unnecessarily.
    const triedIds: number[] = []
    let jobToProcess: Awaited<ReturnType<typeof prisma.generationQueue.findFirst>> = null

    while (true) {
      const candidate = await prisma.generationQueue.findFirst({
        where: {
          status: 'queued',
          // Higgsfield and RunPod jobs wait on their own queues (lib/higgsfield, lib/runpod-video)
          modelId: { notIn: OWN_QUEUE_MODEL_IDS },
          // A 'queued' row that already carries a fal request id was submitted
          // by its own route (the canvas leaves its rows 'queued' while fal
          // runs them) - it is running at fal and is not ours to promote or
          // fail (2026-10-23 billing sweep: those were being killed here).
          falRequestId: null,
          ...(triedIds.length > 0 ? { id: { notIn: triedIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      })

      if (!candidate) {
        // No more waiting jobs — release the slot we just claimed
        await releaseFalSlot(FAL_GLOBAL_ID)
        return
      }

      // A row without a stored endpoint/input can never be promoted. Decide
      // BEFORE claiming it, so the slot we hold goes to the next row instead.
      const cp = (candidate.parameters ?? {}) as { falEndpoint?: unknown; falInput?: unknown; source?: unknown; slotId?: unknown }
      if (!cp.falEndpoint || !cp.falInput) {
        triedIds.push(candidate.id)
        // Canvas rows are created 'queued' a moment BEFORE their own route
        // submits them, so for a few seconds they have no request id either.
        // Still not ours: skip. A canvas route that died mid-submit is timed
        // out (and its tickets returned) by the jobs poll's stale sweep.
        if (cp.source === 'canvas' || cp.slotId != null) continue
        // Anything else is genuinely unpromotable: fail it and give its
        // tickets back. Guarded on 'queued' - if anything else took the row
        // meanwhile, failQueueRow does nothing. It never held a slot.
        console.error(`Queued job #${candidate.id} missing falEndpoint/falInput — failing it`)
        await failQueueRow(candidate.id, 'Queued job missing stored FAL endpoint or input', ['queued'])
        continue
      }

      const jobClaim = await prisma.generationQueue.updateMany({
        where: { id: candidate.id, status: 'queued', falRequestId: null },
        data: { status: 'processing', startedAt: new Date() },
      })

      if (jobClaim.count > 0) {
        jobToProcess = candidate
        break
      }

      // Another concurrent handler claimed this job — try the next oldest
      triedIds.push(candidate.id)
    }

    // Extract stored FAL submission data (checked present before the claim above)
    const params = jobToProcess!.parameters as any
    const falEndpoint: string = params.falEndpoint
    const falInput: Record<string, unknown> = params.falInput
    // Polling-based jobs (NB2, Kling, Video): skip webhook so only the status route handles completion
    const usePolling: boolean = params.usePolling === true

    // Bump per-model counter only for webhook-based jobs (polling routes handle their own cleanup)
    if (!usePolling) {
      await prisma.modelConcurrencyLimit.updateMany({
        where: { modelId: jobToProcess!.modelId },
        data: { currentActive: { increment: 1 } },
      })
    }

    // Submit to FAL — webhook-based jobs get a webhookUrl; polling-based jobs don't
    const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`
    const submitOptions: Parameters<typeof fal.queue.submit>[1] = { input: falInput }
    if (!usePolling) {
      submitOptions.webhookUrl = `${appUrl}/api/webhooks/fal`
    }

    try {
      const { request_id } = await fal.queue.submit(falEndpoint, submitOptions)

      await prisma.generationQueue.update({
        where: { id: jobToProcess!.id },
        data: { falRequestId: request_id },
      })

      console.log(
        `[fal-queue] Promoted job #${jobToProcess!.id} (${jobToProcess!.modelId}) → FAL ${falEndpoint} (request_id: ${request_id})`
      )
    } catch (submitErr) {
      console.error(`[fal-queue] FAL submit failed for promoted job #${jobToProcess!.id} (${jobToProcess!.modelId}):`, submitErr)

      // Fail it AND give its tickets back (release a reservation / refund a
      // charge, by the row's charge mode). This used to flip the row to failed
      // and nothing else, so its reservation sat on the account for good
      // (2026-10-23 billing sweep). The row is 'processing' - we set that in
      // the claim above - and the guard means a racing settler (admin cancel,
      // stale sweep) and this can't both return the tickets.
      await failQueueRow(jobToProcess!.id, 'FAL submission failed during queue promotion', ['processing'])
        .catch(e => console.error('[fal-queue] Failed to mark job as failed:', e))

      // Decrement counters — the slot is now free. These are OUR slots (claimed
      // above in this call), so they are returned whatever the row's fate.
      await Promise.all([
        releaseFalSlot(FAL_GLOBAL_ID)
          .catch(e => console.error('[fal-queue] Failed to decrement global counter:', e)),
        ...(usePolling ? [] : [
          releaseFalSlot(jobToProcess!.modelId)
            .catch(e => console.error('[fal-queue] Failed to decrement per-model counter:', e)),
        ]),
      ])

      // Immediately try to fill the freed slot with the next queued job so a
      // single FAL submit failure doesn't leave a slot empty until the next cron tick.
      promoteNextQueuedJob().catch(e => console.error('[fal-queue] Re-promote after submit failure:', e))
    }
  } catch (err) {
    console.error('[fal-queue] promoteNextQueuedJob error:', err)
  }
}
