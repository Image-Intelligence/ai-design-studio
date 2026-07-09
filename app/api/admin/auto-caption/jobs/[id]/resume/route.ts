import { after }  from 'next/server'
import { prisma } from '@/lib/prisma'
import { processChunk, getBaseUrl } from '../../_processor'
import { checkAuth } from '@/lib/admin-auth'


// POST — resume a cancelled job from where it left off (no new job created)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const job = await prisma.autoFillJob.findUnique({ where: { id } })
  if (!job) return new Response('Not found', { status: 404 })
  if (job.status !== 'cancelled') return Response.json({ error: 'Job is not cancelled' }, { status: 400 })

  const imageIds = job.imageIds as number[]
  if (job.nextIndex >= imageIds.length) {
    return Response.json({ error: 'Nothing remaining to process' }, { status: 400 })
  }

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
  const activeJob = await prisma.autoFillJob.findFirst({
    where: {
      OR: [
        { status: 'paused' },
        { status: 'running', updatedAt: { gte: fifteenMinutesAgo } },
      ],
    },
  })

  const newStatus = activeJob ? 'queued' : 'running'
  await prisma.autoFillJob.update({ where: { id }, data: { status: newStatus } })

  if (newStatus === 'running') {
    const baseUrl = getBaseUrl(req)
    after(async () => { await processChunk(id, baseUrl) })
  }

  return Response.json({ status: newStatus, nextIndex: job.nextIndex, totalCount: imageIds.length })
}
