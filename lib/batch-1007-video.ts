/**
 * The 2026-10-07 video batch (ADMIN ONLY while under test):
 *
 *   generator    Vidu Q4 - a start frame -> 3-16s with native audio (i2v), or
 *                up to 12 reference images -> a scene that keeps them (r2v),
 *                540p to 4K
 *   clip tool    H3 Max Relight - re-lights a clip (up to 15s) from a picture
 *                of a lit sphere, keeping its subjects, motion, camera and audio
 *   generator    Kling 4.0 (added 2026-10-21, ADMIN ONLY while under test) -
 *                words to video, or references: pictures (@Image1..), clips
 *                (@Video1..) and elements (@Element1..: a character or thing
 *                as a front view plus 1-3 more angles), 3-30s, 720p / 1080p
 *   clip tool    Kling 4.0 Edit (same day, admin) - edits a 3-30s clip from
 *                words (@Video1), with optional pictures and elements
 *   clip tool    H3 Max Reframe (added 2026-10-21, public the same day) - fits a clip onto a new aspect ratio and outpaints the
 *                rest, keeping its timing and audio; an optional prompt says
 *                what fills the new space
 *   character    Wan 2.2 Animate Replace, DreamActor v2 - the person in a clip
 *   swap         becomes the character in a picture, keeping the footage's
 *                camera, set, timing and lip movement (the "swap the rapper"
 *                music-video edits); Lucy Edit Pro - edits a clip from words
 *
 * One place that decides which fal endpoint runs and builds its exact input,
 * called by app/api/video/generate. Every field was checked against the live
 * schemas on 2026-10-07. Pricing: batch1007TicketCost below (fal cost at
 * $0.04 a ticket - Vidu at its REGULAR rates: the 30% promo ends Nov 30).
 */

export const BATCH_1007_GENERATORS = new Set(['vidu-q4', 'kling-v4'])
export const BATCH_1007_TOOLS = new Set(['minimax-h3-max-relight', 'wan-2.2-animate-replace', 'dreamactor-v2', 'lucy-edit-pro', 'minimax-h3-max-reframe', 'kling-v4-edit'])
/** The clip tools that put the character from a picture (the first reference image) into the clip. */
export const BATCH_1007_NEEDS_CHARACTER = new Set(['wan-2.2-animate-replace', 'dreamactor-v2'])
/** Longest source clip each takes, seconds (DreamActor: fal's 30s; the others held to the panel's 15s). */
export const BATCH_1007_MAX_SEC: Record<string, number> = {
  'minimax-h3-max-relight': 15, 'wan-2.2-animate-replace': 15, 'dreamactor-v2': 30, 'lucy-edit-pro': 15,
  // fal takes up to 300s, but past one window it renders overlapping windows
  // and bills the overlap too - held to 15s, the length its price was measured on
  'minimax-h3-max-reframe': 15,
  // Kling 4.0 Edit: fal's 3-30s
  'kling-v4-edit': 30,
}
/**
 * Promoted after a priced, end-to-end run through the portal UI: all five,
 * public 2026-10-08 (Vidu Q4 at fal's regular - not promo - rates). H3 Max
 * Reframe public 2026-10-21 after UI runs at 768p / 1080p / 480p-15s, each
 * charge measured on fal's balance (5.04s 768p $0.4033, 1080p $0.8067,
 * 14.92s 480p $0.7458 - billed by the second, no overlap within 15s).
 */
export const BATCH_1007_PUBLIC = new Set<string>([
  'vidu-q4', 'minimax-h3-max-relight', 'wan-2.2-animate-replace', 'dreamactor-v2', 'lucy-edit-pro',
  'minimax-h3-max-reframe',
])

export const BATCH_1007_ENDPOINTS: Record<string, string> = {
  'vidu-q4-i2v': 'fal-ai/vidu/q4/image-to-video',
  'vidu-q4-r2v': 'fal-ai/vidu/q4/reference-to-video',
  'minimax-h3-max-relight': 'minimax/h3-max/relight',
  'wan-2.2-animate-replace': 'fal-ai/wan/v2.2-14b/animate/replace',
  'dreamactor-v2': 'fal-ai/bytedance/dreamactor/v2',
  'lucy-edit-pro': 'decart/lucy-edit/pro',
  'minimax-h3-max-reframe': 'minimax/h3-max/reframe-video',
  'kling-v4-t2v': 'kling/v4/text-to-video',
  'kling-v4-r2v': 'kling/v4/reference-to-video',
  'kling-v4-edit': 'kling/v4/video-to-video/edit',
}

/*
 * ── Kling 4.0 (2026-10-21) ─────────────────────────────────────────────────
 * One picker entry: text to video, or - with any reference, a start frame or
 * an element - reference to video. Elements come from the page as
 * { frontal, views } (fal: frontal_image_url + 1-3 reference_image_urls).
 * fal (2026-10-21): $0.157/s at 720p, $0.235/s at 1080p; with reference
 * clips it is $0.094 / $0.141 a second of (input + output), at least twice the
 * output. The Edit is priced the clip way too until measured (it is billed on
 * the source as well as the output).
 */
export const KLING_V4_MAX_ELEMENTS = 7
export const KLING_V4_MAX_IMAGES = 10
export const KLING_V4_MAX_VIDEOS = 5
export type KlingElement = { frontal: string; views: string[] }
/** The page's elements, cleaned: a front view and 1-3 more angles each (fal needs at least one more). */
export function cleanKlingElements(raw: unknown): KlingElement[] {
  const url = (u: unknown) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null)
  return (Array.isArray(raw) ? raw : [])
    .map((e: any) => ({ frontal: url(e?.frontal), views: (Array.isArray(e?.views) ? e.views : []).map(url).filter((u: string | null): u is string => !!u).slice(0, 3) }))
    .filter((e): e is KlingElement => !!e.frontal && e.views.length > 0)
    .slice(0, KLING_V4_MAX_ELEMENTS)
}
const KLING_V4_USD: Record<string, number> = { '720p': 0.157, '1080p': 0.235 }
const KLING_V4_CLIP_USD: Record<string, number> = { '720p': 0.094, '1080p': 0.141 }

/** Vidu Q4: references (r2v) when they are given, else the start frame (i2v). Kling 4.0: references when there are any. */
export function batch1007EndpointKey(model: string, p: { referenceImageUrls?: string[]; effectiveMode?: string; referenceVideoUrls?: string[]; klingElements?: unknown; imageUrl?: string | null }): string {
  if (model === 'kling-v4') {
    const any = (p.referenceImageUrls?.length ?? 0) + (p.referenceVideoUrls?.length ?? 0) + cleanKlingElements(p.klingElements).length + (p.imageUrl ? 1 : 0)
    return any > 0 ? 'kling-v4-r2v' : 'kling-v4-t2v'
  }
  if (model !== 'vidu-q4') return model
  return p.effectiveMode === 'r2v' && (p.referenceImageUrls?.length ?? 0) > 0 ? 'vidu-q4-r2v' : 'vidu-q4-i2v'
}

export const VIDU_Q4_RESOLUTIONS = ['540p', '720p', '1080p', '2k', '4k'] as const
/** fal per second, REGULAR rates (Dec 1 on; the promo until Nov 30 is 30% off). Audio costs nothing extra. */
const VIDU_Q4_USD: Record<string, number> = { '540p': 0.045, '720p': 0.095, '1080p': 0.12, '2k': 0.19, '4k': 0.39 }
/** fal per second of the (source-length) output. */
const RELIGHT_USD: Record<string, number> = { '480p': 0.05, '768p': 0.08, '1080p': 0.16, '2k': 0.32 }
/**
 * Reframe: per second of generated video (= the source's length, up to one
 * window). 1080p is a learned upscale of the 768p reframe and is not on fal's
 * price card - measured 2026-10-21 at $0.16/s (5.04s cost $0.8067).
 */
const REFRAME_USD: Record<string, number> = { '480p': 0.05, '768p': 0.08, '1080p': 0.16 }
export const REFRAME_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'] as const
/** Wan Animate: per "video second" = 16 frames of the clip (a 30 fps clip bills ~1.9x its length). */
const WAN_ANIMATE_USD: Record<string, number> = { '480p': 0.04, '580p': 0.06, '720p': 0.08 }
/** Lucy Edit Pro: per second of the clip, 720p - the only resolution it accepts (fal's 480p price is for the dev tier; 480p is refused: "Input should be '720p'") */
const LUCY_USD_PER_SEC = 0.15
/** fal converts the source to 24 fps and renders at least ~2.33s; it takes up to 15s. */
export const RELIGHT_MAX_SEC = 15
const RELIGHT_MIN_SEC = 2.33

export interface Batch1007Params {
  prompt: string
  imageUrl?: string | null
  referenceImageUrls?: string[]
  editVideoUrl?: string | null
  duration: string
  resolution: string
  aspectRatio: string
  effectiveMode?: string
  generateAudio?: boolean
  /** The source clip's measured size (Relight keeps its shape). */
  sourceWidth?: number
  sourceHeight?: number
  /** Kling 4.0: reference clips and elements. */
  referenceVideoUrls?: string[]
  klingElements?: unknown
}

/**
 * The supported ratio nearest the source's shape. fal's own 'adaptive' did not
 * keep it (tested 2026-10-07: a 720x720 clip came back 832x480), so the shape
 * is measured and named.
 */
const RELIGHT_RATIOS: [string, number][] = [['21:9', 21 / 9], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]]
function nearestRatio(w?: number, h?: number): string {
  if (!w || !h) return 'adaptive'
  const r = Math.log(w / h)
  return RELIGHT_RATIOS.reduce((best, cur) => (Math.abs(Math.log(cur[1]) - r) < Math.abs(Math.log(best[1]) - r) ? cur : best))[0]
}

const pick = (allowed: readonly string[], v: string | undefined, fallback: string) => (v && allowed.includes(v) ? v : fallback)

/** fal input for a 2026-10-07 generator or tool. */
export function batch1007Input(model: string, p: Batch1007Params): Record<string, any> {
  const prompt = (p.prompt ?? '').trim()
  const refs = (p.referenceImageUrls ?? []).filter(Boolean)
  const res = String(p.resolution ?? '').toLowerCase()
  switch (model) {
    case 'vidu-q4': {
      const base = {
        duration: Math.min(16, Math.max(3, parseInt(p.duration) || 5)),
        // fal spells the top tiers with a capital K
        resolution: pick(VIDU_Q4_RESOLUTIONS, res, '720p').replace('k', 'K'),
      }
      if (batch1007EndpointKey(model, p) === 'vidu-q4-r2v') {
        // The references keep characters and objects; the prompt says what happens
        return {
          // fal's reference tag is [@reference_image_N]; the panel writes @ImageN
          ...base, prompt: prompt.replace(/@Image(\d+)/gi, '[@reference_image_$1]'), reference_image_urls: refs.slice(0, 12),
          aspect_ratio: pick(['16:9', '9:16', '4:3', '3:4', '1:1'], p.aspectRatio, '16:9'),
          audio: !!p.generateAudio,
        }
      }
      // i2v always has native audio; the prompt is optional
      return { ...base, image_url: p.imageUrl || refs[0], ...(prompt ? { prompt } : {}) }
    }
    case 'wan-2.2-animate-replace':
      // The person in the clip becomes the character in the picture; the
      // clip's camera, set and timing stay. Turbo off: quality over speed
      return {
        video_url: p.editVideoUrl, image_url: refs[0] || p.imageUrl,
        resolution: pick(['480p', '580p', '720p'], res, '720p'),
        video_quality: 'high', video_write_mode: 'balanced',
      }
    case 'dreamactor-v2':
      // The picture's character performs the clip (motion, face, lips). The
      // first second of fal's output is a transition - trimmed
      return { video_url: p.editVideoUrl, image_url: refs[0] || p.imageUrl, trim_first_second: true }
    case 'lucy-edit-pro':
      // An edit described in words ("make him a chrome robot"); sync_mode off
      // so the result comes back as a file, not inline
      return {
        video_url: p.editVideoUrl, prompt: prompt.slice(0, 1500),
        resolution: '720p', enhance_prompt: true, sync_mode: false,
      }
    case 'minimax-h3-max-relight':
      // The lighting comes from the first reference image (a lit sphere -
      // uploaded, or built in the Lighting studio). The frame: the one picked
      // (2026-10-11, fal's list), or "auto" = the source's shape (the nearest
      // ratio fal offers - fal's own 'adaptive' did not keep it)
      return {
        video_url: p.editVideoUrl, reference_image_url: refs[0] || p.imageUrl,
        resolution: pick(['480P', '768P', '1080P', '2K'], res.toUpperCase(), '768P'),
        aspect_ratio: RELIGHT_RATIOS.some(([r]) => r === p.aspectRatio) ? p.aspectRatio : nearestRatio(p.sourceWidth, p.sourceHeight),
      }
    case 'kling-v4': {
      // The page writes @Image1 / @Video1 / @Element1 - fal's own tags
      const res4 = pick(['720p', '1080p'], res, '1080p')
      const dur = Math.min(30, Math.max(3, parseInt(p.duration) || 5))
      if (batch1007EndpointKey(model, p) === 'kling-v4-t2v') {
        return { prompt: prompt.slice(0, 2500), duration: dur, resolution: res4, aspect_ratio: pick(['16:9', '9:16', '1:1', '21:9'], p.aspectRatio, '16:9') }
      }
      const els = cleanKlingElements(p.klingElements)
      const vids = (p.referenceVideoUrls ?? []).filter(Boolean).slice(0, KLING_V4_MAX_VIDEOS)
      // A start frame counts toward the picture limit
      const imgs = refs.slice(0, KLING_V4_MAX_IMAGES - (p.imageUrl ? 1 : 0))
      return {
        prompt: prompt.slice(0, 2500), duration: dur, resolution: res4,
        aspect_ratio: pick(['auto', '16:9', '9:16', '1:1', '21:9'], p.aspectRatio, '16:9'),
        ...(p.imageUrl ? { start_image_url: p.imageUrl } : {}),
        ...(imgs.length ? { image_urls: imgs } : {}),
        ...(vids.length ? { video_urls: vids } : {}),
        ...(els.length ? { elements: els.map(e => ({ frontal_image_url: e.frontal, reference_image_urls: e.views })) } : {}),
      }
    }
    case 'kling-v4-edit': {
      // The clip is @Video1; its length is kept (fal's default)
      const els = cleanKlingElements(p.klingElements)
      return {
        prompt: prompt.slice(0, 2500), video_url: p.editVideoUrl,
        resolution: pick(['720p', '1080p'], res, '1080p'),
        ...(refs.length ? { image_urls: refs.slice(0, KLING_V4_MAX_IMAGES) } : {}),
        ...(els.length ? { elements: els.map(e => ({ frontal_image_url: e.frontal, reference_image_urls: e.views })) } : {}),
      }
    }
    case 'minimax-h3-max-reframe':
      // The clip is fitted inside the new frame and the rest is outpainted;
      // fal captions the clip itself, so the prompt only steers the new space
      return {
        video_url: p.editVideoUrl,
        aspect_ratio: pick(REFRAME_RATIOS, p.aspectRatio, '16:9'),
        resolution: pick(['480p', '768p', '1080p'], res, '768p'),
        ...(prompt ? { prompt: prompt.slice(0, 5000) } : {}),
      }
    default:
      throw new Error(`Not a 2026-10-07 video model: ${model}`)
  }
}

/** Tickets for a run (fal cost / $0.04, rounded up). */
export function batch1007TicketCost(model: string, o: { duration?: string | number; resolution?: string; sourceSec?: number; sourceFps?: number; refVideoSec?: number }): number {
  const res = String(o.resolution ?? '').toLowerCase()
  let usd: number
  switch (model) {
    case 'vidu-q4':
      usd = Math.min(16, Math.max(3, parseInt(String(o.duration ?? '5')) || 5)) * (VIDU_Q4_USD[res] ?? VIDU_Q4_USD['720p'])
      break
    case 'minimax-h3-max-relight': {
      // Billed per second of output = the source's length (10s when unknown)
      const src = o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10
      // Whole seconds, with a tenth of a second's grace: a "5 s" Kling clip is
      // 5.04 s (121 frames at 24 fps) and was priced as 6 s - 20% over fal's own
      // "a 5-second video at 768p costs $0.40" (2026-10-11)
      usd = Math.ceil(Math.min(RELIGHT_MAX_SEC, Math.max(RELIGHT_MIN_SEC, src)) - 0.1) * (RELIGHT_USD[res] ?? RELIGHT_USD['768p'])
      break
    }
    case 'kling-v4': {
      const out = Math.min(30, Math.max(3, parseInt(String(o.duration ?? '5')) || 5))
      const r = res === '720p' ? '720p' : '1080p'
      // Reference clips: the clip rate on input + output, at least twice the output
      usd = (o.refVideoSec ?? 0) > 0
        ? KLING_V4_CLIP_USD[r] * Math.max(Math.ceil(o.refVideoSec! - 0.05) + out, 2 * out)
        : KLING_V4_USD[r] * out
      break
    }
    case 'kling-v4-edit': {
      // The output is the source's length: billed (source + output), as clip references are
      const src = Math.min(30, Math.max(3, Math.ceil((o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 30) - 0.05)))
      usd = KLING_V4_CLIP_USD[res === '720p' ? '720p' : '1080p'] * 2 * src
      break
    }
    case 'minimax-h3-max-reframe': {
      // Per second of output = the source's length (15s when unknown), whole
      // seconds with Relight's tenth-of-a-second grace
      const src = o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 15
      usd = Math.max(1, Math.ceil(Math.min(BATCH_1007_MAX_SEC['minimax-h3-max-reframe'], src) - 0.1)) * (REFRAME_USD[res] ?? REFRAME_USD['768p'])
      break
    }
    case 'wan-2.2-animate-replace': {
      // Billed frames / 16; an unknown clip is priced as 10s at 30 fps
      const src = o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10
      const fps = o.sourceFps && o.sourceFps > 0 ? o.sourceFps : 30
      usd = Math.ceil((src * fps) / 16) * (WAN_ANIMATE_USD[res] ?? WAN_ANIMATE_USD['720p'])
      break
    }
    case 'dreamactor-v2':
      usd = Math.ceil(Math.min(30, o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10)) * 0.05
      break
    case 'lucy-edit-pro':
      usd = Math.ceil(o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10) * LUCY_USD_PER_SEC
      break
    default:
      usd = 1
  }
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}
