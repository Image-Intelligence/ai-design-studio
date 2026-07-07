import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import JSZip from 'jszip'


// Server-side zip builder — moves all image fetching + JSZip memory off the
// client (critical for iPad Safari, which crashes when 60+ images accumulate
// in the JS heap before generateAsync runs).
//
// GET /api/images/zip?ids=1,2,3,...
export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return new NextResponse('Unauthorized', { status: 401 })

  const user = await getUserFromSession(token)
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const idsParam = searchParams.get('ids') ?? ''
  const ids = idsParam
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }
  if (ids.length > 300) {
    return NextResponse.json({ error: 'Too many ids (max 300)' }, { status: 400 })
  }

  // Only return files that belong to this user
  const images = await prisma.generatedImage.findMany({
    where: { id: { in: ids }, userId: user.id },
    select: { id: true, imageUrl: true },
  })

  const zip = new JSZip()

  const BATCH = 8
  for (let i = 0; i < images.length; i += BATCH) {
    await Promise.all(
      images.slice(i, i + BATCH).map(async (img) => {
        try {
          const res = await fetch(img.imageUrl, {
            signal: AbortSignal.timeout(20000),
          })
          if (!res.ok) return
          const buf = await res.arrayBuffer()
          const ct = res.headers.get('content-type') ?? ''
          const url = img.imageUrl
          const ext =
            /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? 'mp4'
            : ct.includes('mp4') || ct.includes('video/mp4') ? 'mp4'
            : ct.includes('webm') ? 'webm'
            : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg'
            : ct.includes('webp') ? 'webp'
            : 'png'
          zip.file(`file-${img.id}.${ext}`, buf)
        } catch {
          // Skip files that fail — don't abort the whole zip
        }
      })
    )
  }

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

  // Cast via Uint8Array — Buffer extends Uint8Array (ArrayBufferView / BodyInit)
  // but TypeScript's dom lib doesn't always resolve the generic form cleanly.
  return new NextResponse(new Uint8Array(zipBuf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="selections-${Date.now()}.zip"`,
      'Content-Length': String(zipBuf.byteLength),
    },
  })
}
