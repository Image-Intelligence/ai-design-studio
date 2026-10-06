import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'
import { ensureThumbnail } from '@/lib/thumbnail'

/**
 * POST /api/employees/image-studio/[id]/export - put a flattened export of
 * the canvas into My Generations (folder "Image Studio").
 *
 * Body: { url } - the export, already uploaded through ../upload (kind 'export')
 * Returns: { imageId }
 */
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const canvas = Number.isFinite(id) ? await prisma.imageCanvas.findFirst({ where: { id, userId: user.id } }) : null
  if (!canvas) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const url = typeof body.url === 'string' ? canonicalMediaUrl(body.url) : ''
  // Only a file this account uploaded for the studio
  if (!url.includes(`/u/${user.id}/image-studio/export-`)) return jsonPrivate({ error: 'Upload the export first' }, { status: 400 })

  const folder = (await prisma.userGenerationFolder.findFirst({ where: { userId: user.id, name: 'Image Studio', parentId: null } }))
    ?? await prisma.userGenerationFolder.create({ data: { userId: user.id, name: 'Image Studio', parentId: null } })
  const g = gcd(canvas.width, canvas.height)
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id, prompt: `${canvas.title} (Image Studio)`, imageUrl: url, model: 'image-studio', ticketCost: 0,
      referenceImageUrls: [], folderId: folder.id, expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      aspectRatio: `${canvas.width / g}:${canvas.height / g}`,
    },
  })
  await ensureThumbnail(row.id).catch(() => {})
  return jsonPrivate({ imageId: row.id })
}

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a }
