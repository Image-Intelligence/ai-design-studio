import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { fetchMedia } from '@/lib/media-fetch'
import { DISPLAY_LONG_SIDE, ensureDisplayImage } from '@/lib/display-image'

const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i
// Meshes and archives have no picture in them to thumbnail.
const MESH_RE = /\.(glb|gltf|obj|fbx|stl|usdz|zip)(\?|#|$)/i

/**
 * Give a saved image its thumbnail and its real dimensions.
 *
 * Nothing that saves an image made a thumbnail. The proxy made one lazily on
 * the tile's first view - a full-size download and resize on the request path,
 * which after a batch of a hundred and sixty-five is a hundred and sixty-five
 * of those, on the dev server, while the feed is trying to draw. Doing it at
 * save time, off the request path, means the first view is a cached webp.
 *
 * The dimensions matter as much as the thumbnail. A tile reserves its height
 * from the aspect ratio it was asked for, and "auto" reserves a square - so an
 * auto-aspect portrait grows when its image lands and pushes everything below
 * it down. With width and height recorded, the tile reserves the exact shape
 * and nothing moves.
 *
 * Idempotent and best-effort: a row that already has a thumbnail is left
 * alone, a video is skipped, and a failure changes nothing.
 */
export async function ensureThumbnail(imageId: number): Promise<'made' | 'had' | 'skipped' | 'failed'> {
  try {
    const row = await prisma.generatedImage.findUnique({
      where: { id: imageId },
      select: { imageUrl: true, thumbnailUrl: true, videoMetadata: true },
    })
    if (!row) return 'skipped'
    const vm = (row.videoMetadata ?? {}) as Record<string, unknown>
    const hasDims = typeof vm.width === 'number' && typeof vm.height === 'number'
    if (row.thumbnailUrl && hasDims) return 'had'
    if (VIDEO_RE.test(row.imageUrl) || MESH_RE.test(row.imageUrl) || vm.isVideo === true) return 'skipped'

    const res = await fetchMedia(row.imageUrl, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return 'failed'
    const buffer = Buffer.from(await res.arrayBuffer())
    const sharp = (await import('sharp')).default
    const meta = await sharp(buffer).metadata()
    const width = meta.width ?? null
    const height = meta.height ?? null

    let thumbnailUrl = row.thumbnailUrl
    if (!thumbnailUrl) {
      // The proxy's recipe, so a tile looks the same whichever path made it.
      const thumb = await sharp(buffer).resize({ width: 600, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer()
      thumbnailUrl = await uploadToR2(`thumb/${imageId}-${Date.now()}.webp`, thumb, 'image/webp')
    }
    await prisma.generatedImage.update({
      where: { id: imageId },
      data: {
        thumbnailUrl,
        ...(width && height ? { videoMetadata: { ...vm, width, height } as object } : {}),
      },
    })
    // And the screen-sized copy (lib/display-image), while the original is in
    // memory: a feed in Full Size mode shows THAT, not the original - a 4K
    // NanoBanana PNG is ~20MB, its display copy a few hundred KB. Only for
    // images bigger than it; after the update above, whose videoMetadata
    // write would otherwise drop the displayUrl it merges in.
    if (typeof vm.displayUrl !== 'string' && width && height && Math.max(width, height) > DISPLAY_LONG_SIDE) {
      await ensureDisplayImage(imageId, buffer).catch(() => null)
    }
    return row.thumbnailUrl ? 'had' : 'made'
  } catch {
    return 'failed'
  }
}

/*
 * ── Variants from the bytes in hand, before the job is reported done ────────
 *
 * ensureThumbnail runs after the save (after()), downloading the original a
 * second time. The feed hears "done" first, so for a few seconds - minutes,
 * when several finish at once or the background step is cut short - a tile
 * has nothing small to show: measured 2026-10-07 on ten 4K NanoBanana 2.1
 * images, thumbnails 4-147s after the save, display copies 5-69s or never.
 * A save path calls prepareImageVariants(buffer) alongside its upload and
 * attachImageVariants(id, v) before it marks the job complete, so the first
 * time the feed sees the row its thumbnail and display copy already exist.
 */
export type ImageVariants = { thumb: Buffer; display: Buffer; width: number; height: number }

/** The thumbnail (600px wide) and display copy (2048px long side) of an image, in memory. Null for an SVG or anything sharp cannot read. */
export async function prepareImageVariants(buffer: Buffer): Promise<ImageVariants | null> {
  try {
    if (buffer.slice(0, 400).toString('utf8').trimStart().startsWith('<svg')) return null
    const sharp = (await import('sharp')).default
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) return null
    const [thumb, display] = await Promise.all([
      // The proxy's recipe (app/api/images/[id]), so every path makes the same tile
      sharp(buffer).resize({ width: 600, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
      sharp(buffer).resize({ width: DISPLAY_LONG_SIDE, height: DISPLAY_LONG_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    ])
    return { thumb, display, width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

/**
 * Store the variants and record them on the row (thumbnailUrl, and width /
 * height / displayUrl merged into videoMetadata). True when done; false means
 * the caller should fall back to ensureThumbnail in the background.
 */
export async function attachImageVariants(imageId: number, v: ImageVariants | null): Promise<boolean> {
  if (!v) return false
  try {
    const stamp = Date.now()
    const [thumbnailUrl, displayUrl] = await Promise.all([
      uploadToR2(`thumb/${imageId}-${stamp}.webp`, v.thumb, 'image/webp'),
      uploadToR2(`display/${imageId}-${stamp}.webp`, v.display, 'image/webp'),
    ])
    // Merged in the database, so metadata the save wrote (LoRA, settings) stays
    await prisma.$executeRaw`
      UPDATE "GeneratedImage"
      SET "thumbnailUrl" = ${thumbnailUrl},
          "videoMetadata" = COALESCE("videoMetadata", '{}'::jsonb)
            || jsonb_build_object('width', ${v.width}::int, 'height', ${v.height}::int, 'displayUrl', ${displayUrl}::text)
      WHERE id = ${imageId}`
    return true
  } catch {
    return false
  }
}
