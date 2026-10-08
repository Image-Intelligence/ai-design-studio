"use client"

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Search, X, Check } from "lucide-react"
import { CLIP_LIBRARY, CLIP_CATEGORIES, CLIP_PREVIEW_BASE, clipLabel } from "@/lib/threed/clip-library"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"

/**
 * The motion library (Meshy's 656 preset clips) as a searchable grid with
 * animated previews - pick up to ten; "Animation clips" puts them all on the
 * character's rig in one run.
 */
const CAT_LABEL: Record<string, string> = { DailyActions: "Everyday", WalkAndRun: "Walk & run", Fighting: "Fighting", Dancing: "Dancing", BodyMovements: "Body moves" }

export function ClipPicker({ picked, onChange, onClose }: { picked: number[]; onChange: (ids: number[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState<string | null>(null)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return CLIP_LIBRARY.filter(c => (!cat || c[2] === cat) && (!s || `${c[1]} ${c[3]}`.toLowerCase().replace(/_/g, " ").includes(s)))
  }, [q, cat])
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter(x => x !== id) : picked.length >= 10 ? picked : [...picked, id])

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="silver-edge w-full max-w-[1100px] h-[88dvh] rounded-2xl p-4 flex flex-col gap-3">
        <BrandTitle title="Motion library" eyebrow={`${CLIP_LIBRARY.length} clips · pick up to 10 · $0.12 each at fal`} logo={22} size="sm"
          right={<button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>} />
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search - wave, sword, sit, dance…" className="sb-input w-full pl-8" autoFocus />
          </div>
          <button onClick={() => setCat(null)} className={`px-2.5 py-1 rounded-full border text-[11px] ${!cat ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-slate-400"}`}>All</button>
          {CLIP_CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)} className={`px-2.5 py-1 rounded-full border text-[11px] ${cat === c ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>{CAT_LABEL[c] ?? c}</button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 content-start pr-1">
          {list.map(([id, name, , sub, gif]) => {
            const on = picked.includes(id)
            return (
              <button key={id} onClick={() => toggle(id)} className={`relative rounded-xl overflow-hidden border text-left transition-colors ${on ? "border-white ring-2 ring-white/50" : "border-white/10 hover:border-white/30"}`}>
                <div className="aspect-square bg-[#0e1320]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {gif && <img src={CLIP_PREVIEW_BASE + gif} alt="" loading="lazy" className="w-full h-full object-contain" />}
                </div>
                <div className="px-2 py-1.5">
                  <p className="text-[11px] font-semibold text-slate-100 truncate">{clipLabel(name)}</p>
                  <p className="text-[9.5px] text-slate-500 truncate">{sub} · #{id}</p>
                </div>
                {on && <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white text-black flex items-center justify-center"><Check size={12} /></span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{picked.length}/10 picked{picked.length ? `: ${picked.map(id => clipLabel(CLIP_LIBRARY.find(c => c[0] === id)?.[1] ?? String(id))).join(", ")}` : ""}</span>
          <BrandButton primary size="sm" className="ml-auto" onClick={onClose}>Done</BrandButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
