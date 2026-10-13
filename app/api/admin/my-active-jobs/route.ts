import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'

// GET /api/admin/my-active-jobs
//
// The caller's own image generations that are still outstanding — queued
// (waiting for a slot) or processing (submitted to fal). The portal renders a
// placeholder tile per row, which is what makes a run survive a refresh: jobs
// belong to the account, so a fresh tab can pick up work it never started,
// including server-side batches no tab ever created slots for.
//
// Scoped to the session user, never to an id in the request.

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
  if (new URL(req.url).searchParams.get('type') === 'video') {
    const rows = await prisma.generationQueue.findMany({
      where: {
        userId: user.id,
        modelType: 'video',
        status: { in: ['queued', 'processing'] },
        createdAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) },
      },
      select: { id: true, modelId: true, prompt: true, createdAt: true, parameters: true, falRequestId: true },
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
          modelId: j.modelId,
          prompt: j.prompt,
          createdAt: j.createdAt.toISOString(),
          duration: input.duration != null ? String(input.duration).replace(/s$/, '') : undefined,
          resolution: typeof input.resolution === 'string' ? input.resolution : undefined,
          aspectRatio: typeof input.aspect_ratio === 'string' ? input.aspect_ratio : undefined,
        }
      }),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const jobs = await prisma.generationQueue.findMany({
    where: {
      userId: user.id,
      modelType: 'image',
      status: { in: ['queued', 'processing'] },
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
      }
    }),
  })
}
