"use client"

/**
 * Image Studio (portal-v2 Studios, admin-only) - layered image editing.
 *
 * The home screen lists the account's canvases and starts new ones: blank
 * (a size and a background), from a file on this device, or from the Refs
 * library (the reference becomes the base layer, and the canvas remembers it
 * so an export can update it). Opening one hands over to the Editor.
 *
 * `openRequest` is a picture sent from elsewhere in the portal ("Open in Image
 * Studio" on the Edit Reference popup and the Refs library, ./bridge): it
 * becomes a new canvas at once, the same as "Open one of my Refs".
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Upload, Images, Trash2, Loader2, Layers } from "lucide-react"
import { CANVAS_PRESETS, MAX_CANVAS_SIDE, type StudioDoc } from "@/lib/image-studio"
import { fileToCanvas, loadToCanvas } from "./engine"
import { Editor, RefPicker } from "./Editor"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import type { StudioOpenRequest } from "./bridge"

type CanvasSummary = { id: number; title: string; width: number; height: number; thumbUrl: string | null; updatedAt: string }

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

export function ImageStudio({ signedIn, refLibrary, onSaveToRefs, onReplaceRef, onBalanceChange, openRequest, onOpenHandled, isAdmin = false, canUseLayers = false }: {
  signedIn: boolean
  /** The site's admin-only image models in the AI tools. */
  isAdmin?: boolean
  /** Dev Tier (or admin): layer management - as in the Edit Image popup. */
  canUseLayers?: boolean
  /** a picture to open as a new canvas (nonce: each request runs once) */
  openRequest?: (StudioOpenRequest & { nonce: number }) | null
  onOpenHandled?: () => void
  refLibrary: { id: string; url: string }[]
  onSaveToRefs: (file: File) => Promise<void>
  onReplaceRef?: (refId: string, dataUrl: string) => Promise<unknown>
  onBalanceChange?: (n: number) => void
}) {
  const [list, setList] = useState<CanvasSummary[] | null>(null)
  const [open, setOpen] = useState<{ id: number; seed?: Map<string, HTMLCanvasElement> } | null>(null)
  const [w, setW] = useState(2048), [h, setH] = useState(2048)
  const [bgMode, setBgMode] = useState<"white" | "transparent" | "colour">("white")
  const [bgColour, setBgColour] = useState("#101828")
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const load = useCallback(async () => {
    const r = await fetch("/api/employees/image-studio").catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    setList(j?.canvases ?? [])
  }, [])
  useEffect(() => { if (signedIn) void load() }, [signedIn, load])

  const create = async (doc: StudioDoc, title: string, sourceRefId?: number, seed?: Map<string, HTMLCanvasElement>) => {
    const r = await fetch("/api/employees/image-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, title, sourceRefId }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.canvas) throw new Error(j.error || "Could not create the canvas")
    setOpen({ id: j.canvas.id, seed })
  }
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(null)
    try { await fn() } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  const newBlank = () => run("blank", () => create({
    v: 1, width: Math.min(MAX_CANVAS_SIDE, Math.max(16, w)), height: Math.min(MAX_CANVAS_SIDE, Math.max(16, h)),
    background: bgMode === "transparent" ? null : bgMode === "white" ? "#ffffff" : bgColour, layers: [],
  }, "Untitled canvas"))
  /** An image (file or reference) as the base layer of a canvas its own size. */
  const fromPixels = (pix: HTMLCanvasElement, title: string, src?: string, refId?: number) => {
    const id = `l${Date.now().toString(36)}`
    return create({
      v: 1, width: pix.width, height: pix.height, background: null,
      layers: [{ id, name: "Background", kind: "raster", visible: true, locked: false, opacity: 1, blend: "normal", x: 0, y: 0, w: pix.width, h: pix.height, rotation: 0, flipX: false, flipY: false, src: src ?? null, pw: pix.width, ph: pix.height }],
    }, title, refId, src ? undefined : new Map([[id, pix]]))
  }
  const onFile = (f: File | undefined) => f && run("upload", async () => fromPixels(await fileToCanvas(f), f.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Image"))
  const onRef = (url: string) => {
    setPicker(false)
    const ref = refLibrary.find(r => r.url === url)
    const refId = ref && /^\d+$/.test(ref.id) ? Number(ref.id) : undefined
    return run("ref", async () => fromPixels(await loadToCanvas(url, MAX_CANVAS_SIDE), "Reference edit", url, refId))
  }
  // A picture sent from the popup or the Refs library: a canvas of its own, opened
  const handled = useRef(0)
  useEffect(() => {
    if (!signedIn || !openRequest || handled.current === openRequest.nonce) return
    handled.current = openRequest.nonce
    const r = openRequest
    const refId = r.refId && /^\d+$/.test(r.refId) ? Number(r.refId) : undefined
    setOpen(null)
    void run("ref", async () => fromPixels(await loadToCanvas(r.url, MAX_CANVAS_SIDE), r.title || "Reference edit", r.url, refId)).finally(() => onOpenHandled?.())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, openRequest?.nonce])

  const remove = async (id: number) => {
    if (confirmDel !== id) { setConfirmDel(id); setTimeout(() => setConfirmDel(c => (c === id ? null : c)), 3000); return }
    setConfirmDel(null)
    await fetch(`/api/employees/image-studio/${id}`, { method: "DELETE" }).catch(() => null)
    void load()
  }

  if (!signedIn) return <div className="py-24 text-center text-sm text-slate-400">Sign in to use the Image Studio.</div>
  if (busy === "ref" && !open && openRequest) return <div className="flex-1 flex flex-col items-center justify-center gap-2 py-24 text-[12px] text-slate-400"><Loader2 className="animate-spin" size={18} /> Opening the picture…</div>
  if (open) return (
    <Editor
      key={open.id}
      canvasId={open.id}
      seed={open.seed}
      refLibrary={refLibrary}
      onExit={() => { setOpen(null); void load() }}
      onSaveToRefs={onSaveToRefs}
      onReplaceRef={onReplaceRef}
      onBalanceChange={onBalanceChange}
      admin={isAdmin}
      canUseLayers={canUseLayers}
    />
  )

  const field = "w-24 rounded-md bg-black/40 border border-white/10 px-2 py-1.5 font-mono text-[12px] text-slate-100 focus:outline-none focus:border-white/30"
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-[calc(6rem+env(safe-area-inset-bottom))] space-y-8">
        <BrandTitle title="Image Studio" eyebrow="Layers · groups · masks · AI tools" logo={34} size="lg" />

        {/* ── start something ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="silver-edge rounded-2xl p-4 space-y-3 lg:col-span-2">
            <div className="flex items-center gap-2 text-[12px] font-bold text-slate-100"><Plus size={14} /> New blank canvas</div>
            <div className="flex flex-wrap gap-1.5">
              {CANVAS_PRESETS.map(p => (
                <button key={p.label} onClick={() => { setW(p.w); setH(p.h) }}
                  className={`px-2.5 py-1.5 rounded-lg border text-[11px] text-left ${w === p.w && h === p.h ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:text-white hover:bg-white/5"}`}>
                  <span className="block font-semibold">{p.label}</span><span className="block font-mono text-[10px] text-slate-500">{p.w}×{p.h}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Width <input className={field} value={w} onChange={e => setW(Math.max(1, Number(e.target.value) || 1))} /></label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Height <input className={field} value={h} onChange={e => setH(Math.max(1, Number(e.target.value) || 1))} /></label>
              <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-[11px]">
                {(["white", "transparent", "colour"] as const).map(m => (
                  <button key={m} onClick={() => setBgMode(m)} className={`px-2.5 py-1 rounded-md capitalize ${bgMode === m ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>{m}</button>
                ))}
              </div>
              {bgMode === "colour" && <input type="color" value={bgColour} onChange={e => setBgColour(e.target.value)} className="h-7 w-9 rounded border border-white/15 bg-transparent" />}
              <BrandButton onClick={newBlank} busy={busy === "blank"} disabled={!!busy} primary size="md">Create</BrandButton>
            </div>
            <p className="text-[10.5px] text-slate-500">Up to {MAX_CANVAS_SIDE}px a side.</p>
          </div>
          <div className="silver-edge rounded-2xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12px] font-bold text-slate-100"><Layers size={14} /> Start from an image</div>
            <label className={`flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-4 text-[12px] text-slate-200 hover:border-white/40 hover:bg-white/[0.03] cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
              {busy === "upload" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload from this device
              <input type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            </label>
            <button onClick={() => setPicker(true)} disabled={!!busy} className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-4 text-[12px] text-slate-200 hover:border-white/40 hover:bg-white/[0.03] disabled:opacity-50">
              {busy === "ref" ? <Loader2 size={14} className="animate-spin" /> : <Images size={14} />} Open one of my Refs
            </button>
            <p className="text-[10.5px] text-slate-500">The image becomes the base layer of a canvas its own size. A reference opened here can be updated in place when you export.</p>
          </div>
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}

        {/* ── my canvases ── */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Your canvases {list ? `· ${list.length}` : ""}</div>
          {!list ? <Loader2 className="animate-spin text-slate-500" size={18} /> : list.length === 0 ? (
            <p className="text-[12px] text-slate-500">Nothing yet - start a canvas above.</p>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))" }}>
              {list.map(c => (
                <div key={c.id} className="group relative rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden hover:border-white/30 transition-colors">
                  <button onClick={() => setOpen({ id: c.id })} className="block w-full text-left">
                    <div className="aspect-[4/3] bg-[repeating-conic-gradient(#1c212c_0%_25%,#141821_0%_50%)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden">
                      {c.thumbUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={c.thumbUrl} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
                        : <Layers size={22} className="text-slate-600" />}
                    </div>
                    <div className="px-2.5 py-2">
                      <div className="truncate text-[12px] font-semibold text-slate-100">{c.title}</div>
                      <div className="text-[10px] font-mono text-slate-500">{c.width}×{c.height} · {ago(c.updatedAt)}</div>
                    </div>
                  </button>
                  <button onClick={() => remove(c.id)} title={confirmDel === c.id ? "Click again to delete" : "Delete this canvas"}
                    className={`absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/70 border text-[10px] ${confirmDel === c.id ? "border-red-400/60 text-red-200" : "border-white/10 text-slate-300 opacity-0 group-hover:opacity-100"}`}>
                    <Trash2 size={11} />{confirmDel === c.id ? " Delete?" : ""}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {picker && <RefPicker refs={refLibrary} onPick={onRef} onClose={() => setPicker(false)} />}
    </div>
  )
}
