"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Download, Loader2, Trash2 } from "lucide-react"
import { WORLD_BUILD_TOOLS, getTool, toolTickets, withDefaults } from "@/lib/threed/catalog"
import type { AssetOut } from "@/lib/threed/assets"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { PanoramaViewer } from "./PanoramaViewer"

/**
 * The Worlds studio's "Build a world" mode (2026-10-16): the world models that
 * used to sit in the 3D Studio's last stage - Hunyuan World (one picture into
 * a 360° layered environment) and Tripo splat (one picture into a photoreal
 * Gaussian splat). They are jobs, not live sessions: Build starts one through
 * the 3D Studio's own route (/api/employees/studio3d - lib/threed/pipeline
 * charges, runs and saves it, and it keeps going if the page closes), and the
 * finished world opens here - a panorama to look around, or the splat in the
 * 3D viewer - with its files to download.
 *
 * A hook plus the three pieces WorldsStudio lays out: the stage, the build bar
 * and the rail.
 */

const Viewer3D = dynamic(() => import("@/components/studio3d/Viewer3D").then(m => m.Viewer3D), { ssr: false, loading: () => <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div> })

export type BuildToolId = "hunyuan-world" | "triposplat"
export const BUILD_TOOL_IDS = WORLD_BUILD_TOOLS.map(t => t.id) as BuildToolId[]
/** What the Worlds studio calls them (the 3D catalog's labels are task names) */
export const BUILD_NAMES: Record<string, { name: string; maker: string }> = {
  "hunyuan-world": { name: "Hunyuan World", maker: "Tencent" },
  "triposplat": { name: "Tripo Splat", maker: "Tripo" },
}

type Asset = Omit<AssetOut, "createdAt"> & { createdAt: string }
type Job = { id: number; prompt: string; toolId: string; queuedAt: string; tickets: number }
type Failed = { id: number; prompt: string; toolId: string; error: string; at: string }

export function useWorldBuilder(toolId: BuildToolId, picture: string | null, onBalanceChange?: (n: number) => void) {
  const tool = getTool(toolId)!
  const [options, setOptions] = useState<Record<string, unknown>>({})
  const [assets, setAssets] = useState<Asset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [failed, setFailed] = useState<Failed[]>([])
  const [selId, setSelId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { setOptions({}); setNote(null) }, [toolId])

  const load = useCallback(async () => {
    const r = await fetch("/api/employees/studio3d").catch(() => null)
    const j = r?.ok ? await r.json() : null
    if (!j) return
    const worlds = <T extends { toolId: string }>(xs: T[]) => xs.filter(x => (BUILD_TOOL_IDS as string[]).includes(x.toolId))
    setAssets(worlds(j.assets))
    setJobs(worlds(j.jobs))
    setFailed(worlds(j.failed))
  }, [])
  useEffect(() => { void load() }, [load])
  // Poll while a world is building (each poll settles finished jobs server-side)
  useEffect(() => {
    if (!jobs.length) return
    const h = setInterval(() => { void load() }, 8000)
    return () => clearInterval(h)
  }, [jobs.length, load])
  // A world that just finished opens itself
  const [lastJobs, setLastJobs] = useState(0)
  useEffect(() => {
    if (jobs.length < lastJobs && assets[0]) setSelId(assets[0].id)
    setLastJobs(jobs.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length])

  const missing = (() => {
    if (!picture) return "Pick a starting picture"
    for (const c of tool.controls) if (c.required && !String(options[c.key] ?? "").trim()) return `Fill in "${c.label}"`
    return null
  })()
  const tickets = toolTickets(tool, options, 1)

  const build = async () => {
    if (busy || missing) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch("/api/employees/studio3d", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id, images: [picture], options: withDefaults(tool, options) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Could not start")
      setJobs(cur => [{ id: j.job.id, prompt: j.job.prompt, toolId: j.job.toolId, queuedAt: new Date().toISOString(), tickets: j.job.tickets }, ...cur])
      if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
      setNote({ ok: true, text: `${BUILD_NAMES[tool.id]?.name ?? tool.label} is building - about ${tool.minutes <= 1 ? "a minute" : `${Math.ceil(tool.minutes)} minutes`}. It keeps going if you leave.` })
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message || e) })
    } finally { setBusy(false) }
  }

  const remove = async (id: number) => {
    await fetch(`/api/employees/studio3d/${id}`, { method: "DELETE" }).catch(() => {})
    setAssets(cur => cur.filter(a => a.id !== id))
    if (selId === id) setSelId(null)
  }

  const sel = assets.find(a => a.id === selId) ?? null
  // An old-suite world (fal's own links): copied to our storage once, on open (the 3D Studio does the same)
  const [preparing, setPreparing] = useState<number | null>(null)
  useEffect(() => {
    if (!sel?.legacy || preparing === sel.id) return
    setPreparing(sel.id)
    fetch(`/api/employees/studio3d/${sel.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "prepare" }) })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.asset) setAssets(cur => cur.map(a => (a.id === j.asset.id ? j.asset : a))) })
      .finally(() => setPreparing(null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sel?.legacy])
  return { preparing: preparing !== null && preparing === sel?.id, tool, options, setOptions, assets, jobs, failed, sel, setSelId, busy, note, setNote, missing, tickets, build, remove }
}
export type WorldBuilder = ReturnType<typeof useWorldBuilder>

/** The finished world on the stage: a splat in the 3D viewer, or the panorama to look around. */
export function BuildStage({ b }: { b: WorldBuilder }) {
  const sel = b.sel
  const splat = useMemo(() => sel?.files.find(f => f.kind === "mesh" && ["ply", "splat", "glb"].includes(f.ext)) ?? null, [sel])
  if (b.preparing) return <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-slate-300"><Loader2 className="animate-spin" />Copying this world to your library - once</div>
  if (sel && sel.toolId === "hunyuan-world" && sel.poster) return <PanoramaViewer key={sel.id} url={sel.poster} className="absolute inset-0" />
  if (sel && splat) return <Viewer3D key={sel.id} src={{ url: splat.url, ext: splat.ext, key: `world-${sel.id}` }} poster={sel.poster} autoRotate className="absolute inset-0" />
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <SiteLogoBox size={48} rounded={14} />
      <p className="max-w-md text-[13px] text-slate-300">
        {b.jobs.length ? "Your world is building - it opens here when it is ready"
          : `${BUILD_NAMES[b.tool.id]?.name}: ${b.tool.output}. Pick a starting picture and press Build.`}
      </p>
    </div>
  )
}

/** Build button, progress and notes, under the stage. */
export function BuildBar({ b }: { b: WorldBuilder }) {
  return (
    <>
      <BrandButton onClick={() => void b.build()} disabled={!!b.missing} busy={b.busy} primary size="lg" title={b.missing ?? `${b.tickets} tickets - about ${Math.ceil(b.tool.minutes)} min`}>
        Build world <span className="text-[10.5px] font-semibold opacity-70">{b.tickets} tickets · ~{Math.max(1, Math.ceil(b.tool.minutes))} min</span>
      </BrandButton>
      {b.missing && <span className="text-[12px] text-slate-500">{b.missing}</span>}
      {b.jobs.length > 0 && <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-300"><Loader2 size={12} className="animate-spin" /> {b.jobs.length} building</span>}
    </>
  )
}

/** The builder's rail: its settings and your built worlds. */
export function BuildRail({ b, panel, label }: { b: WorldBuilder; panel: string; label: string }) {
  const controls = b.tool.controls
  return (
    <>
      <section className={panel}>
        <BrandTitle title={BUILD_NAMES[b.tool.id]?.name ?? b.tool.label} eyebrow={b.tool.output} logo={16} size="sm" />
        <p className="mt-2 text-[11.5px] text-slate-400">{b.tool.bestFor}{b.tool.caveat ? ` ${b.tool.caveat}` : ""}</p>
        {controls.length > 0 && (
          <div className="mt-3 space-y-2">
            {controls.map(c => (
              <label key={c.key} className="block">
                <span className={`${label} block mb-1`}>{c.label}{c.required ? " *" : ""}</span>
                {c.kind === "select" ? (
                  <select value={String(b.options[c.key] ?? c.def ?? "")} onChange={e => b.setOptions(o => ({ ...o, [c.key]: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white">
                    {c.options?.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                  </select>
                ) : c.kind === "toggle" ? (
                  <input type="checkbox" checked={Boolean(b.options[c.key] ?? c.def)} onChange={e => b.setOptions(o => ({ ...o, [c.key]: e.target.checked }))} />
                ) : (
                  <input value={String(b.options[c.key] ?? "")} onChange={e => b.setOptions(o => ({ ...o, [c.key]: e.target.value.slice(0, 200) }))} placeholder={c.placeholder}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
                )}
              </label>
            ))}
          </div>
        )}
        {b.note && <p className={`mt-3 rounded-xl border px-3 py-2 text-[11.5px] ${b.note.ok ? "border-white/15 bg-white/[0.05] text-slate-200" : "border-rose-400/25 bg-rose-500/10 text-rose-200"}`}>{b.note.text}</p>}
      </section>

      <section className={panel}>
        <p className={`${label} mb-2`}>Your worlds · {b.assets.length}</p>
        {b.failed.slice(0, 3).map(f => <p key={f.id} className="mb-1.5 rounded-lg border border-rose-400/20 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-200">{BUILD_NAMES[f.toolId]?.name}: {f.error}</p>)}
        {!b.assets.length && !b.jobs.length && <p className="text-[11.5px] text-slate-500">Worlds you build land here - and stay, so you can come back to them.</p>}
        <div className="grid grid-cols-2 gap-2">
          {b.jobs.map(j => (
            <div key={`job-${j.id}`} className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/40 text-[10.5px] text-slate-400">
              <Loader2 size={14} className="animate-spin" />{BUILD_NAMES[j.toolId]?.name}
            </div>
          ))}
          {b.assets.map(a => (
            <div key={a.id} className={`group relative overflow-hidden rounded-xl border ${b.sel?.id === a.id ? "border-white/60" : "border-white/10 hover:border-white/30"}`}>
              {b.sel?.id === a.id && <SilverRimOverlay rounded="rounded-xl" />}
              <button onClick={() => b.setSelId(a.id)} className="block w-full text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.poster ? <img src={a.poster} alt="" loading="lazy" className="aspect-video w-full object-cover" /> : <div className="aspect-video w-full bg-black/50" />}
                <span className="block truncate px-2 py-1 text-[10.5px] text-slate-300">{BUILD_NAMES[a.toolId]?.name ?? a.toolLabel}</span>
              </button>
              <div className="absolute right-1 top-1 z-40 hidden gap-1 group-hover:flex">
                {a.files.filter(f => f.kind === "mesh" || f.kind === "archive").slice(0, 2).map(f => (
                  <a key={f.url} href={f.url} download target="_blank" rel="noreferrer" title={`Download ${f.ext.toUpperCase()}`} className="rounded-md border border-white/20 bg-black/70 p-1 text-slate-200 hover:text-white"><Download size={11} /></a>
                ))}
                <button onClick={() => void b.remove(a.id)} title="Delete" className="rounded-md border border-white/20 bg-black/70 p-1 text-slate-300 hover:text-rose-300"><Trash2 size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
