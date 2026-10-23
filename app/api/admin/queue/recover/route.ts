import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { promoteNextQueuedJob, FAL_GLOBAL_ID } from '@/lib/fal-queue'
import { syncActiveCounters } from '../stats/route'
import { checkAdminRequest } from '@/lib/admin-check'
import { OWN_QUEUE_MODEL_IDS } from '@/lib/runpod-video-models'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

/**
 * POST /api/admin/queue/recover
 *
 * Re-queues all stuck 'processing' jobs so they get re-submitted to FAL.
 *
 * Use when FAL shows 0 active but our DB shows N processing — meaning FAL
 * finished/dropped those jobs without our webhook handler recording the result
 * (typically: 40 webhooks arrived simultaneously and overwhelmed the DB pool).
 *
 * Safety: does NOT refund ticket reservations — the original reservation stays
 * intact so users aren't double-charged when the job re-runs successfully.
 * Only call when FAL is genuinely at 0 active for the stuck jobs; if any are
 * still running at FAL, re-queuing them causes a duplicate submission.
 */
export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // Find all jobs stuck in processing
    const processing = await prisma.generationQueue.findMany({
      where: {
        status: 'processing',
        // fal's queue only: Higgsfield / RunPod / 3D jobs are not re-submitted
        // by the promoter and settle on their own pipelines
        modelId: { notIn: OWN_QUEUE_MODEL_IDS },
        modelType: { not: 'threed' },
      },
      select: { id: true, modelId: true, userId: true, parameters: true },
    })
    // Only rows the promoter can actually re-run (2026-10-23 billing sweep).
    // A row submitted straight to fal by its own route stores no endpoint /
    // input; re-queued, the promoter could only fail it - giving the tickets
    // back for a job fal may well have finished. Those are left alone (the
    // cron's lost-webhook pass and stale pass settle them from fal's answer).
    const stuckJobs = processing.filter(j => {
      const p = (j.parameters ?? {}) as { falEndpoint?: unknown; falInput?: unknown }
      return !!p.falEndpoint && !!p.falInput
    })

    if (stuckJobs.length === 0) {
      return NextResponse.json({ success: true, requeued: 0, message: 'No re-runnable processing jobs to recover' })
    }

    // Re-queue them: clear falRequestId + startedAt so they act like fresh queue entries.
    // Money: none moves - the reservation / charge each row holds stays with it
    // for the re-run, and the promoter's failQueueRow returns it if the
    // re-submit fails. Guarded on 'processing' so a job that settled since the
    // read above (and already moved its tickets) is not resurrected.
    // Also cleared (2026-10-23 review): slotClaimed - the promoter takes a fresh slot for
    // the re-run, and a leftover `false` would keep it from ever being given back - and
    // webhookClaimAt, which would turn the re-run's own webhook away for 5 minutes
    const ids = stuckJobs.map(j => j.id)
    const requeuedCount = ids.length ? await prisma.$executeRaw`
      UPDATE "GenerationQueue"
      SET status = 'queued', "startedAt" = NULL, "falRequestId" = NULL, "errorMessage" = NULL,
          parameters = (COALESCE(parameters::jsonb, '{}'::jsonb) - 'slotClaimed' - 'webhookClaimAt')
      WHERE id = ANY(${ids}::int[]) AND status = 'processing'` : 0
    const requeued = { count: requeuedCount }

    // Sync all counters to ground truth (all processing rows are now gone → counters → 0)
    await syncActiveCounters()

    // Read how many free slots are available and how many jobs are waiting
    const [globalLimit, queuedCount] = await Promise.all([
      prisma.modelConcurrencyLimit.findUnique({ where: { modelId: FAL_GLOBAL_ID } }),
      prisma.generationQueue.count({ where: { status: 'queued' } }),
    ])

    let promoted = 0
    if (globalLimit && queuedCount > 0) {
      const freeSlots = Math.max(0, globalLimit.maxConcurrent - globalLimit.currentActive)
      const toPromote = Math.min(freeSlots, queuedCount)

      if (toPromote > 0) {
        await Promise.all(
          Array.from({ length: toPromote }, () =>
            promoteNextQueuedJob().catch(e => console.error('[recover] promote error:', e))
          )
        )
        promoted = toPromote
      }
    }

    return NextResponse.json({
      success: true,
      requeued: requeued.count,
      promoted,
      message: `Re-queued ${requeued.count} stuck job(s) and kicked ${promoted} into processing`,
    })
  } catch (error) {
    console.error('[recover] Error:', error)
    return NextResponse.json({ error: 'Recovery failed' }, { status: 500 })
  }
}
