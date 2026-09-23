import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { fetchMedia } from '@/lib/media-fetch'

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
    return row.thumbnailUrl ? 'had' : 'made'
  } catch {
    return 'failed'
  }
}
