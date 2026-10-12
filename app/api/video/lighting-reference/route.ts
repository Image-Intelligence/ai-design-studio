import { cookies } from 'next/headers'
import sharp from 'sharp'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { uploadToR2, userKey } from '@/lib/r2'
import { signMediaUrl } from '@/lib/media-url'
import { renderLighting, sanitizeLighting, LIGHTING_PICTURE_SIZE } from '@/lib/lighting-studio'

/**
 * POST /api/video/lighting-reference - the Lighting studio's picture.
 *
 * Body: { lights: StudioLight[], ambient } (lib/lighting-studio)
 * Returns: { url } - a signed link to a 1024 x 1024 JPEG of the lit sphere,
 * stored under the account's own prefix, for H3 Max Relight's reference.
 *
 * Rendered HERE from the light settings (the page shows the same render as
 * its preview), so nothing the user brought in is uploaded - which is why it
 * needs no ID check, unlike a picture upload. Free: no model runs.
 */
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const scene = sanitizeLighting(await req.json().catch(() => ({})))
  if (!scene.lights.length) return jsonPrivate({ error: 'Add a light first' }, { status: 400 })
  const S = LIGHTING_PICTURE_SIZE
  const px = renderLighting(scene, S, S)
  const jpg = await sharp(Buffer.from(px.buffer), { raw: { width: S, height: S, channels: 4 } }).jpeg({ quality: 92 }).toBuffer()
  const url = await uploadToR2(userKey(user.id, `lighting/lighting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`), jpg, 'image/jpeg')
  return jsonPrivate({ url: signMediaUrl(url) })
}
