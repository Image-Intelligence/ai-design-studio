/**
 * The 2026-09-28 video batch - Kling V3 Turbo, Kling O3 Pro / 4K, PixVerse V6
 * / C1, Grok Imagine Video 1.5, Vidu Q3 / Turbo, and their clip tools - as one
 * place that decides which fal endpoint runs and builds its exact input.
 *
 * app/api/video/generate calls these; so do the test scripts, so what gets
 * tested is what the site sends. Every field was checked against the live
 * schemas on 2026-09-28. Pricing is lib/ticket-pricing's batch0928TicketCost.
 */
import { batch0928Seconds } from '@/lib/ticket-pricing'

export type Batch0928Mode = 't2v' | 'i2v' | 'r2v' | 'transition'

/** Which endpoints each generator has beyond t2v / i2v. */
const HAS_R2V = new Set(['kling-o3-pro', 'kling-o3-4k', 'pixverse-c1', 'grok-video-1.5', 'vidu-q3'])
const HAS_TRANSITION = new Set(['pixverse-v6', 'pixverse-c1'])

/**
 * The endpoint a generator runs: references -> r2v (where it has one), a
 * start + end pair -> transition (PixVerse; the others take the end frame on
 * i2v), a start image -> i2v, otherwise t2v.
 */
export function batch0928Mode(model: string, p: { imageUrl?: string | null; endImageUrl?: string | null; effectiveMode?: string }): Batch0928Mode {
  if (p.effectiveMode === 'r2v' && HAS_R2V.has(model)) return 'r2v'
  if (p.imageUrl && p.endImageUrl && HAS_TRANSITION.has(model)) return 'transition'
  if (p.imageUrl || p.effectiveMode === 'r2v') return 'i2v'
  return 't2v'
}

/** The resolution that actually renders (and is billed). */
export function batch0928Resolution(model: string, resolution: string, mode: Batch0928Mode, hasEndImage: boolean): string {
  // Grok's reference mode tops out at 720p; Vidu has no 360p with an end frame
  if (model === 'grok-video-1.5' && mode === 'r2v' && resolution === '1080p') return '720p'
  if (model.startsWith('vidu-q3') && hasEndImage && resolution === '360p') return '540p'
  // Vidu's reference mix failed at 360p in testing ("Vidu API error") and ran
  // at 540p; the two cost the same, so references always render at 540p+
  if (model === 'vidu-q3' && mode === 'r2v' && resolution === '360p') return '540p'
  return resolution
}

export interface Batch0928Params {
  prompt: string
  imageUrl?: string | null
  endImageUrl?: string | null
  referenceImageUrls?: string[]
  editVideoUrl?: string | null
  duration: string
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  effectiveMode?: string
}

const pick = (allowed: string[], v: string, fallback: string) => (allowed.includes(v) ? v : fallback)

/** fal input for a batch generator or tool. */
export function batch0928Input(model: string, p: Batch0928Params): Record<string, any> {
  const secs = batch0928Seconds(model, p.duration)
  const refs = (p.referenceImageUrls ?? []).filter(Boolean)
  const prompt = (p.prompt ?? '').trim()

  // ── Tools: all take a source clip and require a prompt ──
  if (model === 'kling-o3-pro-edit' || model === 'kling-o3-4k-edit') {
    return { prompt, video_url: p.editVideoUrl, keep_audio: true, ...(refs.length ? { image_urls: refs.slice(0, 4) } : {}) }
  }
  if (model === 'kling-o3-pro-reference' || model === 'kling-o3-4k-reference') {
    return {
      prompt, video_url: p.editVideoUrl, keep_audio: true, duration: String(secs),
      aspect_ratio: pick(['auto', '16:9', '9:16', '1:1'], p.aspectRatio, 'auto'),
      ...(refs.length ? { image_urls: refs.slice(0, 4) } : {}),
    }
  }
  if (model === 'pixverse-v6-extend') {
    return {
      prompt, video_url: p.editVideoUrl, duration: secs,
      resolution: pick(['360p', '540p', '720p', '1080p'], p.resolution, '720p'),
      generate_audio_switch: !!p.generateAudio,
    }
  }
  if (model === 'grok-video-edit') return { prompt, video_url: p.editVideoUrl, resolution: p.resolution === '480p' ? '480p' : '720p' }
  if (model === 'grok-video-extend') return { prompt, video_url: p.editVideoUrl, duration: secs }

  // ── Generators ──
  const mode = batch0928Mode(model, p)
  const res = batch0928Resolution(model, p.resolution, mode, !!p.endImageUrl)
  const start = p.imageUrl || refs[0]

  if (model.startsWith('kling-')) {
    const o3 = model.startsWith('kling-o3')
    const input: Record<string, any> = { prompt, duration: String(secs) }
    if (o3) input.generate_audio = !!p.generateAudio
    if (mode === 'r2v') {
      // @Image1.. tags in the prompt; the endpoint takes up to 4
      input.image_urls = refs.slice(0, 4)
      input.aspect_ratio = pick(['16:9', '9:16', '1:1'], p.aspectRatio, '16:9')
    } else if (mode === 'i2v') {
      input.image_url = start
      if (o3 && p.endImageUrl) input.end_image_url = p.endImageUrl
    } else {
      input.aspect_ratio = pick(['16:9', '9:16', '1:1'], p.aspectRatio, '16:9')
    }
    return input
  }

  if (model.startsWith('pixverse-')) {
    const input: Record<string, any> = {
      prompt, duration: secs,
      resolution: pick(['360p', '540p', '720p', '1080p'], res, '720p'),
      generate_audio_switch: !!p.generateAudio,
    }
    const ar = pick(['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'], p.aspectRatio, '16:9')
    if (mode === 'transition') {
      input.first_image_url = p.imageUrl; input.end_image_url = p.endImageUrl; input.aspect_ratio = ar
    } else if (mode === 'r2v') {
      // Named references, so @Image1.. in the prompt resolve to them
      input.image_references = refs.slice(0, 7).map((u, i) => ({ image_url: u, ref_name: `Image${i + 1}`, type: 'subject' }))
      input.aspect_ratio = ar
    } else if (mode === 'i2v') {
      input.image_url = start
    } else {
      input.aspect_ratio = ar
    }
    return input
  }

  if (model === 'grok-video-1.5-lite') {
    // Lite: text-to-video (with an aspect) or image-to-video (the image sets
    // the shape). No reference mode - extra images fall back to the first.
    const input: Record<string, any> = { prompt, duration: secs, resolution: pick(['480p', '720p', '1080p'], res, '720p') }
    if (mode === 'i2v') input.image_url = start
    else input.aspect_ratio = pick(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'], p.aspectRatio, '16:9')
    return input
  }
  if (model === 'grok-video-1.5') {
    const input: Record<string, any> = { prompt, duration: secs, resolution: pick(['480p', '720p', '1080p'], res, '720p') }
    const ar = pick(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'], p.aspectRatio, '16:9')
    if (mode === 'r2v') {
      // Grok tags references <IMAGE_0>..; the site writes @Image1.. everywhere
      input.prompt = prompt.replace(/@Image(\d+)/gi, (_m, n: string) => `<IMAGE_${Math.max(0, parseInt(n) - 1)}>`)
      input.reference_image_urls = refs.slice(0, 7)
      input.aspect_ratio = ar
    } else if (mode === 'i2v') {
      input.image_url = start
    } else {
      input.aspect_ratio = ar
    }
    return input
  }

  // vidu-q3 / vidu-q3-turbo
  const input: Record<string, any> = { prompt, duration: secs, resolution: pick(['360p', '540p', '720p', '1080p'], res, '720p'), audio: !!p.generateAudio }
  const ar = pick(['16:9', '9:16', '4:3', '3:4', '1:1'], p.aspectRatio, '16:9')
  if (mode === 'r2v') {
    input.reference_image_urls = refs.slice(0, 4)
    input.aspect_ratio = ar
  } else if (mode === 'i2v') {
    input.image_url = start
    if (p.endImageUrl) input.end_image_url = p.endImageUrl
  } else {
    input.aspect_ratio = ar
  }
  return input
}
