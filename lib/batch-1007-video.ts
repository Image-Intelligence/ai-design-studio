/**
 * The 2026-10-07 video batch (ADMIN ONLY while under test):
 *
 *   generator    Vidu Q4 - a start frame -> 3-16s with native audio (i2v), or
 *                up to 12 reference images -> a scene that keeps them (r2v),
 *                540p to 4K
 *   clip tool    H3 Max Relight - re-lights a clip (up to 15s) from a picture
 *                of a lit sphere, keeping its subjects, motion, camera and audio
 *
 * One place that decides which fal endpoint runs and builds its exact input,
 * called by app/api/video/generate. Every field was checked against the live
 * schemas on 2026-10-07. Pricing: batch1007TicketCost below (fal cost at
 * $0.04 a ticket - Vidu at its REGULAR rates: the 30% promo ends Nov 30).
 */

export const BATCH_1007_GENERATORS = new Set(['vidu-q4'])
export const BATCH_1007_TOOLS = new Set(['minimax-h3-max-relight'])
/** Promoted after a priced, end-to-end run through the portal UI (none yet). */
export const BATCH_1007_PUBLIC = new Set<string>([])

export const BATCH_1007_ENDPOINTS: Record<string, string> = {
  'vidu-q4-i2v': 'fal-ai/vidu/q4/image-to-video',
  'vidu-q4-r2v': 'fal-ai/vidu/q4/reference-to-video',
  'minimax-h3-max-relight': 'minimax/h3-max/relight',
}

/** Vidu Q4: references (r2v) when they are given, else the start frame (i2v). */
export function batch1007EndpointKey(model: string, p: { referenceImageUrls?: string[]; effectiveMode?: string }): string {
  if (model !== 'vidu-q4') return model
  return p.effectiveMode === 'r2v' && (p.referenceImageUrls?.length ?? 0) > 0 ? 'vidu-q4-r2v' : 'vidu-q4-i2v'
}

export const VIDU_Q4_RESOLUTIONS = ['540p', '720p', '1080p', '2k', '4k'] as const
/** fal per second, REGULAR rates (Dec 1 on; the promo until Nov 30 is 30% off). Audio costs nothing extra. */
const VIDU_Q4_USD: Record<string, number> = { '540p': 0.045, '720p': 0.095, '1080p': 0.12, '2k': 0.19, '4k': 0.39 }
/** fal per second of the (source-length) output. */
const RELIGHT_USD: Record<string, number> = { '480p': 0.05, '768p': 0.08, '1080p': 0.16, '2k': 0.32 }
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
          ...base, prompt: prompt.replace(/@Image(\d+)/gi, 'reference $1'), reference_image_urls: refs.slice(0, 12),
          aspect_ratio: pick(['16:9', '9:16', '4:3', '3:4', '1:1'], p.aspectRatio, '16:9'),
          audio: !!p.generateAudio,
        }
      }
      // i2v always has native audio; the prompt is optional
      return { ...base, image_url: p.imageUrl || refs[0], ...(prompt ? { prompt } : {}) }
    }
    case 'minimax-h3-max-relight':
      // The lighting comes from the first reference image (a lit sphere); the
      // output keeps the source's shape (the nearest ratio fal offers)
      return {
        video_url: p.editVideoUrl, reference_image_url: refs[0] || p.imageUrl,
        resolution: pick(['480P', '768P', '1080P', '2K'], res.toUpperCase(), '768P'),
        aspect_ratio: nearestRatio(p.sourceWidth, p.sourceHeight),
      }
    default:
      throw new Error(`Not a 2026-10-07 video model: ${model}`)
  }
}

/** Tickets for a run (fal cost / $0.04, rounded up). */
export function batch1007TicketCost(model: string, o: { duration?: string | number; resolution?: string; sourceSec?: number }): number {
  const res = String(o.resolution ?? '').toLowerCase()
  let usd: number
  switch (model) {
    case 'vidu-q4':
      usd = Math.min(16, Math.max(3, parseInt(String(o.duration ?? '5')) || 5)) * (VIDU_Q4_USD[res] ?? VIDU_Q4_USD['720p'])
      break
    case 'minimax-h3-max-relight': {
      // Billed per second of output = the source's length (10s when unknown)
      const src = o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10
      usd = Math.ceil(Math.min(RELIGHT_MAX_SEC, Math.max(RELIGHT_MIN_SEC, src))) * (RELIGHT_USD[res] ?? RELIGHT_USD['768p'])
      break
    }
    default:
      usd = 1
  }
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}
