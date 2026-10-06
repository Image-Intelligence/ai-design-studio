/**
 * Image Studio - the shared shape of a layered canvas (client-safe).
 *
 * A canvas is a size, a background and a stack of layers, bottom first. Every
 * layer sits in a box on the canvas (x, y, w, h in canvas pixels) and is
 * rotated about the box's centre and optionally mirrored. What fills the box:
 *
 *   raster   pixels (an image on R2, `src`, pw x ph) stretched to the box
 *   text     a block of text drawn in the box
 *   shape    a rectangle, ellipse, line or arrow drawn in the box
 *   group    a folder: the layers whose `parent` is its id, composited
 *            together first, then onto the canvas with the group's opacity
 *            and blend. One level only (a group is never inside a group).
 *   adjust   an adjustment LAYER: its `adjust` applies to everything under
 *            it (within its group, if it is in one); its mask, if any, says
 *            where. Its box is the canvas.
 *
 * A group's children sit directly below it in the array (bottom first, the
 * group entry right after its last child) - normalizeLayers keeps it so after
 * every move, which lets the panel draw the stack as a tree by just reading it.
 *
 * Any layer can carry a MASK (which parts of it show - pixels on R2, white =
 * shown) and ADJUSTMENTS (brightness, contrast...), both non-destructive:
 * the layer's own pixels never change for them. Opacity and a blend mode
 * decide how it mixes with what is under it.
 *
 * The document is plain JSON (ImageCanvas.doc); pixels are never inlined.
 */

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color dodge' },
  { id: 'color-burn', label: 'Color burn' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
] as const
export type BlendMode = (typeof BLEND_MODES)[number]['id']
const BLEND_IDS = BLEND_MODES.map(b => b.id) as string[]

/** Non-destructive adjustments; 0 = untouched for every one of them. */
export type Adjust = {
  brightness: number   // -100..100
  contrast: number     // -100..100
  exposure: number     // -100..100 (about +/-2 stops)
  saturation: number   // -100..100
  vibrance: number     // -100..100
  hue: number          // -180..180 degrees
  temperature: number  // -100..100 (blue..amber)
  tint: number         // -100..100 (green..magenta)
  sharpen: number      // 0..100
  blur: number         // 0..50 (pixels at the layer's own resolution)
}
export const ADJUST_FIELDS: { key: keyof Adjust; label: string; min: number; max: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'hue', label: 'Hue', min: -180, max: 180 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 50 },
]
export const hasAdjust = (a: Partial<Adjust> | undefined) => !!a && Object.values(a).some(v => typeof v === 'number' && v !== 0)
/** Starting points for an adjustment (the Adjust panel's chips) - each is just slider values. */
export const ADJUST_PRESETS: { id: string; label: string; adjust: Partial<Adjust> }[] = [
  { id: 'bw', label: 'Black & white', adjust: { saturation: -100, contrast: 12 } },
  { id: 'warm', label: 'Warm', adjust: { temperature: 32, vibrance: 10 } },
  { id: 'cool', label: 'Cool', adjust: { temperature: -30, tint: -6 } },
  { id: 'punch', label: 'Punchy', adjust: { contrast: 24, vibrance: 30, sharpen: 18 } },
  { id: 'fade', label: 'Faded', adjust: { contrast: -28, brightness: 8, saturation: -22 } },
  { id: 'night', label: 'Night', adjust: { exposure: -40, temperature: -38, saturation: -30, contrast: 10 } },
  { id: 'golden', label: 'Golden hour', adjust: { exposure: 8, temperature: 45, tint: 8, saturation: 10 } },
  { id: 'dream', label: 'Dreamy', adjust: { brightness: 10, contrast: -14, blur: 2, saturation: 8 } },
]

export const FONTS = [
  'Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS',
  'Impact', 'Palatino', 'Garamond', 'Futura', 'Brush Script MT', 'Comic Sans MS',
] as const

export type TextProps = {
  text: string
  font: string
  size: number          // canvas px
  weight: number        // 100..900
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number    // multiple of size
  letterSpacing: number // px
  strokeColor: string
  strokeWidth: number   // px, 0 = none
  shadow: boolean
  shadowColor: string
  shadowBlur: number
  /** Effects (Phase 3) - all optional, so older documents read as "none". */
  gradient?: { from: string; to: string; angle: number } | null
  glow?: { color: string; size: number } | null
  /** a plate behind the text: colour, padding and corner radius (px at the text's size) */
  plate?: { color: string; pad: number; radius: number } | null
  caps?: boolean
}
/** One-click looks for a text layer (the panel's style chips). */
export const TEXT_STYLES: { id: string; label: string; patch: Partial<TextProps> }[] = [
  { id: 'clean', label: 'Clean', patch: { strokeWidth: 0, shadow: false, gradient: null, glow: null, plate: null } },
  { id: 'poster', label: 'Poster', patch: { weight: 900, caps: true, letterSpacing: 4, strokeWidth: 0, shadow: true, shadowColor: 'rgba(0,0,0,0.55)', shadowBlur: 18, gradient: null, glow: null, plate: null } },
  { id: 'outline', label: 'Outline', patch: { weight: 800, strokeWidth: 6, strokeColor: '#000000', shadow: false, glow: null, plate: null } },
  { id: 'neon', label: 'Neon', patch: { weight: 700, color: '#f8fafc', glow: { color: '#38bdf8', size: 28 }, strokeWidth: 0, shadow: false, gradient: null, plate: null } },
  { id: 'chrome', label: 'Silver', patch: { weight: 900, gradient: { from: '#f8fafc', to: '#64748b', angle: 90 }, strokeWidth: 2, strokeColor: '#0f172a', shadow: true, shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 10, glow: null, plate: null } },
  { id: 'caption', label: 'Caption', patch: { weight: 600, color: '#ffffff', plate: { color: 'rgba(0,0,0,0.72)', pad: 18, radius: 12 }, strokeWidth: 0, shadow: false, glow: null, gradient: null } },
  { id: 'sunset', label: 'Sunset', patch: { weight: 900, gradient: { from: '#fde68a', to: '#f43f5e', angle: 90 }, strokeWidth: 0, shadow: true, shadowColor: 'rgba(0,0,0,0.5)', shadowBlur: 14, glow: null, plate: null } },
]
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'
export type ShapeProps = {
  shape: ShapeKind
  fill: string | null   // null = no fill
  stroke: string | null // null = no outline
  strokeWidth: number
  radius: number        // rect corner radius, px
}

export type LayerKind = 'raster' | 'text' | 'shape' | 'group' | 'adjust'
export type StudioLayer = {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  opacity: number       // 0..1
  blend: BlendMode
  /** The box on the canvas, before rotation (canvas px). */
  x: number; y: number; w: number; h: number
  rotation: number      // degrees, clockwise, about the box centre
  flipX: boolean; flipY: boolean
  /** raster: the pixels (R2) and their size */
  src?: string | null
  pw?: number; ph?: number
  /** Which parts show: pixels on R2 (alpha / white = shown), in the layer's own pixel space. */
  mask?: { src: string | null; enabled: boolean; mw: number; mh: number } | null
  adjust?: Partial<Adjust>
  text?: TextProps
  shape?: ShapeProps
  /** the group this layer is in (a group's id), if any */
  parent?: string | null
  /** group: its children folded away in the panel */
  collapsed?: boolean
}
export type StudioDoc = {
  v: 1
  width: number
  height: number
  /** null = transparent */
  background: string | null
  layers: StudioLayer[]
}

export const MAX_CANVAS_SIDE = 6144
export const MIN_CANVAS_SIDE = 16
export const MAX_LAYERS = 60
export const CANVAS_PRESETS = [
  { label: 'Square', w: 2048, h: 2048 },
  { label: 'Portrait 4:5', w: 1080, h: 1350 },
  { label: 'Story 9:16', w: 1080, h: 1920 },
  { label: 'Landscape 16:9', w: 1920, h: 1080 },
  { label: 'Photo 3:2', w: 3000, h: 2000 },
  { label: '4K 16:9', w: 3840, h: 2160 },
] as const

/*
 * The AI tools and their ticket price. The site's rule: tickets = fal's cost
 * divided by $0.04 (a subscription ticket is $0.08, so that is a 50% margin),
 * rounded up - so even a fraction-of-a-cent model is one ticket.
 *   select   SAM 3.1 image (fal-ai/sam-3-1/image)      $0.01 per run    -> 1
 *            clicks alone: SAM 2 (fal-ai/sam2/image)   ~$0.001 per run  -> 1
 *   subject  BiRefNet v2 (fal-ai/birefnet/v2), mask    ~$0.002 per run  -> 1
 */
export const STUDIO_AI_TICKETS = { select: 1, subject: 1 } as const
export type StudioAiOp = keyof typeof STUDIO_AI_TICKETS

// ── cleaning what arrives ────────────────────────────────────────────────────

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const colour = (v: unknown, def: string) => (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v.trim()) ? v.trim() : def)
const url = (v: unknown) => { const s = str(v, 2000); return /^https:\/\//.test(s) ? s : null }

export const DEFAULT_TEXT: TextProps = {
  text: 'Your text', font: 'Inter', size: 96, weight: 700, italic: false, color: '#ffffff', align: 'left',
  lineHeight: 1.2, letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0, shadow: false, shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 12,
}
export const DEFAULT_SHAPE: ShapeProps = { shape: 'rect', fill: '#ffffff', stroke: null, strokeWidth: 8, radius: 0 }

function sanitizeAdjust(a: any): Partial<Adjust> | undefined {
  if (!a || typeof a !== 'object') return undefined
  const out: Partial<Adjust> = {}
  for (const f of ADJUST_FIELDS) {
    const v = num(a[f.key], 0, f.min, f.max)
    if (v !== 0) out[f.key] = v
  }
  return Object.keys(out).length ? out : undefined
}

export function sanitizeLayer(r: any): StudioLayer | null {
  if (!r || typeof r !== 'object') return null
  const kind: LayerKind = r.kind === 'text' || r.kind === 'shape' || r.kind === 'group' || r.kind === 'adjust' ? r.kind : 'raster'
  const L: StudioLayer = {
    id: str(r.id, 64) || `l${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    name: str(r.name, 80) || 'Layer',
    kind,
    visible: r.visible !== false,
    locked: r.locked === true,
    opacity: num(r.opacity, 1, 0, 1),
    blend: (BLEND_IDS.includes(r.blend) ? r.blend : 'normal') as BlendMode,
    x: num(r.x, 0, -MAX_CANVAS_SIDE * 4, MAX_CANVAS_SIDE * 4),
    y: num(r.y, 0, -MAX_CANVAS_SIDE * 4, MAX_CANVAS_SIDE * 4),
    w: num(r.w, 100, 1, MAX_CANVAS_SIDE * 8),
    h: num(r.h, 100, 1, MAX_CANVAS_SIDE * 8),
    rotation: num(r.rotation, 0, -3600, 3600),
    flipX: r.flipX === true,
    flipY: r.flipY === true,
  }
  const parent = str(r.parent, 64)
  if (parent && kind !== 'group') L.parent = parent
  if (kind === 'group' && r.collapsed === true) L.collapsed = true
  if (kind === 'raster') {
    L.src = url(r.src)
    L.pw = Math.round(num(r.pw, L.w, 1, MAX_CANVAS_SIDE * 2))
    L.ph = Math.round(num(r.ph, L.h, 1, MAX_CANVAS_SIDE * 2))
  }
  if (r.mask && typeof r.mask === 'object') {
    L.mask = { src: url(r.mask.src), enabled: r.mask.enabled !== false, mw: Math.round(num(r.mask.mw, 1, 1, MAX_CANVAS_SIDE * 2)), mh: Math.round(num(r.mask.mh, 1, 1, MAX_CANVAS_SIDE * 2)) }
  }
  const adj = sanitizeAdjust(r.adjust)
  if (adj) L.adjust = adj
  if (kind === 'text') {
    const t = r.text ?? {}
    L.text = {
      text: str(t.text, 4000), font: str(t.font, 60) || DEFAULT_TEXT.font, size: num(t.size, DEFAULT_TEXT.size, 4, 2000),
      weight: Math.round(num(t.weight, 700, 100, 900) / 100) * 100, italic: t.italic === true, color: colour(t.color, '#ffffff'),
      align: t.align === 'center' || t.align === 'right' ? t.align : 'left',
      lineHeight: num(t.lineHeight, 1.2, 0.5, 4), letterSpacing: num(t.letterSpacing, 0, -50, 200),
      strokeColor: colour(t.strokeColor, '#000000'), strokeWidth: num(t.strokeWidth, 0, 0, 200),
      shadow: t.shadow === true, shadowColor: colour(t.shadowColor, 'rgba(0,0,0,0.6)'), shadowBlur: num(t.shadowBlur, 12, 0, 200),
    }
    if (t.gradient && typeof t.gradient === 'object') L.text.gradient = { from: colour(t.gradient.from, '#ffffff'), to: colour(t.gradient.to, '#64748b'), angle: num(t.gradient.angle, 90, -360, 360) }
    if (t.glow && typeof t.glow === 'object') L.text.glow = { color: colour(t.glow.color, '#38bdf8'), size: num(t.glow.size, 24, 1, 200) }
    if (t.plate && typeof t.plate === 'object') L.text.plate = { color: colour(t.plate.color, 'rgba(0,0,0,0.7)'), pad: num(t.plate.pad, 16, 0, 400), radius: num(t.plate.radius, 10, 0, 400) }
    if (t.caps === true) L.text.caps = true
  }
  if (kind === 'shape') {
    const s = r.shape ?? {}
    L.shape = {
      shape: ['rect', 'ellipse', 'line', 'arrow'].includes(s.shape) ? s.shape : 'rect',
      fill: s.fill === null ? null : colour(s.fill, '#ffffff'),
      stroke: s.stroke === null || s.stroke === undefined ? null : colour(s.stroke, '#000000'),
      strokeWidth: num(s.strokeWidth, 8, 0, 500), radius: num(s.radius, 0, 0, 5000),
    }
  }
  return L
}

export function sanitizeDoc(raw: any, fallback?: { width: number; height: number }): StudioDoc {
  const d = raw && typeof raw === 'object' ? raw : {}
  return {
    v: 1,
    width: Math.round(num(d.width, fallback?.width ?? 2048, MIN_CANVAS_SIDE, MAX_CANVAS_SIDE)),
    height: Math.round(num(d.height, fallback?.height ?? 2048, MIN_CANVAS_SIDE, MAX_CANVAS_SIDE)),
    background: d.background === null ? null : colour(d.background, '#ffffff'),
    layers: normalizeLayers((Array.isArray(d.layers) ? d.layers : []).slice(0, MAX_LAYERS).map(sanitizeLayer).filter(Boolean) as StudioLayer[]),
  }
}

/**
 * The stack in its canonical order: every group's children directly below it
 * (in their own order), the group entry right after its last child. A
 * `parent` that is not a group in this stack is dropped (the layer goes to the
 * top level), and a group is never inside another. Moves only need to put a
 * layer roughly in place and set its parent - this tidies the rest.
 */
export function normalizeLayers(layers: StudioLayer[]): StudioLayer[] {
  const groups = new Set(layers.filter(l => l.kind === 'group').map(l => l.id))
  const clean = layers.map(l => (l.kind === 'group' ? (l.parent ? { ...l, parent: null } : l) : l.parent && !groups.has(l.parent) ? { ...l, parent: null } : l))
  const out: StudioLayer[] = []
  for (const l of clean) {
    if (l.parent) continue
    if (l.kind === 'group') out.push(...clean.filter(c => c.parent === l.id))
    out.push(l)
  }
  return out
}
/** A layer and, for a group, everything in it. */
export const withChildren = (layers: StudioLayer[], id: string) => layers.filter(l => l.id === id || l.parent === id)
/** Hidden or locked through its group too. */
export function effective(layers: StudioLayer[], L: StudioLayer): { visible: boolean; locked: boolean } {
  const g = L.parent ? layers.find(p => p.id === L.parent) : undefined
  return { visible: L.visible && (g ? g.visible : true), locked: L.locked || (g ? g.locked : false) }
}

/** Every R2 URL a document points at (for the response signer and housekeeping). */
export const docUrls = (doc: StudioDoc) => doc.layers.flatMap(l => [l.src, l.mask?.src].filter((u): u is string => !!u))
