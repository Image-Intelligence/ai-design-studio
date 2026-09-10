import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { probeDuration } from '@/lib/video-clip'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

export const maxDuration = 60
const execP = promisify(execFile)

const THUMB_CACHE = 'public, max-age=604800, s-maxage=604800, immutable'

/**
 * Only a couple of video posters may be made at once.
 *
 * A grid asks for fifty thumbnails the moment a bucket opens. Where the source
 * is video there is no stored thumbnail until someone has looked at it, so
 * every one of those fifty starts an ffmpeg run — measured at 2.6 to 7.1
 * seconds each. They contend for CPU, a good number exceed the timeout, and a
 * request that timed out never reached the write-behind that would have saved
 * its result. So nothing was cached and reopening the bucket failed
 * identically. That is why a bucket of videos would never load.
 *
 * Queueing them is faster in wall-clock terms as well as more reliable: two
 * ffmpeg runs at full speed beat fifty fighting each other.
 */
const MAX_CONCURRENT_POSTERS = 2
/** How long a request waits for a slot before telling the client to retry. */
const SLOT_WAIT_MS = 20_000

let activePosters = 0
const posterQueue: (() => void)[] = []

function acquirePosterSlot(): Promise<boolean> {
  if (activePosters < MAX_CONCURRENT_POSTERS) {
    activePosters++
    return Promise.resolve(true)
  }
  return new Promise<boolean>(resolve => {
    let settled = false
    const grant = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activePosters++
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const i = posterQueue.indexOf(grant)
      if (i >= 0) posterQueue.splice(i, 1)
      resolve(false)
    }, SLOT_WAIT_MS)
    posterQueue.push(grant)
  })
}

function releasePosterSlot() {
  activePosters = Math.max(0, activePosters - 1)
  posterQueue.shift()?.()
}

/** Persist a thumbnail after responding, so the cost is paid once per image ever. */
function persist(imageId: number, thumb: Buffer) {
  after(async () => {
    try {
      const url = await uploadToR2(`thumbnails/dataset/${imageId}.webp`, thumb, 'image/webp')
      await prisma.generatedImage.update({ where: { id: imageId }, data: { thumbnailUrl: url } })
    } catch { /* best effort — the next request simply regenerates */ }
  })
}

const toThumb = (buf: Buffer) =>
  sharp(buf).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()

/**
 * Pull a frame out of a video and serve it.
 *
 * ffmpeg reads the remote URL directly with a fast seek, so the whole file is
 * never downloaded.
 */
async function makePoster(imageId: number, videoUrl: string): Promise<NextResponse> {
  if (!(await acquirePosterSlot())) {
    // Not a failure, just busy. Retry-After tells the tile to come back rather
    // than give up and show a broken thumbnail for ever.
    return new NextResponse('Poster queued', {
      status: 503,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    })
  }

  let dir: string | null = null
  try {
    const dur = await probeDuration(videoUrl)
    const at = dur && dur > 0.4 ? dur / 2 : 0
    dir = await mkdtemp(path.join(tmpdir(), 'ds-thumb-'))
    const outJpg = path.join(dir, 'poster.jpg')
    await execP(ffmpegPath as string, [
      '-hide_banner', '-y',
      '-ss', at.toFixed(3),
      '-i', videoUrl,
      '-frames:v', '1',
      '-q:v', '3',
      outJpg,
    ], { timeout: 45_000 })

    const thumb = await toThumb(await readFile(outJpg))
    persist(imageId, thumb)
    return new NextResponse(new Uint8Array(thumb), {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': THUMB_CACHE },
    })
  } catch (err) {
    console.error('Dataset video-thumb error:', err instanceof Error ? err.message : err)
    return new NextResponse('Poster generation failed', { status: 502 })
  } finally {
    releasePosterSlot()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// GET /api/admin/dataset/thumb/[id]
// Serves a 400px webp thumbnail for a dataset image.
// Public (no auth) — dataset images are on a public R2 bucket anyway.
// 7-day immutable browser cache so grid loads are instant on repeat visits.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
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

  /*
   * Videos: use the recorded poster when there is one and it still resolves,
   * otherwise make one from the video itself.
   *
   * The fallback is the important half. Thirteen videos in this dataset carry
   * a poster URL pointing at a Vercel Blob store that was torn down, and every
   * one of them 404s. The route used to trust that URL, fetch it, get a 404
   * and return "Image unavailable" — so those tiles were broken permanently
   * even though the source video was fine and a poster could be made from it
   * in about two seconds. A dead pointer is not a reason to give up on a file
   * we still have.
   */
  const isVideoSource = /\.(mp4|webm|mov|avi|mkv)$/i.test(image.imageUrl)
  const recorded = (image.videoMetadata as Record<string, unknown> | null)?.thumbnailUrl
  const posterUrl =
    isVideoSource && typeof recorded === 'string' && /^https?:\/\//.test(recorded)
      ? recorded
      : null

  if (isVideoSource && !posterUrl) return makePoster(imageId, image.imageUrl)

  const srcUrl = posterUrl ?? image.imageUrl
  try {
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      // The recorded poster is gone; the video it came from is not.
      if (posterUrl) return makePoster(imageId, image.imageUrl)
      return new NextResponse('Image unavailable', { status: 502 })
    }

    const thumb = await toThumb(Buffer.from(await res.arrayBuffer()))
    persist(imageId, thumb)
    return new NextResponse(new Uint8Array(thumb), {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': THUMB_CACHE },
    })
  } catch (err: any) {
    // A dead poster that times out rather than 404s lands here too.
    if (posterUrl) return makePoster(imageId, image.imageUrl)
    console.error('Dataset thumb error:', err?.message)
    return new NextResponse('Server error', { status: 500 })
  }
}
