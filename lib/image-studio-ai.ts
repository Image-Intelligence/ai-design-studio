/**
 * Image Studio - the generative tools (Phase 2) and what each one costs.
 *
 * Client-safe: the editor prices its buttons with these and the route
 * (app/api/employees/image-studio/[id]/ai) charges with the SAME functions,
 * so the number on a button is the number taken. The site's rule is fal's
 * price / $0.04, rounded up (fal prices checked 2026-10-06 on their pricing
 * API); models the portal already sells are priced as the portal prices them.
 *
 *   fill      FLUX.1 Pro Fill        $0.05 per started megapixel of the region
 *   erase     Bria Eraser            $0.04 a run                    -> 1 ticket
 *   expand    Bria Expand            $0.04 a run                    -> 1 ticket
 *   upscale   SeedVR2 / Topaz        the portal's own upscaler prices
 *   edit      any image model with references (lib/storyboard stillTickets)
 *   generate  any image model                  (lib/storyboard stillTickets)
 *   tool      the picture tools (PICTURE_TOOLS) - the portal's own price for
 *             each: Topaz per output MP (topazImageTicketCost), the rest the
 *             catalogue's (getTicketCost), as /api/generate charges them
 */
import { getTicketCost } from '@/config/ai-models.config'
import { topazImageTicketCost, clarityUpscaleTicketCost, seedvrUpscaleTicketCost, CLARITY_MAX_OUTPUT_PX } from '@/lib/ticket-pricing'
import { STORYBOARD_IMAGE_MODELS, STORYBOARD_ASPECTS, stillTickets } from '@/lib/storyboard'
import { ADMIN_ONLY_IMAGE_MODELS } from '@/lib/chat-image-catalog'
import { getCreateModel } from '@/lib/chat-hub-models'
import { getFalImageModelSpec } from '@/lib/fal-image-models'

export type StudioGenOp = 'fill' | 'erase' | 'expand' | 'upscale' | 'edit' | 'generate' | 'tool'

/** The region a fill / erase sends: at most this many pixels (it is scaled down to fit, then the result scaled back). */
export const FILL_MAX_PIXELS = 2_000_000
/** Bria Expand: "an area of less than 5000x5000"; the page scales a bigger canvas down for the request. */
export const EXPAND_MAX_SIDE = 4800
export const EXPAND_MAX_PIXELS = 24_000_000
/** The largest picture an upscale may return (a layer's pixels; the canvas itself stops at MAX_CANVAS_SIDE). */
export const UPSCALE_MAX_SIDE = 8192

export const ERASE_TICKETS = 1
export const EXPAND_TICKETS = 1

/** FLUX.1 Pro Fill bills $0.05 per megapixel, each started one counted. */
export function fillTickets(w: number, h: number): number {
  const mp = Math.max(1, Math.ceil((w * h) / 1e6 - 1e-9))
  return Math.max(1, Math.ceil((0.05 * mp) / 0.04 - 1e-9))
}

/*
 * fixed: the model only renders this factor (AuraSR, DRCT: 4x) - a smaller
 * scale shrinks the source first, so the run makes exactly the size asked for
 * and is priced on it. maxOut: the longest output side fal accepts (Clarity
 * refuses past ~4096px). The four fal upscalers joined 2026-10-08, when the
 * portal made them public.
 */
export const UPSCALERS = [
  { id: 'seedvr2-upscale', label: 'SeedVR2', hint: 'Faithful and clean - photos, renders, stills', maxFactor: 10, fixed: 0, maxOut: UPSCALE_MAX_SIDE },
  { id: 'topaz-img-upscale-precision', label: 'Topaz Precision', hint: 'Recovers fine detail, enhances faces', maxFactor: 4, fixed: 0, maxOut: UPSCALE_MAX_SIDE },
  { id: 'clarity-upscaler', label: 'Clarity', hint: 'Creative - invents new detail as it enlarges; great on AI art (up to 4096px)', maxFactor: 4, fixed: 0, maxOut: CLARITY_MAX_OUTPUT_PX },
  { id: 'esrgan', label: 'ESRGAN', hint: 'Classic Real-ESRGAN - clean, quick and cheap', maxFactor: 8, fixed: 0, maxOut: UPSCALE_MAX_SIDE },
  { id: 'aura-sr', label: 'AuraSR', hint: 'Fast GAN upscaler, tuned for FLUX-style renders', maxFactor: 4, fixed: 4, maxOut: UPSCALE_MAX_SIDE },
  { id: 'drct', label: 'DRCT', hint: 'Detail-preserving transformer - sharp, no invented detail', maxFactor: 4, fixed: 4, maxOut: UPSCALE_MAX_SIDE },
  // The rest of the public Topaz suite (2026-10-22), each built by its
  // lib/fal-image-models spec on the spec's default model (Bloom 2 / Wonder 3).
  // Transparent renders a fixed 4x (no factor in its schema)
  { id: 'topaz-img-upscale-creative', label: 'Topaz Bloom', hint: 'Creative - Topaz Bloom 2 re-imagines texture and detail as it enlarges', maxFactor: 4, fixed: 0, maxOut: UPSCALE_MAX_SIDE },
  { id: 'topaz-img-upscale-generative', label: 'Topaz Wonder', hint: 'Generative - Topaz Wonder 3 rebuilds detail in soft or small pictures, faces too', maxFactor: 4, fixed: 0, maxOut: UPSCALE_MAX_SIDE },
  { id: 'topaz-img-upscale-transparent', label: 'Topaz Transparent', hint: 'Keeps transparency - cut-outs, logos, stickers', maxFactor: 4, fixed: 4, maxOut: UPSCALE_MAX_SIDE },
] as const
export type UpscalerId = (typeof UPSCALERS)[number]['id']
export const isUpscaler = (v: unknown): v is UpscalerId => UPSCALERS.some(u => u.id === v)

/**
 * The factor an upscale will really use: what was asked, held to the model's
 * own limit and to `maxSide` on the long edge. Below 1.1x it is not worth a run (0).
 */
export function upscaleFactor(id: UpscalerId, asked: number, w: number, h: number, maxSide = UPSCALE_MAX_SIDE): number {
  const u = UPSCALERS.find(x => x.id === id)
  const lim = u?.maxFactor ?? 4
  const f = Math.min(Number(asked) || 2, lim, Math.min(maxSide, u?.maxOut ?? maxSide) / Math.max(w, h, 1))
  return f < 1.1 ? 0 : Math.floor(f * 100) / 100
}

/** Tickets for one upscale of a w x h picture by `factor` - as the portal charges for the same upscaler. */
export function upscaleTickets(id: UpscalerId, factor: number, w: number, h: number): number {
  if (id === 'seedvr2-upscale') return seedvrUpscaleTicketCost({ mode: 'factor', factor, width: w, height: h })
  // The portal's prices: Clarity per output MP (floor 7 / 26), ESRGAN and
  // AuraSR 1 flat (fal bills them by the compute second - pennies), DRCT 1
  // ticket per 2 output MP ($0.0045 / MP)
  if (id === 'clarity-upscaler') return clarityUpscaleTicketCost(factor, w, h)
  if (id === 'esrgan' || id === 'aura-sr') return 1
  if (id === 'drct') return Math.max(1, Math.ceil((w * factor) * (h * factor) / 1e6 * 0.5))
  // Transparent's 4x runs on the source shrunk to factor / 4 (the route): the
  // portal's price for that smaller picture
  if (id === 'topaz-img-upscale-transparent') return topazImageTicketCost(id, { width: w * factor / 4, height: h * factor / 4 })
  return topazImageTicketCost(id, { upscaleFactor: factor, width: w, height: h })
}

/*
 * The picture tools (2026-10-22, owner: every public model usable in the
 * studios): the site's public one-picture fal tools, each run on the selected
 * layer or the whole image and placed back as a layer. The fal input is built
 * by the model's own lib/fal-image-models spec (the one /api/generate uses)
 * and each is priced as the portal prices it (pictureToolTickets).
 *
 *   place  same     the result takes the source's box (cropped to its shape,
 *                   centred, as an AI edit); the source is hidden, not deleted
 *          reframe  a new frame around the source (Luma Reframe)
 *          layers   Layerize: the background and each object as its own layer
 *   maxSide   the longest side fal gets - the shrink /api/generate does for
 *             the same model (Marigold, the vectorizers 2048, Multi-Angle 1536)
 *   extra     pictures added after the source (the panel's reference strip):
 *             how many it takes, how many it needs
 *   keepAlpha the tool returns an opaque picture: the source's transparency goes back on
 *   svg       SVG out: rasterised for the layer, the SVG itself kept in My Generations
 *
 * Not here: Luma Photon Modify (Luma Photon / Photon Flash in "Edit this
 * layer" already run it) and the text-to-SVG Ideogram Vector (no picture in).
 */
export type PictureTool = {
  id: string
  label: string
  group: string
  hint: string
  place: 'same' | 'reframe' | 'layers'
  /** the prompt box: whether it is needed, and what it asks for */
  prompt?: { need: boolean; placeholder: string }
  /** Topaz: the models it offers, the spec's default first (mirrors lib/fal-image-models) */
  models?: readonly string[]
  maxSide?: number
  extra?: { max: number; need: number; label: string }
  keepAlpha?: boolean
  svg?: boolean
}
export const PICTURE_TOOLS: readonly PictureTool[] = [
  // ── retouch (Topaz, priced per output MP) ──
  { id: 'topaz-adjust', label: 'Topaz Adjust', group: 'Retouch', place: 'same', keepAlpha: true, models: ['Adjust V2', 'White Balance', 'Colorize'],
    hint: 'Auto exposure, colour and contrast - or fix the white balance, or colourise a black-and-white photo' },
  { id: 'topaz-sharpen', label: 'Topaz Sharpen', group: 'Retouch', place: 'same', keepAlpha: true,
    models: ['Standard', 'Strong', 'Lens Blur V2', 'Motion Blur', 'Natural', 'Refocus', 'Wildlife', 'Portrait', 'Auto Sharpen', 'Super Focus V3', 'Super Focus V2'],
    hint: 'Removes blur - lens, motion or soft focus' },
  { id: 'topaz-denoise', label: 'Topaz Denoise', group: 'Retouch', place: 'same', keepAlpha: true, models: ['Normal', 'Strong', 'Extreme', 'Denoise Max'],
    hint: 'Cleans grain and noise, keeps the detail' },
  { id: 'topaz-restore', label: 'Topaz Restore', group: 'Retouch', place: 'same', keepAlpha: true, models: ['Recover 3', 'Dust-Scratch V2'],
    hint: 'Brings back old, damaged or low-quality photos; Dust-Scratch V2 cleans dust and scratches' },
  // ── cut-out and background ──
  { id: 'pixelcut-bg-removal', label: 'Background Removal', group: 'Cut-out & background', place: 'same',
    hint: 'Pixelcut - the subject cut out on transparency, as a new layer' },
  { id: 'bria-replace-background', label: 'Replace Background', group: 'Cut-out & background', place: 'same',
    prompt: { need: true, placeholder: 'The new background - “a sunlit beach”, “a marble studio”…' },
    hint: 'Bria - keeps the subject, paints a new background from your words' },
  { id: 'pixelcut-product-photo', label: 'Product Photo', group: 'Cut-out & background', place: 'same',
    hint: 'Pixelcut - the product cut out and centred as a clean studio shot, on transparency or a colour' },
  // ── the shot ──
  { id: 'qwen-multi-angle', label: 'Multi-Angle Reshoot', group: 'The shot', place: 'same', maxSide: 1536,
    prompt: { need: false, placeholder: 'Anything to add (optional)' },
    hint: 'The same scene re-shot from another camera angle' },
  { id: 'luma-photon-reframe', label: 'Luma Photon Reframe', group: 'The shot', place: 'reframe',
    prompt: { need: false, placeholder: 'What the new space shows (optional)' },
    hint: 'Extends the picture to a new frame - a new layer around it' },
  { id: 'luma-photon-flash-reframe', label: 'Luma Photon Flash Reframe', group: 'The shot', place: 'reframe',
    prompt: { need: false, placeholder: 'What the new space shows (optional)' },
    hint: 'The faster, cheaper Reframe' },
  // ── style and vector ──
  { id: 'recraft-v4-style', label: 'Recraft v4 Style', group: 'Style & vector', place: 'same', extra: { max: 9, need: 0, label: 'More style pictures' },
    prompt: { need: true, placeholder: 'What to make, in this picture’s style…' },
    hint: 'A new picture in the look of this one (it is the style reference)' },
  { id: 'recraft-v4-style-pro', label: 'Recraft v4 Style Pro', group: 'Style & vector', place: 'same', extra: { max: 9, need: 0, label: 'More style pictures' },
    prompt: { need: true, placeholder: 'What to make, in this picture’s style…' },
    hint: 'The Pro model - finer, richer results in this picture’s style' },
  { id: 'recraft-v4-vector', label: 'Recraft v4 Vector', group: 'Style & vector', place: 'same', svg: true, extra: { max: 9, need: 0, label: 'More style pictures' },
    prompt: { need: true, placeholder: 'What to draw as vector art, in this picture’s style…' },
    hint: 'Vector art (SVG) in this picture’s style - placed as pixels, the SVG kept in My Generations' },
  { id: 'recraft-v4-vector-pro', label: 'Recraft v4 Vector Pro', group: 'Style & vector', place: 'same', svg: true, extra: { max: 9, need: 0, label: 'More style pictures' },
    prompt: { need: true, placeholder: 'What to draw as vector art, in this picture’s style…' },
    hint: 'The Pro vector model - placed as pixels, the SVG kept in My Generations' },
  { id: 'recraft-vectorize', label: 'Recraft Vectorize', group: 'Style & vector', place: 'same', svg: true, maxSide: 2048,
    hint: 'Traces the picture into flat vector shapes (best on logos and flat art) - the SVG is kept in My Generations' },
  { id: 'ideogram-vectorize', label: 'Ideogram Vectorize', group: 'Style & vector', place: 'same', svg: true, maxSide: 2048,
    hint: 'Traces the picture into an editable SVG - Default keeps finer detail, Simple uses fewer shapes' },
  // ── layers and depth ──
  { id: 'seedream-5-pro-layerize', label: 'SeeDream 5 Layerize', group: 'Layers & depth', place: 'layers',
    prompt: { need: false, placeholder: 'What to separate (optional)' },
    hint: 'Splits the picture into layers - the background, then each object on its own, in a group' },
  { id: 'seedream-5-flash-layerize', label: 'SeeDream 5 Flash Layerize', group: 'Layers & depth', place: 'layers',
    prompt: { need: false, placeholder: 'What to separate (optional)' },
    hint: 'The faster Layerize' },
  { id: 'marigold-v2', label: 'Marigold Depth Map', group: 'Layers & depth', place: 'same', maxSide: 2048,
    hint: 'A depth map of the picture - near is warm, far is cool' },
  // ── people and products: a second picture from the strip ──
  { id: 'google-virtual-try-on', label: 'Virtual Try-On', group: 'People & products', place: 'same', extra: { max: 1, need: 1, label: 'The garment or product' },
    hint: 'Dresses the person in this picture in the garment you add' },
  { id: 'bria-product-holding', label: 'Product in Hand', group: 'People & products', place: 'same', extra: { max: 3, need: 1, label: 'The product (1-3 shots)' },
    prompt: { need: false, placeholder: 'How they hold it (optional)' },
    hint: 'Puts the product you add in the hands of the person in this picture' },
  { id: 'bria-embed-product', label: 'Embed Product', group: 'People & products', place: 'same', extra: { max: 1, need: 1, label: 'The product' },
    hint: 'Places the product you add into this scene' },
]
export const pictureTool = (id: unknown) => PICTURE_TOOLS.find(t => t.id === id)
/** Reframe's new frames: the model's own list. */
export const pictureToolFrames = (id: string): string[] => getFalImageModelSpec(id)?.aspectRatios ?? []
/** The option keys a picture tool may send (each spec clamps its own values). */
export const PICTURE_TOOL_OPTIONS = ['topazModel', 'angleH', 'angleV', 'angleZoom', 'pixelcutBackgroundMode', 'pixelcutBackgroundColor', 'embedPlace', 'embedSize'] as const
/** The frames a picture tool sizes its output from (lib/fal-image-models' image sizes): the nearest to the source. */
export const PICTURE_FRAMES = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '9:21', '2:1', '1:2']
/** A tool's source is sent at most this big on its long side (the editor's fitWithin). */
export const PICTURE_TOOL_MAX_SIDE = 4096
export const pictureToolSendSize = (w: number, h: number) => {
  const k = Math.min(1, PICTURE_TOOL_MAX_SIDE / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
/**
 * Tickets for one run of a picture tool on a w x h source - what /api/generate
 * charges for the same model: Topaz by output megapixels on the measured source
 * (and the model picked), every other one the catalogue's flat price.
 */
export function pictureToolTickets(id: string, w: number, h: number, o: { topazModel?: string } = {}): number {
  if (id.startsWith('topaz-')) return topazImageTicketCost(id, { topazModel: o.topazModel, width: w, height: h })
  return getTicketCost(id)
}

/** Every image model of the site's catalog the studio offers (the Storyboard roster). */
export const STUDIO_IMAGE_MODELS = STORYBOARD_IMAGE_MODELS
/**
 * The models that can edit a picture from an instruction (they take a
 * reference image). Not Z-Image Turbo: its reference is an image-to-image
 * start at strength 0.6 - it repaints the picture lightly but does not follow
 * an instruction ("make the boat green" left it red, 2026-10-06).
 */
const NOT_EDITORS = new Set(['z-image-turbo'])
export const STUDIO_EDIT_MODELS = STORYBOARD_IMAGE_MODELS.filter(m => m.refs && !NOT_EDITORS.has(m.id))
export const canEdit = (id: string) => STUDIO_EDIT_MODELS.some(m => m.id === id)
export const STUDIO_ASPECTS = STORYBOARD_ASPECTS
// NanoBanana 2.1 for everyone (2026-10-09 - admins had NanoBanana Pro 2, the rest Pro)
export const DEFAULT_GEN_MODEL = 'nano-banana-2.1'
/**
 * What an account may pick: the Edit Image popup is for everyone, so the
 * site's admin-only image models (the same set /api/generate refuses -
 * NanoBanana Pro 2 among them) are left out for everyone else.
 */
export const studioModelsFor = <T extends { id: string }>(list: readonly T[], admin: boolean) => list.filter(m => admin || !ADMIN_ONLY_IMAGE_MODELS.has(m.id))
export const isAdminOnlyModel = (id: string) => ADMIN_ONLY_IMAGE_MODELS.has(id)
export const defaultGenModel = (admin: boolean) => (admin || !ADMIN_ONLY_IMAGE_MODELS.has(DEFAULT_GEN_MODEL) ? DEFAULT_GEN_MODEL : 'nano-banana-pro')

/** The frame of `list` (STUDIO_ASPECTS by default) closest to a w x h box. */
export function nearestAspect(w: number, h: number, list: readonly string[] = STUDIO_ASPECTS): string {
  const r = Math.log(Math.max(1e-6, w) / Math.max(1e-6, h))
  const ratios = list.filter(a => /^\d+:\d+$/.test(a))
  let best: string = ratios[0] ?? STUDIO_ASPECTS[0], bd = Infinity
  for (const a of ratios) {
    const [x, y] = a.split(':').map(Number)
    const dd = Math.abs(Math.log(x / y) - r)
    if (dd < bd) { bd = dd; best = a }
  }
  return best
}

/**
 * The frames a model offers - the same list as the portal's aspect picker, so
 * "auto" is there for the models that have it (NanoBanana Pro 2, Kling O3,
 * ChatGPT Images 2.5, Ideogram, FLUX 3...), first, as the portal shows it. From
 * the chat hub's catalog (hand-built models) or the fal registry (the rest);
 * GPT Image 2 takes pixel sizes, so it keeps the studio's frames (mapped by
 * GPT_SIZE_FOR_ASPECT), as does a model that lists none.
 */
const PORTAL_ASPECTS: Record<string, string[]> = {
  // The fal registry sizes these from any ratio (or lists "auto" only on the
  // edit variant), so its own lists say no "auto" - the portal's picker does
  // (app/admin/portal-v2 IMAGE_MODEL_CONFIGS); these mirror it
  'gpt-image-2.5': ['auto', '21:9', '2:1', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '1:2', '9:21'],
  'ideogram-4.5': ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '2:1', '1:2'],
  'ideogram-v4': ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
}
export function modelAspects(id: string): string[] {
  if (id === 'gpt-image-2') return [...STUDIO_ASPECTS]
  if (PORTAL_ASPECTS[id]) return [...PORTAL_ASPECTS[id]]
  const hub = getCreateModel(id)?.fields?.find(f => f.key === 'aspect')?.options
  const reg = (getFalImageModelSpec(id) as { aspectRatios?: string[] } | undefined)?.aspectRatios
  const raw = hub?.length ? hub : reg?.length ? reg : [...STUDIO_ASPECTS]
  const list = raw.filter(a => a === 'auto' || /^\d+:\d+$/.test(a))
  if (!list.length) return [...STUDIO_ASPECTS]
  return list.includes('auto') ? ['auto', ...list.filter(a => a !== 'auto')] : list
}
/** A new layer's frame: auto where the model has it (the portal's default), else the one nearest the canvas. */
export const defaultAspect = (id: string, w: number, h: number) => {
  const list = modelAspects(id)
  return list.includes('auto') ? 'auto' : nearestAspect(w, h, list)
}
/** An edit's frame: auto (follow the picture) where the model has it, else the one nearest the layer. */
export const editAspect = defaultAspect
/** A frame this model takes (an unknown one falls back to its default for that box). */
export const validAspect = (id: string, aspect: unknown, w = 1, h = 1) =>
  typeof aspect === 'string' && modelAspects(id).includes(aspect) ? aspect : defaultAspect(id, w, h)

/** Tickets for a generate / edit run: the portal's price for that model, quality, frame and reference count. */
// `options`: the model's own settings - NanoBanana 2.1's High thinking and web
// search cost more (the portal charged them; this didn't until 2026-10-09)
export const genTickets = (model: string, quality: string | undefined, aspect: string, refs: number, options?: Record<string, string>) =>
  stillTickets(model, quality, aspect, options, refs)

/**
 * The area a fill / erase sends: the selection's box with room around it (the
 * model needs to see what surrounds the hole to continue it), kept inside the
 * canvas. `sw` x `sh` is the size it is sent at - a small region is sent
 * larger (about 1024px on its long side, where these models work best) and a
 * big one smaller (FILL_MAX_PIXELS); the result is scaled back into the box.
 */
export function fillRegion(b: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const pad = Math.max(48, Math.round(Math.max(b.w, b.h) * 0.35))
  const x = Math.max(0, Math.floor(b.x - pad)), y = Math.max(0, Math.floor(b.y - pad))
  const w = Math.max(16, Math.min(W, Math.ceil(b.x + b.w + pad)) - x), h = Math.max(16, Math.min(H, Math.ceil(b.y + b.h + pad)) - y)
  const k = Math.min(Math.sqrt(FILL_MAX_PIXELS / (w * h)), Math.max(1, 1024 / Math.max(w, h)))
  const r8 = (v: number) => Math.max(16, Math.floor(v / 8) * 8)
  return { x, y, w, h, sw: r8(w * k), sh: r8(h * k) }
}
