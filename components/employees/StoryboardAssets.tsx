"use client"

import { useCallback, useContext, useEffect, useRef, useState } from "react"
import {
  Plus, X, Check, Loader2, Upload, Images, Trash2, ChevronDown, ChevronRight,
  UserRound, PawPrint, Car, Box, Shirt, MapPin, Landmark, Mountain, Palette, Shapes, Film,
  BookmarkPlus, BookmarkCheck, Library,
  type LucideIcon,
} from "lucide-react"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { useThumb, AddStillThumbs, stillKeyOf } from "@/components/employees/still-thumbs"
import {
  ASSET_KINDS, MAX_ASSETS, MAX_ASSET_REFS, newAsset, newAssetRef, stillKey, pickRefs, MAX_SHOT_REFS,
  type AssetKind, type StoryAsset, type ShotRef,
} from "@/lib/storyboard"
import { gateFileInput, gateUpload } from "@/components/id-verification/IdVerificationGate"

/**
 * Storyboard Studio - the board's assets.
 *
 * Everything a cut is made of - characters, vehicles, objects, places - each a
 * set of reference images. Any ref of any asset can be switched on, so a shot
 * can be made from (say) refs 1 and 6 of Character 1, 2 and 3 of Vehicle 1 and
 * 12 of Landscape 1 at once. The switched-on refs go with the next still, in
 * asset order, up to what the still's model takes: the panel is capped by the
 * model of the shot being worked on, and every still sends no more than its
 * own model allows.
 *
 * Refs come from the account's Refs library, from this board's own stills
 * (every take), from the device, or straight from a shot card.
 */

export const ASSET_ICONS: Record<AssetKind, LucideIcon> = {
  character: UserRound, creature: PawPrint, vehicle: Car, object: Box, wardrobe: Shirt,
  location: MapPin, landmark: Landmark, scenery: Mountain, style: Palette, other: Shapes,
}
const KIND_OPTIONS = ASSET_KINDS.map(k => ({ value: k.id, label: k.label }))
const kindLabel = (k: AssetKind) => ASSET_KINDS.find(x => x.id === k)?.label ?? k

/** Upload one image through the same route the Refs library uses; returns its URL. */
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append("file", file)
  const r = await fetch("/api/upload-reference", { method: "POST", body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j?.url) throw new Error(j?.error || `Upload failed (${r.status})`)
  return j.url as string
}

/** An asset saved to the account (My Generations' Assets) - GET /api/user/assets. */
export type LibraryAsset = { id: number; kind: AssetKind; name: string; notes: string; refs: { id: string; url: string; thumb?: string | null }[] }

/** The account's saved assets, loaded once per panel and refreshed after a save. */
function useLibrary() {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/user/assets", { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      setAssets(r.ok && Array.isArray(j.assets) ? j.assets : [])
    } catch { setAssets([]) }
  }, [])
  useEffect(() => { void load() }, [load])
  return { assets, load }
}

export type RefCap = {
  /** How many refs the model of the shot being worked on takes (0 = none). */
  max: number
  model: string
  /** "Shot 05" - which shot sets the cap. */
  shot: string
}

/*
 * Assets are the board's organised references - nothing to switch on. The AI
 * draft decides which assets each shot shows and sends their photos with
 * that still (a shot's References, in its Details, is where to change it).
 */
export function AssetsPanel({ assets, onChange, refLibrary, boardStills }: {
  assets: StoryAsset[]
  onChange: (fn: (a: StoryAsset[]) => StoryAsset[]) => void
  refLibrary: { id: string; url: string }[]
  boardStills: { url: string; label: string }[]
}) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<AssetKind>("character")
  const [name, setName] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [picker, setPicker] = useState<string | null>(null) // asset id
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadFor = useRef<string | null>(null)
  const thumb = useThumb()
  const addThumbs = useContext(AddStillThumbs)
  /** Pictures from My Assets carry their thumbnails - draw those, not the 2-20MB originals */
  const learnThumbs = (refs: { url: string; thumb?: string | null }[]) =>
    addThumbs(refs.filter(r => r.thumb).map(r => [stillKeyOf(r.url), r.thumb!] as [string, string]))
  const library = useLibrary()
  const [libOpen, setLibOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null) // board asset id

  const refCount = assets.reduce((n, a) => n + a.refs.length, 0)
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 3500) }

  const create = () => {
    if (assets.length >= MAX_ASSETS) return
    const label = name.trim() || `${kindLabel(kind)} ${assets.filter(a => a.kind === kind).length + 1}`
    const a = newAsset(kind, label)
    onChange(list => [...list, a])
    setOpen(o => ({ ...o, [a.id]: true }))
    setName("")
    setAdding(false)
  }
  const patch = (id: string, fn: (a: StoryAsset) => StoryAsset) => onChange(list => list.map(a => (a.id === id ? fn(a) : a)))

  /**
   * Into the account's saved assets: a new one, or - for a copy that came from
   * (or was saved to) the library - the same one updated. The server keeps only
   * pictures this account owns, so a count that comes back short is said so.
   */
  const saveToLibrary = async (a: StoryAsset) => {
    setSaving(a.id)
    try {
      const urls = a.refs.map(r => r.url)
      const fresh = () => fetch("/api/user/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: a.kind, name: a.name, notes: a.notes, urls }) })
      let r = a.libraryId
        ? await fetch("/api/user/assets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.libraryId, kind: a.kind, name: a.name, notes: a.notes, refs: urls.map(url => ({ url })) }) })
        : await fresh()
      // Deleted from My Generations since: save it as a new one
      if (r.status === 404 && a.libraryId) r = await fresh()
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.asset) throw new Error(j?.error || `Save failed (${r.status})`)
      patch(a.id, x => ({ ...x, libraryId: j.asset.id }))
      learnThumbs(j.asset.refs ?? [])
      const kept = j.asset.refs?.length ?? 0
      flash(kept < urls.length
        ? `Saved "${a.name}" to My Assets - ${kept} of ${urls.length} pictures (only your own images can be saved)`
        : `Saved "${a.name}" to My Assets`)
      void library.load()
    } catch (e: any) {
      flash(String(e?.message || e))
    } finally {
      setSaving(null)
    }
  }

  /** Saved assets onto this board, as copies that remember where they came from. */
  const addFromLibrary = (picked: LibraryAsset[]) => {
    const room = Math.max(0, MAX_ASSETS - assets.length)
    const fresh: StoryAsset[] = picked.slice(0, room).map(l => ({
      ...newAsset(l.kind, l.name),
      notes: l.notes,
      libraryId: l.id,
      refs: l.refs.slice(0, MAX_ASSET_REFS).map(r => newAssetRef(r.url, false)),
    }))
    if (!fresh.length) return
    learnThumbs(picked.flatMap(l => l.refs))
    onChange(list => [...list, ...fresh])
    setOpen(o => ({ ...o, ...Object.fromEntries(fresh.map(f => [f.id, true])) }))
    if (picked.length > fresh.length) flash(`A board holds up to ${MAX_ASSETS} assets - ${picked.length - fresh.length} not added`)
  }
  const addRefs = (id: string, urls: string[]) => patch(id, a => {
    const have = new Set(a.refs.map(r => stillKey(r.url)))
    const fresh = urls.filter(u => !have.has(stillKey(u))).map(u => newAssetRef(u, false))
    return { ...a, refs: [...a.refs, ...fresh].slice(0, MAX_ASSET_REFS) }
  })

  const onFiles = async (files: FileList | null) => {
    const id = uploadFor.current
    if (!id || !files?.length) return
    setUploading(id)
    try {
      const urls: string[] = []
      for (const f of Array.from(files).slice(0, MAX_ASSET_REFS)) urls.push(await uploadImage(f))
      addRefs(id, urls)
    } catch (e: any) {
      flash(String(e?.message || e))
    } finally {
      setUploading(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="space-y-2">
      <BrandTitle
        title="Assets"
        logo={22}
        size="sm"
        eyebrow={`${assets.length} asset${assets.length === 1 ? "" : "s"} · ${refCount} reference${refCount === 1 ? "" : "s"}`}
      />
      <p className="text-[10px] text-slate-600 leading-snug">
        Characters, vehicles, props, places, outfits - each a set of reference photos. The AI draft picks which ones go
        with each shot; change a shot&apos;s picks in its Details.
      </p>
      {notice && <p className="text-[10.5px] text-amber-300 leading-snug">{notice}</p>}

      {assets.map(a => {
        const Icon = ASSET_ICONS[a.kind]
        const isOpen = open[a.id] ?? true
        return (
          <div key={a.id} className="rounded-xl border border-white/10 bg-black/20">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button onClick={() => setOpen(o => ({ ...o, [a.id]: !isOpen }))} className="text-slate-500 hover:text-white">
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <Icon size={13} className="text-slate-200 shrink-0" />
              <input
                value={a.name}
                onChange={e => patch(a.id, x => ({ ...x, name: e.target.value }))}
                className="flex-1 min-w-0 bg-transparent text-[11.5px] font-semibold text-slate-100 focus:outline-none"
              />
              <span className="text-[9px] uppercase tracking-wider text-slate-600 shrink-0">{kindLabel(a.kind)}</span>
              <span className="text-[9.5px] font-mono text-slate-500 shrink-0">{a.refs.length}</span>
              <button
                onClick={() => saveToLibrary(a)}
                disabled={saving === a.id || a.refs.length === 0}
                title={a.libraryId ? "Update this asset in My Assets (My Generations)" : "Save to My Assets - reuse it on any board"}
                className={`shrink-0 disabled:opacity-30 ${a.libraryId ? "text-sky-300/80 hover:text-sky-200" : "text-slate-500 hover:text-white"}`}
              >
                {saving === a.id ? <Loader2 size={11} className="animate-spin" /> : a.libraryId ? <BookmarkCheck size={11} /> : <BookmarkPlus size={11} />}
              </button>
              <button onClick={() => onChange(list => list.filter(x => x.id !== a.id))} title="Delete this asset (the images stay in your library)" className="text-slate-600 hover:text-red-400 shrink-0"><Trash2 size={11} /></button>
            </div>
            {isOpen && (
              <div className="px-2 pb-2 space-y-1.5">
                <div className="grid grid-cols-5 gap-1">
                  {a.refs.map((r, k) => (
                    <div key={r.id} className="relative group">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener"
                        title={`${a.name} - reference ${k + 1}`}
                        className="relative block w-full aspect-square rounded-md overflow-hidden border border-white/10 hover:border-white/40 transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb(r.url)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        <span className="absolute bottom-0 left-0 px-1 bg-black/70 text-[8.5px] font-mono text-slate-200">{k + 1}</span>
                      </a>
                      <button
                        onClick={() => patch(a.id, x => ({ ...x, refs: x.refs.filter(y => y.id !== r.id) }))}
                        title="Remove from this asset"
                        className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-black/80 border border-white/15 hidden group-hover:flex items-center justify-center text-slate-300 hover:text-red-300"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  ))}
                  {a.refs.length < MAX_ASSET_REFS && (
                    <button
                      onClick={() => setPicker(a.id)}
                      title="Add references"
                      className="aspect-square rounded-md border border-dashed border-white/15 hover:border-white/50 text-slate-500 hover:text-slate-200 flex items-center justify-center"
                    >
                      {uploading === a.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                  )}
                </div>
                <input
                  value={a.notes}
                  onChange={e => patch(a.id, x => ({ ...x, notes: e.target.value }))}
                  placeholder="Notes (optional) - e.g. scar over left eye, red jacket"
                  className="w-full bg-transparent text-[10.5px] text-slate-400 focus:outline-none border-b border-white/5 focus:border-white/40 placeholder:text-slate-600"
                />
              </div>
            )}
          </div>
        )
      })}

      {adding ? (
        <div className="rounded-xl border border-white/15 bg-white/[0.03] p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Dropdown value={kind} options={KIND_OPTIONS} onChange={v => setKind(v as AssetKind)} className="w-36" />
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setAdding(false) }}
              placeholder={`${kindLabel(kind)} ${assets.filter(a => a.kind === kind).length + 1}`}
              className="flex-1 min-w-0 sb-input"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="px-2 py-1 rounded-md text-[10.5px] text-slate-400 hover:text-white">Cancel</button>
            <BrandButton onClick={create} primary size="xs">Add asset</BrandButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setAdding(true)}
            disabled={assets.length >= MAX_ASSETS}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-white/15 hover:border-white/40 text-[11px] font-semibold text-slate-400 hover:text-white disabled:opacity-40"
          >
            <Plus size={12} /> New asset
          </button>
          <button
            onClick={() => { setLibOpen(true); void library.load() }}
            disabled={assets.length >= MAX_ASSETS}
            title="Add assets you saved on My Generations"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/15 bg-white/[0.03] hover:border-white/40 text-[11px] font-semibold text-slate-300 hover:text-white disabled:opacity-40"
          >
            <Library size={12} /> My assets{library.assets?.length ? ` (${library.assets.length})` : ""}
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" onClick={gateFileInput} accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />

      {libOpen && (
        <LibraryPicker
          library={library.assets}
          onBoard={new Set(assets.map(a => a.libraryId).filter((x): x is number => !!x))}
          onAdd={picked => { addFromLibrary(picked); setLibOpen(false) }}
          onClose={() => setLibOpen(false)}
        />
      )}

      {picker && (
        <RefPicker
          title={`Add to ${assets.find(a => a.id === picker)?.name ?? "asset"}`}
          refLibrary={refLibrary}
          boardStills={boardStills}
          have={new Set(assets.find(a => a.id === picker)?.refs.map(r => stillKey(r.url)) ?? [])}
          onUpload={() => { uploadFor.current = picker; setPicker(null); fileRef.current?.click() }}
          onAdd={urls => { addRefs(picker, urls); setPicker(null) }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

/** Pick saved assets (My Generations' Assets) to copy onto this board. */
function LibraryPicker({ library, onBoard, onAdd, onClose }: {
  library: LibraryAsset[] | null
  onBoard: Set<number>
  onAdd: (picked: LibraryAsset[]) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<number[]>([])
  const flip = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative isolate overflow-hidden w-full max-w-3xl max-h-[85dvh] flex flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14]" onClick={e => e.stopPropagation()}>
        <SilverRimOverlay />
        <div className="relative px-4 pt-4 pb-3">
          <BrandTitle title="My Assets" eyebrow="Saved on My Generations - added as copies" logo={26} right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4">
          {library === null ? (
            <p className="py-10 flex items-center justify-center gap-2 text-[11.5px] text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading your assets</p>
          ) : library.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-[11.5px] text-slate-400">No saved assets yet.</p>
              <p className="text-[10.5px] text-slate-600">Make them on <a href="/my-generations" target="_blank" rel="noopener" className="text-slate-300 underline">My Generations</a> from your own images, or save one from this board with the bookmark on its card.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pb-3">
              {library.map(l => {
                const Icon = ASSET_ICONS[l.kind]
                const already = onBoard.has(l.id)
                const on = picked.includes(l.id)
                return (
                  <button
                    key={l.id}
                    disabled={already}
                    onClick={() => flip(l.id)}
                    className={`text-left rounded-xl overflow-hidden border transition-colors ${on ? "border-slate-100 ring-2 ring-white/40" : "border-white/10 hover:border-white/30"} ${already ? "opacity-40" : ""}`}
                  >
                    <span className="grid grid-cols-2 aspect-[4/3] bg-black/40">
                      {[0, 1, 2, 3].map(k => {
                        const r = l.refs[k]
                        return r
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img key={k} src={r.thumb || r.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                          : <span key={k} className="bg-white/[0.02]" />
                      })}
                    </span>
                    <span className="flex items-center gap-1.5 px-2 py-1.5">
                      <Icon size={12} className="text-slate-300 shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-[11.5px] font-semibold text-slate-100">{l.name}</span>
                      <span className="text-[9.5px] font-mono text-slate-500 shrink-0">{l.refs.length}</span>
                      {on && <Check size={11} className="text-white shrink-0" />}
                    </span>
                    {already && <span className="block px-2 pb-1.5 -mt-1 text-[9px] uppercase tracking-wider text-slate-500">On this board</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <span className="text-[11px] text-slate-500">{picked.length} picked</span>
          <BrandButton onClick={() => onAdd((library ?? []).filter(l => picked.includes(l.id)))} disabled={!picked.length} primary size="sm" className="ml-auto">
            Add {picked.length || ""} to board
          </BrandButton>
        </div>
      </div>
    </div>
  )
}

/** Pick refs for an asset: from the account's Refs library, or from this board's stills (every take). */
function RefPicker({ title, refLibrary, boardStills, have, onAdd, onUpload, onClose }: {
  title: string
  refLibrary: { id: string; url: string }[]
  boardStills: { url: string; label: string }[]
  have: Set<string>
  onAdd: (urls: string[]) => void
  onUpload: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<"refs" | "stills">(refLibrary.length ? "refs" : "stills")
  const [picked, setPicked] = useState<string[]>([])
  // The library holds videos too (by extension); assets are images
  const images = tab === "refs"
    ? refLibrary.filter(r => !/\.(mp4|mov|webm)(\?|$)/i.test(r.url)).map(r => ({ url: r.url, label: "" }))
    : boardStills
  const flip = (u: string) => setPicked(p => (p.includes(u) ? p.filter(x => x !== u) : [...p, u]))
  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative isolate overflow-hidden w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14]" onClick={e => e.stopPropagation()}>
        <SilverRimOverlay />
        <div className="relative px-4 pt-4 pb-3">
          <BrandTitle title={title} eyebrow="Add references" logo={26} right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>} />
        </div>
        <div className="flex items-center gap-1.5 px-4 pb-3">
          <button onClick={() => setTab("refs")} className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold ${tab === "refs" ? "bg-white/15 text-white border border-white/40" : "border border-white/10 text-slate-400 hover:text-white"}`}>
            <Images size={12} /> My Refs ({refLibrary.length})
          </button>
          <button onClick={() => setTab("stills")} className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold ${tab === "stills" ? "bg-white/15 text-white border border-white/40" : "border border-white/10 text-slate-400 hover:text-white"}`}>
            <Film size={12} /> This board&apos;s stills ({boardStills.length})
          </button>
          <button onClick={onUpload} className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-[11px] font-semibold text-slate-300 hover:text-white">
            <Upload size={12} /> Upload
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4">
          {images.length === 0 ? (
            <p className="py-10 text-center text-[11.5px] text-slate-500">{tab === "refs" ? "Your Refs library is empty - add images in the taskbar Refs, or upload." : "No stills on this board yet."}</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 pb-3">
              {images.map(im => {
                const already = have.has(stillKey(im.url))
                const on = picked.includes(im.url)
                return (
                  <button
                    key={im.url}
                    disabled={already}
                    onClick={() => flip(im.url)}
                    title={already ? "Already in this asset" : im.label}
                    className={`relative aspect-square rounded-md overflow-hidden border ${on ? "border-slate-100 ring-2 ring-white/50" : "border-white/10"} ${already ? "opacity-30" : "hover:border-white/30"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    {im.label && <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8.5px] font-mono text-slate-200 truncate px-1">{im.label}</span>}
                    {on && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center"><Check size={10} strokeWidth={3} className="text-black" /></span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <span className="text-[11px] text-slate-500">{picked.length} picked</span>
          <BrandButton onClick={() => onAdd(picked)} disabled={!picked.length} primary size="sm" className="ml-auto">
            Add {picked.length || ""}
          </BrandButton>
        </div>
      </div>
    </div>
  )
}

/** The shot card's "Ref" menu: put this still into an asset (or a new one), or into the Refs library. */
export function AddToAssetMenu({ assets, onPick, onNew, onLibrary, onClose }: {
  assets: StoryAsset[]
  onPick: (assetId: string) => void
  onNew: (kind: AssetKind) => void
  onLibrary?: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute bottom-9 left-1.5 right-1.5 z-30 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#0b0f19]/95 backdrop-blur p-1 shadow-xl">
        <div className="px-1.5 py-1 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">Add this still to</div>
        {assets.map(a => {
          const Icon = ASSET_ICONS[a.kind]
          return (
            <button key={a.id} onClick={() => onPick(a.id)} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[10.5px] text-slate-200 hover:bg-white/10">
              <Icon size={11} className="text-slate-200 shrink-0" /><span className="truncate">{a.name}</span>
              <span className="ml-auto text-[9px] text-slate-500 shrink-0">{a.refs.length}</span>
            </button>
          )
        })}
        <button onClick={() => onNew("character")} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[10.5px] text-white hover:bg-white/10">
          <Plus size={11} /> New character
        </button>
        <button onClick={() => onNew("other")} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[10.5px] text-white hover:bg-white/10">
          <Plus size={11} /> New asset
        </button>
        {onLibrary && (
          <button onClick={onLibrary} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[10.5px] text-slate-300 hover:bg-white/10 border-t border-white/10 mt-0.5 pt-1.5">
            <Images size={11} /> My Refs library (switched on)
          </button>
        )}
      </div>
    </>
  )
}

/**
 * The references one still is made with, in its shot's Details: every ref
 * on the list with its switch, where it came from, and which ones will
 * actually go (a model takes so many - they are taken a turn from each asset
 * at a time, see lib/storyboard pickRefs). The list starts out automatic
 * (the AI draft's pick, else the scene's cast, else the board's switched-on
 * refs); any change here makes it the shot's own, and "Reset" hands it back.
 */
export function ShotRefsPanel({ refs, auto, assets, refLibrary, boardStills, max, model, onChange }: {
  /** The list shown: the shot's own, or the automatic one (all on). */
  refs: ShotRef[]
  /** True when the shot has no list of its own (it follows its scene / the board). */
  auto: boolean
  assets: StoryAsset[]
  refLibrary: { id: string; url: string }[]
  boardStills: { url: string; label: string }[]
  /** How many its still model takes. */
  max: number
  model: string
  /** The shot's new list - undefined = back to automatic. */
  onChange: (next: ShotRef[] | undefined) => void
}) {
  const [adding, setAdding] = useState(false)
  const [picker, setPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sent = new Set(pickRefs(refs.filter(r => r.on), max).map(r => r.id))
  const onCount = refs.filter(r => r.on).length
  const have = new Set(refs.map(r => stillKey(r.url)))
  const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
  const add = (items: { url: string; assetId?: string }[]) => {
    const fresh = items.filter(i => !have.has(stillKey(i.url))).map(i => ({ id: rid(), url: i.url, on: true, ...(i.assetId ? { assetId: i.assetId } : {}) }))
    if (fresh.length) onChange([...refs, ...fresh].slice(0, MAX_SHOT_REFS))
    setAdding(false)
  }
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setErr(null)
    try {
      const urls: string[] = []
      for (const f of Array.from(files).slice(0, 12)) urls.push(await uploadImage(f))
      add(urls.map(url => ({ url })))
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }
  const nameOf = (id?: string) => (id ? assets.find(a => a.id === id)?.name : undefined)

  return (
    <div className="silver-edge rounded-xl p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <BrandTitle title="References" logo={16} size="sm" />
        <span className={`ml-auto px-1.5 py-0.5 rounded-md text-[9px] font-mono uppercase tracking-wider ${auto ? "bg-white/[0.06] text-slate-400" : "bg-sky-500/15 text-sky-200"}`}>
          {auto ? "Automatic" : "This shot's own"}
        </span>
        {!auto && (
          <button onClick={() => onChange(undefined)} title="Hand the references back to the scene / board" className="text-[10px] text-slate-500 hover:text-white">Reset</button>
        )}
      </div>
      <p className="text-[9.5px] leading-snug text-slate-500">
        {max === 0
          ? `${model} takes no references - none will be sent.`
          : `${Math.min(onCount, max)} of ${onCount} switched on will be sent · ${model} takes ${max}. Tap one to switch it.`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {refs.map(r => {
          const goes = sent.has(r.id)
          const name = nameOf(r.assetId)
          return (
            <div key={r.id} className="relative group/ref">
              <button
                onClick={() => onChange(refs.map(x => (x.id === r.id ? { ...x, on: !x.on } : x)))}
                title={`${name ? `${name} · ` : ""}${!r.on ? "Off - tap to switch on" : goes ? "Sent with this still" : `On, but ${model} takes only ${max}`}`}
                className={`relative block w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${!r.on ? "border-transparent opacity-35 grayscale" : goes ? "border-sky-400/80" : "border-amber-400/60 opacity-70"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="w-full h-full object-cover" />
                {r.on && goes && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-sky-500 flex items-center justify-center"><Check size={9} className="text-white" /></span>}
                {name && <span className="absolute inset-x-0 bottom-0 px-0.5 bg-black/70 text-[8px] text-slate-200 truncate">{name}</span>}
              </button>
              <button
                onClick={() => onChange(refs.filter(x => x.id !== r.id))}
                title="Take it off this shot"
                className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-black border border-white/20 text-slate-300 hover:text-white items-center justify-center hidden group-hover/ref:flex"
              >
                <X size={9} />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => setAdding(a => !a)}
          disabled={uploading}
          className="w-14 h-14 rounded-lg border border-dashed border-white/20 text-slate-500 hover:text-white hover:border-white/40 flex flex-col items-center justify-center gap-0.5 text-[9px]"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      {refs.length === 0 && <p className="text-[9.5px] text-slate-500">No references - the still is made from the prompt alone.</p>}
      {adding && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-1.5 space-y-1">
          {assets.filter(a => a.refs.length).map(a => (
            <button key={a.id} onClick={() => add(a.refs.map(r => ({ url: r.url, assetId: a.id })))} className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left text-[10.5px] text-slate-200 hover:bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.refs[0].url} alt="" className="w-6 h-6 rounded object-cover" />
              <span className="truncate">{a.name}</span>
              <span className="ml-auto text-[9.5px] text-slate-500">all {a.refs.length}</span>
            </button>
          ))}
          <button onClick={() => { setPicker(true); setAdding(false) }} className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left text-[10.5px] text-slate-300 hover:bg-white/5">
            <Images size={13} className="text-slate-500" /> From my Refs or this board&apos;s stills…
          </button>
          <button onClick={() => { setAdding(false); fileRef.current?.click() }} className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left text-[10.5px] text-slate-300 hover:bg-white/5">
            <Upload size={13} className="text-slate-500" /> Upload from this device…
          </button>
        </div>
      )}
      {err && <p className="text-[10px] text-red-400">{err}</p>}
      <input ref={fileRef} type="file" onClick={gateFileInput} accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
      {picker && (
        <RefPicker
          title="This shot's references"
          refLibrary={refLibrary}
          boardStills={boardStills}
          have={have}
          onAdd={urls => { add(urls.map(url => ({ url }))); setPicker(false) }}
          onUpload={() => { setPicker(false); fileRef.current?.click() }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}
