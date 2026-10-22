"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Plus, X, Images, BookUser, Loader2 } from "lucide-react"
import { openLibraryPicker } from "@/components/feed/LibraryPicker"

/*
 * Kling 4.0 elements (2026-10-21, owner: "elements to use @elements"): a
 * character or thing the video keeps consistent, named @Element1, @Element2...
 * in the prompt. fal takes each as a front view plus 1-3 more angles
 * (lib/batch-1007-video cleanKlingElements), so an element is picked as 2-4
 * pictures - from My Assets (a saved asset IS a set of angles) or from any
 * pictures in My Generations, the first one being the front view.
 *
 * The list lives in a small store outside the settings panel (it is drawn in
 * two places - the desktop rail and the phone sheet) and is read by the
 * page's submit (getKlingElements). Kept for the tab's session.
 */

export type KlingElementPick = { frontal: string; views: string[]; name: string; thumbs: string[] }
export const MAX_KLING_ELEMENTS = 7
const KEY = "pv2-kling-elements"

let elements: KlingElementPick[] = (() => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
})()
const listeners = new Set<() => void>()
function setElements(next: KlingElementPick[]) {
  elements = next.slice(0, MAX_KLING_ELEMENTS)
  try { sessionStorage.setItem(KEY, JSON.stringify(elements)) } catch {}
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** What the submit sends: { frontal, views }[] (the route cleans it again). */
export const getKlingElements = () => elements.map(e => ({ frontal: e.frontal, views: e.views }))
/** Put a past run's elements back (the feed popup's Rescan) - named in order, as the prompt's @Element1... */
export const restoreKlingElements = (list: { frontal: string; views: string[] }[]) =>
  setElements(list.filter(e => e?.frontal).map((e, i) => ({ frontal: e.frontal, views: (e.views ?? []).filter(Boolean), name: `Element ${i + 1}`, thumbs: [e.frontal, ...(e.views ?? []).filter(Boolean)].slice(0, 4) })))

type LibAsset = { id: number; name: string; kind: string; refs: { url: string; thumb?: string | null }[] }

export function KlingElementsEditor() {
  const list = useSyncExternalStore(subscribe, () => elements, () => elements)
  const [assetPick, setAssetPick] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const room = list.length < MAX_KLING_ELEMENTS

  const fromPictures = async () => {
    setNote(null)
    const urls = await openLibraryPicker({ max: 4, title: "Pick 2-4 pictures of one element - the first is its front view" })
    if (!urls.length) return
    if (urls.length < 2) { setNote("An element needs at least 2 pictures: a front view and another angle."); return }
    setElements([...list, { frontal: urls[0], views: urls.slice(1, 4), name: `Element ${list.length + 1}`, thumbs: urls.slice(0, 4) }])
  }
  const fromAsset = (a: LibAsset) => {
    setAssetPick(false)
    const refs = a.refs.filter(r => r.url).slice(0, 4)
    if (refs.length < 2) { setNote(`"${a.name}" has ${refs.length} picture - an element needs a front view and at least one more angle.`); return }
    setElements([...list, { frontal: refs[0].url, views: refs.slice(1).map(r => r.url), name: a.name, thumbs: refs.map(r => r.thumb || r.url) }])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">Elements <span className="normal-case tracking-normal text-slate-600">(optional · {list.length}/{MAX_KLING_ELEMENTS})</span></span>
      </div>
      <p className="text-[10px] leading-snug text-slate-500">A character or thing kept the same in every frame. Name them <span className="font-mono text-slate-300">@Element1</span>, <span className="font-mono text-slate-300">@Element2</span>… in the prompt.</p>
      {list.map((e, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 p-1.5">
          <span className="shrink-0 rounded bg-white/10 px-1 font-mono text-[9px] text-slate-200">@Element{i + 1}</span>
          <div className="flex min-w-0 flex-1 gap-1">
            {e.thumbs.map((t, k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={t} alt="" className={`h-8 w-8 shrink-0 rounded object-cover ${k === 0 ? "ring-1 ring-sky-300/60" : "opacity-80"}`} title={k === 0 ? "Front view" : "Another angle"} />
            ))}
          </div>
          <span className="min-w-0 max-w-[5.5rem] truncate text-[10px] text-slate-400" title={e.name}>{e.name}</span>
          <button onClick={() => setElements(list.filter((_, k) => k !== i))} className="shrink-0 text-slate-500 hover:text-white" title="Remove this element"><X size={12} /></button>
        </div>
      ))}
      {room && (
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => setAssetPick(true)} className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 py-1.5 text-[10.5px] font-semibold text-slate-300 hover:border-white/30 hover:text-white">
            <BookUser size={12} /> From My Assets
          </button>
          <button onClick={() => void fromPictures()} className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 py-1.5 text-[10.5px] font-semibold text-slate-300 hover:border-white/30 hover:text-white">
            <Images size={12} /> From pictures
          </button>
        </div>
      )}
      {note && <p className="text-[10px] text-amber-300/90">{note}</p>}
      {assetPick && <AssetPicker onPick={fromAsset} onClose={() => setAssetPick(false)} />}
    </div>
  )
}

function AssetPicker({ onPick, onClose }: { onPick: (a: LibAsset) => void; onClose: () => void }) {
  const [assets, setAssets] = useState<LibAsset[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch("/api/user/assets", { cache: "no-store" }).then(r => r.json())
      // An element is pictures (front view + angles): an asset's clips (2026-10-21) are left out
      .then(j => setAssets(Array.isArray(j.assets) ? j.assets.map((a: Omit<LibAsset, "refs"> & { refs: (LibAsset["refs"][number] & { kind?: string })[] }) => ({ ...a, refs: a.refs.filter(r => r.kind !== "video") })) : []))
      .catch(() => setErr("Couldn't load My Assets"))
  }, [])
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <p className="flex-1 text-[13px] font-bold text-white">An element from My Assets</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {err && <p className="text-[11px] text-red-300">{err}</p>}
          {!assets && !err && <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
          {assets && !assets.length && <p className="text-[11px] text-slate-400">No saved assets yet - save one from the Storyboard Studio, or build an element from pictures.</p>}
          {assets?.map(a => (
            <button key={a.id} onClick={() => onPick(a)} disabled={a.refs.length < 2}
              className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left hover:border-white/25 disabled:opacity-40"
              title={a.refs.length < 2 ? "Needs at least 2 pictures" : "Its first picture is the front view, the next 3 the other angles"}>
              <div className="flex shrink-0 gap-1">
                {a.refs.slice(0, 4).map((r, k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={k} src={r.thumb || r.url} alt="" className="h-9 w-9 rounded object-cover" />
                ))}
              </div>
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-200">{a.name}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{a.kind} · {a.refs.length}</span>
              <Plus size={13} className="shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
