import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import sharp from 'sharp'


// Admin thumbnail endpoint — accepts ?id=<imageId> and returns a resized WebP.
// Protected only by the admin page gate (same pattern as other admin API routes).
export async function GET(request: NextRequest) {
  try {
    const id = parseInt(request.nextUrl.searchParams.get('id') || '')
    if (isNaN(id)) return new NextResponse('Invalid ID', { status: 400 })

    const image = await prisma.generatedImage.findFirst({
      where: { id, isDeleted: false },
      select: { imageUrl: true },
    })

    if (!image) return new NextResponse('Not found', { status: 404 })

    const blobRes = await fetch(image.imageUrl)
    if (!blobRes.ok) return new NextResponse('Image unavailable', { status: 404 })

    const buffer = Buffer.from(await blobRes.arrayBuffer())
    const thumb = await sharp(buffer)
      .resize({ width: 600, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()

    return new NextResponse(new Uint8Array(thumb), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Admin thumb error:', error)
    return new NextResponse('Server error', { status: 500 })
  }
}
