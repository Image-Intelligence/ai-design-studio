import { OWN_QUEUE_MODEL_IDS } from '@/lib/runpod-video-models'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { promoteNextQueuedJob, FAL_GLOBAL_ID } from '@/lib/fal-queue'
import { syncActiveCounters } from '../stats/route'
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// POST /api/admin/queue/kick
// Fixes a stuck queue: syncs the drifted currentActive counter to the real count
// (usually 0 when all processing jobs are gone), then fires promoteNextQueuedJob()
// to fill every free global slot from the waiting queue.
export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // 1. Sync counters from ground truth so currentActive reflects reality
    await syncActiveCounters()

    // 2. Read the corrected state
    const [globalLimit, queuedCount] = await Promise.all([
      prisma.modelConcurrencyLimit.findUnique({ where: { modelId: FAL_GLOBAL_ID } }),
      // fal's line only: Higgsfield's waits on its own (lib/higgsfield)
      prisma.generationQueue.count({ where: { status: 'queued', modelId: { notIn: OWN_QUEUE_MODEL_IDS } } }),
    ])

    if (!globalLimit) {
      return NextResponse.json({ error: 'fal-global limit record not found' }, { status: 404 })
    }

    const freeSlots = Math.max(0, globalLimit.maxConcurrent - globalLimit.currentActive)
    const toPromote = Math.min(freeSlots, queuedCount)

    if (toPromote === 0) {
      return NextResponse.json({
        success: true,
        promoted: 0,
        message: queuedCount === 0
          ? 'No queued jobs to promote'
          : `Queue is still at capacity (${globalLimit.currentActive}/${globalLimit.maxConcurrent})`,
      })
    }

    // 3. Fire one promotion per free slot — each call is idempotent and
    //    handles its own slot claim atomically.
    await Promise.all(
      Array.from({ length: toPromote }, () =>
        promoteNextQueuedJob().catch(e => console.error('[kick] promote error:', e))
      )
    )

    return NextResponse.json({
      success: true,
      promoted: toPromote,
      message: `Kicked ${toPromote} queued job(s) into processing`,
    })
  } catch (error) {
    console.error('Queue kick failed:', error)
    return NextResponse.json({ error: 'Queue kick failed' }, { status: 500 })
  }
}
