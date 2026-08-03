import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { uploadToR2 } from '@/lib/r2'

// POST /api/upload-video-media — video-panel media uploads (start/end frames,
// reference images/videos/audio, motion + lipsync sources) THROUGH THE SERVER.
// The old path presigned a direct browser→R2 PUT, which the R2 bucket's CORS
// policy blocks (same root cause as the home-cards upload bug) — uploads hung
// with Safari's "Load failed". The server streams the bytes to R2 instead.

export const runtime = 'nodejs'
export const maxDuration = 300 // reference videos can be sizable

const MAX_BYTES = 100 * 1024 * 1024 // matches Vercel's current request-body ceiling

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const user = await getUserFromSession(token)
    if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 100MB)' }, { status: 413 })

    const raw = file.type || 'application/octet-stream'
    const ok = raw.startsWith('image/') || raw.startsWith('video/') || raw.startsWith('audio/')
    if (!ok) return NextResponse.json({ error: 'Only image, video or audio files are allowed' }, { status: 400 })

    // Normalize the awkward MIME types (same mapping as the old presign route)
    const mime = raw === 'video/quicktime' ? 'video/mp4' : raw
    const ext = (mime.split('/')[1] || 'bin')
      .replace('jpeg', 'jpg')
      .replace('mpeg', 'mp3')
      .replace('x-m4v', 'mp4')
      .replace('x-matroska', 'webm')
      .replace('x-m4a', 'm4a')

    const buffer = Buffer.from(await file.arrayBuffer())
    const key = `admin-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const url = await uploadToR2(key, buffer, mime)
    return NextResponse.json({ url })
  } catch (error: any) {
    console.error('upload-video-media error:', error)
    return NextResponse.json({ error: error?.message || 'Upload failed' }, { status: 500 })
  }
}
