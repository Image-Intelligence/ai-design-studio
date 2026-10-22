/**
 * A video model's own advanced settings (2026-10-22), declared once and used
 * by both sides: the portal draws an "Advanced" section from the list, and
 * /api/video/generate passes what it sends through cleanVideoAdvanced, which
 * keeps only the declared keys, in range, before they reach fal.
 *
 * Every knob is named exactly as fal's schema names it, so a cleaned value
 * goes straight into the fal input. A knob's default is fal's own unless it
 * carries falDefault: then the site's default differs, and the server sends
 * it on every run the page left untouched (owner, 2026-10-22: "Turbo should
 * be switched ON by default"). None of them changes the price - fal bills
 * Wan Animate per "video second" at the chosen resolution, whatever the steps.
 */

export type VideoKnob = {
  key: string; label: string; note?: string
  /** Admins only (a safety checker fal runs by default): hidden from everyone else, and dropped by the server */
  adminOnly?: boolean
  /** fal's default, where the site's own default (sent on every run) differs from it */
  falDefault?: string | number | boolean
} & (
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'number'; min: number; max: number; step: number; default: number; integer?: boolean }
  | { kind: 'toggle'; default: boolean }
  /** A whole number, or empty for a random one each run. */
  | { kind: 'seed' }
)

/**
 * Wan 2.2 Animate (Replace and Move share fal's schema, checked 2026-10-22).
 * The defaults are fal's own except Turbo, which the site turns on; resolution
 * is the panel's usual size picker (opening on 720p).
 */
const WAN_ANIMATE_KNOBS: VideoKnob[] = [
  { key: 'num_inference_steps', label: 'Steps', note: 'more is finer and slower', kind: 'number', min: 2, max: 40, step: 1, default: 20, integer: true },
  { key: 'guidance_scale', label: 'Guidance', note: 'how closely it follows the inputs', kind: 'number', min: 1, max: 10, step: 0.1, default: 1 },
  { key: 'shift', label: 'Shift', note: 'how much the motion is reworked', kind: 'number', min: 1, max: 10, step: 0.1, default: 5 },
  { key: 'video_quality', label: 'Video quality', note: 'the saved file, not the render', kind: 'select', default: 'high', options: [
    { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'maximum', label: 'Maximum' },
  ] },
  { key: 'video_write_mode', label: 'Write mode', note: 'fast = bigger file, small = slower', kind: 'select', default: 'balanced', options: [
    { value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'small', label: 'Small' },
  ] },
  { key: 'use_turbo', label: 'Turbo', note: 'fal tunes the settings for speed', kind: 'toggle', default: true, falDefault: false },
  { key: 'seed', label: 'Seed', kind: 'seed' },
  { key: 'enable_safety_checker', label: 'Input safety checker', note: 'checks the clip and picture first', kind: 'toggle', default: false },
  { key: 'enable_output_safety_checker', label: 'Output safety checker', note: 'checks the finished video', kind: 'toggle', default: false },
  { key: 'return_frames_zip', label: 'Frames ZIP', note: 'every frame as a lossless image, kept with the video', kind: 'toggle', default: false },
]

/**
 * MiniMax H3 Max Recast (fal schema checked 2026-10-22). Prompt, resolution,
 * the clip and the 1-4 face photos are the panel's usual inputs. Its safety
 * checker is ON by fal's default, so only admins may turn it off - the same
 * rule as every other model's checker on the site. Off is for "authorized
 * callers" only, and this fal account is not one: all 9 runs sent with it
 * off on 2026-10-22 failed "None of the reference images shows a person"
 * (the same pictures had worked with it on), so the note says so.
 */
const RECAST_KNOBS: VideoKnob[] = [
  { key: 'enhance_realism', label: 'Enhance realism', note: 'more natural skin and better blending into the scene', kind: 'toggle', default: false },
  { key: 'seed', label: 'Seed', kind: 'seed' },
  { key: 'enable_safety_checker', label: 'Safety checker', note: "keep it on - fal hasn't authorised this account to turn it off, and every run with it off fails \"no person in the reference images\"", kind: 'toggle', default: true, adminOnly: true },
]

/**
 * MoCha on our RunPod worker (AI/mocha-worker, 2026-10-22). Not fal's: these
 * are the worker's own job inputs and defaults. It was trained on 81-frame
 * clips; longer runs are allowed but untested for quality and memory.
 */
const MOCHA_KNOBS: VideoKnob[] = [
  { key: 'max_frames', label: 'Length', note: "how much of the clip it renders - it was trained on the first", kind: 'select', default: '81', options: [
    { value: '81', label: '81 frames' }, { value: '121', label: '121 frames' }, { value: '161', label: '161 frames' },
  ] },
  { key: 'fps', label: 'Frame rate', note: '24 is smoother; 16 covers more of the clip in the same frames', kind: 'select', default: '24', options: [
    { value: '24', label: '24 fps' }, { value: '16', label: '16 fps' },
  ] },
  { key: 'keep_audio', label: "Clip's sound", note: 'laid back under the result', kind: 'toggle', default: true },
  { key: 'seed', label: 'Seed', kind: 'seed' },
]

/**
 * HeyGen Video (fal schema 2026-10-22, all three endpoints). Its safety
 * checker is ON by fal's default - only admins may turn it off, as everywhere
 * on the site (fal says off is for "authorized callers" only).
 */
const HEYGEN_VIDEO_KNOBS: VideoKnob[] = [
  { key: 'prompt_enhancement', label: 'Prompt enhancement', note: 'HeyGen rewrites the prompt first - quality and ultra take longer', kind: 'select', default: 'turbo', options: [
    { value: 'turbo', label: 'Turbo' }, { value: 'quality', label: 'Quality' }, { value: 'ultraquality', label: 'Ultra' }, { value: 'disabled', label: 'Off' },
  ] },
  { key: 'seed', label: 'Seed', kind: 'seed' },
  { key: 'enable_safety_checker', label: 'Safety checker', kind: 'toggle', default: true, adminOnly: true },
]

/** Wan VACE Video Edit (fal wan-vace-14b/inpainting schema 2026-10-22). */
const WAN_VACE_EDIT_KNOBS: VideoKnob[] = [
  { key: 'acceleration', label: 'Speed', note: 'regular is faster and very slightly different', kind: 'select', default: 'regular', options: [
    { value: 'none', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'regular', label: 'Regular' },
  ] },
  { key: 'enable_safety_checker', label: 'Safety checker', kind: 'toggle', default: true, adminOnly: true },
  { key: 'return_frames_zip', label: 'Frames ZIP', note: 'every frame as a lossless image, kept with the video', kind: 'toggle', default: false },
]

/** The MiniMax H3 pair on our RunPod worker (AI/h3-worker, 2026-10-22): the worker's own inputs. */
const H3_RUNPOD_KNOBS = (maxDefault: string, options: string[]): VideoKnob[] => [
  { key: 'max_seconds', label: 'Length', note: 'how much of the clip it renders', kind: 'select', default: maxDefault, options: options.map(s => ({ value: s, label: `${s} s` })) },
  { key: 'keep_audio', label: "Clip's sound", note: 'kept under the result', kind: 'toggle', default: true },
  { key: 'seed', label: 'Seed', kind: 'seed' },
]

export const VIDEO_ADVANCED_KNOBS: Record<string, VideoKnob[]> = {
  'runpod-viggle': H3_RUNPOD_KNOBS('10', ['6', '10', '15']),
  'runpod-h3-swap': H3_RUNPOD_KNOBS('15', ['5', '10', '15', '20', '30']),
  'heygen-video': HEYGEN_VIDEO_KNOBS,
  'wan-vace-edit': WAN_VACE_EDIT_KNOBS,
  'runpod-mocha': MOCHA_KNOBS,
  'wan-2.2-animate-replace': WAN_ANIMATE_KNOBS,
  'wan-2.2-animate-move': WAN_ANIMATE_KNOBS,
  'minimax-h3-max-recast': RECAST_KNOBS,
}

/**
 * The Advanced settings a fal input really carries, for the run's popup:
 * only the model's own knobs, and only where they differ from fal's default
 * (a seed always shows). Read from the input actually SENT, so a setting the
 * page showed but the server did not pass on is never claimed.
 */
export function videoSettingsFromInput(model: string, input: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const k of VIDEO_ADVANCED_KNOBS[model] ?? []) {
    const v = input?.[k.key]
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
    if (k.kind !== 'seed' && v === k.default) continue
    out[k.key] = v
  }
  return out
}

/** A run's settings as popup chips: the knob's name and its value in words. */
export function videoSettingChips(model: string, settings: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  const knobs = VIDEO_ADVANCED_KNOBS[model] ?? []
  return Object.entries(settings ?? {}).flatMap(([key, v]) => {
    const k = knobs.find(x => x.key === key)
    if (!k) return []
    const value = k.kind === 'select' ? (k.options.find(o => o.value === v)?.label ?? String(v))
      : k.kind === 'toggle' ? (v ? 'On' : 'Off')
      : String(v)
    return [{ label: k.label, value }]
  })
}

/**
 * The settings the page sent, cleaned against the model's list: unknown keys
 * dropped, numbers clamped, choices checked. A knob left untouched whose site
 * default differs from fal's (falDefault) gets the site default, so runs from
 * the page, Nova or the connector all start from the same settings.
 */
export function cleanVideoAdvanced(model: string, raw: unknown, opts: { isAdmin?: boolean } = {}): Record<string, string | number | boolean> {
  const knobs = VIDEO_ADVANCED_KNOBS[model]
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const out: Record<string, string | number | boolean> = {}
  for (const k of knobs ?? []) {
    if (k.adminOnly && !opts.isAdmin) continue
    const v = src[k.key]
    if (v === undefined || v === null || v === '') {
      if (k.kind !== 'seed' && k.falDefault !== undefined && k.falDefault !== k.default) out[k.key] = k.default
      continue
    }
    if (k.kind === 'select') {
      if (k.options.some(o => o.value === v)) out[k.key] = v as string
    } else if (k.kind === 'toggle') {
      if (typeof v === 'boolean') out[k.key] = v
    } else if (k.kind === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      const c = Math.min(k.max, Math.max(k.min, n))
      out[k.key] = k.integer ? Math.round(c) : Math.round(c * 100) / 100
    } else {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 0 && n <= 2 ** 32 - 1) out[k.key] = n
    }
  }
  return out
}
