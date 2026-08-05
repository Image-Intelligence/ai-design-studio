import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import sharp from 'sharp'

// GET /api/admin/dataset/thumb/[id]
// Serves a 400px webp thumbnail for a dataset image.
// Public (no auth) — dataset images are on a public R2 bucket anyway.
// 7-day immutable browser cache so grid loads are instant on repeat visits.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const imageId = parseInt(id)
  if (isNaN(imageId)) return new NextResponse('Invalid id', { status: 400 })

  const image = await prisma.generatedImage.findFirst({
    where: { id: imageId, isDeleted: false },
    select: { imageUrl: true, videoMetadata: true, thumbnailUrl: true },
  })

  if (!image) return new NextResponse('Not found', { status: 404 })

  // A stored R2 thumb already exists → redirect straight to it. The browser
  // caches the redirect and fetches from R2/CDN — zero server work.
  if (image.thumbnailUrl && /^https?:\/\//.test(image.thumbnailUrl)) {
    return NextResponse.redirect(image.thumbnailUrl, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=604800' },
    })
  }

  // Videos: serve the recorded poster thumbnail when one exists (video items
  // otherwise render as broken "?" tiles in the composer grids)
  let srcUrl = image.imageUrl
  if (/\.(mp4|webm|mov|avi|mkv)$/i.test(srcUrl)) {
    const poster = (image.videoMetadata as Record<string, unknown> | null)?.thumbnailUrl
    if (typeof poster === 'string' && /^https?:\/\//.test(poster)) srcUrl = poster
    else return new NextResponse('Not an image', { status: 404 })
  }

  try {
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return new NextResponse('Image unavailable', { status: 502 })

    const buffer = Buffer.from(await res.arrayBuffer())
    const thumb = await sharp(buffer)
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    // Write-behind: persist the thumb to R2 + record thumbnailUrl, so the
    // fetch-original + resize cost is paid ONCE per image EVER. Every future
    // load (composer grids, feeds, this endpoint via the redirect above) then
    // hits R2 directly — this is what was saturating the dev server when a
    // hundred tiles requested thumbs at once.
    after(async () => {
      try {
        const url = await uploadToR2(`thumbnails/dataset/${imageId}.webp`, thumb, 'image/webp')
        await prisma.generatedImage.update({ where: { id: imageId }, data: { thumbnailUrl: url } })
      } catch { /* best effort — next request just regenerates */ }
    })

    return new NextResponse(new Uint8Array(thumb), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        // 7-day immutable cache — thumbnails never change for a given image ID.
        // s-maxage lets the Vercel edge cache serve them too, so only the FIRST
        // viewer ever pays the fetch+resize cost per image.
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
      },
    })
  } catch (err: any) {
    console.error('Dataset thumb error:', err.message)
    return new NextResponse('Server error', { status: 500 })
  }
}
