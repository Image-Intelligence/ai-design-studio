import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { uploadToR2 } from '@/lib/r2'
import { signMediaUrl } from '@/lib/media-url'
import sharp from 'sharp'
import { fetchMedia } from '@/lib/media-fetch'
import { ensureDisplayImage } from '@/lib/display-image'
import { makeVideoPoster, VIDEO_URL_RE } from '@/lib/video-poster'


// Authenticated image proxy — serves a user's image by DB ID.
// The direct Vercel Blob URL is never exposed to the browser.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return new NextResponse('Unauthorized', { status: 401 })

    const user = await getUserFromSession(token)
    if (!user) return new NextResponse('Unauthorized', { status: 401 })

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) return new NextResponse('Invalid ID', { status: 400 })

    // Only serve images that belong to this user and are not deleted
    const image = await prisma.generatedImage.findFirst({
      where: { id, userId: user.id, isDeleted: false },
      select: { imageUrl: true, thumbnailUrl: true, videoMetadata: true },
    })

    if (!image) return new NextResponse('Not found', { status: 404 })

    const searchParams = new URL(request.url).searchParams
    const isDownload = searchParams.get('download') === '1'
    const isThumb = searchParams.get('thumb') === '1'
    const isDisplay = searchParams.get('display') === '1'

    if (isDisplay) {
      // The screen-sized copy (lib/display-image.ts): made on first request,
      // then a redirect to the stored file. Anything without one (a video) gets
      // the original.
      const vm = (image.videoMetadata ?? {}) as Record<string, unknown>
      const displayUrl = typeof vm.displayUrl === 'string' ? vm.displayUrl : await ensureDisplayImage(id)
      const res = NextResponse.redirect(signMediaUrl(displayUrl ?? image.imageUrl), 302)
      // The redirect itself may be cached briefly; the signature inside lasts far longer.
      res.headers.set('Cache-Control', 'private, max-age=3600')
      return res
    }

    if (isThumb) {
      // Fast path: a thumbnail was already generated and stored on public R2 — the
      // feed normally uses that URL directly, but if this route is hit, redirect to it
      // (no full-image download, no resize).
      if (image.thumbnailUrl) {
        // Signed, not raw: the stored URL points at a bucket that no longer
        // answers to anonymous callers. Ownership was checked above.
        return NextResponse.redirect(signMediaUrl(image.thumbnailUrl), 302)
      }
      // A video has no picture for sharp to shrink: its still is the first
      // frame, pulled out with ffmpeg (lib/video-poster) and stored the same way
      const vmeta = (image.videoMetadata ?? {}) as Record<string, unknown>
      if (vmeta.isVideo === true || VIDEO_URL_RE.test(image.imageUrl)) {
        const poster = await makeVideoPoster(image.imageUrl).catch(() => null)
        if (poster === 'busy') return new NextResponse('Poster queued', { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } })
        if (!poster) return new NextResponse('Poster unavailable', { status: 502 })
        try {
          const thumbUrl = await uploadToR2(`thumb/${id}-${Date.now()}.webp`, poster, 'image/webp')
          // The poster is the first frame at the video's own shape: keep that
          // shape (aspectW/aspectH - a ratio, not the video's resolution) so the
          // feed can size the tile before anything loads
          let shape: { aspectW: number; aspectH: number } | null = null
          try {
            const m = await sharp(poster).metadata()
            if (m.width && m.height) shape = { aspectW: m.width, aspectH: m.height }
          } catch { /* no shape - the tile measures itself */ }
          await prisma.generatedImage.update({
            where: { id },
            data: { thumbnailUrl: thumbUrl, ...(shape ? { videoMetadata: { ...vmeta, ...shape } as object } : {}) },
          })
        } catch (storeErr) {
          console.error('Video poster store failed (non-fatal):', storeErr)
        }
        return new NextResponse(new Uint8Array(poster), { status: 200, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' } })
      }
      // First view of this image — generate the thumbnail once, store it on R2 so
      // every future request (this route or the direct URL) is a cheap CDN-served file.
      const blobRes = await fetchMedia(image.imageUrl)
      if (!blobRes.ok) return new NextResponse('Image unavailable', { status: 404 })
      const buffer = Buffer.from(await blobRes.arrayBuffer())
      const thumb = await sharp(buffer)
        .resize({ width: 600, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer()
      // Persist for next time (best-effort — on failure we simply regenerate later)
      try {
        const thumbUrl = await uploadToR2(`thumb/${id}-${Date.now()}.webp`, Buffer.from(thumb), 'image/webp')
        await prisma.generatedImage.update({ where: { id }, data: { thumbnailUrl: thumbUrl } })
      } catch (storeErr) {
        console.error('Thumbnail store failed (non-fatal):', storeErr)
      }
      return new NextResponse(new Uint8Array(thumb), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, max-age=86400',
        },
      })
    }

    // Full image / download
    const blobRes = await fetchMedia(image.imageUrl)
    if (!blobRes.ok) return new NextResponse('Image unavailable', { status: 404 })
    const contentType = blobRes.headers.get('content-type') || 'image/png'
    // Audio first: 'audio/mp4' (m4a) would otherwise match the video 'mp4' test
    const audioExt = (image.imageUrl.split('?')[0].match(/\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i)?.[1]
      ?? (contentType.startsWith('audio/') ? ({ 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg' } as Record<string, string>)[contentType.split(';')[0]] ?? 'mp3' : null))?.toLowerCase()
    const ext = audioExt ? audioExt
              : contentType.includes('svg') || /\.svg(\?|#|$)/i.test(image.imageUrl) ? 'svg'
              : contentType.includes('jpeg') ? 'jpg'
              : contentType.includes('webp') ? 'webp'
              : contentType.includes('mp4')  ? 'mp4'
              : contentType.includes('webm') ? 'webm'
              : contentType.includes('video') ? 'mp4'
              : 'png'

    const headers: HeadersInit = {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    }

    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${audioExt ? 'audio' : 'image'}-${id}.${ext}"`
    }

    return new NextResponse(blobRes.body, { status: 200, headers })
  } catch (error) {
    console.error('Image proxy error:', error)
    return new NextResponse('Server error', { status: 500 })
  }
}
