import { HIGGSFIELD_MODEL_IDS } from '@/lib/higgsfield-models'

/**
 * Video models we host ourselves on RunPod serverless (2026-10-22, ADMIN ONLY
 * while under test) - open-weight models fal does not carry, each its own
 * RunPod endpoint built from a worker under AI/ (the same setup as the custom
 * FLUX LoRA endpoint). Shared by the page (pickers, prices) and the server
 * (lib/runpod-video).
 *
 *   MoCha  Orange-3DV-Team's character replacement (CVPR 2026, on Wan 2.1 14B):
 *          a clip plus 1-2 pictures of the character; the worker masks the
 *          person on the first frame itself. AI/mocha-worker, env
 *          RUNPOD_MOCHA_ENDPOINT_ID. Its weights are AGPL and the authors call
 *          it "intended solely for academic research" - fine for admin tests,
 *          settle that before it goes public.
 *   Viggle Animate  Viggle's character replacement on MiniMax H3 Ref2VA: the
 *          clip plus a frame of it repainted with the character (the submit
 *          route makes that with NanoBanana from the character picture).
 *   H3 Character Swap  MiniMax H3 Ref2VA + akatz-ai's Character Swap LoRA
 *          (H3 Relay workflow: SAM 3.1 masks and tracks the person). The
 *          nearest open stand-in for H3 Max Recast, whose weights are not out.
 *          Both: AI/h3-worker, ONE endpoint (RUNPOD_H3_ENDPOINT_ID). Both are
 *          MiniMax H3 derivatives - the H3 licence excludes the USA, EU, UK
 *          and South Korea; the owner chose to run them admin-only (2026-10-22).
 *
 * Prices are PLACEHOLDERS until real runs are measured (GPU seconds x the
 * endpoint's rate): a 48 GB L40S is ~$1.75 an hour on RunPod serverless, so a
 * 3-6 minute render with a warm worker is roughly $0.10-0.20. Admins run free.
 */

export type RunpodVideoModelId = 'runpod-mocha' | 'runpod-viggle' | 'runpod-h3-swap'

export const RUNPOD_VIDEO_MODELS = new Set<string>(['runpod-mocha', 'runpod-viggle', 'runpod-h3-swap'])
/** The ones everyone can use - none yet (add the id here to make one public). */
export const RUNPOD_VIDEO_PUBLIC = new Set<string>([])
export const isRunpodModel = (id: string | null | undefined) => !!id && RUNPOD_VIDEO_MODELS.has(id)
/**
 * Every RunPod model id. RunPod keeps its own queue per endpoint, so these
 * rows never wait in ours - but they must stay out of fal's slot counting, or
 * a long render would hold one of fal's 40 slots.
 */
export const RUNPOD_MODEL_IDS: string[] = [...RUNPOD_VIDEO_MODELS]
/**
 * Every model whose jobs run outside fal's queue (Higgsfield's own 20 slots,
 * RunPod's per-endpoint queues): what fal's slot counting and promotion leave out.
 */
export const OWN_QUEUE_MODEL_IDS: string[] = [...HIGGSFIELD_MODEL_IDS, ...RUNPOD_MODEL_IDS]

/** The environment variable that holds each model's RunPod endpoint id. */
export const RUNPOD_ENDPOINT_ENV: Record<RunpodVideoModelId, string> = {
  'runpod-mocha': 'RUNPOD_MOCHA_ENDPOINT_ID',
  'runpod-viggle': 'RUNPOD_H3_ENDPOINT_ID',
  'runpod-h3-swap': 'RUNPOD_H3_ENDPOINT_ID',
}

/**
 * The page's video slots carry `falEndpoint` for their poller; a RunPod job's
 * is "runpod:<model id>" so /api/admin/video-status knows it is not a fal job.
 */
export const RP_ENDPOINT_PREFIX = 'runpod:'
export const isRunpodEndpoint = (ep: unknown): ep is string => typeof ep === 'string' && ep.startsWith(RP_ENDPOINT_PREFIX)

/** Longest source clip each takes (MoCha renders up to ~7 seconds of it; the rest is cut). */
export const RUNPOD_MAX_SOURCE_SEC: Record<RunpodVideoModelId, number> = {
  'runpod-mocha': 60,
  // Viggle holds well to ~10s and is trained from 5s; H3 Relay windows a clip of any length - held to 30s
  'runpod-viggle': 60,
  'runpod-h3-swap': 60,
}

/*
 * Prices (2026-10-22, from the first real runs): tickets = GPU cost / $0.04,
 * so a ticket sold at $0.08 keeps half (the site's floor).
 *  - RunPod bills a worker's whole life, not just the render: boot plus the
 *    endpoint's 240 s idle timeout comes to ~300 billed seconds per run on its
 *    own (a run every few minutes shares one worker and pays it once).
 *  - mocha endpoint (RTX PRO 6000): $2.12 for 2,189 billed seconds on its first
 *    day = $0.00097/s. MoCha 480p Fast measured 155 s of render for 81 frames.
 *  - h3-swap endpoint (80 GB H100 / RTX PRO 6000): $0.675 for its first 507
 *    billed seconds = $0.00133/s. Viggle measured 230 s for a 5.25 s clip;
 *    H3 Character Swap ~850 s of masking + rendering for one 5.25 s window at
 *    768p (its first run - re-measure a warm one before it goes public).
 */
const RP_OVERHEAD_S = 300
const MOCHA_USD_PER_S = 0.00097
const H3_USD_PER_S = 0.00133
const toTickets = (usd: number) => Math.max(1, Math.ceil(usd / 0.04))

/** The frames MoCha renders: the first max_frames of the clip at its frame rate, down to 4n+1 (AI/mocha-worker prepare_clip). */
export function mochaRenderFrames(advanced: Record<string, unknown> | undefined, sourceSec?: number): number {
  const fps = Number(advanced?.fps ?? 24) === 16 ? 16 : 24
  const maxFrames = Math.max(17, Math.min(161, Number(advanced?.max_frames ?? 81) || 81))
  const n = sourceSec && sourceSec > 0 ? Math.min(maxFrames, Math.floor(sourceSec * fps + 1e-6)) : maxFrames
  return Math.max(17, Math.floor((n - 1) / 4) * 4 + 1)
}

type RunpodRunOpts = { resolution?: string; choice?: string; sourceSec?: number; advanced?: Record<string, unknown> }

/**
 * The GPU seconds a run's render takes (estimated from the measured runs) -
 * what its price is built on, and what the panel shows as its time. 0 for an
 * unknown model.
 */
export function runpodRenderSec(model: string, o: RunpodRunOpts): number {
  if (model === 'runpod-mocha') {
    // The default 81 frames: 480p Fast measured; 720p ~2.8x (2.3x the pixels);
    // Full is 30 sampling steps to Fast's 6 (~4.2x). Longer runs (Length
    // 121/161 frames) scale a little faster than the frame count - attention
    // grows with the frames - so by (frames/81)^1.2. (720p Full at 161 frames
    // ran past the worker's old 50-minute cap on 2026-10-22: this says ~68 min.)
    const fast = o.resolution === '720p' ? 440 : 165
    const frames = mochaRenderFrames(o.advanced, o.sourceSec)
    return (o.choice === 'full' ? fast * 4.2 : fast) * Math.pow(frames / 81, 1.2)
  }
  // The seconds of the clip each renders (the panel's default length when the clip is longer)
  if (model === 'runpod-viggle') {
    // ~44 s per clip second (480-class - measured: 230 s for a 5.25 s clip on 2026-10-22)
    const sec = Math.min(15, o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 10)
    return 44 * Math.max(5.2, sec)
  }
  if (model === 'runpod-h3-swap') {
    // ~160 s of masking + render per clip second at 768p (measured: ~850 s for a
    // 5.25 s clip, one 124-frame window), ~65 at 480p (2.4x fewer pixels);
    // a clip shorter than one window still renders the whole window
    const sec = Math.max(5.2, Math.min(30, o.sourceSec && o.sourceSec > 0 ? o.sourceSec : 15))
    return (o.resolution === '480p' ? 65 : 160) * sec
  }
  return 0
}

export function runpodVideoTicketCost(model: string, o: RunpodRunOpts): number {
  const render = runpodRenderSec(model, o)
  if (!render) return 1
  if (model === 'runpod-mocha') return toTickets((RP_OVERHEAD_S + render) * MOCHA_USD_PER_S)
  // Viggle: GPU only - the automatic first-frame repaint is added by the
  // callers at NanoBanana's own price (viggleRepaintTickets)
  if (model === 'runpod-viggle') return toTickets((RP_OVERHEAD_S + render) * H3_USD_PER_S)
  // H3 Character Swap: plus ~$0.01 of SAM
  return toTickets((RP_OVERHEAD_S + render) * H3_USD_PER_S + 0.01)
}
