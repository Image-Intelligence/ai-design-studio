import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'

/**
 * POST /api/employees/storyboards/[id]/still-info - the library records behind
 * a board's stills, so the workspace can open one in the portal's full image
 * viewer (ImageDetailModal: full quality, prompt, model, the info panel).
 *
 * Body: { urls: string[] }  (the stills as the page holds them - signed is fine)
 * Returns: { items } - one per url that has a record, in the order asked, in
 * the shape the viewer takes. Every still the studio makes is saved as a
 * GeneratedImage (the still route), so in practice all of them are found.
 *
 * Any signed-in account, scoped to its own images.
 */
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id }, select: { id: true } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { urls?: unknown }
  const urls = (Array.isArray(body.urls) ? body.urls : [])
    .filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u))
    .slice(0, 200)
    .map(u => canonicalMediaUrl(u))
  if (!urls.length) return jsonPrivate({ items: [] })

  const rows = await prisma.generatedImage.findMany({
    where: { userId: user.id, imageUrl: { in: urls }, isDeleted: false },
    select: {
      id: true, imageUrl: true, prompt: true, model: true, createdAt: true,
      referenceImageUrls: true, aspectRatio: true, quality: true, videoMetadata: true,
    },
    orderBy: { id: 'desc' },
  })
  // One record per url (the newest, should a still have been saved twice), in the order asked
  const byUrl = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!byUrl.has(r.imageUrl)) byUrl.set(r.imageUrl, r)
  const items = urls.map(u => byUrl.get(u)).filter(Boolean).map(r => ({
    id: r!.id,
    imageUrl: r!.imageUrl,
    prompt: r!.prompt,
    model: r!.model,
    createdAt: r!.createdAt.toISOString(),
    referenceImageUrls: r!.referenceImageUrls ?? [],
    aspectRatio: r!.aspectRatio ?? undefined,
    quality: r!.quality ?? undefined,
    videoMetadata: r!.videoMetadata ?? undefined,
  }))
  return jsonPrivate({ items })
}
