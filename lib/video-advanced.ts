/**
 * A video model's own advanced settings (2026-10-22), declared once and used
 * by both sides: the portal draws an "Advanced" section from the list, and
 * /api/video/generate passes what it sends through cleanVideoAdvanced, which
 * keeps only the declared keys, in range, before they reach fal.
 *
 * Every knob is named exactly as fal's schema names it, so a cleaned value
 * goes straight into the fal input. None of them changes the price - fal bills
 * Wan Animate per "video second" at the chosen resolution, whatever the steps.
 */

export type VideoKnob = { key: string; label: string; note?: string } & (
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'number'; min: number; max: number; step: number; default: number; integer?: boolean }
  | { kind: 'toggle'; default: boolean }
  /** A whole number, or empty for a random one each run. */
  | { kind: 'seed' }
)

/**
 * Wan 2.2 Animate (Replace and Move share fal's schema, checked 2026-10-22).
 * The defaults are fal's own; resolution is the panel's usual size picker.
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
  { key: 'use_turbo', label: 'Turbo', note: 'fal tunes the settings for speed', kind: 'toggle', default: false },
  { key: 'seed', label: 'Seed', kind: 'seed' },
  { key: 'enable_safety_checker', label: 'Input safety checker', note: 'checks the clip and picture first', kind: 'toggle', default: false },
  { key: 'enable_output_safety_checker', label: 'Output safety checker', note: 'checks the finished video', kind: 'toggle', default: false },
  { key: 'return_frames_zip', label: 'Frames ZIP', note: 'every frame as a lossless image, kept with the video', kind: 'toggle', default: false },
]

export const VIDEO_ADVANCED_KNOBS: Record<string, VideoKnob[]> = {
  'wan-2.2-animate-replace': WAN_ANIMATE_KNOBS,
  'wan-2.2-animate-move': WAN_ANIMATE_KNOBS,
}

/** The settings the page sent, cleaned against the model's list: unknown keys dropped, numbers clamped, choices checked. */
export function cleanVideoAdvanced(model: string, raw: unknown): Record<string, string | number | boolean> {
  const knobs = VIDEO_ADVANCED_KNOBS[model]
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const out: Record<string, string | number | boolean> = {}
  for (const k of knobs ?? []) {
    const v = src[k.key]
    if (v === undefined || v === null || v === '') continue
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
