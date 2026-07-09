import { after }  from 'next/server'
import { prisma } from '@/lib/prisma'
import { processChunk, getBaseUrl } from '../../_processor'
import { checkAuth } from '@/lib/admin-auth'


// POST — create a new job re-running the same images (skipping already-processed ones)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const original = await prisma.autoFillJob.findUnique({ where: { id } })
  if (!original) return new Response('Not found', { status: 404 })

  const imageIds = original.imageIds as number[]
  if (!imageIds.length) return Response.json({ error: 'No images in original job' }, { status: 400 })

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
  const activeJob = await prisma.autoFillJob.findFirst({
    where: {
      OR: [
        { status: 'paused' },
        { status: 'running', updatedAt: { gte: fifteenMinutesAgo } },
      ],
    },
  })

  const initialStatus = activeJob ? 'queued' : 'running'

  const job = await prisma.autoFillJob.create({
    data: {
      status:         initialStatus,
      mode:           original.mode,
      modelKey:       original.modelKey,
      overwrite:      false,           // skip images already captioned/tagged from the previous run
      advanced:       original.advanced,
      curatorContext: original.curatorContext,
      triggerWord:    original.triggerWord,
      imageIds,
      totalCount:     imageIds.length,
    },
  })

  if (initialStatus === 'running') {
    const baseUrl = getBaseUrl(req)
    after(async () => { await processChunk(job.id, baseUrl) })
  }

  return Response.json({ jobId: job.id, status: initialStatus, count: imageIds.length })
}
