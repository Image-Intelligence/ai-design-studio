import sharp from 'sharp'

/** Storyboard stills - picture helpers shared by the still and still-edit routes (server only). */

/**
 * Put a still into the board's frame when the model ignored it - Luma Uni-1's
 * edit has no size setting at all and returns the reference's shape, and any
 * model can drift. A small difference (up to 30% of the picture) is cropped,
 * keeping the most interesting part (sharp's attention strategy); a big one -
 * a portrait reference on a 16:9 board - is fitted whole over a blurred,
 * darkened copy of itself, so no face or product is cut off.
 */
export async function conformToFrame(buf: Buffer, aspect: string): Promise<{ buf: Buffer; how: 'crop' | 'fit' } | null> {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  if (!m) return null
  const target = Number(m[1]) / Number(m[2])
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 0, h = meta.height ?? 0
  if (!w || !h) return null
  const r = w / h
  if (Math.abs(Math.log(r / target)) < 0.02) return null
  const lost = 1 - Math.min(r / target, target / r)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  // A crop stays inside the still (never upscaled); a fit pads out around it
  const tall = r < target
  if (lost <= 0.3) {
    const size = tall ? { width: w, height: even(w / target) } : { width: even(h * target), height: h }
    return { buf: await sharp(buf).resize({ ...size, fit: 'cover', position: sharp.strategy.attention }).png().toBuffer(), how: 'crop' }
  }
  const size = tall ? { width: even(h * target), height: h } : { width: w, height: even(w / target) }
  const bg = await sharp(buf).resize({ ...size, fit: 'cover' }).blur(40).modulate({ brightness: 0.55 }).toBuffer()
  const fg = await sharp(buf).resize({ ...size, fit: 'inside' }).toBuffer()
  return { buf: await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).png().toBuffer(), how: 'fit' }
}
