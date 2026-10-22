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
import { HEYGEN_LANGUAGES, DUB_LANGUAGES } from '@/lib/batch-1003-video'

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
/** An upscaler's factor, sent as videoUpscaleFactor (the route clamps it to what the model takes). */
const UPSCALE = (def: string, ...factors: string[]): NonNullable<ClipTool['choice']> =>
  ({ key: 'videoUpscaleFactor', label: 'By', options: factors.map(f => ({ value: f, label: `${f}x` })), def })
/** MiniMax's resolutions (the route spells them for fal). */
const MM_RES = (...r: string[]): NonNullable<ClipTool['choice']> =>
  ({ key: 'resolution', label: 'At', options: r.map(v => ({ value: v, label: v === '2k' ? '2K' : v })), def: '768p' })
export const CLIP_TOOLS: ClipTool[] = [
  // quality
  { id: 'bytedance-video-upscale', label: 'Upscale (ByteDance)', group: 'quality', blurb: 'A cleaner, sharper clip at a higher resolution - same motion, same frames.', price: 'by length and resolution',
    choice: { key: 'resolution', label: 'To', options: [{ value: '1080p', label: '1080p' }, { value: '2k', label: '2K' }], def: '1080p' } },
  { id: 'seedvr2-video', label: 'Upscale (SeedVR2)', group: 'quality', blurb: 'Faithful restoration upscale - good on soft or noisy AI footage.', price: 'by output pixels and frames',
    choice: { key: 'resolution', label: 'To', options: [{ value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }], def: '1080p' } },
  { id: 'topaz-interpolate', label: 'Smooth motion (60fps)', group: 'quality', blurb: 'Topaz frame interpolation - silky motion, no judder.', price: 'by length', extra: { videoTargetFps: '60' } },
  { id: 'topaz-deblur', label: 'Deblur', group: 'quality', blurb: 'Topaz: recovers detail lost to motion blur and softness.', price: 'by length' },
  // 2026-10-22: the site's other public upscalers and restorers (lengths as the portal holds them)
  { id: 'topaz-upscale-precision', label: 'Upscale (Topaz)', group: 'quality', blurb: 'Topaz Precision: a faithful upscale that keeps every frame as it is - 1x only cleans it up.', price: 'by length and output size',
    choice: UPSCALE('2', '1', '2', '3', '4'), maxSec: 60 },
  { id: 'topaz-upscale-generative', label: 'Upscale (Topaz Starlight)', group: 'quality', blurb: 'Topaz\'s generative upscaler: rebuilds soft, low-resolution AI footage with real detail.', price: 'by length and output size',
    choice: UPSCALE('2', '1', '2', '3', '4'), maxSec: 60 },
  { id: 'topaz-upscale-creative', label: 'Upscale + detail (Topaz)', group: 'quality', blurb: 'Topaz Creative: 2x, and it invents fine detail - skin, fabric, foliage. Words can steer what it adds.', price: 'by length and output size',
    prompt: 'optional', placeholder: 'optional: e.g. crisp fabric texture, fine film grain',
    choice: { key: 'videoToolCreativity', label: 'Detail', options: [{ value: '0.2', label: 'Subtle' }, { value: '0.5', label: 'Balanced' }, { value: '0.8', label: 'Bold' }], def: '0.5' }, extra: { videoUpscaleFactor: '2' }, maxSec: 60 },
  { id: 'flux-video-upscale', label: 'Upscale (FLUX)', group: 'quality', blurb: 'FLUX\'s faithful video upscale: the same frames, sharper, 1.5x to 3x.', price: 'by length and output size (2K / 4K)',
    prompt: 'optional', placeholder: 'optional: what the clip shows, to guide the detail', choice: UPSCALE('2', '1.5', '2', '2.5', '3'), extra: { videoToolCreativity: '0' }, maxSec: 20 },
  { id: 'flashvsr-video', label: 'Upscale (FlashVSR)', group: 'quality', blurb: 'Fast, low-cost super-resolution that keeps the clip\'s sound.', price: 'by output pixels and frames',
    choice: UPSCALE('2', '2', '3', '4'), maxSec: 60 },
  { id: 'kandinsky6-vsr', label: 'Upscale (Kandinsky 6)', group: 'quality', blurb: 'Kandinsky 6\'s super-resolution - it takes the first ~5 seconds of a clip.', price: 'by output pixels and frames',
    choice: UPSCALE('2.25', '2', '2.25', '4'), maxSec: 5 },
  { id: 'kandinsky6-vsr-lite', label: 'Upscale (Kandinsky 6 Lite)', group: 'quality', blurb: 'The lighter Kandinsky 6 super-resolution, same ~5 second limit.', price: 'by output pixels and frames',
    choice: UPSCALE('2.25', '2', '2.25', '4'), maxSec: 5 },
  { id: 'topaz-sdr-to-hdr', label: 'SDR to HDR', group: 'quality', blurb: 'Topaz: opens the clip up to high dynamic range - deeper shadows, brighter highlights.', price: 'by length', maxSec: 60 },
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
  // 2026-10-22: every other public clip edit whose inputs a shot has
  { id: 'kling-o3-4k-edit', label: 'Edit with words (Kling O3 4K)', group: 'change', blurb: 'Kling O3\'s clip edit rendered in 4K - for hero shots. Your cast pictures keep faces and costumes right.', price: 'by length (3-15s clips)',
    prompt: 'required', placeholder: 'e.g. make it night with rain; @Image1 is the woman in the clip', refs: { max: 4, label: 'Cast pictures (@Image1...)' }, minSec: 3, maxSec: 15 },
  { id: 'kling-o3-pro-reference', label: 'Reshoot from the clip (Kling O3)', group: 'change', blurb: 'A new take made FROM this clip (@Video1): its people, place and look, re-staged or seen from another angle as you describe.', price: 'by the seconds made',
    prompt: 'required', placeholder: 'e.g. the same scene from behind @Video1\'s woman as she walks away; @Image1 is her', refs: { max: 4, label: 'Cast pictures (@Image1...)' },
    choice: { key: 'duration', label: 'Length', options: ['3', '5', '8', '10', '15'].map(s => ({ value: s, label: `${s}s` })), def: '5' }, minSec: 3, maxSec: 15 },
  { id: 'kling-o3-4k-reference', label: 'Reshoot from the clip (Kling O3 4K)', group: 'change', blurb: 'The same reshoot from the clip, rendered in 4K.', price: 'by the seconds made',
    prompt: 'required', placeholder: 'e.g. a close-up of @Video1\'s man as he turns; @Image1 is him', refs: { max: 4, label: 'Cast pictures (@Image1...)' },
    choice: { key: 'duration', label: 'Length', options: ['3', '5', '8', '10', '15'].map(s => ({ value: s, label: `${s}s` })), def: '5' }, minSec: 3, maxSec: 15 },
  { id: 'luma-ray-2-modify', label: 'Restyle (Luma Ray 2)', group: 'change', blurb: 'The full Ray 2 restyle - richer than the Flash one, same controls. A styled first frame steers it.', price: 'by length',
    prompt: 'optional', placeholder: 'e.g. hand-painted watercolour', refs: { max: 1, label: 'Styled first frame (optional)' }, choice: { key: 'lumaMode', label: 'How far', options: LUMA_MODES, def: 'flex_1' }, maxSec: 30 },
  { id: 'lucy-edit-pro', label: 'Edit with words (Lucy)', group: 'change', blurb: 'Lucy Edit Pro transforms what is in the clip - a costume, a material, a creature - and keeps the motion (720p).', price: 'by length',
    prompt: 'required', placeholder: 'e.g. make him a chrome robot', extra: { resolution: '720p' }, maxSec: 15 },
  /*
   * Reframes fit the clip AS RENDERED (the take's rawUrl, when the model made
   * another shape than the board's) to the board's frame by painting in the
   * missing edges - the frame goes as klingAspectRatio, which is the board's
   */
  { id: 'luma-ray-2-flash-reframe', label: 'Fill the frame (Luma Flash)', group: 'change', blurb: 'For a clip the model made in another shape: paints in the missing edges to fill the board\'s frame instead of cropping.', price: 'by length',
    prompt: 'optional', placeholder: 'optional: what the new edges show', maxSec: 30 },
  { id: 'luma-ray-2-reframe', label: 'Fill the frame (Luma Ray 2)', group: 'change', blurb: 'The fuller Ray 2 reframe: paints in the missing edges to fill the board\'s frame.', price: 'by length',
    prompt: 'optional', placeholder: 'optional: what the new edges show', maxSec: 30 },
  { id: 'luma-ray-3.2-reframe', label: 'Fill the frame (Luma Ray 3.2)', group: 'change', blurb: 'Ray 3.2\'s reframe to the board\'s frame - say what fills the new space (up to 10s).', price: 'by length',
    prompt: 'required', placeholder: 'e.g. more of the rainy street on both sides', extra: { resolution: '720p' }, maxSec: 10 },
  { id: 'minimax-h3-max-reframe', label: 'Fill the frame (MiniMax H3)', group: 'change', blurb: 'H3 Max fits the clip into the board\'s frame and outpaints the rest, keeping its timing and sound (up to 15s).', price: 'by length and resolution',
    prompt: 'optional', placeholder: 'optional: what fills the new space', choice: MM_RES('480p', '768p', '1080p'), maxSec: 15 },
  { id: 'minimax-h3-max-relight', label: 'Relight', group: 'change', blurb: 'Re-lights the clip from a picture of a lit sphere (a grey or chrome ball in the light you want), keeping its people, motion and camera. Add that picture to Assets first.', price: 'by length and resolution',
    refs: { max: 1, required: true, label: 'Lighting picture (a lit sphere)' }, choice: MM_RES('480p', '768p', '1080p'), maxSec: 15 },
  { id: 'pixelcut-video-bg-removal', label: 'Remove background', group: 'change', blurb: 'Cuts the people and things out of the clip onto a plain colour - a green screen for compositing.', price: 'by length',
    choice: { key: 'videoChoice', label: 'Background', options: [{ value: 'green', label: 'Green screen' }, { value: 'blue', label: 'Blue screen' }, { value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'magenta', label: 'Magenta' }], def: 'green' }, maxSec: 60 },
  { id: 'sam-3.1-video', label: 'Track and mask', group: 'change', blurb: 'SAM 3.1 finds what you name and tracks it through the clip, drawn as a mask - to check a subject or make a matte.', price: 'by length',
    prompt: 'required', placeholder: 'e.g. the dog, the red car (commas for several)', maxSec: 120 },
  { id: 'depth-anything-video', label: 'Depth map', group: 'change', blurb: 'The clip as a depth map - near to far as colour - for compositing or a stylised look.', price: 'by length',
    choice: { key: 'videoChoice', label: 'Colours', options: [{ value: 'turbo', label: 'Turbo (near = warm)' }, { value: 'grayscale', label: 'Grayscale' }, { value: 'inferno', label: 'Inferno' }, { value: 'magma', label: 'Magma' }, { value: 'viridis', label: 'Viridis' }], def: 'turbo' }, maxSec: 100 },
  { id: 'veed-subtitles', label: 'Burn in subtitles', group: 'change', blurb: 'VEED writes the speech onto the picture as captions, in the style you pick.', price: 'per started minute (animated styles 2x)',
    choice: { key: 'videoChoice', label: 'Style', options: [{ value: 'simple', label: 'Simple' }, { value: 'plain', label: 'Plain' }, { value: 'corpo', label: 'Corporate' }, { value: 'karl', label: 'Karl' }, { value: 'mint', label: 'Mint' }, { value: 'vegas', label: 'Vegas' }, { value: 'beans', label: 'Beans' }, { value: 'hustle', label: 'Hustle' }, { value: 'rizz', label: 'Rizz' }, { value: 'lowkey', label: 'Lowkey' }, { value: 'glide', label: 'Glide (animated)' }, { value: 'glass', label: 'Glass (animated)' }, { value: 'handwritten', label: 'Handwritten (animated)' }, { value: 'backdrop', label: 'Backdrop (animated)' }, { value: 'terminal', label: 'Terminal (animated)' }, { value: 'fusion', label: 'Fusion (animated)' }], def: 'simple' } },
  // people
  { id: 'minimax-h3-max-recast', label: 'Recast a face', group: 'people', blurb: 'Puts your cast member\'s face on the person in the clip, keeping the performance (5-30s clips).', price: 'by length',
    prompt: 'optional', placeholder: 'optional: who to change', refs: { max: 4, required: true, label: 'Face pictures' }, minSec: 5, maxSec: 30 },
  { id: 'wan-2.2-animate-replace', label: 'Replace the character', group: 'people', blurb: 'Swaps the character for your cast picture, following the original\'s motion (up to 15s).', price: 'by length',
    refs: { max: 1, required: true, label: 'Character picture' }, maxSec: 15, extra: { resolution: '720p' } },
  { id: 'lipsync-v3', label: 'Lip-sync to the voice line', group: 'people', blurb: 'Moves the speaker\'s lips to this shot\'s recorded line - the line is then part of the clip.', price: 'by length', usesLine: true },
  { id: 'dreamactor-v2', label: 'Act it out (DreamActor)', group: 'people', blurb: 'Your cast picture performs this clip - its motion, expressions and lips. People, cartoon characters and pets all work (up to 30s).', price: 'by length',
    refs: { max: 1, required: true, label: 'Character picture' }, maxSec: 30 },
  // length
  { id: 'grok-video-extend', label: 'Extend (Grok)', group: 'length', blurb: 'Carries the clip on for a few more seconds (2-15s clips).', price: 'by added seconds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 2, max: 10, def: 4 }, minSec: 2, maxSec: 15 },
  { id: 'minimax-h3-max-extend', label: 'Extend (MiniMax H3)', group: 'length', blurb: 'A longer continuation at up to 1080p.', price: 'by added seconds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 5, max: 15, def: 5 }, extra: { resolution: '768p' } },
  { id: 'minimax-h3-max-turbo-extend', label: 'Extend (H3 Turbo)', group: 'length', blurb: 'H3 at half the price - 1 to 15 more seconds, up to 2K (1.6-60s clips).', price: 'by added seconds and resolution',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 1, max: 15, def: 5 }, choice: MM_RES('480p', '768p', '1080p', '2k'), minSec: 1.6, maxSec: 60 },
  { id: 'pixverse-v6-extend', label: 'Extend (PixVerse V6)', group: 'length', blurb: 'Carries the clip on, with sound, at a low price.', price: 'by added seconds and resolution',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 1, max: 15, def: 5 },
    choice: { key: 'resolution', label: 'At', options: [{ value: '540p', label: '540p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], def: '720p' }, extra: { generateAudio: true }, maxSec: 30 },
  // Veo extends only what Veo made - the route checks the clip came from Veo 3.1 (and refuses before any charge)
  { id: 'veo-3.1-extend', label: 'Extend (Veo 3.1)', group: 'length', blurb: 'Seven more seconds with sound - ONLY for a clip Veo 3.1 made (720p or 1080p, 16:9 or 9:16).', price: 'Veo rates on the 7s it adds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 7, max: 7, def: 7 }, extra: { generateAudio: true }, maxSec: 30 },
  { id: 'veo-3.1-fast-extend', label: 'Extend (Veo 3.1 Fast)', group: 'length', blurb: 'Veo Fast\'s seven more seconds, cheaper - ONLY for a clip Veo 3.1 made.', price: 'Veo Fast rates on the 7s it adds',
    prompt: 'required', placeholder: 'what happens next', adds: { min: 7, max: 7, def: 7 }, extra: { generateAudio: true }, maxSec: 30 },
  // sound
  { id: 'mirelo-sfx2-video', label: 'Sound effects', group: 'sound', blurb: 'Mirelo SFX 2.0 builds a soundtrack of effects to the picture (keeps any speech).', price: 'by length',
    prompt: 'optional', placeholder: 'optional: e.g. footsteps on gravel, distant thunder' },
  { id: 'mirelo-sfx-video', label: 'Sound effects (Mirelo 1.6)', group: 'sound', blurb: 'The earlier Mirelo: synced effects to the picture, a little cheaper than 2.0 (up to 60s).', price: 'by length',
    prompt: 'optional', placeholder: 'optional: e.g. footsteps on gravel, distant thunder', maxSec: 60 },
  { id: 'heygen-translate', label: 'Translate (HeyGen)', group: 'sound', blurb: 'The speech dubbed into another language with the lips re-synced to it.', price: 'by length',
    choice: { key: 'videoChoice', label: 'Into', options: HEYGEN_LANGUAGES.map(l => ({ value: l, label: l })), def: 'Spanish' } },
  { id: 'heygen-translate-fast', label: 'Translate fast (HeyGen)', group: 'sound', blurb: 'HeyGen\'s faster translation, half the price - lips re-synced too.', price: 'by length',
    choice: { key: 'videoChoice', label: 'Into', options: HEYGEN_LANGUAGES.map(l => ({ value: l, label: l })), def: 'Spanish' } },
  { id: 'elevenlabs-dubbing', label: 'Dub (ElevenLabs)', group: 'sound', blurb: 'The voices re-recorded in another language - the lips are not re-synced.', price: 'per started minute',
    choice: { key: 'videoChoice', label: 'Into', options: DUB_LANGUAGES.map(([v, l]) => ({ value: v, label: l })), def: 'es' } },
]
export const clipTool = (id: string) => CLIP_TOOLS.find(t => t.id === id)
