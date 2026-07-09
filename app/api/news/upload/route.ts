import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { checkAuth } from '@/lib/admin-auth'

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
]


export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, GIF, WebP, MP4, or WebM.' }, { status: 400 })
    }

    const isVideo = file.type.startsWith('video/')
    const maxSize = isVideo ? 200 * 1024 * 1024 : 40 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({ error: `File too large (max ${isVideo ? '200MB' : '40MB'})` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filename = `news/${Date.now()}-${safeName}`

    const url = await uploadToR2(filename, buffer, file.type)

    return NextResponse.json({ url })
  } catch (err) {
    console.error('POST /api/news/upload error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
