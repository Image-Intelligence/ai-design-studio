import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { FAL_GLOBAL_ID } from '@/lib/fal-queue'
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

/**
 * GET /api/admin/queue/diagnostic
 *
 * Returns a snapshot useful for diagnosing stuck queues:
 *  - How many processing jobs were actually submitted to FAL (have falRequestId)
 *  - How many are stuck without a FAL request ID (submit failed but not cleaned up)
 *  - The webhook URL being used (so you can verify it matches your production domain)
 *  - Most recent completed/failed job timestamps (proxy for "are webhooks working?")
 *  - Global limit state
 */
export async function GET(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = Date.now()
  const fiveMinAgo  = new Date(now - 5  * 60 * 1000)
  const thirtyMinAgo = new Date(now - 30 * 60 * 1000)

  const [
    processingWithRequestId,
    processingWithoutRequestId,
    processingOlderThan5Min,
    processingOlderThan30Min,
    totalQueued,
    recentCompleted,
    recentFailed,
    globalLimit,
  ] = await Promise.all([
    // Processing jobs that were actually submitted to FAL
    prisma.generationQueue.count({
      where: { status: 'processing', falRequestId: { not: null } },
    }),
    // Processing jobs with NO falRequestId — stuck between claim and submit
    prisma.generationQueue.count({
      where: { status: 'processing', falRequestId: null },
    }),
    // Processing jobs older than 5 min (webhooks should have arrived by now)
    prisma.generationQueue.count({
      where: { status: 'processing', startedAt: { lt: fiveMinAgo } },
    }),
    // Processing jobs older than 30 min (definitely dead)
    prisma.generationQueue.count({
      where: { status: 'processing', startedAt: { lt: thirtyMinAgo } },
    }),
    prisma.generationQueue.count({ where: { status: 'queued' } }),
    // Most recent completion (proxy: are webhooks arriving?)
    prisma.generationQueue.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, modelId: true },
    }),
    // Most recent failure
    prisma.generationQueue.findFirst({
      where: { status: 'failed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, errorMessage: true },
    }),
    prisma.modelConcurrencyLimit.findUnique({ where: { modelId: FAL_GLOBAL_ID } }),
  ])

  const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`
  const webhookUrl = `${appUrl}/api/webhooks/fal`

  // How long ago was the last completed job?
  const lastCompletedSecondsAgo = recentCompleted?.completedAt
    ? Math.round((now - recentCompleted.completedAt.getTime()) / 1000)
    : null

  const diagnosis: string[] = []

  if (processingWithoutRequestId > 0) {
    diagnosis.push(
      `⚠️  ${processingWithoutRequestId} processing job(s) have no falRequestId — they were claimed but FAL submit failed or was interrupted. These will never receive a webhook. Use "Reset Stuck Jobs" or wait for the 30-min cron reset.`
    )
  }
  if (processingOlderThan5Min > 0 && lastCompletedSecondsAgo !== null && lastCompletedSecondsAgo > 300) {
    diagnosis.push(
      `⚠️  ${processingOlderThan5Min} job(s) have been processing > 5 min and no completion was recorded in the last ${Math.round(lastCompletedSecondsAgo / 60)} min. Webhooks may not be reaching this deployment. Check that APP_URL is set to "${appUrl}" in your Vercel production environment variables.`
    )
  }
  if (processingOlderThan30Min > 0) {
    diagnosis.push(
      `🔴  ${processingOlderThan30Min} job(s) are > 30 min old — the cron will auto-reset these within the next minute.`
    )
  }
  if (diagnosis.length === 0 && processingWithRequestId > 0) {
    diagnosis.push('✅  All processing jobs have FAL request IDs. System looks healthy — FAL is generating, webhooks should arrive.')
  }
  if (processingWithRequestId === 0 && processingWithoutRequestId === 0) {
    diagnosis.push('ℹ️  No jobs currently processing.')
  }

  return NextResponse.json({
    globalLimit: globalLimit
      ? { currentActive: globalLimit.currentActive, maxConcurrent: globalLimit.maxConcurrent }
      : null,
    processing: {
      withFalRequestId: processingWithRequestId,
      withoutFalRequestId: processingWithoutRequestId,
      olderThan5Min: processingOlderThan5Min,
      olderThan30Min: processingOlderThan30Min,
    },
    queued: totalQueued,
    recentActivity: {
      lastCompleted: recentCompleted
        ? { id: recentCompleted.id, model: recentCompleted.modelId, secondsAgo: lastCompletedSecondsAgo }
        : null,
      lastFailed: recentFailed
        ? { id: recentFailed.id, error: recentFailed.errorMessage, secondsAgo: recentFailed.completedAt ? Math.round((now - recentFailed.completedAt.getTime()) / 1000) : null }
        : null,
    },
    webhookUrl,
    appUrlSource: process.env.APP_URL ? 'APP_URL env var' : 'VERCEL_URL fallback',
    diagnosis,
  })
}
