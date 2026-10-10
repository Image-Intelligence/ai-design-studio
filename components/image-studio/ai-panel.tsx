"use client"

/*
 * Image Studio - the AI panel (Phase 2): generative fill and object removal
 * in a selection, a new layer from a prompt, an AI edit of the selected
 * layer, upscaling, and the way to generative expand (the crop tool).
 *
 * Presentational, like ./panels: it keeps what the user typed and picked and
 * hands a request to the editor (onRun), which prepares the pixels, runs it
 * and places the result. Every button is the site's silver BrandButton with
 * the synced logo (./ai-button), its price from lib/image-studio-ai - the same
 * functions the route charges with - and the exact model it runs.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Wand2, ImagePlus, PenLine, ArrowUpRight, Crop, Plus, X, Images, Library, Loader2, Check } from "lucide-react"
import { createPortal } from "react-dom"
import { openLibraryPicker } from "@/components/feed/LibraryPicker"
import { AiButton } from "./ai-button"
import { type StudioDoc, type StudioLayer, MAX_CANVAS_SIDE } from "@/lib/image-studio"
import {
  type UpscalerId, UPSCALERS, UPSCALE_MAX_SIDE, STUDIO_IMAGE_MODELS, STUDIO_EDIT_MODELS,
  ERASE_TICKETS, EXPAND_TICKETS, upscaleFactor, upscaleTickets, genTickets, studioModelsFor, defaultGenModel,
  modelAspects, defaultAspect, editAspect as editFrame,
} from "@/lib/image-studio-ai"
import { stillModelSpec } from "@/lib/storyboard"

export type GenRequest =
  | { op: "fill"; prompt: string }
  /** Re-generate the selected box with an image model (an edit of just that part), back in its place */
  | { op: "regen"; prompt: string; model: string; quality?: string; options?: Record<string, string>; refs?: string[] }
  | { op: "erase" }
  | { op: "upscale"; target: "canvas" | "layer"; upscaler: UpscalerId; factor: number }
  | { op: "edit"; prompt: string; model: string; quality?: string; options?: Record<string, string>; refs?: string[] }
  | { op: "generate"; prompt: string; model: string; quality?: string; aspect: string; ref: "none" | "canvas" | "layer"; options?: Record<string, string>; refs?: string[] }

export function AiPanel({ admin = true, doc, layer, layerPx, hasSel, selBox = null, fillCost, busy, focusFill, onRun, onCrop, refPreviews = {} }: {
  /** small previews of what the tools send themselves (the canvas, the selected layer, the selection) */
  refPreviews?: { canvas?: string; layer?: string; selection?: string }
  /** an admin account: the site's admin-only image models are offered too */
  admin?: boolean
  doc: StudioDoc
  layer: StudioLayer | null
  /** the selected raster layer's own pixel size (what an upscale of it sends) */
  layerPx: { w: number; h: number } | null
  hasSel: boolean
  /** the selection's box on the canvas (its shape picks a re-generate frame) */
  selBox?: { x: number; y: number; w: number; h: number } | null
  /** tickets a fill of the current selection costs (its region's size) */
  fillCost: number | null
  busy: string | null
  /** bumps to put the cursor in the fill prompt */
  focusFill: number
  onRun: (r: GenRequest) => void
  onCrop: () => void
}) {
  const [fillPrompt, setFillPrompt] = useState("")
  const fillRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focusFill) fillRef.current?.focus() }, [focusFill])

  // ── generate ──
  const [genPrompt, setGenPrompt] = useState("")
  const genList = useMemo(() => studioModelsFor(STUDIO_IMAGE_MODELS, admin), [admin])
  const editList = useMemo(() => studioModelsFor(STUDIO_EDIT_MODELS, admin), [admin])
  const [genModel, setGenModel] = useState(() => defaultGenModel(admin))
  const [genQuality, setGenQuality] = useState<Record<string, string>>({})
  /*
   * Each model's own settings beyond quality (2026-10-09) - NanoBanana 2.1's
   * Thinking and Web search, and its Safety for an admin (everyone else runs
   * at the site's public level whatever is sent). Per model, shared by the
   * Generate and Edit cards; sent as `options` (lib/storyboard stillBuildOptions).
   */
  const [modelOpts, setModelOpts] = useState<Record<string, Record<string, string>>>({})
  const settingsOf = (id: string) => stillModelSpec(id).settings.filter(s => s.key !== "quality" && (admin || !s.admin))
  const optsFor = (id: string) => Object.fromEntries(settingsOf(id).map(s => [s.key, modelOpts[id]?.[s.key] ?? s.def]))
  const setOpt = (id: string, key: string, v: string) => setModelOpts(m => ({ ...m, [id]: { ...m[id], [key]: v } }))
  /*
   * References added by hand (2026-10-09), per card: pictures from the Refs
   * library, My Generations or My Assets. They go after the picture the tool
   * sends itself, up to what the model takes - the strip shows exactly what
   * goes, numbered, and greys out what will not.
   */
  const [genExtra, setGenExtra] = useState<string[]>([])
  const [editExtra, setEditExtra] = useState<string[]>([])
  const [regenExtra, setRegenExtra] = useState<string[]>([])
  /** The added pictures that fit after `lead` of them, for a model taking `max`. */
  const usable = (extra: string[], lead: number, max: number) => extra.slice(0, Math.max(0, max - lead))
  // A plain function (not a component defined in render - that would remount every render)
  const modelSettings = (id: string) => (
    <>
      {settingsOf(id).map(s => {
        const v = modelOpts[id]?.[s.key] ?? s.def
        const labels = Object.fromEntries(s.options.map(o => [o.value, o.label.replace(/ - .*$/, "")]))
        return (
          <Field key={s.key} label={s.label}>
            {s.options.length <= 4
              ? <Seg value={v} options={s.options.map(o => o.value)} labels={labels} onChange={nv => setOpt(id, s.key, nv)} />
              : <select value={v} onChange={e => setOpt(id, s.key, e.target.value)} title={s.hint} className={select}>
                  {s.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>}
          </Field>
        )
      })}
    </>
  )
  // The frame picked; a model without it (e.g. "auto" on a model that has no auto) uses its own default
  const [genAspectPick, setGenAspect] = useState<string>(() => defaultAspect(defaultGenModel(admin), doc.width, doc.height))
  const aspectFor = (id: string) => (modelAspects(id).includes(genAspectPick) ? genAspectPick : defaultAspect(id, doc.width, doc.height))
  const genAspect = aspectFor(genModel)
  const [genRef, setGenRef] = useState<"none" | "canvas" | "layer">("none")
  const genSpec = useMemo(() => stillModelSpec(genModel), [genModel])
  const genQ = genQuality[genModel] ?? (genSpec.defQuality || undefined)
  const genRefs = STUDIO_IMAGE_MODELS.find(m => m.id === genModel)?.refs ? genRef : "none"
  const genLead = genRefs === "none" ? 0 : 1
  const genSent = usable(genExtra, genLead, genSpec.maxRefs)
  const genCost = genTickets(genModel, genQ, genAspect, genLead + genSent.length, optsFor(genModel))

  // ── edit ──
  const [editPrompt, setEditPrompt] = useState("")
  const [editPick, setEditModel] = useState(() => defaultGenModel(admin))
  // Only a model that can edit, and that this account may use (a stale pick falls back)
  const editModel = editList.some(m => m.id === editPick) ? editPick : defaultGenModel(admin)
  const editSpec = useMemo(() => stillModelSpec(editModel), [editModel])
  const editQ = genQuality[editModel] ?? (editSpec.defQuality || undefined)
  const editAspect = layer ? editFrame(editModel, layer.w, layer.h) : "1:1"
  const editSent = usable(editExtra, 1, editSpec.maxRefs)
  const editCost = genTickets(editModel, editQ, editAspect, 1 + editSent.length, optsFor(editModel))

  // ── upscale ──
  const [upscaler, setUpscaler] = useState<UpscalerId>("seedvr2-upscale")
  const [factor, setFactor] = useState(2)
  const canvasF = upscaleFactor(upscaler, factor, doc.width, doc.height, MAX_CANVAS_SIDE)
  const layerF = layerPx ? upscaleFactor(upscaler, factor, layerPx.w, layerPx.h, UPSCALE_MAX_SIDE) : 0

  // Each model priced at the frame it would really use
  const priced = (models: readonly { id: string; label: string }[], aspect: (id: string) => string, refs: number) =>
    models.map(m => ({ ...m, price: genTickets(m.id, genQuality[m.id] ?? (stillModelSpec(m.id).defQuality || undefined), aspect(m.id), refs) }))
  const genOptions = useMemo(() => priced(genList, aspectFor, genRef === "none" ? 0 : 1), [genList, genAspectPick, genRef, genQuality, doc.width, doc.height])  // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * Re-generate the selection (2026-10-09): the selected box goes to an image
   * model as an edit - NanoBanana 2.1 by default, any model that edits - at the
   * frame that fits the box ("auto" where the model has it), and comes back as
   * a layer masked to the selection. FLUX Fill (inpaint) stays as "Fill".
   */
  const [selMode, setSelMode] = useState<"regen" | "fill">("regen")
  const [regenPick, setRegenModel] = useState(() => defaultGenModel(admin))
  const regenModel = editList.some(m => m.id === regenPick) ? regenPick : defaultGenModel(admin)
  const regenSpec = useMemo(() => stillModelSpec(regenModel), [regenModel])
  const regenQ = genQuality[regenModel] ?? (regenSpec.defQuality || undefined)
  const regenAspect = selBox ? editFrame(regenModel, selBox.w, selBox.h) : "1:1"
  const regenSent = usable(regenExtra, 1, regenSpec.maxRefs)
  const regenCost = genTickets(regenModel, regenQ, regenAspect, 1 + regenSent.length, optsFor(regenModel))
  const runSel = () => {
    const p = fillPrompt.trim()
    if (!p) return
    onRun(selMode === "fill" ? { op: "fill", prompt: p } : { op: "regen", prompt: p, model: regenModel, quality: regenQ, options: optsFor(regenModel), refs: regenSent })
  }
  const editOptions = useMemo(() => priced(editList, id => (layer ? editFrame(id, layer.w, layer.h) : "1:1"), 1), [editList, layer?.w, layer?.h, genQuality])  // eslint-disable-line react-hooks/exhaustive-deps
  const regenOptions = useMemo(() => priced(editList, id => (selBox ? editFrame(id, selBox.w, selBox.h) : "1:1"), 1), [editList, selBox?.w, selBox?.h, genQuality])  // eslint-disable-line react-hooks/exhaustive-deps

  const area = "w-full rounded-lg bg-black/40 border border-white/12 px-2 py-1.5 text-[11.5px] text-white placeholder:text-slate-500 focus:outline-none focus:border-white/35 resize-none"
  const select = "w-full rounded-lg bg-black/40 border border-white/12 px-1.5 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:border-white/35"
  const label = (id: string) => STUDIO_IMAGE_MODELS.find(m => m.id === id)?.label ?? id
  const q = (v?: string) => (v ? (/^\dk$/.test(v) ? v.toUpperCase() : v[0].toUpperCase() + v.slice(1)) : "")
  // A group or an adjustment layer has no picture of its own to edit
  const editable = layer && (layer.kind === "raster" || layer.kind === "text" || layer.kind === "shape") ? layer : null
  const upLabel = UPSCALERS.find(u => u.id === upscaler)?.label ?? upscaler

  return (
    <div className="flex flex-col gap-3">
      {/* ── fill / remove ── */}
      <Card title="Re-generate the selection" icon={<Wand2 size={12} />}>
        {hasSel ? (
          <>
            <Seg value={selMode} options={["regen", "fill"]} labels={{ regen: "Re-generate", fill: "Fill" }} onChange={v => setSelMode(v as "regen" | "fill")} />
            <textarea ref={fillRef} rows={2} value={fillPrompt} onChange={e => setFillPrompt(e.target.value)}
              placeholder={selMode === "regen" ? "How this part should look - “make the sky stormy”, “turn the jacket red”…" : "What goes in the selection - “a stone bridge”, “clear blue sky”…"} className={area}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && fillPrompt.trim()) { e.preventDefault(); e.currentTarget.blur(); runSel() } }} />
            {selMode === "regen" && (
              <>
                <Field label="Model">
                  <select value={regenModel} onChange={e => setRegenModel(e.target.value)} className={select}>
                    {regenOptions.map(m => <option key={m.id} value={m.id}>{m.label} · {m.price} ticket{m.price === 1 ? "" : "s"}</option>)}
                  </select>
                </Field>
                {regenSpec.qualities.length > 1 && <Field label="Quality"><Seg value={regenQ ?? ""} options={regenSpec.qualities} onChange={v => setGenQuality(qq => ({ ...qq, [regenModel]: v }))} /></Field>}
                {modelSettings(regenModel)}
                <RefStrip lead={[{ src: refPreviews.selection, label: "Selection" }]} extra={regenExtra} max={regenSpec.maxRefs} model={label(regenModel)} onChange={setRegenExtra} />
              </>
            )}
            <div className="flex flex-wrap items-start gap-2">
              {selMode === "regen"
                ? <AiButton primary busy={busy === "regen"} disabled={!!busy || !fillPrompt.trim()} cost={regenCost}
                    model={[label(regenModel), q(regenQ), regenAspect === "auto" ? "Auto frame" : regenAspect].filter(Boolean).join(" · ")} onClick={runSel}>Re-generate selection</AiButton>
                : <AiButton primary busy={busy === "fill"} disabled={!!busy || !fillPrompt.trim()} cost={fillCost ?? 0} model="FLUX.1 Pro Fill" onClick={runSel}>Fill selection</AiButton>}
              <AiButton busy={busy === "erase"} disabled={!!busy} cost={ERASE_TICKETS} model="Bria Eraser" onClick={() => onRun({ op: "erase" })}>Remove object</AiButton>
            </div>
            <Hint>{selMode === "regen"
              ? "Only the selected box is sent and redrawn; it comes back as a new layer, masked to the selection - paint its mask to blend it, or hide it to compare."
              : "The result is a new layer, masked to the selection - paint its mask to blend it, or hide it to compare."}</Hint>
          </>
        ) : <Hint>Select an area first (Marquee, Lasso or AI select), then re-generate it, fill it, or remove what is in it.</Hint>}
      </Card>

      {/* ── generate a layer ── */}
      <Card title="Generate a layer" icon={<ImagePlus size={12} />}>
        <textarea rows={3} value={genPrompt} onChange={e => setGenPrompt(e.target.value)} placeholder="Describe the image…" className={area} />
        <Field label="Model">
          <select value={genModel} onChange={e => setGenModel(e.target.value)} className={select}>
            {genOptions.map(m => <option key={m.id} value={m.id}>{m.label} · {m.price} ticket{m.price === 1 ? "" : "s"}</option>)}
          </select>
        </Field>
        {genSpec.qualities.length > 1 && <Field label="Quality"><Seg value={genQ ?? ""} options={genSpec.qualities} onChange={v => setGenQuality(qq => ({ ...qq, [genModel]: v }))} /></Field>}
        <Field label="Frame"><Seg value={genAspect} options={modelAspects(genModel)} labels={{ auto: "Auto" }} onChange={setGenAspect} /></Field>
        {modelSettings(genModel)}
        {STUDIO_IMAGE_MODELS.find(m => m.id === genModel)?.refs && (
          <>
            <Field label="Reference">
              <Seg value={genRef} options={["none", "canvas", ...(editable ? ["layer"] : [])]} labels={{ none: "None", canvas: "The canvas", layer: "This layer" }} onChange={v => setGenRef(v as any)} />
            </Field>
            <RefStrip
              lead={genRefs === "canvas" ? [{ src: refPreviews.canvas, label: "Canvas" }] : genRefs === "layer" ? [{ src: refPreviews.layer, label: "This layer" }] : []}
              extra={genExtra} max={genSpec.maxRefs} model={label(genModel)} onChange={setGenExtra} />
          </>
        )}
        <AiButton primary className="w-full" size="md" busy={busy === "generate"} disabled={!!busy || !genPrompt.trim()} cost={genCost}
          model={[label(genModel), q(genQ), genAspect === "auto" ? "Auto frame" : genAspect].filter(Boolean).join(" · ")}
          onClick={() => onRun({ op: "generate", prompt: genPrompt.trim(), model: genModel, quality: genQ, aspect: genAspect, ref: genRefs === "layer" && !editable ? "none" : genRefs, options: optsFor(genModel), refs: genSent })}>
          Generate layer
        </AiButton>
      </Card>

      {/* ── edit the layer ── */}
      <Card title="Edit this layer with AI" icon={<PenLine size={12} />}>
        {editable ? (
          <>
            <textarea rows={2} value={editPrompt} onChange={e => setEditPrompt(e.target.value)} placeholder="What to change - “make it night”, “turn the jacket red”…" className={area} />
            <Field label="Model">
              <select value={editModel} onChange={e => setEditModel(e.target.value)} className={select}>
                {editOptions.map(m => <option key={m.id} value={m.id}>{m.label} · {m.price} ticket{m.price === 1 ? "" : "s"}</option>)}
              </select>
            </Field>
            {editSpec.qualities.length > 1 && <Field label="Quality"><Seg value={editQ ?? ""} options={editSpec.qualities} onChange={v => setGenQuality(qq => ({ ...qq, [editModel]: v }))} /></Field>}
            {modelSettings(editModel)}
            <RefStrip lead={[{ src: refPreviews.layer, label: "This layer" }]} extra={editExtra} max={editSpec.maxRefs} model={label(editModel)} onChange={setEditExtra} />
            <AiButton primary className="w-full" size="md" busy={busy === "edit"} disabled={!!busy || !editPrompt.trim()} cost={editCost}
              model={[label(editModel), q(editQ)].filter(Boolean).join(" · ")}
              onClick={() => onRun({ op: "edit", prompt: editPrompt.trim(), model: editModel, quality: editQ, options: optsFor(editModel), refs: editSent })}>
              <span className="truncate max-w-[150px]">Edit “{editable.name}”</span>
            </AiButton>
            <Hint>The edit comes back as a new layer in the same place, above it; the original is hidden, not deleted.</Hint>
          </>
        ) : <Hint>Pick an image, text or shape layer to edit.</Hint>}
      </Card>

      {/* ── upscale ── */}
      <Card title="Upscale" icon={<ArrowUpRight size={12} />}>
        <Field label="Upscaler"><Seg value={upscaler} options={UPSCALERS.map(u => u.id)} labels={Object.fromEntries(UPSCALERS.map(u => [u.id, u.label]))} onChange={v => setUpscaler(v as UpscalerId)} /></Field>
        <Hint>{UPSCALERS.find(u => u.id === upscaler)?.hint}</Hint>
        <Field label="Scale"><Seg value={String(factor)} options={["2", "4"]} labels={{ "2": "2×", "4": "4×" }} onChange={v => setFactor(Number(v))} /></Field>
        <div className="flex flex-wrap items-start gap-2">
          <AiButton primary busy={busy === "upscale-canvas"} disabled={!!busy || !canvasF} cost={canvasF ? upscaleTickets(upscaler, canvasF, doc.width, doc.height) : 0}
            model={`${upLabel}${canvasF ? ` · ${canvasF}×` : ""}`}
            onClick={() => onRun({ op: "upscale", target: "canvas", upscaler, factor: canvasF })}>
            Image → {canvasF ? `${Math.round(doc.width * canvasF)}×${Math.round(doc.height * canvasF)}` : "max size"}
          </AiButton>
          {layer?.kind === "raster" && layerPx && (
            <AiButton busy={busy === "upscale-layer"} disabled={!!busy || !layerF} cost={layerF ? upscaleTickets(upscaler, layerF, layerPx.w, layerPx.h) : 0}
              model={`${upLabel}${layerF ? ` · ${layerF}×` : ""}`}
              onClick={() => onRun({ op: "upscale", target: "layer", upscaler, factor: layerF })}>
              This layer
            </AiButton>
          )}
        </div>
        <Hint>The image: the canvas grows (up to {MAX_CANVAS_SIDE}px) and the upscaled picture becomes the top layer. A layer: sharper pixels in the same place.</Hint>
      </Card>

      {/* ── expand ── */}
      <Card title="Generative expand" icon={<Crop size={12} />}>
        <Hint>Crop tool (C): drag the frame past the edge of the canvas, then <b className="text-slate-300">Generative expand</b> fills the new space - {EXPAND_TICKETS} ticket, Bria Expand.</Hint>
        <button onClick={onCrop} className="silver-edge self-start flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold text-slate-100 hover:opacity-90"><Crop size={11} /> Open the crop tool</button>
      </Card>
    </div>
  )
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="silver-edge rounded-xl p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-300">{icon}</span>
        <span className="text-[11.5px] font-black tracking-tight silver-shimmer-text">{title}</span>
      </div>
      {children}
    </div>
  )
}
const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-[10px] leading-snug text-slate-500">{children}</p>
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">{label}</span>
    {children}
  </div>
)

/**
 * The references a run sends, in order (2026-10-09): first the picture the
 * tool sends itself (the canvas, this layer, the selection - a live preview),
 * then the ones added from the Refs library, My Generations or My Assets.
 * Numbered as the model gets them; past the model's limit they are greyed out
 * and not sent.
 */
function RefStrip({ lead, extra, max, model, onChange }: {
  lead: { src?: string; label: string }[]
  extra: string[]
  max: number
  model: string
  onChange: (next: string[]) => void
}) {
  /*
   * The Add menu is portalled to <body> at the button's spot (2026-10-09): drawn
   * inside the panel it was clipped by the panel's scroll box and sat under the
   * canvas. It opens upward when there is no room below, and closes on a click
   * elsewhere or a scroll.
   */
  const [menu, setMenu] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const [refsOpen, setRefsOpen] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest?.("[data-refstrip-menu]")) close() }
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close) }
  }, [menu])
  const openMenu = (btn: HTMLElement) => {
    if (menu) { setMenu(null); return }
    const r = btn.getBoundingClientRect(), W = 216, H = 84
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
    setMenu(window.innerHeight - r.bottom > H + 12 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 })
  }
  if (max <= 0) return <Hint>{model} takes no reference images.</Hint>
  const room = Math.max(0, max - lead.length)
  const addUrls = (urls: string[]) => onChange([...extra, ...urls.filter(u => !extra.includes(u))].slice(0, 16))
  const tile = "relative w-12 h-12 shrink-0 rounded-md overflow-hidden border"
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500">References</span>
        <span className="text-[9px] font-mono text-slate-500">{Math.min(lead.length + extra.length, max)}/{max}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {lead.map((l, i) => (
          <div key={`lead${i}`} className={`${tile} border-amber-300/70 bg-[repeating-conic-gradient(#1c212c_0%_25%,#141821_0%_50%)] bg-[length:10px_10px]`} title={`${l.label} - sent first, automatically`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.src ? <img src={l.src} alt="" className="absolute inset-0 w-full h-full object-contain" /> : <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-slate-500" />}
            <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-amber-300 text-[8px] font-bold leading-[14px] text-center text-black">{i + 1}</span>
            <span className="absolute inset-x-0 bottom-0 bg-black/75 px-0.5 text-[7.5px] font-semibold text-amber-100 truncate">{l.label}</span>
          </div>
        ))}
        {extra.map((u, i) => {
          const goes = i < room
          return (
            <div key={u} className={`group/r ${tile} ${goes ? "border-sky-400/70" : "border-white/10 opacity-40 grayscale"}`} title={goes ? `Sent as image ${lead.length + i + 1}` : `Not sent - ${model} takes ${max}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              {goes && <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-sky-500 text-[8px] font-bold leading-[14px] text-center text-white">{lead.length + i + 1}</span>}
              <button onClick={() => onChange(extra.filter(x => x !== u))} title="Remove" className="absolute top-0.5 left-0.5 hidden group-hover/r:flex w-3.5 h-3.5 items-center justify-center rounded-full bg-black/80 text-slate-200"><X size={8} /></button>
            </div>
          )
        })}
        <button data-refstrip-menu onClick={e => openMenu(e.currentTarget)} title="Add references" className={`${tile} border-dashed border-white/20 text-slate-400 hover:text-white hover:border-white/40 flex flex-col items-center justify-center text-[8.5px]`}>
          <Plus size={12} /> Add
        </button>
        {menu && typeof document !== "undefined" && createPortal(
          <div data-refstrip-menu className="fixed z-[10060] w-[216px] rounded-lg border border-white/15 bg-[#0b0f19] p-1 shadow-2xl"
            style={{ left: menu.left, ...(menu.top !== undefined ? { top: menu.top } : { bottom: menu.bottom }) }}>
            <button onClick={() => { setMenu(null); setRefsOpen(true) }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] text-slate-200 hover:bg-white/5"><Images size={12} /> From my Refs</button>
            <button onClick={async () => { setMenu(null); const urls = await openLibraryPicker({ max: Math.max(1, 16 - extra.length), title: "References for this run" }); if (urls.length) addUrls(urls) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] text-slate-200 hover:bg-white/5"><Library size={12} /> From My Generations &amp; My Assets</button>
          </div>,
          document.body,
        )}
      </div>
      {extra.length > room && <p className="text-[9px] text-amber-300/80">{model} takes {max} - the greyed ones are not sent.</p>}
      {refsOpen && <RefsLibraryPicker have={extra} onAdd={urls => { addUrls(urls); setRefsOpen(false) }} onClose={() => setRefsOpen(false)} />}
    </div>
  )
}

/** Pick pictures from the account's Refs library (works in the popup too - it loads them itself). */
function RefsLibraryPicker({ have, onAdd, onClose }: { have: string[]; onAdd: (urls: string[]) => void; onClose: () => void }) {
  const [refs, setRefs] = useState<{ id: number | string; url: string }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    fetch("/api/user/references").then(r => (r.ok ? r.json() : null)).then(j => {
      const list = (j?.references ?? j?.items ?? []) as { id: number | string; url: string }[]
      setRefs(list.filter(r => r.url && !/\.(mp4|mov|webm)(\?|$)/i.test(r.url) && !/\.(glb|gltf|obj|fbx)(\?|$)/i.test(r.url)))
    }).catch(() => setRefs([]))
  }, [])
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/75 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl border border-white/10 bg-[#0b0f19] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <span className="text-[13px] font-bold text-white">From my Refs</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {!refs ? <Loader2 className="mx-auto my-10 animate-spin text-slate-500" size={18} />
            : refs.length === 0 ? <p className="py-10 text-center text-[12px] text-slate-500">Your Refs library is empty.</p>
            : <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {refs.map(r => {
                  const already = have.includes(r.url)
                  const n = picked.indexOf(r.url)
                  return (
                    <button key={String(r.id)} disabled={already} onClick={() => setPicked(p => (p.includes(r.url) ? p.filter(x => x !== r.url) : [...p, r.url]))}
                      className={`relative aspect-square rounded-md overflow-hidden border-2 ${n >= 0 ? "border-white" : "border-white/10 hover:border-white/30"} ${already ? "opacity-30" : ""}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      {n >= 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-white text-[9px] font-bold leading-4 text-center text-black">{n + 1}</span>}
                      {already && <Check size={14} className="absolute inset-0 m-auto text-white" />}
                    </button>
                  )
                })}
              </div>}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-500">{picked.length} picked - added in this order</span>
          <button onClick={() => onAdd(picked)} disabled={!picked.length} className="ml-auto rounded-lg bg-white/15 border border-white/30 px-3 py-1.5 text-[11.5px] font-bold text-white hover:bg-white/20 disabled:opacity-40">Add {picked.length || ""}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Seg({ value, options, labels, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-white/10 bg-black/30 p-0.5 gap-0.5">
      {options.map(v => (
        <button key={v} onClick={() => onChange(v)} className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${value === v ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>
          {labels?.[v] ?? (/^\dk$/.test(v) ? v.toUpperCase() : v)}
        </button>
      ))}
    </div>
  )
}
