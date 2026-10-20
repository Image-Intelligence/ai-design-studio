import { releaseReservedTickets } from '@/lib/ticket-gate'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { syncActiveCounters } from '../stats/route'

// POST /api/admin/queue/force-reset
// Immediately fails ALL processing/queued jobs and releases their ticket reservations.
// Protected by ADMIN_PASSWORD. Use when a broken webhook URL left jobs permanently stuck.
export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find every job that is still in-flight
    const stuckJobs = await prisma.generationQueue.findMany({
      where: { status: { in: ['processing', 'queued'] } },
      select: { id: true, userId: true, ticketCost: true },
    })

    if (stuckJobs.length === 0) {
      return NextResponse.json({ success: true, reset: 0, message: 'No stuck jobs found' })
    }

    // Mark all of them failed
    await prisma.generationQueue.updateMany({
      where: { id: { in: stuckJobs.map(j => j.id) } },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'Force-reset by admin — webhook URL was misconfigured (APP_URL undefined)',
      },
    })

    // Release ticket reservations grouped by user
    const reservationsByUser = new Map<number, number>()
    for (const job of stuckJobs) {
      reservationsByUser.set(job.userId, (reservationsByUser.get(job.userId) ?? 0) + job.ticketCost)
    }

    await Promise.all(
      Array.from(reservationsByUser.entries()).map(([userId, totalReserved]) =>
        releaseReservedTickets(userId, totalReserved)
      )
    )

    // Resync active-count counters from ground truth
    await syncActiveCounters()

    return NextResponse.json({
      success: true,
      reset: stuckJobs.length,
      message: `Force-reset ${stuckJobs.length} stuck job(s) and released reservations for ${reservationsByUser.size} user(s)`,
    })
  } catch (error) {
    console.error('Force-reset failed:', error)
    return NextResponse.json({ error: 'Force-reset failed' }, { status: 500 })
  }
}
