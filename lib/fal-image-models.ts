/**
 * fal.ai image-model registry (2026-08 batch).
 *
 * Every input shape here was verified against the live OpenAPI schema at
 *   https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>
 * (components.schemas.*Input). Enum values are model-specific — they are NOT
 * interchangeable between models. If you change anything in this file, re-run
 * scripts/verify-fal-image-models.mjs before deploying: a wrong key is a paid
 * 422 for the account owner.
 *
 * These models are ADMIN-ONLY while under test; the gate lives in
 * app/api/generate/route.ts (ADMIN_ONLY_IMAGE_MODELS).
 */

export interface FalImageBuildContext {
  /** User prompt (already trimmed). May be '' for promptless models. */
  prompt: string
  /** Portal aspect ratio, e.g. '16:9'. Mapped per model to that model's enum. */
  aspectRatio: string
  /** Portal quality tier: '1k' | '2k' | '4k' (anything else is treated as 1k). */
  quality: string
  /** fal-hosted URLs for the user's reference / input images, in order. */
  imageUrls: string[]
  /** Raw request body — per-model knobs are read from here (all optional). */
  options: Record<string, any>
}

export interface FalImageModelSpec {
  /**
   * Sibling spec to run instead when the request carries reference images.
   * These families ship text-to-image and edit as separate fal endpoints; the
   * portal exposes ONE model and picks by what the user attached, the way
   * NanoBanana already behaves.
   */
  editVariant?: string
  /** App-side model id (matches config/ai-models.config.ts `id`). */
  id: string
  /** fal endpoint id passed to fal.queue.submit(). */
  endpoint: string
  /**
   * Endpoint chosen per request, for families that ship the SAME model under
   * several sibling endpoints. GPT Image 2.5 is one model with two renderers
   * — sunburst and flare — and the portal shows one entry with a variant
   * switch rather than cluttering the list with near-duplicates.
   */
  resolveEndpoint?(ctx: FalImageBuildContext): string
  /** Endpoint cannot run without at least one input image. */
  needsImage: boolean
  /** fal input field the input image(s) land in (null = none). */
  imageParam: 'image_url' | 'image_urls' | 'person_image_url' | null
  /** Max input images the endpoint accepts. */
  maxInputImages: number
  /** Endpoint has no prompt-ish field, or the prompt is optional. */
  promptRequired: boolean
  /** Aspect ratio enum this model accepts (null = model has no aspect_ratio). */
  aspectRatios: string[] | null
  /** True when the model takes width/height via `image_size` instead. */
  usesImageSize: boolean
  /** Schema minLength on `prompt` (fal 422s below this). */
  promptMin?: number
  /** Schema maxLength on `prompt` — the builder truncates rather than 422s. */
  promptMax?: number
  /** Human note surfaced in the report / UI. */
  notes?: string
  build(ctx: FalImageBuildContext): Record<string, any>
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns `value` when it is a member of `allowed`, otherwise `fallback`. */
function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Which GPT Image 2.5 renderer to run.
 *
 * Anything the client did not explicitly set falls to sunburst, the endpoint
 * fal lists first and the safer default while this is under test.
 */
function gptImage25Variant(ctx: FalImageBuildContext): 'sunburst' | 'flare' {
  return ctx.options.gptVariant === 'flare' ? 'flare' : 'sunburst'
}

/*
 * GPT Image 2.5 size limits, quoted from the endpoint's own schema:
 *   "Concrete sizes must have both dimensions as multiples of 16, max edge
 *    3840px, aspect ratio <= 3:1, total pixels between 655,360 and 8,294,400."
 */
const GPT25_MIN_PIXELS = 655_360
const GPT25_MAX_PIXELS = 8_294_400
const GPT25_MAX_EDGE = 3840

/**
 * Portal aspect ratio + quality tier to an explicit GPT Image 2.5 size.
 *
 * The named presets (`portrait_4_3` and friends) are FIXED small sizes — they
 * pinned every render to 768x1024 no matter which quality was chosen, which is
 * why asking for 4K returned 1K. `image_size` also accepts an explicit
 * {width, height}, and that is the only way to reach the endpoint's real
 * ceiling, so the tier picks actual dimensions.
 *
 * The result is forced inside every documented limit rather than trusted to
 * land there: an out-of-range size is a paid 422.
 */
export function gptImage25Size(aspectRatio: string, quality: string): { width: number; height: number } {
  /*
   * Derived from the RATIO ITSELF, not from the shared BASE_DIMS buckets.
   *
   * Those buckets are approximations chosen to be multiples of 64 — 16:9 lives
   * there as 1344x768, which is 1.750, and 3:4 as 896x1152, which is 0.778.
   * Every other model in this file has to accept that because it takes a
   * bucketed size. This endpoint takes arbitrary {width,height}, so asking for
   * 3:4 can actually return 3:4.
   */
  const [a, b] = aspectRatio.split(':').map(Number)
  const ratio = Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? a / b : 1

  // Pixel budget per tier. 4K is the endpoint's own ceiling, so the longest
  // edge lands as high as the shape allows.
  const target =
    quality === '4k' ? GPT25_MAX_PIXELS
    : quality === '2k' ? 4_194_304   // 2048^2
    : 1_048_576                      // 1024^2

  // Ratios past 3:1 are refused; pull the wide side in rather than 422.
  const safeRatio = Math.min(3, Math.max(1 / 3, ratio))

  let h = Math.sqrt(target / safeRatio)
  let w = h * safeRatio

  const edgeScale = Math.min(1, GPT25_MAX_EDGE / Math.max(w, h))
  w *= edgeScale
  h *= edgeScale

  const px = w * h
  const pixelScale =
    px > GPT25_MAX_PIXELS ? Math.sqrt(GPT25_MAX_PIXELS / px)
    : px < GPT25_MIN_PIXELS ? Math.sqrt(GPT25_MIN_PIXELS / px)
    : 1
  w *= pixelScale
  h *= pixelScale

  const snap = (v: number) => Math.max(16, Math.round(v / 16) * 16)
  w = snap(w)
  h = snap(h)

  // Snapping can nudge the result back over a ceiling — walk the long edge
  // down (and the short edge with it) until every limit holds again.
  while (w * h > GPT25_MAX_PIXELS || Math.max(w, h) > GPT25_MAX_EDGE) {
    if (w >= h) { w -= 16; h = snap(w / safeRatio) } else { h -= 16; w = snap(h * safeRatio) }
    if (w <= 16 || h <= 16) break
  }
  while (w * h < GPT25_MIN_PIXELS) {
    if (w >= h) { w += 16; h = snap(w / safeRatio) } else { h += 16; w = snap(h * safeRatio) }
  }
  return { width: w, height: h }
}

/**
 * Portal quality tier to GPT Image 2.5's rendering effort.
 *
 * `xhigh` and `max` exist but cost materially more per image, so 4K maps to
 * xhigh and `max` is only reachable by asking for it explicitly.
 */
function gptImage25Quality(ctx: FalImageBuildContext): string {
  const explicit = pickEnum(ctx.options.gptQuality, ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const, '' as any)
  if (explicit) return explicit
  return ctx.quality === '4k' ? 'xhigh' : ctx.quality === '2k' ? 'high' : 'medium'
}

/** Clamped number, or `undefined` when the caller didn't supply one. */
function num(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

/** Clamped integer, or `undefined`. */
function int(value: unknown, min: number, max: number): number | undefined {
  const n = num(value, min, max)
  return n === undefined ? undefined : Math.round(n)
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Drops keys whose value is undefined so we never send `"key": undefined`. */
function compact<T extends Record<string, any>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
  return obj
}

const BASE_DIMS: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '4:5': [896, 1120],
  '5:4': [1120, 896],
  '21:9': [1536, 640],
  '9:21': [640, 1536],
  '2:1': [1408, 704],
  '1:2': [704, 1408],
}

/**
 * Portal aspect ratio + quality tier → an explicit {width,height} for models
 * whose `image_size` accepts a custom object. `maxDim` keeps us inside each
 * provider's practical ceiling (the schema cap of 14142 is not a real limit).
 */
/**
 * The `loras` array for Ideogram's LoRA endpoints.
 *
 * Returns undefined rather than [] when there is nothing to send, so the
 * caller can drop the key entirely: an empty array is a valid input that
 * quietly selects the base model, which looks identical to a LoRA that failed
 * to load.
 */
/**
 * The size to ask Ideogram for, honouring "auto".
 *
 * Ideogram has no auto of its own — its schema is an explicit width/height or
 * one of six presets — so auto means "the reference's shape", measured by the
 * route and passed through. Rounded to a multiple of 16 for the VAE and fitted
 * to the ceiling the model actually honours.
 *
 * With no reference there is nothing to be automatic about, so it falls back
 * to the square the picker would otherwise have used.
 */
function ideogramSize(ctx: FalImageBuildContext, maxDim: number): { width: number; height: number } {
  if (ctx.aspectRatio !== 'auto') return imageSize(ctx.aspectRatio, ctx.quality, maxDim)
  /*
   * The reference decides when there is one. With no reference, a LoRA's
   * training crop is the next best answer and a much better one than a
   * square: a LoRA trained at 1024x1536 has only ever seen that frame, so
   * asking it for 1:1 asks for the one shape it was never shown. The caller
   * supplies this only when it applies - LoRA present, no reference.
   */
  const dims = (ctx.options.refDims ?? ctx.options.loraDims) as
    { width: number; height: number } | null | undefined
  if (!dims?.width || !dims?.height) return imageSize('1:1', ctx.quality, maxDim)
  /*
   * Shape from the reference, size from the quality buttons.
   *
   * This used to scale the reference's OWN pixels by a quality multiplier
   * capped at the endpoint maximum, which made the buttons do nothing in both
   * directions. A reference already at the cap - which every 2k generation
   * reused as a reference is - gave a multiplier of 1, so 1k and 2k both
   * returned the input's size. A small reference did the opposite: a 400x272
   * thumbnail produced 800x544 whatever was asked for.
   *
   * The aspect ratio is the only thing the reference is consulted for now.
   * The long side comes from the quality, exactly as it does for a named
   * ratio, and the endpoint's own ceiling still applies.
   */
  const longSideFor = ctx.quality === '4k' ? 4096 : ctx.quality === '2k' ? 2048 : 1024
  const target = Math.min(longSideFor, maxDim)
  const ratio = dims.width / dims.height
  const [w, h] = ratio >= 1 ? [target, target / ratio] : [target * ratio, target]
  const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16)
  return { width: round16(w), height: round16(h) }
}

/**
 * Ideogram's text remover.
 *
 * fal-ai/ideogram/v3/layerize-text pulls the text off a flat graphic and
 * returns the background it was sitting on, plus the text it lifted as HTML
 * and as structured containers. Its own schema calls the output image "The
 * background image with text removed", which is the job.
 *
 * It is a v3 endpoint and shares nothing with v4's inputs - no image_size, no
 * loras, no strength, no rendering_speed - so this is a diversion rather than
 * a fifth variant: the request leaves the family entirely and only the
 * attached image comes with it.
 */
const IDEOGRAM_TEXT_REMOVAL = 'fal-ai/ideogram/v3/layerize-text'

/** Is this request asking for text removal rather than generation? */
export function ideogramRemovesText(ctx: {
  options: Record<string, any>
  imageUrls: string[]
}): boolean {
  // Needs something to take the text OFF, so with no image the mode is inert
  // and the normal path runs - rather than failing on an endpoint that would
  // have rejected it anyway.
  return ctx.options?.ideogramMode === 'remove-text' && ctx.imageUrls.length > 0
}

/**
 * How far image-to-image departs from the source. fal's default is 0.8, and
 * measured at one seed that is a full re-render: the composition and the
 * scene carry over, the person does not. 0.3 keeps the subject.
 */
function ideogramStrength(options: Record<string, any>): number {
  const v = Number(options.ideogramStrength)
  return Number.isFinite(v) ? Math.min(1, Math.max(0.01, v)) : 0.8
}

function ideogramLoras(options: Record<string, any>): { path: string; scale: number }[] | undefined {
  // Scale is 0-4 per the schema; this used to clamp at 2 and quietly halve
  // the usable range.
  const clamp = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(4, Math.max(0, n)) : 1
  }
  const out: { path: string; scale: number }[] = []
  const first = typeof options.loraUrl === 'string' ? options.loraUrl.trim() : ''
  if (first) out.push({ path: first, scale: clamp(options.loraScale) })
  /*
   * Second and third. fal caps the array at 3, and the deltas ADD rather than
   * apply in turn, so three at full strength is three times the intended
   * effect — the caller is responsible for the totals, not this.
   */
  if (Array.isArray(options.extraLoras)) {
    for (const e of options.extraLoras) {
      const url = typeof e?.url === 'string' ? e.url.trim() : ''
      if (url && out.length < 3) out.push({ path: url, scale: clamp(e?.scale) })
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Which expansion settings each tier accepts, per their schemas.
 *
 * ideogram/v4/fast and /instant stop at Medium; the base tier, tiling,
 * image-to-image and every LoRA sibling take Large as well. A LoRA or a
 * reference relocates a Fast or Instant request onto one of those, so the
 * choice widens with it - which is why the specs decide this at build time
 * rather than from the model id.
 */
export const expansionChoices = (opts: { lora: boolean; ref: boolean; tier: string }): readonly string[] =>
  opts.lora || opts.ref || opts.tier === 'ideogram-v4' || opts.tier === 'ideogram-v4-tiling'
    ? ['None', 'Medium', 'Large']
    : ['None', 'Medium']

/** Largest side ideogram/v4/tiling returns as asked. Measured, not read. */
const IDEOGRAM_TILING_MAX_DIM = 2048

function imageSize(aspectRatio: string, quality: string, maxDim = 2048): { width: number; height: number } {
  const [bw, bh] = BASE_DIMS[aspectRatio] ?? BASE_DIMS['1:1']
  const mult = quality === '4k' ? 3 : quality === '2k' ? 2 : 1
  let w = bw * mult
  let h = bh * mult
  const scale = Math.min(1, maxDim / Math.max(w, h))
  w = Math.max(256, Math.round((w * scale) / 16) * 16)
  h = Math.max(256, Math.round((h * scale) / 16) * 16)
  return { width: w, height: h }
}

/** Truncates to the schema's maxLength; returns undefined for empty input. */
function clip(text: unknown, max: number): string | undefined {
  if (typeof text !== 'string') return undefined
  const t = text.slice(0, max)
  return t.length > 0 ? t : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// enum tables (verified per endpoint — do not share between models)
// ─────────────────────────────────────────────────────────────────────────────

const AR_REVE = ['4:1', '3:1', '21:9', '2:1', '17:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '1:2', '1:3', '1:4', 'auto'] as const
const AR_MAI = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const
const AR_GROK_T2I = ['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '9:20', '1:2'] as const
const AR_GROK_EDIT = ['auto', ...AR_GROK_T2I] as const
const AR_MUSE = ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'] as const
const AR_BRIA = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'] as const

/**
 * Bria FIBO styles.
 *
 * 'none' sends a plain prompt and lets the model decide, which is what the old
 * 'No Style' preset did. The rest map onto structured_prompt's free-text style
 * fields, so this list is a convenience, not a limit — the endpoint will take
 * any wording, and more entries can be added here without touching the schema.
 */
const BRIA_STYLES = ['none', 'photoreal', 'illustration', 'cinematic'] as const
const BRIA_STYLE_FIELDS: Record<string, { artistic_style?: string; style_medium?: string }> = {
  none:         {},
  photoreal:    { artistic_style: 'photorealistic', style_medium: 'photography' },
  illustration: { artistic_style: 'illustration', style_medium: 'digital illustration' },
  cinematic:    { artistic_style: 'cinematic', style_medium: 'film still' },
}
const AR_NB2 = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'] as const
const AR_NB2_LITE = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'] as const

const TOPAZ_PRECISION_MODELS = ['Standard V2', 'High Fidelity V3', 'High Fidelity V2', 'Low Resolution V2', 'CGI', 'Text Refine'] as const
const TOPAZ_CREATIVE_MODELS = ['Bloom 2', 'Bloom', 'Bloom Realism'] as const
const TOPAZ_GENERATIVE_MODELS = ['Wonder 3.5', 'Wonder 3', 'Wonder 2', 'Wonder', 'Recover 3', 'Standard MAX', 'Redefine', 'Recovery V2', 'Recovery'] as const
const TOPAZ_ADJUST_MODELS = ['Adjust V2', 'White Balance', 'Colorize'] as const
const TOPAZ_SHARPEN_MODELS = ['Standard', 'Strong', 'Lens Blur V2', 'Motion Blur', 'Natural', 'Refocus', 'Wildlife', 'Portrait', 'Auto Sharpen', 'Super Focus V3', 'Super Focus V2'] as const
const TOPAZ_DENOISE_MODELS = ['Normal', 'Strong', 'Extreme', 'Denoise Max'] as const
const TOPAZ_RESTORE_MODELS = ['Recover 3', 'Dust-Scratch V2'] as const
const TOPAZ_SUBJECT_DETECTION = ['All', 'Foreground', 'Background'] as const
// 'default' is ours, not fal's: it means send nothing and take their default.
const SEEDVR_UPSCALE_MODES = ['default', 'factor', 'target'] as const
const SEEDVR_TARGET_RESOLUTIONS = ['default', '720p', '1080p', '1440p', '2160p'] as const
const SEEDVR_OUTPUT_FORMATS = ['png', 'jpg', 'webp'] as const

const TOPAZ_OUTPUT_FORMATS = ['jpeg', 'png'] as const

/** Shared knobs for the simple single-image Topaz endpoints. */
function topazSimple<T extends string>(models: readonly T[], fallback: T) {
  return (ctx: FalImageBuildContext) =>
    compact({
      image_url: ctx.imageUrls[0],
      model: pickEnum(ctx.options.topazModel, models, fallback),
      output_format: pickEnum(ctx.options.topazOutputFormat, TOPAZ_OUTPUT_FORMATS, 'png'),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// registry
// ─────────────────────────────────────────────────────────────────────────────

export const FAL_IMAGE_MODELS: Record<string, FalImageModelSpec> = {
  // ── Qwen Image 3 ───────────────────────────────────────────────────────────
  /*
   * ChatGPT Images 2.5 (OpenAI, via fal).
   *
   * Ships as FOUR endpoints: two renderers (sunburst, flare) x two modes
   * (text-to-image, edit). Verified against the live schemas on 2026-09-08 —
   * all four take an identical input shape.
   *
   * The portal exposes ONE model. The renderer is a switch in the prompt bar
   * (they are the same model, so two list entries would be noise), and the
   * mode follows whether references are attached, exactly as NanoBanana does.
   *
   * image_size here is an ENUM, not the {width,height} object most of this
   * file's models take — passing a size object 422s.
   */
  'gpt-image-2.5': {
    id: 'gpt-image-2.5',
    editVariant: 'gpt-image-2.5-edit',
    promptMin: 1,
    promptMax: 32000,
    endpoint: 'openai/gpt-image-2.5/sunburst/text-to-image',
    resolveEndpoint: (ctx) =>
      gptImage25Variant(ctx) === 'flare'
        ? 'openai/gpt-image-2.5/flare/text-to-image'
        : 'openai/gpt-image-2.5/sunburst/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'Renderer: sunburst (default) or flare.',
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        image_size: gptImage25Size(ctx.aspectRatio, ctx.quality),
        quality: gptImage25Quality(ctx),
        background: pickEnum(ctx.options.gptBackground, ['auto', 'transparent', 'opaque'] as const, 'auto'),
        output_format: pickEnum(ctx.options.gptOutputFormat, ['png', 'jpeg', 'webp'] as const, 'png'),
        num_images: 1,
      }),
  },
  'gpt-image-2.5-edit': {
    id: 'gpt-image-2.5-edit',
    promptMin: 1,
    promptMax: 32000,
    endpoint: 'openai/gpt-image-2.5/sunburst/edit',
    resolveEndpoint: (ctx) =>
      gptImage25Variant(ctx) === 'flare'
        ? 'openai/gpt-image-2.5/flare/edit'
        : 'openai/gpt-image-2.5/sunburst/edit',
    needsImage: true,
    imageParam: 'image_urls',
    // The schema sets no ceiling; ten is the portal's own cap on a paid edit.
    maxInputImages: 10,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'Renderer: sunburst (default) or flare. Edits every attached reference together.',
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        image_urls: ctx.imageUrls,
        // "auto" keeps the source shape, which is what an edit almost always
        // wants; an explicit portal ratio still wins.
        image_size: ctx.aspectRatio && ctx.aspectRatio !== 'auto'
          ? gptImage25Size(ctx.aspectRatio, ctx.quality)
          : 'auto',
        quality: gptImage25Quality(ctx),
        background: pickEnum(ctx.options.gptBackground, ['auto', 'transparent', 'opaque'] as const, 'auto'),
        output_format: pickEnum(ctx.options.gptOutputFormat, ['png', 'jpeg', 'webp'] as const, 'png'),
        num_images: 1,
      }),
  },
  'qwen-image-3': {
    id: 'qwen-image-3',
    editVariant: 'qwen-image-3-edit',
    promptMin: 1,
    promptMax: 5000,
    endpoint: 'alibaba/qwen-image-3/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        image_size: imageSize(ctx.aspectRatio, ctx.quality, 4096),
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false,
        enable_prompt_expansion: bool(ctx.options.qwenPromptExpansion) ?? true,
        negative_prompt: clip(ctx.options.qwenNegativePrompt, 500),
      }),
  },
  'qwen-image-3-edit': {
    id: 'qwen-image-3-edit',
    promptMin: 1,
    promptMax: 5000,
    endpoint: 'alibaba/qwen-image-3/edit',
    needsImage: true,
    imageParam: 'image_urls',
    maxInputImages: 6,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        image_urls: ctx.imageUrls,
        image_size: imageSize(ctx.aspectRatio, ctx.quality, 4096),
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false,
        enable_prompt_expansion: bool(ctx.options.qwenPromptExpansion) ?? true,
        negative_prompt: clip(ctx.options.qwenNegativePrompt, 500),
      }),
  },

  // ── Reve 2.1 ───────────────────────────────────────────────────────────────
  'reve-2.1': {
    id: 'reve-2.1',
    editVariant: 'reve-2.1-edit',
    promptMin: 1,
    promptMax: 4000,
    endpoint: 'reve/2.1/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_REVE],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_REVE, 'auto'),
      num_images: 1,
      output_format: 'png',
    }),
  },
  'reve-2.1-edit': {
    id: 'reve-2.1-edit',
    promptMin: 1,
    promptMax: 4000,
    endpoint: 'reve/2.1/edit',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: [...AR_REVE],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      image_url: ctx.imageUrls[0],
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_REVE, 'auto'),
      num_images: 1,
      output_format: 'png',
    }),
  },

  // ── Microsoft MAI Image 2.5 Pro ────────────────────────────────────────────
  'mai-image-2.5-pro': {
    id: 'mai-image-2.5-pro',
    editVariant: 'mai-image-2.5-pro-edit',
    promptMin: 3,
    promptMax: 5000,
    endpoint: 'microsoft/mai-image-2.5-pro',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_MAI],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_MAI, 'auto'),
      output_format: 'png',
      num_images: 1,
    }),
  },
  'mai-image-2.5-pro-edit': {
    id: 'mai-image-2.5-pro-edit',
    promptMin: 3,
    promptMax: 5000,
    endpoint: 'microsoft/mai-image-2.5-pro/edit',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: [...AR_MAI],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      image_url: ctx.imageUrls[0],
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_MAI, 'auto'),
      output_format: 'png',
      num_images: 1,
    }),
  },

  // ── xAI Grok Imagine 2 ─────────────────────────────────────────────────────
  'grok-imagine-2': {
    id: 'grok-imagine-2',
    editVariant: 'grok-imagine-2-edit',
    promptMin: 1,
    promptMax: 8000,
    endpoint: 'xai/grok-imagine-image/v2.0/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_GROK_T2I],
    usesImageSize: false,
    notes: 'resolution 1k|2k; quality knob is low|medium (grokQuality)',
    build: (ctx) => ({
      prompt: ctx.prompt,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_GROK_T2I, '1:1'),
      resolution: ctx.quality === '1k' ? '1k' : '2k',
      quality: pickEnum(ctx.options.grokQuality, ['low', 'medium'] as const, 'medium'),
      num_images: 1,
      output_format: 'png',
    }),
  },
  'grok-imagine-2-edit': {
    id: 'grok-imagine-2-edit',
    promptMin: 1,
    promptMax: 8000,
    endpoint: 'xai/grok-imagine-image/v2.0/edit',
    needsImage: true,
    imageParam: 'image_urls',
    maxInputImages: 4,
    promptRequired: true,
    aspectRatios: [...AR_GROK_EDIT],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      image_urls: ctx.imageUrls,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_GROK_EDIT, 'auto'),
      resolution: ctx.quality === '1k' ? '1k' : '2k',
      quality: pickEnum(ctx.options.grokQuality, ['low', 'medium'] as const, 'medium'),
      num_images: 1,
      output_format: 'png',
    }),
  },

  // ── Meta Muse ──────────────────────────────────────────────────────────────
  'meta-muse': {
    id: 'meta-muse',
    editVariant: 'meta-muse-edit',
    promptMin: 1,
    promptMax: 20000,
    endpoint: 'meta/muse-image/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_MUSE],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_MUSE, '1:1'),
      num_images: 1,
      output_format: 'png',
    }),
  },
  'meta-muse-edit': {
    id: 'meta-muse-edit',
    promptMin: 1,
    promptMax: 20000,
    endpoint: 'meta/muse-image/edit',
    needsImage: true,
    imageParam: 'image_urls',
    maxInputImages: 10,
    promptRequired: true,
    aspectRatios: [...AR_MUSE],
    usesImageSize: false,
    build: (ctx) => ({
      prompt: ctx.prompt,
      image_urls: ctx.imageUrls,
      aspect_ratio: pickEnum(ctx.aspectRatio, AR_MUSE, '1:1'),
      num_images: 1,
      output_format: 'png',
    }),
  },

  // ── Bria FIBO 1.5 ──────────────────────────────────────────────────────────
  'bria-fibo': {
    id: 'bria-fibo',
    editVariant: 'bria-fibo-edit',
    endpoint: 'bria/fibo-gen-1.5/text-to-image',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_BRIA],
    usesImageSize: false,
    notes: 'resolution is 1MP|4MP. Style lives in structured_prompt, not style_preset.',
    build: (ctx) => {
      /*
       * Style, after Bria retired style_preset.
       *
       * FIBO 1.5 replaced the two-value preset with `structured_prompt`, a JSON
       * prompt whose fields include artistic_style and style_medium. That is a
       * superset of what the preset did — any style is expressible, not one of
       * two — but it is a different channel, so the two prompt forms are not
       * mixed here: a styled run puts the user's text in short_description and
       * sends no flat prompt, which leaves no question about precedence.
       */
      const style = pickEnum(ctx.options.briaStyle, BRIA_STYLES, 'none')
      const styled = style !== 'none'
      return compact({
        ...(styled
          ? {
              structured_prompt: compact({
                short_description: ctx.prompt,
                artistic_style: BRIA_STYLE_FIELDS[style].artistic_style,
                style_medium: BRIA_STYLE_FIELDS[style].style_medium,
              }),
            }
          : { prompt: ctx.prompt }),
        aspect_ratio: pickEnum(ctx.aspectRatio, AR_BRIA, '1:1'),
        resolution: ctx.quality === '1k' ? '1MP' : '4MP',
        seed: int(ctx.options.briaSeed, 0, 2_147_483_647),
      })
    },
  },
  'bria-fibo-edit': {
    id: 'bria-fibo-edit',
    endpoint: 'bria/fibo-edit-1.5/edit',
    needsImage: true,
    imageParam: 'image_urls',
    maxInputImages: 10,
    promptRequired: true,
    aspectRatios: [...AR_BRIA],
    usesImageSize: false,
    notes: 'prompt field is `instruction`, NOT `prompt`; no output_format/num_images',
    build: (ctx) =>
      compact({
        instruction: ctx.prompt,
        image_urls: ctx.imageUrls,
        aspect_ratio: pickEnum(ctx.aspectRatio, AR_BRIA, '1:1'),
        mask_url: typeof ctx.options.briaMaskUrl === 'string' ? ctx.options.briaMaskUrl : undefined,
        seed: int(ctx.options.briaSeed, 0, 2_147_483_647),
      }),
  },

  // ── Ideogram v4 ────────────────────────────────────────────────────────────
  'ideogram-v4-instant': {
    id: 'ideogram-v4-instant',
    promptMin: 1,
    promptMax: 10000,
    endpoint: 'ideogram/v4/instant',
    needsImage: false,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'fastest tier; a LoRA or a reference moves it to the matching sibling at TURBO',
    /*
     * Instant has no LoRA or image-to-image endpoint of its own, but it is a
     * speed TIER rather than a different model, and every sibling carries
     * rendering_speed with TURBO in its enum. So a LoRA or a reference moves
     * the request to the endpoint that accepts it and asks for the fastest
     * setting, instead of the feature being absent on this variant.
     */
    resolveEndpoint: (ctx) => {
      const lora = !!ideogramLoras(ctx.options)
      const img = ctx.imageUrls.length > 0
      if (img && lora) return 'ideogram/v4/image-to-image/lora'
      if (img) return 'ideogram/v4/image-to-image'
      if (lora) return 'ideogram/v4/lora'
      return 'ideogram/v4/instant'
    },
    build: (ctx) => {
      const loras = ideogramLoras(ctx.options)
      const img = ctx.imageUrls[0]
      return {
        prompt: ctx.prompt,
        image_size: ideogramSize(ctx, 2048),
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false,
        // 'Large' is a sibling-only field here: /instant stops at Medium, but
        // the endpoints a LoRA or a reference move this to do accept it.
        expansion_model: loras || img
          ? pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium', 'Large'] as const, 'Medium')
          : pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium'] as const, 'Medium'),
        // rendering_speed exists on every sibling but not on /instant itself,
        // so it is sent only once the request has moved off that endpoint.
        ...(loras ? { loras } : {}),
        ...(img ? { image_url: img, strength: ideogramStrength(ctx.options) } : {}),
        ...(loras || img ? { rendering_speed: 'TURBO' } : {}),
      }
    },
  },
  /*
   * The base tier. Same family as Fast and Instant; what it adds is the top of
   * the rendering_speed range and the 'Large' prompt expansion the other two
   * do not accept. Measured on one prompt and seed: BALANCED 9.8s inference,
   * QUALITY 19.6s, against Fast's 8.9s and Instant's 4.8s.
   *
   * Note the LoRA and image-to-image siblings below are THIS tier's — there
   * is no fast/lora — so attaching either already moved a Fast request here.
   */
  'ideogram-v4': {
    id: 'ideogram-v4',
    promptMin: 1,
    promptMax: 10000,
    endpoint: 'ideogram/v4',
    needsImage: false,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'base tier; rendering_speed TURBO|BALANCED|QUALITY, expansion up to Large',
    resolveEndpoint: (ctx) => {
      const lora = !!ideogramLoras(ctx.options)
      const img = ctx.imageUrls.length > 0
      if (img && lora) return 'ideogram/v4/image-to-image/lora'
      if (img) return 'ideogram/v4/image-to-image'
      if (lora) return 'ideogram/v4/lora'
      return 'ideogram/v4'
    },
    build: (ctx) => {
      const loras = ideogramLoras(ctx.options)
      const img = ctx.imageUrls[0]
      return {
        prompt: ctx.prompt,
        image_size: ideogramSize(ctx, 2048),
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false,
        // Only this tier and its siblings accept 'Large'.
        expansion_model: pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium', 'Large'] as const, 'Medium'),
        rendering_speed: pickEnum(ctx.options.ideogramRenderingSpeed, ['TURBO', 'BALANCED', 'QUALITY'] as const, 'BALANCED'),
        ...(loras ? { loras } : {}),
        ...(img ? { image_url: img, strength: ideogramStrength(ctx.options) } : {}),
      }
    },
  },

  'ideogram-v4-fast': {
    id: 'ideogram-v4-fast',
    promptMin: 1,
    promptMax: 10000,
    endpoint: 'ideogram/v4/fast',
    needsImage: false,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'rendering_speed TURBO|BALANCED|QUALITY; LoRA + i2i via sibling endpoints',
    /*
     * Four endpoints, one model. A LoRA or a reference image each move the
     * request to the sibling that accepts it, because the plain endpoint has
     * no loras field and would ignore the LoRA without complaint.
     */
    resolveEndpoint: (ctx) => {
      const lora = !!ideogramLoras(ctx.options)
      const img = ctx.imageUrls.length > 0
      if (img && lora) return 'ideogram/v4/image-to-image/lora'
      if (img) return 'ideogram/v4/image-to-image'
      if (lora) return 'ideogram/v4/lora'
      return 'ideogram/v4/fast'
    },
    build: (ctx) => {
      const loras = ideogramLoras(ctx.options)
      const img = ctx.imageUrls[0]
      return {
        prompt: ctx.prompt,
        image_size: ideogramSize(ctx, 2048),
        num_images: 1,
        output_format: 'png',
        enable_safety_checker: false,
        /*
         * ideogram/v4/fast stops at Medium, but the siblings a LoRA or a
         * reference move this to accept Large - the same reasoning the
         * Instant tier already uses. Offering Large on the plain endpoint
         * would be a 422; refusing it on the sibling loses a real setting.
         */
        expansion_model: loras || img
          ? pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium', 'Large'] as const, 'Medium')
          : pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium'] as const, 'Medium'),
        rendering_speed: pickEnum(ctx.options.ideogramRenderingSpeed, ['TURBO', 'BALANCED', 'QUALITY'] as const, 'BALANCED'),
        ...(loras ? { loras } : {}),
        ...(img ? { image_url: img, strength: ideogramStrength(ctx.options) } : {}),
      }
    },
  },

  /*
   * Seamless textures, not a bigger canvas.
   *
   * "Tiling" gets used for two unrelated things. This is the texture sense:
   * one image whose opposite edges match, so it repeats without a visible
   * join - wallpaper, fabric, ground cover. It is NOT tiled upscaling, and it
   * does not give more pixels than any other endpoint; what it gives is an
   * image you can repeat to cover any surface at all.
   *
   * Unlike Instant and Fast it accepts an input image with a strength, which
   * is how an existing texture is made to wrap.
   */
  'ideogram-v4-tiling': {
    id: 'ideogram-v4-tiling',
    promptMin: 1,
    promptMax: 10000,
    endpoint: 'ideogram/v4/tiling',
    needsImage: false,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: true,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'seamless tile; tiling_mode both|horizontal|vertical; LoRA via sibling',
    resolveEndpoint: (ctx) => ideogramLoras(ctx.options) ? 'ideogram/v4/tiling/lora' : 'ideogram/v4/tiling',
    build: (ctx) => ({
      prompt: ctx.prompt,
      image_size: ideogramSize(ctx, IDEOGRAM_TILING_MAX_DIM),
      num_images: 1,
      output_format: 'png',
      enable_safety_checker: false,
      expansion_model: pickEnum(ctx.options.ideogramExpansionModel, ['None', 'Medium', 'Large'] as const, 'Medium'),
      rendering_speed: pickEnum(ctx.options.ideogramRenderingSpeed, ['TURBO', 'BALANCED', 'QUALITY'] as const, 'BALANCED'),
      tiling_mode: pickEnum(ctx.options.tilingMode, ['both', 'horizontal', 'vertical'] as const, 'both'),
      ...(ideogramLoras(ctx.options) ? { loras: ideogramLoras(ctx.options) } : {}),
      // An input image is optional here: with one, it re-renders that texture
      // so the edges wrap; without, it invents one from the prompt.
      ...(ctx.imageUrls[0] ? { image_url: ctx.imageUrls[0], strength: ideogramStrength(ctx.options) } : {}),
    }),
  },

  // ── Google NanoBanana Pro 2 ───────────────────────────────────────────────
  // A real spec rather than a hand-rolled branch, so everything that speaks
  // "fal image model" can drive it: server-side batches, /api/generate's own
  // fal path, and the chat hub. resolution is a STRING enum, and so is
  // safety_tolerance (verified against fal's OpenAPI for this endpoint).
  'nano-banana-pro-2': {
    id: 'nano-banana-pro-2',
    editVariant: 'nano-banana-pro-2-edit',
    promptMin: 1,
    promptMax: 50000,
    endpoint: 'fal-ai/nano-banana-2',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_NB2],
    usesImageSize: false,
    notes: 'resolution and safety_tolerance are STRING enums',
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        aspect_ratio: pickEnum(ctx.aspectRatio, AR_NB2, 'auto'),
        resolution: ctx.quality === '4k' ? '4K' : ctx.quality === '1k' ? '1K' : '2K',
        output_format: 'png',
        num_images: 1,
        safety_tolerance: '6',
        enable_web_search: true,
      }),
  },
  'nano-banana-pro-2-edit': {
    id: 'nano-banana-pro-2-edit',
    promptMin: 1,
    promptMax: 50000,
    endpoint: 'fal-ai/nano-banana-2/edit',
    needsImage: true,
    imageParam: 'image_urls',
    maxInputImages: 14,
    promptRequired: true,
    aspectRatios: [...AR_NB2],
    usesImageSize: false,
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        image_urls: ctx.imageUrls,
        aspect_ratio: pickEnum(ctx.aspectRatio, AR_NB2, 'auto'),
        resolution: ctx.quality === '4k' ? '4K' : ctx.quality === '1k' ? '1K' : '2K',
        output_format: 'png',
        num_images: 1,
        safety_tolerance: '6',
        enable_web_search: true,
      }),
  },

  // ── Google NanoBanana 2 Lite ───────────────────────────────────────────────
  'nano-banana-2-lite': {
    id: 'nano-banana-2-lite',
    promptMin: 3,
    promptMax: 50000,
    endpoint: 'google/nano-banana-2-lite',
    needsImage: false,
    imageParam: null,
    maxInputImages: 0,
    promptRequired: true,
    aspectRatios: [...AR_NB2_LITE],
    usesImageSize: false,
    notes: 'safety_tolerance is a STRING enum "1".."6"',
    build: (ctx) =>
      compact({
        prompt: ctx.prompt,
        aspect_ratio: pickEnum(ctx.aspectRatio, AR_NB2_LITE, 'auto'),
        output_format: 'png',
        num_images: 1,
        safety_tolerance: pickEnum(
          typeof ctx.options.nb2LiteSafetyTolerance === 'number'
            ? String(ctx.options.nb2LiteSafetyTolerance)
            : ctx.options.nb2LiteSafetyTolerance,
          ['1', '2', '3', '4', '5', '6'] as const,
          '6',
        ),
        limit_generations: bool(ctx.options.nb2LiteLimitGenerations) ?? true,
        thinking_level:
          ctx.options.nb2LiteThinking === 'minimal' || ctx.options.nb2LiteThinking === 'high'
            ? ctx.options.nb2LiteThinking
            : undefined,
      }),
  },

  // ── Recraft v4 style / vector ──────────────────────────────────────────────
  'recraft-v4-style': recraftSpec('recraft-v4-style', 'recraft/v4/style/text-to-image'),
  'recraft-v4-style-pro': recraftSpec('recraft-v4-style-pro', 'recraft/v4/style/pro/text-to-image'),
  'recraft-v4-vector': recraftSpec('recraft-v4-vector', 'recraft/v4/style/text-to-vector'),
  'recraft-v4-vector-pro': recraftSpec('recraft-v4-vector-pro', 'recraft/v4/style/pro/text-to-vector'),

  // ── Pixelcut product photo ─────────────────────────────────────────────────
  'pixelcut-product-photo': {
    id: 'pixelcut-product-photo',
    endpoint: 'pixelcut/product-photo',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'no prompt; background mode Transparent|Color|Image',
    build: (ctx) => {
      const mode = pickEnum(ctx.options.pixelcutBackgroundMode, ['Transparent', 'Color', 'Image'] as const, 'Transparent')
      const rgb = ctx.options.pixelcutBackgroundColor
      const background: Record<string, any> = compact({
        mode,
        image_fit: mode === 'Image' ? pickEnum(ctx.options.pixelcutImageFit, ['Cover', 'Contain', 'Stretch'] as const, 'Cover') : undefined,
        image_url: mode === 'Image' && typeof ctx.options.pixelcutBackgroundImageUrl === 'string' ? ctx.options.pixelcutBackgroundImageUrl : undefined,
        color:
          mode === 'Color' && rgb && typeof rgb === 'object'
            ? { r: int(rgb.r, 0, 255) ?? 255, g: int(rgb.g, 0, 255) ?? 255, b: int(rgb.b, 0, 255) ?? 255 }
            : undefined,
      })
      return compact({
        image_url: ctx.imageUrls[0],
        image_size: imageSize(ctx.aspectRatio, ctx.quality, 2048),
        output_format: pickEnum(ctx.options.pixelcutOutputFormat, ['png', 'jpeg'] as const, 'png'),
        sync_mode: false,
        background,
        margin: typeof ctx.options.pixelcutMargin === 'string' ? { all: ctx.options.pixelcutMargin } : undefined,
      })
    },
  },

  // ── Google Virtual Try-On ──────────────────────────────────────────────────
  'google-virtual-try-on': {
    id: 'google-virtual-try-on',
    endpoint: 'google/virtual-try-on',
    needsImage: true,
    imageParam: 'person_image_url',
    maxInputImages: 2,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'needs TWO images: refs[0] = person, refs[1] = product/garment',
    build: (ctx) => ({
      person_image_url: ctx.imageUrls[0],
      product_image_url: ctx.imageUrls[1],
      num_images: 1,
    }),
  },

  // —— SeedVR2 ————————————————————————
  //
  // Verified against the live Input schema on 2026-09-09: image_url is the only
  // required field; upscale_mode decides whether upscale_factor (1-10) or
  // target_resolution is honoured, and the other is ignored, so only the
  // relevant one is sent. Billed per OUTPUT megapixel, which means the factor
  // is the price: 4× of a 4 MP source is sixteen times the cost of 1×.
  'seedvr2-upscale': {
    id: 'seedvr2-upscale',
    endpoint: 'fal-ai/seedvr/upscale/image',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'SeedVR2 upscaler. Output is `image` (singular), not `images`.',
    build: (ctx) => {
      /*
       * upscale_mode decides WHICH sizing field the model reads, so only the
       * relevant one is sent — passing both is not an error, but the queue row
       * is what the info panel reports later, and it should not claim a target
       * resolution on a run that went by factor. 'default' means send neither
       * and take fal's own (factor, 2x), matching the Default option in fal's
       * own form.
       */
      const mode = pickEnum(ctx.options.seedvrUpscaleMode, SEEDVR_UPSCALE_MODES, 'default')
      const target = pickEnum(ctx.options.seedvrTargetResolution, SEEDVR_TARGET_RESOLUTIONS, 'default')
      const sizing =
        mode === 'factor'
          ? { upscale_mode: 'factor', upscale_factor: num(ctx.options.seedvrUpscaleFactor, 1, 10) ?? 2 }
          : mode === 'target'
            ? { upscale_mode: 'target', ...(target === 'default' ? {} : { target_resolution: target }) }
            : {}
      return compact({
        image_url: ctx.imageUrls[0],
        ...sizing,
        // fal defaults to jpg; an upscaler that re-compresses its own output
        // undoes part of what it was asked to do.
        output_format: pickEnum(ctx.options.seedvrOutputFormat, SEEDVR_OUTPUT_FORMATS, 'png'),
        noise_scale: num(ctx.options.seedvrNoiseScale, 0, 1),
        seed: int(ctx.options.seedvrSeed, 0, 2147483647),
        // sync_mode is deliberately never sent. It returns the image as a
        // base64 data URI instead of a URL, which cannot work here: these jobs
        // are queued and delivered by webhook, and an upscale is exactly the
        // kind of output too large to survive a callback body.
      })
    },
  },

  // —— Topaz image suite ——————————————————————————
  'topaz-img-upscale-precision': {
    id: 'topaz-img-upscale-precision',
    endpoint: 'topaz/upscale/image/precision',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: (ctx) =>
      compact({
        image_url: ctx.imageUrls[0],
        model: pickEnum(ctx.options.topazModel, TOPAZ_PRECISION_MODELS, 'Standard V2'),
        upscale_factor: num(ctx.options.topazUpscaleFactor, 1, 4) ?? 2,
        subject_detection: pickEnum(ctx.options.topazSubjectDetection, TOPAZ_SUBJECT_DETECTION, 'All'),
        face_enhancement: bool(ctx.options.topazFaceEnhancement) ?? true,
        face_enhancement_strength: num(ctx.options.topazFaceEnhancementStrength, 0, 1) ?? 0.8,
        face_enhancement_creativity: num(ctx.options.topazFaceEnhancementCreativity, 0, 1) ?? 0,
        crop_to_fill: bool(ctx.options.topazCropToFill) ?? false,
        output_format: pickEnum(ctx.options.topazOutputFormat, TOPAZ_OUTPUT_FORMATS, 'png'),
        sharpen: num(ctx.options.topazSharpen, 0, 1),
        denoise: num(ctx.options.topazDenoise, 0, 1),
        fix_compression: num(ctx.options.topazFixCompression, 0, 1),
        strength: num(ctx.options.topazStrength, 0.01, 1),
      }),
  },
  'topaz-img-upscale-creative': {
    id: 'topaz-img-upscale-creative',
    endpoint: 'topaz/upscale/image/creative',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: (ctx) =>
      compact({
        image_url: ctx.imageUrls[0],
        model: pickEnum(ctx.options.topazModel, TOPAZ_CREATIVE_MODELS, 'Bloom 2'),
        upscale_factor: num(ctx.options.topazUpscaleFactor, 1, 4) ?? 2,
        output_format: pickEnum(ctx.options.topazOutputFormat, TOPAZ_OUTPUT_FORMATS, 'png'),
        crop_to_fill: bool(ctx.options.topazCropToFill) ?? false,
        creativity: int(ctx.options.topazCreativity, 1, 9),
        color_preservation: bool(ctx.options.topazColorPreservation),
        autoprompt: bool(ctx.options.topazAutoprompt),
      }),
  },
  'topaz-img-upscale-generative': {
    id: 'topaz-img-upscale-generative',
    endpoint: 'topaz/upscale/image/generative',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'optional guiding prompt',
    build: (ctx) =>
      compact({
        image_url: ctx.imageUrls[0],
        model: pickEnum(ctx.options.topazModel, TOPAZ_GENERATIVE_MODELS, 'Wonder 3'),
        upscale_factor: num(ctx.options.topazUpscaleFactor, 1, 4) ?? 2,
        subject_detection: pickEnum(ctx.options.topazSubjectDetection, TOPAZ_SUBJECT_DETECTION, 'All'),
        output_format: pickEnum(ctx.options.topazOutputFormat, TOPAZ_OUTPUT_FORMATS, 'png'),
        face_enhancement: bool(ctx.options.topazFaceEnhancement) ?? true,
        face_enhancement_strength: num(ctx.options.topazFaceEnhancementStrength, 0, 1) ?? 0.8,
        face_enhancement_creativity: num(ctx.options.topazFaceEnhancementCreativity, 0, 1) ?? 0,
        crop_to_fill: bool(ctx.options.topazCropToFill) ?? false,
        prompt: clip(ctx.prompt, 1024),
        autoprompt: bool(ctx.options.topazAutoprompt),
        creativity: int(ctx.options.topazCreativity, 1, 6),
        texture: int(ctx.options.topazTexture, 1, 5),
        detail: num(ctx.options.topazDetail, 0, 1),
        denoise: num(ctx.options.topazDenoise, 0, 1),
        sharpen: num(ctx.options.topazSharpen, 0, 1),
        enhancement_strength: ['low', 'medium', 'high'].includes(ctx.options.topazEnhancementStrength)
          ? ctx.options.topazEnhancementStrength
          : undefined,
      }),
  },
  'topaz-img-upscale-transparent': {
    id: 'topaz-img-upscale-transparent',
    endpoint: 'topaz/upscale/image/transparent',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    notes: 'output_format is const "png"; no upscale_factor',
    build: (ctx) => ({
      image_url: ctx.imageUrls[0],
      output_format: 'png',
    }),
  },
  'topaz-adjust': {
    id: 'topaz-adjust',
    endpoint: 'topaz/adjust/image',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: topazSimple(TOPAZ_ADJUST_MODELS, 'Adjust V2'),
  },
  'topaz-sharpen': {
    id: 'topaz-sharpen',
    endpoint: 'topaz/sharpen/image',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: topazSimple(TOPAZ_SHARPEN_MODELS, 'Standard'),
  },
  'topaz-denoise': {
    id: 'topaz-denoise',
    endpoint: 'topaz/denoise/image',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: topazSimple(TOPAZ_DENOISE_MODELS, 'Normal'),
  },
  'topaz-restore': {
    id: 'topaz-restore',
    endpoint: 'topaz/restore/image',
    needsImage: true,
    imageParam: 'image_url',
    maxInputImages: 1,
    promptRequired: false,
    aspectRatios: null,
    usesImageSize: false,
    build: topazSimple(TOPAZ_RESTORE_MODELS, 'Recover 3'),
  },
}

/**
 * Recraft v4 style/vector endpoints all share one input schema.
 * `image_urls` here are STYLE reference images (optional, 1-10), not an edit
 * source — the endpoints are text-to-image / text-to-vector.
 */
function recraftSpec(id: string, endpoint: string): FalImageModelSpec {
  return {
    id,
    endpoint,
    needsImage: false,
    imageParam: 'image_urls',
    maxInputImages: 10,
    promptRequired: true,
    promptMin: 1,
    promptMax: 10000,
    aspectRatios: null,
    usesImageSize: true,
    notes: 'image_urls are optional STYLE references; style_id is a Recraft style UUID',
    build: (ctx) => {
      const colors = Array.isArray(ctx.options.recraftColors)
        ? ctx.options.recraftColors
            .slice(0, 8)
            .filter((c: any) => c && typeof c === 'object')
            .map((c: any) => ({ r: int(c.r, 0, 255) ?? 0, g: int(c.g, 0, 255) ?? 0, b: int(c.b, 0, 255) ?? 0 }))
        : []
      const bg = ctx.options.recraftBackgroundColor
      return compact({
        prompt: ctx.prompt,
        image_size: imageSize(ctx.aspectRatio, ctx.quality, 2048),
        enable_safety_checker: false,
        colors,
        image_urls: ctx.imageUrls.length > 0 ? ctx.imageUrls.slice(0, 10) : undefined,
        style_id: typeof ctx.options.recraftStyleId === 'string' && ctx.options.recraftStyleId ? ctx.options.recraftStyleId : undefined,
        style_match: pickEnum(ctx.options.recraftStyleMatch, ['precise', 'flexible'] as const, 'flexible'),
        background_color:
          bg && typeof bg === 'object'
            ? { r: int(bg.r, 0, 255) ?? 0, g: int(bg.g, 0, 255) ?? 0, b: int(bg.b, 0, 255) ?? 0 }
            : undefined,
      })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// public API
// ─────────────────────────────────────────────────────────────────────────────

export const FAL_IMAGE_MODEL_IDS = Object.keys(FAL_IMAGE_MODELS)

/**
 * The fal image models that have finished testing and are open to everyone.
 *
 * The whole 2026-08 fal batch shipped admin-only while it was under test, by
 * spreading FAL_IMAGE_MODEL_IDS into the admin gate. Promoting one is
 * therefore a SUBTRACTION from that gate, and it has to happen in both places
 * that build it — /api/generate and the chat catalog — or a model is public
 * in the picker and 403s on submit.
 *
 * gpt-image-2.5-edit rides along with gpt-image-2.5: it is the same model's
 * edit endpoint, chosen automatically when references are attached, so leaving
 * it gated would make the model public right up until someone attached a
 * reference.
 */
export const PUBLIC_FAL_IMAGE_MODEL_IDS = new Set<string>([
  'gpt-image-2.5',
  'gpt-image-2.5-edit',
  'google-virtual-try-on',
  'seedvr2-upscale',
])

/** FAL_IMAGE_MODEL_IDS minus the ones that have been promoted. */
export const ADMIN_FAL_IMAGE_MODEL_IDS = FAL_IMAGE_MODEL_IDS
  .filter(id => !PUBLIC_FAL_IMAGE_MODEL_IDS.has(id))

export function getFalImageModelSpec(id: string): FalImageModelSpec | undefined {
  return FAL_IMAGE_MODELS[id]
}

/** Models in this batch that never need a text prompt. */
export function falImageModelIsPromptless(id: string): boolean {
  const spec = FAL_IMAGE_MODELS[id]
  return !!spec && !spec.promptRequired
}

/**
 * Builds the exact `input` object for fal.queue.submit(). Throws a plain Error
 * with a user-facing message when a required input image is missing.
 */
/**
 * The spec that should actually run: a merged family swaps to its edit sibling
 * as soon as the request has an input image. Falls back to the base when the
 * sibling is missing, so a bad id degrades to text-to-image rather than 500ing.
 */
export function resolveFalImageModelSpec(
  modelId: string,
  hasInputImages: boolean,
): FalImageModelSpec | undefined {
  const base = getFalImageModelSpec(modelId)
  if (!base || !hasInputImages || !base.editVariant) return base
  return getFalImageModelSpec(base.editVariant) ?? base
}

export function buildFalImageInput(
  spec: FalImageModelSpec,
  ctx: FalImageBuildContext,
): { endpoint: string; input: Record<string, any> } {
  if (spec.needsImage && ctx.imageUrls.length === 0) {
    throw new Error(`${spec.id} requires an input image`)
  }
  if (spec.id === 'google-virtual-try-on' && ctx.imageUrls.length < 2) {
    throw new Error('Virtual Try-On needs two images: a person photo and a product photo')
  }
  /*
   * Text removal takes the image and leaves the rest behind.
   *
   * Placed ahead of the prompt checks deliberately: the endpoint's only
   * required field is image_url, and demanding a prompt for a job that needs
   * none would refuse a perfectly valid request. A prompt is passed through
   * when there is one, because the schema accepts it as a hint.
   */
  if (spec.id.startsWith('ideogram-v4') && ideogramRemovesText(ctx)) {
    return {
      endpoint: IDEOGRAM_TEXT_REMOVAL,
      input: compact({
        image_url: ctx.imageUrls[0],
        prompt: ctx.prompt?.trim() ? ctx.prompt.trim() : undefined,
      }),
    }
  }
  if (spec.promptRequired && !ctx.prompt) {
    throw new Error(`${spec.id} requires a prompt`)
  }
  // Enforce the schema's prompt minLength up front (a short prompt is a paid
  // 422 otherwise) and truncate to maxLength instead of failing the job.
  if (spec.promptMin && ctx.prompt.length < spec.promptMin) {
    throw new Error(`${spec.id} needs a prompt of at least ${spec.promptMin} characters`)
  }
  const prompt = spec.promptMax ? ctx.prompt.slice(0, spec.promptMax) : ctx.prompt
  const input = spec.build({
    ...ctx,
    prompt,
    imageUrls: ctx.imageUrls.slice(0, spec.maxInputImages),
  })
  return { endpoint: spec.resolveEndpoint?.(ctx) ?? spec.endpoint, input }
}
