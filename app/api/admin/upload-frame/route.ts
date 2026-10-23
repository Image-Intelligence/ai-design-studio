import { NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// POST /api/admin/upload-frame
// Accepts multipart FormData with a single 'file' field, uploads to R2, returns the public URL.
// Used by the portal-v2 video scanner for start/end frame, audio, and lipsync source video uploads.
export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = file.type || 'application/octet-stream'
    const ext = mimeType.split('/')[1]
      ?.replace('jpeg', 'jpg')
      .replace('mpeg', 'mp3')
      .replace('quicktime', 'mp4')
      .replace('x-m4v', 'mp4')
      .replace('x-matroska', 'webm')
      || 'bin'
    const normalizedMime = mimeType === 'video/quicktime' ? 'video/mp4' : mimeType
    const safeName = `admin-upload-${Date.now()}.${ext}`
    const url = await uploadToR2(safeName, buffer, normalizedMime)
    return NextResponse.json({ url })
  } catch (error: any) {
    console.error('Frame upload error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}
