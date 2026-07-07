// GET /api/prompting-studio/jobs
// Returns all in-flight (and recently settled) GenerationQueue records for the
// current user so the canvas can restore loading placeholders after a page refresh
// and enforce per-account concurrency limits.

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'


export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') // 'canvas' | 'main-scanner' | null

    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    // Auto-fail any processing jobs that have been stuck for more than 10 minutes.
    // This cleans up jobs where the server errored mid-generation and left the DB
    // record in 'processing' forever, and releases their reserved tickets.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const timedOutJobs = await prisma.generationQueue.findMany({
      where: {
        userId: user.id,
        status: { in: ['processing', 'queued'] },
        startedAt: { lt: tenMinutesAgo },
      },
      select: { id: true, ticketCost: true },
    })
    if (timedOutJobs.length > 0) {
      await prisma.generationQueue.updateMany({
        where: { id: { in: timedOutJobs.map(j => j.id) } },
        data: {
          status: 'failed',
          errorMessage: 'Generation timed out — please try again',
          completedAt: new Date(),
        },
      })
      // Release reserved tickets for timed-out jobs
      const totalReserved = timedOutJobs.reduce((sum, j) => sum + j.ticketCost, 0)
      if (totalReserved > 0) {
        await prisma.ticket.update({
          where: { userId: user.id },
          data: { reserved: { decrement: totalReserved } },
        })
      }
    }

    // Fetch jobs that are still in-flight OR settled within the last 2 hours.
    // The 2-hour window lets the client resolve placeholders that completed
    // while the page was reloading, without returning stale old data.
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000)

    const allJobs = await prisma.generationQueue.findMany({
      where: {
        userId: user.id,
        modelType: 'image',
        OR: [
          { status: { in: ['processing', 'queued'] } },
          {
            status: { in: ['completed', 'failed'] },
            updatedAt: { gte: since },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    // Filter jobs by source so each client only sees its own jobs.
    // Canvas jobs are identified by slotId or source='canvas'.
    // Main-scanner jobs include: explicitly tagged, OR jobs with falRequestId that
    // lack canvas markers (NB2/Kling/GPT-Image-2 from submit routes cross-device).
    const jobs = allJobs.filter(j => {
      const params = j.parameters as any
      const isCanvasJob = params?.slotId != null || params?.source === 'canvas'
      if (source === 'main-scanner') {
        return params?.source === 'main-scanner' || (!isCanvasJob && j.falRequestId)
      }
      // Default (canvas): jobs tagged as canvas or with a slotId
      return isCanvasJob
    })

    const activeCount = jobs.filter(
      j => j.status === 'processing' || j.status === 'queued'
    ).length

    return NextResponse.json({ jobs, activeCount })
  } catch (error: any) {
    console.error('Jobs fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}
