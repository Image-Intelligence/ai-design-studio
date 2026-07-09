import { prisma } from '@/lib/prisma'
import { getBaseUrl, autoStartNextQueued } from '../_processor'
import { checkAuth } from '@/lib/admin-auth'


// GET — poll job status + recent results
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const job = await prisma.autoFillJob.findUnique({
    where:  { id },
    select: {
      id: true, status: true, mode: true, modelKey: true, advanced: true,
      totalCount: true, nextIndex: true,
      processedCount: true, skippedCount: true, failedCount: true,
      results: true, createdAt: true, updatedAt: true,
    },
  })

  if (!job) return new Response('Not found', { status: 404 })
  return Response.json(job)
}

// PATCH — pause or resume a job
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const { status } = await req.json() as { status: string }

  if (!['paused', 'running'].includes(status)) return new Response('invalid status', { status: 400 })

  const job = await prisma.autoFillJob.findUnique({ where: { id }, select: { status: true } })
  if (!job) return new Response('Not found', { status: 404 })

  await prisma.autoFillJob.update({ where: { id }, data: { status } })
  return Response.json({ ok: true, status })
}

// DELETE — cancel a job; if it was active, auto-start next queued job
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const job = await prisma.autoFillJob.findUnique({ where: { id }, select: { status: true } })
  if (!job) return new Response('Not found', { status: 404 })

  const wasActive = job.status === 'running' || job.status === 'paused'

  await prisma.autoFillJob.update({ where: { id }, data: { status: 'cancelled' } })

  if (wasActive) {
    await autoStartNextQueued(getBaseUrl(req))
  }

  return Response.json({ ok: true })
}
