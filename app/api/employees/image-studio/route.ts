import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { mediaKeeper, collectUrls } from '@/lib/media-ownership'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { sanitizeDoc } from '@/lib/image-studio'

/**
 * Image Studio - the account's canvases.
 *
 *   GET   list: id, title, size, thumbnail, last edit (newest first) - no docs
 *   POST  create: { title?, doc, sourceRefId? } -> { canvas }
 *
 * Any signed-in account (public 2026-10-07). Layer management is the Dev Tier
 * part (the page hides it without Dev Tier, as the popup does); a canvas may
 * hold only the account's own pictures (lib/media-ownership) and a
 * non-admin keeps up to MAX_CANVASES.
 */
const MAX_CANVASES = 200

export async function GET() {
  const user = await requireStudioUser()
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
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = await checkIsAdmin(user.email)
  if (!isAdmin && await prisma.imageCanvas.count({ where: { userId: user.id } }) >= MAX_CANVASES) {
    return jsonPrivate({ error: `You can keep up to ${MAX_CANVASES} canvases - delete one first` }, { status: 400 })
  }
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
  const doc = sanitizeDoc(body.doc)
  // Only the account's own pictures: the canvas hands its layers back as signed links
  if (!isAdmin) {
    const urls = collectUrls(doc)
    const keep = await mediaKeeper(user.id, urls)
    if (!urls.every(u => keep(u))) return jsonPrivate({ error: 'A canvas can only hold your own pictures' }, { status: 400 })
  }
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
