import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET - Fetch queue statistics (pure read — no side effects)
//
// IMPORTANT: This endpoint intentionally does NOT call syncActiveCounters() or
// reset stale jobs.  It is polled every 5 seconds by the admin page, so any
// SET operation here races with webhook DECREMENTs and causes counter drift
// (counter goes below actual → extra job gets promoted → counter above maxConcurrent).
//
// Counter sync and stale-job cleanup are handled by:
//   • /api/admin/queue/sync-counters  (manual)
//   • /api/admin/queue/reset-stale    (manual)
//   • /api/cron/drain-queue           (automatic, every minute)
export async function GET() {
  try {
    const [totalQueued, totalProcessing, totalCompleted, totalFailed] = await Promise.all([
      prisma.generationQueue.count({ where: { status: 'queued' } }),
      prisma.generationQueue.count({ where: { status: 'processing' } }),
      prisma.generationQueue.count({ where: { status: 'completed' } }),
      prisma.generationQueue.count({ where: { status: 'failed' } }),
    ]);

    return NextResponse.json({ success: true, stats: { totalQueued, totalProcessing, totalCompleted, totalFailed } });
  } catch (error) {
    console.error('Failed to fetch queue stats:', error);
    return NextResponse.json({ error: 'Failed to fetch queue stats' }, { status: 500 });
  }
}

// Recalculate currentActive for every model from the actual count of
// 'processing' queue rows.  This is the only source of truth and prevents
// the counter from going negative due to double-decrements.
//
// Only call this after you have confirmed no in-flight webhook DECREMENTs exist
// (e.g. immediately after force-failing stale jobs, or from the kick endpoint
// which runs before any concurrent promotions start).
export async function syncActiveCounters() {
  const [processingByModel, totalFalProcessing] = await Promise.all([
    prisma.generationQueue.groupBy({
      by: ['modelId'],
      // 3D jobs run on fal's own queue for minutes to an hour and never held
      // one of the image/video slots - counting them throttled everyone else
      where: { status: 'processing', modelType: { not: 'threed' } },
      _count: { id: true },
    }),
    prisma.generationQueue.count({ where: { status: 'processing', modelType: { not: 'threed' } } }),
  ]);

  const actualCounts: Record<string, number> = {};
  for (const row of processingByModel) {
    actualCounts[row.modelId] = row._count.id;
  }

  const { FAL_GLOBAL_ID } = await import('@/lib/fal-queue');

  const allLimits = await prisma.modelConcurrencyLimit.findMany({
    select: { modelId: true, currentActive: true },
  });

  await Promise.all(
    allLimits.map(limit => {
      const actual =
        limit.modelId === FAL_GLOBAL_ID
          ? totalFalProcessing
          : (actualCounts[limit.modelId] ?? 0);
      if (limit.currentActive !== actual) {
        return prisma.modelConcurrencyLimit.update({
          where: { modelId: limit.modelId },
          data: { currentActive: actual },
        });
      }
      return Promise.resolve();
    })
  );
}
