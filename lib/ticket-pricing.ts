import { BATCH_1007_GENERATORS, BATCH_1007_TOOLS, batch1007TicketCost } from '@/lib/batch-1007-video'
// ── Ticket pricing: ONE source of truth ──────────────────────────────────────
// The per-generation video ticket cost used to live inline in
// app/api/video/generate/route.ts. It is a BILLING path, so it now lives here
// as a pure function that both the route (which charges) and the admin Ticket
// Economics page (which reasons about margins) call. Every branch, constant and
// rounding rule below is a verbatim lift of the original route code — if you
// change a number here you change what users are charged.
//
// Ticket pack prices also live here so the shop page and the economics page
// cannot drift apart.

/** Video tools take a source clip instead of generating one. */
export const VIDEO_TOOL_MODELS = new Set([
  'flux-video-upscale', 'topaz-upscale-precision', 'topaz-upscale-creative',
  'topaz-upscale-generative', 'seedvr2-video', 'flashvsr-video',
  'kandinsky6-vsr', 'kandinsky6-vsr-lite',
  'bytedance-video-upscale', 'topaz-colorize', 'topaz-deblur',
  'topaz-interpolate', 'topaz-sdr-to-hdr',
  // Luma: restyle (modify / edit) or re-shape (reframe) a source clip
  'luma-ray-2-modify', 'luma-ray-2-flash-modify', 'luma-ray-2-reframe',
  'luma-ray-2-flash-reframe', 'luma-ray-3.2-edit', 'luma-ray-3.2-reframe',
  // 2026-09-28 batch: edit / re-drive / extend a source clip
  'kling-o3-pro-edit', 'kling-o3-pro-reference', 'kling-o3-4k-edit', 'kling-o3-4k-reference',
  'pixverse-v6-extend', 'grok-video-edit', 'grok-video-extend',
  // 2026-09-29 batch: extend / motion + pose transfer
  'veo-3.1-extend', 'veo-3.1-fast-extend', 'minimax-h3-max-extend',
  'marey-motion-transfer', 'marey-pose-transfer',
  'minimax-h3-max-turbo-extend', 'minimax-h3-max-recast',
  // 2026-10-03 batch: remove an object, caption, insert a shot, depth, dub,
  // add sound effects
  'void-video-removal', 'veed-subtitles', 'minimax-h3-max-insert', 'depth-anything-video',
  'heygen-translate', 'heygen-translate-fast', 'mirelo-sfx-video',
  // 2026-10-03 second round: text-prompted tracking masks, audio-only dubbing
  'sam-3.1-video', 'elevenlabs-dubbing',
  // 2026-10-07: re-light a clip from a lit-sphere picture
  'minimax-h3-max-relight',
  // Pixelcut: cut the subject out of a clip
  'pixelcut-video-bg-removal',
])

/**
 * Families whose endpoint is chosen by the inputs given rather than a mode
 * switch: references → r2v, a start image → i2v, otherwise t2v.
 */
export const INPUT_ROUTED_MODELS = new Set([
  'wan-3.0', 'wan-3.0-prime', 'seedance-2.5', 'gemini-omni-1.1', 'ltx-2.5-pro', 'ltx-2.5-fast',
  // 2026-09-28 batch (priced by batch0928TicketCost, ahead of the placeholder)
  'kling-v3-turbo-pro', 'kling-v3-turbo', 'kling-o3-pro', 'kling-o3-4k',
  'pixverse-v6', 'pixverse-c1', 'grok-video-1.5', 'vidu-q3', 'vidu-q3-turbo',
  // 2026-09-29 batch (priced by batch0929TicketCost, ahead of the placeholder)
  'pika-2.2', 'pikaframes', 'pika-2-turbo',
  'hailuo-2.3-pro', 'hailuo-2.3', 'hailuo-2.3-fast-pro', 'hailuo-2.3-fast',
  'veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite',
  'minimax-h3-max-turbo', 'minimax-h3-max-ref',
  'marey', 'seedance-2.0-mini', 'hunyuan-video-1.5',
  // 2026-10-03: references -> r2v, else the start frame (priced by batch1003TicketCost)
  'happy-horse-1.1',
  // 2026-10-07: same routing (priced by batch1007TicketCost)
  'vidu-q4',
])

export interface VideoTicketCostInput {
  model: string
  /** '5', '10', 'auto', … — same shape the API body carries. Default '5'. */
  duration?: string | number
  /** '480p' | '720p' | '1080p' | … Default '1080p'. */
  resolution?: string
  generateAudio?: boolean
  /** Raw client mode ('t2v' | 'i2v' | 'r2v' | 'edit'). Default 't2v'. */
  sd20Mode?: string
  /** Mode after the route's start-image auto-detection. Defaults to sd20Mode. */
  effectiveSd20Mode?: string
  /** How many reference videos were supplied (0 when the field was absent). */
  referenceVideoCount?: number
  referenceVideoDurationSec?: number
  editVideoDurationSec?: number
  lipsyncVideoDurationSec?: number
  motionVideoDurationSec?: number
  /** 'image' | 'video' — only used as the kling-v3-motion duration fallback. */
  characterOrientation?: string
  videoUpscaleFactor?: string | number
  /** Reference images sent (Grok bills $0.01 each). */
  referenceImageCount?: number
  /** A start image was sent (Grok bills it like a reference). */
  hasStartImage?: boolean
  /** An end frame was sent (Veo's first-last-frame mode is 8s only). */
  hasEndImage?: boolean
  /** Frames per second asked for (LTX 2.5 Fast: 48/50fps cap the length at 10s). */
  fps?: string | number
  /** Video tools' creativity 0-1 (Flux Video Upscale: >= 0.5 is its dearer creative mode). */
  videoCreativity?: string | number
  /** The source clip as MEASURED by the server (lib/video-probe) - video tools priced by output size. */
  sourceHeight?: number
  sourceWidth?: number
  sourceFps?: number
  /** Topaz interpolate's target frame rate. */
  targetFps?: string | number
  /** The uploaded audio's MEASURED length (audio-driven models: lip sync, music video). */
  audioDurationSec?: number
  /** The model's single choice (VEED's caption style decides its tier). */
  videoChoice?: string
  /** The prompt's word count (HeyGen Avatar IV bills the seconds the script takes to say). */
  promptWords?: number
}

/*
 * Topaz video tools, from fal's published rules (2026-10-01). fal bills by the
 * OUTPUT's resolution tier, frame rate and length; its examples are per 10s at
 * 30 fps, and 60 fps costs double. Per 10 seconds:
 *   upscale precision    $0.10 720p / $0.20 1080p / $0.60 4K
 *   upscale creative     $3.00 up to 1080p / $5.00 4K   (Astra 2)
 *   upscale generative   $1.20 / $2.60                  (Starlight Precise 2.6)
 *   colorize, deblur     $0.10 / $0.30
 *   SDR -> HDR           $2.40 / $5.10                  (Hyperion 2.5)
 *   interpolate          $0.30 / $0.60 per 30 NEW fps   (Apollo / Chronos)
 * The source is measured by /api/video/generate (height, fps, length); the
 * upscalers multiply the height by the factor. Unmeasured = 1080p at 30 fps.
 * Billed at fal cost / $0.04 a ticket - 50% at the $0.08 subscription ticket.
 */
/*
 * The three plain video upscalers, from fal's published rules (2026-10-02):
 *   SeedVR2   $0.001  per megapixel of OUTPUT video data (width x height x frames)
 *   FlashVSR  $0.0005 per megapixel of output video data
 *   ByteDance $0.0072 / $0.0144 / $0.0288 per second at 1080p / 2K / 4K output,
 *             at 30 fps; 60 fps doubles it (standard tier - the route pins it;
 *             'pro' would be 10x). The route keeps the source's frame rate and
 *             caps the output at 4K (6K/8K are unpriced), and its scale_ratio
 *             minimum is 1.1.
 * The source is measured by /api/video/generate; unmeasured = 1920x1080 at
 * 30 fps. Billed at fal cost / $0.04 a ticket - 50% at the $0.08 ticket.
 */
export const BYTEDANCE_UPSCALE_MAX_SHORT_EDGE = 2160
/** Kandinsky 6.0 VSR takes exactly these factors (2.25 = 480p -> 1080p). */
export const KANDINSKY_VSR_FACTORS = [2, 2.25, 4]
export function bytedanceUpscaleRatio(factor: number, shortEdge: number): number {
  return Math.max(1.1, Math.min(factor, BYTEDANCE_UPSCALE_MAX_SHORT_EDGE / Math.max(1, shortEdge)))
}
export function upscalerVideoTicketCost(model: string, o: { seconds: number; width?: number; height?: number; fps?: number; factor?: number }): number {
  const sec = Math.max(1, o.seconds || 5)
  const w = o.width && o.width > 0 ? o.width : 1920
  const h = o.height && o.height > 0 ? o.height : 1080
  const fps = o.fps && o.fps > 0 ? o.fps : 30
  const factor = Math.max(1, Math.min(4, o.factor || 2))
  let usd: number
  if (model === 'kandinsky6-vsr' || model === 'kandinsky6-vsr-lite') {
    // fal 2026-10-06: $0.00036 per OUTPUT megapixel per frame (both, at their
    // default steps). The clip is resampled to 24fps and capped at 121 frames
    // (~5s) - only that much is upscaled, and only that much is billed.
    const f = KANDINSKY_VSR_FACTORS.includes(factor) ? factor : 2.25
    const frames = Math.min(121, Math.ceil(sec * 24))
    usd = (w * f) * (h * f) / 1e6 * frames * 0.00036
  } else if (model === 'bytedance-video-upscale') {
    const outShort = Math.min(w, h) * bytedanceUpscaleRatio(factor, Math.min(w, h))
    const rate = outShort <= 1080 ? 0.0072 : outShort <= 1440 ? 0.0144 : 0.0288
    const outFps = Math.max(24, Math.min(60, Math.round(fps)))
    usd = rate * Math.max(1, outFps / 30) * sec
  } else {
    const mpFrames = (w * factor) * (h * factor) * Math.ceil(sec * fps) / 1e6
    usd = mpFrames * (model === 'flashvsr-video' ? 0.0005 : 0.001)
  }
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}

export function topazVideoTicketCost(model: string, o: { seconds: number; height?: number; fps?: number; factor?: number; targetFps?: number }): number {
  // To the tenth of a second (4.03s bills as 4.1s, not 5s); at least 1s
  const sec = Math.max(1, Math.ceil((o.seconds || 5) * 10) / 10)
  const srcH = o.height && o.height > 0 ? o.height : 1080
  const srcFps = o.fps && o.fps > 0 ? o.fps : 30
  const upscale = model.startsWith('topaz-upscale')
  const outH = upscale ? srcH * Math.max(1, Math.min(4, o.factor || 2)) : srcH
  const tier = outH <= 720 ? 0 : outH <= 1080 ? 1 : 2      // 720p / 1080p / 4K
  const per10: Record<string, [number, number, number]> = {
    'topaz-upscale-precision':  [0.10, 0.20, 0.60],
    'topaz-upscale-creative':   [3.00, 3.00, 5.00],
    'topaz-upscale-generative': [1.20, 1.20, 2.60],
    'topaz-colorize':           [0.10, 0.10, 0.30],
    'topaz-deblur':             [0.10, 0.10, 0.30],
    'topaz-sdr-to-hdr':         [2.40, 2.40, 5.10],
  }
  let usd: number
  if (model === 'topaz-interpolate') {
    const target = Math.max(16, Math.min(120, o.targetFps || 60))
    const newFps = Math.max(0, target - srcFps)
    usd = (tier === 2 ? 0.6 : 0.3) * (newFps / 30) * (sec / 10)
  } else {
    const rates = per10[model] ?? [0.6, 0.6, 0.6]
    usd = rates[tier] * (sec / 10) * Math.max(1, srcFps / 30)
  }
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}

/*
 * Topaz image tools, priced from what fal bills (2026-10-01): $0.08 per
 * STARTED block of OUTPUT megapixels, the block depending on the tool and its
 * model. 2 tickets per block = a 50% margin at the $0.08 subscription ticket.
 * Upscales multiply the source's pixel count by factor^2 (Transparent is a
 * fixed 4x). The source is measured by /api/generate; an unmeasured one is
 * priced as 4.2MP (2048x2048), the size most generations here come out at.
 *   precision / transparent / adjust      24 MP
 *   creative (Bloom family)                2 MP
 *   generative: Wonder 3 / 3.5             8 MP, the rest 4 MP
 *   sharpen: Super Focus V2/V3 20 MP, the rest 24 MP
 *   denoise: Denoise Max 20 MP, the rest 24 MP
 *   restore: Recover 3 4 MP, Dust-Scratch V2 24 MP
 */
export function topazImageTicketCost(model: string, o: { topazModel?: string; upscaleFactor?: number | string; width?: number; height?: number }): number {
  const srcMP = o.width && o.height ? (o.width * o.height) / 1e6 : 4.2
  const f = Math.max(1, Math.min(4, Number(o.upscaleFactor) || 2))
  const m = String(o.topazModel ?? '')
  let outMP = srcMP, block = 24
  switch (model) {
    case 'topaz-img-upscale-precision':   outMP = srcMP * f * f; block = 24; break
    case 'topaz-img-upscale-creative':    outMP = srcMP * f * f; block = 2; break
    case 'topaz-img-upscale-generative':  outMP = srcMP * f * f; block = m === 'Wonder 3' || m === 'Wonder 3.5' || !m ? 8 : 4; break
    case 'topaz-img-upscale-transparent': outMP = srcMP * 16; block = 24; break
    case 'topaz-sharpen':                 block = m.startsWith('Super Focus') ? 20 : 24; break
    case 'topaz-denoise':                 block = m === 'Denoise Max' ? 20 : 24; break
    case 'topaz-restore':                 block = m === 'Dust-Scratch V2' ? 24 : 4; break
    default:                              block = 24   // topaz-adjust
  }
  return 2 * Math.max(1, Math.ceil(outMP / block - 1e-9))
}

/**
 * LTX 2.5 Fast: the length that will actually render. fal's enum is 6-20s in
 * steps of 2, but 48/50fps - and 1440p/2160p at any rate - stop at 10s, so a
 * longer ask is a 422 after the charge. Shared by the route (what is sent) and
 * the price (what is billed). 'auto' is sent as a concrete 10s: LTX's own
 * auto can run to 20s at 720p, which no fixed price covers.
 */
export function ltxFastSeconds(duration: string | number, resolution: string, fps?: string | number): number {
  const wanted = String(duration) === 'auto' ? 10 : parseInt(String(duration)) || 10
  const cap = Number(fps) >= 48 || resolution === '1440p' || resolution === '2160p' ? 10 : 20
  const allowed = [6, 8, 10, 12, 14, 16, 18, 20].filter(d => d <= cap)
  return allowed.reduce((best, d) => Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best, allowed[0])
}

/**
 * Tickets charged for one video generation. Extracted verbatim from
 * app/api/video/generate/route.ts — keep the two in lockstep.
 */
export function videoTicketCost(input: VideoTicketCostInput): number {
  const model = input.model
  const duration = String(input.duration ?? '5')
  const resolution = input.resolution ?? '1080p'
  const generateAudio = !!input.generateAudio
  const sd20Mode = input.sd20Mode ?? 't2v'
  const effectiveSd20Mode = input.effectiveSd20Mode ?? sd20Mode
  const referenceVideoCount = input.referenceVideoCount ?? 0
  const referenceVideoDurationSec = input.referenceVideoDurationSec ?? 0
  const editVideoDurationSec = input.editVideoDurationSec ?? 0
  const lipsyncVideoDurationSec = input.lipsyncVideoDurationSec ?? 0
  const motionVideoDurationSec = input.motionVideoDurationSec
  const characterOrientation = input.characterOrientation ?? 'image'
  const videoUpscaleFactor = String(input.videoUpscaleFactor ?? '2')
  const videoCreativity = Number(input.videoCreativity ?? 0) || 0

  const isLipsync = model === 'lipsync-v3'
  const isWanLora = model === 'wan-2.2-lora'

  let ticketCost: number
  if (model === 'pixelcut-looping-video' || model === 'pixelcut-video-bg-removal') {
    // Ahead of the generic tool branch, which would price by a flat placeholder
    ticketCost = pixelcutVideoTicketCost(model, { duration, sourceSec: editVideoDurationSec, sourceFps: input.sourceFps })
  } else if (isLipsync) {
    ticketCost = Math.max(10, Math.ceil((lipsyncVideoDurationSec || 0) * 6));
  } else if (model === 'kling-v3-motion') {
    // 6 tickets/sec × actual video duration (or max if unknown)
    const fallbackSec = characterOrientation === 'video' ? 30 : 10;
    const sec = motionVideoDurationSec ? Math.ceil(motionVideoDurationSec) : fallbackSec;
    ticketCost = sec * 6;
  } else if (model === 'kling-o3') {
    const pricing: Record<string, number> = {
      '3': 15, '4': 18, '5': 20, '6': 24, '7': 28,
      '8': 32, '9': 36, '10': 40, '11': 44, '12': 48,
      '13': 52, '14': 56, '15': 60,
    };
    ticketCost = pricing[duration] || 20;
  } else if (model === 'kling-v3') {
    ticketCost = parseInt(duration) * (generateAudio ? 8 : 6);
  } else if (model === 'seedance-1.5') {
    const resMultiplier = resolution === '1080p' ? 2.25 : resolution === '480p' ? 0.5 : 1.0
    const audioMultiplier = generateAudio ? 1.0 : 0.5
    ticketCost = Math.ceil(parseInt(duration) * 2.0 * resMultiplier * audioMultiplier) + 1
  } else if (model === 'seedance-2.0') {
    // fal's SeeDance 2.0 has no 1080p (480p/720p only) — 720p is the 1.0x base
    const resMultiplier = resolution === '480p' ? 0.5 : 1.0
    const hasVideoRefs = sd20Mode === 'r2v' && referenceVideoCount > 0
    const videoInputMultiplier = hasVideoRefs ? 0.6 : 1.0
    const outputDurSec = duration === 'auto' ? 5 : parseInt(duration)
    const effectiveDur = outputDurSec + (hasVideoRefs ? (referenceVideoDurationSec || 0) : 0)
    ticketCost = Math.ceil(effectiveDur * 15 * resMultiplier * videoInputMultiplier)
  } else if (model === 'seedance-2.0-fast') {
    // 12 tickets/sec at 720p; 480p = 0.5x
    const resMultiplier = resolution === '480p' ? 0.5 : 1.0
    const hasVideoRefs = sd20Mode === 'r2v' && referenceVideoCount > 0
    const videoInputMultiplier = hasVideoRefs ? 0.6 : 1.0
    const outputDurSec = duration === 'auto' ? 5 : parseInt(duration)
    const effectiveDur = outputDurSec + (hasVideoRefs ? (referenceVideoDurationSec || 0) : 0)
    ticketCost = Math.ceil(effectiveDur * 12 * resMultiplier * videoInputMultiplier)
  } else if (model === 'gemini-omni-flash') {
    // fal bills this one by tokens: about $0.125-0.13 per second of (720p)
    // output, plus a sliver for input video tokens in edit mode. 4 tickets a
    // second is $0.32 at the $0.08 subscription ticket - about a 59% margin.
    // Edit renders the SOURCE clip's length, so that is what is billed (min
    // 3s, 8s when unknown); otherwise fal's 3-10s range.
    const sec = effectiveSd20Mode === 'edit'
      ? Math.max(3, Math.ceil(editVideoDurationSec || 8))
      : Math.min(10, Math.max(3, parseInt(duration) || 8));
    ticketCost = sec * 4;
  } else if (model === 'gemini-omni-1.1') {
    // Ahead of the input-routed placeholder. fal: $0.03 / $0.10 / $0.15 /
    // $0.30 per second at 360p / 720p / 1080p / 4K. 1 / 3 / 4 / 8 tickets a
    // second = 62 / 58 / 53 / 53% margin at the $0.08 subscription ticket.
    // Anything else renders at 720p (the route's fallback), so it bills as 720p.
    const perSec = resolution === '4k' ? 8 : resolution === '1080p' ? 4 : resolution === '360p' ? 1 : 3;
    const sec = effectiveSd20Mode === 'edit'
      ? Math.max(3, Math.ceil(editVideoDurationSec || 8))
      : Math.min(10, Math.max(3, parseInt(duration) || 8));
    ticketCost = sec * perSec;
  } else if (model === 'wan-2.7') {
    // PLACEHOLDER — modeled on Wan 2.5's per-second rates (1080p 20/5s = 4/s,
    // 720p 13/5s = 2.6/s). ADMIN ONLY until priced manually.
    const sec = parseInt(duration) || 5;
    ticketCost = Math.ceil(sec * (resolution === '1080p' ? 4 : 2.6));
  } else if (isWanLora) {
    // PLACEHOLDER — ADMIN ONLY until priced. A14B renders ~81 frames @16fps ≈ 5s
    const sec = Math.ceil((parseInt(duration) || 5));
    ticketCost = Math.ceil(sec * (resolution === '720p' ? 4 : 2.6));
  } else if (model.startsWith('luma-ray-')) {
    // Before the generic tool branch: the Luma tools price by their own rates
    ticketCost = lumaTicketCost(model, duration, resolution, editVideoDurationSec, !!input.hasStartImage)
  } else if (BATCH_1007_GENERATORS.has(model) || BATCH_1007_TOOLS.has(model)) {
    // Ahead of the generic tool branch: Vidu Q4 by length x resolution, Relight by the source's length
    ticketCost = batch1007TicketCost(model, { duration, resolution, sourceSec: editVideoDurationSec })
  } else if (BATCH_1003_MODELS.has(model)) {
    // Ahead of the generic tool branch: these price by their own rates
    ticketCost = batch1003TicketCost(model, {
      duration, resolution, sourceSec: editVideoDurationSec, sourceHeight: input.sourceHeight,
      audioSec: input.audioDurationSec, choice: input.videoChoice, refs: input.referenceImageCount ?? 0,
      sourceFps: input.sourceFps, promptWords: input.promptWords,
    })
  } else if (BATCH_0929_MODELS.has(model)) {
    ticketCost = batch0929TicketCost(model, {
      // Veo's references and first-last-frame modes render 8s whatever is asked
      duration: model.startsWith('veo-3.1') && !model.endsWith('extend') && ((input.referenceImageCount ?? 0) > 0 || (input.hasEndImage && input.hasStartImage)) ? '8' : duration,
      resolution, generateAudio, refs: input.referenceImageCount ?? 0,
      sourceSec: editVideoDurationSec, startImage: !!input.hasStartImage,
    })
  } else if (BATCH_0928_MODELS.has(model)) {
    // Also ahead of the generic tool and input-routed placeholder branches
    ticketCost = batch0928TicketCost(model, {
      duration, resolution, generateAudio, sourceSec: editVideoDurationSec,
      refs: input.referenceImageCount ?? 0, startImage: !!input.hasStartImage,
    })
  } else if (model === 'flux-video-upscale') {
    /*
     * fal bills per second of OUTPUT by the output's tier and the mode:
     * precise $0.14 / $0.25 / $0.55 and creative $0.20 / $0.35 / $0.79 at
     * 1080p / 2K / 4K. The source's resolution is not known when this is
     * priced, so it is assumed to be 1080p (the dearer case): 1.5x lands in
     * the 2K tier and 2x or more in 4K. Billed at fal cost / $0.04 a ticket
     * (50% at the $0.08 subscription ticket) on the source clip's length.
     */
    const sec = Math.max(1, Math.ceil(editVideoDurationSec || 5))
    const factor = Math.max(1.5, Math.min(3, parseFloat(videoUpscaleFactor) || 2))
    // Measured source when the server has one; else assume 1080p (dearer)
    const outH = (input.sourceHeight && input.sourceHeight > 0 ? input.sourceHeight : 1080) * factor
    const tier = outH <= 1080 ? 0 : outH <= 1440 ? 1 : 2   // 0 = 1080p, 1 = 2K, 2 = 4K
    const rate = (videoCreativity >= 0.5 ? [0.2, 0.35, 0.79] : [0.14, 0.25, 0.55])[tier]
    ticketCost = Math.max(1, Math.ceil((sec * rate) / 0.04 - 1e-9))
  } else if (model.startsWith('topaz-')) {
    ticketCost = topazVideoTicketCost(model, {
      seconds: editVideoDurationSec, height: input.sourceHeight, fps: input.sourceFps,
      factor: parseFloat(videoUpscaleFactor) || 2, targetFps: Number(input.targetFps) || 60,
    })
  } else if (model === 'seedvr2-video' || model === 'flashvsr-video' || model === 'bytedance-video-upscale' || model === 'kandinsky6-vsr' || model === 'kandinsky6-vsr-lite') {
    ticketCost = upscalerVideoTicketCost(model, {
      seconds: editVideoDurationSec, width: input.sourceWidth, height: input.sourceHeight,
      fps: input.sourceFps, factor: parseFloat(videoUpscaleFactor) || 2,
    })
  } else if (VIDEO_TOOL_MODELS.has(model)) {
    // PLACEHOLDER — ADMIN ONLY until priced. Billed against the SOURCE clip's
    // length, since that is what these process.
    const sec = Math.max(1, Math.ceil(editVideoDurationSec || 5));
    const factor = Math.max(1, Math.min(4, parseFloat(videoUpscaleFactor) || 2));
    ticketCost = Math.ceil(sec * 2 * factor);
  } else if (model === 'seedance-2.5') {
    /*
     * Priced from fal's published rates (2026-09-27): $0.2205/s at 480p,
     * $0.473/s at 720p, $1.164/s at 1080p. The target is a 50% gross margin
     * even on the cheapest ticket anyone can buy - a subscription ticket,
     * $20 / 250 = $0.08 - which is ~64% on pack tickets, before processor
     * fees. The old placeholder (4.5/s at 1080p) lost ~$0.68 a second.
     *   480p   6/s  = $0.48/s at $0.08   (cost $0.2205)
     *   720p  12/s  = $0.96/s            (cost $0.473)
     *   1080p 30/s  = $2.40/s            (cost $1.164)
     * Video references are billed by fal too (their seconds added to the
     * output's, the total at 0.6x), exactly as SeeDance 2.0 is here. 'auto'
     * lets fal pick the length, so it is billed as 10s rather than a
     * 5s that it can overrun. Durations follow the route's 4-12s clamp.
     */
    const perSec = resolution === '480p' ? 6 : resolution === '720p' ? 12 : 30
    const hasVideoRefs = effectiveSd20Mode === 'r2v' && referenceVideoCount > 0
    const outputDurSec = duration === 'auto' ? 10 : Math.min(12, Math.max(4, parseInt(duration) || 5))
    const effectiveDur = outputDurSec + (hasVideoRefs ? (referenceVideoDurationSec || 0) : 0)
    ticketCost = Math.ceil(effectiveDur * perSec * (hasVideoRefs ? 0.6 : 1.0))
  } else if (model === 'ltx-2.5-pro') {
    /*
     * Priced from fal's published rates (2026-09-27): $0.12/s at 720p and
     * $0.17/s at 1080p, native audio included. Against the cheapest ticket
     * anyone can buy ($0.08, a subscription ticket) these rates clear a 50%
     * margin; on pack tickets it is ~55-65%:
     *   720p   3/s   = $0.24/s at $0.08   (cost $0.12)
     *   1080p  4.5/s = $0.36/s            (cost $0.17)
     * The route snaps the length to the 6/8/10s the endpoint accepts, so
     * this bills the SNAPPED length - a "5s" request renders (and costs) 6s.
     * 'auto' lets LTX pick, anywhere up to 10s (a test clip came back 4.2s),
     * so it is billed as 8s: still ~41% margin if it runs the full 10s.
     */
    const wanted = parseInt(duration) || 0
    const sec = duration === 'auto' || !wanted ? 8
      : [6, 8, 10].reduce((best, d) => Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best, 6)
    ticketCost = Math.ceil(sec * (resolution === '720p' ? 3 : 4.5))
  } else if (model === 'ltx-2.5-fast') {
    /*
     * fal (2026-10-01): $0.09 / $0.13 / $0.19 / $0.30 per second at 720p /
     * 1080p / 1440p / 2160p, native audio included. 2.5 / 3.5 / 5 / 8 tickets
     * a second = a 55 / 54 / 52 / 53% margin at the $0.08 subscription ticket,
     * and below LTX 2.5 Pro at every shared resolution. Bills the length the
     * route actually sends (ltxFastSeconds - 'auto' is sent as 10s).
     */
    const perSec = resolution === '2160p' ? 8 : resolution === '1440p' ? 5 : resolution === '720p' ? 2.5 : 3.5
    ticketCost = Math.ceil(ltxFastSeconds(duration, resolution, input.fps) * perSec)
  } else if (model === 'wan-3.0' || model === 'wan-3.0-prime') {
    /*
     * fal (2026-10-01), per second: Wan 3.0 $0.05 / $0.10 / $0.20 and Prime
     * $0.068 / $0.14 / $0.28 at 480p / 720p / 1080p. Tickets a second:
     *   Wan 3.0  2 / 3 / 5      = 69 / 58 / 50% margin at the $0.08 ticket
     *   Prime    2 / 3.5 / 7    = 57 / 50 / 50%
     * The route sends 5s for 'auto' and anything else as asked (min 2s), and
     * an unknown resolution as 1080p - billed the same way.
     */
    const prime = model === 'wan-3.0-prime'
    const res = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '1080p'
    const perSec = res === '480p' ? 2 : res === '720p' ? (prime ? 3.5 : 3) : (prime ? 7 : 5)
    const sec = duration === 'auto' ? 5 : Math.max(2, parseInt(duration) || 5)
    ticketCost = Math.ceil(sec * perSec)
  } else if (INPUT_ROUTED_MODELS.has(model)) {
    // PLACEHOLDER — ADMIN ONLY until priced. Scaled by resolution the same
    // way the other per-second models are.
    const sec = duration === 'auto' ? 5 : Math.min(20, Math.max(3, parseInt(duration) || 5));
    const perSec = resolution === '4k' ? 9 : resolution === '2160p' ? 9
      : resolution === '1440p' ? 6 : resolution === '1080p' ? 4.5
      : resolution === '720p' ? 3 : 2;
    ticketCost = Math.ceil(sec * perSec);
  } else if (model === 'minimax-h3-max') {
    // fal's launch discount ended 2026-09-30; list price is $0.05 / $0.08 per
    // second at 480P / 768P (the two the route sends). Billed at fal cost /
    // $0.04 a ticket = 50% at the $0.08 subscription ticket. 5-15s, as sent.
    const sec = Math.min(15, Math.max(5, parseInt(duration) || 5));
    ticketCost = Math.ceil((sec * (resolution === '480p' ? 0.05 : 0.08)) / 0.04 - 1e-9);
  } else if (model === 'flux-3') {
    /*
     * fal (2026-10-01), per second of generated video: $0.17 / $0.29 at 720p /
     * 1080p for text, image, first-last and keyframes; extend is $0.41 / $0.53.
     * 4.5 / 7.5 and 11 / 14 tickets a second = a 52-53% margin at the $0.08
     * subscription ticket (the old placeholder's 4/s LOST money on extend).
     * 'auto' is never sent to fal: its own auto ran a test clip to 15s (and
     * can reach 20s), which no fixed price covers. The route sends 10s for it
     * - 5s for first-last and keyframes - and that is what is billed.
     */
    const extend = effectiveSd20Mode === 'edit'
    const pinned = effectiveSd20Mode === 'r2v' || !!input.hasEndImage
    const sec = duration === 'auto' ? (pinned ? 5 : 10) : Math.min(20, Math.max(5, parseInt(duration) || 5));
    const perSec = extend ? (resolution === '1080p' ? 14 : 11) : (resolution === '1080p' ? 7.5 : 4.5)
    ticketCost = Math.ceil(sec * perSec);
  } else if (model === 'happy-horse') {
    ticketCost = parseInt(duration) * (resolution === '1080p' ? 12 : 7);
  } else {
    const pricing: Record<string, Record<string, number>> = {
      '480p':  { '5': 7,  '10': 14 },
      '720p':  { '5': 13, '10': 26 },
      '1080p': { '5': 20, '10': 40 },
    };
    ticketCost = pricing[resolution]?.[duration] || 20;
  }
  return ticketCost
}

/**
 * Tickets charged to a Dev-Tier subscriber.
 *
 * There is deliberately no discount here: /api/video/generate accepts a
 * `hasDevTier` flag in its body and never reads it, so every tier is billed the
 * same amount. See DEV_TIER_PRICING_NOTES for the one stale UI that still
 * *displays* a dev rate.
 */
export function videoTicketCostDev(input: VideoTicketCostInput): number {
  return videoTicketCost(input)
}

/**
 * Per-model warnings about tier pricing. Only models with a real caveat appear.
 */
export const DEV_TIER_PRICING_NOTES: Record<string, string> = {
  'kling-v3':
    'The legacy /admin/video-scanner-kling-o3 page displays 4/sec (3/sec dev) for Kling 3.0, ' +
    'but the billing route and portal-v2 both charge 6/sec (8/sec with audio) for every tier. ' +
    'The display is stale, not a discount.',
}

// ── Ticket packs ─────────────────────────────────────────────────────────────
// Dev Tier discount is 10% (cut from 20/30% on 2026-07-29 — keep in sync with
// the subscribe page, shop dropdown, and dashboard copy)
//
// Re-cut 2026-10-04 for CCBill, which caps a single charge at $99.99: the old
// 1000-for-$120 pack could not be sold, so the ladder now tops out at 825 for
// $99 (the same $0.12 a ticket) and gains in-between steps. Every step is a
// whole-dollar price and is cheaper per ticket than the one before it.
//
// Margin floor: model prices are set so a ticket costs fal at most $0.04 -
// half of the $0.08 subscription ticket. Packs never go below that: the
// cheapest pack ticket is $0.108 (825 pack, Dev Tier), so every model keeps
// >= 63% gross before processor fees and no model price had to move.
export interface TicketPackage {
  tickets: number
  freeTierPrice: number
  devTierPrice: number
  /** Short name shown on the shop card. */
  name?: string
  popular?: boolean
  bestValue?: boolean
}

export const TICKET_PACKAGES: TicketPackage[] = [
  { tickets: 25,  name: 'Single',    freeTierPrice: 5.00,  devTierPrice: 4.50  },
  { tickets: 50,  name: 'Spark',     freeTierPrice: 9.00,  devTierPrice: 8.10  },
  { tickets: 100, name: 'Stack',     freeTierPrice: 16.00, devTierPrice: 14.40 },
  { tickets: 175, name: 'Reel',      freeTierPrice: 26.00, devTierPrice: 23.40 },
  { tickets: 250, name: 'Tower',     freeTierPrice: 35.00, devTierPrice: 31.50, popular: true },
  { tickets: 375, name: 'Case',      freeTierPrice: 50.00, devTierPrice: 45.00 },
  { tickets: 500, name: 'Chest',     freeTierPrice: 65.00, devTierPrice: 58.50 },
  { tickets: 650, name: 'Dispenser', freeTierPrice: 82.00, devTierPrice: 73.80 },
  { tickets: 825, name: 'Vault',     freeTierPrice: 99.00, devTierPrice: 89.10, bestValue: true },
]

/** CCBill's ceiling for one charge - no pack may cost more. */
export const MAX_SINGLE_CHARGE_USD = 99.99

/** USD a single ticket cost the buyer, per pack and tier. */
export function usdPerTicket(pack: TicketPackage, tier: 'free' | 'dev'): number {
  return (tier === 'dev' ? pack.devTierPrice : pack.freeTierPrice) / pack.tickets
}

// ── Video model catalogue for the economics page ─────────────────────────────
// Only UI affordances live here (which knobs a row shows). Cost always comes
// from videoTicketCost() above.

export type VideoDurationSource = 'none' | 'lipsync' | 'motion' | 'source-clip'

export interface VideoModelPricingSpec {
  id: string
  label: string
  kind: 'generator' | 'tool'
  /** Duration choices offered on the row; empty when duration is not a knob. */
  durations: string[]
  /** Resolution choices offered on the row; empty when resolution is ignored. */
  resolutions: string[]
  supportsAudio: boolean
  /** Where the billed seconds come from when it is not the duration dropdown. */
  durationSource: VideoDurationSource
  /** Show the 1x-4x upscale factor knob (video tools only). */
  showUpscaleFactor?: boolean
  note?: string
}

/*
 * Luma Ray 2 / Ray 2 Flash / Ray 3.2 - priced from fal's published rates
 * (2026-09-28) for a >=50% gross margin at the cheapest ticket anyone can buy
 * ($0.08, a subscription ticket): tickets = ceil(fal cost / $0.04).
 *
 *   Ray 2, Ray 3.2   $0.50 per 5s at 540p; 720p x2, 1080p x4; 9s/10s x2
 *   Ray 3.2 from a start image (5s) is cheaper: $0.15 / $0.30 / $1.20 at
 *                    540p / 720p / 1080p (10s from an image is keyframed and
 *                    stays on the text-to-video rate - the dearer case)
 *   Ray 2 Flash      $0.20 per 5s at 540p; same multipliers
 *   Ray 3.2 edit     $0.72 / $1.08 / $2.16 per 5s (540p/720p/1080p); 10s x2
 *   Ray 3.2 reframe  $0.06 / $0.12 / $0.36 per started source second
 *   Ray 2 modify     $0.35/s   (Flash $0.12/s)  - per second of the clip
 *   Ray 2 reframe    $0.20/s   (Flash $0.06/s)
 *
 * The tools bill the SOURCE clip's length; when the client couldn't read it,
 * 10s is assumed - the longest these endpoints take - so a run is never under-
 * charged. HDR is never requested, so its surcharge never applies.
 */
const LUMA_TICKET_USD = 0.04
function lumaTicketCost(model: string, duration: string, resolution: string, sourceSec: number, fromImage = false): number {
  const res = resolution === '1080p' ? '1080p' : resolution === '720p' ? '720p' : '540p'
  const resX = res === '1080p' ? 4 : res === '720p' ? 2 : 1
  const secs = Math.ceil(sourceSec > 0 ? sourceSec : 10)
  let usd: number
  switch (model) {
    case 'luma-ray-2':        usd = 0.5 * resX * (parseInt(duration) >= 9 ? 2 : 1); break
    case 'luma-ray-2-flash':  usd = 0.2 * resX * (parseInt(duration) >= 9 ? 2 : 1); break
    case 'luma-ray-3.2':
      usd = fromImage && parseInt(duration) < 10
        ? { '540p': 0.15, '720p': 0.3, '1080p': 1.2 }[res]
        : 0.5 * resX * (parseInt(duration) >= 10 ? 2 : 1)
      break
    // Output length follows the source: 10s past 5.5s of source, else 5s
    case 'luma-ray-3.2-edit': usd = { '540p': 0.72, '720p': 1.08, '1080p': 2.16 }[res] * (secs > 5.5 ? 2 : 1); break
    case 'luma-ray-3.2-reframe': usd = Math.min(secs, 10) * { '540p': 0.06, '720p': 0.12, '1080p': 0.36 }[res]; break
    case 'luma-ray-2-modify':        usd = secs * 0.35; break
    case 'luma-ray-2-flash-modify':  usd = secs * 0.12; break
    case 'luma-ray-2-reframe':       usd = secs * 0.20; break
    case 'luma-ray-2-flash-reframe': usd = secs * 0.06; break
    default: usd = 0.5 * resX
  }
  // A hair under the division so a cost that lands exactly on a ticket
  // boundary (25.000000001 from float maths) isn't rounded up a whole ticket
  return Math.max(1, Math.ceil(usd / LUMA_TICKET_USD - 1e-9))
}

/*
 * The 2026-09-28 batch - priced from fal's published rates that day, with the
 * same rule as Luma: tickets = ceil(fal cost / $0.04), a >=50% gross margin at
 * the cheapest ticket anyone can buy ($0.08, a subscription ticket).
 *
 *   Kling V3 Turbo       $0.14/s (Pro), $0.112/s (Standard); 3-15s
 *   Kling O3 Pro         $0.112/s, $0.14/s with native audio; 3-15s
 *   Kling O3 4K          $0.42/s; 3-15s
 *   Kling O3 video edit / reference   the tier's rate per second of clip
 *   PixVerse V6          360p .025 / 540p .035 / 720p .045 / 1080p .09 per s
 *                        (+audio: .035 / .045 / .06 / .115); 1-15s
 *   PixVerse C1          .03 / .04 / .05 / .095 (+audio .04 / .05 / .065 / .12)
 *   Grok Imagine 1.5     480p .08 / 720p .14 / 1080p .25 per s, +$0.01 per
 *                        reference or start image
 *   Grok video edit      $0.08/s of the clip (720p; fal caps the input)
 *   Grok video extend    $0.07/s of extension + $0.01/s of the source
 *   Vidu Q3              $0.07/s at 360-540p, x2.2 at 720-1080p; Turbo half
 *
 * Tools bill the SOURCE clip's length; unknown lengths assume the longest the
 * endpoint takes, so a run is never under-charged.
 */
const BATCH_0928_MODELS = new Set([
  'kling-v3-turbo-pro', 'kling-v3-turbo', 'kling-o3-pro', 'kling-o3-4k',
  'pixverse-v6', 'pixverse-c1', 'grok-video-1.5', 'vidu-q3', 'vidu-q3-turbo',
  'grok-video-1.5-lite',
  'kling-o3-pro-edit', 'kling-o3-pro-reference', 'kling-o3-4k-edit', 'kling-o3-4k-reference',
  'pixverse-v6-extend', 'grok-video-edit', 'grok-video-extend',
])
/** Seconds as the route will send them: clamped to what each endpoint takes. */
export function batch0928Seconds(model: string, duration: string): number {
  const d = parseInt(duration) || 5
  const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(hi, d))
  if (model.startsWith('kling-')) return clamp(3, 15)
  if (model.startsWith('vidu-')) return clamp(1, 16)
  // Grok extend's schema: the extension is 2-10 seconds
  if (model === 'grok-video-extend') return clamp(2, 10)
  return clamp(1, 15)
}
const PIXVERSE_RATE: Record<string, Record<string, [number, number]>> = {
  // [no audio, with audio] per second
  'pixverse-v6': { '360p': [0.025, 0.035], '540p': [0.035, 0.045], '720p': [0.045, 0.06], '1080p': [0.09, 0.115] },
  'pixverse-c1': { '360p': [0.03, 0.04], '540p': [0.04, 0.05], '720p': [0.05, 0.065], '1080p': [0.095, 0.12] },
}
function batch0928TicketCost(model: string, o: {
  duration: string; resolution: string; generateAudio: boolean; sourceSec: number; refs: number; startImage: boolean
}): number {
  const secs = batch0928Seconds(model, o.duration)
  const src = (fallback: number, cap: number) => Math.min(cap, Math.ceil(o.sourceSec > 0 ? o.sourceSec : fallback))
  let usd: number
  switch (model) {
    case 'kling-v3-turbo-pro': usd = 0.14 * secs; break
    case 'kling-v3-turbo':     usd = 0.112 * secs; break
    case 'kling-o3-pro':       usd = (o.generateAudio ? 0.14 : 0.112) * secs; break
    case 'kling-o3-4k':        usd = 0.42 * secs; break
    // Edit renders the clip's own length; reference renders the chosen length
    // fal's catalog lists O3 Pro's video-to-video at $0.168/s (its pricing API
    // still says $0.14) - priced at the dearer figure (2026-10-01)
    case 'kling-o3-pro-edit':      usd = 0.168 * src(15, 15); break
    case 'kling-o3-4k-edit':       usd = 0.42 * src(15, 15); break
    case 'kling-o3-pro-reference': usd = 0.168 * secs; break
    case 'kling-o3-4k-reference':  usd = 0.42 * secs; break
    case 'pixverse-v6':
    case 'pixverse-c1':
    case 'pixverse-v6-extend': {
      const table = PIXVERSE_RATE[model === 'pixverse-c1' ? 'pixverse-c1' : 'pixverse-v6']
      const rate = table[o.resolution] ?? table['720p']
      usd = rate[o.generateAudio ? 1 : 0] * secs
      break
    }
    // Lite (fal 2026-10-02): $0.02 / $0.03 / $0.14 per s + $0.01 an input image
    case 'grok-video-1.5-lite': {
      const rate = o.resolution === '1080p' ? 0.14 : o.resolution === '480p' ? 0.02 : 0.03
      usd = rate * secs + (o.startImage ? 0.01 : 0)
      break
    }
    case 'grok-video-1.5': {
      const rate = o.resolution === '1080p' ? 0.25 : o.resolution === '480p' ? 0.08 : 0.14
      usd = rate * secs + 0.01 * (Math.min(7, o.refs) + (o.startImage ? 1 : 0))
      break
    }
    // fal (2026-10-02): $0.05/s of output at 480p, $0.07/s at 720p, plus
    // $0.01/s of input. Edit renders at most 8s (it truncates the source);
    // the input second is billed on the whole clip - the dearer reading.
    // The source length is measured by /api/video/generate.
    case 'grok-video-edit': {
      const s = src(15, 60)
      usd = (o.resolution === '480p' ? 0.05 : 0.07) * Math.min(8, s) + 0.01 * s
      break
    }
    case 'grok-video-extend': usd = 0.07 * secs + 0.01 * src(15, 15); break
    case 'vidu-q3':
    case 'vidu-q3-turbo': {
      const base = model === 'vidu-q3-turbo' ? 0.035 : 0.07
      usd = base * (o.resolution === '720p' || o.resolution === '1080p' ? 2.2 : 1) * secs
      break
    }
    default: usd = 0.14 * secs
  }
  return Math.max(1, Math.ceil(usd / LUMA_TICKET_USD - 1e-9))
}

/*
 * The 2026-09-29 batch - fal's published rates that day, same rule: tickets =
 * ceil(fal cost / $0.04), >=50% gross margin at a $0.08 subscription ticket.
 * Where fal publishes no surcharge (Pika 10s, Pika Turbo 1080p, Hunyuan Video
 * 720p) the higher price is assumed, so a run is never priced under cost.
 *
 *   Pika 2.2 / Scenes     $0.20 per 5s at 720p, $0.45 at 1080p (10s x2)
 *   Pikaframes            $0.04/s (720p), $0.06/s (1080p), 5s minimum
 *   Pika 2 Turbo          $0.20 per 5s (1080p assumed x2.25)
 *   Hailuo 2.3 Pro        $0.49 (6s 1080p);  Standard $0.28 (6s) / $0.56 (10s)
 *   Hailuo 2.3 Fast       Pro $0.33;  Standard $0.19 (6s) / $0.32 (10s)
 *   Veo 3.1               $0.20/s, $0.40/s with audio (4K $0.40 / $0.60)
 *   Veo 3.1 Fast          $0.10/s, $0.15/s with audio (4K $0.30 / $0.35)
 *   Veo 3.1 Lite          720p $0.03 / $0.05, 1080p $0.05 / $0.08 per s
 *   Veo extend            the tier's rate on the 7s it adds
 *   H3 Max Turbo          $0.025 / $0.04 / $0.08 per s (480/768/1080P) - the
 *                         post-promo rates (a 50% promo ends 2026-09-30)
 *   H3 Max refs / extend  $0.05 / $0.08 / $0.16 per s (<=4 images ride free)
 *   Marey                 $0.30/s;  motion / pose transfer $2.00 a run
 *   SeeDance 2.0 Mini     $0.0721/s (480p), $0.1547/s (720p); auto = 10s
 *   Hunyuan Video 1.5     $0.075/s (720p assumed x2)
 */
// ── 2026-10-03 batch ─────────────────────────────────────────────────────────
/*
 * From fal's published rates (2026-10-03), billed at fal cost / $0.04 a ticket
 * - a 50% gross margin at the $0.08 subscription ticket:
 *   H3 Max Lip Sync        $0.05 / $0.08 / $0.16 per s (480p / 768p / 1080p)
 *                          of output = the audio's length, 5s min, x1.2 over 15s
 *   PixVerse Music Video   $0.06 / $0.09 per s of audio (720p / 1080p),
 *                          whole seconds, 10s min, 6 min max
 *   H3 Max Camera Controls $0.05 / $0.08 / $0.16 per s - the REGULAR rates; fal
 *                          runs 40% off until 2026-10-15, so the margin is
 *                          wider until then rather than gone after. The output
 *                          can run ~0.7s past the length asked, priced in.
 *   Happy Horse 1.1        $0.14 / $0.18 per s (720p / 1080p)
 *   VOID object removal    $0.05 a clip + $0.05 for the SAM-3 mask it makes
 *                          from the text (pass 2 refinement is left off)
 *   VEED Subtitles         $0.10 per started minute of source (1 min min), x2
 *                          for the dynamic caption styles, x2 above 1080p
 *   H3 Max Insert Shot     $0.05 / $0.06 per s of the NEW shot (480p / 768p);
 *                          reference images can pass the free 4,096 tokens,
 *                          so each is priced a ticket
 *   Depth Anything Video   $0.04 per s of source
 *   HeyGen Translate       $0.10 (precision) / $0.05 (fast) per s of output;
 *                          dynamic duration can run long, priced at +15%
 *   Mirelo SFX 1.6         $0.01 per s, one sample, as long as the clip (60s max)
 */
const BATCH_1003_MODELS = new Set([
  'minimax-h3-max-lipsync', 'pixverse-music-video', 'minimax-h3-max-camera', 'happy-horse-1.1',
  'heygen-avatar4', 'ltx-2.5-audio-pro', 'ltx-2.5-audio-fast', 'seedance-2.5-complete', 'sam-3.1-video', 'elevenlabs-dubbing',
  'void-video-removal', 'veed-subtitles', 'minimax-h3-max-insert', 'depth-anything-video',
  'heygen-translate', 'heygen-translate-fast', 'mirelo-sfx-video',
])
const VEED_DYNAMIC = new Set(['glass', 'whisper', 'glide2', 'fusion', 'glide', 'terminal', 'handwritten', 'backdrop', 'backdrop2'])
export function batch1003TicketCost(model: string, o: {
  duration?: string | number; resolution?: string; sourceSec?: number; sourceHeight?: number
  audioSec?: number; choice?: string; refs?: number; sourceFps?: number; promptWords?: number
}): number {
  const res = String(o.resolution ?? '').toLowerCase()
  const secs = Math.max(1, parseInt(String(o.duration ?? '5')) || 5)
  const src = o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10
  let usd: number
  switch (model) {
    case 'minimax-h3-max-lipsync': {
      const s = Math.max(5, o.audioSec && o.audioSec > 0 ? o.audioSec : 10)
      const rate = res === '1080p' ? 0.16 : res === '480p' ? 0.05 : 0.08
      usd = s * rate * (s > 15 ? 1.2 : 1)
      break
    }
    case 'pixverse-music-video': {
      const s = Math.min(360, Math.max(10, Math.ceil(o.audioSec && o.audioSec > 0 ? o.audioSec : 30)))
      usd = s * (res === '1080p' ? 0.09 : 0.06)
      break
    }
    case 'minimax-h3-max-camera':
      usd = (Math.min(15, secs) + 0.7) * (res === '1080p' ? 0.16 : res === '480p' ? 0.05 : 0.08)
      break
    case 'happy-horse-1.1':
      usd = Math.min(15, Math.max(3, secs)) * (res === '720p' ? 0.14 : 0.18)
      break
    case 'void-video-removal':
      usd = 0.10
      break
    case 'veed-subtitles':
      usd = Math.max(1, Math.ceil(src / 60)) * 0.10 * (VEED_DYNAMIC.has(o.choice ?? '') ? 2 : 1) * ((o.sourceHeight ?? 0) > 1080 ? 2 : 1)
      break
    case 'minimax-h3-max-insert':
      usd = Math.min(13, Math.max(5, secs)) * (res === '480p' ? 0.05 : 0.06) + (o.refs ?? 0) * 0.04
      break
    case 'depth-anything-video':
      usd = src * 0.04
      break
    case 'heygen-translate':
    case 'heygen-translate-fast':
      usd = src * 1.15 * (model === 'heygen-translate' ? 0.10 : 0.05)
      break
    case 'mirelo-sfx-video':
      usd = Math.min(60, Math.max(1, Math.ceil(src))) * 0.01
      break
    case 'heygen-avatar4': {
      // $0.10 per output second: the audio's length, or the script's at 2.5
      // words a second (+15% for pauses and a slow voice)
      const s = o.audioSec && o.audioSec > 0 ? o.audioSec : Math.max(3, ((o.promptWords ?? 15) / 2.5) * 1.15)
      usd = Math.ceil(s) * 0.10
      break
    }
    case 'ltx-2.5-audio-pro':
    case 'ltx-2.5-audio-fast':
      // Per second of the input audio (1080p - the only tier)
      usd = Math.ceil(Math.max(2, o.audioSec && o.audioSec > 0 ? o.audioSec : 10)) * (model === 'ltx-2.5-audio-pro' ? 0.17 : 0.13)
      break
    case 'seedance-2.5-complete':
      // The draft re-rendered at 1080p: $1.164 per second of the draft
      usd = Math.max(4, src) * 1.164
      break
    case 'sam-3.1-video':
      // $0.01 per 16 frames of source
      usd = Math.ceil((src * (o.sourceFps && o.sourceFps > 0 ? o.sourceFps : 30)) / 16) * 0.01
      break
    case 'elevenlabs-dubbing':
      // $0.60 per started minute
      usd = Math.max(1, Math.ceil(src / 60)) * 0.60
      break
    default:
      usd = 1
  }
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}

const BATCH_0929_MODELS = new Set([
  'pika-2.2', 'pikaframes', 'pika-2-turbo',
  'hailuo-2.3-pro', 'hailuo-2.3', 'hailuo-2.3-fast-pro', 'hailuo-2.3-fast',
  'veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite',
  'minimax-h3-max-turbo', 'minimax-h3-max-ref',
  'marey', 'seedance-2.0-mini', 'hunyuan-video-1.5',
  'veo-3.1-extend', 'veo-3.1-fast-extend', 'minimax-h3-max-extend',
  'marey-motion-transfer', 'marey-pose-transfer',
  'minimax-h3-max-turbo-extend', 'minimax-h3-max-recast',
  'kandinsky6-pro', 'kandinsky6-lite',
])
/**
 * Kandinsky 6.0 (fal, 2026-10-06): a 5s 480p clip at the default steps,
 * text-to-video / from a start frame - Pro $1.35 / $1.40, Lite $0.16 / $0.17.
 * The same job can run Kandinsky's video super-resolution: to 1080p (x2.25)
 * Pro +$0.18 / Lite +$0.17, x4 ("1920p") Pro +$0.56 / Lite +$0.52 (fal's model
 * pages). fal cost / $0.04 a ticket, rounded up.
 */
export function kandinsky6TicketCost(model: string, o: { resolution: string; startImage: boolean }): number {
  const pro = model === 'kandinsky6-pro'
  let usd = pro ? (o.startImage ? 1.40 : 1.35) : (o.startImage ? 0.17 : 0.16)
  if (o.resolution === '1080p') usd += pro ? 0.18 : 0.17
  else if (o.resolution === '1920p') usd += pro ? 0.56 : 0.52
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}
/** Seconds as the route will send them: snapped to what each endpoint takes. */
export function batch0929Seconds(model: string, duration: string): number {
  const d = duration === 'auto' ? 10 : parseInt(duration) || 5
  const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(hi, d))
  switch (model) {
    case 'pika-2.2': case 'pika-2-turbo': case 'marey': return d >= 10 ? 10 : 5
    case 'pikaframes': return clamp(1, 10)
    case 'hailuo-2.3-pro': case 'hailuo-2.3-fast-pro': return 6
    case 'hailuo-2.3': case 'hailuo-2.3-fast': return d >= 10 ? 10 : 6
    case 'veo-3.1': case 'veo-3.1-fast': case 'veo-3.1-lite': return d >= 8 ? 8 : d >= 6 ? 6 : 4
    case 'veo-3.1-extend': case 'veo-3.1-fast-extend': return 7
    case 'minimax-h3-max-turbo-extend': return clamp(1, 15)
    case 'seedance-2.0-mini': return clamp(4, 15)
    case 'hunyuan-video-1.5': return clamp(2, 5)
    case 'kandinsky6-pro': case 'kandinsky6-lite': return 5
    default: return clamp(5, 15)   // MiniMax H3 family
  }
}
function batch0929TicketCost(model: string, o: { duration: string; resolution: string; generateAudio: boolean; refs: number; sourceSec?: number; startImage?: boolean }): number {
  if (model === 'kandinsky6-pro' || model === 'kandinsky6-lite') return kandinsky6TicketCost(model, { resolution: o.resolution, startImage: !!o.startImage })
  const secs = batch0929Seconds(model, o.duration)
  const hi = o.resolution === '1080p'
  const mm = (rates: [number, number, number]) => rates[o.resolution === '480p' ? 0 : o.resolution === '1080p' ? 2 : 1]
  const veoRate = (tier: string) => {
    const k = o.resolution === '4k' ? '4k' : o.resolution === '1080p' ? '1080p' : '720p'
    const t: Record<string, Record<string, [number, number]>> = {
      std: { '720p': [0.2, 0.4], '1080p': [0.2, 0.4], '4k': [0.4, 0.6] },
      fast: { '720p': [0.1, 0.15], '1080p': [0.1, 0.15], '4k': [0.3, 0.35] },
      lite: { '720p': [0.03, 0.05], '1080p': [0.05, 0.08], '4k': [0.05, 0.08] },
    }
    return t[tier][k][o.generateAudio ? 1 : 0]
  }
  let usd: number
  switch (model) {
    case 'pika-2.2':          usd = (hi ? 0.45 : 0.2) * (secs / 5); break
    case 'pika-2-turbo':      usd = 0.2 * (hi ? 2.25 : 1) * (secs / 5); break
    case 'pikaframes': {
      const transitions = Math.max(1, Math.min(4, o.refs - 1))
      const per = Math.min(secs, Math.floor(25 / transitions))
      usd = Math.max(5, per * transitions) * (hi ? 0.06 : 0.04)
      break
    }
    case 'hailuo-2.3-pro':      usd = 0.49; break
    case 'hailuo-2.3':          usd = secs >= 10 ? 0.56 : 0.28; break
    case 'hailuo-2.3-fast-pro': usd = 0.33; break
    case 'hailuo-2.3-fast':     usd = secs >= 10 ? 0.32 : 0.19; break
    case 'veo-3.1':             usd = veoRate('std') * secs; break
    case 'veo-3.1-fast':        usd = veoRate('fast') * secs; break
    case 'veo-3.1-lite':        usd = veoRate('lite') * secs; break
    case 'veo-3.1-extend':      usd = veoRate('std') * secs; break
    case 'veo-3.1-fast-extend': usd = veoRate('fast') * secs; break
    case 'minimax-h3-max-turbo': usd = mm([0.025, 0.04, 0.08]) * secs; break
    case 'minimax-h3-max-ref':
    case 'minimax-h3-max-extend': usd = mm([0.05, 0.08, 0.16]) * secs; break
    // fal 2026-10-02: turbo extend $0.025 / $0.04 / $0.08 / $0.16 per s ADDED
    // (480p / 768p / 1080p / 2K); recast $0.30 / $0.45 per s of OUTPUT (768p /
    // 1080p) - the output is the source's length, measured by the route
    // (unmeasured = 30s, the longest it takes)
    case 'minimax-h3-max-turbo-extend':
      usd = (o.resolution === '2k' ? 0.16 : o.resolution === '1080p' ? 0.08 : o.resolution === '480p' ? 0.025 : 0.04) * secs; break
    case 'minimax-h3-max-recast':
      usd = (o.resolution === '1080p' ? 0.45 : 0.30) * Math.min(30, o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 30); break
    case 'marey':               usd = 0.3 * secs; break
    case 'marey-motion-transfer':
    case 'marey-pose-transfer': usd = 2.0; break
    case 'seedance-2.0-mini':   usd = (o.resolution === '480p' ? 0.0721 : 0.1547) * secs; break
    case 'hunyuan-video-1.5':   usd = 0.075 * secs * (o.resolution === '720p' ? 2 : 1); break
    default:                    usd = 0.2 * secs
  }
  return Math.max(1, Math.ceil(usd / LUMA_TICKET_USD - 1e-9))
}

const RES_STD = ['480p', '720p', '1080p']
const DUR_5_10 = ['5', '10']

export const VIDEO_MODEL_SPECS: VideoModelPricingSpec[] = [
  { id: 'wan-2.5',            label: 'Wan 2.5',                kind: 'generator', durations: DUR_5_10,                         resolutions: RES_STD,                  supportsAudio: false, durationSource: 'none', note: 'Falls through to the default 480/720/1080 × 5/10 table; anything off that table is 20 tickets.' },
  { id: 'wan-2.7',            label: 'Wan 2.7',                kind: 'generator', durations: DUR_5_10,                         resolutions: ['720p', '1080p'],        supportsAudio: false, durationSource: 'none', note: 'PLACEHOLDER pricing — admin only.' },
  { id: 'wan-2.2-lora',       label: 'Wan 2.2 LoRA',           kind: 'generator', durations: ['5', '10'],                      resolutions: ['480p', '720p'],         supportsAudio: false, durationSource: 'none', note: 'PLACEHOLDER pricing — admin only.' },
  { id: 'wan-3.0',            label: 'Wan 3.0',                kind: 'generator', durations: ['auto', '5', '10', '15', '20'],  resolutions: ['480p', '720p', '1080p', '1440p', '2160p', '4k'], supportsAudio: false, durationSource: 'none', note: 'Input-routed family — PLACEHOLDER pricing, admin only.' },
  { id: 'wan-3.0-prime',      label: 'Wan 3.0 Prime',          kind: 'generator', durations: ['auto', '5', '10', '15', '20'],  resolutions: ['480p', '720p', '1080p', '1440p', '2160p', '4k'], supportsAudio: false, durationSource: 'none', note: 'Input-routed family — PLACEHOLDER pricing, admin only.' },
  { id: 'kling-v3',           label: 'Kling 3.0 Pro',          kind: 'generator', durations: DUR_5_10,                         resolutions: [],                       supportsAudio: true,  durationSource: 'none' },
  { id: 'kling-o3',           label: 'Kling O3',               kind: 'generator', durations: ['3','4','5','6','7','8','9','10','11','12','13','14','15'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'Flat table by duration; an unlisted duration bills 20.' },
  { id: 'kling-v3-motion',    label: 'Kling 3.0 Motion',       kind: 'generator', durations: [],                               resolutions: [],                       supportsAudio: false, durationSource: 'motion', note: '6 tickets/sec of the motion reference clip. Unknown length falls back to 10s (30s when the character orientation is "video").' },
  { id: 'seedance-1.5',       label: 'SeeDance 1.5 Pro',       kind: 'generator', durations: ['3','5','8','10','12'],          resolutions: RES_STD,                  supportsAudio: true,  durationSource: 'none' },
  { id: 'seedance-2.0',       label: 'SeeDance 2.0',           kind: 'generator', durations: ['auto','3','5','8','10','12'],   resolutions: ['480p', '720p'],         supportsAudio: false, durationSource: 'none', note: 'r2v with video references: 0.6x multiplier, but the reference seconds are added to the billed duration.' },
  { id: 'seedance-2.0-fast',  label: 'SeeDance 2.0 Fast',      kind: 'generator', durations: ['auto','3','5','8','10','12'],   resolutions: ['480p', '720p'],         supportsAudio: false, durationSource: 'none', note: 'Same shape as SeeDance 2.0 at 12 tickets/sec.' },
  { id: 'seedance-2.5',       label: 'SeeDance 2.5',           kind: 'generator', durations: ['auto', '4', '5', '8', '10', '12'], resolutions: ['480p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'Public. 6 / 12 / 30 tickets per second at 480p / 720p / 1080p (50% margin at a $0.08 subscription ticket). Video refs: their seconds added, total x0.6. auto billed as 10s.' },
  { id: 'gemini-omni-flash',  label: 'Gemini Omni Flash',      kind: 'generator', durations: ['3', '5', '8', '10'],            resolutions: [],                       supportsAudio: false, durationSource: 'none', note: '4 tickets/sec (fal ~$0.13/s, token-billed; ~59% margin at $0.08). Edit bills the SOURCE clip length (min 3s, 8s when unknown).' },
  { id: 'gemini-omni-1.1',    label: 'Gemini Omni Flash 1.1',  kind: 'generator', durations: ['3', '5', '8', '10'],            resolutions: ['360p', '720p', '1080p', '4k'], supportsAudio: false, durationSource: 'none', note: '1 / 3 / 4 / 8 tickets/sec at 360p / 720p / 1080p / 4K (fal $0.03 / $0.10 / $0.15 / $0.30; 53-62% at $0.08). Edit bills the SOURCE clip length.' },
  { id: 'minimax-h3-max',     label: 'MiniMax H3 Max',         kind: 'generator', durations: ['5', '8', '10', '15'],           resolutions: ['480p', '768p'],         supportsAudio: false, durationSource: 'none', note: 'fal list $0.05 / $0.08 per s (480P / 768P) at cost / $0.04. Seconds clamped to 5-15.' },
  { id: 'flux-3',             label: 'FLUX 3 Video',           kind: 'generator', durations: ['auto', '5', '10', '15', '20'],  resolutions: ['720p', '1080p'],        supportsAudio: false, durationSource: 'none', note: '4.5 / 7.5 tickets/sec at 720p / 1080p (fal $0.17 / $0.29); extend 11 / 14 (fal $0.41 / $0.53). 52-53% at $0.08. auto billed as 10s.' },
  { id: 'ltx-2.5-pro',        label: 'LTX 2.5 Pro',            kind: 'generator', durations: ['auto', '6', '8', '10'],         resolutions: ['720p', '1080p'],        supportsAudio: false, durationSource: 'none', note: 'fal $0.12/s 720p, $0.17/s 1080p (audio included). Length snapped to 6/8/10s; auto billed as 8s.' },
  { id: 'ltx-2.5-fast',       label: 'LTX 2.5 Fast',           kind: 'generator', durations: ['auto', '6', '10', '16', '20'],  resolutions: ['720p', '1080p', '1440p', '2160p'], supportsAudio: false, durationSource: 'none', note: '2.5 / 3.5 / 5 / 8 tickets/sec at 720p / 1080p / 1440p / 2160p (fal $0.09 / $0.13 / $0.19 / $0.30; 52-55% at $0.08). 1440p+ and 48/50fps cap at 10s. auto billed as 10s.' },
  { id: 'happy-horse',        label: 'Happy Horse',            kind: 'generator', durations: DUR_5_10,                         resolutions: ['720p', '1080p'],        supportsAudio: false, durationSource: 'none' },
  { id: 'lipsync-v3',         label: 'Lipsync v3',             kind: 'generator', durations: [],                               resolutions: [],                       supportsAudio: false, durationSource: 'lipsync', note: '6 tickets/sec of the source video, floor of 10 tickets.' },
  // ── Tools: billed against the source clip ──
  { id: 'flux-video-upscale',       label: 'FLUX Video Upscale',        kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-upscale-precision',  label: 'Topaz Upscale Precision',   kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-upscale-creative',   label: 'Topaz Upscale Creative',    kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-upscale-generative', label: 'Topaz Upscale Generative',  kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'seedvr2-video',            label: 'SeedVR2 Video',             kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'flashvsr-video',           label: 'FlashVSR Video',            kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'kandinsky6-vsr',           label: 'Kandinsky 6 VSR',           kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true, note: '$0.00036 per output MP per frame; first 121 frames (~5s). Admin only.' },
  { id: 'kandinsky6-vsr-lite',      label: 'Kandinsky 6 VSR Lite',      kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true, note: '$0.00036 per output MP per frame; first 121 frames (~5s). Admin only.' },
  { id: 'bytedance-video-upscale',  label: 'ByteDance Video Upscale',   kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-colorize',           label: 'Topaz Colorize',            kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-deblur',             label: 'Topaz Deblur',              kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-interpolate',        label: 'Topaz Interpolate',         kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'topaz-sdr-to-hdr',         label: 'Topaz SDR to HDR',          kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', showUpscaleFactor: true },
  { id: 'luma-ray-2',               label: 'Luma Ray 2',                kind: 'generator', durations: ['5', '9'], resolutions: ['540p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.50 per 5s at 540p (x2 720p, x4 1080p, x2 9s). Admin only.' },
  { id: 'luma-ray-2-flash',         label: 'Luma Ray 2 Flash',          kind: 'generator', durations: ['5', '9'], resolutions: ['540p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.20 per 5s at 540p (x2 720p, x4 1080p, x2 9s). Admin only.' },
  { id: 'luma-ray-3.2',             label: 'Luma Ray 3.2',              kind: 'generator', durations: ['5', '10'], resolutions: ['540p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.50/$1/$2 per 5s (540p/720p/1080p), x2 for 10s. Admin only.' },
  { id: 'luma-ray-2-modify',        label: 'Luma Ray 2 Modify',         kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.35 per source second.' },
  { id: 'luma-ray-2-flash-modify',  label: 'Luma Ray 2 Flash Modify',   kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.12 per source second.' },
  { id: 'luma-ray-2-reframe',       label: 'Luma Ray 2 Reframe',        kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.20 per source second.' },
  { id: 'luma-ray-2-flash-reframe', label: 'Luma Ray 2 Flash Reframe',  kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.06 per source second.' },
  { id: 'luma-ray-3.2-edit',        label: 'Luma Ray 3.2 Edit',         kind: 'tool', durations: [], resolutions: ['540p', '720p', '1080p'], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.72/$1.08/$2.16 per 5s; a source past 5.5s renders (and bills) 10s.' },
  { id: 'luma-ray-3.2-reframe',     label: 'Luma Ray 3.2 Reframe',      kind: 'tool', durations: [], resolutions: ['540p', '720p', '1080p'], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.06/$0.12/$0.36 per started source second (max 10s).' },
  { id: 'kling-v3-turbo-pro',   label: 'Kling V3 Turbo Pro',     kind: 'generator', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.14/s. Admin only.' },
  { id: 'kling-v3-turbo',       label: 'Kling V3 Turbo',         kind: 'generator', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.112/s. Admin only.' },
  { id: 'kling-o3-pro',         label: 'Kling O3 Pro',           kind: 'generator', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: true, durationSource: 'none', note: 'fal $0.112/s, $0.14/s with audio. Admin only.' },
  { id: 'kling-o3-4k',          label: 'Kling O3 4K',            kind: 'generator', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: true, durationSource: 'none', note: 'fal $0.42/s. Admin only.' },
  { id: 'pixverse-v6',          label: 'PixVerse V6',            kind: 'generator', durations: ['5', '8', '10', '15'], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: true, durationSource: 'none', note: 'fal $0.025-0.09/s (+audio). Admin only.' },
  { id: 'pixverse-c1',          label: 'PixVerse C1',            kind: 'generator', durations: ['5', '8', '10', '15'], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: true, durationSource: 'none', note: 'fal $0.03-0.095/s (+audio). Admin only.' },
  { id: 'grok-video-1.5',       label: 'Grok Imagine Video 1.5', kind: 'generator', durations: ['5', '6', '10', '15'], resolutions: ['480p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.08/$0.14/$0.25 per s, +$0.01 per image. Admin only.' },
  { id: 'grok-video-1.5-lite',  label: 'Grok Imagine Video 1.5 Lite', kind: 'generator', durations: ['5', '6', '10', '15'], resolutions: ['480p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.02/$0.03/$0.14 per s (480/720/1080) + $0.01 a start image.' },
  { id: 'vidu-q3',              label: 'Vidu Q3',                kind: 'generator', durations: ['5', '8', '10', '16'], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.07/s at 360-540p, x2.2 at 720-1080p. Admin only.' },
  { id: 'vidu-q3-turbo',        label: 'Vidu Q3 Turbo',          kind: 'generator', durations: ['5', '8', '10', '16'], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.035/s at 360-540p, x2.2 at 720-1080p. Admin only.' },
  { id: 'kling-o3-pro-edit',    label: 'Kling O3 Pro Video Edit',      kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.168 per second of clip (3-15s).' },
  { id: 'kling-o3-pro-reference', label: 'Kling O3 Pro Video Reference', kind: 'tool', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.168/s of output.' },
  { id: 'kling-o3-4k-edit',     label: 'Kling O3 4K Video Edit',       kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.42 per second of clip (3-15s).' },
  { id: 'kling-o3-4k-reference', label: 'Kling O3 4K Video Reference', kind: 'tool', durations: ['3', '5', '10', '15'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.42/s of output.' },
  { id: 'pixverse-v6-extend',   label: 'PixVerse V6 Extend',           kind: 'tool', durations: ['5', '8', '10', '15'], resolutions: ['360p', '540p', '720p', '1080p'], supportsAudio: true, durationSource: 'none', note: 'PixVerse V6 rates on the extension length.' },
  { id: 'grok-video-edit',      label: 'Grok Video Edit',              kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.05/s (480p) or $0.07/s (720p) of output, max 8s, + $0.01/s of source.' },
  { id: 'grok-video-extend',    label: 'Grok Video Extend',            kind: 'tool', durations: ['2', '6', '10'], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.07/s extension (2-10s) + $0.01/s of source.' },
  { id: 'pika-2.2',             label: 'Pika 2.2',               kind: 'generator', durations: ['5', '10'], resolutions: ['720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.20 / $0.45 per 5s (720p / 1080p). Admin only.' },
  { id: 'pikaframes',           label: 'Pikaframes',             kind: 'generator', durations: ['5', '10'], resolutions: ['720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.04 / $0.06 per s, 5s min. Admin only.' },
  { id: 'pika-2-turbo',         label: 'Pika 2 Turbo',           kind: 'generator', durations: ['5', '10'], resolutions: ['720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.20 per 5s. Admin only.' },
  { id: 'hailuo-2.3-pro',       label: 'Hailuo 2.3 Pro',         kind: 'generator', durations: ['6'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.49 a run (6s 1080p). Admin only.' },
  { id: 'hailuo-2.3',           label: 'Hailuo 2.3',             kind: 'generator', durations: ['6', '10'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.28 (6s) / $0.56 (10s), 768p. Admin only.' },
  { id: 'hailuo-2.3-fast-pro',  label: 'Hailuo 2.3 Fast Pro',    kind: 'generator', durations: ['6'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.33 a run. Admin only.' },
  { id: 'hailuo-2.3-fast',      label: 'Hailuo 2.3 Fast',        kind: 'generator', durations: ['6', '10'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $0.19 (6s) / $0.32 (10s). Admin only.' },
  { id: 'veo-3.1',              label: 'Veo 3.1',                kind: 'generator', durations: ['4', '6', '8'], resolutions: ['720p', '1080p', '4k'], supportsAudio: true, durationSource: 'none', note: 'fal $0.20/s, $0.40/s with audio (4K more). Admin only.' },
  { id: 'veo-3.1-fast',         label: 'Veo 3.1 Fast',           kind: 'generator', durations: ['4', '6', '8'], resolutions: ['720p', '1080p', '4k'], supportsAudio: true, durationSource: 'none', note: 'fal $0.10/s, $0.15/s with audio. Admin only.' },
  { id: 'veo-3.1-lite',         label: 'Veo 3.1 Lite',           kind: 'generator', durations: ['4', '6', '8'], resolutions: ['720p', '1080p'], supportsAudio: true, durationSource: 'none', note: 'fal $0.03-0.08/s. Admin only.' },
  { id: 'minimax-h3-max-turbo', label: 'MiniMax H3 Max Turbo',   kind: 'generator', durations: ['5', '10', '15'], resolutions: ['480p', '768p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.025/$0.04/$0.08 per s (post-promo). Admin only.' },
  { id: 'minimax-h3-max-ref',   label: 'MiniMax H3 Max References', kind: 'generator', durations: ['5', '10', '15'], resolutions: ['480p', '768p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.05/$0.08/$0.16 per s. Admin only.' },
  { id: 'marey',                label: 'Marey',                  kind: 'generator', durations: ['5', '10'], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $1.50 (5s) / $3.00 (10s). Admin only.' },
  { id: 'seedance-2.0-mini',    label: 'SeeDance 2.0 Mini',      kind: 'generator', durations: ['auto', '5', '10', '15'], resolutions: ['480p', '720p'], supportsAudio: true, durationSource: 'none', note: 'fal $0.0721 / $0.1547 per s. Admin only.' },
  { id: 'hunyuan-video-1.5',    label: 'Hunyuan Video 1.5',      kind: 'generator', durations: ['3', '5'], resolutions: ['480p', '720p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.075/s (720p assumed x2). Admin only.' },
  { id: 'kandinsky6-pro',       label: 'Kandinsky 6 Pro',        kind: 'generator', durations: ['5'], resolutions: ['480p', '1080p', '1920p'], supportsAudio: true, durationSource: 'none', note: 'fal $1.35 text / $1.40 from a frame (5s 480p); +$0.18 to 1080p, +$0.56 x4. Admin only.' },
  { id: 'kandinsky6-lite',      label: 'Kandinsky 6 Lite',       kind: 'generator', durations: ['5'], resolutions: ['480p', '1080p', '1920p'], supportsAudio: true, durationSource: 'none', note: 'fal $0.16 text / $0.17 from a frame (5s 480p); +$0.17 to 1080p, +$0.52 x4. Admin only.' },
  { id: 'veo-3.1-extend',       label: 'Veo 3.1 Extend',         kind: 'tool', durations: [], resolutions: [], supportsAudio: true, durationSource: 'none', note: 'Veo rates on the 7s it adds.' },
  { id: 'veo-3.1-fast-extend',  label: 'Veo 3.1 Fast Extend',    kind: 'tool', durations: [], resolutions: [], supportsAudio: true, durationSource: 'none', note: 'Veo Fast rates on the 7s it adds.' },
  { id: 'minimax-h3-max-turbo-extend', label: 'MiniMax H3 Max Turbo Extend', kind: 'tool', durations: ['5', '10', '15'], resolutions: ['480p', '768p', '1080p', '2k'], supportsAudio: false, durationSource: 'none', note: 'fal $0.025/$0.04/$0.08/$0.16 per s added.' },
  // 2026-10-03 batch (admin, under test)
  { id: 'minimax-h3-max-lipsync', label: 'H3 Max Lip Sync', kind: 'generator', durations: [], resolutions: ['480p', '768p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.05 / $0.08 / $0.16 per s of the audio (5s min, x1.2 over 15s).' },
  { id: 'pixverse-music-video', label: 'PixVerse Music Video', kind: 'generator', durations: [], resolutions: ['720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.06 / $0.09 per s of audio (10s min).' },
  { id: 'minimax-h3-max-camera', label: 'H3 Max Camera Controls', kind: 'generator', durations: ['3', '5', '8', '10', '15'], resolutions: ['480p', '768p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.05 / $0.08 / $0.16 per s (regular rates; 40% off until Oct 15).' },
  { id: 'happy-horse-1.1', label: 'Happy Horse 1.1', kind: 'generator', durations: ['3', '5', '8', '10', '15'], resolutions: ['720p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.14 / $0.18 per s.' },
  { id: 'void-video-removal', label: 'VOID Object Removal', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.05 a clip + $0.05 for the text mask.' },
  { id: 'veed-subtitles', label: 'VEED Subtitles', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.10 per started minute; x2 dynamic styles, x2 above 1080p.' },
  { id: 'minimax-h3-max-insert', label: 'H3 Max Insert Shot', kind: 'tool', durations: ['5', '8', '10', '13'], resolutions: ['480p', '768p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.05 / $0.06 per s of the new shot.' },
  { id: 'depth-anything-video', label: 'Depth Anything Video', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.04 per s of clip.' },
  { id: 'heygen-translate', label: 'HeyGen Translate', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.10 per s of output (+15% for dynamic duration).' },
  { id: 'heygen-translate-fast', label: 'HeyGen Translate Fast', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.05 per s of output (+15%).' },
  { id: 'mirelo-sfx-video', label: 'Mirelo SFX 1.6', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.01 per s, one sample (60s max).' },
  // 2026-10-07 (admin): lib/batch-1007-video
  { id: 'vidu-q4', label: 'Vidu Q4', kind: 'generator', durations: ['3', '5', '8', '10', '16'], resolutions: ['540p', '720p', '1080p', '2k', '4k'], supportsAudio: true, durationSource: 'none', note: 'fal $0.045 / $0.095 / $0.12 / $0.19 / $0.39 per s (regular rates; 30% off until Nov 30). Audio free.' },
  { id: 'minimax-h3-max-relight', label: 'H3 Max Relight', kind: 'tool', durations: [], resolutions: ['480p', '768p', '1080p', '2k'], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.05 / $0.08 / $0.16 / $0.32 per s of the source (15s max).' },
  { id: 'minimax-h3-max-recast', label: 'MiniMax H3 Max Recast', kind: 'tool', durations: [], resolutions: ['768p', '1080p'], supportsAudio: false, durationSource: 'source-clip', note: 'fal $0.30 / $0.45 per s of clip (5-30s).' },
  { id: 'minimax-h3-max-extend', label: 'MiniMax H3 Max Extend', kind: 'tool', durations: ['5', '10', '15'], resolutions: ['480p', '768p', '1080p'], supportsAudio: false, durationSource: 'none', note: 'fal $0.05/$0.08/$0.16 per s added.' },
  { id: 'marey-motion-transfer', label: 'Marey Motion Transfer', kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $2.00 a run.' },
  { id: 'marey-pose-transfer',  label: 'Marey Pose Transfer',    kind: 'tool', durations: [], resolutions: [], supportsAudio: false, durationSource: 'none', note: 'fal $2.00 a run.' },
]


// ── Ideogram v4 ──────────────────────────────────────────────────────────────
/**
 * Every Ideogram request priced from fal's own numbers, not a flat per-tier
 * guess. See ideogramRunCostUsd for the table; tickets keep TARGET_MARGIN of
 * each ticket as margin even on the cheapest pack on the buy-tickets page.
 */
export const IDEOGRAM_TARGET_MARGIN = 0.5
/** The lowest price a ticket is ever sold for on the buy-tickets page. */
export const CHEAPEST_USD_PER_TICKET = Math.min(...TICKET_PACKAGES.map(p => usdPerTicket(p, 'dev')))
/** Budgeted for Magic Prompt: fal charges it but does not publish the figure. */
export const IDEOGRAM_EXPANSION_FEE_USD = 0.01

export interface IdeogramPriceInput {
  tier: string                 // ideogram-v4 | ideogram-v4-fast | ideogram-v4-instant | ideogram-v4-tiling
  quality?: string             // 1k | 2k (4k is capped to 2048 by the endpoint)
  aspectRatio?: string         // "3:4", "1024x1536", or "auto"
  lora?: boolean
  ref?: boolean
  speed?: string               // TURBO | BALANCED | QUALITY
  mode?: string                // edit | remove-text
  expansion?: string           // None | Medium | Large
}

const SPEED_FACTOR: Record<string, number> = { TURBO: 0.75, BALANCED: 1.5, QUALITY: 2.5 }

/** Megapixels the request will render. "auto" is priced as a square: the upper bound. */
function ideogramMegapixels(quality?: string, aspectRatio?: string): number {
  const long = quality === '1k' ? 1024 : 2048
  let r = 1
  if (aspectRatio && aspectRatio !== 'auto') {
    const [w, h] = aspectRatio.replace(/x/i, ':').split(':').map(Number)
    if (w > 0 && h > 0) r = Math.min(w, h) / Math.max(w, h)
  }
  return (long * long * r) / 1_000_000
}

/** What fal charges for one Ideogram image with these settings, in USD. */
export function ideogramRunCostUsd(o: IdeogramPriceInput): number {
  if (o.mode === 'remove-text' && o.ref) return 0.09 // layerize-text, flat, no expansion
  const mp = ideogramMegapixels(o.quality, o.aspectRatio)
  const chosen = SPEED_FACTOR[o.speed ?? 'BALANCED'] ?? 1.5
  let unit: number
  let factor = chosen
  if (o.tier === 'ideogram-v4-tiling') {
    unit = o.lora ? 0.045 : 0.04
  } else if (o.lora || o.ref) {
    // The sibling a LoRA or a reference moves the request to. Instant goes
    // there at TURBO; the others keep the speed they were given.
    unit = o.lora ? 0.015 : 0.01
    if (o.tier === 'ideogram-v4-instant') factor = SPEED_FACTOR.TURBO
  } else if (o.tier === 'ideogram-v4-instant') {
    unit = 0.005; factor = 1.5 // no speed setting on Instant itself
  } else if (o.tier === 'ideogram-v4-fast') {
    unit = 0.007
  } else {
    unit = 0.01
  }
  const expansion = o.expansion === 'None' ? 0 : IDEOGRAM_EXPANSION_FEE_USD
  return mp * factor * unit + expansion
}

/** Tickets for one Ideogram image: cost over the margin-adjusted cheapest ticket. */
export function ideogramTicketCost(o: IdeogramPriceInput): number {
  const perTicket = CHEAPEST_USD_PER_TICKET * (1 - IDEOGRAM_TARGET_MARGIN)
  // The small epsilon stops float noise turning an exact 1.0 into 2.
  return Math.max(1, Math.ceil(ideogramRunCostUsd(o) / perTicket - 1e-9))
}

// ── FLUX 3 Image ─────────────────────────────────────────────────────────────
/*
 * fal bills FLUX 3 Image per STARTED 1024x1024 block of output: $0.024 a block
 * at launch, $0.048 from 2026-10-08 when the 50% launch discount ends - priced
 * at the FULL rate so the margin holds when it does. MEASURED 2026-10-02 by
 * balance delta, at the sizes it returns:
 *   1k  1:1 1024x1024 = 1 block, 16:9 1360x768 = 1, 3:4 880x1184 = 1,
 *       21:9 1568x672 = 2 (1,053,696 px - just over one block)
 *   2k  16:9 2736x1536 = 5 blocks ($0.12 at launch; 4.2M px, over 4 blocks)
 *   4k  16:9 5456x3072 = 16 blocks
 * Shapes not measured are priced a block higher (a square 2k is exactly 4,
 * every other 2k shape lands over). Mirrored shapes share a size.
 * References are NOT billed: an edit with two refs (one 4.2MP, shrunk to fit
 * the edit's 4MP cap by /api/generate) cost exactly its one output block.
 */
export const FLUX3_IMAGE_USD_PER_BLOCK = 0.048
function flux3Blocks(tier: '1k' | '2k' | '4k', aspectRatio?: string): number {
  const ar = aspectRatio ?? 'auto'
  if (tier === '1k') return ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(ar) ? 1 : 2
  if (tier === '2k') return ar === '1:1' ? 4 : 5
  return ['1:1', '16:9', '9:16'].includes(ar) ? 16 : 17
}
export function flux3ImageTicketCost(o: { quality?: string; aspectRatio?: string; refs?: number; refDims?: { width: number; height: number } | null }): number {
  const tier = o.quality === '4k' || o.quality === '2k' ? o.quality : '1k'
  // 'auto' with references takes the first reference's shape - unknown here
  const usd = flux3Blocks(tier, o.aspectRatio) * FLUX3_IMAGE_USD_PER_BLOCK
  return Math.max(1, Math.ceil(usd / 0.04 - 1e-9))
}

// ── ChatGPT Images 2.5 ───────────────────────────────────────────────────────
/*
 * GPT Image 2.5 bills by tokens, so one flat price per tier cannot hold a
 * margin: the charge moves with the render effort, the SHAPE and the number of
 * references. It was a flat 3 tickets, which lost money on every 4K image.
 *
 * MEASURED on 2026-09-30 from the fal account balance, one render at a time
 * (flare renderer; sunburst lists the same prices), at the sizes
 * gptImage25Size really sends:
 *
 *                 16:9    3:2     4:3     1:1
 *   4K  xhigh    .1781   .2124   .2356   .3165
 *   2K  high     .0605     -     .0806   .1072
 *   1K  medium     -       -       -     .0134
 *
 *   + $0.0096 per reference image (4K 16:9 edit: 1 ref .1877, 4 refs .2167)
 *
 * Squarer costs more at every tier, and portrait costs the same as its
 * landscape twin (9:16 measured equal to 16:9). fal's published table agrees
 * on the landscape figures but understates square (it predicts ~.26 at 4K);
 * the measurements win.
 *
 * Other effort levels (reachable through the `gptQuality` option) scale by
 * the ratios in fal's table at a fixed size: low .063, medium .146,
 * high .5625, xhigh 1, max 2.25 - calibrated: 2K square high = .1906 x .5625
 * = .1072 and 1K square medium = .0937 x .146 = .0137, both as measured.
 *
 * Prompt text is billed too ($5 per 1M input tokens), and fal notes that
 * complex requests cost more, so every estimate carries a 10% buffer.
 */

/** Cost of a render at xhigh effort, by tier then shape bucket: [wide, 3:2, 4:3, square]. */
const GPT25_XHIGH_USD: Record<'1k' | '2k' | '4k', [number, number, number, number]> = {
  '4k': [0.1781, 0.2124, 0.2356, 0.3165],
  // 3:2 at 2K unmeasured: priced as 4:3, the next squarer bucket.
  '2k': [0.1076, 0.1433, 0.1433, 0.1906],
  // 1K is cheap enough that every shape is priced as square.
  '1k': [0.0937, 0.0937, 0.0937, 0.0937],
}
const GPT25_EFFORT_FACTOR: Record<string, number> = { low: 0.063, medium: 0.146, high: 0.5625, xhigh: 1, max: 2.25 }
const GPT25_REF_USD = 0.01
const GPT25_BUFFER = 1.1

/** Render effort a tier gets by default (lib/fal-image-models sends the same). */
export function gptImage25DefaultEffort(quality: string): 'medium' | 'high' | 'xhigh' {
  return quality === '4k' ? 'xhigh' : quality === '2k' ? 'high' : 'medium'
}

export interface GptImage25PriceInput {
  quality: string                                    // 1k | 2k | 4k
  aspectRatio?: string                               // "16:9" | "auto" | ...
  /** The first reference's size: what "auto" follows on an edit. */
  refDims?: { width: number; height: number } | null
  refCount?: number
  promptChars?: number
  /** Explicit render effort override (options.gptQuality). */
  effort?: string
}

/** Shape bucket: 0 wide (>=1.7:1), 1 3:2, 2 4:3, 3 square-ish. Unknown shape is square, the dearest. */
function gpt25Bucket(o: GptImage25PriceInput): number {
  let r = 1
  if (o.aspectRatio && o.aspectRatio !== 'auto') {
    const [a, b] = o.aspectRatio.split(':').map(Number)
    if (a > 0 && b > 0) r = Math.max(a, b) / Math.min(a, b)
  } else if (o.refDims && o.refDims.width > 0 && o.refDims.height > 0) {
    r = Math.max(o.refDims.width, o.refDims.height) / Math.min(o.refDims.width, o.refDims.height)
  }
  // The endpoint refuses past 3:1, so the size is clamped there - still "wide".
  return r >= 1.7 ? 0 : r >= 1.45 ? 1 : r >= 1.3 ? 2 : 3
}

/** What fal charges for one GPT Image 2.5 image with these settings, in USD (buffered). */
export function gptImage25RunCostUsd(o: GptImage25PriceInput): number {
  const tier = o.quality === '4k' || o.quality === '2k' ? o.quality : '1k'
  const effort = o.effort && o.effort in GPT25_EFFORT_FACTOR ? o.effort : o.effort === 'auto' ? 'xhigh' : gptImage25DefaultEffort(tier)
  const render = GPT25_XHIGH_USD[tier][gpt25Bucket(o)] * GPT25_EFFORT_FACTOR[effort]
  const refs = Math.max(0, o.refCount ?? 0) * GPT25_REF_USD
  const promptText = ((o.promptChars ?? 0) / 4) * 5e-6
  return (render + refs + promptText) * GPT25_BUFFER
}

/** Tickets for one GPT Image 2.5 image: half of the cheapest ticket ($0.08) kept as margin. */
export function gptImage25TicketCost(o: GptImage25PriceInput): number {
  return Math.max(1, Math.ceil(gptImage25RunCostUsd(o) / LUMA_TICKET_USD - 1e-9))
}

// ── Pixelcut video ───────────────────────────────────────────────────────────
/*
 * fal's prices (pricing API, 2026-09-30):
 *   pixelcut/looping-video              $0.08 per second of output, any resolution
 *   pixelcut/video-background-removal   $0.022 per 30 frames of the source
 * Background removal is billed per FRAME and a clip's frame rate is not known
 * up front, so it is priced for 60 fps (phones record at 60) - the house rule
 * of assuming the dearer case. At 30 fps that is double margin.
 */
export function pixelcutVideoTicketCost(model: string, o: { duration: string; sourceSec?: number; sourceFps?: number }): number {
  if (model === 'pixelcut-looping-video') {
    const secs = Math.min(15, Math.max(5, Math.round(Number(o.duration) || 5)))
    return Math.max(1, Math.ceil((secs * 0.08) / LUMA_TICKET_USD - 1e-9))
  }
  // An unknown clip length is priced as the longest clip allowed (60s)
  const secs = o.sourceSec && o.sourceSec > 0 ? Math.min(o.sourceSec, 60) : 60
  // The server measures the clip's frame rate; unmeasured = 60 fps
  const fps = o.sourceFps && o.sourceFps > 0 ? Math.min(o.sourceFps, 120) : 60
  const usd = Math.ceil((secs * fps) / 30 - 1e-9) * 0.022
  return Math.max(1, Math.ceil(usd / LUMA_TICKET_USD - 1e-9))
}

// ── NanoBanana 2.1 ───────────────────────────────────────────────────────────
/*
 * Token-billed (fal: image output $35.294/M tokens, text + thinking output
 * $8.823/M, input incl. reference images $1.764/M). One image, measured:
 *   fal's model page (medium thinking):  1K $0.040   2K $0.059   4K $0.134
 *   balance delta 2026-10-07:  1K minimal $0.0396, 1K high $0.0506, 4K high $0.1454
 *                              -> high thinking about +$0.012, minimal = medium
 *                              1K edit: 1 ref $0.0415, 12 refs $0.0633 -> +$0.002 a ref
 *   web search: two 1K minimal runs that clearly searched (a 2026 skyline
 *   poster) cost $0.0396 each - the same as without. Search results are billed
 *   as input tokens, so a heavy search costs a little; a $0.006 buffer covers
 *   ~3,400 tokens of them and only moves the price where the ceiling tips.
 * Priced to keep a 70% margin at the cheapest ticket ($0.08 on subscriptions):
 * every $0.024 of fal cost is one ticket. Medium, no refs: 1K 2, 2K 3, 4K 6;
 * high thinking and references add as they cost.
 */
const NB21_BASE_USD: Record<string, number> = { '1k': 0.040, '2k': 0.059, '4k': 0.134 }
const NB21_HIGH_THINKING_USD = 0.012
const NB21_REF_USD = 0.002
const NB21_WEB_SEARCH_USD = 0.006
const NB21_USD_PER_TICKET = 0.08 * (1 - 0.70)
export type Nb21Thinking = 'minimal' | 'medium' | 'high'
export const NB21_THINKING: Nb21Thinking[] = ['minimal', 'medium', 'high']

export function nb21RunCostUsd(o: { quality?: string; thinking?: string; refCount?: number; webSearch?: boolean }): number {
  const base = NB21_BASE_USD[(o.quality ?? '2k').toLowerCase()] ?? NB21_BASE_USD['2k']
  const think = o.thinking === 'high' ? NB21_HIGH_THINKING_USD : 0
  const refs = Math.min(14, Math.max(0, o.refCount ?? 0)) * NB21_REF_USD
  return base + think + refs + (o.webSearch ? NB21_WEB_SEARCH_USD : 0)
}

/** Tickets for one NanoBanana 2.1 image - the portal, Image Studio and the server all price with this. */
export function nb21TicketCost(o: { quality?: string; thinking?: string; refCount?: number; webSearch?: boolean }): number {
  return Math.max(1, Math.ceil(nb21RunCostUsd(o) / NB21_USD_PER_TICKET - 1e-9))
}
