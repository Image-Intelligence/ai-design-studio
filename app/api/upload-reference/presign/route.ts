import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { presignPutUrl, userKey } from '@/lib/r2'
import { signMediaUrl } from '@/lib/media-url'
import { requireIdVerified } from '@/lib/id-verification'
import { withDbRetry } from '@/lib/db-retry'

/**
 * POST /api/upload-reference/presign - a reference picture straight from the
 * browser to storage (2026-10-12).
 *
 * Body: { contentType, size }
 * Returns: { uploadUrl, contentType, url }   PUT the file to uploadUrl with
 *          exactly that Content-Type; `url` is the signed link to it
 *
 * /api/upload-reference sends every file THROUGH the server: twice the trip,
 * and on Vercel a request body over ~4.5 MB is refused outright - while the
 * library keeps originals up to 10 MB untouched. The bucket's CORS allows PUT
 * from localhost and production (not a LAN address - the iPad on the dev
 * server falls back to the server route). Same key shape as the server
 * route's (u/<user>/reference-...), so ownership checks read it the same.
 */
export const runtime = 'nodejs'

const MAX_BYTES = 15 * 1024 * 1024 // the server route's cap
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await withDbRetry(() => getUserFromSession(token), 3, 'ref presign') : null
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    // Uploads only from ID-verified accounts (CCBill; admins exempt - lib/id-verification)
    const idGate = await requireIdVerified(user)
    if (idGate) return idGate

    const body = await req.json().catch(() => ({})) as { contentType?: unknown; size?: unknown }
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    const size = typeof body.size === 'number' ? body.size : 0
    const ext = EXT[contentType]
    if (!ext) return NextResponse.json({ error: 'Only JPG, PNG or WebP pictures' }, { status: 400 })
    if (size <= 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 15MB)' }, { status: 413 })

    const key = userKey(user.id, `reference-${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${ext}`)
    const { uploadUrl, publicUrl } = await presignPutUrl(key, contentType, 15 * 60)
    return NextResponse.json({ uploadUrl, contentType, url: signMediaUrl(publicUrl) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error: any) {
    console.error('upload-reference presign error:', error)
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 })
  }
}
