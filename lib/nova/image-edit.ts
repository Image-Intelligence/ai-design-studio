/**
 * Nova Studio - pixel-level fixes on a picture (server only, 2026-10-18).
 *
 * The kind of fix a designer makes by hand: crop, reframe to another shape
 * (padding with a blurred, darkened copy of the picture - the mascot ads'
 * band treatment - or a solid colour, or cropping around a focus point),
 * resize, type set on the picture, a logo or cut-out placed on it, colour
 * adjustments, a vignette, and a blurred region (behind text). One sharp
 * pipeline, applied op by op.
 *
 * Every position and size is in PERCENT of the current canvas, so the model
 * can reason about "the top 20%" without knowing the pixel size. Numbers are
 * clamped, unknown ops are skipped (and listed), at most MAX_OPS run.
 *
 * FONTS: text is drawn as an SVG overlay rasterised by sharp's librsvg, which
 * uses the fonts installed on the machine. Vercel's Linux image has very few
 * (DejaVu is the dependable one), so every family lists generic fallbacks -
 * the text always renders, though the exact face can differ from Windows.
 */
import sharp from 'sharp'
import { fetchMedia } from '@/lib/media-fetch'

const MAX_OPS = 12

export type EditOp =
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'reframe'; aspect: string; mode?: 'pad' | 'crop'; fill?: 'blur' | 'color'; color?: string; focusX?: number; focusY?: number }
  | { op: 'resize'; width?: number; height?: number }
  | {
      op: 'text'; text: string; x: number; y: number; size: number
      color?: string; weight?: 'regular' | 'bold' | 'black'; align?: 'left' | 'center' | 'right'; anchor?: 'top' | 'middle' | 'bottom'
      maxWidth?: number; stroke?: string; shadow?: boolean; box?: { color: string; opacity?: number; padding?: number }; font?: 'sans' | 'serif' | 'display'
    }
  | { op: 'overlay'; imageUrl: string; x: number; y: number; width: number; opacity?: number; anchor?: 'center' | 'top-left' }
  | { op: 'adjust'; brightness?: number; saturation?: number; contrast?: number; hue?: number }
  | { op: 'vignette'; strength?: number }
  | { op: 'blurRegion'; x: number; y: number; w: number; h: number; amount?: number }

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const pct = (v: unknown, d = 0) => clamp(v, 0, 100, d)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
/** A CSS colour we are willing to put into SVG: #hex, rgb(a)() or a plain name. */
const colour = (c: unknown, d: string) => {
  const s = typeof c === 'string' ? c.trim() : ''
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(s) ? s : d
}

const FAMILIES: Record<string, string> = {
  sans: "'Inter', 'Segoe UI', 'DejaVu Sans', Arial, Helvetica, sans-serif",
  serif: "'Georgia', 'DejaVu Serif', 'Times New Roman', serif",
  display: "'Montserrat', 'Arial Black', 'Segoe UI Black', 'DejaVu Sans', Impact, sans-serif",
}
const WEIGHTS: Record<string, number> = { regular: 400, bold: 700, black: 900 }

async function load(url: string): Promise<Buffer> {
  const res = await fetchMedia(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Could not load the picture (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** The picture as raw RGBA plus its size - every op takes and returns this. */
type Canvas = { buf: Buffer; w: number; h: number }
const toCanvas = async (img: sharp.Sharp): Promise<Canvas> => {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { buf: data, w: info.width, h: info.height }
}
const fromCanvas = (c: Canvas) => sharp(c.buf, { raw: { width: c.w, height: c.h, channels: 4 } })

const parseAspect = (a: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(String(a ?? '').trim())
  if (!m) return null
  const r = Number(m[1]) / Number(m[2])
  return r > 0.1 && r < 10 ? r : null
}

/** Greedy word wrap by an average glyph width (librsvg has no text measuring we can call). */
function wrap(text: string, fontPx: number, maxPx: number, weight: number): string[] {
  const avg = fontPx * (weight >= 900 ? 0.62 : weight >= 700 ? 0.58 : 0.53)
  const perLine = Math.max(1, Math.floor(maxPx / avg))
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word
      else if ((line + ' ' + word).length <= perLine) line += ' ' + word
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out.slice(0, 12)
}

async function opText(c: Canvas, o: Extract<EditOp, { op: 'text' }>): Promise<Canvas> {
  const text = String(o.text ?? '').slice(0, 400)
  if (!text.trim()) return c
  const fontPx = Math.round(c.h * clamp(o.size, 1, 40, 6) / 100)
  const weight = WEIGHTS[o.weight ?? 'bold'] ?? 700
  const align = o.align === 'left' || o.align === 'right' ? o.align : 'center'
  const maxPx = c.w * pct(o.maxWidth, 90) / 100
  const lines = wrap(text, fontPx, maxPx, weight)
  const lineH = Math.round(fontPx * 1.18)
  const blockH = lineH * lines.length
  const x = c.w * pct(o.x, 50) / 100
  const anchorY = c.h * pct(o.y, 50) / 100
  const top = o.anchor === 'bottom' ? anchorY - blockH : o.anchor === 'top' ? anchorY : anchorY - blockH / 2
  const textAnchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const fill = colour(o.color, '#ffffff')
  const family = FAMILIES[o.font ?? 'sans'] ?? FAMILIES.sans
  const stroke = o.stroke ? colour(o.stroke, '#000000') : null
  const parts: string[] = []
  if (o.shadow) parts.push(`<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${Math.max(1, fontPx * 0.06)}" stdDeviation="${Math.max(1, fontPx * 0.08)}" flood-color="#000" flood-opacity="0.6"/></filter>`)
  if (o.box) {
    const pad = fontPx * clamp(o.box.padding, 0, 3, 0.45)
    const estW = Math.min(c.w, Math.max(...lines.map(l => l.length)) * fontPx * 0.56 + pad * 2)
    const bx = align === 'left' ? x - pad : align === 'right' ? x - estW + pad : x - estW / 2
    parts.push(`<rect x="${bx.toFixed(1)}" y="${(top - pad * 0.6).toFixed(1)}" width="${estW.toFixed(1)}" height="${(blockH + pad * 1.2).toFixed(1)}" rx="${(fontPx * 0.25).toFixed(1)}" fill="${colour(o.box.color, '#000000')}" fill-opacity="${clamp(o.box.opacity, 0, 1, 0.55)}"/>`)
  }
  const tspans = lines.map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(top + lineH * i + fontPx * 0.88).toFixed(1)}">${esc(l)}</tspan>`).join('')
  parts.push(`<text font-family="${esc(family)}" font-size="${fontPx}" font-weight="${weight}" fill="${fill}" text-anchor="${textAnchor}"${stroke ? ` stroke="${stroke}" stroke-width="${Math.max(1, fontPx * 0.06).toFixed(1)}" paint-order="stroke"` : ''}${o.shadow ? ' filter="url(#s)"' : ''}>${tspans}</text>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}">${parts.join('')}</svg>`
  return toCanvas(fromCanvas(c).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]))
}

async function opReframe(c: Canvas, o: Extract<EditOp, { op: 'reframe' }>): Promise<Canvas> {
  const r = parseAspect(o.aspect)
  if (!r) return c
  const cur = c.w / c.h
  if (Math.abs(cur - r) < 0.005) return c
  if (o.mode === 'crop') {
    // The largest box of the new shape that fits, anchored on the focus point
    const cw = cur > r ? Math.round(c.h * r) : c.w
    const ch = cur > r ? c.h : Math.round(c.w / r)
    const fx = pct(o.focusX, 50) / 100, fy = pct(o.focusY, 50) / 100
    const left = Math.round(Math.min(c.w - cw, Math.max(0, fx * c.w - cw / 2)))
    const top = Math.round(Math.min(c.h - ch, Math.max(0, fy * c.h - ch / 2)))
    return toCanvas(fromCanvas(c).extract({ left, top, width: cw, height: ch }))
  }
  // Pad: the whole picture kept, the new canvas filled around it
  const W = cur > r ? c.w : Math.round(c.h * r)
  const H = cur > r ? Math.round(c.w / r) : c.h
  const left = Math.round((W - c.w) / 2), top = Math.round((H - c.h) / 2)
  const fg = await fromCanvas(c).png().toBuffer()
  let bg: Buffer
  if (o.fill === 'color') {
    bg = await sharp({ create: { width: W, height: H, channels: 4, background: colour(o.color, '#000000') } }).png().toBuffer()
  } else {
    // The picture itself, covering the new frame, blurred and darkened. Blurred
    // SMALL and scaled up: a big Gaussian on the full-size 8-bit picture left
    // visible contour banding in the soft gradients
    const sw = Math.max(16, Math.round(W / 12)), sh = Math.max(16, Math.round(H / 12))
    const small = await sharp(fg).resize(sw, sh, { fit: 'cover' }).blur(2.5).modulate({ brightness: 0.55 }).png().toBuffer()
    bg = await sharp(small).resize(W, H, { kernel: 'cubic' }).blur(1.2).png().toBuffer()
  }
  return toCanvas(sharp(bg).composite([{ input: fg, left, top }]))
}

async function opOverlay(c: Canvas, o: Extract<EditOp, { op: 'overlay' }>): Promise<Canvas> {
  const src = await load(String(o.imageUrl ?? ''))
  const w = Math.max(4, Math.round(c.w * clamp(o.width, 1, 100, 25) / 100))
  let ov = await sharp(src).ensureAlpha().resize({ width: w, withoutEnlargement: false }).png().toBuffer()
  const meta = await sharp(ov).metadata()
  const oh = meta.height ?? w
  // Shrink to fit the canvas height too
  if (oh > c.h) ov = await sharp(ov).resize({ height: c.h }).png().toBuffer()
  const m2 = await sharp(ov).metadata()
  const ow = m2.width ?? w, oh2 = m2.height ?? oh
  const opacity = clamp(o.opacity, 0, 1, 1)
  if (opacity < 1) {
    const { data, info } = await sharp(ov).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity)
    ov = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  }
  const px = c.w * pct(o.x, 50) / 100, py = c.h * pct(o.y, 50) / 100
  let left = o.anchor === 'top-left' ? px : px - ow / 2
  let top = o.anchor === 'top-left' ? py : py - oh2 / 2
  left = Math.round(Math.min(c.w - ow, Math.max(0, left)))
  top = Math.round(Math.min(c.h - oh2, Math.max(0, top)))
  return toCanvas(fromCanvas(c).composite([{ input: ov, left, top }]))
}

async function opBlurRegion(c: Canvas, o: Extract<EditOp, { op: 'blurRegion' }>): Promise<Canvas> {
  const left = Math.round(c.w * pct(o.x) / 100), top = Math.round(c.h * pct(o.y) / 100)
  const width = Math.max(1, Math.min(c.w - left, Math.round(c.w * pct(o.w, 100) / 100)))
  const height = Math.max(1, Math.min(c.h - top, Math.round(c.h * pct(o.h, 100) / 100)))
  if (width < 2 || height < 2) return c
  const sigma = clamp(o.amount, 0.3, 100, Math.max(4, Math.round(Math.min(width, height) / 25)))
  const patch = await fromCanvas(c).extract({ left, top, width, height }).blur(sigma).png().toBuffer()
  return toCanvas(fromCanvas(c).composite([{ input: patch, left, top }]))
}

async function opVignette(c: Canvas, strength: number): Promise<Canvas> {
  const s = clamp(strength, 0, 1, 0.5)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="72%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${s.toFixed(2)}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`
  return toCanvas(fromCanvas(c).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]))
}

/** Apply the ops in order to the picture at srcUrl. */
/**
 * `src` is the picture's URL - or { blank } for a transparent canvas of that
 * size (2026-10-19: titles and logos for VIDEO are drawn on a blank layer the
 * size of the frame, then laid over the clip - lib/nova/video-ops overlayLayers).
 */
export async function editImage(src: string | { blank: { width: number; height: number } }, ops: EditOp[], opts: { maxSide?: number } = {}): Promise<{ png: Buffer; width: number; height: number; applied: string[] }> {
  const maxSide = Math.round(clamp(opts.maxSide, 256, 8192, 4096))
  const applied: string[] = []
  let c = typeof src === 'string'
    ? await toCanvas(sharp(await load(src)).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }))
    : await toCanvas(sharp({ create: { width: Math.round(clamp(src.blank.width, 16, 4096, 1280)), height: Math.round(clamp(src.blank.height, 16, 4096, 720)), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png())
  const list = Array.isArray(ops) ? ops : []
  if (list.length > MAX_OPS) applied.push(`skipped: ${list.length - MAX_OPS} ops past the ${MAX_OPS}-op limit`)
  for (const raw of list.slice(0, MAX_OPS)) {
    const o = (raw ?? {}) as EditOp & { op?: string }
    try {
      switch (o.op) {
        case 'crop': {
          const left = Math.round(c.w * pct(o.x) / 100), top = Math.round(c.h * pct(o.y) / 100)
          const width = Math.max(1, Math.min(c.w - left, Math.round(c.w * pct(o.w, 100) / 100)))
          const height = Math.max(1, Math.min(c.h - top, Math.round(c.h * pct(o.h, 100) / 100)))
          if (width < 8 || height < 8) { applied.push('skipped: crop box too small'); break }
          c = await toCanvas(fromCanvas(c).extract({ left, top, width, height }))
          applied.push(`crop to ${width}x${height}`)
          break
        }
        case 'reframe': {
          const before = `${c.w}x${c.h}`
          c = await opReframe(c, o)
          applied.push(parseAspect(o.aspect) ? `reframe ${before} -> ${c.w}x${c.h} (${o.mode === 'crop' ? 'crop' : o.fill === 'color' ? 'padded' : 'blur bands'})` : `skipped: bad aspect "${o.aspect}"`)
          break
        }
        case 'resize': {
          const width = o.width ? Math.round(clamp(o.width, 16, maxSide, c.w)) : undefined
          const height = o.height ? Math.round(clamp(o.height, 16, maxSide, c.h)) : undefined
          if (!width && !height) { applied.push('skipped: resize without a size'); break }
          c = await toCanvas(fromCanvas(c).resize({ width, height, fit: 'inside' }))
          applied.push(`resize to ${c.w}x${c.h}`)
          break
        }
        case 'text':
          c = await opText(c, o)
          applied.push(`text "${String(o.text ?? '').slice(0, 40)}"`)
          break
        case 'overlay':
          c = await opOverlay(c, o)
          applied.push(`overlay at ${pct(o.x, 50)}%,${pct(o.y, 50)}% width ${clamp(o.width, 1, 100, 25)}%`)
          break
        case 'adjust': {
          const brightness = clamp(o.brightness, 0.2, 3, 1), saturation = clamp(o.saturation, 0, 3, 1)
          const hue = Math.round(clamp(o.hue, -180, 180, 0)), contrast = clamp(o.contrast, 0.2, 3, 1)
          let img = fromCanvas(c).modulate({ brightness, saturation, hue })
          if (contrast !== 1) img = img.linear(contrast, 128 * (1 - contrast))
          c = await toCanvas(img)
          applied.push(`adjust brightness ${brightness} saturation ${saturation} contrast ${contrast} hue ${hue}`)
          break
        }
        case 'vignette':
          c = await opVignette(c, o.strength ?? 0.5)
          applied.push('vignette')
          break
        case 'blurRegion':
          c = await opBlurRegion(c, o)
          applied.push(`blur region ${pct(o.x)}%,${pct(o.y)}% ${pct(o.w, 100)}x${pct(o.h, 100)}%`)
          break
        default:
          applied.push(`skipped: unknown op "${String((o as { op?: string }).op ?? '')}"`)
      }
    } catch (e: any) {
      applied.push(`skipped: ${o.op} failed (${String(e?.message || e).slice(0, 80)})`)
    }
  }
  const png = await fromCanvas(c).png().toBuffer()
  return { png, width: c.w, height: c.h, applied }
}
