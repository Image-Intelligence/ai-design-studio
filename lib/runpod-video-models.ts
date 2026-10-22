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

export function runpodVideoTicketCost(model: string, o: { resolution?: string }): number {
  if (model === 'runpod-mocha') return o.resolution === '720p' ? 20 : 8
  // ~$0.05 of NanoBanana repaint, then a 1-3 minute render on an 80 GB card ($2.72/h)
  if (model === 'runpod-viggle') return 10
  // Windowed 124-frame passes: a 15s clip is ~4 windows on an 80 GB card
  if (model === 'runpod-h3-swap') return o.resolution === '480p' ? 15 : 25
  return 1
}
