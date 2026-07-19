import { after, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { promoteNextQueuedJob, FAL_GLOBAL_ID } from '@/lib/fal-queue'
import { syncActiveCounters } from '@/app/api/admin/queue/stats/route'
import { processChunk, getBaseUrl } from '@/app/api/admin/auto-caption/jobs/_processor'

// Jobs stuck in 'processing' longer than this are considered dead and are
// automatically reset so their slots can be reused.
const STALE_MINUTES = 10

/**
 * GET /api/cron/drain-queue
 *
 * Called by Vercel Cron every minute (see vercel.json).
 *
 * Safety model:
 *  - Does NOT call syncActiveCounters() unconditionally. That function does a
 *    SET operation which races with webhook DECREMENTs and causes counter drift.
 *  - ONLY calls syncActiveCounters() after forcefully failing confirmed-dead
 *    jobs (> STALE_MINUTES in processing). Those jobs will never receive a
 *    webhook, so no pending DECREMENTs exist — the SET is safe.
 *  - Slot promotion uses the atomic updateMany (currentActive < maxConcurrent)
 *    inside promoteNextQueuedJob, which is safe under concurrent webhook calls.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── 1. Reset stale jobs ──────────────────────────────────────────────────
    // Mark any job that has been in 'processing' for > STALE_MINUTES as failed.
    // These jobs will never receive a webhook callback (FAL timeout is < 30 min),
    // so their slots are permanently leaked.  After failing them it is safe to
    // sync the counter because no in-flight webhook decrements exist for them.
    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)

    const staleJobs = await prisma.generationQueue.findMany({
      where: { status: 'processing', startedAt: { lt: staleThreshold } },
      select: { id: true },
    })

    let staleReset = 0
    if (staleJobs.length > 0) {
      await prisma.generationQueue.updateMany({
        where: { id: { in: staleJobs.map(j => j.id) } },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Auto-reset by cron: stuck in processing for ${STALE_MINUTES}+ minutes`,
        },
      })
      // Safe to sync here — no pending webhook decrements for these dead jobs
      await syncActiveCounters()
      staleReset = staleJobs.length
      console.log(`[cron-drain] Reset ${staleReset} stale job(s) and synced counters`)
    }

    // ── 2. Promote queued jobs into free slots ───────────────────────────────
    // Read current state.  If stale reset happened the counter was just synced;
    // otherwise we trust the stored counter (avoid the SET/DECREMENT race).
    const [globalLimit, queuedCount] = await Promise.all([
      prisma.modelConcurrencyLimit.findUnique({ where: { modelId: FAL_GLOBAL_ID } }),
      prisma.generationQueue.count({ where: { status: 'queued' } }),
    ])

    let promoted = 0
    if (globalLimit && queuedCount > 0) {
      const freeSlots = Math.max(0, globalLimit.maxConcurrent - globalLimit.currentActive)
      const toPromote = Math.min(freeSlots, queuedCount)
      if (toPromote > 0) {
        // Fill all free slots concurrently.  The retry loop inside promoteNextQueuedJob
        // ensures each concurrent call claims a different queued job.
        await Promise.all(
          Array.from({ length: toPromote }, () =>
            promoteNextQueuedJob().catch(e => console.error('[cron-drain] promote error:', e))
          )
        )
        promoted = toPromote
        console.log(`[cron-drain] Promoted ${toPromote} queued job(s)`)
      }
    }

    // ── 3. Re-kick stuck AutoFill caption jobs ───────────────────────────────
    // AutoFill jobs chain chunks via an HTTP self-call. If that call fails, the
    // job stays 'running' but nothing processes it. Re-kick any job that hasn't
    // updated in 90 seconds so the chain resumes without user intervention.
    // This runs unconditionally — autofill must survive even when the image queue is idle.
    const autofillStuckThreshold = new Date(Date.now() - 90_000)
    const stuckAutofillJobs = await prisma.autoFillJob.findMany({
      where:  { status: 'running', updatedAt: { lt: autofillStuckThreshold } },
      select: { id: true },
    })
    if (stuckAutofillJobs.length > 0) {
      const baseUrl = getBaseUrl(request)
      for (const job of stuckAutofillJobs) {
        after(async () => { await processChunk(job.id, baseUrl) })
      }
      console.log(`[cron-drain] Re-kicked ${stuckAutofillJobs.length} stuck autofill job(s)`)
    }

    // ── 4. Promote a queued AutoFill job if the queue has stalled ─────────────
    // Normally a finishing job auto-starts the next queued one, but if a running
    // job died without triggering that hand-off (crash mid-transition), a full
    // queue would sit forever with nothing running. If there are queued jobs and
    // ZERO running jobs, start the oldest queued one. Guarded on running === 0 so
    // it never runs a second job concurrently (autofill is one-at-a-time; stale
    // running jobs are handled by the re-kick above).
    let autofillPromoted = 0
    const runningAutofill = await prisma.autoFillJob.count({ where: { status: 'running' } })
    if (runningAutofill === 0) {
      const nextQueued = await prisma.autoFillJob.findFirst({
        where:   { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        select:  { id: true },
      })
      if (nextQueued) {
        await prisma.autoFillJob.update({ where: { id: nextQueued.id }, data: { status: 'running' } })
        const baseUrl = getBaseUrl(request)
        after(async () => { await processChunk(nextQueued.id, baseUrl) })
        autofillPromoted = 1
        console.log(`[cron-drain] Promoted stalled queued autofill job ${nextQueued.id}`)
      }
    }

    return NextResponse.json({ success: true, staleReset, promoted, autofillKicked: stuckAutofillJobs.length, autofillPromoted })
  } catch (error) {
    console.error('[cron-drain] Error:', error)
    return NextResponse.json({ error: 'Drain failed' }, { status: 500 })
  }
}
