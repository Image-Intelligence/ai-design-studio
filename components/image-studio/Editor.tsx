"use client"

/**
 * Image Studio - the editor.
 *
 * The document (layers, their boxes, blend, masks, adjustments) is React
 * state; the pixels are canvases in `rts` (engine Runtime per layer). Pixel
 * canvases are copy-on-write: an edit makes a new canvas, so a history step
 * is just the document plus references to the canvases it used.
 *
 * Rendering: the composite is drawn at the document's own size into one
 * canvas, which is shown scaled (zoom) and moved (pan) with CSS; an overlay
 * canvas in screen pixels carries the UI (selection, handles, crop, cursor).
 *
 * Saving: changes autosave after a pause - new pixels are PUT straight to R2
 * (presigned, ../upload), then the document is PATCHed.
 *
 * INLINE (the Edit Image popup, ./EditImagePopup): the document is handed in
 * rather than loaded, nothing autosaves, and the top bar's Export becomes
 * Apply (+ downloads). Without `canUseLayers` (Dev Tier) the layer management
 * - adding layers, groups, adjustment layers, masks, blend modes - is hidden;
 * what tools make on their own layers (text, shapes, AI results) is flattened
 * into the picture on Apply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MousePointer2, SquareDashed, Lasso, Wand2, Crop, Brush, Eraser, Droplet, PaintBucket, Blend, Type, Shapes, Pipette, Hand,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, ArrowLeft, Download, Check, Loader2, X, Ticket, Circle, ArrowLeftRight, PanelRight,
  Layers as LayersIcon, SlidersHorizontal, Frame, Sparkles, Eraser as EraserIcon, ScissorsLineDashed, Save,
} from "lucide-react"
import {
  type StudioDoc, type StudioLayer, type TextProps, type ShapeProps, type ShapeKind,
  DEFAULT_TEXT, DEFAULT_SHAPE, MAX_LAYERS, MAX_CANVAS_SIDE, STUDIO_AI_TICKETS, normalizeLayers, effective,
} from "@/lib/image-studio"
import {
  type Runtime, newCanvas, ctx2d, copyCanvas, canvasId, loadToCanvas, fileToCanvas, toBlob, fitWithin, layerMatrix, toLocal, corners,
  contentSize, hitLayer, measureText, drawText, drawShape, layerContent, compose, flatten, layerInCanvasSpace, canvasMaskToLayer,
  selectionFromPath, selectionFromMaskImage, combineSelection, invertSelection, featherSelection, selectionEmpty, selectionBounds,
  selectionEdges, brushTip, blurCanvas, applyAdjust, floodMask, parseColor, toHex, growMask,
} from "./engine"
import { LayersPanel, AdjustPanel, TextPanel, ShapePanel, CanvasPanel, Slider, ColorField } from "./panels"
import { AiPanel, type GenRequest } from "./ai-panel"
import { AiButton } from "./ai-button"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import {
  fillRegion, fillTickets, editAspect, EXPAND_MAX_SIDE, EXPAND_MAX_PIXELS, EXPAND_TICKETS, UPSCALE_MAX_SIDE,
} from "@/lib/image-studio-ai"

type Tool = "move" | "marquee" | "lasso" | "ai" | "crop" | "brush" | "eraser" | "blur" | "fill" | "gradient" | "text" | "shape" | "eyedropper" | "hand"
type SelMode = "new" | "add" | "subtract" | "intersect"
type Rect = { x: number; y: number; w: number; h: number }
type HistoryEntry = { label: string; doc: StudioDoc; pix: Map<string, { pix?: HTMLCanvasElement; mask?: HTMLCanvasElement }> }

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: "move", label: "Move / transform", key: "V", icon: MousePointer2 },
  { id: "marquee", label: "Marquee select", key: "M", icon: SquareDashed },
  { id: "lasso", label: "Lasso select", key: "L", icon: Lasso },
  { id: "ai", label: "AI select", key: "W", icon: Wand2 },
  { id: "crop", label: "Crop", key: "C", icon: Crop },
  { id: "brush", label: "Brush", key: "B", icon: Brush },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
  { id: "blur", label: "Blur / sharpen brush", key: "R", icon: Droplet },
  { id: "fill", label: "Fill", key: "G", icon: PaintBucket },
  { id: "gradient", label: "Gradient", key: "Shift+G", icon: Blend },
  { id: "text", label: "Text", key: "T", icon: Type },
  { id: "shape", label: "Shape", key: "U", icon: Shapes },
  { id: "eyedropper", label: "Eyedropper", key: "I", icon: Pipette },
  { id: "hand", label: "Hand (or hold Space)", key: "H", icon: Hand },
]
const CROP_ASPECTS = [["free", "Free"], ["original", "Original"], ["1:1", "1:1"], ["4:5", "4:5"], ["3:4", "3:4"], ["2:3", "2:3"], ["16:9", "16:9"], ["9:16", "9:16"]] as const
const HISTORY_MAX = 60
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)

export type EditorProps = {
  /** the studio canvas (absent inline) */
  canvasId?: number
  /** Inside the Edit Image popup: the document to edit (no server canvas, no autosave) */
  inline?: { doc: StudioDoc; title: string }
  /** Layer management (Dev Tier in the popup); the studio always has it */
  canUseLayers?: boolean
  /** Inline Apply: the picture as it shows, and a way to get the layered document (uploads its pixels) */
  onApply?: (flat: HTMLCanvasElement, serialize: () => Promise<StudioDoc>) => Promise<void>
  /** Inline: more buttons on the top bar (e.g. Open in Image Studio) */
  extraActions?: React.ReactNode
  /** An admin account (the site's admin-only image models are offered); the studio is admin-only */
  admin?: boolean
  /** pixels for layers that have no src yet (a fresh upload), by layer id */
  seed?: Map<string, HTMLCanvasElement>
  refLibrary: { id: string; url: string }[]
  onExit: () => void
  onSaveToRefs: (file: File) => Promise<void>
  /** Update the Refs image this canvas was opened from */
  onReplaceRef?: (refId: string, dataUrl: string) => Promise<unknown>
  onBalanceChange?: (n: number) => void
}

export function Editor({ canvasId, inline, canUseLayers = true, onApply, extraActions, admin = true, seed, refLibrary, onExit, onSaveToRefs, onReplaceRef, onBalanceChange }: EditorProps) {
  // The generative tools' route: the canvas, or "edit" for the popup (lib: [id]/ai)
  const id: number | "edit" = inline ? "edit" : canvasId ?? 0
  // ── document, pixels, selection ──
  const [doc, setDocState] = useState<StudioDoc | null>(null)
  const docRef = useRef<StudioDoc | null>(null)
  const rts = useRef(new Map<string, Runtime>())
  const [title, setTitle] = useState("Untitled canvas")
  const [sourceRefId, setSourceRefId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [maskEdit, setMaskEdit] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pixVersion, setPixVersion] = useState(0)
  const sel = useRef<{ canvas: HTMLCanvasElement | null; path: Path2D | null; edges: HTMLCanvasElement | null; tint: HTMLCanvasElement | null }>({ canvas: null, path: null, edges: null, tint: null })
  const [selVersion, setSelVersion] = useState(0)
  const hasSel = !!sel.current.canvas

  // ── tools ──
  const [tool, setToolState] = useState<Tool>("move")
  const [fg, setFg] = useState("#ffffff")
  const [bg, setBg] = useState("#000000")
  const [size, setSize] = useState(40)
  const [hardness, setHardness] = useState(0.8)
  const [opacity, setOpacity] = useState(1)
  const [marquee, setMarquee] = useState<"rect" | "ellipse">("rect")
  const [selMode, setSelMode] = useState<SelMode>("new")
  const [feather, setFeather] = useState(8)
  const [tolerance, setTolerance] = useState(32)
  const [gradKind, setGradKind] = useState<"linear" | "radial">("linear")
  const [gradTo, setGradTo] = useState<"bg" | "transparent">("bg")
  const [blurMode, setBlurMode] = useState<"blur" | "sharpen">("blur")
  const [strength, setStrength] = useState(10)
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect")
  const [cropAspect, setCropAspect] = useState<string>("free")
  const [crop, setCrop] = useState<Rect | null>(null)
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiPoints, setAiPoints] = useState<{ x: number; y: number; label: 0 | 1 }[]>([])
  const [aiBox, setAiBox] = useState<Rect | null>(null)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [textFocus, setTextFocus] = useState(0)
  const [panel, setPanel] = useState<"layers" | "adjust" | "canvas" | "ai">("layers")
  const [fillFocus, setFillFocus] = useState(0)
  /** Layers picked with Ctrl / Shift in the panel (to group them), besides the selected one */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [expandPrompt, setExpandPrompt] = useState("")
  const [panelOpen, setPanelOpen] = useState(true)
  const [refPicker, setRefPicker] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── view ──
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  const [spaceDown, setSpaceDown] = useState(false)
  const cursor = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<any>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; cx: number; cy: number; s: number; tx: number; ty: number } | null>(null)

  const flash = (text: string, bad = false) => { setNotice({ text, bad }); setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 4200) }
  const L = doc?.layers.find(l => l.id === selectedId) ?? null

  // ── rendering ──
  const raf = useRef(0)
  const render = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const d = docRef.current, c = stageRef.current
      if (d && c) {
        if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height }
        compose(ctx2d(c), d, rts.current)
      }
      drawOverlay()
    })
  // drawOverlay reads refs only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setDoc = useCallback((d: StudioDoc) => { docRef.current = d; setDocState(d); render() }, [render])

  // ── history ──
  const history = useRef<HistoryEntry[]>([])
  const histIdx = useRef(-1)
  const [histTick, setHistTick] = useState(0)
  const snapshot = (label: string): HistoryEntry => {
    const d = docRef.current!
    const pix = new Map<string, { pix?: HTMLCanvasElement; mask?: HTMLCanvasElement }>()
    for (const l of d.layers) { const r = rts.current.get(l.id); if (r) pix.set(l.id, { pix: r.pix, mask: r.mask }) }
    return { label, doc: clone(d), pix }
  }
  const budget = typeof navigator !== "undefined" && (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4 ? 220e6 : 900e6
  const pushHistory = useCallback((label: string) => {
    if (!docRef.current) return
    history.current = history.current.slice(0, histIdx.current + 1)
    history.current.push(snapshot(label))
    // Keep it within a step count and a memory budget (each distinct pixel canvas counted once)
    const bytes = () => {
      const seen = new Set<HTMLCanvasElement>(); let n = 0
      for (const e of history.current) for (const v of e.pix.values()) for (const c of [v.pix, v.mask]) if (c && !seen.has(c)) { seen.add(c); n += c.width * c.height * 4 }
      return n
    }
    while (history.current.length > 2 && (history.current.length > HISTORY_MAX || bytes() > budget)) history.current.shift()
    histIdx.current = history.current.length - 1
    setHistTick(t => t + 1)
    setPixVersion(v => v + 1)
    markDirty()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const restore = (e: HistoryEntry) => {
    for (const [lid, v] of e.pix) {
      const r = rts.current.get(lid) ?? {}
      r.pix = v.pix; r.mask = v.mask; r.content = undefined
      rts.current.set(lid, r)
    }
    const d = clone(e.doc)
    setDoc(d)
    if (selectedId && !d.layers.some(l => l.id === selectedId)) setSelectedId(d.layers.at(-1)?.id ?? null)
    setPixVersion(v => v + 1)
    markDirty()
  }
  const undo = () => { if (histIdx.current > 0) { histIdx.current--; restore(history.current[histIdx.current]); setHistTick(t => t + 1) } }
  const redo = () => { if (histIdx.current < history.current.length - 1) { histIdx.current++; restore(history.current[histIdx.current]); setHistTick(t => t + 1) } }
  const canUndo = histIdx.current > 0, canRedo = histIdx.current < history.current.length - 1
  void histTick

  /** Change the document and make it one undo step. */
  const apply = useCallback((label: string, fn: (d: StudioDoc) => StudioDoc) => {
    if (!docRef.current) return
    setDoc(fn(clone(docRef.current)))
    pushHistory(label)
  }, [setDoc, pushHistory])
  /** Live change (a slider moving): no undo step until onCommit. */
  const patchLayer = useCallback((lid: string, patch: Partial<StudioLayer>) => {
    const d = docRef.current
    if (!d) return
    setDoc({ ...d, layers: d.layers.map(l => (l.id === lid ? { ...l, ...patch } : l)) })
  }, [setDoc])

  // ── load ──
  useEffect(() => {
    let dead = false
    ;(async () => {
      let d: StudioDoc
      if (inline) {
        d = clone(inline.doc)
        setTitle(inline.title)
      } else {
        const r = await fetch(`/api/employees/image-studio/${id}`).catch(() => null)
        const j = r?.ok ? await r.json().catch(() => null) : null
        if (!j?.canvas) { setLoadError("This canvas could not be opened"); return }
        d = j.canvas.doc
        setTitle(j.canvas.title)
        setSourceRefId(j.canvas.sourceRefId ?? null)
      }
      // Every layer's pixels and mask, loaded in parallel
      await Promise.all(d.layers.map(async l => {
        const rt: Runtime = {}
        try {
          if (l.kind === "raster") {
            if (l.src) { rt.pix = await loadToCanvas(l.src, MAX_CANVAS_SIDE * 2); if (!inline || l.src.includes("/u/")) uploaded.current.set(rt.pix, l.src) }
            else if (seed?.get(l.id)) rt.pix = seed.get(l.id)
            else rt.pix = newCanvas(l.pw ?? l.w, l.ph ?? l.h)
          }
          if (l.mask) {
            if (l.mask.src) { rt.mask = await loadToCanvas(l.mask.src, MAX_CANVAS_SIDE * 2); if (!inline || l.mask.src.includes("/u/")) uploaded.current.set(rt.mask, l.mask.src) }
            else { rt.mask = newCanvas(l.mask.mw, l.mask.mh); const x = ctx2d(rt.mask); x.fillStyle = "#fff"; x.fillRect(0, 0, l.mask.mw, l.mask.mh) }
          }
        } catch { rt.pix = rt.pix ?? newCanvas(l.pw ?? l.w, l.ph ?? l.h) }
        rts.current.set(l.id, rt)
      }))
      if (dead) return
      setDoc(d)
      setSelectedId(d.layers.at(-1)?.id ?? null)
      history.current = [snapshot("Open")]
      histIdx.current = 0
      setHistTick(t => t + 1)
      setPixVersion(v => v + 1)
      requestAnimationFrame(() => fitView())
      // A fresh upload has pixels nobody has saved yet
      if (seed?.size && !inline) markDirty()
    })()
    return () => { dead = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── saving ──
  const uploaded = useRef(new WeakMap<HTMLCanvasElement, string>())
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved")
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  const lastThumb = useRef(0)
  const titleRef = useRef(title)
  useEffect(() => { titleRef.current = title }, [title])
  const markDirty = () => {
    setSaveState("dirty")
    if (inline) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void save() }, 2500)
  }
  const putBlob = async (kind: string, blob: Blob): Promise<string> => {
    const r = await fetch("/api/employees/image-studio/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, type: blob.type }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.uploadUrl) throw new Error(j.error || "Upload failed")
    const put = await fetch(j.uploadUrl, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)
    return j.url as string
  }
  const urlFor = async (c: HTMLCanvasElement, kind: string) => {
    const have = uploaded.current.get(c)
    if (have) return have
    const u = await putBlob(kind, await toBlob(c, "image/png"))
    uploaded.current.set(c, u)
    return u
  }
  /** The document with every layer's pixels on R2 (already-uploaded canvases are not sent again). */
  const serialize = async (): Promise<StudioDoc> => {
    const d = docRef.current!
    const layers = await Promise.all(d.layers.map(async l => {
      const rt = rts.current.get(l.id)
      const out: StudioLayer = { ...l }
      if (l.kind === "raster" && rt?.pix) { out.src = await urlFor(rt.pix, "layer"); out.pw = rt.pix.width; out.ph = rt.pix.height }
      if (l.mask && rt?.mask) out.mask = { ...l.mask, src: await urlFor(rt.mask, "mask"), mw: rt.mask.width, mh: rt.mask.height }
      return out
    }))
    return { ...d, layers }
  }
  const save = async (): Promise<void> => {
    if (inline) return
    if (saving.current) { await saving.current; return save() }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const d = docRef.current
    if (!d) return
    setSaveState("saving")
    const run = (async () => {
      try {
        const layers = await Promise.all(d.layers.map(async l => {
          const rt = rts.current.get(l.id)
          const out: StudioLayer = { ...l }
          if (l.kind === "raster" && rt?.pix) { out.src = await urlFor(rt.pix, "layer"); out.pw = rt.pix.width; out.ph = rt.pix.height }
          if (l.mask && rt?.mask) out.mask = { ...l.mask, src: await urlFor(rt.mask, "mask"), mw: rt.mask.width, mh: rt.mask.height }
          return out
        }))
        let thumbUrl: string | undefined
        if (Date.now() - lastThumb.current > 20_000) {
          const flat = fitWithin(flatten(d, rts.current, true), 480)
          thumbUrl = await putBlob("thumb", await toBlob(flat, "image/jpeg", 0.82))
          lastThumb.current = Date.now()
        }
        const r = await fetch(`/api/employees/image-studio/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titleRef.current, doc: { ...d, layers }, ...(thumbUrl ? { thumbUrl } : {}) }),
        })
        setSaveState(r.ok ? (saveTimer.current ? "dirty" : "saved") : "error")
      } catch {
        setSaveState("error")
      }
    })()
    saving.current = run
    await run
    saving.current = null
  }
  // Leaving saves what is pending
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); void save() } }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── view ──
  const fitView = () => {
    const vp = viewportRef.current, d = docRef.current
    if (!vp || !d) return
    const r = vp.getBoundingClientRect()
    const s = Math.min((r.width - 48) / d.width, (r.height - 48) / d.height, 4)
    setView({ s, tx: (r.width - d.width * s) / 2, ty: (r.height - d.height * s) / 2 })
  }
  /** The view follows the viewport (fit) until the user zooms or pans */
  const autoFit = useRef(true)
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    autoFit.current = false
    const vp = viewportRef.current
    if (!vp) return
    const r = vp.getBoundingClientRect()
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2
    setView(v => {
      const s = Math.min(32, Math.max(0.02, v.s * factor))
      const k = s / v.s
      return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }
    })
  }
  const actualSize = () => {
    autoFit.current = false
    const vp = viewportRef.current, d = docRef.current
    if (!vp || !d) return
    const r = vp.getBoundingClientRect()
    setView({ s: 1, tx: (r.width - d.width) / 2, ty: (r.height - d.height) / 2 })
  }
  useEffect(() => { render() }, [view, selVersion, crop, aiPoints, aiBox, selectedId, tool, maskEdit, render])
  // The viewport resizes (panel toggled, window): redraw the overlay at its new size
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    // ...and until the user zooms or pans, keeps the picture fitted: a viewport
    // still settling (a popup opening, a panel sliding in) used to leave it at
    // 100%, off to one side
    const ro = new ResizeObserver(() => { if (autoFit.current) fitView(); render() })
    ro.observe(vp)
    return () => ro.disconnect()
  // the viewport only exists once the document has loaded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, doc !== null])
  // Wheel = zoom at the cursor (a non-passive listener, so the page never scrolls)
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = vp.getBoundingClientRect()
      if (e.shiftKey && !e.ctrlKey) { setView(v => ({ ...v, tx: v.tx - (e.deltaY || e.deltaX) })); return }
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top)
    }
    vp.addEventListener("wheel", onWheel, { passive: false })
    return () => vp.removeEventListener("wheel", onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc !== null])

  /** Screen (client) point -> document point. */
  const toDoc = (cx: number, cy: number) => {
    const r = viewportRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (cx - r.left - v.tx) / v.s, y: (cy - r.top - v.ty) / v.s }
  }
  const toScreen = (x: number, y: number) => { const v = viewRef.current; return { x: v.tx + x * v.s, y: v.ty + y * v.s } }

  // ── the overlay ──
  const antsOffset = useRef(0)
  const drawOverlay = () => {
    const o = overlayRef.current, vp = viewportRef.current, d = docRef.current
    if (!o || !vp || !d) return
    const dpr = window.devicePixelRatio || 1
    const r = vp.getBoundingClientRect()
    if (o.width !== Math.round(r.width * dpr) || o.height !== Math.round(r.height * dpr)) { o.width = Math.round(r.width * dpr); o.height = Math.round(r.height * dpr) }
    const x = ctx2d(o)
    const v = viewRef.current
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, o.width, o.height)
    x.setTransform(dpr, 0, 0, dpr, 0, 0)
    // canvas edge
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 1
    x.strokeRect(v.tx - 0.5, v.ty - 0.5, d.width * v.s + 1, d.height * v.s + 1)
    // selection: the unselected area dimmed, its edge outlined
    const S = sel.current
    if (S.canvas && S.tint && S.edges) {
      x.imageSmoothingEnabled = true
      x.drawImage(S.tint, v.tx, v.ty, d.width * v.s, d.height * v.s)
      x.imageSmoothingEnabled = false
      x.globalAlpha = 0.95
      x.drawImage(S.edges, v.tx, v.ty, d.width * v.s, d.height * v.s)
      x.globalAlpha = 1
      x.imageSmoothingEnabled = true
      if (S.path) {
        x.save()
        x.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.tx, dpr * v.ty)
        x.lineWidth = 1.25 / v.s
        x.setLineDash([5 / v.s, 5 / v.s]); x.lineDashOffset = -antsOffset.current / v.s
        x.strokeStyle = "#000"; x.stroke(S.path)
        x.lineDashOffset = (5 - antsOffset.current) / v.s
        x.strokeStyle = "#fff"; x.stroke(S.path)
        x.restore()
      }
    }
    const D = drag.current
    // the selected layer's box and handles (move tool)
    const sl = d.layers.find(l => l.id === selectedIdRef.current)
    // a group: the box around its layers, dashed (it moves them all; no handles)
    if (sl?.kind === "group" && toolRef.current === "move" && sl.visible) {
      const b = groupBounds(d, sl.id)
      if (b) {
        const a = toScreen(b.x, b.y)
        x.strokeStyle = "#e2e8f0"; x.lineWidth = 1.25; x.setLineDash([6, 4])
        x.strokeRect(a.x, a.y, b.w * v.s, b.h * v.s); x.setLineDash([])
      }
    }
    if (sl && sl.kind !== "group" && sl.kind !== "adjust" && (toolRef.current === "move") && sl.visible) {
      const cs = corners(sl).map(p => toScreen(p.x, p.y))
      x.strokeStyle = "#38bdf8"; x.lineWidth = 1.25
      x.beginPath(); cs.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.stroke()
      if (!sl.locked) {
        for (const h of handlePoints(sl)) {
          x.fillStyle = h.kind === "rotate" ? "#38bdf8" : "#fff"
          x.strokeStyle = "#0284c7"
          x.beginPath()
          if (h.kind === "rotate") x.arc(h.x, h.y, 5, 0, Math.PI * 2)
          else x.rect(h.x - 4.5, h.y - 4.5, 9, 9)
          x.fill(); x.stroke()
        }
      }
      if (D?.guides) {
        x.strokeStyle = "#f472b6"; x.lineWidth = 1; x.setLineDash([4, 3])
        for (const g of D.guides as { axis: "x" | "y"; at: number }[]) {
          x.beginPath()
          if (g.axis === "x") { const s = toScreen(g.at, 0); x.moveTo(s.x, 0); x.lineTo(s.x, r.height) } else { const s = toScreen(0, g.at); x.moveTo(0, s.y); x.lineTo(r.width, s.y) }
          x.stroke()
        }
        x.setLineDash([])
      }
    }
    // marquee / lasso / box previews
    if (D?.kind === "marquee" || D?.kind === "aibox" || D?.kind === "shape") {
      const a = toScreen(Math.min(D.x0, D.x1), Math.min(D.y0, D.y1)), b = toScreen(Math.max(D.x0, D.x1), Math.max(D.y0, D.y1))
      x.setLineDash([5, 4]); x.strokeStyle = D.kind === "aibox" ? "#e2e8f0" : "#fff"; x.lineWidth = 1.25
      x.beginPath()
      if (D.kind === "marquee" && marqueeRef.current === "ellipse") x.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      else if (D.kind === "shape" && (shapeKindRef.current === "line" || shapeKindRef.current === "arrow")) { const p = toScreen(D.x0, D.y0), q = toScreen(D.x1, D.y1); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y) }
      else x.rect(a.x, a.y, b.x - a.x, b.y - a.y)
      x.stroke(); x.setLineDash([])
    }
    if (D?.kind === "lasso" && D.pts.length > 1) {
      x.setLineDash([5, 4]); x.strokeStyle = "#fff"; x.lineWidth = 1.25
      x.beginPath(); D.pts.forEach((p: any, i: number) => { const s = toScreen(p.x, p.y); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y) }); x.stroke(); x.setLineDash([])
    }
    if (D?.kind === "gradient") {
      const p = toScreen(D.x0, D.y0), q = toScreen(D.x1, D.y1)
      x.strokeStyle = "#fff"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke()
      x.fillStyle = "#fff"; x.beginPath(); x.arc(p.x, p.y, 4, 0, 7); x.fill(); x.beginPath(); x.arc(q.x, q.y, 4, 0, 7); x.fill()
    }
    // AI select points and box
    if (toolRef.current === "ai") {
      const box = aiBoxRef.current
      if (box) { const a = toScreen(box.x, box.y); x.strokeStyle = "#e2e8f0"; x.lineWidth = 1.5; x.setLineDash([6, 4]); x.strokeRect(a.x, a.y, box.w * v.s, box.h * v.s); x.setLineDash([]) }
      for (const p of aiPointsRef.current) {
        const s = toScreen(p.x, p.y)
        x.fillStyle = p.label ? "#22c55e" : "#ef4444"; x.strokeStyle = "#fff"; x.lineWidth = 2
        x.beginPath(); x.arc(s.x, s.y, 6, 0, Math.PI * 2); x.fill(); x.stroke()
      }
    }
    // crop frame
    const c = cropRef.current
    if (toolRef.current === "crop" && c) {
      const a = toScreen(c.x, c.y), w = c.w * v.s, h = c.h * v.s
      x.fillStyle = "rgba(0,0,0,0.55)"
      x.beginPath(); x.rect(0, 0, r.width, r.height); x.rect(a.x, a.y, w, h); x.fill("evenodd")
      x.strokeStyle = "#fff"; x.lineWidth = 1.5; x.strokeRect(a.x, a.y, w, h)
      x.strokeStyle = "rgba(255,255,255,0.35)"; x.lineWidth = 1
      for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(a.x + (w * i) / 3, a.y); x.lineTo(a.x + (w * i) / 3, a.y + h); x.moveTo(a.x, a.y + (h * i) / 3); x.lineTo(a.x + w, a.y + (h * i) / 3); x.stroke() }
      for (const hp of cropHandles(c)) { const s = toScreen(hp.x, hp.y); x.fillStyle = "#fff"; x.fillRect(s.x - 5, s.y - 5, 10, 10) }
      x.fillStyle = "rgba(0,0,0,0.7)"; x.fillRect(a.x, a.y - 22, 96, 20)
      x.fillStyle = "#fff"; x.font = "11px ui-monospace, monospace"; x.fillText(`${Math.round(c.w)} × ${Math.round(c.h)}`, a.x + 6, a.y - 8)
    }
    // the brush outline
    const cur = cursor.current
    if (cur && ["brush", "eraser", "blur"].includes(toolRef.current) && !spaceRef.current) {
      const s = toScreen(cur.x, cur.y)
      const rad = (sizeRef.current / 2) * v.s
      x.strokeStyle = "rgba(0,0,0,0.6)"; x.lineWidth = 3; x.beginPath(); x.arc(s.x, s.y, Math.max(1.5, rad), 0, Math.PI * 2); x.stroke()
      x.strokeStyle = "#fff"; x.lineWidth = 1; x.beginPath(); x.arc(s.x, s.y, Math.max(1.5, rad), 0, Math.PI * 2); x.stroke()
    }
  }
  // Refs mirrored for the overlay (it runs outside React's render)
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId
  const toolRef = useRef(tool); toolRef.current = tool
  const sizeRef = useRef(size); sizeRef.current = size
  const marqueeRef = useRef(marquee); marqueeRef.current = marquee
  const shapeKindRef = useRef(shapeKind); shapeKindRef.current = shapeKind
  const cropRef = useRef(crop); cropRef.current = crop
  const aiPointsRef = useRef(aiPoints); aiPointsRef.current = aiPoints
  const aiBoxRef = useRef(aiBox); aiBoxRef.current = aiBox
  const spaceRef = useRef(spaceDown); spaceRef.current = spaceDown
  // Marching ants for vector selections
  useEffect(() => {
    if (!sel.current.path) return
    const t = setInterval(() => { antsOffset.current = (antsOffset.current + 1) % 10; drawOverlay() }, 90)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVersion])

  // ── selection ──
  const setSelection = (c: HTMLCanvasElement | null, path: Path2D | null = null) => {
    if (c && selectionEmpty(c)) c = null
    if (!c) { sel.current = { canvas: null, path: null, edges: null, tint: null }; setSelVersion(v => v + 1); return }
    // what is NOT selected, dimmed - small, it is only drawn scaled
    const small = fitWithin(c, 1400)
    const tint = newCanvas(small.width, small.height), tx = ctx2d(tint)
    tx.fillStyle = "rgba(2,6,23,0.42)"; tx.fillRect(0, 0, tint.width, tint.height)
    tx.globalCompositeOperation = "destination-out"; tx.drawImage(small, 0, 0)
    sel.current = { canvas: c, path, edges: selectionEdges(c), tint }
    setSelVersion(v => v + 1)
  }
  const commitSelection = (next: HTMLCanvasElement, path: Path2D | null, mode: SelMode) => {
    const d = docRef.current!
    const combined = combineSelection(sel.current.canvas, next, mode)
    // A path survives only when it is the whole selection
    setSelection(combined, mode === "new" || !sel.current.canvas ? path : null)
    void d
  }
  const modeFrom = (e: { shiftKey: boolean; altKey: boolean }): SelMode => (e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : selMode)
  const selectAll = () => { const d = docRef.current; if (!d) return; const p = new Path2D(); p.rect(0, 0, d.width, d.height); setSelection(selectionFromPath(d.width, d.height, p), p) }
  const deselect = () => setSelection(null)
  const invertSel = () => { const d = docRef.current; if (d) setSelection(invertSelection(sel.current.canvas, d.width, d.height)) }
  const featherSel = () => { if (sel.current.canvas) setSelection(featherSelection(sel.current.canvas, feather)) }

  // ── layer helpers ──
  const rtOf = (lid: string) => { let r = rts.current.get(lid); if (!r) { r = {}; rts.current.set(lid, r) } return r }
  /**
   * A new layer goes right above the selected one, in its group; with a group
   * selected it becomes that group's top layer (a group itself never goes
   * inside one). Mutates `layer.parent` so callers see where it went.
   */
  const insertLayer = (d: StudioDoc, layer: StudioLayer, rt: Runtime): StudioDoc => {
    rts.current.set(layer.id, rt)
    const sl = d.layers.find(l => l.id === selectedIdRef.current)
    const layers = [...d.layers]
    if (sl?.kind === "group" && layer.kind !== "group") {
      layer.parent = sl.id
      layers.splice(layers.indexOf(sl), 0, layer)
    } else {
      layer.parent = layer.kind === "group" ? null : sl?.parent ?? null
      const at = sl ? layers.indexOf(sl) + 1 : layers.length
      layers.splice(at, 0, layer)
    }
    return { ...d, layers: normalizeLayers(layers) }
  }
  /** The box around a group's visible layers, on the canvas. */
  const groupBounds = (d: StudioDoc, gid: string): Rect | null => {
    const pts = d.layers.filter(l => l.parent === gid && l.visible && l.kind !== "adjust").flatMap(l => corners(l))
    if (!pts.length) return null
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const x0 = Math.min(...xs), y0 = Math.min(...ys)
    return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
  }
  /** Live move of several layers at once (a group's) - no history step. */
  const patchMany = (patches: Map<string, Partial<StudioLayer>>) => {
    const d = docRef.current
    if (!d) return
    setDoc({ ...d, layers: d.layers.map(l => (patches.has(l.id) ? { ...l, ...patches.get(l.id) } : l)) })
  }
  const rasterLayer = (name: string, pix: HTMLCanvasElement, box?: Rect): StudioLayer => {
    const d = docRef.current!
    const b = box ?? { x: 0, y: 0, w: d.width, h: d.height }
    return { id: uid("l"), name, kind: "raster", visible: true, locked: false, opacity: 1, blend: "normal", ...b, rotation: 0, flipX: false, flipY: false, src: null, pw: pix.width, ph: pix.height }
  }
  /** Add pixels as a new layer: fitted inside the canvas (never upscaled), centred. */
  const addPixelsAsLayer = (pix: HTMLCanvasElement, name: string, src?: string) => {
    const d = docRef.current
    if (!d) return
    if (d.layers.length >= MAX_LAYERS) { flash(`Up to ${MAX_LAYERS} layers`, true); return }
    const k = Math.min(1, d.width / pix.width, d.height / pix.height)
    const w = pix.width * k, h = pix.height * k
    const layer = rasterLayer(name, pix, { x: (d.width - w) / 2, y: (d.height - h) / 2, w, h })
    if (src) uploaded.current.set(pix, src)
    apply("Add layer", dd => insertLayer(dd, layer, { pix }))
    setSelectedId(layer.id); setMaskEdit(false)
  }
  const addLayer = async (what: "empty" | "image" | "refs" | "text" | "shape" | "adjust") => {
    const d = docRef.current
    if (!d) return
    if (what === "image") { fileRef.current?.click(); return }
    if (what === "refs") { setRefPicker(true); return }
    if (d.layers.length >= MAX_LAYERS) { flash(`Up to ${MAX_LAYERS} layers`, true); return }
    if (what === "adjust") {
      // Changes everything under it; with a selection, only there (its mask)
      const layer: StudioLayer = { id: uid("a"), name: "Adjustment", kind: "adjust", visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, w: d.width, h: d.height, rotation: 0, flipX: false, flipY: false, adjust: {} }
      const rt: Runtime = {}
      if (sel.current.canvas) {
        rt.mask = canvasMaskToLayer(sel.current.canvas, layer, d.width, d.height)
        layer.mask = { src: null, enabled: true, mw: d.width, mh: d.height }
      }
      apply("New adjustment layer", dd => insertLayer(dd, layer, rt))
      setSelectedId(layer.id); setMaskEdit(false)
      flash(sel.current.canvas ? "Adjustment layer - only the selection changes (its mask)" : "Adjustment layer - its sliders change everything under it")
      return
    }
    if (what === "empty") {
      const pix = newCanvas(d.width, d.height)
      const layer = rasterLayer(`Layer ${d.layers.length + 1}`, pix)
      apply("New layer", dd => insertLayer(dd, layer, { pix }))
      setSelectedId(layer.id); setMaskEdit(false)
    }
    if (what === "text") addText(d.width / 2, d.height / 2, true)
    if (what === "shape") addShape({ x: d.width * 0.3, y: d.height * 0.3, w: d.width * 0.4, h: d.height * 0.4 }, shapeKindRef.current, true)
  }
  const addText = (cx: number, cy: number, centred: boolean) => {
    const d = docRef.current!
    const t: TextProps = { ...DEFAULT_TEXT, color: fg, size: Math.max(24, Math.round(Math.min(d.width, d.height) / 14)) }
    const m = measureText(t)
    const layer: StudioLayer = { id: uid("l"), name: "Text", kind: "text", visible: true, locked: false, opacity: 1, blend: "normal", x: centred ? cx - m.w / 2 : cx, y: centred ? cy - m.h / 2 : cy, w: m.w, h: m.h, rotation: 0, flipX: false, flipY: false, text: t }
    apply("Add text", dd => insertLayer(dd, layer, {}))
    setSelectedId(layer.id); setMaskEdit(false); setPanel("layers"); setPanelOpen(true)
    setTextFocus(n => n + 1)
  }
  const addShape = (box: Rect, kind: ShapeKind, centred = false, line?: { x0: number; y0: number; x1: number; y1: number }) => {
    const shape: ShapeProps = { ...DEFAULT_SHAPE, shape: kind, fill: kind === "line" || kind === "arrow" ? null : fg, stroke: kind === "line" || kind === "arrow" ? fg : null, strokeWidth: Math.max(4, Math.round(sizeRef.current / 4)) }
    let b = box, rotation = 0
    if (line) {
      const len = Math.max(8, Math.hypot(line.x1 - line.x0, line.y1 - line.y0))
      const h = Math.max(shape.strokeWidth * 6, 12)
      b = { x: (line.x0 + line.x1) / 2 - len / 2, y: (line.y0 + line.y1) / 2 - h / 2, w: len, h }
      rotation = (Math.atan2(line.y1 - line.y0, line.x1 - line.x0) * 180) / Math.PI
    }
    const layer: StudioLayer = { id: uid("l"), name: kind === "rect" ? "Rectangle" : kind[0].toUpperCase() + kind.slice(1), kind: "shape", visible: true, locked: false, opacity: 1, blend: "normal", ...b, rotation, flipX: false, flipY: false, shape }
    apply("Add shape", dd => insertLayer(dd, layer, {}))
    setSelectedId(layer.id); setMaskEdit(false)
    void centred
  }
  /** The raster layer to paint on: the selected one, or a new paint layer if that is not raster. */
  const paintTarget = (createIfNeeded: boolean): { layer: StudioLayer; target: "pix" | "mask" } | null => {
    const d = docRef.current
    if (!d) return null
    const cur = d.layers.find(l => l.id === selectedIdRef.current)
    if (cur?.locked) { flash("This layer is locked", true); return null }
    if (cur && maskEditRef.current && cur.mask) return { layer: cur, target: "mask" }
    if (cur?.kind === "raster") return { layer: cur, target: "pix" }
    if (!createIfNeeded) { flash(cur ? "Rasterize this layer first (Layers panel), or pick a pixel layer" : "Pick a layer first", true); return null }
    const pix = newCanvas(d.width, d.height)
    const layer = rasterLayer("Paint", pix)
    setDoc(insertLayer(clone(d), layer, { pix }))
    setSelectedId(layer.id)
    selectedIdRef.current = layer.id
    return { layer, target: "pix" }
  }
  const maskEditRef = useRef(maskEdit); maskEditRef.current = maskEdit

  // ── transform handles ──
  const handlePoints = (l: StudioLayer) => {
    const m = layerMatrix(l)
    const pts: { kind: "scale" | "rotate"; hx: number; hy: number; x: number; y: number }[] = []
    for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
      const p = m.transformPoint(new DOMPoint(hx * l.w, hy * l.h)); const s = toScreen(p.x, p.y)
      pts.push({ kind: "scale", hx, hy, x: s.x, y: s.y })
    }
    // the rotate knob: above the top edge's middle, in the box's own "up"
    const top = m.transformPoint(new DOMPoint(l.w / 2, 0)), cen = m.transformPoint(new DOMPoint(l.w / 2, l.h / 2))
    const st = toScreen(top.x, top.y), sc = toScreen(cen.x, cen.y)
    const len = Math.hypot(st.x - sc.x, st.y - sc.y) || 1
    pts.push({ kind: "rotate", hx: 0.5, hy: -1, x: st.x + ((st.x - sc.x) / len) * 26, y: st.y + ((st.y - sc.y) / len) * 26 })
    return pts
  }
  const cropHandles = (c: Rect) => [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].map(([hx, hy]) => ({ hx, hy, x: c.x + hx * c.w, y: c.y + hy * c.h }))
  const cropRatio = (): number | null => {
    const d = docRef.current
    if (cropAspectRef.current === "free" || !d) return null
    if (cropAspectRef.current === "original") return d.width / d.height
    const [a, b] = cropAspectRef.current.split(":").map(Number)
    return a / b
  }
  const cropAspectRef = useRef(cropAspect); cropAspectRef.current = cropAspect

  // ── painting ──
  const stampLine = (D: any, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x = ctx2d(D.stroke)
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const step = Math.max(0.75, D.sizePx * 0.1)
    const n = Math.max(1, Math.ceil(dist / step))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      x.drawImage(D.tip, a.x + (b.x - a.x) * t - D.tip.width / 2, a.y + (b.y - a.y) * t - D.tip.height / 2)
    }
  }
  const rebuildPaint = (D: any) => {
    const x = ctx2d(D.work)
    let s: HTMLCanvasElement = D.stroke
    if (D.selIn) { const c = D.clip; const cx = ctx2d(c); cx.globalCompositeOperation = "copy"; cx.drawImage(D.stroke, 0, 0); cx.globalCompositeOperation = "destination-in"; cx.drawImage(D.selIn, 0, 0); cx.globalCompositeOperation = "source-over"; s = c }
    x.globalCompositeOperation = "copy"; x.globalAlpha = 1
    x.drawImage(D.base, 0, 0)
    x.globalCompositeOperation = "source-over"
    x.globalAlpha = D.opacity
    if (D.target === "mask") {
      x.globalCompositeOperation = D.tool === "brush" ? "destination-out" : "source-over"
      x.drawImage(s, 0, 0)
    } else if (D.tool === "brush") {
      x.drawImage(s, 0, 0)
    } else if (D.tool === "eraser") {
      x.globalCompositeOperation = "destination-out"; x.drawImage(s, 0, 0)
    } else if (D.tool === "blur") {
      const e = D.effectClip, ex = ctx2d(e)
      ex.globalCompositeOperation = "copy"; ex.drawImage(D.effect, 0, 0)
      ex.globalCompositeOperation = "destination-in"; ex.drawImage(s, 0, 0); ex.globalCompositeOperation = "source-over"
      x.drawImage(e, 0, 0)
    }
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over"
  }
  const beginPaint = (p: { x: number; y: number }) => {
    const pt = paintTarget(toolRef.current === "brush")
    if (!pt) return
    const { layer, target } = pt
    const rt = rtOf(layer.id)
    const base = (target === "mask" ? rt.mask : rt.pix)!
    const scale = (base.width / layer.w + base.height / layer.h) / 2
    const sizePx = Math.max(1, sizeRef.current * scale)
    const color = target === "mask" ? "#ffffff" : toolRef.current === "brush" ? fgRef.current : "#ffffff"
    const D: any = {
      kind: "paint", tool: toolRef.current, layer, target, base, work: copyCanvas(base), stroke: newCanvas(base.width, base.height),
      tip: brushTip(sizePx, hardnessRef.current, color), sizePx, opacity: opacityRef.current,
      selIn: sel.current.canvas ? canvasMaskToLayer(sel.current.canvas, layer, base.width, base.height) : null,
    }
    if (D.selIn) D.clip = newCanvas(base.width, base.height)
    if (D.tool === "blur") {
      D.effect = blurModeRef.current === "blur" ? blurCanvas(base, Math.max(1, strengthRef.current * scale * 0.5)) : applyAdjust(base, { sharpen: Math.min(100, strengthRef.current * 4) })
      D.effectClip = newCanvas(base.width, base.height)
    }
    const lp = toLocal(layer, p.x, p.y)
    D.last = { x: (lp.x * base.width) / layer.w, y: (lp.y * base.height) / layer.h }
    stampLine(D, D.last, D.last)
    rebuildPaint(D)
    if (target === "mask") rt.mask = D.work; else rt.pix = D.work
    rt.live = true
    drag.current = D
    render()
  }
  const movePaint = (p: { x: number; y: number }) => {
    const D = drag.current
    const lp = toLocal(D.layer, p.x, p.y)
    const cur = { x: (lp.x * D.base.width) / D.layer.w, y: (lp.y * D.base.height) / D.layer.h }
    stampLine(D, D.last, cur)
    D.last = cur
    rebuildPaint(D)
    rtOf(D.layer.id).content = undefined
    render()
  }
  const endPaint = () => {
    const D = drag.current
    const rt = rtOf(D.layer.id)
    rt.live = false
    rt.content = undefined
    pushHistory(D.tool === "brush" ? (D.target === "mask" ? "Hide (mask)" : "Brush") : D.tool === "eraser" ? (D.target === "mask" ? "Reveal (mask)" : "Erase") : blurModeRef.current === "blur" ? "Blur" : "Sharpen")
    render()
  }
  const fgRef = useRef(fg); fgRef.current = fg
  const hardnessRef = useRef(hardness); hardnessRef.current = hardness
  const opacityRef = useRef(opacity); opacityRef.current = opacity
  const blurModeRef = useRef(blurMode); blurModeRef.current = blurMode
  const strengthRef = useRef(strength); strengthRef.current = strength

  /** Replace a layer's pixels (or mask) with an edited copy - one undo step. */
  const editPixels = (layer: StudioLayer, target: "pix" | "mask", label: string, fn: (work: HTMLCanvasElement) => void) => {
    const rt = rtOf(layer.id)
    const base = target === "mask" ? rt.mask : rt.pix
    if (!base) return
    const work = copyCanvas(base)
    fn(work)
    if (target === "mask") rt.mask = work; else rt.pix = work
    rt.content = undefined
    pushHistory(label)
    render()
  }

  // ── fill, gradient, eyedropper ──
  const fillAt = (p: { x: number; y: number }, alt: boolean) => {
    const pt = paintTarget(true)
    if (!pt) return
    const { layer, target } = pt
    const rt = rtOf(layer.id)
    const base = (target === "mask" ? rt.mask : rt.pix)!
    const lp = toLocal(layer, p.x, p.y)
    const px = Math.floor((lp.x * base.width) / layer.w), py = Math.floor((lp.y * base.height) / layer.h)
    const selIn = sel.current.canvas ? canvasMaskToLayer(sel.current.canvas, layer, base.width, base.height) : null
    // Inside a selection: fill the selection. Elsewhere: the connected colour region
    let region: HTMLCanvasElement
    if (selIn && px >= 0 && py >= 0 && px < base.width && py < base.height && ctx2d(selIn).getImageData(px, py, 1, 1).data[3] > 127) region = selIn
    else {
      region = floodMask(base, px, py, toleranceRef.current)
      if (selIn) { const x = ctx2d(region); x.globalCompositeOperation = "destination-in"; x.drawImage(selIn, 0, 0) }
    }
    editPixels(layer, target, target === "mask" ? (alt ? "Hide area" : "Reveal area") : "Fill", work => {
      const paint = newCanvas(work.width, work.height), px2 = ctx2d(paint)
      px2.fillStyle = target === "mask" ? "#fff" : alt ? bgRef.current : fgRef.current
      px2.fillRect(0, 0, paint.width, paint.height)
      px2.globalCompositeOperation = "destination-in"; px2.drawImage(region, 0, 0)
      const x = ctx2d(work)
      x.globalAlpha = opacityRef.current
      x.globalCompositeOperation = target === "mask" && alt ? "destination-out" : "source-over"
      x.drawImage(paint, 0, 0)
    })
  }
  const toleranceRef = useRef(tolerance); toleranceRef.current = tolerance
  const bgRef = useRef(bg); bgRef.current = bg
  const applyGradient = (D: { x0: number; y0: number; x1: number; y1: number }) => {
    const d = docRef.current!
    const pt = paintTarget(true)
    if (!pt) return
    const { layer, target } = pt
    // Draw the gradient in canvas space, then map it into the layer
    const g = newCanvas(d.width, d.height), gx = ctx2d(g)
    const col0 = target === "mask" ? "#ffffff" : fgRef.current
    const col1 = target === "mask" ? "rgba(255,255,255,0)" : gradToRef.current === "bg" ? bgRef.current : "rgba(0,0,0,0)"
    const grad = gradKindRef.current === "radial"
      ? gx.createRadialGradient(D.x0, D.y0, 0, D.x0, D.y0, Math.max(1, Math.hypot(D.x1 - D.x0, D.y1 - D.y0)))
      : gx.createLinearGradient(D.x0, D.y0, D.x1, D.y1)
    grad.addColorStop(0, col0); grad.addColorStop(1, col1)
    gx.fillStyle = grad; gx.fillRect(0, 0, d.width, d.height)
    if (sel.current.canvas) { gx.globalCompositeOperation = "destination-in"; gx.drawImage(sel.current.canvas, 0, 0) }
    const rt = rtOf(layer.id)
    const base = (target === "mask" ? rt.mask : rt.pix)!
    const inLayer = canvasMaskToLayer(g, layer, base.width, base.height)
    editPixels(layer, target, "Gradient", work => {
      const x = ctx2d(work)
      if (target === "mask") { x.globalCompositeOperation = "copy"; x.drawImage(inLayer, 0, 0); return }
      x.globalAlpha = opacityRef.current
      x.drawImage(inLayer, 0, 0)
    })
  }
  const gradKindRef = useRef(gradKind); gradKindRef.current = gradKind
  const gradToRef = useRef(gradTo); gradToRef.current = gradTo
  const pickColour = (p: { x: number; y: number }, toBg: boolean) => {
    const d = docRef.current!
    const px = Math.floor(p.x), py = Math.floor(p.y)
    if (px < 0 || py < 0 || px >= d.width || py >= d.height) return
    const c = stageRef.current!
    const v = ctx2d(c).getImageData(px, py, 1, 1).data
    const hex = toHex(v[0], v[1], v[2])
    if (toBg) setBg(hex); else setFg(hex)
  }

  // ── pointer input ──
  const onPointerDown = (e: React.PointerEvent) => {
    const d = docRef.current
    if (!d) return
    // The canvas takes the click without taking focus: whatever was being
    // typed in is finished, and a box focused by this click (a new text
    // layer's) keeps it - the browser's own mousedown used to steal it back,
    // so typing after placing text fired the tool shortcuts instead
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Two fingers: pinch to zoom and pan, whatever the tool
    if (pointers.current.size === 2) {
      if (drag.current?.kind === "paint") endPaint()
      drag.current = null
      const [a, b] = [...pointers.current.values()]
      const v = viewRef.current
      const r = viewportRef.current!.getBoundingClientRect()
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, s: v.s, tx: v.tx, ty: v.ty }
      return
    }
    const p = toDoc(e.clientX, e.clientY)
    const t = toolRef.current
    if (e.button === 1 || spaceRef.current || t === "hand") {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty }
      return
    }
    if (e.button !== 0 && e.pointerType === "mouse") return
    if (t === "move") return moveDown(e, p)
    if (t === "marquee") { drag.current = { kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, mode: modeFrom(e) }; return }
    if (t === "lasso") { drag.current = { kind: "lasso", pts: [p], mode: modeFrom(e) }; return }
    if (t === "ai") { drag.current = { kind: "aibox", x0: p.x, y0: p.y, x1: p.x, y1: p.y, alt: e.altKey, sx: e.clientX, sy: e.clientY }; return }
    if (t === "crop") return cropDown(e, p)
    if (t === "brush" || t === "eraser" || t === "blur") return beginPaint(p)
    if (t === "fill") return fillAt(p, e.altKey)
    if (t === "gradient") { drag.current = { kind: "gradient", x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return }
    if (t === "eyedropper") { pickColour(p, e.altKey); drag.current = { kind: "pick", alt: e.altKey }; return }
    if (t === "text") {
      const hit = [...d.layers].reverse().find(l => l.kind === "text" && hitLayer(l, rts.current.get(l.id), p.x, p.y))
      if (hit) { setSelectedId(hit.id); setPanel("layers"); setPanelOpen(true); setTextFocus(n => n + 1) } else addText(p.x, p.y, false)
      return
    }
    if (t === "shape") { drag.current = { kind: "shape", x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = docRef.current ? toDoc(e.clientX, e.clientY) : null
    cursor.current = p
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const P = pinch.current
      const r = viewportRef.current!.getBoundingClientRect()
      const s = Math.min(32, Math.max(0.02, (P.s * Math.hypot(a.x - b.x, a.y - b.y)) / P.d))
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top
      autoFit.current = false
      setView({ s, tx: cx - (P.cx - P.tx) * (s / P.s), ty: cy - (P.cy - P.ty) * (s / P.s) })
      return
    }
    const D = drag.current
    if (!D || !p) { if (["brush", "eraser", "blur"].includes(toolRef.current)) drawOverlay(); return }
    if (D.kind === "pan") { autoFit.current = false; setView(v => ({ ...v, tx: D.tx + e.clientX - D.sx, ty: D.ty + e.clientY - D.sy })); return }
    if (D.kind === "paint") return movePaint(p)
    if (D.kind === "move" || D.kind === "scale" || D.kind === "rotate" || D.kind === "moveGroup") return transformMove(e, p)
    if (D.kind === "crop") return cropMove(e, p)
    if (D.kind === "pick") { pickColour(p, D.alt); return }
    if (D.kind === "lasso") { D.pts.push(p); drawOverlay(); return }
    if (D.kind === "marquee" || D.kind === "aibox" || D.kind === "gradient" || D.kind === "shape") {
      let x1 = p.x, y1 = p.y
      // Shift: a square / circle, or a line snapped to 45°
      if (e.shiftKey && (D.kind === "marquee" || D.kind === "shape")) {
        if (D.kind === "shape" && (shapeKindRef.current === "line" || shapeKindRef.current === "arrow")) {
          const ang = Math.round(Math.atan2(p.y - D.y0, p.x - D.x0) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p.x - D.x0, p.y - D.y0)
          x1 = D.x0 + Math.cos(ang) * len; y1 = D.y0 + Math.sin(ang) * len
        } else { const m = Math.max(Math.abs(p.x - D.x0), Math.abs(p.y - D.y0)); x1 = D.x0 + Math.sign(p.x - D.x0 || 1) * m; y1 = D.y0 + Math.sign(p.y - D.y0 || 1) * m }
      }
      D.x1 = x1; D.y1 = y1
      drawOverlay()
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; return }
    const D = drag.current
    drag.current = null
    if (!D) return
    const d = docRef.current!
    if (D.kind === "paint") return endPaint()
    if (D.kind === "move" || D.kind === "scale" || D.kind === "rotate" || D.kind === "moveGroup") {
      if (D.changed) pushHistory(D.kind === "move" ? "Move" : D.kind === "moveGroup" ? "Move group" : D.kind === "scale" ? "Resize" : "Rotate")
      render(); return
    }
    if (D.kind === "crop") { render(); return }
    if (D.kind === "marquee") {
      const x = Math.min(D.x0, D.x1), y = Math.min(D.y0, D.y1), w = Math.abs(D.x1 - D.x0), h = Math.abs(D.y1 - D.y0)
      if (w < 2 || h < 2) { if (D.mode === "new") deselect(); render(); return }
      const path = new Path2D()
      if (marqueeRef.current === "ellipse") path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else path.rect(x, y, w, h)
      commitSelection(selectionFromPath(d.width, d.height, path), path, D.mode)
      return
    }
    if (D.kind === "lasso") {
      if (D.pts.length < 3) { if (D.mode === "new") deselect(); render(); return }
      const path = new Path2D()
      D.pts.forEach((q: any, i: number) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y))); path.closePath()
      commitSelection(selectionFromPath(d.width, d.height, path), path, D.mode)
      return
    }
    if (D.kind === "aibox") {
      const moved = Math.hypot(e.clientX - D.sx, e.clientY - D.sy) > 6
      if (moved) setAiBox({ x: Math.min(D.x0, D.x1), y: Math.min(D.y0, D.y1), w: Math.abs(D.x1 - D.x0), h: Math.abs(D.y1 - D.y0) })
      else setAiPoints(ps => [...ps, { x: D.x0 as number, y: D.y0 as number, label: (D.alt ? 0 : 1) as 0 | 1 }].slice(-24))
      render(); return
    }
    if (D.kind === "gradient") { if (Math.hypot(D.x1 - D.x0, D.y1 - D.y0) > 2) applyGradient(D); render(); return }
    if (D.kind === "shape") {
      const kind = shapeKindRef.current
      if (kind === "line" || kind === "arrow") { if (Math.hypot(D.x1 - D.x0, D.y1 - D.y0) > 4) addShape({ x: 0, y: 0, w: 1, h: 1 }, kind, false, D) }
      else {
        const box = { x: Math.min(D.x0, D.x1), y: Math.min(D.y0, D.y1), w: Math.abs(D.x1 - D.x0), h: Math.abs(D.y1 - D.y0) }
        if (box.w > 3 && box.h > 3) addShape(box, kind)
      }
      render(); return
    }
    render()
  }

  // ── move / transform ──
  const moveDown = (e: React.PointerEvent, p: { x: number; y: number }) => {
    const d = docRef.current!
    const r = viewportRef.current!.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const cur = d.layers.find(l => l.id === selectedIdRef.current)
    // A selected group: dragging inside the box around its layers moves them all
    if (cur?.kind === "group") {
      const b = groupBounds(d, cur.id)
      if (b && !cur.locked && cur.visible && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h) {
        drag.current = { kind: "moveGroup", id: cur.id, starts: d.layers.filter(l => l.parent === cur.id && !l.locked).map(l => ({ id: l.id, x: l.x, y: l.y })), px: p.x, py: p.y }
        return
      }
    }
    // A handle of the selected layer first
    if (cur && cur.kind !== "group" && cur.kind !== "adjust" && !effective(d.layers, cur).locked && effective(d.layers, cur).visible) {
      for (const h of handlePoints(cur)) {
        if (Math.hypot(h.x - sx, h.y - sy) <= 9) {
          if (h.kind === "rotate") {
            const c = { x: cur.x + cur.w / 2, y: cur.y + cur.h / 2 }
            drag.current = { kind: "rotate", id: cur.id, start: clone(cur), a0: Math.atan2(p.y - c.y, p.x - c.x) }
          } else {
            const m = layerMatrix(cur)
            const ap = m.transformPoint(new DOMPoint((1 - h.hx) * cur.w, (1 - h.hy) * cur.h))
            drag.current = { kind: "scale", id: cur.id, start: clone(cur), hx: h.hx, hy: h.hy, anchor: { x: ap.x, y: ap.y } }
          }
          return
        }
      }
    }
    // Then whatever is under the pointer (top first); the selected layer keeps priority inside its box
    const usable = (l: StudioLayer) => { const e = effective(d.layers, l); return e.visible && !e.locked }
    const inCur = cur && cur.kind !== "group" && cur.kind !== "adjust" && usable(cur) && (() => { const q = toLocal(cur, p.x, p.y); return q.x >= 0 && q.y >= 0 && q.x <= cur.w && q.y <= cur.h })()
    const hit = inCur ? cur : [...d.layers].reverse().find(l => usable(l) && hitLayer(l, rts.current.get(l.id), p.x, p.y))
    if (!hit) { setSelectedId(null); render(); return }
    if (hit.id !== selectedIdRef.current) { setSelectedId(hit.id); setMaskEdit(false); setPicked(new Set()) }
    drag.current = { kind: "move", id: hit.id, start: clone(hit), px: p.x, py: p.y }
  }
  const transformMove = (e: React.PointerEvent, p: { x: number; y: number }) => {
    const D = drag.current
    const d = docRef.current!
    if (D.kind === "moveGroup") {
      const dx = p.x - D.px, dy = p.y - D.py
      patchMany(new Map((D.starts as { id: string; x: number; y: number }[]).map(s => [s.id, { x: s.x + dx, y: s.y + dy }])))
      D.changed = true
      return
    }
    const S: StudioLayer = D.start
    let next: Partial<StudioLayer> = {}
    if (D.kind === "move") {
      let nx = S.x + (p.x - D.px), ny = S.y + (p.y - D.py)
      // Snap the box's edges and centre to the canvas edges and centre
      const tol = 7 / viewRef.current.s
      const guides: { axis: "x" | "y"; at: number }[] = []
      if (!e.altKey) {
        for (const [off, axis] of [[0, "x"], [S.w / 2, "x"], [S.w, "x"]] as const) for (const t of [0, d.width / 2, d.width]) if (Math.abs(nx + off - t) < tol) { nx = t - off; guides.push({ axis, at: t }) }
        for (const [off, axis] of [[0, "y"], [S.h / 2, "y"], [S.h, "y"]] as const) for (const t of [0, d.height / 2, d.height]) if (Math.abs(ny + off - t) < tol) { ny = t - off; guides.push({ axis, at: t }) }
      }
      D.guides = guides
      next = { x: nx, y: ny }
    } else if (D.kind === "rotate") {
      const c = { x: S.x + S.w / 2, y: S.y + S.h / 2 }
      let rot = S.rotation + ((Math.atan2(p.y - c.y, p.x - c.x) - D.a0) * 180) / Math.PI
      if (e.shiftKey) rot = Math.round(rot / 15) * 15
      else for (const snap of [0, 90, 180, 270, -90, -180, -270, 360]) if (Math.abs(rot - snap) < 3) rot = snap
      next = { rotation: rot }
    } else {
      // Scale about the opposite handle, in the box's own frame
      const m0 = layerMatrix(S), inv = m0.inverse()
      const q = inv.transformPoint(new DOMPoint(p.x, p.y))
      const ax = (1 - D.hx) * S.w, ay = (1 - D.hy) * S.h
      let w = D.hx === 0.5 ? S.w : Math.max(1, Math.abs(q.x - ax))
      let h = D.hy === 0.5 ? S.h : Math.max(1, Math.abs(q.y - ay))
      // Corners keep the proportions (text always); Shift frees them
      const corner = D.hx !== 0.5 && D.hy !== 0.5
      if ((corner && !e.shiftKey) || S.kind === "text") {
        const k = corner ? Math.max(w / S.w, h / S.h) : D.hx === 0.5 ? h / S.h : w / S.w
        w = S.w * k; h = S.h * k
      }
      // keep the anchor where it was on the canvas
      const lin = new DOMMatrix().rotateSelf(S.rotation).scaleSelf(S.flipX ? -1 : 1, S.flipY ? -1 : 1)
      const al = { x: (1 - D.hx) * w - w / 2, y: (1 - D.hy) * h - h / 2 }
      const off = lin.transformPoint(new DOMPoint(al.x, al.y))
      const cx = D.anchor.x - off.x, cy = D.anchor.y - off.y
      next = { x: cx - w / 2, y: cy - h / 2, w, h }
      if (S.kind === "text" && S.text) next.text = { ...S.text, size: Math.max(4, S.text.size * (w / S.w)) }
    }
    D.changed = true
    patchLayer(D.id, next)
  }

  // ── crop ──
  const cropDown = (e: React.PointerEvent, p: { x: number; y: number }) => {
    const c = cropRef.current
    const r = viewportRef.current!.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    if (c) {
      for (const h of cropHandles(c)) { const s = toScreen(h.x, h.y); if (Math.hypot(s.x - sx, s.y - sy) <= 10) { drag.current = { kind: "crop", mode: "handle", hx: h.hx, hy: h.hy, start: { ...c } }; return } }
      if (p.x >= c.x && p.y >= c.y && p.x <= c.x + c.w && p.y <= c.y + c.h) { drag.current = { kind: "crop", mode: "move", start: { ...c }, px: p.x, py: p.y }; return }
    }
    drag.current = { kind: "crop", mode: "new", x0: p.x, y0: p.y }
    setCrop({ x: p.x, y: p.y, w: 1, h: 1 })
  }
  const cropMove = (_e: React.PointerEvent, p: { x: number; y: number }) => {
    const D = drag.current
    const ratio = cropRatio()
    if (D.mode === "move") { setCrop({ ...D.start, x: D.start.x + p.x - D.px, y: D.start.y + p.y - D.py }); return }
    if (D.mode === "new") {
      let w = p.x - D.x0, h = p.y - D.y0
      if (ratio) { const m = Math.max(Math.abs(w), Math.abs(h) * ratio); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * (m / ratio) }
      setCrop({ x: Math.min(D.x0, D.x0 + w), y: Math.min(D.y0, D.y0 + h), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) })
      return
    }
    const s = D.start as Rect
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h
    if (D.hx === 0) x0 = p.x; if (D.hx === 1) x1 = p.x
    if (D.hy === 0) y0 = p.y; if (D.hy === 1) y1 = p.y
    let w = Math.max(4, x1 - x0), h = Math.max(4, y1 - y0)
    if (ratio) {
      if (D.hx === 0.5) w = h * ratio; else if (D.hy === 0.5) h = w / ratio; else { if (w / h > ratio) h = w / ratio; else w = h * ratio }
      if (D.hx === 0) x0 = x1 - w
      if (D.hy === 0) y0 = y1 - h
      if (D.hx === 0.5) x0 = s.x + (s.w - w) / 2
      if (D.hy === 0.5) y0 = s.y + (s.h - h) / 2
    }
    setCrop({ x: x0, y: y0, w, h })
  }
  const applyCrop = () => {
    const c = cropRef.current
    if (!c) return
    const w = Math.round(Math.min(MAX_CANVAS_SIDE, c.w)), h = Math.round(Math.min(MAX_CANVAS_SIDE, c.h))
    apply("Crop", d => ({ ...d, width: w, height: h, layers: d.layers.map(l => ({ ...l, x: l.x - c.x, y: l.y - c.y })) }))
    setSelection(null)
    setCrop({ x: 0, y: 0, w, h })
    requestAnimationFrame(() => fitView())
  }
  // The crop tool starts on the whole canvas
  useEffect(() => { if (tool === "crop" && doc) setCrop({ x: 0, y: 0, w: doc.width, h: doc.height }); if (tool !== "crop") setCrop(null) }, [tool])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A new aspect: the largest frame of that shape inside the current one, centred
    const c = cropRef.current, ratio = cropRatio()
    if (!c || !ratio) return
    const w = Math.min(c.w, c.h * ratio), h = w / ratio
    setCrop({ x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h })
  }, [cropAspect])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── selection actions on a layer ──
  const selLayerTarget = (): { layer: StudioLayer; target: "pix" | "mask" } | null => {
    const d = docRef.current
    const cur = d?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur) { flash("Pick a layer first", true); return null }
    if (cur.locked) { flash("This layer is locked", true); return null }
    if (maskEditRef.current && cur.mask) return { layer: cur, target: "mask" }
    if (cur.kind === "group" || cur.kind === "adjust") { flash("Pick a pixel layer - or paint this layer's mask", true); return null }
    if (cur.kind !== "raster") { flash("Rasterize this layer first (Layers panel)", true); return null }
    return { layer: cur, target: "pix" }
  }
  const selInLayer = (layer: StudioLayer, base: HTMLCanvasElement) => canvasMaskToLayer(sel.current.canvas!, layer, base.width, base.height)
  const deleteSelected = () => {
    if (!sel.current.canvas) {
      // No selection: Delete removes the layer itself
      if (selectedIdRef.current) removeLayer()
      return
    }
    const t = selLayerTarget(); if (!t) return
    const rt = rtOf(t.layer.id), base = (t.target === "mask" ? rt.mask : rt.pix)!
    const m = selInLayer(t.layer, base)
    editPixels(t.layer, t.target, t.target === "mask" ? "Hide selection" : "Delete selection", w => { const x = ctx2d(w); x.globalCompositeOperation = "destination-out"; x.drawImage(m, 0, 0) })
  }
  const keepSelected = () => {
    const t = selLayerTarget(); if (!t || !sel.current.canvas) return
    const rt = rtOf(t.layer.id), base = (t.target === "mask" ? rt.mask : rt.pix)!
    const m = selInLayer(t.layer, base)
    editPixels(t.layer, t.target, "Keep selection only", w => { const x = ctx2d(w); x.globalCompositeOperation = "destination-in"; x.drawImage(m, 0, 0) })
  }
  const fillSelection = () => {
    if (!sel.current.canvas) return
    const pt = paintTarget(true); if (!pt) return
    const rt = rtOf(pt.layer.id), base = (pt.target === "mask" ? rt.mask : rt.pix)!
    const m = selInLayer(pt.layer, base)
    editPixels(pt.layer, pt.target, "Fill selection", w => {
      const paint = newCanvas(w.width, w.height), px = ctx2d(paint)
      px.fillStyle = pt.target === "mask" ? "#fff" : fgRef.current; px.fillRect(0, 0, w.width, w.height)
      px.globalCompositeOperation = "destination-in"; px.drawImage(m, 0, 0)
      const x = ctx2d(w); x.globalAlpha = opacityRef.current; x.drawImage(paint, 0, 0)
    })
  }
  /** The selected part of the layer (or the whole layer) as a new layer; `cut` takes it out of the original. */
  const copyToLayer = (cut = false) => {
    const d = docRef.current
    const cur = d?.layers.find(l => l.id === selectedIdRef.current)
    if (!d || !cur) { flash("Pick a layer first", true); return }
    if (!sel.current.canvas) { duplicateLayer(); return }
    const rt = rtOf(cur.id)
    const pix = layerInCanvasSpace(d, cur, rt, rts.current)
    const x = ctx2d(pix); x.globalCompositeOperation = "destination-in"; x.drawImage(sel.current.canvas, 0, 0)
    const b = selectionBounds(sel.current.canvas)
    // Trim to the selection's box so the new layer is no bigger than it needs to be
    let out = pix, box: Rect = { x: 0, y: 0, w: d.width, h: d.height }
    if (b) { out = newCanvas(b.w, b.h); ctx2d(out).drawImage(pix, -b.x, -b.y); box = b }
    const layer = { ...rasterLayer(`${cur.name} ${cut ? "cut" : "copy"}`, out, box), blend: cur.blend, opacity: cur.opacity }
    if (cut && cur.kind === "raster" && rt.pix) {
      const m = selInLayer(cur, rt.pix)
      const work = copyCanvas(rt.pix), wx = ctx2d(work); wx.globalCompositeOperation = "destination-out"; wx.drawImage(m, 0, 0)
      rt.pix = work; rt.content = undefined
    }
    apply(cut ? "Cut to new layer" : "Copy to new layer", dd => insertLayer(dd, layer, { pix: out }))
    setSelectedId(layer.id); setMaskEdit(false)
  }
  const saveSelectionPng = async () => {
    const d = docRef.current
    if (!d || !sel.current.canvas) return
    const flat = flatten(d, rts.current, false)
    const x = ctx2d(flat); x.globalCompositeOperation = "destination-in"; x.drawImage(sel.current.canvas, 0, 0)
    const b = selectionBounds(sel.current.canvas)
    let out = flat
    if (b) { out = newCanvas(b.w, b.h); ctx2d(out).drawImage(flat, -b.x, -b.y) }
    download(await toBlob(out, "image/png"), `${title || "canvas"}-cutout.png`)
  }
  const cropToSelection = () => {
    const b = sel.current.canvas ? selectionBounds(sel.current.canvas) : null
    if (!b) return
    setCrop(b)
    setToolState("crop")
    requestAnimationFrame(() => { setCrop(b) })
  }

  // ── layer actions ──
  const duplicateLayer = () => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur) return
    if (cur.kind === "group") {
      // The group and its layers (sharing pixels - never edited in place)
      const d = docRef.current!
      const gid = uid("g")
      const kids = d.layers.filter(l => l.parent === cur.id)
      if (d.layers.length + kids.length + 1 > MAX_LAYERS) { flash(`Up to ${MAX_LAYERS} layers`, true); return }
      const copies = kids.map(k => { const c: StudioLayer = { ...clone(k), id: uid("l"), parent: gid }; rts.current.set(c.id, { pix: rtOf(k.id).pix, mask: rtOf(k.id).mask }); return c })
      rts.current.set(gid, {})
      apply("Duplicate group", dd => {
        const layers = [...dd.layers]
        layers.splice(layers.findIndex(l => l.id === cur.id) + 1, 0, ...copies, { ...clone(cur), id: gid, name: `${cur.name} copy` })
        return { ...dd, layers: normalizeLayers(layers) }
      })
      setSelectedId(gid)
      return
    }
    const rt = rtOf(cur.id)
    const copy: StudioLayer = { ...clone(cur), id: uid("l"), name: `${cur.name} copy` }
    // Pixels are never edited in place, so the copy can share them
    apply("Duplicate layer", d => insertLayer(d, copy, { pix: rt.pix, mask: rt.mask }))
    setSelectedId(copy.id)
  }
  const removeLayer = () => {
    const cur = selectedIdRef.current
    if (!cur) return
    const d = docRef.current!
    const i = d.layers.findIndex(l => l.id === cur)
    const isGroup = d.layers[i]?.kind === "group"
    // A group goes with its layers
    apply(isGroup ? "Delete group" : "Delete layer", dd => ({ ...dd, layers: dd.layers.filter(l => l.id !== cur && l.parent !== cur) }))
    const left = d.layers.filter(l => l.id !== cur && l.parent !== cur)
    setSelectedId(left[Math.min(left.length - 1, Math.max(0, i - (isGroup ? d.layers.filter(l => l.parent === cur).length : 0) - 1))]?.id ?? null)
    setMaskEdit(false)
  }
  const reorder = (lid: string, to: number) => {
    apply("Reorder layers", d => {
      const layers = [...d.layers]
      const from = layers.findIndex(l => l.id === lid)
      if (from < 0) return d
      const [l] = layers.splice(from, 1)
      layers.splice(Math.max(0, Math.min(layers.length, to)), 0, l)
      return { ...d, layers }
    })
  }
  const mergeDown = () => {
    const d = docRef.current!
    const cur = d.layers.find(l => l.id === selectedIdRef.current)
    if (!cur) return
    if (cur.kind === "group") {
      // The group as it shows (its opacity and blend included), as one pixel layer in its place
      const pix = layerInCanvasSpace(d, cur, rtOf(cur.id), rts.current)
      const layer = { ...rasterLayer(cur.name, pix), id: uid("l") }
      apply("Merge group", dd => {
        rts.current.set(layer.id, { pix })
        return { ...dd, layers: normalizeLayers(dd.layers.filter(l => l.parent !== cur.id).map(l => (l.id === cur.id ? layer : l))) }
      })
      setSelectedId(layer.id)
      return
    }
    // The layer under it in the same group (or at the top level)
    const sibs = d.layers.filter(l => (l.parent ?? null) === (cur.parent ?? null))
    const below = sibs[sibs.indexOf(cur) - 1]
    if (!below) return
    if (below.kind === "group" || below.kind === "adjust") { flash(below.kind === "group" ? "Merge the group first" : "Nothing to merge into - an adjustment layer has no pixels", true); return }
    const pix = newCanvas(d.width, d.height)
    // An adjustment layer merged down is baked into the layer under it
    compose(ctx2d(pix), { ...d, background: null, layers: [{ ...below, parent: null }, { ...cur, parent: null }] }, rts.current, { background: false })
    const layer: StudioLayer = { ...rasterLayer(below.name, pix), id: uid("l"), parent: cur.parent ?? null }
    apply("Merge down", dd => {
      rts.current.set(layer.id, { pix })
      const bi = dd.layers.findIndex(l => l.id === below.id)
      const layers = dd.layers.filter(l => l.id !== cur.id && l.id !== below.id)
      layers.splice(bi, 0, layer)
      return { ...dd, layers: normalizeLayers(layers) }
    })
    setSelectedId(layer.id)
  }
  // ── groups ──
  const groupLayers = () => {
    const d = docRef.current
    if (!d) return
    const ids = new Set([...pickedRef.current, ...(selectedIdRef.current ? [selectedIdRef.current] : [])])
    const members = d.layers.filter(l => ids.has(l.id) && l.kind !== "group")
    if (d.layers.length >= MAX_LAYERS) { flash(`Up to ${MAX_LAYERS} layers`, true); return }
    const gid = uid("g")
    const g: StudioLayer = { id: gid, name: `Group ${d.layers.filter(l => l.kind === "group").length + 1}`, kind: "group", visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, w: d.width, h: d.height, rotation: 0, flipX: false, flipY: false }
    rts.current.set(gid, {})
    apply(members.length ? `Group ${members.length} layer${members.length === 1 ? "" : "s"}` : "New group", dd => {
      if (!members.length) return insertLayer(dd, g, {})
      // The group takes the place of the topmost layer it gets
      const mids = new Set(members.map(m => m.id))
      const top = Math.max(...members.map(m => dd.layers.findIndex(l => l.id === m.id)))
      const layers = dd.layers.map(l => (mids.has(l.id) ? { ...l, parent: gid } : l))
      layers.splice(top + 1, 0, g)
      return { ...dd, layers: normalizeLayers(layers) }
    })
    setSelectedId(gid); setPicked(new Set()); setMaskEdit(false)
  }
  const ungroup = () => {
    const g = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!g || g.kind !== "group") { flash("Select a group to ungroup", true); return }
    const first = docRef.current!.layers.filter(l => l.parent === g.id).at(-1)
    apply("Ungroup", dd => ({ ...dd, layers: normalizeLayers(dd.layers.filter(l => l.id !== g.id).map(l => (l.parent === g.id ? { ...l, parent: null } : l))) }))
    setSelectedId(first?.id ?? null)
  }
  const moveOutOfGroup = () => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur?.parent) return
    apply("Move out of group", dd => {
      const layers = dd.layers.filter(l => l.id !== cur.id)
      layers.splice(layers.findIndex(l => l.id === cur.parent) + 1, 0, { ...cur, parent: null })
      return { ...dd, layers: normalizeLayers(layers) }
    })
  }
  const toggleCollapse = (gid: string) => apply("Fold group", dd => ({ ...dd, layers: dd.layers.map(l => (l.id === gid ? { ...l, collapsed: !l.collapsed } : l)) }))
  /** A layer dropped on a row: into a group (on top), else just above that row, at its level. */
  const dropOn = (id: string, targetId: string) => {
    const d = docRef.current!
    const L = d.layers.find(l => l.id === id), T = d.layers.find(l => l.id === targetId)
    if (!L || !T || L.id === T.id || T.parent === L.id) return
    apply("Move layer", dd => {
      const layers = dd.layers.filter(l => l.id !== id)
      if (T.kind === "group" && L.kind !== "group") {
        layers.splice(layers.findIndex(l => l.id === T.id), 0, { ...L, parent: T.id })
      } else {
        // A group never goes inside one: dropped on a group's layer, it goes above that group
        const anchor = L.kind === "group" && T.parent ? T.parent : T.id
        layers.splice(layers.findIndex(l => l.id === anchor) + 1, 0, { ...L, parent: L.kind === "group" ? null : T.parent ?? null })
      }
      return { ...dd, layers: normalizeLayers(layers) }
    })
  }
  /** One place up or down among the layers beside it (a group counts as one). */
  const stepLayer = (id: string, dir: 1 | -1) => {
    const d = docRef.current!
    const L = d.layers.find(l => l.id === id)
    if (!L) return
    const sibs = d.layers.filter(l => (l.parent ?? null) === (L.parent ?? null))
    const n = sibs[sibs.indexOf(L) + dir]
    if (!n) return
    apply(dir > 0 ? "Move up" : "Move down", dd => {
      const layers = dd.layers.filter(l => l.id !== id)
      const ni = layers.findIndex(l => l.id === n.id)
      layers.splice(dir > 0 ? ni + 1 : ni, 0, L)
      return { ...dd, layers: normalizeLayers(layers) }
    })
  }
  const pickLayer = (id: string, range: boolean) => {
    const d = docRef.current
    if (!d) return
    setPicked(prev => {
      const next = new Set(prev)
      if (range && selectedIdRef.current) {
        // Shift: everything between the selected layer and this one, as listed
        const order = [...d.layers].reverse().map(l => l.id)
        const a = order.indexOf(selectedIdRef.current), b = order.indexOf(id)
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!selectedIdRef.current) setSelectedId(id)
  }
  const pickedRef = useRef(picked); pickedRef.current = picked
  const flattenAll = () => {
    const d = docRef.current!
    if (d.layers.length < 2) return
    const pix = flatten({ ...d, background: null }, rts.current, false)
    const layer = rasterLayer("Flattened", pix)
    apply("Flatten", dd => { rts.current.set(layer.id, { pix }); return { ...dd, layers: [layer] } })
    setSelectedId(layer.id); setMaskEdit(false)
  }
  const layerPatch = (label: string, fn: (l: StudioLayer, d: StudioDoc) => Partial<StudioLayer>) => {
    const lid = selectedIdRef.current
    if (!lid) return
    apply(label, d => ({ ...d, layers: d.layers.map(l => (l.id === lid ? { ...l, ...fn(l, d) } : l)) }))
  }
  const fitLayer = (mode: "fit" | "fill") => layerPatch(mode === "fit" ? "Fit to canvas" : "Fill canvas", (l, d) => {
    const k = mode === "fit" ? Math.min(d.width / l.w, d.height / l.h) : Math.max(d.width / l.w, d.height / l.h)
    const w = l.w * k, h = l.h * k
    return { w, h, x: (d.width - w) / 2, y: (d.height - h) / 2, rotation: 0, ...(l.kind === "text" && l.text ? { text: { ...l.text, size: l.text.size * k } } : {}) }
  })
  const addMask = (from: "reveal" | "hide" | "selection") => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur) return
    const { w, h } = contentSize(cur)
    let m = newCanvas(w, h)
    if (from === "reveal") { const x = ctx2d(m); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h) }
    if (from === "selection" && sel.current.canvas) m = canvasMaskToLayer(sel.current.canvas, cur, w, h)
    rtOf(cur.id).mask = m
    layerPatch("Add mask", () => ({ mask: { src: null, enabled: true, mw: w, mh: h } }))
    setMaskEdit(from !== "selection")
  }
  const applyMask = () => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    const rt = cur ? rtOf(cur.id) : null
    if (!cur || cur.kind !== "raster" || !rt?.pix || !rt.mask) return
    const work = copyCanvas(rt.pix), x = ctx2d(work)
    x.globalCompositeOperation = "destination-in"; x.drawImage(rt.mask, 0, 0, work.width, work.height)
    rt.pix = work; rt.mask = undefined; rt.content = undefined
    layerPatch("Apply mask", () => ({ mask: null }))
    setMaskEdit(false)
  }
  const deleteMask = () => { const cur = selectedIdRef.current; if (!cur) return; rtOf(cur).mask = undefined; layerPatch("Delete mask", () => ({ mask: null })); setMaskEdit(false) }
  const toggleMask = () => layerPatch("Toggle mask", l => ({ mask: l.mask ? { ...l.mask, enabled: !l.mask.enabled } : l.mask }))
  const rasterize = () => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur || (cur.kind !== "text" && cur.kind !== "shape")) return
    const { w, h } = contentSize(cur)
    const pix = newCanvas(w, h), x = ctx2d(pix)
    if (cur.kind === "text" && cur.text) drawText(x, cur.text, w, h)
    if (cur.kind === "shape" && cur.shape) drawShape(x, cur.shape, w, h)
    rtOf(cur.id).pix = pix
    rtOf(cur.id).content = undefined
    layerPatch("Rasterize", () => ({ kind: "raster", src: null, pw: w, ph: h, text: undefined, shape: undefined }))
  }
  const setText = (patch: Partial<TextProps>) => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur?.text) return
    const t = { ...cur.text, ...patch }
    // The box follows the text, around its centre
    const m = measureText(t)
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2
    patchLayer(cur.id, { text: t, w: m.w, h: m.h, x: cx - m.w / 2, y: cy - m.h / 2, name: t.text.split("\n")[0].slice(0, 30) || "Text" })
  }
  const setShape = (patch: Partial<ShapeProps>) => {
    const cur = docRef.current?.layers.find(l => l.id === selectedIdRef.current)
    if (!cur?.shape) return
    patchLayer(cur.id, { shape: { ...cur.shape, ...patch } })
  }

  // ── canvas actions ──
  const resizeImage = (w: number, h: number) => {
    const d = docRef.current!
    w = Math.min(MAX_CANVAS_SIDE, Math.max(16, w)); h = Math.min(MAX_CANVAS_SIDE, Math.max(16, h))
    const sx = w / d.width, sy = h / d.height
    apply("Image size", dd => ({ ...dd, width: w, height: h, layers: dd.layers.map(l => ({ ...l, x: l.x * sx, y: l.y * sy, w: l.w * sx, h: l.h * sy, ...(l.text ? { text: { ...l.text, size: l.text.size * Math.sqrt(sx * sy) } } : {}) })) }))
    setSelection(null)
    requestAnimationFrame(() => fitView())
  }
  const canvasSize = (w: number, h: number, ax: number, ay: number) => {
    const d = docRef.current!
    w = Math.min(MAX_CANVAS_SIDE, Math.max(16, w)); h = Math.min(MAX_CANVAS_SIDE, Math.max(16, h))
    const dx = (w - d.width) * ax, dy = (h - d.height) * ay
    apply("Canvas size", dd => ({ ...dd, width: w, height: h, layers: dd.layers.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })) }))
    setSelection(null)
    requestAnimationFrame(() => fitView())
  }
  const rotateCanvas = (dir: 1 | -1) => {
    apply(dir > 0 ? "Rotate canvas right" : "Rotate canvas left", d => ({
      ...d, width: d.height, height: d.width,
      layers: d.layers.map(l => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2
        const [nx, ny] = dir > 0 ? [d.height - cy, cx] : [cy, d.width - cx]
        return { ...l, x: nx - l.w / 2, y: ny - l.h / 2, rotation: l.rotation + 90 * dir }
      }),
    }))
    setSelection(null)
    requestAnimationFrame(() => fitView())
  }
  const flipCanvas = (axis: "x" | "y") => {
    apply(axis === "x" ? "Flip canvas horizontally" : "Flip canvas vertically", d => ({
      ...d,
      layers: d.layers.map(l => axis === "x"
        ? { ...l, x: d.width - l.x - l.w, rotation: -l.rotation, flipX: !l.flipX }
        : { ...l, y: d.height - l.y - l.h, rotation: -l.rotation, flipY: !l.flipY }),
    }))
    setSelection(null)
  }

  // ── AI ──
  const runAi = async (op: "select" | "subject" | "remove-bg") => {
    const d = docRef.current
    if (!d || aiBusy) return
    if (op === "select" && !aiPrompt.trim() && !aiPoints.length && !aiBox) { flash("Describe it, click on it or drag a box around it first", true); return }
    const cur = d.layers.find(l => l.id === selectedIdRef.current)
    if (op === "remove-bg" && (!cur || cur.kind === "group" || cur.kind === "adjust")) { flash("Pick the layer to cut out", true); return }
    setAiBusy(op)
    try {
      // What the model sees: the layer alone for background removal, else the whole picture
      let src = op === "remove-bg" && cur ? layerInCanvasSpace(d, cur, rtOf(cur.id)) : flatten(d, rts.current, true)
      if (op === "remove-bg") { const b = newCanvas(src.width, src.height), bx = ctx2d(b); bx.fillStyle = "#fff"; bx.fillRect(0, 0, b.width, b.height); bx.drawImage(src, 0, 0); src = b }
      let small = fitWithin(src, 2048)
      let dataUrl = small.toDataURL("image/jpeg", 0.9)
      if (dataUrl.length > 3_800_000) { small = fitWithin(src, 1400); dataUrl = small.toDataURL("image/jpeg", 0.85) }
      const k = small.width / d.width
      const r = await fetch("/api/employees/image-studio/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: op === "select" ? "select" : "subject", image: dataUrl,
          ...(op === "select" ? {
            prompt: aiPrompt.trim() || undefined,
            points: aiPoints.map(q => ({ x: q.x * k, y: q.y * k, label: q.label })),
            box: aiBox ? [aiBox.x * k, aiBox.y * k, (aiBox.x + aiBox.w) * k, (aiBox.y + aiBox.h) * k] : undefined,
          } : {}),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
      if (!r.ok || !j.mask) throw new Error(j.error || "The AI selection failed")
      const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not read the mask")); im.src = j.mask })
      const m = selectionFromMaskImage(img, d.width, d.height)
      if (op === "remove-bg" && cur) {
        // Non-destructive: the background is masked out, not deleted
        const { w, h } = contentSize(cur)
        rtOf(cur.id).mask = canvasMaskToLayer(m, cur, w, h)
        layerPatch("Remove background", () => ({ mask: { src: null, enabled: true, mw: w, mh: h } }))
        flash("Background removed with a mask - paint the mask to fix any edges")
      } else {
        commitSelection(m, null, selMode)
        setAiPoints([]); setAiBox(null)
        flash(op === "subject" ? "Subject selected" : "Selected")
      }
    } catch (e: any) {
      flash(String(e?.message || e), true)
    } finally {
      setAiBusy(null)
    }
  }

  // ── generative tools (Phase 2) ──
  /** One run of a generative tool on the server: its result, or an error with the server's words. */
  const postGen = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/employees/image-studio/${id}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
    if (!r.ok || !j.url) throw new Error(j.error || "The AI tool failed")
    return j as { url: string; width: number; height: number; tickets: number }
  }
  /** Any transparency at all? (sampled small - it only decides PNG over JPEG and whether to restore alpha) */
  const hasAlpha = (c: HTMLCanvasElement) => {
    const s = fitWithin(c, 256), p = ctx2d(s).getImageData(0, 0, s.width, s.height).data
    for (let i = 3; i < p.length; i += 4) if (p[i] < 250) return true
    return false
  }
  const onWhite = (c: HTMLCanvasElement) => { const o = newCanvas(c.width, c.height), x = ctx2d(o); x.fillStyle = "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0); return o }
  const addOnTop = (d: StudioDoc, layer: StudioLayer, rt: Runtime): StudioDoc => { rts.current.set(layer.id, rt); return { ...d, layers: [...d.layers, layer] } }
  const roomForLayer = () => {
    if ((docRef.current?.layers.length ?? 0) < MAX_LAYERS) return true
    flash(`Up to ${MAX_LAYERS} layers - merge or delete some first`, true)
    return false
  }
  const paidNote = (t: number) => (t ? ` · ${t} ticket${t === 1 ? "" : "s"}` : "")

  const runGen = async (req: GenRequest) => {
    const d = docRef.current
    if (!d || aiBusy) return
    // Everything but a layer upscale adds a layer: check before paying for it
    if (!(req.op === "upscale" && req.target === "layer") && !roomForLayer()) return
    setAiBusy(req.op === "upscale" ? `upscale-${req.target}` : req.op)
    try {
      if (req.op === "fill" || req.op === "erase") {
        const S = sel.current.canvas
        const b = S ? selectionBounds(S) : null
        if (!S || !b) throw new Error("Make a selection first")
        // The selection's box with room around it, sent at the size the model works best at
        const R = fillRegion(b, d.width, d.height)
        const regionSel = newCanvas(R.w, R.h); ctx2d(regionSel).drawImage(S, -R.x, -R.y)
        // Grown, so the model also repaints the soft edge (and a removed object's outline)
        const grown = growMask(regionSel, req.op === "erase" ? Math.max(6, Math.round(Math.max(R.w, R.h) * 0.012)) : Math.max(2, Math.round(Math.max(R.w, R.h) * 0.004)))
        const img = newCanvas(R.sw, R.sh), ix = ctx2d(img)
        ix.fillStyle = "#fff"; ix.fillRect(0, 0, R.sw, R.sh)
        ix.drawImage(flatten(d, rts.current, true), R.x, R.y, R.w, R.h, 0, 0, R.sw, R.sh)
        // The mask: white where the model paints, black where it keeps
        const white = newCanvas(R.sw, R.sh), wx = ctx2d(white)
        wx.drawImage(grown, 0, 0, R.sw, R.sh); wx.globalCompositeOperation = "source-in"; wx.fillStyle = "#fff"; wx.fillRect(0, 0, R.sw, R.sh)
        const mk = newCanvas(R.sw, R.sh), mx = ctx2d(mk)
        mx.fillStyle = "#000"; mx.fillRect(0, 0, R.sw, R.sh); mx.drawImage(white, 0, 0)
        const [image, mask] = await Promise.all([putBlob("ai", await toBlob(img, "image/jpeg", 0.95)), putBlob("ai", await toBlob(mk, "image/png"))])
        const j = await postGen({ op: req.op, image, mask, ...(req.op === "fill" ? { prompt: req.prompt } : {}) })
        const pix = await loadToCanvas(j.url, MAX_CANVAS_SIDE)
        uploaded.current.set(pix, j.url)
        // A new layer over the region, masked to the selection with its edge softened a touch -
        // only what was selected changes, and the mask can be painted to blend it further
        const m = newCanvas(pix.width, pix.height)
        ctx2d(m).drawImage(featherSelection(grown, Math.max(1, Math.round(Math.max(R.w, R.h) * 0.003))), 0, 0, pix.width, pix.height)
        const layer: StudioLayer = {
          ...rasterLayer(req.op === "fill" ? `Fill: ${req.prompt.slice(0, 28)}` : "Object removed", pix, { x: R.x, y: R.y, w: R.w, h: R.h }),
          mask: { src: null, enabled: true, mw: pix.width, mh: pix.height },
        }
        apply(req.op === "fill" ? "Generative fill" : "Remove object", dd => addOnTop(dd, layer, { pix, mask: m }))
        setSelectedId(layer.id); setMaskEdit(false)
        flash(`${req.op === "fill" ? "Filled" : "Removed"} - a new layer, masked to the selection${paidNote(j.tickets)}`)
      } else if (req.op === "upscale") {
        const cur = d.layers.find(l => l.id === selectedIdRef.current)
        const src = req.target === "canvas" ? flatten(d, rts.current, true) : cur?.kind === "raster" ? rtOf(cur.id).pix : undefined
        if (!src) throw new Error("Pick an image layer to upscale")
        const alpha = hasAlpha(src)
        const image = await putBlob("ai", alpha ? await toBlob(src, "image/png") : await toBlob(src, "image/jpeg", 0.95))
        const j = await postGen({ op: "upscale", image, upscaler: req.upscaler, factor: req.factor, maxSide: req.target === "canvas" ? MAX_CANVAS_SIDE : UPSCALE_MAX_SIDE })
        const up = await loadToCanvas(j.url, UPSCALE_MAX_SIDE)
        // The upscalers return an opaque picture: the source's transparency goes back on
        if (alpha) { const x = ctx2d(up); x.globalCompositeOperation = "destination-in"; x.drawImage(src, 0, 0, up.width, up.height); x.globalCompositeOperation = "source-over" }
        else uploaded.current.set(up, j.url)
        if (req.target === "layer" && cur) {
          // Same place and size, more pixels (a mask keeps its own size - it is drawn scaled)
          const rt = rtOf(cur.id); rt.pix = up; rt.content = undefined
          layerPatch("AI upscale layer", () => ({ src: null, pw: up.width, ph: up.height }))
        } else {
          // The canvas grows; the upscaled picture is the new top layer and the old ones are hidden under it
          const W = Math.min(MAX_CANVAS_SIDE, up.width), H = Math.min(MAX_CANVAS_SIDE, up.height)
          const sx = W / d.width, sy = H / d.height
          const layer = rasterLayer(`Upscaled ${Math.round(sx * 10) / 10}×`, up, { x: 0, y: 0, w: W, h: H })
          apply("AI upscale", dd => addOnTop({
            ...dd, width: W, height: H,
            layers: dd.layers.map(l => ({ ...l, visible: false, x: l.x * sx, y: l.y * sy, w: l.w * sx, h: l.h * sy, ...(l.text ? { text: { ...l.text, size: l.text.size * Math.sqrt(sx * sy) } } : {}) })),
          }, layer, { pix: up }))
          setSelectedId(layer.id); setMaskEdit(false); setSelection(null)
          requestAnimationFrame(() => fitView())
        }
        flash(`Upscaled to ${up.width}×${up.height}${paidNote(j.tickets)}`)
      } else if (req.op === "edit") {
        const cur = d.layers.find(l => l.id === selectedIdRef.current)
        const content = cur ? layerContent(cur, rtOf(cur.id)) : null
        if (!cur || !content) throw new Error("Pick a layer to edit")
        const image = await putBlob("ai", await toBlob(fitWithin(content, 4096), "image/png"))
        const j = await postGen({ op: "edit", image, prompt: req.prompt, model: req.model, quality: req.quality, aspect: editAspect(req.model, cur.w, cur.h) })
        let pix = await loadToCanvas(j.url, MAX_CANVAS_SIDE)
        // The edit takes the original's exact place. A model that returned another shape (some
        // have no size for a 21:9 frame, or follow the reference's own) is cropped to it, centred
        const ar = pix.width / pix.height, boxAr = cur.w / cur.h
        if (Math.abs(Math.log(ar / boxAr)) > 0.02) {
          const cw = ar > boxAr ? Math.round(pix.height * boxAr) : pix.width, ch = ar > boxAr ? pix.height : Math.round(pix.width / boxAr)
          const crop = newCanvas(cw, ch)
          ctx2d(crop).drawImage(pix, (pix.width - cw) / 2, (pix.height - ch) / 2, cw, ch, 0, 0, cw, ch)
          pix = crop
        } else uploaded.current.set(pix, j.url)
        // The original is hidden, not lost
        const layer: StudioLayer = {
          ...rasterLayer(`AI edit: ${req.prompt.slice(0, 24)}`, pix, { x: cur.x, y: cur.y, w: cur.w, h: cur.h }),
          rotation: cur.rotation, flipX: cur.flipX, flipY: cur.flipY, blend: cur.blend, opacity: cur.opacity,
        }
        // Same box, so the original's mask fits it as is (shared - pixels are never edited in place)
        const curMask = cur.mask ? rtOf(cur.id).mask : undefined
        if (cur.mask && curMask) layer.mask = { ...cur.mask, src: null }
        apply("AI edit", dd => {
          const nd = insertLayer(dd, layer, { pix, mask: curMask })
          return { ...nd, layers: nd.layers.map(l => (l.id === cur.id ? { ...l, visible: false } : l)) }
        })
        setSelectedId(layer.id); setMaskEdit(false)
        flash(`Edited - the original layer is hidden below it${paidNote(j.tickets)}`)
      } else {
        let image: string | undefined
        if (req.ref === "canvas") image = await putBlob("ai", await toBlob(fitWithin(onWhite(flatten(d, rts.current, true)), 4096), "image/jpeg", 0.92))
        if (req.ref === "layer") {
          const cur = d.layers.find(l => l.id === selectedIdRef.current)
          const c = cur ? layerContent(cur, rtOf(cur.id)) : null
          if (c) image = await putBlob("ai", await toBlob(fitWithin(c, 4096), "image/png"))
        }
        const j = await postGen({ op: "generate", prompt: req.prompt, model: req.model, quality: req.quality, aspect: req.aspect, ...(image ? { image } : {}) })
        const pix = await loadToCanvas(j.url, MAX_CANVAS_SIDE)
        uploaded.current.set(pix, j.url)
        // Fitted to the canvas, centred
        const dd0 = docRef.current ?? d
        const k = Math.min(dd0.width / pix.width, dd0.height / pix.height)
        const w = pix.width * k, h = pix.height * k
        const layer = rasterLayer(req.prompt.slice(0, 32), pix, { x: (dd0.width - w) / 2, y: (dd0.height - h) / 2, w, h })
        apply("Generate layer", dd => insertLayer(dd, layer, { pix }))
        setSelectedId(layer.id); setMaskEdit(false)
        flash(`Generated - a new layer${paidNote(j.tickets)}`)
      }
    } catch (e: any) {
      flash(String(e?.message || e), true)
    } finally {
      setAiBusy(null)
    }
  }

  /** The crop frame reaches past the canvas: there is new space a generative expand can fill. */
  const cropOutside = (c: Rect | null, d: StudioDoc | null) => !!c && !!d && (c.x < -0.5 || c.y < -0.5 || c.x + c.w > d.width + 0.5 || c.y + c.h > d.height + 0.5)
  const expandCrop = async () => {
    const d = docRef.current, c = cropRef.current
    if (!d || !c || aiBusy) return
    if (!cropOutside(c, d)) { flash("Drag the crop frame past the edge of the canvas first", true); return }
    if (!roomForLayer()) return
    const CW = Math.round(Math.min(MAX_CANVAS_SIDE, c.w)), CH = Math.round(Math.min(MAX_CANVAS_SIDE, c.h))
    // The part of the picture the frame keeps (it can cut one side and grow another)
    const ix0 = Math.max(0, c.x), iy0 = Math.max(0, c.y), ix1 = Math.min(d.width, c.x + c.w), iy1 = Math.min(d.height, c.y + c.h)
    if (ix1 - ix0 < 8 || iy1 - iy0 < 8) { flash("The frame has to keep part of the picture", true); return }
    // Bria takes less than 5000 x 5000: a bigger frame is sent smaller and the result scaled back up
    const k = Math.min(1, EXPAND_MAX_SIDE / Math.max(CW, CH), Math.sqrt(EXPAND_MAX_PIXELS / (CW * CH)))
    const kw = Math.round(CW * k), kh = Math.round(CH * k)
    const iw = Math.max(8, Math.min(kw, Math.round((ix1 - ix0) * k))), ih = Math.max(8, Math.min(kh, Math.round((iy1 - iy0) * k)))
    const ax = Math.max(0, Math.min(kw - iw, Math.round((ix0 - c.x) * k))), ay = Math.max(0, Math.min(kh - ih, Math.round((iy0 - c.y) * k)))
    setAiBusy("expand")
    try {
      const img = newCanvas(iw, ih), x = ctx2d(img)
      x.fillStyle = "#fff"; x.fillRect(0, 0, iw, ih)
      x.drawImage(flatten(d, rts.current, true), ix0, iy0, ix1 - ix0, iy1 - iy0, 0, 0, iw, ih)
      const image = await putBlob("ai", await toBlob(img, "image/jpeg", 0.95))
      const j = await postGen({ op: "expand", image, prompt: expandPrompt.trim() || undefined, expand: { canvas: [kw, kh], at: [ax, ay] } })
      const pix = await loadToCanvas(j.url, MAX_CANVAS_SIDE)
      uploaded.current.set(pix, j.url)
      // The expansion goes UNDER the layers, which keep their pixels - it only shows in the new space
      const layer = rasterLayer("Generative expand", pix, { x: 0, y: 0, w: CW, h: CH })
      apply("Generative expand", dd => {
        rts.current.set(layer.id, { pix })
        return { ...dd, width: CW, height: CH, layers: [layer, ...dd.layers.map(l => ({ ...l, x: l.x - c.x, y: l.y - c.y }))] }
      })
      setSelection(null); setSelectedId(layer.id); setMaskEdit(false)
      setCrop({ x: 0, y: 0, w: CW, h: CH })
      requestAnimationFrame(() => fitView())
      flash(`Expanded to ${CW}×${CH} - the new area is a layer under the others${paidNote(j.tickets)}`)
    } catch (e: any) {
      flash(String(e?.message || e), true)
    } finally {
      setAiBusy(null)
    }
  }

  // ── inline Apply (the popup) ──
  const [confirmClose, setConfirmClose] = useState(false)
  const applyInline = async () => {
    const d = docRef.current
    if (!d || !onApply || busy) return
    // A crop frame left on the canvas is what the user means: apply it first
    if (toolRef.current === "crop") {
      const c = cropRef.current
      if (c && (Math.abs(c.x) > 0.5 || Math.abs(c.y) > 0.5 || Math.abs(c.w - d.width) > 0.5 || Math.abs(c.h - d.height) > 0.5)) applyCrop()
      setToolState("move")
    }
    setBusy("apply")
    try {
      await new Promise(r => requestAnimationFrame(r))
      await onApply(flatten(docRef.current!, rts.current, true), serialize)
    } catch (e: any) {
      flash(String(e?.message || e || "Could not apply"), true)
    } finally {
      setBusy(null)
    }
  }

  // ── export ──
  const download = (blob: Blob, name: string) => {
    const u = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 4000)
  }
  const safeName = () => (title || "canvas").replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-") || "canvas"
  const exportAs = async (what: "png" | "jpeg" | "webp" | "refs" | "replace" | "feed") => {
    const d = docRef.current
    if (!d) return
    setExportOpen(false)
    setBusy(what)
    try {
      const transparent = what === "png" || what === "webp" || what === "refs" || what === "feed"
      const flat = flatten(d, rts.current, true)
      // JPEG has no transparency: put it on white (or the background colour)
      let out = flat
      if (!transparent && !d.background) { out = newCanvas(d.width, d.height); const x = ctx2d(out); x.fillStyle = "#fff"; x.fillRect(0, 0, d.width, d.height); x.drawImage(flat, 0, 0) }
      void transparent
      if (what === "png" || what === "jpeg" || what === "webp") {
        download(await toBlob(out, `image/${what}`, what === "png" ? undefined : 0.94), `${safeName()}.${what === "jpeg" ? "jpg" : what}`)
      } else if (what === "refs") {
        await onSaveToRefs(new File([await toBlob(out, "image/png")], `${safeName()}.png`, { type: "image/png" }))
        flash("Saved to your Refs")
      } else if (what === "replace" && sourceRefId && onReplaceRef) {
        await onReplaceRef(String(sourceRefId), out.toDataURL("image/png"))
        flash("The original reference was updated")
      } else if (what === "feed") {
        await save()
        const url = await putBlob("export", await toBlob(out, "image/png"))
        const r = await fetch(`/api/employees/image-studio/${id}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not save it")
        flash("Saved to My Generations › Image Studio")
      }
    } catch (e: any) {
      flash(String(e?.message || e), true)
    } finally {
      setBusy(null)
    }
  }

  // ── files and refs as new layers ──
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files).slice(0, 10)) {
      try { addPixelsAsLayer(await fileToCanvas(f), f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Image") } catch (e: any) { flash(String(e?.message || e), true) }
    }
    if (fileRef.current) fileRef.current.value = ""
  }
  const addRef = async (u: string) => {
    setRefPicker(false)
    try { addPixelsAsLayer(await loadToCanvas(u, MAX_CANVAS_SIDE), "Reference", u) } catch (e: any) { flash(String(e?.message || e), true) }
  }
  // Paste an image from the clipboard as a new layer
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith("image/"))
      const f = item?.getAsFile()
      if (!f) return
      e.preventDefault()
      try { addPixelsAsLayer(await fileToCanvas(f), "Pasted") } catch (er: any) { flash(String(er?.message || er), true) }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── keyboard ──
  const setTool = (t: Tool) => { setToolState(t); if (t !== "ai") { setAiPoints([]); setAiBox(null) } }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey
      if (e.code === "Space" && !e.repeat) { setSpaceDown(true); e.preventDefault(); return }
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && k === "y") { e.preventDefault(); redo(); return }
      if (mod && k === "s") { e.preventDefault(); void save(); return }
      if (mod && k === "a") { e.preventDefault(); selectAll(); return }
      if (mod && k === "d") { e.preventDefault(); deselect(); return }
      if (mod && e.shiftKey && k === "i") { e.preventDefault(); invertSel(); return }
      if (mod && k === "j") { e.preventDefault(); if (canUseLayers) copyToLayer(e.shiftKey); return }
      if (mod && k === "g") { e.preventDefault(); if (!canUseLayers) return; if (e.shiftKey) ungroup(); else groupLayers(); return }
      if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(1.25); return }
      if (mod && k === "-") { e.preventDefault(); zoomAt(0.8); return }
      if (mod && k === "0") { e.preventDefault(); fitView(); return }
      if (mod && k === "1") { e.preventDefault(); actualSize(); return }
      if (mod) return
      if (k === "delete" || k === "backspace") { e.preventDefault(); deleteSelected(); return }
      if (k === "escape") { if (toolRef.current === "crop") setTool("move"); else if (sel.current.canvas) deselect(); setAiPoints([]); setAiBox(null); return }
      if (k === "enter" && toolRef.current === "crop") { applyCrop(); return }
      if (k === "enter" && toolRef.current === "ai") { void runAi("select"); return }
      if (k === "[") { setSize(s => Math.max(1, Math.round(s / 1.2))); return }
      if (k === "]") { setSize(s => Math.min(2000, Math.round(s * 1.2))); return }
      if (k === "x") { setFg(bgRef.current); setBg(fgRef.current); return }
      if (k === "d") { setFg("#ffffff"); setBg("#000000"); return }
      if (k.startsWith("arrow") && toolRef.current === "move" && selectedIdRef.current) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0, dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0
        const dd = docRef.current!
        const cur = dd.layers.find(l => l.id === selectedIdRef.current)
        if (cur?.kind === "group") {
          patchMany(new Map(dd.layers.filter(l => l.parent === cur.id && !l.locked).map(l => [l.id, { x: l.x + dx, y: l.y + dy }])))
          pushHistory("Nudge group")
        } else layerPatch("Nudge", l => ({ x: l.x + dx, y: l.y + dy }))
        return
      }
      const map: Record<string, Tool> = { v: "move", m: "marquee", l: "lasso", w: "ai", c: "crop", b: "brush", e: "eraser", r: "blur", t: "text", u: "shape", i: "eyedropper", h: "hand" }
      if (k === "g") { setTool(e.shiftKey ? "gradient" : "fill"); return }
      if (k === "m" && toolRef.current === "marquee") { setMarquee(m => (m === "rect" ? "ellipse" : "rect")); return }
      if (map[k]) setTool(map[k])
    }
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false) }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
  })

  // ── render ──
  const aiCost = STUDIO_AI_TICKETS.select
  // What a fill of the current selection costs (by the size of the region it sends)
  const selBox = useMemo(() => (sel.current.canvas ? selectionBounds(sel.current.canvas) : null), [selVersion])  // eslint-disable-line react-hooks/exhaustive-deps
  const fillCost = selBox && doc ? (() => { const R = fillRegion(selBox, doc.width, doc.height); return fillTickets(R.sw, R.sh) })() : null
  const openAiPanel = () => { setPanel("ai"); setPanelOpen(true) }
  const cursorCss = spaceDown || tool === "hand" ? "grab" : tool === "move" ? "default" : tool === "text" ? "text" : ["brush", "eraser", "blur"].includes(tool) ? "none" : "crosshair"
  const selLayer = L
  const painting = ["brush", "eraser", "blur", "fill", "gradient"].includes(tool)

  if (loadError) return <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-slate-300"><p>{loadError}</p><button onClick={onExit} className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5">Back</button></div>
  if (!doc) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" size={22} /></div>

  const optionsBar = (
    <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] px-3 py-1.5 text-[11px] text-slate-300 min-h-[38px]">
      <span className="shrink-0 font-semibold text-slate-100">{TOOLS.find(t => t.id === tool)?.label}</span>
      {(tool === "brush" || tool === "eraser" || tool === "blur") && (
        <>
          <Inline label="Size"><input type="range" min={1} max={600} value={size} onChange={e => setSize(Number(e.target.value))} className="w-28 accent-slate-200" /><span className="w-10 font-mono text-right">{size}</span></Inline>
          <Inline label="Hardness"><input type="range" min={0} max={100} value={Math.round(hardness * 100)} onChange={e => setHardness(Number(e.target.value) / 100)} className="w-20 accent-slate-200" /></Inline>
          <Inline label="Opacity"><input type="range" min={1} max={100} value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)} className="w-20 accent-slate-200" /><span className="w-8 font-mono">{Math.round(opacity * 100)}%</span></Inline>
          {tool === "blur" && <>
            <Seg value={blurMode} options={[["blur", "Blur"], ["sharpen", "Sharpen"]]} onChange={v => setBlurMode(v as any)} />
            <Inline label="Strength"><input type="range" min={1} max={50} value={strength} onChange={e => setStrength(Number(e.target.value))} className="w-20 accent-slate-200" /></Inline>
          </>}
          {maskEdit && selLayer?.mask && <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-200">Painting the mask: {tool === "brush" ? "brush hides" : tool === "eraser" ? "eraser reveals" : "blur softens its edge"}</span>}
        </>
      )}
      {tool === "fill" && <>
        <Inline label="Tolerance"><input type="range" min={0} max={255} value={tolerance} onChange={e => setTolerance(Number(e.target.value))} className="w-24 accent-slate-200" /><span className="w-8 font-mono">{tolerance}</span></Inline>
        <Inline label="Opacity"><input type="range" min={1} max={100} value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)} className="w-20 accent-slate-200" /></Inline>
        <span className="shrink-0 text-slate-500">Click to fill (Alt: background colour) · inside a selection fills the selection</span>
      </>}
      {tool === "gradient" && <>
        <Seg value={gradKind} options={[["linear", "Linear"], ["radial", "Radial"]]} onChange={v => setGradKind(v as any)} />
        <Seg value={gradTo} options={[["bg", "To background"], ["transparent", "To transparent"]]} onChange={v => setGradTo(v as any)} />
        <span className="shrink-0 text-slate-500">Drag across the canvas</span>
      </>}
      {(tool === "marquee" || tool === "lasso" || tool === "ai") && (
        <>
          {tool === "marquee" && <Seg value={marquee} options={[["rect", "Rectangle"], ["ellipse", "Ellipse"]]} onChange={v => setMarquee(v as any)} />}
          <Seg value={selMode} options={[["new", "New"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]]} onChange={v => setSelMode(v as SelMode)} />
        </>
      )}
      {tool === "ai" && (
        <>
          <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void runAi("select") }} placeholder="Describe it (or click it / drag a box)…" className="w-56 shrink-0 rounded-md bg-black/40 border border-white/15 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-white/40" />
          <AiButton inline primary size="xs" busy={aiBusy === "select"} disabled={!!aiBusy} onClick={() => runAi("select")} cost={aiCost}
            model={aiPrompt.trim() || aiBox ? "SAM 3.1" : aiPoints.length ? "SAM 2" : "SAM 3.1 / SAM 2"}
            title="Describe it (SAM 3.1), drag a box (SAM 3.1) or just click it (SAM 2)">Select</AiButton>
          <AiButton inline size="xs" busy={aiBusy === "subject"} disabled={!!aiBusy} onClick={() => runAi("subject")} cost={STUDIO_AI_TICKETS.subject} model="BiRefNet v2">Subject</AiButton>
          {(aiPoints.length > 0 || aiBox) && <button onClick={() => { setAiPoints([]); setAiBox(null) }} className="shrink-0 text-slate-400 hover:text-white">Clear clicks ({aiPoints.length}{aiBox ? " + box" : ""})</button>}
          <span className="shrink-0 text-slate-500">Click = keep · Alt+click = not this · drag = box</span>
        </>
      )}
      {tool === "crop" && (
        <>
          <Seg value={cropAspect} options={CROP_ASPECTS as any} onChange={setCropAspect} />
          <button onClick={applyCrop} className="shrink-0 flex items-center gap-1 rounded-md bg-white/15 border border-white/30 px-2 py-1 font-semibold text-white hover:bg-white/20"><Check size={12} /> Apply (Enter)</button>
          <button onClick={() => setCrop(doc ? { x: 0, y: 0, w: doc.width, h: doc.height } : null)} className="shrink-0 text-slate-400 hover:text-white">Reset</button>
          {cropOutside(crop, doc) ? (
            <>
              <input value={expandPrompt} onChange={e => setExpandPrompt(e.target.value)} placeholder="The new space (optional)…" className="w-44 shrink-0 rounded-md bg-black/40 border border-white/15 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-white/40" />
              <AiButton inline primary size="xs" busy={aiBusy === "expand"} disabled={!!aiBusy} onClick={() => void expandCrop()} cost={EXPAND_TICKETS} model="Bria Expand">Generative expand</AiButton>
              <span className="shrink-0 text-slate-500">or Apply to add empty space</span>
            </>
          ) : <span className="shrink-0 text-slate-500">Drag past the edge to add space - then Generative expand can fill it</span>}
        </>
      )}
      {tool === "shape" && <Seg value={shapeKind} options={[["rect", "Rectangle"], ["ellipse", "Ellipse"], ["line", "Line"], ["arrow", "Arrow"]]} onChange={v => setShapeKind(v as ShapeKind)} />}
      {tool === "move" && selLayer && <span className="shrink-0 text-slate-500">Drag to move · corners keep proportions (Shift frees them) · round knob rotates (Shift: 15°) · Alt: no snapping</span>}
      {tool === "eyedropper" && <span className="shrink-0 text-slate-500">Click to pick the foreground colour · Alt+click the background</span>}
      {tool === "text" && <span className="shrink-0 text-slate-500">Click to add text, or click a text layer to edit it</span>}
      {hasSel && !["crop"].includes(tool) && (
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <span className="text-slate-500">Selection:</span>
          <AiButton inline size="xs" busy={aiBusy === "fill"} disabled={!!aiBusy} onClick={() => { openAiPanel(); setFillFocus(f => f + 1) }} cost={fillCost ?? 0} model="FLUX.1 Pro Fill" title="Describe what goes in the selection (AI panel) - FLUX.1 Pro Fill">Generative fill</AiButton>
          <AiButton inline size="xs" busy={aiBusy === "erase"} disabled={!!aiBusy} onClick={() => void runGen({ op: "erase" })} cost={1} model="Bria Eraser" title="Remove what is selected and fill in behind it - Bria Eraser">Remove</AiButton>
          <MiniBtn onClick={invertSel} title="Invert (Ctrl+Shift+I)">Invert</MiniBtn>
          <span className="flex items-center gap-1"><MiniBtn onClick={featherSel} title="Soften the edge">Feather</MiniBtn><input type="number" value={feather} min={1} max={200} onChange={e => setFeather(Math.max(1, Number(e.target.value) || 1))} className="w-11 rounded bg-black/40 border border-white/10 px-1 font-mono text-[10.5px]" /></span>
          {canUseLayers && <MiniBtn onClick={() => copyToLayer(false)} title="Copy to a new layer (Ctrl+J)">Copy to layer</MiniBtn>}
          {canUseLayers && <MiniBtn onClick={() => copyToLayer(true)} title="Cut to a new layer (Ctrl+Shift+J)">Cut to layer</MiniBtn>}
          <MiniBtn onClick={keepSelected} title="Keep only the selection on this layer (transparent elsewhere)">Keep only</MiniBtn>
          <MiniBtn onClick={deleteSelected} title="Delete what is selected (Del)">Delete</MiniBtn>
          <MiniBtn onClick={fillSelection} title="Fill with the foreground colour">Fill</MiniBtn>
          {canUseLayers && <MiniBtn onClick={() => addMask("selection")} title="Mask the layer to the selection (non-destructive)">Mask</MiniBtn>}
          <MiniBtn onClick={cropToSelection} title="Crop the canvas to the selection">Crop</MiniBtn>
          <MiniBtn onClick={saveSelectionPng} title="Download the selected area as a transparent PNG">PNG</MiniBtn>
          <MiniBtn onClick={deselect} title="Deselect (Ctrl+D)"><X size={11} /></MiniBtn>
        </div>
      )}
    </div>
  )

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#060910] select-none">
      {/* ── top bar ── */}
      <div className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-white/[0.06] bg-[#0a0e18]">
        {inline ? (
          <>
            <button
              onClick={() => {
                // Edits would be lost: a second click within 3 seconds confirms
                if (histIdx.current > 0 && !confirmClose) { setConfirmClose(true); setTimeout(() => setConfirmClose(false), 3000); return }
                onExit()
              }}
              title="Close without applying"
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] ${confirmClose ? "bg-amber-400 text-black font-bold" : "text-slate-400 hover:text-white hover:bg-white/5"}`}
            ><X size={13} /> {confirmClose ? "Discard edits?" : <span className="hidden sm:inline">Close</span>}</button>
            <BrandTitle title={inline.title} eyebrow={`${doc.width}×${doc.height}${canUseLayers ? " · layers kept" : ""}`} logo={22} size="sm" />
          </>
        ) : (
          <>
            <button onClick={async () => { await save(); onExit() }} title="Back to your canvases" className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-white hover:bg-white/5"><ArrowLeft size={13} /> <span className="hidden sm:inline">Canvases</span></button>
            <input value={title} onChange={e => { setTitle(e.target.value); markDirty() }} className="min-w-0 w-40 sm:w-56 bg-transparent text-[13px] font-bold text-white focus:outline-none border-b border-transparent focus:border-white/20" />
            <span className="hidden md:inline text-[10px] font-mono text-slate-500">{doc.width}×{doc.height}</span>
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              {saveState === "saving" ? <><Loader2 size={10} className="animate-spin" /> saving</> : saveState === "error" ? <span className="text-red-400">not saved</span> : saveState === "dirty" ? "edited" : <><Check size={10} /> saved</>}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconBtn title={`Undo${canUndo ? `: ${history.current[histIdx.current]?.label}` : ""} (Ctrl+Z)`} onClick={undo} disabled={!canUndo}><Undo2 size={14} /></IconBtn>
          <IconBtn title={`Redo${canRedo ? `: ${history.current[histIdx.current + 1]?.label}` : ""} (Ctrl+Shift+Z)`} onClick={redo} disabled={!canRedo}><Redo2 size={14} /></IconBtn>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <IconBtn title="Zoom out (Ctrl -)" onClick={() => zoomAt(0.8)}><ZoomOut size={14} /></IconBtn>
          <button onClick={actualSize} title="Actual size (Ctrl+1)" className="w-12 text-center font-mono text-[10.5px] text-slate-300 hover:text-white">{Math.round(view.s * 100)}%</button>
          <IconBtn title="Zoom in (Ctrl +)" onClick={() => zoomAt(1.25)}><ZoomIn size={14} /></IconBtn>
          <IconBtn title="Fit to screen (Ctrl+0)" onClick={fitView}><Maximize2 size={14} /></IconBtn>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)} disabled={!!busy} title={inline ? "Download" : "Export"} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white ${inline ? "border border-white/15 hover:bg-white/10" : "bg-white/[0.12] border border-white/25 hover:bg-white/[0.18]"}`}>
              {busy && busy !== "apply" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {inline ? <span className="hidden sm:inline">Download</span> : "Export"}
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-60 rounded-xl border border-white/10 bg-[#0b0f19] p-1 shadow-2xl">
                <MenuItem onClick={() => exportAs("png")}>Download PNG <span className="text-slate-500">· keeps transparency</span></MenuItem>
                <MenuItem onClick={() => exportAs("jpeg")}>Download JPEG</MenuItem>
                <MenuItem onClick={() => exportAs("webp")}>Download WebP</MenuItem>
                {!inline && <>
                  <div className="my-1 border-t border-white/10" />
                  <MenuItem onClick={() => exportAs("refs")}>Save to my Refs <span className="text-slate-500">· as a new reference</span></MenuItem>
                  {sourceRefId && onReplaceRef && <MenuItem onClick={() => exportAs("replace")}>Update the original reference</MenuItem>}
                  <MenuItem onClick={() => exportAs("feed")}>Save to My Generations</MenuItem>
                </>}
              </div>
            )}
          </div>
          {extraActions}
          {inline && onApply && (
            <BrandButton primary size="sm" busy={busy === "apply"} disabled={!!busy || !!aiBusy} onClick={() => void applyInline()} title="Save the edit (Enter in no text box)">
              Apply
            </BrandButton>
          )}
          <IconBtn title="Show / hide the panels" onClick={() => setPanelOpen(o => !o)}><PanelRight size={14} /></IconBtn>
        </div>
      </div>
      <div className="shrink-0 border-b border-white/[0.06] bg-[#080c15]">{optionsBar}</div>

      <div className="flex-1 min-h-0 flex relative">
        {/* ── tools ── */}
        <div className="shrink-0 w-11 border-r border-white/[0.06] bg-[#080c15] flex flex-col items-center gap-0.5 py-2 overflow-y-auto [scrollbar-width:none]">
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${tool === t.id ? "bg-white/15 text-white ring-1 ring-white/30" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
              <t.icon size={15} />
            </button>
          ))}
          {/* foreground / background colours */}
          <div className="relative w-9 h-10 mt-2">
            <label title="Background colour" className="absolute right-0 bottom-0 w-6 h-6 rounded border border-white/40 cursor-pointer" style={{ background: bg }}>
              <input type="color" value={bg.length === 7 ? bg : "#000000"} onChange={e => setBg(e.target.value)} className="opacity-0 w-full h-full cursor-pointer" />
            </label>
            <label title="Foreground colour" className="absolute left-0 top-0 w-6 h-6 rounded border border-white/60 cursor-pointer shadow" style={{ background: fg }}>
              <input type="color" value={fg.length === 7 ? fg : "#ffffff"} onChange={e => setFg(e.target.value)} className="opacity-0 w-full h-full cursor-pointer" />
            </label>
          </div>
          <button onClick={() => { setFg(bg); setBg(fg) }} title="Swap colours (X)" className="text-slate-500 hover:text-white mt-1"><ArrowLeftRight size={12} /></button>
        </div>

        {/* ── the canvas ── */}
        <div
          ref={viewportRef}
          className="relative flex-1 min-w-0 overflow-hidden touch-none bg-[#05070c]"
          style={{ cursor: cursorCss }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { cursor.current = null; drawOverlay() }}
          onContextMenu={e => e.preventDefault()}
        >
          <canvas
            ref={stageRef}
            className="absolute top-0 left-0 origin-top-left shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]"
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
              imageRendering: view.s >= 2 ? "pixelated" : "auto",
              background: "repeating-conic-gradient(#262b36 0% 25%, #1a1e27 0% 50%) 0 0 / 16px 16px",
            }}
          />
          <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {notice && (
            <div className={`absolute left-1/2 -translate-x-1/2 bottom-4 z-20 max-w-[90%] rounded-lg border px-3 py-1.5 text-[11.5px] shadow-xl ${notice.bad ? "border-red-400/40 bg-red-950/90 text-red-100" : "border-white/15 bg-black/85 text-slate-100"}`}>{notice.text}</div>
          )}
        </div>

        {/* ── panels ── */}
        {panelOpen && (
          <div className="absolute right-0 top-0 bottom-0 z-20 w-[300px] lg:static lg:z-auto shrink-0 border-l border-white/[0.06] bg-[#0a0e18]/98 flex flex-col min-h-0">
            <div className="flex border-b border-white/[0.06]">
              {([["layers", "Layers", LayersIcon], ["adjust", "Adjust", SlidersHorizontal], ["canvas", "Canvas", Frame], ["ai", "AI", Sparkles]] as const).map(([k, label, Icon]) => (
                <button key={k} onClick={() => setPanel(k)} className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold ${panel === k ? "text-white border-b-2 border-white/70" : "text-slate-500 hover:text-white"}`}><Icon size={12} /> {label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3">
              {panel === "layers" && (
                <>
                  <LayersPanel
                    basic={!canUseLayers}
                    doc={doc} rts={rts.current} version={pixVersion} selectedId={selectedId} picked={picked} maskEdit={maskEdit}
                    onSelect={(lid, mask) => { setSelectedId(lid); setPicked(new Set()); setMaskEdit(!!mask && !!doc.layers.find(l => l.id === lid)?.mask) }}
                    onPick={pickLayer} onDropOn={dropOn} onStep={stepLayer}
                    onPatch={patchLayer} onCommit={pushHistory} onReorder={reorder} onAdd={addLayer}
                    actions={{
                      group: groupLayers, ungroup, moveOut: moveOutOfGroup, toggleCollapse,
                      duplicate: duplicateLayer, remove: removeLayer, mergeDown, flatten: flattenAll,
                      flip: axis => layerPatch(axis === "x" ? "Flip horizontally" : "Flip vertically", l => (axis === "x" ? { flipX: !l.flipX } : { flipY: !l.flipY })),
                      rotate90: dir => layerPatch("Rotate 90°", l => ({ rotation: l.rotation + 90 * dir })),
                      fit: fitLayer, center: () => layerPatch("Centre", (l, d) => ({ x: (d.width - l.w) / 2, y: (d.height - l.h) / 2 })),
                      addMask, applyMask, deleteMask, toggleMask, rasterize, hasSelection: hasSel,
                    }}
                  />
                  {selLayer?.kind === "text" && <TextPanel layer={selLayer} onText={setText} onCommit={pushHistory} focusKey={textFocus} />}
                  {selLayer?.kind === "shape" && <ShapePanel layer={selLayer} onShape={setShape} onCommit={pushHistory} />}
                  {selLayer?.kind === "adjust" && <AdjustPanel layer={selLayer} onPatch={patchLayer} onCommit={pushHistory} />}
                  {selLayer?.kind === "raster" && !painting && (
                    <div className="silver-edge rounded-xl p-2.5 flex flex-wrap items-start gap-2">
                      <AiButton busy={aiBusy === "remove-bg"} disabled={!!aiBusy} onClick={() => runAi("remove-bg")} cost={STUDIO_AI_TICKETS.subject} model="BiRefNet v2"><ScissorsLineDashed size={12} /> Remove background</AiButton>
                      <button onClick={openAiPanel} className="text-[10px] text-slate-400 hover:text-white mt-1.5">More AI tools →</button>
                    </div>
                  )}
                </>
              )}
              {panel === "adjust" && <AdjustPanel layer={selLayer} onPatch={patchLayer} onCommit={pushHistory} />}
              {/* kept mounted so prompts and picks survive a tab switch */}
              <div className={panel === "ai" ? "" : "hidden"}>
                <AiPanel
                  admin={admin}
                  doc={doc} layer={selLayer} hasSel={hasSel} fillCost={fillCost} busy={aiBusy} focusFill={fillFocus}
                  layerPx={selLayer?.kind === "raster" && rts.current.get(selLayer.id)?.pix ? { w: rts.current.get(selLayer.id)!.pix!.width, h: rts.current.get(selLayer.id)!.pix!.height } : null}
                  onRun={r => void runGen(r)} onCrop={() => setTool("crop")}
                />
              </div>
              {panel === "canvas" && (
                <CanvasPanel
                  doc={doc}
                  onBackground={b => apply("Background", d => ({ ...d, background: b }))}
                  onResize={resizeImage} onCanvasSize={canvasSize} onRotate={rotateCanvas} onFlip={flipCanvas}
                />
              )}
            </div>
            {!inline && (
              <div className="shrink-0 border-t border-white/[0.06] p-2 flex items-center gap-1.5">
              <button onClick={() => void save()} className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white"><Save size={11} /> Save now</button>
              <span className="text-[9.5px] text-slate-600 truncate">Autosaves · {history.current.length - 1 > 0 ? `${histIdx.current} step${histIdx.current === 1 ? "" : "s"} of undo` : "no edits yet"}</span>
            </div>
            )}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
      {refPicker && <RefPicker refs={refLibrary} onPick={addRef} onClose={() => setRefPicker(false)} />}
    </div>
  )
}

// ── small UI ─────────────────────────────────────────────────────────────────

function Inline({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="shrink-0 flex items-center gap-1.5"><span className="text-slate-500">{label}</span>{children}</label>
}
function Seg({ value, options, onChange }: { value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) {
  return (
    <div className="shrink-0 flex rounded-md border border-white/10 bg-black/30 p-0.5">
      {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`px-2 py-0.5 rounded text-[10.5px] ${value === v ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>{l}</button>)}
    </div>
  )
}
function MiniBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} className="shrink-0 flex items-center px-1.5 py-0.5 rounded border border-white/10 text-[10.5px] text-slate-300 hover:text-white hover:bg-white/5">{children}</button>
}
function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button title={title} onClick={onClick} disabled={disabled} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30">{children}</button>
}
function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-full text-left px-2.5 py-1.5 rounded-md text-[11.5px] text-slate-200 hover:bg-white/10">{children}</button>
}
function RefPicker({ refs, onPick, onClose }: { refs: { id: string; url: string }[]; onPick: (url: string) => void; onClose: () => void }) {
  const images = refs.filter(r => !/\.(mp4|mov|webm|glb|fbx)(\?|$)/i.test(r.url))
  return (
    <div className="fixed inset-0 z-[10000] bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85dvh] flex flex-col rounded-2xl border border-white/10 bg-[#0b0f19]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-white/10">
          <span className="text-[13px] font-bold text-white">Your Refs</span>
          <span className="ml-2 text-[11px] text-slate-500">{images.length}</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {images.length === 0 && <p className="col-span-full py-10 text-center text-[12px] text-slate-500">Your Refs library is empty.</p>}
          {images.map(r => (
            <button key={r.id} onClick={() => onPick(r.url)} className="aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
export { RefPicker }
void Circle; void EraserIcon; void parseColor; void useMemo; void Slider; void ColorField
