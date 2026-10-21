import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/admin/queue-job-status?id=<queueId>
// Returns the status of a GenerationQueue entry.
// Portal-v2 polls this when a job was queued (at capacity) to detect when it gets promoted.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('id') || '')

  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 })
  }

  try {
    const job = await prisma.generationQueue.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        falRequestId: true,
        errorMessage: true,
        parameters: true,
        resultImageId: true,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const params = job.parameters as any
    return NextResponse.json({
      status: job.status,          // 'queued' | 'processing' | 'completed' | 'failed'
      falRequestId: job.falRequestId,
      // Higgsfield's queued videos carry their poller marker (lib/higgsfield-models)
      falEndpoint: params?.falEndpoint ?? (params?.provider === 'higgsfield' && params?.hfEndpoint ? `higgsfield:${params.hfEndpoint}` : undefined),
      errorMessage: job.errorMessage,
      // A studio video (lib/studio-activity) finishes with no fal request: the feed fetches this row
      resultImageId: job.resultImageId,
    })
  } catch (err: any) {
    console.error('queue-job-status error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
