import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { sanitizeDoc } from '@/lib/image-studio'

/**
 * One Image Studio canvas.
 *
 *   GET     the canvas and its document (layer URLs signed for the page)
 *   PATCH   { title?, doc?, thumbUrl? } - the editor autosaves here; the
 *           document is replaced whole (pixels are already on R2 by then)
 *   DELETE  remove it (exports already saved to Refs / My Generations stay)
 */
type Ctx = { params: Promise<{ id: string }> }

async function own(ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return { error: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const id = parseInt((await ctx.params).id)
  if (!Number.isFinite(id)) return { error: jsonPrivate({ error: 'Invalid id' }, { status: 400 }) }
  const row = await prisma.imageCanvas.findFirst({ where: { id, userId: user.id } })
  if (!row) return { error: jsonPrivate({ error: 'Not found' }, { status: 404 }) }
  return { user, row }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  return jsonPrivate({ canvas: { ...r.row, doc: sanitizeDoc(r.row.doc, r.row) } })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  // Layer URLs arrive signed (that is how the page got them) and are stored canonical
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120) || 'Untitled canvas'
  if ('doc' in body) {
    const doc = sanitizeDoc(body.doc, r.row)
    data.doc = doc as object
    data.width = doc.width
    data.height = doc.height
  }
  if (typeof body.thumbUrl === 'string' && /^https:\/\//.test(body.thumbUrl)) data.thumbUrl = body.thumbUrl.slice(0, 2000)
  const row = await prisma.imageCanvas.update({ where: { id: r.row.id }, data })
  return jsonPrivate({ ok: true, updatedAt: row.updatedAt })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  await prisma.imageCanvas.delete({ where: { id: r.row.id } })
  return jsonPrivate({ ok: true })
}
