import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'

// GET /api/admin/queue-job-status?id=<queueId>
// Returns the status of a GenerationQueue entry.
// Portal-v2 polls this when a job was queued (at capacity) to detect when it gets promoted.
// The caller's OWN jobs only (2026-10-21): it answered anyone, for any id - a
// signed-out request could read every account's job states, fal request ids
// and error messages by counting up the ids.
export async function GET(req: Request) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('id') || '')

  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 })
  }

  try {
    const job = await prisma.generationQueue.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        status: true,
        falRequestId: true,
        errorMessage: true,
        parameters: true,
        resultImageId: true,
        modelId: true,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const params = job.parameters as any
    return NextResponse.json({
      // 'queued' | 'processing' | 'completed' | 'failed' - a video being stored ('saving',
      // lib/video-save-guard) reads as processing, so the page keeps its tile and polls on
      status: job.status === 'saving' ? 'processing' : job.status,
      falRequestId: job.falRequestId,
      // Higgsfield's queued videos carry their poller marker (lib/higgsfield-models)
      falEndpoint: params?.falEndpoint ?? (params?.provider === 'higgsfield' && params?.hfEndpoint ? `higgsfield:${params.hfEndpoint}`
        // ... and our RunPod workers' (lib/runpod-video-models)
        : params?.provider === 'runpod' ? `runpod:${job.modelId}` : undefined),
      errorMessage: job.errorMessage,
      // A studio video (lib/studio-activity) finishes with no fal request: the feed fetches this row
      resultImageId: job.resultImageId,
      // The rows a finished image job wrote (a job the server finished itself - the harvester, the
      // cron - while its tile was still waiting): the tile claims them (2026-10-21)
      ...(Array.isArray(params?.completedImageIds) ? { completedImageIds: params.completedImageIds.filter((n: unknown) => typeof n === 'number').slice(0, 20) } : {}),
    })
  } catch (err: any) {
    console.error('queue-job-status error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
