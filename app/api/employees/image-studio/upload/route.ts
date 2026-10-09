import { NextRequest } from 'next/server'
import { requireStudioUser } from '@/lib/studio-auth'
import { jsonPrivate } from '@/lib/api-json'
import { presignPutUrl, uploadToR2, userKey } from '@/lib/r2'
import { requireIdVerified } from '@/lib/id-verification'

/**
 * POST /api/employees/image-studio/upload - somewhere to put layer pixels.
 *
 * Body: { kind: 'layer' | 'mask' | 'thumb' | 'export' | 'ai', type: 'image/png' | 'image/jpeg' | 'image/webp' }
 * Returns: { uploadUrl, url } - the page PUTs the file straight to R2 (a
 * layer can be tens of MB; a function body is capped at ~4.5MB) and stores
 * `url` in the canvas document.
 *
 * Any signed-in account - the editor also runs in the Edit Image popup.
 * Keys live under the user's own prefix.
 *
 * Or the file itself (Content-Type image/png|jpeg|webp, ?kind=) -> { url }:
 * the editor's fallback when the browser may not PUT to R2 directly (the
 * bucket's CORS allows localhost:3000 and the live site, not a LAN address).
 * Capped by the function body limit on Vercel (~4.5MB); 40MB here.
 */
const MAX_DIRECT_BYTES = 40 * 1024 * 1024
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export async function POST(req: NextRequest) {
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  // ID verification (CCBill: uploads only from verified accounts). Layer pixels
  // go straight from the browser to storage, so the server can't tell an
  // imported photo from a generated layer - every studio save needs a verified
  // account (admins pass). The page shows the ID popup before the editor opens.
  const gated = await requireIdVerified(user)
  if (gated) return gated
  // The file itself, uploaded here
  const sentType = (req.headers.get('content-type') ?? '').split(';')[0].trim()
  if (TYPES[sentType]) {
    const buf = Buffer.from(await req.arrayBuffer())
    if (!buf.length) return jsonPrivate({ error: 'Empty file' }, { status: 400 })
    if (buf.length > MAX_DIRECT_BYTES) return jsonPrivate({ error: 'File too large' }, { status: 413 })
    const kindQ = req.nextUrl.searchParams.get('kind') ?? 'layer'
    const kind = ['layer', 'mask', 'thumb', 'export', 'ai'].includes(kindQ) ? kindQ : 'layer'
    const key = userKey(user.id, `image-studio/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${TYPES[sentType]}`)
    return jsonPrivate({ url: await uploadToR2(key, buf, sentType) })
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = typeof body.type === 'string' && TYPES[body.type] ? body.type : 'image/png'
  const kind = ['layer', 'mask', 'thumb', 'export', 'ai'].includes(String(body.kind)) ? String(body.kind) : 'layer'
  const key = userKey(user.id, `image-studio/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${TYPES[type]}`)
  const { uploadUrl, publicUrl } = await presignPutUrl(key, type, 900)
  return jsonPrivate({ uploadUrl, url: publicUrl })
}
