import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { presignPutUrl } from '@/lib/r2'
import { signMediaUrl } from '@/lib/media-url'

/**
 * POST /api/upload-video-media/presign - a direct browser -> R2 upload for the
 * video panel's media (motion / lip-sync sources, reference clips, frames).
 *
 * Body: { contentType, size, name? }
 * Returns: { uploadUrl, contentType, url }   PUT the file to uploadUrl with
 *          exactly that Content-Type; `url` is the signed link to it
 *
 * Why: /api/upload-video-media streams the file THROUGH the server, and Vercel
 * refuses request bodies over ~4.5 MB - an 18-second phone clip failed there
 * and the panel sat on "uploading" forever. The bucket's CORS now allows PUT
 * from our origins (checked 2026-10-08 for localhost and production), so big
 * files go straight to storage; the server route stays for small files and as
 * the fallback.
 */
export const runtime = 'nodejs'

const MAX_BYTES = 500 * 1024 * 1024
const EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'mp4', 'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { contentType?: unknown; size?: unknown }
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    const size = typeof body.size === 'number' ? body.size : 0
    if (!(contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType.startsWith('image/'))) {
      return NextResponse.json({ error: 'Only image, video or audio files are allowed' }, { status: 400 })
    }
    if (size <= 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 500MB)' }, { status: 413 })

    // A QuickTime clip (iPhone) is stored as MP4, as the server route always stored it
    const putType = contentType === 'video/quicktime' ? 'video/mp4' : contentType
    const ext = EXT[putType] ?? (putType.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '')
    const key = `admin-upload-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { uploadUrl, publicUrl } = await presignPutUrl(key, putType, 15 * 60)
    // Plain JSON: the upload link must reach the browser exactly as signed (url is signed already)
    return NextResponse.json({ uploadUrl, contentType: putType, url: signMediaUrl(publicUrl) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error: any) {
    console.error('upload-video-media presign error:', error)
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 })
  }
}
