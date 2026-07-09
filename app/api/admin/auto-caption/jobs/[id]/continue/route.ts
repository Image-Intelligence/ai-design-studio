import { after }  from 'next/server'
import { prisma } from '@/lib/prisma'
import { processChunk, getBaseUrl } from '../../_processor'
import { checkAuth } from '@/lib/admin-auth'


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const job = await prisma.autoFillJob.findUnique({ where: { id }, select: { status: true } })
  if (!job) return new Response('Not found', { status: 404 })
  if (job.status !== 'running') return Response.json({ ok: true, skipped: 'job not running' })

  const baseUrl = getBaseUrl(req)
  after(async () => {
    await processChunk(id, baseUrl)
  })

  return Response.json({ ok: true })
}
