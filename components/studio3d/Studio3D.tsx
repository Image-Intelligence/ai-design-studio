"use client"

/**
 * The 3D Production Studio (2026-10-07; replaces ThreeDStudioWorkspace).
 *
 * One workspace for the whole pipeline - Concept (pictures that make better
 * models) -> Model -> Refine -> Rig & Animate -> Worlds - with:
 *   - the Bench (left): the stage's tools as cards with what each is for and
 *     its ticket price for the chosen options, its inputs and settings;
 *   - the viewer (centre): lib-bundled three.js, fast-opening viewer copies;
 *   - the Inspector (right): the selected model - where it came from, the
 *     next steps for it, its files, exports by purpose (3D print with a
 *     watertight check and a size in mm, game, animation, AR, web), turntable
 *     capture, its animation clips and text-to-motion on it;
 *   - the Library (bottom): every model, running jobs and failures.
 * Jobs and charging: /api/employees/studio3d (lib/threed/pipeline).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import {
  Box, Loader2, Upload, X, Trash2, Download, RotateCw, Grid3x3, Camera, Video, Sparkles, Wand2, Printer, Gamepad2,
  Film, Smartphone, Globe, ChevronRight, Ticket, Clock, AlertTriangle, CheckCircle2, ImagePlus, Play, Pause, Library,
} from "lucide-react"
import { THREED_TOOLS, STAGES, PURPOSE_LABEL, getTool, toolTickets, withDefaults, clipIds, type ThreeDTool, type ThreeDStage, type Purpose, type Control } from "@/lib/threed/catalog"
import { CLIP_LIBRARY, clipLabel } from "@/lib/threed/clip-library"
import type { AssetOut } from "@/lib/threed/assets"
import type { ViewerHandle, ModelInfo, PrintReport, Backdrop } from "./Viewer3D"
import { ClipPicker } from "./ClipPicker"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { uploadImage } from "@/components/employees/StoryboardAssets"
import { gateFileInput, gateUpload } from "@/components/id-verification/IdVerificationGate"

const Viewer3D = dynamic(() => import("./Viewer3D").then(m => m.Viewer3D), { ssr: false, loading: () => <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div> })

type Job = { id: number; prompt: string; toolId: string; queuedAt: string; tickets: number }
type Failed = { id: number; prompt: string; toolId: string; error: string; at: string }
type Asset = Omit<AssetOut, "createdAt"> & { createdAt: string }

const PURPOSE_ICON: Record<Purpose, typeof Printer> = { print: Printer, game: Gamepad2, animation: Film, hero: Sparkles, fast: Clock, ar: Smartphone, web: Globe }
const meshOf = (a: Asset | null) => {
  if (!a) return null
  const meshes = a.files.filter(f => f.kind === "mesh")
  const by = (re: RegExp) => meshes.find(f => re.test(f.name))
  return by(/^rigged_character_glb/) ?? by(/^model_glb$/) ?? by(/^model_mesh$/) ?? meshes.find(f => f.ext === "glb") ?? meshes.find(f => ["fbx", "obj", "stl", "ply", "splat"].includes(f.ext)) ?? meshes[0] ?? null
}
const imagesOf = (a: Asset | null) => (a ? a.files.filter(f => f.kind === "image") : [])
const fmtBytes = (n?: number) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`) : "")
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` }

export function Studio3D({ isAdmin, refLibrary, logo, onBalanceChange, onUseFrame }: {
  isAdmin: boolean
  /** The account's Refs library - pictures to build from. */
  refLibrary: { id: string; url: string }[]
  logo?: React.ReactNode
  onBalanceChange?: (n: number) => void
  /** A rendered frame handed to the portal (to animate it with a video model, or keep it as a reference). */
  onUseFrame?: (dataUrl: string, to: "video" | "refs") => void
}) {
  const [stage, setStage] = useState<ThreeDStage>("model")
  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [toolId, setToolId] = useState<string>("meshy-7.1-image")
  const [prompt, setPrompt] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [options, setOptions] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [failed, setFailed] = useState<Failed[]>([])
  const [more, setMore] = useState(false)
  const [selId, setSelId] = useState<number | null>(null)
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [backdrop, setBackdrop] = useState<Backdrop>("studio")
  const [spin, setSpin] = useState(false)
  const [wire, setWire] = useState(false)
  const [clip, setClip] = useState<string | null>(null)
  const [motionIds, setMotionIds] = useState<number[]>([])
  const [picker, setPicker] = useState<"refs" | "clips" | null>(null)
  const [preparing, setPreparing] = useState<number | null>(null)
  const [heightMm, setHeightMm] = useState(120)
  const [report, setReport] = useState<PrintReport | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [conceptPrompt, setConceptPrompt] = useState("")
  const viewer = useRef<ViewerHandle>(null)
  const postered = useRef(new Set<number>())

  const tool = getTool(toolId) ?? THREED_TOOLS[0]
  const sel = assets.find(a => a.id === selId) ?? null
  const selMesh = meshOf(sel)
  const tickets = toolTickets(tool, options, images.length)

  // ── data ──
  const load = useCallback(async (append = false) => {
    const before = append && assets.length ? `?before=${assets[assets.length - 1].id}` : ""
    const r = await fetch(`/api/employees/studio3d${before}`).catch(() => null)
    const j = r?.ok ? await r.json() : null
    if (!j) return
    setJobs(j.jobs); setFailed(j.failed); setMore(j.more)
    setAssets(cur => {
      const next = append ? [...cur, ...j.assets.filter((a: Asset) => !cur.some(c => c.id === a.id))] : [...j.assets, ...cur.filter(c => !j.assets.some((a: Asset) => a.id === c.id) && c.id < (j.assets.at(-1)?.id ?? 0))]
      return next
    })
    setSelId(id => id ?? j.assets[0]?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length])
  useEffect(() => { void load() // first page
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Poll while anything runs (the server settles finished jobs on each poll)
  useEffect(() => {
    if (!jobs.length) return
    const h = setInterval(() => { void load() }, 8000)
    return () => clearInterval(h)
  }, [jobs.length, load])

  // A tool picked: its own defaults
  useEffect(() => { setOptions({}); setNote(null) }, [toolId])
  // A stage picked: its first tool (that fits the purpose)
  useEffect(() => {
    const first = THREED_TOOLS.find(t => t.stage === stage && (!purpose || t.purposes.includes(purpose)) && (isAdmin || !t.admin))
    if (first && getTool(toolId)?.stage !== stage) setToolId(first.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // An old asset (fal links, no viewer copy) or a viewer copy that failed: prepared once, on open
  useEffect(() => {
    if (!sel || preparing === sel.id) return
    const glb = selMesh?.ext === "glb"
    if (!sel.legacy && (sel.viewer || !glb)) return
    setPreparing(sel.id)
    fetch(`/api/employees/studio3d/${sel.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "prepare" }) })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.asset) setAssets(cur => cur.map(a => (a.id === j.asset.id ? j.asset : a))) })
      .finally(() => setPreparing(null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sel?.legacy, sel?.viewer?.url])

  const src = useMemo(() => {
    if (!sel || preparing === sel.id) return null
    if (sel.viewer) return { url: sel.viewer.url, ext: "glb", key: `viewer-${sel.id}` }
    const m = selMesh
    return m && ["glb", "gltf", "fbx", "obj", "stl", "ply", "splat"].includes(m.ext) ? { url: m.url, ext: m.ext, key: `file-${sel.id}-${m.name}` } : null
  }, [sel, selMesh, preparing])

  // Motion clips made here, applied to the character on screen
  const motions = assets.filter(a => a.toolId === "hunyuan-motion" && a.files.some(f => f.ext === "fbx"))
  const [applied, setApplied] = useState<number[]>([])
  const extraClips = useMemo(() => {
    const fromMotion = applied.map(id => assets.find(a => a.id === id)).filter(Boolean).map(a => {
      const f = a!.files.find(x => x.ext === "fbx")!
      return { name: `Motion: ${a!.prompt.slice(0, 40)}`, url: f.url, ext: "fbx" }
    })
    // An "Animation clips" result: each clip is its own GLB on the same rig
    const own = sel ? sel.files.filter(f => f.kind === "mesh" && f.ext === "glb" && /^(animations\.\d+|basic_animations\.)/.test(f.name) && !/armature/i.test(f.name)).map(f => ({ name: clipName(f.name, sel.clipIds), url: f.url, ext: "glb" })) : []
    return [...own, ...fromMotion]
  }, [applied, assets, sel])

  // A model with no picture yet: the viewer's own render becomes its poster
  const onInfo = useCallback((i: ModelInfo | null) => {
    setInfo(i)
    // A clip arriving later (library, motion) must not reset the one being watched
    setClip(cur => (cur && i?.clips.includes(cur) ? cur : i?.clips[0] ?? null))
    setReport(null)
    if (!i || !sel || sel.poster || postered.current.has(sel.id)) return
    postered.current.add(sel.id)
    setTimeout(() => {
      const shot = viewer.current?.snapshot(640)
      if (!shot) return
      fetch(`/api/employees/studio3d/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ poster: shot }) })
        .then(r => r.ok ? r.json() : null).then(j => { if (j?.asset) setAssets(cur => cur.map(a => (a.id === j.asset.id ? j.asset : a))) })
    }, 700)
  }, [sel])

  // ── running a tool ──
  const needsMesh = !!tool.needs.mesh
  // A tool that takes one file type only gets that file of the asset (Hunyuan Part: FBX)
  const toolMesh = tool.needs.meshExt ? (sel?.files.find(f => f.kind === "mesh" && tool.needs.meshExt!.includes(f.ext)) ?? null) : selMesh
  const run = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const body = {
        toolId: tool.id, prompt: prompt.trim() || undefined, images: tool.needs.images ? images : [],
        mesh: needsMesh ? toolMesh?.url : undefined,
        options: tool.id === "meshy-animate" ? { ...options, animation_action_ids: motionIds.join(",") } : options,
        parentId: needsMesh ? sel?.id : undefined,
      }
      const r = await fetch("/api/employees/studio3d", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Could not start")
      setJobs(cur => [{ id: j.job.id, prompt: j.job.prompt, toolId: j.job.toolId, queuedAt: new Date().toISOString(), tickets: j.job.tickets }, ...cur])
      setNote({ ok: true, text: `${tool.label} started - about ${tool.minutes < 1 ? "a minute" : `${Math.ceil(tool.minutes)} minutes`}. It keeps going if you leave.` })
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message || e) })
    } finally { setBusy(false) }
  }
  const missing = (() => {
    const n = tool.needs
    if (n.prompt === "required" && !prompt.trim()) return "Describe it first"
    if (n.images && images.length < n.images.min) return n.images.min === 1 ? "Add a picture" : `Add ${n.images.min} pictures`
    if (needsMesh && !selMesh) return "Pick a model in the library"
    // A Gaussian splat or a world is a cloud of points, not a surface the mesh tools can work on
    if (needsMesh && (sel?.toolId === "triposplat" || sel?.toolId === "hunyuan-world" || selMesh?.ext === "splat")) return "Pick a mesh - splats and worlds can't be refined"
    if (needsMesh && !toolMesh) return `Needs a ${tool.needs.meshExt!.join("/").toUpperCase()} - run Clean topology with Quads first`
    if (tool.id === "meshy-animate" && !motionIds.length) return "Pick clips from the library"
    const opts = withDefaults(tool, options)
    const req = tool.controls.find(c => c.required && !opts[c.key])
    return req ? `Set ${req.label}` : null
  })()

  // Concept art through the Image Studio's AI (charged and moderated there)
  const makeConcept = async () => {
    if (!conceptPrompt.trim() || working) return
    setWorking("concept"); setNote(null)
    try {
      const r = await fetch("/api/employees/image-studio/edit/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "generate", model: "nano-banana-2.1", quality: "2k", aspect: "1:1", prompt: `${conceptPrompt.trim()}. 3D-ready concept: the whole subject in frame, isolated on a plain light grey background, even soft lighting, no text, no other objects.` }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "The picture failed")
      setImages(cur => [...cur, j.url].slice(-6))
      if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
      setNote({ ok: true, text: "Concept added to the pictures - pick a Model tool to build it" })
    } catch (e: any) { setNote({ ok: false, text: String(e?.message || e) }) } finally { setWorking(null) }
  }

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setWorking("upload")
    try { for (const f of Array.from(files).slice(0, 6)) { const url = await uploadImage(f); setImages(cur => [...cur, url].slice(-6)) } }
    catch (e: any) { setNote({ ok: false, text: String(e?.message || e) }) } finally { setWorking(null) }
  }

  const removeAsset = async (id: number) => {
    await fetch(`/api/employees/studio3d/${id}`, { method: "DELETE" }).catch(() => {})
    setAssets(cur => cur.filter(a => a.id !== id))
    if (selId === id) setSelId(null)
  }

  // ── exports & captures ──
  const save = (blob: Blob, name: string) => {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob); a.download = name
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  const base = (sel?.prompt || sel?.toolLabel || "model").replace(/[^a-z0-9]+/gi, "-").slice(0, 40).replace(/^-|-$/g, "") || "model"
  const doExport = async (fmt: "glb" | "stl" | "obj" | "usdz") => {
    setWorking(fmt)
    try { const b = await viewer.current?.exportAs(fmt, { heightMm }); if (b) save(b, `${base}.${fmt}`) } finally { setWorking(null) }
  }
  const doCheck = async () => { setWorking("check"); try { setReport(await viewer.current?.printCheck(heightMm) ?? null) } finally { setWorking(null) } }
  const doRecord = async () => {
    setWorking("record")
    try { const b = await viewer.current?.record(6); if (b) save(b, `${base}-turntable.${b.type.includes("mp4") ? "mp4" : "webm"}`) } finally { setWorking(null) }
  }
  const doFrame = (to: "video" | "refs") => { const shot = viewer.current?.snapshot(1600); if (shot) onUseFrame?.(shot, to) }

  /** The next steps a model is ready for. */
  const nextSteps: { label: string; tool: string; stage: ThreeDStage; why: string }[] = sel && selMesh ? [
    { label: "Clean topology", tool: "tripo-remesh", stage: "refine", why: "Game-ready face budget" },
    { label: "Retexture", tool: "meshy-6-lite-retexture", stage: "refine", why: "New material, same shape" },
    { label: "Auto-rig", tool: "meshy-rig", stage: "rig", why: "Humanoid skeleton" },
    { label: "Animate", tool: "meshy-animate", stage: "rig", why: "Clips from the library" },
    { label: "Split for print", tool: "hi3d-split", stage: "refine", why: "Parts with joints" },
    { label: "Multicolour print", tool: "hi3d-multicolor", stage: "refine", why: "Colour regions" },
  ] : []
  const go = (s: { tool: string; stage: ThreeDStage }) => { setStage(s.stage); setToolId(s.tool) }

  const stageTools = THREED_TOOLS.filter(t => t.stage === stage && (isAdmin || !t.admin) && (!purpose || t.purposes.includes(purpose)))
  const pics = [...new Set([...images])]
  const libraryPics = [...refLibrary.map(r => r.url), ...assets.flatMap(a => imagesOf(a).map(f => f.url))].slice(0, 60)

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#05080f] text-slate-200">
      {/* ── top bar ── */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-white/5 shrink-0">
        {logo}
        <div className="min-w-0">
          <div className="text-[9px] font-mono uppercase tracking-[0.24em] text-slate-500">AI Design Studio</div>
          <div className="text-base sm:text-lg font-black tracking-tight silver-shimmer-text silver-shimmer-text-slow leading-tight">3D Production Studio</div>
        </div>
        <div className="ml-2 flex items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STAGES.map((s, k) => (
            <button key={s.id} onClick={() => setStage(s.id)} title={s.blurb}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-colors ${stage === s.id ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
              <span className={`w-4 h-4 rounded-full text-[9px] font-mono flex items-center justify-center ${stage === s.id ? "bg-white text-black" : "bg-white/10"}`}>{k + 1}</span>
              {s.label}
              {stage === s.id && <SilverRimOverlay rounded="rounded-xl" />}
            </button>
          ))}
        </div>
        <div className="ml-auto hidden md:flex items-center gap-2 text-[10.5px] font-mono text-slate-500">
          {jobs.length > 0 && <span className="flex items-center gap-1 text-slate-300"><Loader2 size={11} className="animate-spin" />{jobs.length} running</span>}
          <span>{assets.length}{more ? "+" : ""} models</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* ── the bench ── */}
        <aside className="lg:w-[360px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 overflow-y-auto p-3 space-y-3 max-h-[46dvh] lg:max-h-none">
          <p className="text-[11px] text-slate-500">{STAGES.find(s => s.id === stage)?.blurb}</p>
          {(stage === "model" || stage === "refine") && (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setPurpose(null)} className={`px-2 py-0.5 rounded-full border text-[10.5px] ${!purpose ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-slate-400"}`}>Any use</button>
              {(["print", "game", "animation", "hero", "fast"] as Purpose[]).map(p => {
                const I = PURPOSE_ICON[p]
                return <button key={p} onClick={() => setPurpose(purpose === p ? null : p)} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] ${purpose === p ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}><I size={10} />{PURPOSE_LABEL[p]}</button>
              })}
            </div>
          )}

          {stage === "concept" && (
            <div className="silver-edge rounded-xl p-2.5 space-y-2">
              <BrandTitle title="Concept art" eyebrow="NanoBanana 2.1 · made for 3D" logo={16} size="sm" />
              <textarea value={conceptPrompt} onChange={e => setConceptPrompt(e.target.value)} rows={3} placeholder="A stylised knight in blue armour, T-pose, front view…" className="sb-input w-full" />
              <BrandButton onClick={makeConcept} disabled={!conceptPrompt.trim() || !!working} busy={working === "concept"} size="xs" primary className="w-full">
                Make the concept <span className="flex items-center gap-0.5 font-mono text-slate-700"><Ticket size={10} />3</span>
              </BrandButton>
              <p className="text-[10px] text-slate-500 leading-snug">Comes out isolated on a plain background, whole subject in frame - what image-to-3D models need.</p>
            </div>
          )}

          {/* the stage's tools */}
          <div className="grid grid-cols-1 gap-1.5">
            {stageTools.map(t => {
              const on = t.id === tool.id
              return (
                <button key={t.id} onClick={() => setToolId(t.id)} className={`relative rounded-xl border px-3 py-2 text-left transition-colors ${on ? "border-white/40 bg-white/[0.07]" : "border-white/[0.07] hover:border-white/25"}`}>
                  {on && <SilverRimOverlay rounded="rounded-xl" />}
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-bold text-slate-100">{t.label}</span>
                    <span className="text-[9.5px] text-slate-500">{t.family}</span>
                    <span className="ml-auto flex items-center gap-0.5 text-[10px] font-mono text-slate-300"><Ticket size={9} />{toolTickets(t, on ? options : {}, on ? images.length : 0)}</span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-slate-400 line-clamp-2">{t.bestFor}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.purposes.slice(0, 3).map(p => <span key={p} className="px-1.5 rounded-full bg-white/[0.05] text-[9px] text-slate-400">{PURPOSE_LABEL[p]}</span>)}
                    <span className="px-1.5 rounded-full bg-white/[0.05] text-[9px] text-slate-500">~{t.minutes < 1 ? "<1" : Math.ceil(t.minutes)} min</span>
                  </div>
                </button>
              )
            })}
            {!stageTools.length && <p className="text-[11px] text-slate-500">No tool here for that use - clear the filter.</p>}
          </div>

          {/* the tool's inputs */}
          <div className="silver-edge rounded-xl p-2.5 space-y-2.5">
            <BrandTitle title={tool.label} eyebrow={tool.output} logo={16} size="sm" />
            {tool.caveat && <p className="flex gap-1.5 text-[10.5px] text-amber-200/80 leading-snug"><AlertTriangle size={11} className="shrink-0 mt-0.5" />{tool.caveat}</p>}
            {needsMesh && (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-1.5">
                <div className="w-10 h-10 rounded-md bg-white/5 overflow-hidden shrink-0">{/* eslint-disable-next-line @next/next/no-img-element */}{sel?.poster ? <img src={sel.poster} alt="" className="w-full h-full object-cover" /> : <Box size={16} className="m-3 text-slate-600" />}</div>
                <div className="min-w-0 text-[10.5px]">
                  <p className="font-semibold text-slate-200 truncate">{sel ? sel.prompt || sel.toolLabel : "No model picked"}</p>
                  <p className="text-slate-500">{selMesh ? `Works on this model (${selMesh.ext.toUpperCase()})` : "Pick a model in the library below"}</p>
                </div>
              </div>
            )}
            {tool.needs.images && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1">Pictures {tool.needs.images.max > 1 ? `(${tool.needs.images.min}-${tool.needs.images.max}${tool.id.includes("multi") || tool.id === "hunyuan-3.1-pro" ? ": front first, then other angles" : ""})` : ""}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pics.map((u, k) => (
                    <div key={u} className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 px-1 text-[8.5px] font-mono bg-black/70">{k + 1}</span>
                      <button onClick={() => setImages(cur => cur.filter(x => x !== u))} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center"><X size={9} /></button>
                    </div>
                  ))}
                  <label className="w-14 h-14 rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center text-[9px] text-slate-400 cursor-pointer hover:border-white/40">
                    {working === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}Upload
                    <input type="file" onClick={gateFileInput} accept="image/*" multiple className="hidden" onChange={e => { void upload(e.target.files); e.target.value = "" }} />
                  </label>
                  <button onClick={() => setPicker("refs")} className="w-14 h-14 rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center text-[9px] text-slate-400 hover:border-white/40"><ImagePlus size={13} />Library</button>
                </div>
              </div>
            )}
            {tool.needs.prompt && (
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={tool.needs.prompt === "required" ? 3 : 2}
                placeholder={tool.stage === "rig" ? "A knight draws a sword, spins and bows…" : tool.needs.prompt === "required" ? "Describe it…" : "Optional - steer the texture or style"} className="sb-input w-full" />
            )}
            {tool.id === "meshy-animate" && (
              <div className="space-y-1">
                <BrandButton onClick={() => setPicker("clips")} size="xs" className="w-full"><Library size={11} />Choose clips ({motionIds.length}/10)</BrandButton>
                {motionIds.length > 0 && <p className="text-[10px] text-slate-400 leading-snug">{motionIds.map(id => clipLabel(CLIP_LIBRARY.find(c => c[0] === id)?.[1] ?? String(id))).join(" · ")}</p>}
              </div>
            )}
            {tool.controls.filter(c => c.key !== "animation_action_ids" && (!c.when || withDefaults(tool, options)[c.when.key] === c.when.is)).map(c => (
              <ControlField key={c.key} c={c} value={withDefaults(tool, options)[c.key]} onChange={v => setOptions(o => ({ ...o, [c.key]: v }))} />
            ))}
            {note && <p className={`text-[11px] leading-snug ${note.ok ? "text-emerald-300" : "text-red-300"}`}>{note.text}</p>}
            <BrandButton onClick={run} disabled={busy || !!missing} busy={busy} primary size="sm" className="w-full" title={missing ?? undefined}>
              {missing ?? `Run ${tool.label}`}
              {!missing && <span className="flex items-center gap-0.5 font-mono text-slate-700"><Ticket size={11} />{tickets}</span>}
            </BrandButton>
          </div>
        </aside>

        {/* ── the viewer ── */}
        <main className="relative flex-1 min-w-0 min-h-[42dvh] lg:min-h-0 flex flex-col">
          <div className="relative flex-1 min-h-0 m-2 rounded-2xl overflow-hidden border border-white/10">
            <SilverRimOverlay />
            {sel && !src && imagesOf(sel).length > 0 && !selMesh ? (
              <div className="absolute inset-0 overflow-auto p-3 grid grid-cols-2 lg:grid-cols-3 gap-2 content-start bg-[#0b0f19]">
                {imagesOf(sel).map(f => (
                  <figure key={f.url} className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" className="w-full aspect-square object-contain" />
                    <figcaption className="flex items-center gap-1 p-1.5 text-[10px] text-slate-400">
                      <span className="truncate">{f.name.replace(/^images\.(\d+)$/, "Picture $1")}</span>
                      <button onClick={() => setImages(cur => [...cur, f.url].slice(-6))} className="ml-auto px-1.5 py-0.5 rounded border border-white/15 text-slate-200 hover:bg-white/10">Use</button>
                      <a href={f.url} download target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded border border-white/15 hover:bg-white/10"><Download size={10} /></a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <Viewer3D ref={viewer} src={src} poster={sel?.poster} extraClips={extraClips} backdrop={backdrop} autoRotate={spin} wireframe={wire} onInfo={onInfo} className="absolute inset-0" />
            )}
            {preparing === sel?.id && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b0f19]/80 text-[11px] text-slate-300">
                <Loader2 className="animate-spin" />Copying this model to your library and making a fast-loading copy - once
              </div>
            )}
            {!sel && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6">
                <Box size={28} className="text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">Nothing on the stage yet</p>
                <p className="text-[12px] text-slate-500 max-w-sm">Start in Concept with a picture, or go straight to Model with one of your own.</p>
              </div>
            )}
            {/* viewer tools */}
            {src && (
              <div className="absolute top-2 left-2 flex items-center gap-1">
                {[
                  { on: spin, set: () => setSpin(s => !s), icon: RotateCw, t: "Turntable" },
                  { on: wire, set: () => setWire(w => !w), icon: Grid3x3, t: "Wireframe" },
                ].map(b => <button key={b.t} onClick={b.set} title={b.t} className={`w-8 h-8 rounded-lg border flex items-center justify-center ${b.on ? "border-white/50 bg-white/15 text-white" : "border-white/10 bg-black/50 text-slate-300 hover:text-white"}`}><b.icon size={14} /></button>)}
                <select value={backdrop} onChange={e => setBackdrop(e.target.value as Backdrop)} className="h-8 rounded-lg border border-white/10 bg-black/60 px-1.5 text-[11px] text-slate-200">
                  <option value="studio">Studio</option><option value="grey">Grey</option><option value="white">White</option><option value="black">Black</option>
                </select>
              </div>
            )}
            {info && (
              <div className="absolute top-2 right-2 rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-mono text-slate-300 text-right">
                {info.triangles.toLocaleString()} tris · {info.materials} mat{info.materials === 1 ? "" : "s"}{info.skinned ? " · rigged" : ""}
              </div>
            )}
            {info && info.clips.length > 0 && (
              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
                <button onClick={() => { const n = clip ? null : info.clips[0]; setClip(n); viewer.current?.playClip(n) }} className="shrink-0 w-8 h-8 rounded-lg border border-white/15 bg-black/60 flex items-center justify-center">{clip ? <Pause size={13} /> : <Play size={13} />}</button>
                {info.clips.map(c => (
                  <button key={c} onClick={() => { setClip(c); viewer.current?.playClip(c) }} className={`shrink-0 px-2 h-8 rounded-lg border text-[10.5px] ${clip === c ? "border-white/60 bg-white/15 text-white" : "border-white/10 bg-black/60 text-slate-300"}`}>{c.replace(/^Motion: /, "✦ ")}</button>
                ))}
              </div>
            )}
          </div>

          {/* ── the library ── */}
          <div className="shrink-0 h-[118px] mx-2 mb-2 rounded-2xl border border-white/10 bg-black/30 flex items-stretch gap-1.5 p-1.5 overflow-x-auto">
            {jobs.map(j => (
              <div key={`j${j.id}`} className="relative shrink-0 w-[96px] rounded-xl border border-white/10 bg-white/[0.03] flex flex-col items-center justify-center gap-1 p-1 text-center">
                <SilverRimOverlay rounded="rounded-xl" />
                <Loader2 size={15} className="animate-spin text-slate-300" />
                <span className="text-[9.5px] font-semibold text-slate-200 line-clamp-2">{getTool(j.toolId)?.label ?? j.toolId}</span>
                <span className="text-[9px] font-mono text-slate-500">{ago(j.queuedAt)}</span>
              </div>
            ))}
            {failed.map(f => (
              <div key={`f${f.id}`} title={f.error} className="shrink-0 w-[96px] rounded-xl border border-red-400/30 bg-red-500/[0.06] flex flex-col items-center justify-center gap-1 p-1 text-center">
                <AlertTriangle size={14} className="text-red-300" />
                <span className="text-[9.5px] text-red-100 line-clamp-1">{getTool(f.toolId)?.label ?? f.toolId}</span>
                <span className="text-[8.5px] text-red-200/70 line-clamp-2">{f.error}</span>
              </div>
            ))}
            {assets.map(a => (
              <button key={a.id} onClick={() => setSelId(a.id)} title={`${a.toolLabel}${a.prompt ? ` - ${a.prompt}` : ""}`}
                className={`group relative shrink-0 w-[96px] rounded-xl overflow-hidden border text-left ${selId === a.id ? "border-white ring-1 ring-white/60" : "border-white/10 hover:border-white/30"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.poster ? <img src={a.poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <Box size={18} className="absolute inset-0 m-auto text-slate-600" />}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1 text-[9px] font-semibold text-slate-100 truncate">{a.toolLabel}</span>
                <span onClick={e => { e.stopPropagation(); void removeAsset(a.id) }} className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/70 hidden group-hover:flex items-center justify-center text-slate-300 hover:text-red-300"><Trash2 size={10} /></span>
              </button>
            ))}
            {more && <button onClick={() => void load(true)} className="shrink-0 w-[96px] rounded-xl border border-dashed border-white/15 text-[10px] text-slate-400 hover:text-white">Load more</button>}
            {!jobs.length && !failed.length && !assets.length && <p className="m-auto text-[11px] text-slate-500">Your models appear here</p>}
          </div>
        </main>

        {/* ── the inspector ── */}
        <aside className="lg:w-[330px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/5 overflow-y-auto p-3 space-y-3">
          {!sel ? <p className="text-[11.5px] text-slate-500">Pick a model to see its details, next steps and exports.</p> : (
            <>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500">{sel.toolLabel}</p>
                <p className="text-[13px] font-bold text-slate-100 leading-snug line-clamp-3">{sel.prompt || "Untitled model"}</p>
                {sel.parentId && <button onClick={() => setSelId(sel.parentId)} className="mt-0.5 text-[10.5px] text-slate-400 hover:text-white">Made from model #{sel.parentId} <ChevronRight size={10} className="inline" /></button>}
                {info && <p className="mt-1 text-[10.5px] font-mono text-slate-500">{info.triangles.toLocaleString()} triangles · {info.vertices.toLocaleString()} vertices{info.bones.length ? ` · ${info.bones.length} bones` : ""}</p>}
              </div>

              {nextSteps.length > 0 && (
                <div className="silver-edge rounded-xl p-2.5 space-y-1.5">
                  <BrandTitle title="Next steps" logo={14} size="sm" />
                  <div className="grid grid-cols-2 gap-1">
                    {nextSteps.map(s => (
                      <button key={s.tool} onClick={() => go(s)} className="rounded-lg border border-white/10 px-2 py-1.5 text-left hover:border-white/30">
                        <span className="block text-[11px] font-semibold text-slate-100">{s.label}</span>
                        <span className="block text-[9.5px] text-slate-500">{s.why}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {info?.skinned && (
                <div className="silver-edge rounded-xl p-2.5 space-y-1.5">
                  <BrandTitle title="Motion" eyebrow="Text-to-motion clips on this character" logo={14} size="sm" />
                  {motions.length === 0 ? <p className="text-[10.5px] text-slate-500">Make one in Rig & Animate - "Text to motion" - then apply it here.</p> : motions.slice(0, 8).map(m => (
                    <label key={m.id} className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                      <input type="checkbox" className="accent-slate-300" checked={applied.includes(m.id)} onChange={e => setApplied(cur => e.target.checked ? [...cur, m.id] : cur.filter(x => x !== m.id))} />
                      <span className="truncate">{m.prompt}</span>
                    </label>
                  ))}
                  <button onClick={() => { setStage("rig"); setToolId("hunyuan-motion") }} className="text-[10.5px] text-slate-400 hover:text-white">+ New motion from text</button>
                </div>
              )}

              {src && (
                <div className="silver-edge rounded-xl p-2.5 space-y-2">
                  <BrandTitle title="Export" eyebrow="By what it is for" logo={14} size="sm" />
                  <div className="rounded-lg border border-white/10 p-2 space-y-1.5">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-100"><Printer size={12} />3D printing</p>
                    <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
                      Height <input type="number" min={5} max={2000} value={heightMm} onChange={e => setHeightMm(Math.max(5, Number(e.target.value) || 100))} className="sb-input w-20 py-0.5" /> mm
                    </div>
                    <div className="flex gap-1">
                      <BrandButton onClick={doCheck} size="xs" busy={working === "check"}>Print check</BrandButton>
                      <BrandButton onClick={() => doExport("stl")} size="xs" primary busy={working === "stl"}>STL</BrandButton>
                      <BrandButton onClick={() => doExport("obj")} size="xs" busy={working === "obj"}>OBJ</BrandButton>
                    </div>
                    {report && (
                      <p className={`flex gap-1.5 text-[10.5px] leading-snug ${report.watertight ? "text-emerald-300" : "text-amber-200"}`}>
                        {report.watertight ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
                        {report.watertight ? "Watertight - ready to slice." : `${report.openEdges.toLocaleString()} open and ${report.nonManifoldEdges.toLocaleString()} non-manifold edges - most slicers repair this; for a clean print run "Clean topology" first.`}
                        {` ${report.sizeMm.x.toFixed(0)} × ${report.sizeMm.z.toFixed(0)} × ${report.sizeMm.y.toFixed(0)} mm.`}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => doExport("glb")} className="rounded-lg border border-white/10 px-2 py-1.5 text-left hover:border-white/30"><span className="flex items-center gap-1 text-[11px] font-semibold text-slate-100"><Gamepad2 size={11} />Game / web</span><span className="text-[9.5px] text-slate-500">GLB{info?.clips.length ? " with clips" : ""}</span></button>
                    <button onClick={() => doExport("usdz")} className="rounded-lg border border-white/10 px-2 py-1.5 text-left hover:border-white/30"><span className="flex items-center gap-1 text-[11px] font-semibold text-slate-100"><Smartphone size={11} />AR (iPhone)</span><span className="text-[9.5px] text-slate-500">USDZ</span></button>
                  </div>
                </div>
              )}

              {src && (
                <div className="silver-edge rounded-xl p-2.5 space-y-1.5">
                  <BrandTitle title="Shoot" eyebrow="Turntables and frames" logo={14} size="sm" />
                  <div className="flex flex-wrap gap-1">
                    <BrandButton onClick={doRecord} size="xs" busy={working === "record"}><Video size={11} />Turntable (6s)</BrandButton>
                    <BrandButton onClick={() => { const s = viewer.current?.snapshot(2048); if (s) fetch(s).then(r => r.blob()).then(b => save(b, `${base}.webp`)) }} size="xs"><Camera size={11} />Still</BrandButton>
                  </div>
                  {onUseFrame && (
                    <div className="flex flex-wrap gap-1">
                      <BrandButton onClick={() => doFrame("video")} size="xs"><Wand2 size={11} />Animate this frame</BrandButton>
                      <BrandButton onClick={() => doFrame("refs")} size="xs"><ImagePlus size={11} />To my Refs</BrandButton>
                    </div>
                  )}
                  <p className="text-[9.5px] text-slate-500 leading-snug">"Animate this frame" opens it in the video models - a cinematic shot of your model, with sound if the model makes it.</p>
                </div>
              )}

              <div className="silver-edge rounded-xl p-2.5 space-y-1">
                <BrandTitle title="Original files" eyebrow="Full quality, as the model made them" logo={14} size="sm" />
                {sel.files.filter(f => f.kind !== "image" || sel.files.length < 6).slice(0, 24).map(f => (
                  <a key={f.url + f.name} href={f.url} download target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[10.5px] hover:bg-white/5">
                    <Download size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate text-slate-300">{prettyFile(f.name)}</span>
                    <span className="ml-auto shrink-0 font-mono text-slate-500">{f.ext.toUpperCase()} {fmtBytes(f.bytes)}</span>
                  </a>
                ))}
                {sel.partNames?.length ? <p className="text-[10px] text-slate-500">Parts: {sel.partNames.join(", ")}</p> : null}
              </div>
              <button onClick={() => removeAsset(sel.id)} className="flex items-center gap-1 text-[10.5px] text-slate-500 hover:text-red-300"><Trash2 size={11} />Remove from library</button>
            </>
          )}
        </aside>
      </div>

      {picker === "clips" && <ClipPicker picked={motionIds} onChange={setMotionIds} onClose={() => setPicker(null)} />}
      {picker === "refs" && (
        <div className="fixed inset-0 z-[10000] bg-black/75 flex items-center justify-center p-3" onClick={e => { if (e.target === e.currentTarget) setPicker(null) }}>
          <div className="silver-edge w-full max-w-[760px] max-h-[80dvh] rounded-2xl p-4 flex flex-col gap-3">
            <BrandTitle title="Your pictures" eyebrow="Refs library and pictures made here" logo={20} size="sm" right={<button onClick={() => setPicker(null)} className="text-slate-400 hover:text-white"><X size={15} /></button>} />
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-4 sm:grid-cols-6 gap-1.5 content-start">
              {libraryPics.map(u => (
                <button key={u} onClick={() => { setImages(cur => cur.includes(u) ? cur : [...cur, u].slice(-6)); setPicker(null) }} className="aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
              {!libraryPics.length && <p className="col-span-full text-[11px] text-slate-500">No pictures yet - upload one, or make a concept.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ControlField({ c, value, onChange }: { c: Control; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">{c.label}</p>
      {c.kind === "select" ? (
        <div className="flex flex-wrap gap-1">
          {c.options!.map(o => (
            <button key={String(o.value)} onClick={() => onChange(o.value)} className={`px-2 py-1 rounded-md border text-[10.5px] ${String(value) === String(o.value) ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>{o.label}</button>
          ))}
        </div>
      ) : c.kind === "toggle" ? (
        <button onClick={() => onChange(!(value === true || value === "true"))} className={`px-2.5 py-1 rounded-md border text-[10.5px] ${value === true || value === "true" ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-slate-400"}`}>{value === true || value === "true" ? "On" : "Off"}</button>
      ) : c.kind === "number" ? (
        <input type="number" value={value === undefined ? "" : String(value)} min={c.min} max={c.max} placeholder={c.def === undefined ? "Auto" : String(c.def)} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="sb-input w-full" />
      ) : (
        <input value={String(value ?? "")} placeholder={c.placeholder} onChange={e => onChange(e.target.value)} className="sb-input w-full" />
      )}
      {c.help && <p className="text-[9.5px] text-slate-500 mt-0.5 leading-snug">{c.help}</p>}
    </div>
  )
}

/** "rigged_character_glb" -> "Rigged character"; "model_urls.stl" -> "Model (STL)"; "animations.0.animation_glb_url" -> "Clip 1" */
function prettyFile(name: string) {
  const m = name.match(/^animations\.(\d+)/)
  if (m) return `Clip ${Number(m[1]) + 1}`
  return name.replace(/^model_urls\./, "model ").replace(/^basic_animations\./, "").replace(/_url$/, "").replace(/[._]/g, " ").replace(/\b(glb|fbx|obj|stl|usdz)\b/gi, "").trim().replace(/^./, c => c.toUpperCase()) || name
}
function clipName(name: string, ids?: number[]) {
  const m = name.match(/^animations\.(\d+)/)
  if (m) {
    // Named from the motion library when the run's clip ids are known
    const id = ids?.[Number(m[1])]
    const lib = id !== undefined ? CLIP_LIBRARY.find(c => c[0] === id) : undefined
    return lib ? clipLabel(lib[1]) : `Clip ${Number(m[1]) + 1}`
  }
  return name.replace(/^basic_animations\./, "").replace(/_(glb|fbx)(_url)?$/i, "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
}
