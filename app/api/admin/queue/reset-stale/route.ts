import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { syncActiveCounters } from '../stats/route';
import { checkAdminRequest } from '@/lib/admin-check'
import { failQueueRow } from '@/lib/queue-settle'
import { OWN_QUEUE_MODEL_IDS } from '@/lib/runpod-video-models'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// POST - Reset stuck "processing" jobs that are older than the threshold.
// A job is considered stale if it has been in "processing" for more than
// STALE_MINUTES minutes. FAL.ai's own timeout is well under 30 minutes,
// so any job older than that will never receive a webhook callback.
const STALE_MINUTES = 10;

export async function POST(request: Request) {
  if (!await checkAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    // Find all stale processing jobs
    const staleJobs = await prisma.generationQueue.findMany({
      where: {
        status: 'processing',
        startedAt: { lt: staleThreshold },
        // fal's queue only (2026-10-23 billing sweep): Higgsfield / RunPod jobs
        // and 3D settle - and refund - on their own pipelines, which run far
        // longer than ten minutes; failing them here now also returns their
        // tickets, so a still-running one would be paid back and then lost.
        modelId: { notIn: OWN_QUEUE_MODEL_IDS },
        modelType: { not: 'threed' },
      },
      select: { id: true, modelId: true },
    });

    if (staleJobs.length === 0) {
      return NextResponse.json({ success: true, reset: 0, message: 'No stale jobs found' });
    }

    // One guarded flip per row through lib/queue-settle (2026-10-23 billing
    // sweep). The bare updateMany here failed the rows and moved no tickets -
    // every reservation stayed stuck on its account, every charged job kept
    // its charge - and, unguarded, it also overwrote a job that settled
    // between the read above and the write. failQueueRow only touches a row
    // still 'processing' and returns its tickets (release / refund by charge
    // mode) for the one caller whose flip won.
    let reset = 0
    for (const j of staleJobs) {
      const won = await failQueueRow(j.id, `Stale job reset by admin after ${STALE_MINUTES}+ minutes in processing state`, ['processing'])
        .catch(e => { console.error(`[reset-stale] could not fail #${j.id}:`, e); return false })
      if (won) reset++
    }

    // Recalculate from ground truth instead of decrementing (prevents negative counters).
    // This SET also gives back the global + per-model slots the failed rows held.
    await syncActiveCounters();

    return NextResponse.json({
      success: true,
      reset,
      message: `Reset ${reset} stale job(s)`,
    });
  } catch (error) {
    console.error('Failed to reset stale jobs:', error);
    return NextResponse.json({ error: 'Failed to reset stale jobs' }, { status: 500 });
  }
}
