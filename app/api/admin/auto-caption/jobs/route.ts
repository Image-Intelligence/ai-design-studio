import { after }  from 'next/server'
import { prisma } from '@/lib/prisma'
import { processChunk, getBaseUrl } from './_processor'
import { checkAuth } from '@/lib/admin-auth'


export async function GET(req: Request) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })
  const jobs = await prisma.autoFillJob.findMany({
    where:   { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  {
      id: true, status: true, mode: true, modelKey: true, advanced: true,
      totalCount: true, nextIndex: true, processedCount: true, skippedCount: true, failedCount: true,
      triggerWord: true, curatorContext: true,
      createdAt: true, updatedAt: true,
    },
  })
  return Response.json({ jobs })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const {
    ids, mode, model: modelKey, overwrite = false, advanced = false, context, contextTags,
  } = await req.json() as {
    ids:          number[]
    mode:         'caption' | 'tags' | 'flux'
    model:        'pro' | 'flash'
    overwrite:    boolean
    advanced:     boolean
    context?:     string
    contextTags?: string[]
  }

  if (!Array.isArray(ids) || ids.length === 0) return new Response('ids required', { status: 400 })
  if (!['caption', 'tags', 'flux'].includes(mode)) return new Response('invalid mode', { status: 400 })

  const curatorContext = [
    ...(contextTags?.length ? [`Subjects/names: ${contextTags.join(', ')}`] : []),
    ...(context ? [context] : []),
  ].join(' — ') || null

  const triggerWord = mode === 'flux' ? (contextTags?.[0] ?? null) : null

  // If a job is actively running (updated recently) or paused, enqueue; otherwise start immediately.
  // Ignore 'running' jobs not updated in 3+ minutes — they are stuck/zombie and the cron watchdog
  // will re-kick them. Don't let them block new work.
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000)
  const activeJob = await prisma.autoFillJob.findFirst({
    where: {
      OR: [
        { status: 'paused' },
        { status: 'running', updatedAt: { gte: threeMinutesAgo } },
      ],
    },
  })

  const initialStatus = activeJob ? 'queued' : 'running'

  const job = await prisma.autoFillJob.create({
    data: {
      status: initialStatus,
      mode, modelKey: modelKey ?? 'flash', overwrite, advanced,
      curatorContext, triggerWord, imageIds: ids, totalCount: ids.length,
    },
  })

  if (initialStatus === 'running') {
    const baseUrl = getBaseUrl(req)
    after(async () => {
      await processChunk(job.id, baseUrl)
    })
  }

  return Response.json({ jobId: job.id, status: initialStatus })
}
