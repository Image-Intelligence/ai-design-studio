/**
 * Storyboard Studio - the workflow's phases and the editing tools (client-safe).
 *
 * 2026-10-19 (owner): "this should work more like an actual workflow and
 * utilize more of our sites features". A board now runs
 *
 *   1 Stills  ->  2 Still edits  ->  3 Shots  ->  4 Shot edits  ->  5 Final Cut  ->  6 Revise
 *
 * with the AUDIO LANE alongside the whole way (voice lines on shots, music
 * cues along the board - lib/storyboard VoiceLine / MusicCue).
 *
 *   Still edits  the site's picture tools on a shot's still - an AI edit with
 *                the board's cast as references, a new background, a cut-out,
 *                expand / zoom out, upscale, the Image Studio popup. Every
 *                result is a new still TAKE (the old one stays a tap away).
 *   Shot edits   the site's video-to-video tools on a shot's clip - upscale,
 *                smooth motion, restyle, edit with words (cast as references),
 *                remove something, recast a face, extend, sound effects,
 *                lip-sync to the shot's voice line. Every result is a new
 *                clip TAKE, rendered and billed by /api/video/generate.
 *   Revise       after a Final Cut: the user says what to change, the edit AI
 *                writes the edit list, the cut is re-run with it - as often
 *                as it takes.
 *
 * The prices shown here are the routes' own (lib/image-studio-ai,
 * lib/storyboard stillTickets); clip tools are priced by /api/video/generate
 * from the MEASURED clip, so the page shows the rule, and the toast the charge.
 */

import { stillTickets } from '@/lib/storyboard'
import { EXPAND_TICKETS, upscaleTickets } from '@/lib/image-studio-ai'

// ── phases ───────────────────────────────────────────────────────────────────

export const WORKFLOW_PHASES = [
  { key: 'stills', label: 'Stills', hint: 'Make the cast and every shot\'s still' },
  { key: 'still-edits', label: 'Still edits', hint: 'Fix and refine stills with the picture tools - the cast as references' },
  { key: 'shots', label: 'Shots', hint: 'Turn every still into a video shot' },
  { key: 'shot-edits', label: 'Shot edits', hint: 'Video-to-video tools: upscale, restyle, extend, lip-sync...' },
  { key: 'final', label: 'Final Cut', hint: 'Plan, cut, voice, score and mix the film' },
  { key: 'revise', label: 'Revise', hint: 'Say what to change - the edit AI writes the edits, then re-cut' },
] as const
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number]['key']
export const isWorkflowPhase = (v: unknown): v is WorkflowPhase => WORKFLOW_PHASES.some(p => p.key === v)

// ── still tools ──────────────────────────────────────────────────────────────

export type StillToolId = 'edit' | 'background' | 'cutout' | 'expand' | 'upscale'
export const STILL_TOOLS: { id: StillToolId; label: string; blurb: string; prompt?: 'required' | 'optional'; placeholder?: string; refs?: boolean }[] = [
  { id: 'edit', label: 'Edit with words', blurb: 'Change anything - pose, outfit, expression, lighting. Pick cast pictures so faces and costumes stay consistent.', prompt: 'required', placeholder: 'e.g. she turns to look over her shoulder; rain on the window', refs: true },
  { id: 'background', label: 'New background', blurb: 'Keep the subject exactly, put it somewhere else.', prompt: 'required', placeholder: 'e.g. a neon-lit alley at night, wet pavement', refs: true },
  { id: 'cutout', label: 'Remove background', blurb: 'The subject alone on transparency - for a cast sheet or a composite. (A shot from a cut-out animates on black.)' },
  { id: 'expand', label: 'Expand / zoom out', blurb: 'Paint more of the scene around the still - zoom out, or reach a wider or taller frame.', prompt: 'optional', placeholder: 'optional: what the new area shows' },
  { id: 'upscale', label: 'Upscale', blurb: 'SeedVR2, 2x (up to 4096px) - sharper detail before it is animated.' },
]
/** The picture models a still edit may use (they take the still as a reference). */
export const STILL_EDIT_DEFAULT_MODEL = 'nano-banana-2.1'
export const STILL_EDIT_MAX_SIDE = 4096
/**
 * Tickets for a still tool, as the route charges them. The upscale price
 * depends on the still's real size - `w` x `h` when the page knows them, a
 * 2K still otherwise.
 */
export function stillToolTickets(op: StillToolId, o: { model?: string; quality?: string; frame?: string; refs?: number; w?: number; h?: number }): number {
  if (op === 'cutout') return CUTOUT_TICKETS
  if (op === 'expand') return EXPAND_TICKETS
  if (op === 'upscale') {
    const w = o.w || 2048, h = o.h || 1152
    const f = Math.max(1, Math.min(2, STILL_EDIT_MAX_SIDE / Math.max(w, h)))
    return upscaleTickets('seedvr2-upscale', f, w, h)
  }
  return stillTickets(o.model || STILL_EDIT_DEFAULT_MODEL, o.quality, o.frame || '16:9', undefined, 1 + (o.refs ?? 0))
}
/** BiRefNet v2: ~$0.002 a run - one ticket, the floor. */
export const CUTOUT_TICKETS = 1
/** Zoom-out amounts for Expand: how much of the new frame the old still fills. */
export const EXPAND_ZOOMS = [{ value: '1', label: 'Fill the frame only' }, { value: '0.8', label: 'Zoom out a little' }, { value: '0.65', label: 'Zoom out' }, { value: '0.5', label: 'Zoom out a lot' }] as const

// ── clip tools ───────────────────────────────────────────────────────────────

export type ClipToolGroup = 'quality' | 'change' | 'people' | 'length' | 'sound'
export const CLIP_TOOL_GROUPS: { key: ClipToolGroup; label: string }[] = [
  { key: 'quality', label: 'Quality' },
  { key: 'change', label: 'Change it' },
  { key: 'people', label: 'People' },
  { key: 'length', label: 'Length' },
  { key: 'sound', label: 'Sound' },
]
export type ClipTool = {
  /** /api/video/generate model id. */
  id: string
  label: string
  group: ClipToolGroup
  blurb: string
  /** How it is priced (the route measures the clip and charges this rule). */
  price: string
  prompt?: 'required' | 'optional'
  placeholder?: string
  /** Pictures that go with the clip (the cast): how many, and whether at least one is needed. */
  refs?: { max: number; required?: boolean; label: string }
  /** One setting, sent as body[key]. */
  choice?: { key: string; label: string; options: { value: string; label: string }[]; def: string }
  /** Seconds the tool ADDS (extend): sent as `duration`. */
  adds?: { min: number; max: number; def: number }
  /** The source clip must be this long (seconds). */
  minSec?: number
  maxSec?: number
  /** Lip-sync: the shot's voice line is the audio. */
  usesLine?: boolean
  /** Fixed body fields. */
  extra?: Record<string, unknown>
}
const LUMA_MODES = [
  { value: 'adhere_1', label: 'Stay close' },
  { value: 'flex_1', label: 'Balanced' },
  { value: 'flex_3', label: 'Looser' },
  { value: 'reimagine_1', label: 'Reimagine' },
]
export const CLIP_TOOLS: ClipTool[] = [
  // quality
  { id: 'bytedance-video-upscale', label: 'Upscale (ByteDance)', group: 'quality', blurb: 'A cleaner, sharper clip at a higher resolution - same motion, same frames.', price: 'by length and resolution',
    choice: { key: 'resolution', label: 'To', options: [{ value: '1080p', label: '1080p' }, { value: '2k', label: '2K' }], def: '1080p' } },
  { id: 'seedvr2-video', label: 'Upscale (SeedVR2)', group: 'quality', blurb: 'Faithful restoration upscale - good on soft or noisy AI footage.', price: 'by output pixels and frames',
    choice: { key: 'resolution', label: 'To', options: [{ value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }], def: '1080p' } },
  { id: 'topaz-interpolate', label: 'Smooth motion (60fps)', group: 'quality', blurb: 'Topaz frame interpolation - silky motion, no judder.', price: 'by length', extra: { videoTargetFps: '60' } },
  { id: 'topaz-deblur', label: 'Deblur', group: 'quality', blurb: 'Topaz: recovers detail lost to motion blur and softness.', price: 'by length' },
  // change it
  { id: 'kling-o3-pro-edit', label: 'Edit with words (Kling O3)', group: 'change', blurb: 'Change what is in the clip and keep its motion. Your cast pictures keep faces and costumes right.', price: 'by length (3-15s clips)',
    prompt: 'required', placeholder: 'e.g. make it night with rain; @Image1 is the woman in the clip', refs: { max: 4, label: 'Cast pictures (@Image1...)' }, minSec: 3, maxSec: 15 },
  { id: 'luma-ray-2-flash-modify', label: 'Restyle (Luma)', group: 'change', blurb: 'Re-render the clip in a new look - film stock, anime, claymation... A styled first frame steers it.', price: 'by length',
    prompt: 'optional', placeholder: 'e.g. 1970s film stock, warm grain', refs: { max: 1, label: 'Styled first frame (optional)' }, choice: { key: 'lumaMode', label: 'How far', options: LUMA_MODES, def: 'flex_1' } },
  { id: 'luma-ray-3.2-edit', label: 'Edit (Luma Ray 3.2)', group: 'change', blurb: 'Precise edits to a clip from words - colour, weather, objects.', price: 'flat per clip (5s or 10s out)',
    prompt: 'required', placeholder: 'e.g. turn the car red', choice: { key: 'lumaMode', label: 'How far', options: LUMA_MODES, def: 'flex_1' }, extra: { resolution: '720p' } },
  { id: 'void-video-removal', label: 'Remove something', group: 'change', blurb: 'Takes an object or person out of the clip and fills in behind it (up to ~8s).', price: 'flat per clip',
    prompt: 'required', placeholder: 'e.g. the man in the background', maxSec: 8 },
  { id: 'grok-video-edit', label: 'Edit with words (Grok)', group: 'change', blurb: 'Quick prompt edits to the first 8 seconds of a clip.', price: 'by length', prompt: 'required', placeholder: 'e.g. add falling snow', extra: { resolution: '720p' } },
  // people
  { id: 'minimax-h3-max-recast', label: 'Recast a face', group: 'people', blurb: 'Puts your cast member\'s face on the person in the clip, keeping the performance (5-30s clips).', price: 'by length',
    prompt: 'optional', placeholder: 'optional: who to change', refs: { max: 4, required: true, label: 'Face pictures' }, minSec: 5, maxSec: 30 },
  { id: 'wan-2.2-animate-replace', label: 'Replace the character', group: 'people', blurb: 'Swaps the character for your cast picture, following the original\'s motion (up to 15s).', price: 'by length',
    refs: { max: 1, required: true, label: 'Character picture' }, maxSec: 15, extra: { resolution: '720p' } },
  { id: 'lipsync-v3', label: 'Lip-sync to the voice line', group: 'people', blurb: 'Moves the speaker\'s lips to this shot\'s recorded line - the line is then part of the clip.', price: 'by length', usesLine: true },
  // length
  { id: 'grok-video-extend', label: 'Extend (Grok)', group: 'length', blurb: 'Carries the clip on for a few more seconds (2-15s clips).', price: 'by added seconds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 2, max: 10, def: 4 }, minSec: 2, maxSec: 15 },
  { id: 'minimax-h3-max-extend', label: 'Extend (MiniMax H3)', group: 'length', blurb: 'A longer continuation at up to 1080p.', price: 'by added seconds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 5, max: 15, def: 5 }, extra: { resolution: '768p' } },
  // sound
  { id: 'mirelo-sfx2-video', label: 'Sound effects', group: 'sound', blurb: 'Mirelo SFX 2.0 builds a soundtrack of effects to the picture (keeps any speech).', price: 'by length',
    prompt: 'optional', placeholder: 'optional: e.g. footsteps on gravel, distant thunder' },
]
export const clipTool = (id: string) => CLIP_TOOLS.find(t => t.id === id)
