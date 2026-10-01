import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { signMediaUrl } from '@/lib/media-url'

/*
 * A still for a video: the frame a feed tile shows while it isn't playing.
 *
 * The video feed only mounts a <video> for the few tiles that hold a playback
 * turn (see components/home/card-video-scheduler.ts); every other tile is an
 * <img>. Most video rows already carry a poster image, but a few hundred carry
 * none - or "the poster" is the mp4 itself - so this makes one from the video.
 *
 * The frame is taken from the very start (not the middle, as the dataset
 * posters are) because the tile crossfades from this still into the video
 * playing from 0: a start frame makes that handoff seamless.
 *
 * ffmpeg reads the signed URL directly with a fast seek, so the file is never
 * downloaded whole. Only a couple run at once - a feed asks for dozens of
 * stills in one go, and fifty ffmpeg runs fighting for the CPU all time out
 * (the same lesson as /api/admin/dataset/thumb). Any route importing this must
 * be listed in next.config.ts `outputFileTracingIncludes`, or the ffmpeg binary
 * won't ship to Vercel.
 */
const execP = promisify(execFile)

const MAX_CONCURRENT = 2
/** How long a request waits for a slot before the caller is told to retry. */
const SLOT_WAIT_MS = 20_000

let active = 0
const queue: (() => void)[] = []

function acquire(): Promise<boolean> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(true) }
  return new Promise<boolean>(resolve => {
    let settled = false
    const grant = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      active++
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const i = queue.indexOf(grant)
      if (i >= 0) queue.splice(i, 1)
      resolve(false)
    }, SLOT_WAIT_MS)
    queue.push(grant)
  })
}

function release() {
  active = Math.max(0, active - 1)
  queue.shift()?.()
}

export const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i

/**
 * A 600px webp of the video's first frame (the feed thumbnail recipe), or
 * 'busy' when every slot stayed taken - the caller answers 503 + Retry-After.
 */
export async function makeVideoPoster(videoUrl: string): Promise<Buffer | 'busy'> {
  if (!(await acquire())) return 'busy'
  let dir: string | null = null
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'pv-poster-'))
    const outJpg = path.join(dir, 'poster.jpg')
    await execP(ffmpegPath as string, [
      '-hide_banner', '-y',
      // A hair past 0: some encoders put a black or grey frame at exactly 0
      '-ss', '0.05',
      '-i', signMediaUrl(videoUrl, 600),
      '-frames:v', '1',
      '-q:v', '3',
      outJpg,
    ], { timeout: 45_000 })
    return await sharp(await readFile(outJpg)).resize({ width: 600, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer()
  } finally {
    release()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
