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
import { Wand2, ImagePlus, PenLine, ArrowUpRight, Crop } from "lucide-react"
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
  | { op: "erase" }
  | { op: "upscale"; target: "canvas" | "layer"; upscaler: UpscalerId; factor: number }
  | { op: "edit"; prompt: string; model: string; quality?: string; options?: Record<string, string> }
  | { op: "generate"; prompt: string; model: string; quality?: string; aspect: string; ref: "none" | "canvas" | "layer"; options?: Record<string, string> }

export function AiPanel({ admin = true, doc, layer, layerPx, hasSel, fillCost, busy, focusFill, onRun, onCrop }: {
  /** an admin account: the site's admin-only image models are offered too */
  admin?: boolean
  doc: StudioDoc
  layer: StudioLayer | null
  /** the selected raster layer's own pixel size (what an upscale of it sends) */
  layerPx: { w: number; h: number } | null
  hasSel: boolean
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
  const genCost = genTickets(genModel, genQ, genAspect, genRefs === "none" ? 0 : 1, optsFor(genModel))

  // ── edit ──
  const [editPrompt, setEditPrompt] = useState("")
  const [editPick, setEditModel] = useState(() => defaultGenModel(admin))
  // Only a model that can edit, and that this account may use (a stale pick falls back)
  const editModel = editList.some(m => m.id === editPick) ? editPick : defaultGenModel(admin)
  const editSpec = useMemo(() => stillModelSpec(editModel), [editModel])
  const editQ = genQuality[editModel] ?? (editSpec.defQuality || undefined)
  const editAspect = layer ? editFrame(editModel, layer.w, layer.h) : "1:1"
  const editCost = genTickets(editModel, editQ, editAspect, 1, optsFor(editModel))

  // ── upscale ──
  const [upscaler, setUpscaler] = useState<UpscalerId>("seedvr2-upscale")
  const [factor, setFactor] = useState(2)
  const canvasF = upscaleFactor(upscaler, factor, doc.width, doc.height, MAX_CANVAS_SIDE)
  const layerF = layerPx ? upscaleFactor(upscaler, factor, layerPx.w, layerPx.h, UPSCALE_MAX_SIDE) : 0

  // Each model priced at the frame it would really use
  const priced = (models: readonly { id: string; label: string }[], aspect: (id: string) => string, refs: number) =>
    models.map(m => ({ ...m, price: genTickets(m.id, genQuality[m.id] ?? (stillModelSpec(m.id).defQuality || undefined), aspect(m.id), refs) }))
  const genOptions = useMemo(() => priced(genList, aspectFor, genRef === "none" ? 0 : 1), [genList, genAspectPick, genRef, genQuality, doc.width, doc.height])  // eslint-disable-line react-hooks/exhaustive-deps
  const editOptions = useMemo(() => priced(editList, id => (layer ? editFrame(id, layer.w, layer.h) : "1:1"), 1), [editList, layer?.w, layer?.h, genQuality])  // eslint-disable-line react-hooks/exhaustive-deps

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
      <Card title="Generative fill" icon={<Wand2 size={12} />}>
        {hasSel ? (
          <>
            <textarea ref={fillRef} rows={2} value={fillPrompt} onChange={e => setFillPrompt(e.target.value)} placeholder="What goes in the selection - “a stone bridge”, “clear blue sky”…" className={area}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && fillPrompt.trim()) { e.preventDefault(); e.currentTarget.blur(); onRun({ op: "fill", prompt: fillPrompt.trim() }) } }} />
            <div className="flex flex-wrap items-start gap-2">
              <AiButton primary busy={busy === "fill"} disabled={!!busy || !fillPrompt.trim()} cost={fillCost ?? 0} model="FLUX.1 Pro Fill" onClick={() => onRun({ op: "fill", prompt: fillPrompt.trim() })}>Fill selection</AiButton>
              <AiButton busy={busy === "erase"} disabled={!!busy} cost={ERASE_TICKETS} model="Bria Eraser" onClick={() => onRun({ op: "erase" })}>Remove object</AiButton>
            </div>
            <Hint>The result is a new layer, masked to the selection - paint its mask to blend it, or hide it to compare.</Hint>
          </>
        ) : <Hint>Select an area first (Marquee, Lasso or AI select), then describe what should be there - or remove what is in it.</Hint>}
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
          <Field label="Reference">
            <Seg value={genRef} options={["none", "canvas", ...(editable ? ["layer"] : [])]} labels={{ none: "None", canvas: "The canvas", layer: "This layer" }} onChange={v => setGenRef(v as any)} />
          </Field>
        )}
        <AiButton primary className="w-full" size="md" busy={busy === "generate"} disabled={!!busy || !genPrompt.trim()} cost={genCost}
          model={[label(genModel), q(genQ), genAspect === "auto" ? "Auto frame" : genAspect].filter(Boolean).join(" · ")}
          onClick={() => onRun({ op: "generate", prompt: genPrompt.trim(), model: genModel, quality: genQ, aspect: genAspect, ref: genRefs === "layer" && !editable ? "none" : genRefs, options: optsFor(genModel) })}>
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
            <AiButton primary className="w-full" size="md" busy={busy === "edit"} disabled={!!busy || !editPrompt.trim()} cost={editCost}
              model={[label(editModel), q(editQ)].filter(Boolean).join(" · ")}
              onClick={() => onRun({ op: "edit", prompt: editPrompt.trim(), model: editModel, quality: editQ, options: optsFor(editModel) })}>
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
