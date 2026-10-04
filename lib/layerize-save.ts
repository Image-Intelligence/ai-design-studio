import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'

/**
 * SeeDream 5.0 Pro Layerize results, saved as ONE feed card.
 *
 * fal returns a base image (the background with the objects lifted out) and
 * up to 16 layers, each a transparent PNG CROPPED to its object and upscaled
 * (a 91x89 reflection came back 729x713), placed by a bounding box in the
 * base's pixel space. Saved the generic way, that was one tile per layer -
 * eight tiles for one image. Here the layers are kept together:
 *
 *   imageUrl       the layers stacked back in z order (each scaled into its
 *                  box) - which looks like the original, so the card reads as
 *                  the picture it came from
 *   videoMetadata  { layerize: { width, height, layers: [{ name, z, url, box, description }] } }
 *                  for the viewer's layer switcher (layers[0] is the base)
 *
 * Used by the fal webhook and the drain-queue harvest, so both save it alike.
 */
export const LAYERIZE_MODEL = 'seedream-5-pro-layerize'
/** Every Layerize (Pro and Flash) saves this way. */
export const LAYERIZE_MODELS = new Set([LAYERIZE_MODEL, 'seedream-5-flash-layerize'])

export type FalLayer = {
  image: { url: string; width?: number; height?: number }
  z_index: number
  name?: string | null
  description?: string | null
  bounding_box?: { absolute?: number[] | null } | null
}
export type SavedLayer = { name: string; z: number; url: string; box: [number, number, number, number]; description?: string }

export async function saveLayerizeResult(o: {
  userId: number
  prompt: string
  modelId: string
  falRequestId: string | null
  createdAt: Date
  ticketCost: number
  referenceImageUrls: string[]
  layers: FalLayer[]
}): Promise<{ id: number; url: string } | null> {
  const sharp = (await import('sharp')).default
  const sorted = [...o.layers].filter(l => l?.image?.url).sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))
  if (!sorted.length) return null
  const bufs = await Promise.all(sorted.map(async l => {
    const r = await fetch(l.image.url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`layer ${l.z_index} fetch ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }))
  const baseMeta = await sharp(bufs[0]).metadata()
  const W = baseMeta.width ?? 1024, H = baseMeta.height ?? 1024

  // Each layer back into its box, in z order: the stack is the original
  const overlays: { input: Buffer; left: number; top: number }[] = []
  const boxes: [number, number, number, number][] = [[0, 0, W, H]]
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i].bounding_box?.absolute
    let box: [number, number, number, number] = [0, 0, W, H]
    if (Array.isArray(a) && a.length === 4) {
      const x1 = Math.max(0, Math.min(W - 1, Math.round(a[0]))), y1 = Math.max(0, Math.min(H - 1, Math.round(a[1])))
      const x2 = Math.max(x1 + 1, Math.min(W, Math.round(a[2]))), y2 = Math.max(y1 + 1, Math.min(H, Math.round(a[3])))
      box = [x1, y1, x2, y2]
    }
    boxes.push(box)
    const input = await sharp(bufs[i]).resize(box[2] - box[0], box[3] - box[1], { fit: 'fill' }).png().toBuffer()
    overlays.push({ input, left: box[0], top: box[1] })
  }
  const composite = await sharp(bufs[0]).composite(overlays).png().toBuffer()

  const stamp = `${o.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const [url, ...layerUrls] = await Promise.all([
    uploadToR2(`layerize-${stamp}.png`, composite, 'image/png'),
    ...bufs.map((b, i) => uploadToR2(`layerize-${stamp}-L${i}.png`, b, 'image/png')),
  ])
  const layers: SavedLayer[] = sorted.map((l, i) => ({
    name: i === 0 ? 'Background' : (l.name?.trim() || `Layer ${i}`),
    z: l.z_index ?? i,
    url: layerUrls[i],
    box: boxes[i],
    ...(l.description ? { description: String(l.description).slice(0, 300) } : {}),
  }))

  const row = await prisma.generatedImage.create({
    data: {
      createdAt: o.createdAt,
      userId: o.userId,
      prompt: o.prompt,
      imageUrl: url,
      model: o.modelId,
      falRequestId: o.falRequestId,
      ticketCost: o.ticketCost,
      referenceImageUrls: o.referenceImageUrls,
      quality: '1k',
      aspectRatio: `${W}:${H}`,
      videoMetadata: { layerize: { width: W, height: H, layers } },
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
    },
  })
  return { id: row.id, url }
}
