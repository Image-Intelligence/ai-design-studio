"use client"

/*
 * Image Studio - the side panels (presentational): the layer list and the
 * selected layer's settings, its adjustments, text and shape properties, and
 * the canvas panel. Every change goes through the editor's callbacks, which
 * own the document and its history.
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Eye, EyeOff, Lock, Unlock, Plus, Trash2, Copy, ArrowDownToLine, ChevronUp, ChevronDown, FlipHorizontal2, FlipVertical2,
  RotateCw, RotateCcw, Maximize, Crosshair, Type, Square, Image as ImageIcon, Layers, SlidersHorizontal, Frame, Paintbrush,
  Combine, Wand2, EyeClosed, Folder, FolderOpen, FolderPlus, FolderMinus, ChevronRight, LogOut, Upload, Images, Library, Replace,
} from "lucide-react"
import {
  BLEND_MODES, ADJUST_FIELDS, ADJUST_PRESETS, FONTS, TEXT_STYLES, type StudioLayer, type StudioDoc, type Adjust, type TextProps, type ShapeProps, type BlendMode,
} from "@/lib/image-studio"
import { ctx2d, layerContent, type Runtime } from "./engine"

// ── small controls ───────────────────────────────────────────────────────────

export function Slider({ label, value, min, max, step = 1, suffix = "", onChange, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string
  onChange: (v: number) => void
  /** The drag ended - one undo step for the whole drag. */
  onCommit?: () => void
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-[10.5px] text-slate-400">
        <span>{label}</span>
        <input
          type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step}
          onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
          onBlur={onCommit}
          className="w-14 bg-transparent text-right font-mono text-[10.5px] text-slate-200 focus:outline-none"
        />
        {suffix && <span className="text-slate-600 -ml-1">{suffix}</span>}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit}
        onDoubleClick={() => { onChange(min < 0 ? 0 : min); onCommit?.() }}
        className="w-full accent-slate-200 h-4"
      />
    </label>
  )
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
      {label && <span className="shrink-0">{label}</span>}
      <input type="color" value={toHexInput(value)} onChange={e => onChange(e.target.value)} className="h-6 w-7 rounded border border-white/15 bg-transparent p-0 cursor-pointer" />
      <input value={value} onChange={e => onChange(e.target.value)} className="w-[72px] rounded bg-black/30 border border-white/10 px-1 py-0.5 font-mono text-[10px] text-slate-200 focus:outline-none" />
    </label>
  )
}
/** <input type=color> only takes #rrggbb. */
function toHexInput(c: string) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split("").map(x => x + x).join("")}`
  return "#ffffff"
}

const Btn = ({ title, onClick, disabled, children, active }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; active?: boolean }) => (
  <button
    title={title} onClick={onClick} disabled={disabled}
    className={`flex items-center justify-center gap-1 h-7 min-w-7 px-1.5 rounded-md border text-[10.5px] transition-colors disabled:opacity-35 ${active ? "border-white/40 bg-white/15 text-white" : "border-white/10 text-slate-300 hover:text-white hover:bg-white/5"}`}
  >
    {children}
  </button>
)

// ── a layer's thumbnail ──────────────────────────────────────────────────────

function Thumb({ layer, rt, version }: { layer: StudioLayer; rt?: Runtime; version: number }) {
  if (layer.kind === "group" || layer.kind === "adjust") {
    const Icon = layer.kind === "adjust" ? SlidersHorizontal : layer.collapsed ? Folder : FolderOpen
    return <span className="w-9 h-9 rounded border border-white/10 bg-white/[0.05] flex items-center justify-center text-slate-300"><Icon size={15} /></span>
  }
  return <PixelThumb layer={layer} rt={rt} version={version} />
}
function PixelThumb({ layer, rt, version }: { layer: StudioLayer; rt?: Runtime; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !rt) return
    const content = layerContent(layer, rt)
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    if (!content) return
    const k = Math.min(c.width / content.width, c.height / content.height)
    const w = content.width * k, h = content.height * k
    x.drawImage(content, (c.width - w) / 2, (c.height - h) / 2, w, h)
  }, [layer, rt, version])
  return <canvas ref={ref} width={64} height={64} className="w-9 h-9 rounded bg-[repeating-conic-gradient(#2a2f3a_0%_25%,#1a1e27_0%_50%)] bg-[length:10px_10px] border border-white/10" />
}

// ── layers ───────────────────────────────────────────────────────────────────

/** Where a picture for a layer comes from. */
export type PictureSource = "upload" | "refs" | "library"

/**
 * A layer button that opens the three picture sources (2026-10-09): upload,
 * the Refs library, My Generations / My Assets. The menu is portalled to
 * <body> so the panel's scroll box never clips it.
 */
function SourceMenu({ title, onPick, children }: { title: string; onPick: (s: PictureSource) => void; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest?.("[data-source-menu]")) close() }
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close) }
  }, [pos])
  const open = (btn: HTMLElement) => {
    if (pos) { setPos(null); return }
    const r = btn.getBoundingClientRect(), W = 228, H = 112
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
    setPos(window.innerHeight - r.bottom > H + 12 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 })
  }
  const item = "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] text-slate-200 hover:bg-white/5"
  const pick = (s: PictureSource) => { setPos(null); onPick(s) }
  return (
    <>
      <button data-source-menu title={title} onClick={e => open(e.currentTarget)}
        className="flex items-center justify-center gap-1 px-1.5 h-6 min-w-6 rounded-md border border-white/10 text-slate-300 hover:text-white hover:border-white/30 text-[10px]">
        {children}
      </button>
      {pos && typeof document !== "undefined" && createPortal(
        <div data-source-menu className="fixed z-[10060] w-[228px] rounded-lg border border-white/15 bg-[#0b0f19] p-1 shadow-2xl"
          style={{ left: pos.left, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }) }}>
          <button className={item} onClick={() => pick("upload")}><Upload size={12} /> Upload from this device</button>
          <button className={item} onClick={() => pick("refs")}><Images size={12} /> From my Refs</button>
          <button className={item} onClick={() => pick("library")}><Library size={12} /> From My Generations &amp; My Assets</button>
        </div>,
        document.body,
      )}
    </>
  )
}

export function LayersPanel({ basic = false, doc, rts, version, selectedId, picked, maskEdit, onSelect, onPick, onPatch, onCommit, onReorder, onDropOn, onStep, onAdd, actions }: {
  /**
   * No layer management (the Edit Image popup without Dev Tier): the list
   * stays, so what text, shapes and AI tools made can be picked, moved or
   * deleted, but there is no adding layers, groups, adjustment layers, masks
   * or blend modes - and it all flattens on Apply.
   */
  basic?: boolean
  doc: StudioDoc
  rts: Map<string, Runtime>
  /** bumps whenever pixels change, so thumbnails redraw */
  version: number
  selectedId: string | null
  /** layers picked with Ctrl / Shift (to group them), besides the selected one */
  picked: Set<string>
  maskEdit: boolean
  onSelect: (id: string, mask?: boolean) => void
  /** Ctrl / Cmd-click toggles one; Shift-click picks the run from the selected one */
  onPick: (id: string, range: boolean) => void
  /** a layer dropped on another row: into it (a group) or into its place */
  onDropOn: (id: string, targetId: string) => void
  /** one step up or down among its siblings */
  onStep: (id: string, dir: 1 | -1) => void
  /** live change to a layer (no history step) */
  onPatch: (id: string, patch: Partial<StudioLayer>) => void
  /** the change is done: one history step */
  onCommit: (label: string) => void
  onReorder?: (id: string, toIndex: number) => void
  onAdd: (what: "empty" | "image" | "refs" | "library" | "text" | "shape" | "adjust") => void
  actions: {
    group: () => void; ungroup: () => void; moveOut: () => void; toggleCollapse: (id: string) => void
    duplicate: () => void; remove: () => void; mergeDown: () => void; flatten: () => void
    flip: (axis: "x" | "y") => void; rotate90: (dir: 1 | -1) => void; fit: (mode: "fit" | "fill") => void; center: () => void
    addMask: (from: "reveal" | "hide" | "selection") => void; applyMask: () => void; deleteMask: () => void; toggleMask: () => void
    rasterize: () => void; hasSelection: boolean
    /** Swap the selected image layer's picture for one from this source (same place, fitted to its box) */
    replace: (from: PictureSource) => void
  }
}) {
  const [rename, setRename] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const L = doc.layers.find(l => l.id === selectedId) ?? null
  // Top first; a folded group's layers are not listed
  const collapsed = new Set(doc.layers.filter(l => l.kind === "group" && l.collapsed).map(l => l.id))
  const top = [...doc.layers].reverse().filter(l => !(l.parent && collapsed.has(l.parent)))
  const siblings = L ? doc.layers.filter(l => (l.parent ?? null) === (L.parent ?? null)) : []
  const sib = L ? siblings.indexOf(L) : -1
  const below = sib > 0 ? siblings[sib - 1] : null
  const isGroup = L?.kind === "group", isAdj = L?.kind === "adjust"
  const groupCount = (id: string) => doc.layers.filter(l => l.parent === id).length
  const nPicked = new Set([...picked, ...(selectedId ? [selectedId] : [])]).size

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Layers size={13} className="text-slate-400" />
        <span className="text-[11px] font-bold text-slate-200">Layers</span>
        <span className="text-[10px] text-slate-600">{doc.layers.length}</span>
        <div className="ml-auto flex gap-1">
          {!basic && <>
            <Btn title={nPicked > 1 ? `Group the ${nPicked} picked layers (Ctrl+G)` : "New group (Ctrl+G groups the selected layer; Ctrl/Shift-click to pick more)"} onClick={actions.group}><FolderPlus size={12} /></Btn>
            <Btn title="New adjustment layer - changes everything under it (only the selection, if there is one)" onClick={() => onAdd("adjust")}><SlidersHorizontal size={12} /></Btn>
            <Btn title="New empty layer" onClick={() => onAdd("empty")}><Plus size={12} /></Btn>
            <SourceMenu title="Add a picture as a new layer - upload, your Refs, My Generations or My Assets"
              onPick={src => onAdd(src === "upload" ? "image" : src)}><ImageIcon size={12} /></SourceMenu>
          </>}
          <Btn title="Text layer" onClick={() => onAdd("text")}><Type size={12} /></Btn>
          <Btn title="Shape layer" onClick={() => onAdd("shape")}><Square size={12} /></Btn>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 max-h-[38vh] overflow-y-auto">
        {top.length === 0 && <p className="p-3 text-[10.5px] text-slate-500">No layers yet - add an image, text or a shape.</p>}
        {top.map(l => {
          const on = l.id === selectedId
          const isPicked = picked.has(l.id) && !on
          const dropInto = !!drag && drag !== l.id && l.kind === "group" && doc.layers.find(x => x.id === drag)?.kind !== "group"
          return (
            <div
              key={l.id}
              draggable={!basic}
              onDragStart={() => setDrag(l.id)}
              onDragEnd={() => setDrag(null)}
              onDragOver={e => { if (drag && drag !== l.id) e.preventDefault() }}
              onDrop={() => { if (drag && drag !== l.id) onDropOn(drag, l.id); setDrag(null) }}
              onClick={e => { if (!basic && (e.ctrlKey || e.metaKey || e.shiftKey)) onPick(l.id, e.shiftKey); else onSelect(l.id) }}
              title={l.kind === "group" ? "A group - drop layers on it to put them in" : undefined}
              className={`flex items-center gap-1.5 pr-1.5 py-1 border-b border-white/5 cursor-pointer ${l.parent ? "pl-5" : "pl-1.5"} ${on ? "bg-white/10" : isPicked ? "bg-white/[0.06] ring-1 ring-inset ring-white/25" : "hover:bg-white/[0.04]"} ${drag === l.id ? "opacity-40" : ""} ${dropInto ? "outline-dashed outline-1 outline-white/20 -outline-offset-2" : ""}`}
            >
              {l.kind === "group" && (
                <button onClick={e => { e.stopPropagation(); actions.toggleCollapse(l.id) }} className="-mr-1 text-slate-500 hover:text-white" title={l.collapsed ? "Show its layers" : "Fold it away"}>
                  {l.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); onPatch(l.id, { visible: !l.visible }); onCommit(l.visible ? "Hide layer" : "Show layer") }} className="text-slate-400 hover:text-white">
                {l.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-slate-600" />}
              </button>
              <span className={`rounded ${on && !maskEdit ? "ring-1 ring-sky-400" : ""}`}><Thumb layer={l} rt={rts.get(l.id)} version={version} /></span>
              {l.mask && (
                <button
                  title={maskEdit && on ? "Painting the mask - click to paint the layer" : "Paint this layer's mask (brush hides, eraser reveals)"}
                  onClick={e => { e.stopPropagation(); onSelect(l.id, !(maskEdit && on)) }}
                  className={`relative w-9 h-9 rounded border ${maskEdit && on ? "ring-1 ring-sky-400 border-sky-400/60" : "border-white/10"} ${l.mask.enabled ? "" : "opacity-40"}`}
                >
                  <MaskThumb rt={rts.get(l.id)} version={version} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                {rename === l.id ? (
                  <input
                    autoFocus defaultValue={l.name}
                    onBlur={e => { onPatch(l.id, { name: e.target.value.trim() || l.name }); onCommit("Rename layer"); setRename(null) }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(null) }}
                    className="w-full bg-black/40 border border-white/20 rounded px-1 text-[11px] text-white focus:outline-none"
                  />
                ) : (
                  <div onDoubleClick={() => setRename(l.id)} className="truncate text-[11px] text-slate-200" title="Double-click to rename">{l.name}</div>
                )}
                <div className="text-[9px] text-slate-500 truncate">
                  {l.kind === "group" ? `group · ${groupCount(l.id)} layer${groupCount(l.id) === 1 ? "" : "s"}` : l.kind === "adjust" ? "adjustment" : l.kind}{l.blend !== "normal" ? ` · ${l.blend}` : ""}{l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)}%` : ""}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); onPatch(l.id, { locked: !l.locked }); onCommit(l.locked ? "Unlock layer" : "Lock layer") }} className="text-slate-500 hover:text-white" title={l.locked ? "Locked - click to unlock" : "Lock (no moving or painting)"}>
                {l.locked ? <Lock size={11} /> : <Unlock size={11} className="opacity-40" />}
              </button>
            </div>
          )
        })}
      </div>

      {L && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
          {!basic && <div className="flex items-center gap-2">
            <select
              value={L.blend}
              onChange={e => { onPatch(L.id, { blend: e.target.value as BlendMode }); onCommit("Blend mode") }}
              className="flex-1 rounded bg-black/40 border border-white/10 px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none"
            >
              {BLEND_MODES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>}
          <Slider label="Opacity" value={Math.round(L.opacity * 100)} min={0} max={100} suffix="%" onChange={v => onPatch(L.id, { opacity: v / 100 })} onCommit={() => onCommit("Opacity")} />
          <div className="flex flex-wrap gap-1">
            <Btn title="Move up" onClick={() => onStep(L.id, 1)} disabled={sib >= siblings.length - 1}><ChevronUp size={12} /></Btn>
            <Btn title="Move down" onClick={() => onStep(L.id, -1)} disabled={sib <= 0}><ChevronDown size={12} /></Btn>
            <Btn title={isGroup ? "Duplicate the group and its layers" : "Duplicate (Ctrl+J)"} onClick={actions.duplicate}><Copy size={12} /></Btn>
            {basic ? null : isGroup ? (
              <>
                <Btn title="Merge the group into one pixel layer" onClick={actions.mergeDown}><ArrowDownToLine size={12} /> Merge</Btn>
                <Btn title="Ungroup - its layers stay, the group's opacity and blend go (Ctrl+Shift+G)" onClick={actions.ungroup}><FolderMinus size={12} /> Ungroup</Btn>
              </>
            ) : (
              <Btn title={isAdj ? "Merge down: bake the adjustment into the layer below" : "Merge down"} onClick={actions.mergeDown} disabled={!below || below.kind === "group"}><ArrowDownToLine size={12} /></Btn>
            )}
            {!isGroup && !isAdj && <>
              <Btn title="Flip horizontally" onClick={() => actions.flip("x")}><FlipHorizontal2 size={12} /></Btn>
              <Btn title="Flip vertically" onClick={() => actions.flip("y")}><FlipVertical2 size={12} /></Btn>
              <Btn title="Rotate 90° left" onClick={() => actions.rotate90(-1)}><RotateCcw size={12} /></Btn>
              <Btn title="Rotate 90° right" onClick={() => actions.rotate90(1)}><RotateCw size={12} /></Btn>
              <Btn title="Fit inside the canvas" onClick={() => actions.fit("fit")}><Maximize size={12} /></Btn>
              <Btn title="Fill the canvas" onClick={() => actions.fit("fill")}><Frame size={12} /></Btn>
              <Btn title="Centre on the canvas" onClick={actions.center}><Crosshair size={12} /></Btn>
              {L.kind === "raster" && !basic && <SourceMenu title="Replace the picture - keeps the layer's place (upload, your Refs, My Generations or My Assets)" onPick={actions.replace}><Replace size={12} /></SourceMenu>}
            </>}
            {(L.kind === "text" || L.kind === "shape") && <Btn title="Turn into pixels (to paint on it)" onClick={actions.rasterize}><Paintbrush size={12} /> Rasterize</Btn>}
            {L.parent && !basic && <Btn title="Take it out of its group" onClick={actions.moveOut}><LogOut size={12} /></Btn>}
            <Btn title={isGroup ? "Delete the group and its layers" : "Delete layer"} onClick={actions.remove}><Trash2 size={12} /></Btn>
          </div>
          {!isGroup && !basic && <div className="border-t border-white/5 pt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Mask</div>
            {!L.mask ? (
              <div className="flex flex-wrap gap-1">
                <Btn title="A mask that shows everything - paint to hide" onClick={() => actions.addMask("reveal")}><Plus size={11} /> Show all</Btn>
                <Btn title="A mask that hides everything - paint to reveal" onClick={() => actions.addMask("hide")}><EyeClosed size={11} /> Hide all</Btn>
                <Btn title="Only the selection shows" onClick={() => actions.addMask("selection")} disabled={!actions.hasSelection}><Wand2 size={11} /> From selection</Btn>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <Btn title="Paint the mask: brush hides, eraser reveals" onClick={() => onSelect(L.id, !maskEdit)} active={maskEdit}><Paintbrush size={11} /> {maskEdit ? "Painting mask" : "Paint mask"}</Btn>
                <Btn title={L.mask.enabled ? "Switch the mask off (see everything)" : "Switch the mask on"} onClick={actions.toggleMask}>{L.mask.enabled ? <Eye size={11} /> : <EyeOff size={11} />}</Btn>
                {L.kind === "raster" && <Btn title="Apply: cut the hidden parts out of the pixels for good" onClick={actions.applyMask}>Apply</Btn>}
                <Btn title="Delete the mask (everything shows again)" onClick={actions.deleteMask}><Trash2 size={11} /></Btn>
              </div>
            )}
          </div>}
        </div>
      )}
      {basic && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] leading-snug text-slate-400">
          Text, shapes and AI results sit on their own layers while you edit and are merged into the picture on Apply.
          <span className="text-slate-300"> Layers, groups, masks, adjustment layers - and keeping them after Apply - come with Dev Tier.</span>
        </p>
      )}
      {!basic && <div className="flex flex-wrap items-center gap-1">
        <Btn title="Flatten every layer into one" onClick={actions.flatten} disabled={doc.layers.length < 2}>Flatten all</Btn>
        {nPicked > 1 && <Btn title="Put the picked layers in a new group (Ctrl+G)" onClick={actions.group}><FolderPlus size={11} /> Group {nPicked}</Btn>}
        <span className="text-[9.5px] text-slate-600">Ctrl/Shift-click to pick several · drag onto a group to put it in</span>
      </div>}
    </div>
  )
}

function MaskThumb({ rt, version }: { rt?: Runtime; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !rt?.mask) return
    const x = ctx2d(c)
    x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height)
    const k = Math.min(c.width / rt.mask.width, c.height / rt.mask.height)
    x.drawImage(rt.mask, (c.width - rt.mask.width * k) / 2, (c.height - rt.mask.height * k) / 2, rt.mask.width * k, rt.mask.height * k)
  }, [rt, version])
  return <canvas ref={ref} width={64} height={64} className="w-full h-full rounded" />
}

// ── adjustments ──────────────────────────────────────────────────────────────

export function AdjustPanel({ layer, onPatch, onCommit }: {
  layer: StudioLayer | null
  onPatch: (id: string, patch: Partial<StudioLayer>) => void
  onCommit: (label: string) => void
}) {
  if (!layer) return <p className="text-[10.5px] text-slate-500">Select a layer to adjust it - or add an adjustment layer (Layers panel) to change everything under it.</p>
  if (layer.kind === "group") return <p className="text-[10.5px] text-slate-500">A group has no pixels of its own - add an adjustment layer inside it to change only its layers.</p>
  const a = layer.adjust ?? {}
  const set = (k: keyof Adjust, v: number) => onPatch(layer.id, { adjust: { ...a, [k]: v } })
  const isLayer = layer.kind === "adjust"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <SlidersHorizontal size={13} className="text-slate-400" />
        <span className="text-[11px] font-bold text-slate-200">{isLayer ? "Adjustment layer" : "Adjust"}</span>
        <span className="text-[10px] text-slate-500 truncate">· {layer.name}</span>
        <button onClick={() => { onPatch(layer.id, { adjust: undefined }); onCommit("Reset adjustments") }} className="ml-auto text-[10px] text-slate-500 hover:text-white">Reset</button>
      </div>
      <p className="text-[9.5px] text-slate-500 leading-snug">
        {isLayer ? "Changes everything under it (in its group, if it is in one) - its mask says where." : "Non-destructive - change or reset them any time."} Double-click a slider to zero it.
      </p>
      <div className="flex flex-wrap gap-1">
        {ADJUST_PRESETS.map(p => (
          <button key={p.id} onClick={() => { onPatch(layer.id, { adjust: { ...p.adjust } }); onCommit(p.label) }}
            className="px-1.5 py-0.5 rounded-md border border-white/10 text-[10px] text-slate-300 hover:text-white hover:border-white/30 hover:bg-white/5">{p.label}</button>
        ))}
      </div>
      {ADJUST_FIELDS.map(f => (
        <Slider key={f.key} label={f.label} value={a[f.key] ?? 0} min={f.min} max={f.max} onChange={v => set(f.key, v)} onCommit={() => onCommit(f.label)} />
      ))}
    </div>
  )
}

// ── text / shape properties ──────────────────────────────────────────────────

export function TextPanel({ layer, onText, onCommit, focusKey }: {
  layer: StudioLayer
  onText: (patch: Partial<TextProps>) => void
  onCommit: (label: string) => void
  /** changes when the editor wants the text box focused (a new text layer, a double click) */
  focusKey: number
}) {
  const t = layer.text!
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focusKey) { area.current?.focus(); area.current?.select() } }, [focusKey])
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1"><Type size={13} className="text-slate-400" /><span className="text-[11px] font-bold text-slate-200">Text</span></div>
      {/* one-click looks: each only sets the style, never the words */}
      <div className="flex flex-wrap gap-1">
        {TEXT_STYLES.map(st => (
          <button key={st.id} onClick={() => { onText(st.patch); onCommit(`Style: ${st.label}`) }}
            className="px-1.5 py-0.5 rounded-md border border-white/10 text-[10px] text-slate-300 hover:text-white hover:border-white/30 hover:bg-white/5">{st.label}</button>
        ))}
      </div>
      <textarea ref={area} value={t.text} rows={3} onChange={e => onText({ text: e.target.value })} onBlur={() => onCommit("Edit text")}
        className="w-full rounded bg-black/40 border border-white/10 px-2 py-1 text-[12px] text-white focus:outline-none focus:border-white/30" />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={t.font} onChange={e => { onText({ font: e.target.value }); onCommit("Font") }} className="rounded bg-black/40 border border-white/10 px-1 py-1 text-[11px] text-slate-200">
          {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select value={t.weight} onChange={e => { onText({ weight: Number(e.target.value) }); onCommit("Weight") }} className="rounded bg-black/40 border border-white/10 px-1 py-1 text-[11px] text-slate-200">
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <Slider label="Size" value={t.size} min={6} max={600} onChange={v => onText({ size: v })} onCommit={() => onCommit("Text size")} />
      <div className="flex items-center gap-1">
        {(["left", "center", "right"] as const).map(al => <Btn key={al} title={`Align ${al}`} onClick={() => { onText({ align: al }); onCommit("Align") }} active={t.align === al}>{al[0].toUpperCase()}</Btn>)}
        <Btn title="Italic" onClick={() => { onText({ italic: !t.italic }); onCommit("Italic") }} active={t.italic}><i>I</i></Btn>
      </div>
      <ColorField label="Colour" value={t.color} onChange={v => onText({ color: v })} />
      <Slider label="Line height" value={t.lineHeight} min={0.6} max={3} step={0.05} onChange={v => onText({ lineHeight: v })} onCommit={() => onCommit("Line height")} />
      <Slider label="Letter spacing" value={t.letterSpacing} min={-20} max={100} onChange={v => onText({ letterSpacing: v })} onCommit={() => onCommit("Letter spacing")} />
      <Slider label="Outline" value={t.strokeWidth} min={0} max={40} onChange={v => onText({ strokeWidth: v })} onCommit={() => onCommit("Outline")} />
      {t.strokeWidth > 0 && <ColorField label="Outline colour" value={t.strokeColor} onChange={v => onText({ strokeColor: v })} />}
      <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
        <input type="checkbox" checked={t.shadow} onChange={e => { onText({ shadow: e.target.checked }); onCommit("Shadow") }} className="accent-slate-200" /> Shadow
      </label>
      {t.shadow && <Slider label="Shadow blur" value={t.shadowBlur} min={0} max={80} onChange={v => onText({ shadowBlur: v })} onCommit={() => onCommit("Shadow")} />}

      {/* ── effects ── */}
      <div className="border-t border-white/5 pt-2 flex flex-col gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Effects</div>
        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
          <input type="checkbox" checked={!!t.caps} onChange={e => { onText({ caps: e.target.checked }); onCommit("All caps") }} className="accent-slate-200" /> ALL CAPS
        </label>
        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
          <input type="checkbox" checked={!!t.gradient} onChange={e => { onText({ gradient: e.target.checked ? { from: t.color, to: "#64748b", angle: 90 } : null }); onCommit("Gradient fill") }} className="accent-slate-200" /> Gradient fill
        </label>
        {t.gradient && <>
          <div className="flex flex-wrap gap-1.5">
            <ColorField label="From" value={t.gradient.from} onChange={v => onText({ gradient: { ...t.gradient!, from: v } })} />
            <ColorField label="To" value={t.gradient.to} onChange={v => onText({ gradient: { ...t.gradient!, to: v } })} />
          </div>
          <Slider label="Angle" value={t.gradient.angle} min={-180} max={180} suffix="°" onChange={v => onText({ gradient: { ...t.gradient!, angle: v } })} onCommit={() => onCommit("Gradient angle")} />
        </>}
        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
          <input type="checkbox" checked={!!t.glow} onChange={e => { onText({ glow: e.target.checked ? { color: "#38bdf8", size: Math.max(8, Math.round(t.size / 4)) } : null }); onCommit("Glow") }} className="accent-slate-200" /> Outer glow
        </label>
        {t.glow && <>
          <ColorField label="Glow" value={t.glow.color} onChange={v => onText({ glow: { ...t.glow!, color: v } })} />
          <Slider label="Glow size" value={t.glow.size} min={1} max={150} onChange={v => onText({ glow: { ...t.glow!, size: v } })} onCommit={() => onCommit("Glow size")} />
        </>}
        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
          <input type="checkbox" checked={!!t.plate} onChange={e => { onText({ plate: e.target.checked ? { color: "rgba(0,0,0,0.7)", pad: Math.round(t.size / 5), radius: Math.round(t.size / 8) } : null }); onCommit("Background plate") }} className="accent-slate-200" /> Background plate
        </label>
        {t.plate && <>
          <ColorField label="Plate" value={t.plate.color} onChange={v => onText({ plate: { ...t.plate!, color: v } })} />
          <Slider label="Padding" value={t.plate.pad} min={0} max={200} onChange={v => onText({ plate: { ...t.plate!, pad: v } })} onCommit={() => onCommit("Plate padding")} />
          <Slider label="Corner radius" value={t.plate.radius} min={0} max={200} onChange={v => onText({ plate: { ...t.plate!, radius: v } })} onCommit={() => onCommit("Plate radius")} />
        </>}
      </div>
    </div>
  )
}

export function ShapePanel({ layer, onShape, onCommit }: {
  layer: StudioLayer
  onShape: (patch: Partial<ShapeProps>) => void
  onCommit: (label: string) => void
}) {
  const s = layer.shape!
  const line = s.shape === "line" || s.shape === "arrow"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1"><Square size={13} className="text-slate-400" /><span className="text-[11px] font-bold text-slate-200">Shape</span></div>
      <div className="flex gap-1">
        {(["rect", "ellipse", "line", "arrow"] as const).map(k => <Btn key={k} title={k} onClick={() => { onShape({ shape: k }); onCommit("Shape") }} active={s.shape === k}>{k}</Btn>)}
      </div>
      {!line && (
        <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
          <input type="checkbox" checked={s.fill !== null} onChange={e => { onShape({ fill: e.target.checked ? "#ffffff" : null }); onCommit("Fill") }} className="accent-slate-200" /> Fill
        </label>
      )}
      {!line && s.fill !== null && <ColorField value={s.fill} onChange={v => onShape({ fill: v })} />}
      <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
        <input type="checkbox" checked={s.stroke !== null} onChange={e => { onShape({ stroke: e.target.checked ? "#000000" : null }); onCommit("Outline") }} className="accent-slate-200" /> {line ? "Colour" : "Outline"}
      </label>
      {s.stroke !== null && <ColorField value={s.stroke} onChange={v => onShape({ stroke: v })} />}
      <Slider label={line ? "Thickness" : "Outline width"} value={s.strokeWidth} min={1} max={120} onChange={v => onShape({ strokeWidth: v })} onCommit={() => onCommit("Outline width")} />
      {s.shape === "rect" && <Slider label="Corner radius" value={s.radius} min={0} max={1000} onChange={v => onShape({ radius: v })} onCommit={() => onCommit("Corner radius")} />}
    </div>
  )
}

// ── the canvas ───────────────────────────────────────────────────────────────

export function CanvasPanel({ doc, onBackground, onResize, onCanvasSize, onRotate, onFlip }: {
  doc: StudioDoc
  onBackground: (bg: string | null) => void
  /** resample everything to a new size */
  onResize: (w: number, h: number) => void
  /** change the canvas around the layers, anchored (ax, ay in 0 / 0.5 / 1) */
  onCanvasSize: (w: number, h: number, ax: number, ay: number) => void
  onRotate: (dir: 1 | -1) => void
  onFlip: (axis: "x" | "y") => void
}) {
  const [rw, setRw] = useState(doc.width), [rh, setRh] = useState(doc.height), [lock, setLock] = useState(true)
  const [cw, setCw] = useState(doc.width), [ch, setCh] = useState(doc.height), [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5])
  useEffect(() => { setRw(doc.width); setRh(doc.height); setCw(doc.width); setCh(doc.height) }, [doc.width, doc.height])
  const ratio = doc.width / doc.height
  const n = (v: string) => Math.max(1, Math.round(Number(v) || 1))
  const field = "w-20 rounded bg-black/40 border border-white/10 px-1.5 py-1 font-mono text-[11px] text-slate-200 focus:outline-none"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-bold text-slate-200 mb-1">Canvas · {doc.width} × {doc.height}</div>
        <div className="flex items-center gap-2 text-[10.5px] text-slate-300">
          <label className="flex items-center gap-1"><input type="radio" checked={doc.background === null} onChange={() => onBackground(null)} className="accent-slate-200" /> Transparent</label>
          <label className="flex items-center gap-1"><input type="radio" checked={doc.background !== null} onChange={() => onBackground("#ffffff")} className="accent-slate-200" /> Colour</label>
        </div>
        {doc.background !== null && <div className="mt-1"><ColorField value={doc.background} onChange={onBackground} /></div>}
      </div>
      <div className="flex flex-wrap gap-1">
        <Btn title="Rotate the canvas 90° left" onClick={() => onRotate(-1)}><RotateCcw size={12} /> 90°</Btn>
        <Btn title="Rotate the canvas 90° right" onClick={() => onRotate(1)}><RotateCw size={12} /> 90°</Btn>
        <Btn title="Flip the canvas horizontally" onClick={() => onFlip("x")}><FlipHorizontal2 size={12} /></Btn>
        <Btn title="Flip the canvas vertically" onClick={() => onFlip("y")}><FlipVertical2 size={12} /></Btn>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-2 flex flex-col gap-1.5">
        <div className="text-[10.5px] font-semibold text-slate-300">Image size <span className="font-normal text-slate-500">(scales everything)</span></div>
        <div className="flex items-center gap-1.5">
          <input className={field} value={rw} onChange={e => { const w = n(e.target.value); setRw(w); if (lock) setRh(Math.round(w / ratio)) }} />
          <span className="text-slate-500">×</span>
          <input className={field} value={rh} onChange={e => { const h = n(e.target.value); setRh(h); if (lock) setRw(Math.round(h * ratio)) }} />
          <label className="flex items-center gap-1 text-[10px] text-slate-400"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} className="accent-slate-200" /> Keep ratio</label>
        </div>
        <div className="flex gap-1">
          {[0.5, 2].map(k => <Btn key={k} title={`${k * 100}%`} onClick={() => { setRw(Math.round(doc.width * k)); setRh(Math.round(doc.height * k)) }}>{k * 100}%</Btn>)}
          <Btn title="Resize" onClick={() => onResize(rw, rh)} disabled={rw === doc.width && rh === doc.height}>Apply</Btn>
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-2 flex flex-col gap-1.5">
        <div className="text-[10.5px] font-semibold text-slate-300">Canvas size <span className="font-normal text-slate-500">(adds space or trims; layers stay)</span></div>
        <div className="flex items-center gap-1.5">
          <input className={field} value={cw} onChange={e => setCw(n(e.target.value))} />
          <span className="text-slate-500">×</span>
          <input className={field} value={ch} onChange={e => setCh(n(e.target.value))} />
        </div>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-3 gap-0.5">
            {[0, 0.5, 1].flatMap(ay => [0, 0.5, 1].map(ax => (
              <button key={`${ax}${ay}`} onClick={() => setAnchor([ax, ay])} title="Anchor" className={`w-4 h-4 rounded-sm border ${anchor[0] === ax && anchor[1] === ay ? "bg-slate-200 border-slate-200" : "border-white/20 hover:bg-white/10"}`} />
            )))}
          </div>
          <Btn title="Change the canvas size" onClick={() => onCanvasSize(cw, ch, anchor[0], anchor[1])} disabled={cw === doc.width && ch === doc.height}>Apply</Btn>
        </div>
      </div>
    </div>
  )
}
