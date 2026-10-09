"use client"

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { useThumb } from "@/components/employees/still-thumbs"
import { ASSET_KINDS, MAX_ASSET_REFS, MAX_CAPTION, shotCaption, type AssetKind, type StoryboardDoc } from "@/lib/storyboard"

/*
 * "Make an asset" from a board (2026-10-08) - an outfit pack's looks, a
 * character sheet, a location's angles... become one saved asset in My Assets.
 * Pick the shots scene by scene (only shots with a still); each picture is
 * described from its own shot (title + "what we see"), so the AI draft can
 * pick pictures from it on any board straight away. Free - no AI call.
 */

const KIND_OPTIONS = ASSET_KINDS.map(k => ({ value: k.id, label: k.label }))

export function BoardToAsset({ board, onClose, onSaved }: {
  board: Pick<StoryboardDoc, "title" | "mode" | "look" | "shots" | "scenes">
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const thumb = useThumb()
  // The board in scene order; a board without scenes is one group
  const groups = useMemo(() => {
    const withStill = board.shots.filter(s => s.stillUrl)
    if (!board.scenes.length) return [{ id: "_all", title: "All shots", shots: withStill }]
    const out = board.scenes.map((c, k) => ({ id: c.id, title: c.title || `Scene ${k + 1}`, shots: withStill.filter(s => s.sceneId === c.id) }))
    const loose = withStill.filter(s => !board.scenes.some(c => c.id === s.sceneId))
    return [...out, ...(loose.length ? [{ id: "_loose", title: "Other shots", shots: loose }] : [])].filter(g => g.shots.length)
  }, [board.shots, board.scenes])
  const allShots = groups.flatMap(g => g.shots)
  const [picked, setPicked] = useState<string[]>(() => allShots.slice(0, MAX_ASSET_REFS).map(s => s.id))
  const [kind, setKind] = useState<AssetKind>(board.mode === "outfit" ? "wardrobe" : board.mode === "location" ? "location" : "character")
  const [name, setName] = useState(board.title && board.title !== "Untitled storyboard" ? board.title.slice(0, 80) : "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const full = picked.length >= MAX_ASSET_REFS
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_ASSET_REFS ? p : [...p, id]))
  const toggleGroup = (ids: string[]) => setPicked(p => {
    const allOn = ids.every(id => p.includes(id))
    if (allOn) return p.filter(id => !ids.includes(id))
    return [...p, ...ids.filter(id => !p.includes(id))].slice(0, MAX_ASSET_REFS)
  })

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const label = name.trim() || `${ASSET_KINDS.find(k => k.id === kind)?.label ?? "Asset"} from ${board.title || "a board"}`.slice(0, 80)
      // In board order, each with its description - led by the asset's name,
      // the same shape Auto caption writes, so the AI draft reads them alike
      const refs = allShots.filter(s => picked.includes(s.id)).map(s => ({ url: s.stillUrl!, caption: `${label} - ${shotCaption(s)}`.slice(0, MAX_CAPTION) }))
      const r = await fetch("/api/user/assets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: label, notes: (board.look || "").slice(0, 1000), refs }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.asset) throw new Error(j.error || `Couldn't save it (${r.status})`)
      onSaved(`Saved "${j.asset.name}" to My Assets with ${j.asset.refs.length} described picture${j.asset.refs.length === 1 ? "" : "s"}`)
      onClose()
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally { setBusy(false) }
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative isolate flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] shadow-2xl">
        <SilverRimOverlay />
        <div className="relative space-y-3 border-b border-white/[0.06] px-5 pb-3 pt-5">
          <BrandTitle title="Make an asset from this board" eyebrow={`${picked.length} of ${MAX_ASSET_REFS} pictures · described from their shots`} logo={26}
            right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>} />
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown value={kind} options={KIND_OPTIONS} onChange={v => setKind(v as AssetKind)} className="w-40" />
            <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Asset name - e.g. Mara's autumn looks"
              className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12.5px] font-semibold text-white placeholder:text-slate-600 focus:border-white/40 focus:outline-none" />
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Pick the shots to keep, scene by scene. Each picture gets its shot&apos;s description, so the AI draft can choose between them on any board.
            {full && <span className="text-amber-300"> An asset holds {MAX_ASSET_REFS} pictures.</span>}
          </p>
        </div>

        <div className="relative flex-1 min-h-0 space-y-5 overflow-y-auto px-5 py-4">
          {groups.length === 0 && <p className="py-10 text-center text-[12px] text-slate-500">Make some stills first - an asset is made from the board&apos;s pictures.</p>}
          {groups.map(g => {
            const ids = g.shots.map(s => s.id)
            const on = ids.filter(id => picked.includes(id)).length
            return (
              <section key={g.id}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-[12.5px] font-bold text-slate-100">{g.title}</h3>
                  <span className="font-mono text-[10px] text-slate-500">{on}/{ids.length}</span>
                  <button onClick={() => toggleGroup(ids)} className="ml-auto rounded-md border border-white/10 px-2 py-0.5 text-[10.5px] text-slate-300 hover:bg-white/[0.06]">
                    {on === ids.length ? "None" : "All"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
                  {g.shots.map(s => {
                    const isOn = picked.includes(s.id)
                    return (
                      <button key={s.id} onClick={() => toggle(s.id)} disabled={!isOn && full}
                        className="flex flex-col gap-1 text-left disabled:opacity-40" title={shotCaption(s)}>
                        <span className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 transition-colors ${isOn ? "border-white" : "border-white/10 hover:border-white/30"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb(s.stillUrl!) || s.stillUrl!} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                          <span className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border ${isOn ? "border-white bg-white text-black" : "border-white/50 bg-black/50"}`}>
                            {isOn && <Check size={11} />}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-[10px] leading-snug text-slate-400">{shotCaption(s)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        <div className="relative flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          {err && <p className="mr-auto text-[11px] text-red-300">{err}</p>}
          <button onClick={onClose} className="ml-auto rounded-lg px-3 py-1.5 text-[12px] text-slate-400 hover:text-white">Cancel</button>
          <BrandButton onClick={save} busy={busy} disabled={busy || picked.length === 0} primary size="md">
            Save {picked.length} picture{picked.length === 1 ? "" : "s"} to My Assets
          </BrandButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
