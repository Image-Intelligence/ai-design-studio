"use client"

import { useEffect, useMemo, useState } from "react"
import { usePersona } from "./persona"
import { createPortal } from "react-dom"
import { Check, Library, Loader2, Search, X } from "lucide-react"
import { BrandButton } from "@/components/employees/StudioBrand"

/*
 * Pick Assets for a Nova message (2026-10-19, owner): "this is the character /
 * product / place I mean". The chosen assets go with the message
 * (assetIds); the server hands Nova each one's name, kind, notes and pictures
 * (as references it can use). Lists the account's own Assets (/api/user/assets).
 */
export type PickedAsset = { id: number; name: string; kind: string; thumb: string | null }

type AssetRow = { id: number; kind: string; name: string; notes: string; refs: { url: string; thumb?: string | null }[] }

export const NOVA_MAX_ASSETS = 6

export function NovaAssetPicker({ selected, onDone, onClose }: { selected: PickedAsset[]; onDone: (a: PickedAsset[]) => void; onClose: () => void }) {
  const { name } = usePersona()
  const [rows, setRows] = useState<AssetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [pick, setPick] = useState<PickedAsset[]>(selected)

  useEffect(() => {
    fetch("/api/user/assets", { cache: "no-store" }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`Could not load your assets (${r.status})`))))
      .then(d => setRows(Array.isArray(d.assets) ? d.assets : []))
      .catch(e => setError(String(e?.message || e)))
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows ?? []).filter(a => !t || a.name.toLowerCase().includes(t) || a.kind.includes(t) || a.notes.toLowerCase().includes(t))
  }, [rows, q])
  const toggle = (a: AssetRow) => setPick(p => p.some(x => x.id === a.id)
    ? p.filter(x => x.id !== a.id)
    : p.length >= NOVA_MAX_ASSETS ? p : [...p, { id: a.id, name: a.name, kind: a.kind, thumb: a.refs[0]?.thumb || a.refs[0]?.url || null }])

  if (typeof document === "undefined") return null
  return createPortal(
    <div data-prism-modal className="fixed inset-0 z-[10055] flex items-start justify-center bg-black/70 backdrop-blur-sm p-3 pt-[6dvh]" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[86dvh] flex flex-col rounded-2xl silver-edge bg-[#070b14] p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <Library size={16} className="text-fuchsia-300" />
          <p className="text-sm font-bold text-white">Tell {name} which assets you mean</p>
          <button onClick={onClose} className="ml-auto p-1 text-slate-500 hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-[11.5px] text-slate-400 mb-3">{name} gets each asset&apos;s pictures and notes, and keeps the character, product or place consistent with them. Up to {NOVA_MAX_ASSETS}.</p>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your assets" autoFocus
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[13px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {error && <p className="text-[12px] text-red-300">{error}</p>}
          {!rows && !error && <div className="py-10 flex justify-center text-slate-500"><Loader2 size={18} className="animate-spin" /></div>}
          {rows && !rows.length && <p className="py-8 text-center text-[12px] text-slate-500">No assets yet. Make one in My Generations (Assets), or ask {name} to save a character as an asset.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {shown.map(a => {
              const on = pick.some(x => x.id === a.id)
              const cover = a.refs[0]?.thumb || a.refs[0]?.url
              return (
                <button key={a.id} onClick={() => toggle(a)}
                  className={`relative text-left rounded-xl overflow-hidden border transition-colors ${on ? "border-fuchsia-300/70 ring-1 ring-fuchsia-300/40" : "border-white/10 hover:border-white/25"}`}>
                  <span className="block aspect-square bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {cover && <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  </span>
                  <span className="block px-2 py-1.5 bg-black/60">
                    <span className="block text-[12px] font-semibold text-white truncate">{a.name}</span>
                    <span className="block text-[10px] text-slate-400 capitalize">{a.kind} · {a.refs.length} picture{a.refs.length === 1 ? "" : "s"}</span>
                  </span>
                  {on && <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-fuchsia-400 text-black flex items-center justify-center"><Check size={12} /></span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-slate-500">{pick.length} selected</span>
          <BrandButton size="sm" onClick={onClose} className="ml-auto">Cancel</BrandButton>
          <BrandButton primary size="sm" onClick={() => onDone(pick)}>Use {pick.length ? pick.length : ""} asset{pick.length === 1 ? "" : "s"}</BrandButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
