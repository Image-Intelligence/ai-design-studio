import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { sanitizeDoc } from '@/lib/image-studio'

/**
 * Image Studio - the account's canvases.
 *
 *   GET   list: id, title, size, thumbnail, last edit (newest first) - no docs
 *   POST  create: { title?, doc, sourceRefId? } -> { canvas }
 *
 * ADMIN ONLY, like the rest of the Studios section (lib/employees).
 */
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const rows = await prisma.imageCanvas.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, width: true, height: true, thumbUrl: true, updatedAt: true },
    take: 200,
  })
  return jsonPrivate({ canvases: rows })
}

export async function POST(req: NextRequest) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
  const doc = sanitizeDoc(body.doc)
  const sourceRefId = Number.isInteger(body.sourceRefId) ? body.sourceRefId : null
  const row = await prisma.imageCanvas.create({
    data: {
      userId: user.id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'Untitled canvas',
      width: doc.width, height: doc.height, doc: doc as object, sourceRefId,
    },
  })
  return jsonPrivate({ canvas: row })
}
