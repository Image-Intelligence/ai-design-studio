/**
 * The 2026-09-29 video batch - Pika 2.2 / Pikaframes / Pika 2 Turbo, MiniMax
 * Hailuo 2.3 (Pro, Standard, Fast), Google Veo 3.1 (Standard, Fast, Lite),
 * MiniMax H3 Max Turbo and H3 Max References, Moonvalley Marey, SeeDance 2.0
 * Mini, Hunyuan Video 1.5 - and their clip tools (Veo extend, H3 Max extend,
 * Marey motion / pose transfer).
 *
 * One place that decides which fal endpoint runs and builds its exact input.
 * app/api/video/generate calls these, and so do the test scripts, so what is
 * tested is what the site sends. Every field was checked against the live
 * schemas on 2026-09-28. Pricing: lib/ticket-pricing's batch0929TicketCost.
 */
import { batch0929Seconds } from '@/lib/ticket-pricing'

export const BATCH_0929_GENERATORS = new Set([
  'pika-2.2', 'pikaframes', 'pika-2-turbo',
  'hailuo-2.3-pro', 'hailuo-2.3', 'hailuo-2.3-fast-pro', 'hailuo-2.3-fast',
  'veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite',
  'minimax-h3-max-turbo', 'minimax-h3-max-ref',
  'marey', 'seedance-2.0-mini', 'hunyuan-video-1.5',
])
export const BATCH_0929_TOOLS = new Set([
  'veo-3.1-extend', 'veo-3.1-fast-extend', 'minimax-h3-max-extend',
  'marey-motion-transfer', 'marey-pose-transfer',
  // 2026-10-02: H3 Max Turbo extend (half the non-turbo rate, adds 2K) and
  // Recast (swap the people in a clip for the people in 1-4 photos)
  'minimax-h3-max-turbo-extend', 'minimax-h3-max-recast',
])
/** Tools whose prompt is optional (every other batch tool requires one). */
export const BATCH_0929_PROMPT_OPTIONAL = new Set(['minimax-h3-max-recast'])
/** Generators that can run from text alone. */
export const BATCH_0929_TEXT_CAPABLE = [
  'pika-2.2', 'pika-2-turbo', 'hailuo-2.3-pro', 'hailuo-2.3',
  'veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite', 'minimax-h3-max-turbo',
  'marey', 'seedance-2.0-mini', 'hunyuan-video-1.5',
]

/** fal endpoints, keyed `${model}-${mode}` (generators) or by model (tools). */
export const BATCH_0929_ENDPOINTS: Record<string, string> = {
  'pika-2.2-t2v': 'fal-ai/pika/v2.2/text-to-video',
  'pika-2.2-i2v': 'fal-ai/pika/v2.2/image-to-video',
  'pika-2.2-r2v': 'fal-ai/pika/v2.2/pikascenes',
  'pikaframes-frames': 'fal-ai/pika/v2.2/pikaframes',
  'pika-2-turbo-t2v': 'fal-ai/pika/v2/turbo/text-to-video',
  'pika-2-turbo-i2v': 'fal-ai/pika/v2/turbo/image-to-video',
  'hailuo-2.3-pro-t2v': 'fal-ai/minimax/hailuo-2.3/pro/text-to-video',
  'hailuo-2.3-pro-i2v': 'fal-ai/minimax/hailuo-2.3/pro/image-to-video',
  'hailuo-2.3-t2v': 'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
  'hailuo-2.3-i2v': 'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
  'hailuo-2.3-fast-pro-i2v': 'fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video',
  'hailuo-2.3-fast-i2v': 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video',
  'veo-3.1-t2v': 'fal-ai/veo3.1',
  'veo-3.1-i2v': 'fal-ai/veo3.1/image-to-video',
  'veo-3.1-flf': 'fal-ai/veo3.1/first-last-frame-to-video',
  'veo-3.1-r2v': 'fal-ai/veo3.1/reference-to-video',
  'veo-3.1-fast-t2v': 'fal-ai/veo3.1/fast',
  'veo-3.1-fast-i2v': 'fal-ai/veo3.1/fast/image-to-video',
  'veo-3.1-fast-flf': 'fal-ai/veo3.1/fast/first-last-frame-to-video',
  'veo-3.1-fast-r2v': 'fal-ai/veo3.1/fast/reference-to-video',
  'veo-3.1-lite-t2v': 'fal-ai/veo3.1/lite',
  'veo-3.1-lite-i2v': 'fal-ai/veo3.1/lite/image-to-video',
  'veo-3.1-lite-flf': 'fal-ai/veo3.1/lite/first-last-frame-to-video',
  'minimax-h3-max-turbo-t2v': 'minimax/h3-max-turbo/text-to-video',
  'minimax-h3-max-turbo-i2v': 'minimax/h3-max-turbo/image-to-video',
  'minimax-h3-max-ref-r2v': 'minimax/h3-max/reference-to-video',
  'marey-t2v': 'moonvalley/marey/t2v',
  'marey-i2v': 'moonvalley/marey/i2v',
  'seedance-2.0-mini-t2v': 'bytedance/seedance-2.0/mini/text-to-video',
  'seedance-2.0-mini-i2v': 'bytedance/seedance-2.0/mini/image-to-video',
  'seedance-2.0-mini-r2v': 'bytedance/seedance-2.0/mini/reference-to-video',
  'hunyuan-video-1.5-t2v': 'fal-ai/hunyuan-video-v1.5/text-to-video',
  'hunyuan-video-1.5-i2v': 'fal-ai/hunyuan-video-v1.5/image-to-video',
  // tools
  'veo-3.1-extend': 'fal-ai/veo3.1/extend-video',
  'veo-3.1-fast-extend': 'fal-ai/veo3.1/fast/extend-video',
  'minimax-h3-max-extend': 'minimax/h3-max/extend-video',
  'minimax-h3-max-turbo-extend': 'minimax/h3-max-turbo/extend-video',
  'minimax-h3-max-recast': 'minimax/h3-max/recast',
  'marey-motion-transfer': 'moonvalley/marey/motion-transfer',
  'marey-pose-transfer': 'moonvalley/marey/pose-transfer',
}

export type Batch0929Mode = 't2v' | 'i2v' | 'r2v' | 'flf' | 'frames'

const HAS_R2V = new Set(['pika-2.2', 'veo-3.1', 'veo-3.1-fast', 'seedance-2.0-mini'])
const HAS_FLF = new Set(['veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite'])
const IMAGE_ONLY = new Set(['hailuo-2.3-fast-pro', 'hailuo-2.3-fast'])

/**
 * The endpoint a generator runs. Pikaframes always runs keyframes, H3 Max
 * References always runs references; for the rest: several images -> r2v
 * (where it exists), a start + end pair -> first-last-frame (Veo; SeeDance
 * Mini and H3 Turbo take the end frame on i2v), one image -> i2v, else t2v.
 */
export function batch0929Mode(model: string, p: { imageUrl?: string | null; endImageUrl?: string | null; effectiveMode?: string }): Batch0929Mode {
  if (model === 'pikaframes') return 'frames'
  if (model === 'minimax-h3-max-ref') return 'r2v'
  if (p.effectiveMode === 'r2v' && HAS_R2V.has(model)) return 'r2v'
  if (p.imageUrl && p.endImageUrl && HAS_FLF.has(model)) return 'flf'
  if (p.imageUrl || p.effectiveMode === 'r2v' || IMAGE_ONLY.has(model)) return 'i2v'
  return 't2v'
}

export function batch0929EndpointKey(model: string, mode: Batch0929Mode): string {
  return BATCH_0929_TOOLS.has(model) ? model : `${model}-${mode}`
}

export interface Batch0929Params {
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
/** MiniMax spells resolutions with a capital P. */
const mmRes = (r: string, allowed = ['480P', '768P', '1080P']) => pick(allowed, r.toUpperCase(), '768P')

/** fal input for a batch generator or tool. */
export function batch0929Input(model: string, p: Batch0929Params): Record<string, any> {
  const secs = batch0929Seconds(model, p.duration)
  const refs = (p.referenceImageUrls ?? []).filter(Boolean)
  const prompt = (p.prompt ?? '').trim()
  const start = p.imageUrl || refs[0]
  const mode = BATCH_0929_TOOLS.has(model) ? null : batch0929Mode(model, p)

  // ── Tools ──
  if (model === 'veo-3.1-extend' || model === 'veo-3.1-fast-extend') {
    return { prompt, video_url: p.editVideoUrl, generate_audio: !!p.generateAudio, resolution: '720p', safety_tolerance: '4' }
  }
  if (model === 'minimax-h3-max-turbo-extend') {
    // Schema 2026-10-02: duration 1-15 (billed on the seconds ADDED), 2K tier
    return {
      prompt, video_url: p.editVideoUrl, duration: secs, output: 'extended',
      resolution: mmRes(p.resolution, ['480P', '768P', '1080P', '2K']), enable_prompt_expansion: true,
    }
  }
  if (model === 'minimax-h3-max-recast') {
    // One photo per new person; by default they replace the main people left
    // to right. The prompt is optional ("who becomes whom"). Source 5-30s.
    return {
      video_url: p.editVideoUrl, reference_image_urls: refs.slice(0, 4),
      resolution: mmRes(p.resolution, ['768P', '1080P']),
      ...(prompt ? { prompt } : {}),
    }
  }
  if (model === 'minimax-h3-max-extend') {
    return {
      prompt, video_url: p.editVideoUrl, duration: secs, output: 'extended',
      resolution: mmRes(p.resolution, ['480P', '768P', '1080P']), enable_prompt_expansion: true,
    }
  }
  if (model === 'marey-motion-transfer' || model === 'marey-pose-transfer') {
    return { prompt, video_url: p.editVideoUrl, ...(start ? { reference_image_url: start } : {}) }
  }

  // ── Generators ──
  if (model === 'pikaframes') {
    // 2-5 keyframes; each transition gets the chosen length, capped so the
    // whole run stays within Pika's 25s
    const frames = (refs.length ? refs : [p.imageUrl, p.endImageUrl].filter(Boolean) as string[]).slice(0, 5)
    const per = Math.min(secs, Math.floor(25 / Math.max(1, frames.length - 1)))
    return {
      image_urls: frames, prompt: prompt || undefined,
      transitions: frames.slice(1).map(() => ({ duration: per })),
      resolution: pick(['720p', '1080p'], p.resolution, '720p'),
    }
  }
  if (model === 'pika-2.2' || model === 'pika-2-turbo') {
    const res = pick(['720p', '1080p'], p.resolution, '720p')
    const ar = pick(['16:9', '9:16', '1:1', '4:5', '5:4', '3:2', '2:3'], p.aspectRatio, '16:9')
    if (mode === 'r2v') return { prompt, image_urls: refs.slice(0, 6), aspect_ratio: ar, resolution: res, duration: secs, ingredients_mode: 'precise' }
    if (mode === 'i2v') return { prompt, image_url: start, resolution: res, duration: secs }
    return { prompt, aspect_ratio: ar, resolution: res, duration: secs }
  }
  if (model.startsWith('hailuo-')) {
    // Pro and Fast Pro have a fixed length; Standard and Fast take 6s or 10s
    const input: Record<string, any> = { prompt, prompt_optimizer: true }
    if (model === 'hailuo-2.3' || model === 'hailuo-2.3-fast') input.duration = String(secs)
    if (mode === 'i2v') input.image_url = start
    return input
  }
  if (model.startsWith('veo-3.1')) {
    const lite = model === 'veo-3.1-lite'
    // Veo's references and first-last-frame modes only take 8s (tested
    // 2026-09-28: "Input should be '8s'"); billing snaps the same way
    const veoSecs = mode === 'r2v' || mode === 'flf' ? 8 : secs
    const input: Record<string, any> = {
      prompt, duration: `${veoSecs}s`, generate_audio: !!p.generateAudio, safety_tolerance: '4',
      resolution: pick(lite ? ['720p', '1080p'] : ['720p', '1080p', '4k'], p.resolution, '720p'),
    }
    const ar = pick(['16:9', '9:16'], p.aspectRatio, '16:9')
    if (mode === 'r2v') { input.image_urls = refs.slice(0, 3); input.aspect_ratio = ar }
    else if (mode === 'flf') { input.first_frame_url = p.imageUrl; input.last_frame_url = p.endImageUrl; input.aspect_ratio = 'auto' }
    else if (mode === 'i2v') { input.image_url = start; input.aspect_ratio = 'auto' }
    else input.aspect_ratio = ar
    return input
  }
  if (model === 'minimax-h3-max-turbo' || model === 'minimax-h3-max-ref') {
    const input: Record<string, any> = { prompt, duration: secs, resolution: mmRes(p.resolution), prompt_expansion_mode: 'balanced' }
    if (model === 'minimax-h3-max-ref') {
      // Up to 4 square-ish images ride free; the prompt names them "Image 1"..
      input.reference_image_urls = (refs.length ? refs : [start].filter(Boolean) as string[]).slice(0, 4)
      input.prompt = prompt.replace(/@Image(\d+)/gi, 'Image $1')
      input.aspect_ratio = pick(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], p.aspectRatio, 'adaptive')
    } else if (mode === 'i2v') {
      input.image_url = start
      if (p.endImageUrl) input.end_image_url = p.endImageUrl
    } else {
      input.aspect_ratio = pick(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], p.aspectRatio, '16:9')
    }
    return input
  }
  if (model === 'marey') {
    // Dimensions stand in for aspect ratio; text-to-video has no 1080x1920
    const dims: Record<string, string> = { '16:9': '1920x1080', '9:16': '1080x1920', '1:1': '1152x1152', '4:3': '1536x1152', '3:4': '1152x1536' }
    let d = dims[p.aspectRatio] ?? '1920x1080'
    if (mode !== 'i2v' && d === '1080x1920') d = '1152x1536'
    return { prompt, duration: `${secs}s`, dimensions: d, ...(mode === 'i2v' ? { image_url: start } : {}) }
  }
  if (model === 'seedance-2.0-mini') {
    const input: Record<string, any> = {
      // 'auto' is sent as the billed length (10s): Mini's own auto can run
      // to 15s, which a price fixed up front would not cover
      prompt, duration: String(secs), generate_audio: !!p.generateAudio,
      resolution: pick(['480p', '720p'], p.resolution, '720p'), codec: 'H264',
      aspect_ratio: pick(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], p.aspectRatio, 'auto'),
    }
    if (mode === 'r2v') input.image_urls = refs.slice(0, 9)
    else if (mode === 'i2v') { input.image_url = start; if (p.endImageUrl) input.end_image_url = p.endImageUrl }
    return input
  }
  // hunyuan-video-1.5: length is a frame count at 24fps (+1)
  return {
    prompt, num_frames: secs * 24 + 1, resolution: pick(['480p', '720p'], p.resolution, '480p'),
    aspect_ratio: pick(['16:9', '9:16'], p.aspectRatio, '16:9'),
    ...(mode === 'i2v' ? { image_url: start } : {}),
  }
}
