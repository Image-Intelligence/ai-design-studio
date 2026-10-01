/**
 * Pixelcut's two video models (2026-09-30):
 *
 *   pixelcut/looping-video             image -> a seamless loop that starts and
 *                                      ends on the product photo ('subtle'
 *                                      ambient motion, or one full 'spin')
 *   pixelcut/video-background-removal  a clip -> the subject on transparent or
 *                                      a solid colour
 *
 * One place that picks the endpoint and builds the exact input; the video
 * route calls it. Fields checked against the live schemas on 2026-09-30.
 * Pricing: lib/ticket-pricing's pixelcutVideoTicketCost.
 */

export const PIXELCUT_LOOPING = 'pixelcut-looping-video'
export const PIXELCUT_BG_REMOVAL = 'pixelcut-video-bg-removal'

export const PIXELCUT_VIDEO_ENDPOINTS: Record<string, string> = {
  [PIXELCUT_LOOPING]: 'pixelcut/looping-video',
  [PIXELCUT_BG_REMOVAL]: 'pixelcut/video-background-removal',
}

/** Looping Video's motion styles (the schema's enum). */
export const PIXELCUT_LOOP_MOTIONS = ['subtle', 'spin'] as const
/** Background Removal's presets ('custom' needs a colour picker; not offered). */
export const PIXELCUT_BACKGROUNDS = ['transparent', 'green', 'black', 'white', 'blue', 'magenta'] as const
export const PIXELCUT_LOOP_RESOLUTIONS = ['480p', '768p', '1080p'] as const
/** Longest clip Background Removal takes here (it is billed per frame). */
export const PIXELCUT_BG_MAX_SECONDS = 60

export function pixelcutVideoInput(model: string, o: {
  prompt?: string
  imageUrl?: string
  editVideoUrl?: string
  duration?: string
  resolution?: string
  generateAudio?: boolean
  choice?: string
}): Record<string, unknown> {
  if (model === PIXELCUT_LOOPING) {
    const d = Math.round(Number(o.duration) || 5)
    const input: Record<string, unknown> = {
      image_url: o.imageUrl,
      duration: Math.min(15, Math.max(5, d)),
      resolution: (PIXELCUT_LOOP_RESOLUTIONS as readonly string[]).includes(o.resolution ?? '') ? o.resolution : '1080p',
      motion: (PIXELCUT_LOOP_MOTIONS as readonly string[]).includes(o.choice ?? '') ? o.choice : 'subtle',
      include_audio: !!o.generateAudio,
    }
    if (o.prompt?.trim()) input.prompt = o.prompt.trim()
    return input
  }
  // Background removal
  return {
    video_url: o.editVideoUrl,
    background: (PIXELCUT_BACKGROUNDS as readonly string[]).includes(o.choice ?? '') ? o.choice : 'transparent',
  }
}
