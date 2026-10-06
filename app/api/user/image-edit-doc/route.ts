import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { requireStudioUser, hasDevAccess } from '@/lib/studio-auth'
import { sanitizeDoc } from '@/lib/image-studio'

/**
 * The layered version of an Edit Image popup edit (Dev Tier).
 *
 *   GET  ?hash=<sha-256 hex>  -> { doc | null }
 *   POST { hash, doc }        -> { ok }   (one per picture, replaced on re-apply)
 *
 * `hash` is the SHA-256 of the flattened picture Apply produced. Wherever that
 * picture goes (a re-created ref under a new id, a frame, a new library ref),
 * it is stored byte for byte, so opening the same picture again finds its
 * layers. Layer pixels are already on R2 (the editor uploads them first); the
 * doc only points at them.
 */
const HASH = /^[0-9a-f]{64}$/

export async function GET(req: NextRequest) {
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const hash = req.nextUrl.searchParams.get('hash') ?? ''
  if (!HASH.test(hash)) return jsonPrivate({ error: 'Bad hash' }, { status: 400 })
  if (!(await hasDevAccess(user.id, user.email))) return jsonPrivate({ doc: null })
  const row = await prisma.imageEditDoc.findUnique({ where: { userId_hash: { userId: user.id, hash } } })
  return jsonPrivate({ doc: row ? sanitizeDoc(row.doc, row) : null })
}

export async function POST(req: NextRequest) {
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasDevAccess(user.id, user.email))) return jsonPrivate({ error: 'Keeping layers is a Dev Tier feature' }, { status: 403 })
  // Layer URLs arrive signed (that is how the page got them) and are stored canonical
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
  const hash = typeof body.hash === 'string' ? body.hash : ''
  if (!HASH.test(hash)) return jsonPrivate({ error: 'Bad hash' }, { status: 400 })
  const doc = sanitizeDoc(body.doc)
  // Only this account's own uploads: a GET hands every layer back as a SIGNED
  // link, so a doc pointing at someone else's file would leak it. The popup
  // uploads every layer's pixels under the user's prefix before saving.
  const foreign = doc.layers.some(l => [l.src, l.mask?.src].some(u => u && !u.includes(`/u/${user.id}/`)))
  if (foreign) return jsonPrivate({ error: 'Layers must be your own uploads' }, { status: 400 })
  await prisma.imageEditDoc.upsert({
    where: { userId_hash: { userId: user.id, hash } },
    create: { userId: user.id, hash, width: doc.width, height: doc.height, doc: doc as any },
    update: { width: doc.width, height: doc.height, doc: doc as any },
  })
  return jsonPrivate({ ok: true })
}
