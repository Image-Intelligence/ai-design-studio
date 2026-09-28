import { fal } from '@/lib/fal-client'
import { signMediaUrl, isPrivateMedia, FAL_TTL } from '@/lib/media-url'

/**
 * Makes sure an image fits within `maxSide` x `maxSide` before a fal endpoint
 * sees it.
 *
 * Some endpoints reject large inputs outright rather than scaling them - Luma
 * Ray 2's image-to-video answers anything past 1920x1920 with a 422
 * ("image_too_large"), and a 2K 9:16 generation is 1536x2752. An image that
 * already fits is returned untouched (same URL, nothing uploaded); a larger one
 * is scaled down with its aspect kept, and the copy goes to fal's own storage,
 * which the endpoint can always fetch.
 *
 * Any failure to read or shrink the image returns the original URL: the
 * endpoint's own error is then the one the user sees, as before.
 */
export async function fitImageForFal(url: string, maxSide: number): Promise<string> {
  try {
    // A private R2 object needs a signed URL to be read, as it does for fal
    const res = await fetch(isPrivateMedia(url) ? signMediaUrl(url, FAL_TTL) : url)
    if (!res.ok) return url
    const buf = Buffer.from(await res.arrayBuffer())
    const sharp = (await import('sharp')).default
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height || (meta.width <= maxSide && meta.height <= maxSide)) return url
    const out = await sharp(buf)
      .rotate() // honour EXIF orientation before measuring the fit
      .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer()
    return await fal.storage.upload(new Blob([new Uint8Array(out)], { type: 'image/jpeg' }))
  } catch (e) {
    console.warn('fitImageForFal: kept the original image', e)
    return url
  }
}
