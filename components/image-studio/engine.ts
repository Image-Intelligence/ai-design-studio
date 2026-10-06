/**
 * Image Studio - the drawing engine (browser only).
 *
 * The document (lib/image-studio StudioDoc) is plain JSON; the pixels behind
 * it live here, in canvases kept per layer (`Runtime`). A pixel canvas is
 * never edited after it is committed: an edit makes a new one, so history
 * can hold the old one by reference (cheap undo, no copies on every step).
 *
 * Coordinates: a layer's LOCAL space is its box, (0,0)-(w,h); `layerMatrix`
 * maps local to canvas space (rotate about the centre, then mirror). A raster
 * layer's PIXEL space is (0,0)-(pw,ph), stretched over the box.
 */
import type { StudioLayer, StudioDoc, Adjust, TextProps, ShapeProps } from '@/lib/image-studio'
import { hasAdjust } from '@/lib/image-studio'

export type Runtime = {
  /** raster pixels (pw x ph) */
  pix?: HTMLCanvasElement
  /** mask pixels (mw x mh), alpha = shown */
  mask?: HTMLCanvasElement
  /** what the layer draws (adjusted + masked), with the key it was made for */
  content?: HTMLCanvasElement
  contentKey?: string
  /** painting right now: skip the (slow) adjustments until the stroke ends */
  live?: boolean
}

// ── canvases ─────────────────────────────────────────────────────────────────

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!
export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

/** A stable number per canvas object - the cache keys use it. */
const ids = new WeakMap<object, number>()
let nextId = 1
export const canvasId = (c: object | undefined) => {
  if (!c) return 0
  let v = ids.get(c)
  if (!v) { v = nextId++; ids.set(c, v) }
  return v
}

/** An image from a URL into a canvas (the media host sends CORS headers, so it never taints). */
export function loadToCanvas(url: string, maxSide = 8192): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const c = newCanvas(img.naturalWidth * k, img.naturalHeight * k)
      const x = ctx2d(c)
      x.imageSmoothingQuality = 'high'
      x.drawImage(img, 0, 0, c.width, c.height)
      resolve(c)
    }
    img.onerror = () => reject(new Error('Could not load the image'))
    img.src = url
  })
}

/** A file from the device into a canvas (HEIC and friends fail with a clear message). */
export async function fileToCanvas(file: File, maxSide = 6144): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) } catch { throw new Error(`${file.name} could not be read - use a JPG, PNG or WebP`) }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = newCanvas(bmp.width * k, bmp.height * k)
  const x = ctx2d(c)
  x.imageSmoothingQuality = 'high'
  x.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

export const toBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode the image'))), type, quality))

/** Downscale so the long side is at most `max` (a copy; the original if already small). */
export function fitWithin(c: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = max / Math.max(c.width, c.height)
  if (k >= 1) return c
  const out = newCanvas(c.width * k, c.height * k)
  const x = ctx2d(out)
  x.imageSmoothingQuality = 'high'
  x.drawImage(c, 0, 0, out.width, out.height)
  return out
}

// ── geometry ─────────────────────────────────────────────────────────────────

export function layerMatrix(L: Pick<StudioLayer, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipX' | 'flipY'>): DOMMatrix {
  return new DOMMatrix()
    .translateSelf(L.x + L.w / 2, L.y + L.h / 2)
    .rotateSelf(L.rotation)
    .scaleSelf(L.flipX ? -1 : 1, L.flipY ? -1 : 1)
    .translateSelf(-L.w / 2, -L.h / 2)
}
/** Canvas point -> local box point. */
export function toLocal(L: StudioLayer, x: number, y: number) {
  const p = layerMatrix(L).inverse().transformPoint(new DOMPoint(x, y))
  return { x: p.x, y: p.y }
}
/** The four corners of a layer's box on the canvas (tl, tr, br, bl). */
export function corners(L: StudioLayer) {
  const m = layerMatrix(L)
  return [[0, 0], [L.w, 0], [L.w, L.h], [0, L.h]].map(([x, y]) => { const p = m.transformPoint(new DOMPoint(x, y)); return { x: p.x, y: p.y } })
}
/** The content's own pixel size (raster pixels, else the box). */
export const contentSize = (L: StudioLayer) => (L.kind === 'raster' ? { w: L.pw ?? L.w, h: L.ph ?? L.h } : { w: Math.max(1, Math.round(L.w)), h: Math.max(1, Math.round(L.h)) })

/** Is this canvas point on the layer (a visible pixel of it, for raster)? */
export function hitLayer(L: StudioLayer, rt: Runtime | undefined, x: number, y: number): boolean {
  if (!L.visible || L.kind === 'group' || L.kind === 'adjust') return false
  const p = toLocal(L, x, y)
  if (p.x < 0 || p.y < 0 || p.x > L.w || p.y > L.h) return false
  const c = rt?.content ?? rt?.pix
  if (!c || L.kind !== 'raster') return true
  const px = Math.floor((p.x / L.w) * c.width), py = Math.floor((p.y / L.h) * c.height)
  try { return ctx2d(c).getImageData(Math.min(c.width - 1, px), Math.min(c.height - 1, py), 1, 1).data[3] > 12 } catch { return true }
}

// ── text and shapes ──────────────────────────────────────────────────────────

export const fontOf = (t: TextProps, scale = 1) => `${t.italic ? 'italic ' : ''}${t.weight} ${t.size * scale}px "${t.font}", sans-serif`

const textLines = (t: TextProps, fallback: string) => (t.caps ? (t.text || fallback).toUpperCase() : t.text || fallback).split('\n')
/** Room around the letters for what is drawn outside them: outline, shadow, glow, the plate. */
const textPad = (t: TextProps) => t.strokeWidth + (t.shadow ? t.shadowBlur : 0) + (t.glow ? t.glow.size : 0) + (t.plate ? t.plate.pad : 0) + t.size * 0.08

/** The box a text needs (the layer's w/h follow the text). */
export function measureText(t: TextProps): { w: number; h: number } {
  const c = newCanvas(4, 4), x = ctx2d(c)
  x.font = fontOf(t)
  try { (x as any).letterSpacing = `${t.letterSpacing}px` } catch {}
  const lines = textLines(t, ' ')
  const w = Math.max(...lines.map(l => x.measureText(l || ' ').width))
  const pad = textPad(t)
  return { w: Math.ceil(w + pad * 2), h: Math.ceil(lines.length * t.size * t.lineHeight + pad * 2) }
}

export function drawText(x: CanvasRenderingContext2D, t: TextProps, w: number, h: number) {
  const m = measureText(t)
  // Text drawn at its own size, scaled to the box (a resized text box scales its text)
  x.save()
  x.scale(w / m.w, h / m.h)
  x.font = fontOf(t)
  try { (x as any).letterSpacing = `${t.letterSpacing}px` } catch {}
  x.textBaseline = 'top'
  x.textAlign = t.align
  const pad = textPad(t)
  const ax = t.align === 'left' ? pad : t.align === 'center' ? m.w / 2 : m.w - pad
  const lines = textLines(t, '')
  const blockW = m.w - pad * 2, blockH = m.h - pad * 2
  // The plate: a (rounded) box behind the whole block
  if (t.plate) {
    const p = t.plate
    x.fillStyle = p.color
    x.beginPath()
    const bx = pad - p.pad, by = pad - p.pad, bw = blockW + p.pad * 2, bh = blockH + p.pad * 2
    if ('roundRect' in x) (x as any).roundRect(bx, by, bw, bh, Math.min(p.radius, bw / 2, bh / 2)); else (x as CanvasRenderingContext2D).rect(bx, by, bw, bh)
    x.fill()
  }
  // The fill: a colour, or a gradient across the block at an angle (90 = top to bottom)
  let fill: string | CanvasGradient = t.color
  if (t.gradient) {
    const a = (t.gradient.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a)
    const cx = m.w / 2, cy = m.h / 2, hl = Math.abs((blockW / 2) * dx) + Math.abs((blockH / 2) * dy) || 1
    const g = x.createLinearGradient(cx - dx * hl, cy - dy * hl, cx + dx * hl, cy + dy * hl)
    g.addColorStop(0, t.gradient.from); g.addColorStop(1, t.gradient.to)
    fill = g
  }
  lines.forEach((line, i) => {
    const y = pad + i * t.size * t.lineHeight + (t.size * (t.lineHeight - 1)) / 2
    // Glow: the letters twice with a coloured blur around them, under everything else
    if (t.glow) {
      x.shadowColor = t.glow.color; x.shadowBlur = t.glow.size; x.shadowOffsetX = 0; x.shadowOffsetY = 0
      x.fillStyle = t.glow.color
      x.fillText(line, ax, y); x.fillText(line, ax, y)
      x.shadowColor = 'transparent'
    }
    if (t.shadow) { x.shadowColor = t.shadowColor; x.shadowBlur = t.shadowBlur; x.shadowOffsetY = t.shadowBlur / 3 }
    if (t.strokeWidth > 0) {
      x.lineJoin = 'round'
      x.lineWidth = t.strokeWidth * 2
      x.strokeStyle = t.strokeColor
      x.strokeText(line, ax, y)
      x.shadowColor = 'transparent'
    }
    x.fillStyle = fill
    x.fillText(line, ax, y)
    x.shadowColor = 'transparent'
  })
  x.restore()
}

export function drawShape(x: CanvasRenderingContext2D, s: ShapeProps, w: number, h: number) {
  const sw = s.stroke ? s.strokeWidth : 0
  x.save()
  x.lineJoin = 'round'
  x.lineCap = 'round'
  if (s.shape === 'line' || s.shape === 'arrow') {
    const lw = Math.max(1, s.strokeWidth)
    const head = s.shape === 'arrow' ? Math.min(w * 0.4, lw * 4) : 0
    x.strokeStyle = s.stroke ?? s.fill ?? '#fff'
    x.lineWidth = lw
    x.beginPath(); x.moveTo(lw / 2, h / 2); x.lineTo(w - head - lw / 2, h / 2); x.stroke()
    if (head) {
      x.fillStyle = s.stroke ?? s.fill ?? '#fff'
      x.beginPath(); x.moveTo(w, h / 2); x.lineTo(w - head, h / 2 - head * 0.6); x.lineTo(w - head, h / 2 + head * 0.6); x.closePath(); x.fill()
    }
    x.restore()
    return
  }
  const i = sw / 2
  x.beginPath()
  if (s.shape === 'ellipse') x.ellipse(w / 2, h / 2, Math.max(0.5, w / 2 - i), Math.max(0.5, h / 2 - i), 0, 0, Math.PI * 2)
  else {
    const r = Math.min(s.radius, (w - sw) / 2, (h - sw) / 2)
    if (r > 0 && 'roundRect' in x) (x as any).roundRect(i, i, w - sw, h - sw, r)
    else x.rect(i, i, w - sw, h - sw)
  }
  if (s.fill) { x.fillStyle = s.fill; x.fill() }
  if (s.stroke && sw > 0) { x.strokeStyle = s.stroke; x.lineWidth = sw; x.stroke() }
  x.restore()
}

// ── adjustments ──────────────────────────────────────────────────────────────

const canvasFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

/** Gaussian-ish blur of a canvas (GPU filter where the browser has it, else three box passes). */
export function blurCanvas(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height)
  if (radius <= 0) { ctx2d(out).drawImage(src, 0, 0); return out }
  const x = ctx2d(out)
  if (canvasFilter) {
    x.filter = `blur(${radius}px)`
    x.drawImage(src, 0, 0)
    x.filter = 'none'
    return out
  }
  x.drawImage(src, 0, 0)
  const img = x.getImageData(0, 0, out.width, out.height)
  boxBlurRGBA(img.data, out.width, out.height, Math.max(1, Math.round(radius / 1.7)))
  x.putImageData(img, 0, 0)
  return out
}

/** Three box blurs (horizontal + vertical), premultiplied so transparent edges don't darken. */
function boxBlurRGBA(d: Uint8ClampedArray, w: number, h: number, r: number) {
  const n = w * h
  const f = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255
    f[i * 4] = d[i * 4] * a; f[i * 4 + 1] = d[i * 4 + 1] * a; f[i * 4 + 2] = d[i * 4 + 2] * a; f[i * 4 + 3] = d[i * 4 + 3]
  }
  const tmp = new Float32Array(n * 4)
  const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
    const len = horiz ? w : h, lines = horiz ? h : w
    const step = horiz ? 4 : w * 4
    const k = 1 / (r * 2 + 1)
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * w * 4 : l * 4
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step + c]
        for (let i = 0; i < len; i++) {
          dst[base + i * step + c] = acc * k
          acc += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c]
        }
      }
    }
  }
  for (let p = 0; p < 3; p++) { pass(f, tmp, true); pass(tmp, f, false) }
  for (let i = 0; i < n; i++) {
    const a = f[i * 4 + 3]
    const m = a > 0 ? 255 / a : 0
    d[i * 4] = f[i * 4] * m; d[i * 4 + 1] = f[i * 4 + 1] * m; d[i * 4 + 2] = f[i * 4 + 2] * m; d[i * 4 + 3] = a
  }
}

/** The colour adjustments, in one pass; sharpen and blur after. Returns a new canvas. */
export function applyAdjust(src: HTMLCanvasElement, a: Partial<Adjust>): HTMLCanvasElement {
  let out = newCanvas(src.width, src.height)
  const x = ctx2d(out)
  x.drawImage(src, 0, 0)
  const colour = ['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'hue', 'temperature', 'tint'].some(k => (a as any)[k])
  if (colour) {
    const img = x.getImageData(0, 0, out.width, out.height)
    const d = img.data
    const exp = Math.pow(2, (a.exposure ?? 0) / 50)
    const bri = (a.brightness ?? 0) * 1.28
    const c = (a.contrast ?? 0) * 1.28
    const cf = (259 * (c + 255)) / (255 * (259 - c))
    const sat = 1 + (a.saturation ?? 0) / 100
    const vib = (a.vibrance ?? 0) / 100
    const temp = (a.temperature ?? 0) * 0.5
    const tint = (a.tint ?? 0) * 0.5
    // Hue rotation about the grey axis (the matrix CSS hue-rotate uses)
    const th = ((a.hue ?? 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th)
    const hm = [
      0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.14, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
    ]
    const doHue = !!a.hue
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      let r = d[i] * exp + bri, g = d[i + 1] * exp + bri, b = d[i + 2] * exp + bri
      if (c) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128 }
      if (temp) { r += temp; b -= temp }
      if (tint) { g -= tint; r += tint * 0.3; b += tint * 0.3 }
      if (doHue) {
        const R = r, G = g, B = b
        r = hm[0] * R + hm[1] * G + hm[2] * B; g = hm[3] * R + hm[4] * G + hm[5] * B; b = hm[6] * R + hm[7] * G + hm[8] * B
      }
      if (sat !== 1 || vib) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        let s = sat
        // Vibrance: lifts dull colours more than vivid ones
        if (vib) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); s *= 1 + vib * (1 - Math.min(1, (mx - mn) / 255)) }
        r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b
    }
    x.putImageData(img, 0, 0)
  }
  if (a.sharpen) {
    // Unsharp mask: push each pixel away from its blurred neighbourhood
    const blurred = blurCanvas(out, Math.max(1, Math.min(out.width, out.height) / 900))
    const img = x.getImageData(0, 0, out.width, out.height), bl = ctx2d(blurred).getImageData(0, 0, out.width, out.height)
    const amt = a.sharpen / 40
    for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = img.data[i + k] + (img.data[i + k] - bl.data[i + k]) * amt
    x.putImageData(img, 0, 0)
  }
  if (a.blur) out = blurCanvas(out, a.blur)
  return out
}

// ── what a layer draws ───────────────────────────────────────────────────────

/** The layer's content canvas (adjusted, masked), cached until anything about it changes. */
export function layerContent(L: StudioLayer, rt: Runtime): HTMLCanvasElement | null {
  // A group draws its children and an adjustment layer changes what is under it - neither has pixels of its own
  if (L.kind === 'group' || L.kind === 'adjust') return null
  const { w, h } = contentSize(L)
  const key = JSON.stringify([L.kind, L.kind === 'raster' ? canvasId(rt.pix) : [L.w, L.h, L.text, L.shape], L.mask?.enabled ? canvasId(rt.mask) : 0, rt.live ? 0 : L.adjust])
  if (rt.content && rt.contentKey === key) return rt.content
  let base: HTMLCanvasElement
  if (L.kind === 'raster') {
    if (!rt.pix) return null
    base = rt.pix
  } else {
    base = newCanvas(w, h)
    const x = ctx2d(base)
    if (L.kind === 'text' && L.text) drawText(x, L.text, w, h)
    if (L.kind === 'shape' && L.shape) drawShape(x, L.shape, w, h)
  }
  let out = !rt.live && hasAdjust(L.adjust) ? applyAdjust(base, L.adjust!) : base
  if (L.mask?.enabled && rt.mask) {
    if (out === rt.pix) out = copyCanvas(out)
    const x = ctx2d(out)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(rt.mask, 0, 0, out.width, out.height)
    x.globalCompositeOperation = 'source-over'
  }
  rt.content = out
  rt.contentKey = key
  return out
}

/**
 * What a layer (and, for a group, its children) looks like - a cache key for
 * an adjustment layer's result: it only needs redoing when something under it
 * changes. Pixels are identified by their canvas (never edited in place).
 */
function layerSig(doc: StudioDoc, L: StudioLayer, rts: Map<string, Runtime>): unknown {
  const rt = rts.get(L.id)
  const own = [L.id, L.kind, L.visible, L.opacity, L.blend, L.x, L.y, L.w, L.h, L.rotation, L.flipX, L.flipY, L.adjust, L.text, L.shape,
    canvasId(rt?.pix), L.mask?.enabled ? canvasId(rt?.mask) : 0, rt?.live ? 'LIVE' : 0]
  return L.kind === 'group' ? [own, doc.layers.filter(c => c.parent === L.id).map(c => layerSig(doc, c, rts))] : own
}

/**
 * Draw `members` (one level of the stack, bottom first) onto x, which already
 * holds what is under them. A group is drawn into its own buffer first, then
 * on with its opacity and blend; an adjustment layer re-colours what x holds
 * so far (where its mask allows, by its opacity).
 */
function drawStack(x: CanvasRenderingContext2D, doc: StudioDoc, rts: Map<string, Runtime>, members: StudioLayer[], under: unknown[]) {
  for (const L of members) {
    const rt = rts.get(L.id)
    if (!L.visible || L.opacity <= 0 || !rt) { under.push(L.id); continue }
    if (L.kind === 'group') {
      // The group's own buffer, kept between frames (cleared, not reallocated)
      let buf = rt.content
      if (!buf || buf.width !== doc.width || buf.height !== doc.height) { buf = newCanvas(doc.width, doc.height); rt.content = buf; rt.contentKey = 'group' }
      const bx = ctx2d(buf)
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over'
      bx.clearRect(0, 0, buf.width, buf.height)
      drawStack(bx, doc, rts, doc.layers.filter(c => c.parent === L.id), [])
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.globalAlpha = L.opacity
      x.globalCompositeOperation = (L.blend === 'normal' ? 'source-over' : L.blend) as GlobalCompositeOperation
      x.drawImage(buf, 0, 0)
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'
      under.push(layerSig(doc, L, rts))
      continue
    }
    if (L.kind === 'adjust') {
      applyAdjustLayer(x, doc, L, rt, under)
      under.push(layerSig(doc, L, rts))
      continue
    }
    const c = layerContent(L, rt)
    under.push(layerSig(doc, L, rts))
    if (!c) continue
    const m = layerMatrix(L)
    x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
    x.globalAlpha = L.opacity
    x.globalCompositeOperation = (L.blend === 'normal' ? 'source-over' : L.blend) as GlobalCompositeOperation
    x.imageSmoothingQuality = 'high'
    x.drawImage(c, 0, 0, L.w, L.h)
  }
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalAlpha = 1
  x.globalCompositeOperation = 'source-over'
}

/**
 * An adjustment layer: what x holds so far, adjusted, mixed back in by the
 * layer's opacity and mask - exactly (premultiplied: the old picture is
 * erased by that amount, the adjusted one added by it), so semi-transparent
 * pixels keep their alpha. The adjusted picture is cached until anything under
 * the layer changes; while a layer under it is being painted it waits (it
 * would redo a full-canvas pass on every brush dab).
 */
function applyAdjustLayer(x: CanvasRenderingContext2D, doc: StudioDoc, L: StudioLayer, rt: Runtime, under: unknown[]) {
  if (!hasAdjust(L.adjust)) return
  const key = JSON.stringify([L.adjust, doc.width, doc.height, doc.background, under])
  if (key.includes('"LIVE"')) return
  let adjusted = rt.content
  if (!adjusted || rt.contentKey !== key) {
    const snap = newCanvas(doc.width, doc.height)
    ctx2d(snap).drawImage(x.canvas, 0, 0)
    adjusted = applyAdjust(snap, L.adjust!)
    rt.content = adjusted
    rt.contentKey = key
  }
  // Where it applies: everywhere, or its mask mapped through its box
  let amount: HTMLCanvasElement | null = null
  if (L.mask?.enabled && rt.mask) {
    amount = newCanvas(doc.width, doc.height)
    const ax = ctx2d(amount), m = layerMatrix(L)
    ax.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
    ax.drawImage(rt.mask, 0, 0, L.w, L.h)
  }
  const add = newCanvas(doc.width, doc.height), dx = ctx2d(add)
  dx.globalAlpha = L.opacity
  dx.drawImage(adjusted, 0, 0)
  if (amount) { dx.globalAlpha = 1; dx.globalCompositeOperation = 'destination-in'; dx.drawImage(amount, 0, 0) }
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalCompositeOperation = 'destination-out'
  x.globalAlpha = L.opacity
  if (amount) x.drawImage(amount, 0, 0); else { x.fillStyle = '#000'; x.fillRect(0, 0, doc.width, doc.height) }
  x.globalAlpha = 1
  x.globalCompositeOperation = 'lighter'
  x.drawImage(add, 0, 0)
  x.globalCompositeOperation = 'source-over'
}

/** Draw the whole document onto `x` (doc size), background included unless asked not to. `only`: one top-level layer or group alone. */
export function compose(x: CanvasRenderingContext2D, doc: StudioDoc, rts: Map<string, Runtime>, opts: { background?: boolean; only?: string } = {}) {
  x.save()
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalAlpha = 1
  x.globalCompositeOperation = 'source-over'
  x.clearRect(0, 0, doc.width, doc.height)
  const under: unknown[] = []
  if (opts.background !== false && doc.background) { x.fillStyle = doc.background; x.fillRect(0, 0, doc.width, doc.height); under.push(doc.background) }
  drawStack(x, doc, rts, doc.layers.filter(l => !l.parent && (!opts.only || l.id === opts.only)), under)
  x.restore()
}

/** The document flattened into a new canvas (for export, AI, the eyedropper). */
export function flatten(doc: StudioDoc, rts: Map<string, Runtime>, background = true): HTMLCanvasElement {
  const c = newCanvas(doc.width, doc.height)
  compose(ctx2d(c), doc, rts, { background })
  return c
}

/** A layer rendered alone in canvas space (doc size) - for "copy to new layer" and its selection maths. */
export function layerInCanvasSpace(doc: StudioDoc, L: StudioLayer, rt: Runtime, rts?: Map<string, Runtime>): HTMLCanvasElement {
  const c = newCanvas(doc.width, doc.height)
  const x = ctx2d(c)
  // A group: its children together, as it shows (needs every layer's pixels)
  if (L.kind === 'group' && rts) { compose(x, { ...doc, background: null }, rts, { only: L.id }); return c }
  const content = layerContent(L, rt)
  if (!content) return c
  const m = layerMatrix(L)
  x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
  x.drawImage(content, 0, 0, L.w, L.h)
  return c
}

/**
 * A canvas-space mask (selection) mapped into a layer's pixel space (pw x ph),
 * so a selection can cut, fill or mask that layer whatever its transform.
 */
export function canvasMaskToLayer(sel: HTMLCanvasElement, L: StudioLayer, pw: number, ph: number): HTMLCanvasElement {
  const out = newCanvas(pw, ph)
  const x = ctx2d(out)
  // pixel -> local (scale) -> canvas (matrix); we need canvas -> pixel
  const toCanvas = layerMatrix(L).multiplySelf(new DOMMatrix().scaleSelf(L.w / pw, L.h / ph))
  const inv = toCanvas.inverse()
  x.setTransform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f)
  x.drawImage(sel, 0, 0)
  return out
}

// ── selections (doc-size canvases, alpha = selected) ─────────────────────────

export function selectionFromPath(w: number, h: number, path: Path2D): HTMLCanvasElement {
  const c = newCanvas(w, h), x = ctx2d(c)
  x.fillStyle = '#fff'
  x.fill(path)
  return c
}
/** A black/white mask image (white = selected) as an alpha selection, scaled to the canvas. */
export function selectionFromMaskImage(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = newCanvas(w, h), x = ctx2d(c)
  x.imageSmoothingQuality = 'high'
  x.drawImage(img, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h)
  for (let i = 0; i < d.data.length; i += 4) {
    const v = d.data[i]
    d.data[i] = 255; d.data[i + 1] = 255; d.data[i + 2] = 255; d.data[i + 3] = v
  }
  x.putImageData(d, 0, 0)
  return c
}
/** Combine a new selection with the current one. */
export function combineSelection(cur: HTMLCanvasElement | null, next: HTMLCanvasElement, mode: 'new' | 'add' | 'subtract' | 'intersect'): HTMLCanvasElement {
  if (!cur || mode === 'new') return next
  const out = copyCanvas(cur), x = ctx2d(out)
  x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in'
  x.drawImage(next, 0, 0)
  return out
}
export function invertSelection(cur: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const out = newCanvas(w, h), x = ctx2d(out)
  x.fillStyle = '#fff'
  x.fillRect(0, 0, w, h)
  if (cur) { x.globalCompositeOperation = 'destination-out'; x.drawImage(cur, 0, 0) }
  return out
}
export const featherSelection = (cur: HTMLCanvasElement, r: number) => blurCanvas(cur, r)
/**
 * Grow a mask outwards by about `r` pixels (a blur, then every touched pixel
 * made solid): an object removal needs its mask to cover the object's soft
 * edge and shadow line, or a ghost outline is left behind.
 */
export function growMask(cur: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r < 1) return cur
  const out = blurCanvas(cur, r)
  const x = ctx2d(out)
  const img = x.getImageData(0, 0, out.width, out.height), p = img.data
  for (let i = 3; i < p.length; i += 4) p[i] = p[i] > 6 ? 255 : p[i] * 40
  x.putImageData(img, 0, 0)
  return out
}
/** Is anything selected at all? */
export function selectionEmpty(c: HTMLCanvasElement): boolean {
  const s = fitWithin(c, 256)
  const d = ctx2d(s).getImageData(0, 0, s.width, s.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false
  return true
}
/** The bounding box of the selected area (canvas px), or null. */
export function selectionBounds(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const k = Math.min(1, 1024 / Math.max(c.width, c.height))
  const s = k < 1 ? fitWithin(c, 1024) : c
  const d = ctx2d(s).getImageData(0, 0, s.width, s.height).data
  let x0 = s.width, y0 = s.height, x1 = -1, y1 = -1
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    if (d[(y * s.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  return { x: Math.floor(x0 / k), y: Math.floor(y0 / k), w: Math.ceil((x1 - x0 + 1) / k), h: Math.ceil((y1 - y0 + 1) / k) }
}
/** The selection's outline as a small image (edge pixels opaque), for drawing the marching edge. */
export function selectionEdges(c: HTMLCanvasElement, max = 1400): HTMLCanvasElement {
  const s = fitWithin(c, max)
  const w = s.width, h = s.height
  const src = ctx2d(s).getImageData(0, 0, w, h).data
  const out = newCanvas(w, h), x = ctx2d(out)
  const img = x.createImageData(w, h)
  const on = (i: number) => src[i * 4 + 3] > 127
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const i = y * w + xx
    if (!on(i)) continue
    if (xx === 0 || y === 0 || xx === w - 1 || y === h - 1 || !on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w)) {
      img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255
    }
  }
  x.putImageData(img, 0, 0)
  return out
}

// ── painting helpers ─────────────────────────────────────────────────────────

/** A soft round brush tip in `color` (hardness 0..1). */
export function brushTip(size: number, hardness: number, color: string): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(size))
  const c = newCanvas(d, d), x = ctx2d(c)
  const r = d / 2
  const g = x.createRadialGradient(r, r, 0, r, r, r)
  g.addColorStop(0, color)
  g.addColorStop(Math.min(0.99, Math.max(0, hardness)), color)
  g.addColorStop(1, hexAlpha(color, 0))
  x.fillStyle = g
  x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.fill()
  return c
}
/** The colour with a different alpha (any #rgb / #rrggbb). */
export function hexAlpha(color: string, a: number): string {
  const { r, g, b } = parseColor(color)
  return `rgba(${r},${g},${b},${a})`
}
export function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const c = newCanvas(1, 1), x = ctx2d(c)
  x.fillStyle = '#000'
  x.fillStyle = color
  x.fillRect(0, 0, 1, 1)
  const d = x.getImageData(0, 0, 1, 1).data
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
}
export const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/**
 * Flood fill: the pixels connected to (sx, sy) whose colour is within
 * `tolerance` (0..255) of it, as a mask canvas (alpha = filled).
 */
export function floodMask(src: HTMLCanvasElement, sx: number, sy: number, tolerance: number): HTMLCanvasElement {
  const w = src.width, h = src.height
  const d = ctx2d(src).getImageData(0, 0, w, h).data
  const out = newCanvas(w, h), ox = ctx2d(out)
  const img = ox.createImageData(w, h)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out
  const i0 = (sy * w + sx) * 4
  const [r0, g0, b0, a0] = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]]
  const tol = tolerance * tolerance * 4
  const seen = new Uint8Array(w * h)
  const stack = [sx, sy]
  const match = (i: number) => { const j = i * 4; const dr = d[j] - r0, dg = d[j + 1] - g0, db = d[j + 2] - b0, da = d[j + 3] - a0; return dr * dr + dg * dg + db * db + da * da <= tol }
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!
    let x = x0
    while (x >= 0 && !seen[y * w + x] && match(y * w + x)) x--
    x++
    let up = false, down = false
    while (x < w && !seen[y * w + x] && match(y * w + x)) {
      const i = y * w + x
      seen[i] = 1
      img.data[i * 4 + 3] = 255
      if (y > 0) { const m = !seen[i - w] && match(i - w); if (m && !up) { stack.push(x, y - 1); up = true } else if (!m) up = false }
      if (y < h - 1) { const m = !seen[i + w] && match(i + w); if (m && !down) { stack.push(x, y + 1); down = true } else if (!m) down = false }
      x++
    }
  }
  ox.putImageData(img, 0, 0)
  return out
}
