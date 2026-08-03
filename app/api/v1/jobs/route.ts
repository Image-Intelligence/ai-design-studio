import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateApiKey, invalidKeyResponse, requireScopes } from '@/lib/api-key-auth'

export const dynamic = 'force-dynamic'

// GET /api/v1/jobs — generation queue status for the desktop app.
// Returns this user's in-flight jobs plus anything settled in the last 2 hours,
// both image and video. Optional ?id=<queueId> narrows to a single job.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()
  const denied = requireScopes(auth, 'jobs:read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const idParam = searchParams.get('id')
  const id = idParam ? parseInt(idParam) : null
  if (idParam && (!Number.isFinite(id) || id! <= 0)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const jobs = await prisma.generationQueue.findMany({
    where: {
      userId: auth.user.id,
      ...(id
        ? { id }
        : {
            OR: [
              { status: { in: ['queued', 'processing'] } },
              { completedAt: { gte: twoHoursAgo } },
            ],
          }),
    },
    select: {
      id: true,
      status: true,
      modelId: true,
      modelType: true,
      resultUrl: true,
      resultImageId: true,
      errorMessage: true,
      ticketCost: true,
      queuedAt: true,
      startedAt: true,
      completedAt: true,
      queuePosition: true,
    },
    orderBy: { queuedAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
}
