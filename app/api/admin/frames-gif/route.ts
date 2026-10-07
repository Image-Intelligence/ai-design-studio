import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { checkAuth } from '@/lib/admin-auth'
import { gifToMp4 } from '@/lib/video-clip'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { fetchMedia } from '@/lib/media-fetch'

// POST /api/admin/frames-gif — any signed-in account (the Frame Extractor is
// public since 2026-10-07; it was admin-only)
// Frame Extractor GIF support: browsers cannot seek GIFs in a <video>
// element (and iPad Safari has no ImageDecoder), so the popup posts the raw
// GIF bytes here, ffmpeg converts to a transient MP4, and the client runs
// its normal on-device extraction on the returned clip. Nothing is stored —
// the temp dir is deleted before the response leaves.

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_GIF_BYTES = 80 * 1024 * 1024

export async function POST(req: Request) {
  // Any signed-in account (the Frame Extractor is public), or the
  // x-admin-password header (admin tooling/scripts)
  const tooling = checkAuth(req as unknown as import('next/server').NextRequest)
  const token = tooling ? null : (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!tooling && !user) return NextResponse.json({ error: 'Sign in to use the Frame Extractor' }, { status: 401 })
  const admin = tooling || (!!user && (await checkIsAdmin(user.email)))

  let dir: string | null = null
  try {
    // Two input modes:
    //   application/json { url }  → server fetches from our own R2 (preferred:
    //                               the client never downloads the GIF at all)
    //   raw body                  → legacy direct upload from the file picker
    let buf: Buffer
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const { url } = await req.json().catch(() => ({ url: '' }))
      const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
      if (typeof url !== 'string' || !publicBase || !url.startsWith(`${publicBase}/`)) {
        return NextResponse.json({ error: 'url must point at our own storage' }, { status: 400 })
      }
      // An account's own files only (its uploads, or the extractor's scratch
      // space) - the bucket is private, and this would read any object in it
      if (!admin && !(user && url.startsWith(`${publicBase}/u/${user.id}/`)) && !url.startsWith(`${publicBase}/frames-tmp/`)) {
        return NextResponse.json({ error: 'url must be one of your own uploads' }, { status: 403 })
      }
      const src = await fetchMedia(url)
      if (!src.ok) return NextResponse.json({ error: `Source fetch failed (${src.status})` }, { status: 502 })
      const len = Number(src.headers.get('content-length') || 0)
      if (len > MAX_GIF_BYTES) return NextResponse.json({ error: 'GIF too large (max 80MB)' }, { status: 413 })
      buf = Buffer.from(await src.arrayBuffer())
    } else {
      buf = Buffer.from(await req.arrayBuffer())
    }
    if (buf.length < 100) return NextResponse.json({ error: 'Empty upload' }, { status: 400 })
    if (buf.length > MAX_GIF_BYTES) return NextResponse.json({ error: 'GIF too large (max 80MB)' }, { status: 413 })
    // GIF magic: GIF87a / GIF89a
    if (!(buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)) {
      return NextResponse.json({ error: 'Not a GIF file' }, { status: 400 })
    }

    dir = await mkdtemp(path.join(tmpdir(), 'frames-gif-'))
    const inFile = path.join(dir, 'in.gif')
    const outFile = path.join(dir, 'out.mp4')
    await writeFile(inFile, buf)
    await gifToMp4(inFile, outFile)
    const mp4 = await readFile(outFile)

    return new NextResponse(new Uint8Array(mp4), {
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
        'Content-Length': String(mp4.length),
      },
    })
  } catch (err: unknown) {
    console.error('frames-gif conversion error:', err)
    return NextResponse.json({ error: 'GIF conversion failed — try re-exporting the GIF' }, { status: 500 })
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
