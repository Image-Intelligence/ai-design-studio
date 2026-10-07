import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { fetchMedia } from '@/lib/media-fetch'

/**
 * A screen-sized copy of a generated image, for showing it large: the home
 * page slideshow first of all.
 *
 * Originals are mostly 3712x4608 PNGs of about 20MB (measured: 16-24MB each).
 * The slideshow drew those directly, so a Gallery page of three portraits was
 * a 60MB download and three 17-megapixel decodes; at normal speed the next
 * page was often not there in time, and over a long run the decoded images
 * piled up in memory. The 600px thumbnail is too soft to show full screen.
 *
 * This is the size in between: 2048px on the long side, WebP, typically a few
 * hundred KB - sharp on any screen up to 4K at slideshow sizes. Made once, on
 * first request, stored on R2, and its URL kept in videoMetadata.displayUrl
 * (the JSON column images already use for their pixel size), so every later
 * view is a plain file. Videos have no display copy; callers use the video.
 */

export const DISPLAY_LONG_SIDE = 2048

// Two requests for the same image at once (a preload and a draw) share one job.
const running = new Map<number, Promise<string | null>>()

/** `source`: the original's bytes when the caller already has them (a save
 *  that just made the thumbnail), so a 20MB file is not downloaded twice. */
export function ensureDisplayImage(id: number, source?: Buffer): Promise<string | null> {
  const existing = running.get(id)
  if (existing) return existing
  const job = make(id, source).finally(() => running.delete(id))
  running.set(id, job)
  return job
}

async function make(id: number, source?: Buffer): Promise<string | null> {
  const row = await prisma.generatedImage.findUnique({
    where: { id },
    select: { imageUrl: true, videoMetadata: true },
  })
  if (!row) return null
  const vm = (row.videoMetadata ?? {}) as Record<string, unknown>
  if (typeof vm.displayUrl === 'string') return vm.displayUrl
  if (vm.isVideo === true || /\.(mp4|webm|mov|m4v|glb|gltf|zip)(\?|#|$)/i.test(row.imageUrl)) return null

  let buffer = source
  if (!buffer) {
    const res = await fetchMedia(row.imageUrl, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    buffer = Buffer.from(await res.arrayBuffer())
  }
  const sharp = (await import('sharp')).default
  const out = await sharp(buffer)
    .resize({ width: DISPLAY_LONG_SIDE, height: DISPLAY_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  const url = await uploadToR2(`display/${id}-${Date.now()}.webp`, out, 'image/webp')
  // Merge into the JSON in the database, not from the copy read above, so a
  // concurrent write to another key (a thumbnail backfill's width/height) survives.
  await prisma.$executeRaw`
    UPDATE "GeneratedImage"
    SET "videoMetadata" = COALESCE("videoMetadata", '{}'::jsonb) || jsonb_build_object('displayUrl', ${url}::text)
    WHERE id = ${id}`
  return url
}

/*
 * Background builds, two at a time. A feed in Full Size mode asks for a
 * display copy per tile; images saved before copies were made at save time
 * have none, and building one is a full download (~20MB) plus a resize - about
 * 17s on the dev machine. Forty tiles asking at once, each waiting on its own
 * build, left the whole feed blank. Tiles now get the thumbnail at once and
 * the copy is built here, in the background, for the next view.
 */
const MAX_BACKGROUND = 2
let active = 0
const waiting: (() => void)[] = []
const queued = new Set<number>()

export async function queueDisplayImage(id: number): Promise<void> {
  if (queued.has(id) || running.has(id) || queued.size > 300) return
  queued.add(id)
  try {
    if (active >= MAX_BACKGROUND) await new Promise<void>(r => waiting.push(r))
    active++
    try { await ensureDisplayImage(id) } catch { /* best-effort - asked again next view */ }
    finally { active--; waiting.shift()?.() }
  } finally {
    queued.delete(id)
  }
}
