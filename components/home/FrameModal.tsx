"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Crop, X, Check, Loader2 } from "lucide-react"

// Rectangular image-framing modal for the home cards — the profile-picture crop
// generalized to an arbitrary card aspect ratio. Pan (drag), zoom (slider), and
// pinch-to-zoom on touch; the visible frame is exported as a JPEG sized to the card
// so it fills the tile exactly (object-cover shows the framing). Images only —
// videos upload raw and fill via CSS cover.
export function FrameModal({ src, aspect = 4 / 3, uploading, onCancel, onConfirm }: {
  src: string
  aspect?: number // card width / height
  uploading: boolean
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}) {
  // Fit the crop viewport inside a max box while preserving the card aspect.
  const MAX = 320
  let Dw = MAX, Dh = Math.round(MAX / aspect)
  if (Dh > MAX) { Dh = MAX; Dw = Math.round(MAX * aspect) }
  // Export at higher resolution (longest side ~1280) for a crisp full-quality tile.
  const OUTW = aspect >= 1 ? 1280 : Math.round(1280 * aspect)
  const OUTH = aspect >= 1 ? Math.round(1280 / aspect) : 1280

  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ startDist: number; startZoom: number; anchorX: number; anchorY: number } | null>(null)

  const baseScale = nat ? Math.max(Dw / nat.w, Dh / nat.h) : 1
  const scale = baseScale * zoom

  // Keep the image covering the frame at all times.
  const clamp = useCallback((x: number, y: number, s: number) => {
    if (!nat) return { x, y }
    const rw = nat.w * s, rh = nat.h * s
    return { x: Math.min(0, Math.max(Dw - rw, x)), y: Math.min(0, Math.max(Dh - rh, y)) }
  }, [nat, Dw, Dh])

  // Load + center the image whenever the source (or frame) changes.
  useEffect(() => {
    const im = new window.Image()
    im.onload = () => {
      imgRef.current = im
      setNat({ w: im.naturalWidth, h: im.naturalHeight })
      const s = Math.max(Dw / im.naturalWidth, Dh / im.naturalHeight)
      setZoom(1)
      setOffset({ x: (Dw - im.naturalWidth * s) / 2, y: (Dh - im.naturalHeight * s) / 2 })
    }
    im.src = src
  }, [src, Dw, Dh])

  const localMid = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const r = containerRef.current?.getBoundingClientRect()
    return { x: (a.x + b.x) / 2 - (r?.left ?? 0), y: (a.y + b.y) / 2 - (r?.top ?? 0) }
  }
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length >= 2) {
      drag.current = null
      const mid = localMid(pts[0], pts[1])
      pinch.current = { startDist: dist(pts[0], pts[1]) || 1, startZoom: zoom, anchorX: (mid.x - offset.x) / scale, anchorY: (mid.y - offset.y) / scale }
    } else {
      drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length >= 2 && pinch.current) {
      const p = pinch.current
      const newZoom = Math.min(4, Math.max(1, p.startZoom * (dist(pts[0], pts[1]) / p.startDist)))
      const newScale = baseScale * newZoom
      const mid = localMid(pts[0], pts[1])
      setZoom(newZoom)
      setOffset(clamp(mid.x - p.anchorX * newScale, mid.y - p.anchorY * newScale, newScale))
    } else if (drag.current) {
      setOffset(clamp(drag.current.ox + (e.clientX - drag.current.px), drag.current.oy + (e.clientY - drag.current.py), scale))
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const pts = [...pointers.current.values()]
    if (pts.length < 2) pinch.current = null
    drag.current = pts.length === 1 ? { px: pts[0].x, py: pts[0].y, ox: offset.x, oy: offset.y } : null
  }

  const onZoom = (z: number) => {
    if (!nat) { setZoom(z); return }
    const oldScale = scale
    const newScale = baseScale * z
    const cx = (Dw / 2 - offset.x) / oldScale
    const cy = (Dh / 2 - offset.y) / oldScale
    setZoom(z)
    setOffset(clamp(Dw / 2 - cx * newScale, Dh / 2 - cy * newScale, newScale))
  }

  const handleConfirm = () => {
    const im = imgRef.current
    if (!im) return
    const canvas = document.createElement("canvas")
    canvas.width = OUTW
    canvas.height = OUTH
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const srcX = (0 - offset.x) / scale
    const srcY = (0 - offset.y) / scale
    const srcW = Dw / scale
    const srcH = Dh / scale
    ctx.fillStyle = "#0f172a"
    ctx.fillRect(0, 0, OUTW, OUTH)
    ctx.drawImage(im, srcX, srcY, srcW, srcH, 0, 0, OUTW, OUTH)
    onConfirm(canvas.toDataURL("image/jpeg", 0.92))
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" onMouseDown={onCancel}>
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 w-[min(380px,calc(100vw-24px))] my-auto shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Crop size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-white">Frame your image</span>
          <button onClick={onCancel} className="ml-auto p-1 text-slate-500 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {/* Framing viewport (card-shaped) */}
        <div className="flex justify-center mb-4">
          <div
            ref={containerRef}
            className="relative rounded-xl overflow-hidden bg-slate-950 border border-white/10 cursor-grab active:cursor-grabbing touch-none select-none"
            style={{ width: Dw, height: Dh }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {nat && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt="Frame preview"
                draggable={false}
                style={{ position: "absolute", left: offset.x, top: offset.y, width: nat.w * scale, height: nat.h * scale, maxWidth: "none" }}
              />
            )}
            <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20 pointer-events-none" />
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-2.5 mb-4 px-1">
          <span className="text-[10px] font-mono text-slate-600">−</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={e => onZoom(parseFloat(e.target.value))} className="flex-1 accent-cyan-400 cursor-pointer" />
          <span className="text-[10px] font-mono text-slate-600">+</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={uploading} className="flex-1 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-all disabled:opacity-50">Cancel</button>
          <button onClick={handleConfirm} disabled={uploading || !nat} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-xs font-semibold transition-all disabled:opacity-50">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {uploading ? "Saving…" : "Save image"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
