import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { uploadToR2 } from '@/lib/r2'

export const maxDuration = 60

// POST /api/user/ref-layer-upload — host an inserted layer image on R2.
// Body: { image: <data URL> } → { url }. Layer stacks only store https URLs
// (same rule as the reference library), so client-picked files land here first.
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const image: string = typeof body?.image === 'string' ? body.image : ''
    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'image must be a data URL' }, { status: 400 })
    }
    // ~15MB decoded cap
    if (image.length > 20_000_000) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 })
    }

    const mimeType = image.split(';')[0].replace('data:', '') || 'image/png'
    const base64 = image.split(',')[1] || ''
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length < 100) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })

    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadToR2(`ref-layers/${user.id}-${Date.now()}.${ext}`, buffer, mimeType)
    return NextResponse.json({ url })
  } catch (error) {
    console.error('ref-layer-upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
