import { fal } from '@/lib/fal-client'
import { signMediaUrl } from '@/lib/media-url'
import { firstFrame } from '@/lib/vace-mask'

/*
 * Viggle-Animate's input (2026-10-22): one frame of the clip with the person
 * already repainted as the character - the model carries that edit through
 * the whole clip. Viggle's own demo makes it with an image editor from the
 * clip's first frame and the character picture; this does the same with
 * NanoBanana 2.1's edit, using Viggle's repaint instruction (their Space,
 * app.py - it keeps pose, framing, background and light pixel-aligned, which
 * is what the model needs). About $0.05 at fal; the frame is the clip's own
 * shape (aspect 'auto'), so the worker's crop fits both the same way.
 *
 * Callers need ffmpeg on Vercel (next.config.ts outputFileTracingIncludes).
 */
const REPAINT = [
  'Edit the first image, which is one frame of a video. Change exactly one thing: who the person is. Give them the face, hair, skin tone and clothing of the person in the second image.',
  'The body does not move. Keep the pose identical -- every limb, both hands, the head angle and the direction of gaze stay exactly where they are, and the person keeps the same position in the frame and the same size. Do not re-pose, straighten, re-centre or redraw the body: repaint the person who is already standing there, do not draw a new one.',
  'Nothing else changes. Same camera angle, same framing and crop, same background, same lighting, shadows and colour grade. Anything the person is holding or touching stays exactly as it is, in the same hand, at the same angle.',
  'Do not zoom or crop, and do not add text, captions or watermarks.',
].join('\n')

/** The repainted first frame (a fal link), or throws with NanoBanana's reason. */
export async function viggleRepaint(clipUrl: string, characterUrl: string): Promise<{ frameUrl: string; repaintUrl: string }> {
  const frame = await firstFrame(clipUrl)
  const frameUrl = await fal.storage.upload(new Blob([new Uint8Array(frame)], { type: 'image/png' }))
  const out: any = await fal.subscribe('google/nano-banana-2.1/edit', {
    input: {
      prompt: REPAINT,
      image_urls: [frameUrl, signMediaUrl(characterUrl, 3600)],
      aspect_ratio: 'auto', resolution: '1K', output_format: 'png', num_images: 1,
      // Admin-only model: the editor's most permissive setting, as admin NanoBanana runs use
      safety_tolerance: '6', limit_generations: true,
    } as any,
  })
  const repaintUrl = out?.data?.images?.[0]?.url
  if (typeof repaintUrl !== 'string') throw new Error('NanoBanana returned no repainted frame')
  return { frameUrl, repaintUrl }
}
