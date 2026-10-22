import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { STUDIO_RUNNING, STUDIO_STALE_MS, expireStudioJobs } from '@/lib/studio-activity'
import { signPayload } from '@/lib/media-url'

// GET /api/admin/my-active-jobs
//
// The caller's own image generations that are still outstanding — queued
// (waiting for a slot) or processing (submitted to fal). The portal renders a
// placeholder tile per row, which is what makes a run survive a refresh: jobs
// belong to the account, so a fresh tab can pick up work it never started,
// including server-side batches no tab ever created slots for.
//
// Scoped to the session user, never to an id in the request.
//
// Studio generations too (2026-10-21): a Storyboard still, an Image Studio AI
// tool, a Final Cut... run inside one request and write a 'studio-running'
// row for its length (lib/studio-activity) - listed here with `studio: true`
// so the feed draws their tiles as well.

export const runtime = 'nodejs'

/** A tab only needs enough to draw placeholders; this is not a queue console. */
const MAX_JOBS = 200

export async function GET(req: Request) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  /*
   * ?type=video (2026-10-12): the account's video jobs in flight, so the
   * portal can put their tiles back after a refresh (or on another device).
   * Videos older than 3 hours are not offered - a row stuck "processing" that
   * long is a dead job, not a video on its way.
   */
  await expireStudioJobs(user.id)
  // Storyboard stills out at fal are settled from here too, so a feed open on
  // its own finishes them (lib/storyboard-stills) - not waited on
  void import('@/lib/storyboard-stills').then(m => m.settlePendingStills({ userId: user.id, limit: 5, budgetMs: 20_000 })).catch(() => {})
  const studioSince = new Date(Date.now() - STUDIO_STALE_MS)
  if (new URL(req.url).searchParams.get('type') === 'video') {
    const rows = await prisma.generationQueue.findMany({
      where: {
        userId: user.id,
        modelType: 'video',
        OR: [
          { status: { in: ['queued', 'processing'] }, createdAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) } },
          { status: STUDIO_RUNNING, updatedAt: { gte: studioSince } },
        ],
      },
      select: { id: true, modelId: true, prompt: true, createdAt: true, parameters: true, falRequestId: true, ticketCost: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_JOBS,
    })
    return NextResponse.json({
      jobs: rows.map(j => {
        const p = (j.parameters ?? {}) as Record<string, any>
        const input = (p.falInput ?? {}) as Record<string, unknown>
        return {
          id: j.id,
          falRequestId: j.falRequestId ?? null,
          falEndpoint: typeof p.falEndpoint === 'string' ? p.falEndpoint
            // Higgsfield jobs: the poller's marker (lib/higgsfield-models)
            : p.provider === 'higgsfield' && typeof p.hfEndpoint === 'string' ? `higgsfield:${p.hfEndpoint}` : undefined,
          clientSlotId: typeof p.clientSlotId === 'string' ? p.clientSlotId : null,
          // What the job costs - a tile whose submit reply was lost settles its charge from this
          ticketCost: j.ticketCost ?? 0,
          modelId: j.modelId,
          prompt: j.prompt,
          createdAt: j.createdAt.toISOString(),
          duration: input.duration != null ? String(input.duration).replace(/s$/, '')
            : typeof p.duration === 'string' ? p.duration : undefined,
          resolution: typeof input.resolution === 'string' ? input.resolution : undefined,
          aspectRatio: typeof input.aspect_ratio === 'string' ? input.aspect_ratio
            : typeof p.aspectRatio === 'string' ? p.aspectRatio : undefined,
          studio: p.source === 'studio',
          // What the job was given (lib/gen-inputs) - its tile's popup shows them; signed (private bucket)
          ...(p.inputs && typeof p.inputs === 'object' ? { inputs: signPayload(p.inputs) } : {}),
        }
      }),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const jobs = await prisma.generationQueue.findMany({
    where: {
      userId: user.id,
      modelType: 'image',
      OR: [
        { status: { in: ['queued', 'processing'] } },
        { status: STUDIO_RUNNING, updatedAt: { gte: studioSince } },
      ],
    },
    select: {
      id: true, modelId: true, prompt: true, status: true,
      createdAt: true, parameters: true, falRequestId: true,
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_JOBS,
  })

  return NextResponse.json({
    jobs: jobs.map(j => {
      const p = (j.parameters ?? {}) as Record<string, unknown>
      return {
        id: j.id,
        // A tile submitted straight to fal knows its job only by this id.
        falRequestId: j.falRequestId ?? null,
        modelId: typeof p.model === 'string' ? p.model : j.modelId,
        prompt: j.prompt,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        aspectRatio: typeof p.aspectRatio === 'string' ? p.aspectRatio : 'auto',
        quality: typeof p.quality === 'string' ? p.quality : undefined,
        referenceImageUrls: Array.isArray(p.referenceImageUrls)
          ? (p.referenceImageUrls as unknown[]).filter((u): u is string => typeof u === 'string')
          : [],
        batch: p.batch === true,
        studio: p.source === 'studio',
      }
    }),
  })
}
