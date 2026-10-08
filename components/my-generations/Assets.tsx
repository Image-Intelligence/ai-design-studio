"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, X, Loader2, Trash2, ImagePlus, Check, Clapperboard } from "lucide-react"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { ASSET_ICONS } from "@/components/employees/StoryboardAssets"
import { ASSET_KINDS, MAX_ASSET_REFS, type AssetKind } from "@/lib/storyboard"

/*
 * My Generations - Assets. A character, vehicle, prop, place, outfit... made
 * from the account's own pictures (picked in the feed, from any folder) and
 * saved to the account (UserAsset, /api/user/assets), ready to pull into any
 * Storyboard Studio board ("My assets" in a board's Assets panel).
 */

export type UserAsset = {
  id: number
  kind: AssetKind
  name: string
  notes: string
  refs: { id: string; url: string; thumb?: string | null }[]
  updatedAt?: string
}

const KIND_OPTIONS = ASSET_KINDS.map(k => ({ value: k.id, label: k.label }))
export const kindLabel = (k: AssetKind) => ASSET_KINDS.find(x => x.id === k)?.label ?? k

async function call<T>(method: string, body?: unknown, query = ""): Promise<T> {
  const r = await fetch(`/api/user/assets${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`)
  return j as T
}

/** The account's saved assets, with the calls that change them. */
export function useUserAssets(enabled: boolean) {
  const [assets, setAssets] = useState<UserAsset[] | null>(null)
  const load = useCallback(async () => {
    try { setAssets((await call<{ assets: UserAsset[] }>("GET")).assets) } catch { setAssets(a => a ?? []) }
  }, [])
  useEffect(() => { if (enabled) void load() }, [enabled, load])
  const put = (a: UserAsset) => setAssets(list => {
    const rest = (list ?? []).filter(x => x.id !== a.id)
    return [a, ...rest]
  })
  return {
    assets,
    load,
    // urls / addUrls: pictures by link (the Refs panel's references) - the API keeps the account's own only
    create: async (o: { kind: AssetKind; name: string; notes?: string; imageIds?: number[]; urls?: string[] }) => {
      const { asset } = await call<{ asset: UserAsset }>("POST", o)
      put(asset)
      return asset
    },
    update: async (o: { id: number; kind?: AssetKind; name?: string; notes?: string; addImageIds?: number[]; addUrls?: string[]; removeRefIds?: string[] }) => {
      const { asset, added } = await call<{ asset: UserAsset; added: number }>("PATCH", o)
      put(asset)
      return { asset, added }
    },
    remove: async (id: number) => {
      await call("DELETE", undefined, `?id=${id}`)
      setAssets(list => (list ?? []).filter(x => x.id !== id))
    },
  }
}

/** Four pictures of an asset as one cover. */
function Mosaic({ a, className = "" }: { a: UserAsset; className?: string }) {
  const Icon = ASSET_ICONS[a.kind]
  if (!a.refs.length) {
    return (
      <span className={`flex items-center justify-center bg-gradient-to-br from-white/[0.05] to-transparent ${className}`}>
        <Icon size={28} className="text-slate-600" />
      </span>
    )
  }
  const shown = a.refs.slice(0, 4)
  return (
    <span className={`grid ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-px bg-black/50 ${className}`}>
      {shown.map((r, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={r.id} src={r.thumb || r.url} alt="" loading="lazy" className={`w-full h-full object-cover ${shown.length === 3 && k === 0 ? "row-span-2" : ""}`} />
      ))}
    </span>
  )
}

/** The Assets view: every saved asset, and a New asset card. */
export function AssetsGrid({ assets, onOpen, onNew }: {
  assets: UserAsset[] | null
  onOpen: (a: UserAsset) => void
  onNew: () => void
}) {
  if (assets === null) {
    return <p className="py-24 flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Loading your assets</p>
  }
  return (
    <div className="space-y-4">
      <div className="silver-edge rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <BrandTitle
          title="Your assets"
          eyebrow={`${assets.length} saved · characters, vehicles, props, places, outfits`}
          logo={30}
        />
        <p className="sm:ml-auto sm:max-w-md text-[11px] text-slate-500 leading-relaxed">
          Build an asset from your own pictures: open one and add pictures, or choose <span className="text-slate-300">Select</span> in
          any folder and <span className="text-slate-300">Add to asset</span>. Use them in Storyboard Studio from a board&apos;s
          Assets panel - <span className="text-slate-300">My assets</span>.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3">
        <button
          onClick={onNew}
          className="group aspect-[4/5] rounded-2xl border border-dashed border-white/15 hover:border-white/40 bg-white/[0.02] hover:bg-white/[0.04] flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-white transition-all"
        >
          <span className="w-11 h-11 rounded-full border border-white/15 group-hover:border-white/40 flex items-center justify-center"><Plus size={18} /></span>
          <span className="text-[12px] font-semibold">New asset</span>
        </button>
        {assets.map(a => {
          const Icon = ASSET_ICONS[a.kind]
          return (
            <button key={a.id} onClick={() => onOpen(a)} className="group text-left aspect-[4/5] rounded-2xl overflow-hidden silver-edge flex flex-col hover:-translate-y-0.5 transition-transform">
              <Mosaic a={a} className="flex-1 min-h-0" />
              <span className="flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06] bg-black/30">
                <Icon size={14} className="text-slate-300 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-slate-100">{a.name}</span>
                  <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-slate-500">{kindLabel(a.kind)} · {a.refs.length} picture{a.refs.length === 1 ? "" : "s"}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[9998] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`relative isolate overflow-hidden w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[88dvh] flex flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] shadow-2xl`}
        onClick={e => e.stopPropagation()}
      >
        <SilverRimOverlay />
        {children}
      </div>
    </div>
  )
}

/** Kind + name, for a new asset (here, and inside the add-to-asset picker). */
function NewAssetFields({ kind, setKind, name, setName, onSubmit, autoFocus }: {
  kind: AssetKind; setKind: (k: AssetKind) => void; name: string; setName: (s: string) => void; onSubmit: () => void; autoFocus?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Dropdown value={kind} options={KIND_OPTIONS} onChange={v => setKind(v as AssetKind)} className="w-40 shrink-0" />
      <input
        autoFocus={autoFocus}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onSubmit() }}
        placeholder={`Name - e.g. "Captain Mara"`}
        maxLength={80}
        className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:border-white/40 text-[12.5px] text-white placeholder:text-slate-600 focus:outline-none"
      />
    </div>
  )
}

/** A brand-new asset, empty - pictures are added from the feed. */
export function NewAssetModal({ onCreate, onClose }: {
  onCreate: (kind: AssetKind, name: string) => Promise<void>
  onClose: () => void
}) {
  const [kind, setKind] = useState<AssetKind>("character")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try { await onCreate(kind, name.trim() || `${kindLabel(kind)} 1`) } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="relative p-5 space-y-4">
        <BrandTitle title="New asset" eyebrow="A character, vehicle, prop, place..." logo={28} right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>} />
        <NewAssetFields kind={kind} setKind={setKind} name={name} setName={setName} onSubmit={submit} autoFocus />
        <p className="text-[11px] text-slate-500 leading-relaxed">Next you&apos;ll pick its pictures from your generations - any folder.</p>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-[11.5px] text-slate-400 hover:text-white">Cancel</button>
          <BrandButton onClick={submit} busy={busy} primary size="md">Create &amp; add pictures</BrandButton>
        </div>
      </div>
    </Modal>
  )
}

/** One asset: rename, change kind, notes, remove pictures, add more, delete. */
export function AssetEditor({ asset, onClose, onUpdate, onDelete, onAddPictures }: {
  asset: UserAsset
  onClose: () => void
  onUpdate: (o: { kind?: AssetKind; name?: string; notes?: string; removeRefIds?: string[] }) => Promise<void>
  onDelete: () => Promise<void>
  onAddPictures: () => void
}) {
  const [name, setName] = useState(asset.name)
  const [notes, setNotes] = useState(asset.notes)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setName(asset.name); setNotes(asset.notes) }, [asset.id, asset.name, asset.notes])
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  const saveText = () => {
    const n = name.trim()
    if ((n && n !== asset.name) || notes !== asset.notes) void run("text", () => onUpdate({ ...(n && n !== asset.name ? { name: n } : {}), ...(notes !== asset.notes ? { notes } : {}) }))
  }
  return (
    <Modal onClose={onClose} wide>
      <div className="relative px-5 pt-5 pb-3 space-y-3 border-b border-white/[0.06]">
        <BrandTitle
          title={asset.name}
          eyebrow={`${kindLabel(asset.kind)} · ${asset.refs.length} of ${MAX_ASSET_REFS} pictures`}
          logo={28}
          right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown value={asset.kind} options={KIND_OPTIONS} onChange={v => void run("kind", () => onUpdate({ kind: v as AssetKind }))} className="w-40" />
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveText}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
            maxLength={80}
            className="flex-1 min-w-[10rem] px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:border-white/40 text-[12.5px] font-semibold text-white focus:outline-none"
          />
          {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveText}
          rows={2}
          maxLength={1000}
          placeholder="Notes (optional) - what makes it recognisable: a scar over the left eye, a red jacket, chrome rims"
          className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:border-white/40 text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none"
        />
      </div>
      <div className="relative flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {asset.refs.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-[12px] text-slate-400">No pictures yet.</p>
            <BrandButton onClick={onAddPictures} primary size="md" icon={<ImagePlus size={14} />}>Add pictures from my generations</BrandButton>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {asset.refs.map((r, k) => (
              <div key={r.id} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.thumb || r.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 px-1.5 py-0.5 bg-black/70 text-[9px] font-mono text-slate-200">{k + 1}</span>
                <button
                  onClick={() => void run(r.id, () => onUpdate({ removeRefIds: [r.id] }))}
                  title="Remove from this asset (the picture stays in your generations)"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/75 border border-white/15 flex items-center justify-center text-slate-300 hover:text-red-300 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <X size={12} />}
                </button>
              </div>
            ))}
            {asset.refs.length < MAX_ASSET_REFS && (
              <button onClick={onAddPictures} className="aspect-square rounded-lg border border-dashed border-white/15 hover:border-white/40 text-slate-500 hover:text-white flex flex-col items-center justify-center gap-1 transition-colors">
                <Plus size={16} />
                <span className="text-[10px] font-semibold">Add</span>
              </button>
            )}
          </div>
        )}
        {err && <p className="mt-3 text-[11px] text-red-300">{err}</p>}
      </div>
      <div className="relative flex flex-wrap items-center gap-2 px-5 py-3 border-t border-white/[0.06]">
        {confirmDelete ? (
          <>
            <span className="text-[11.5px] text-slate-300">Delete this asset? Its pictures stay in your generations.</span>
            <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-white">Keep</button>
            <button onClick={() => void run("delete", onDelete)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-[11px] font-bold">
              {busy === "delete" ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-red-300"><Trash2 size={12} /> Delete asset</button>
            <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-slate-500"><Clapperboard size={12} /> In Storyboard Studio: Assets → My assets</span>
            {asset.refs.length > 0 && asset.refs.length < MAX_ASSET_REFS && (
              <BrandButton onClick={onAddPictures} size="sm" icon={<ImagePlus size={13} />}>Add pictures</BrandButton>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** "Add to asset" from a selection: an existing asset, or a new one made from it. */
export function AddToAssetModal({ count, assets, onAdd, onCreate, onClose }: {
  count: number
  assets: UserAsset[] | null
  onAdd: (a: UserAsset) => Promise<void>
  onCreate: (kind: AssetKind, name: string) => Promise<void>
  onClose: () => void
}) {
  const [kind, setKind] = useState<AssetKind>("character")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string | number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const run = async (key: string | number, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e: any) { setErr(String(e?.message || e)); setBusy(null) }
  }
  return (
    <Modal onClose={onClose}>
      <div className="relative px-5 pt-5 pb-3">
        <BrandTitle title="Add to asset" eyebrow={`${count} picture${count === 1 ? "" : "s"} selected · videos are skipped`} logo={28} right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>} />
      </div>
      <div className="relative flex-1 min-h-0 overflow-y-auto px-5 space-y-1.5">
        {assets === null ? (
          <p className="py-6 flex items-center justify-center gap-2 text-[11.5px] text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading</p>
        ) : assets.length === 0 ? (
          <p className="py-4 text-[11.5px] text-slate-500">No assets yet - make the first one below.</p>
        ) : assets.map(a => {
          const Icon = ASSET_ICONS[a.kind]
          const full = a.refs.length >= MAX_ASSET_REFS
          return (
            <button
              key={a.id}
              disabled={!!busy || full}
              onClick={() => void run(a.id, () => onAdd(a))}
              className="w-full flex items-center gap-3 p-2 rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.05] text-left disabled:opacity-40 transition-colors"
            >
              <Mosaic a={a} className="w-12 h-12 rounded-lg overflow-hidden shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-100 truncate"><Icon size={12} className="text-slate-400 shrink-0" />{a.name}</span>
                <span className="block text-[9.5px] font-mono uppercase tracking-[0.16em] text-slate-500">{kindLabel(a.kind)} · {full ? "full" : `${a.refs.length}/${MAX_ASSET_REFS}`}</span>
              </span>
              {busy === a.id ? <Loader2 size={14} className="animate-spin text-slate-300" /> : <Check size={14} className="text-slate-600" />}
            </button>
          )
        })}
      </div>
      <div className="relative px-5 py-4 mt-2 border-t border-white/[0.06] space-y-2.5">
        <p className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-slate-500">Or a new asset</p>
        <NewAssetFields kind={kind} setKind={setKind} name={name} setName={setName} onSubmit={() => void run("new", () => onCreate(kind, name.trim() || `${kindLabel(kind)} 1`))} />
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <div className="flex justify-end">
          <BrandButton onClick={() => void run("new", () => onCreate(kind, name.trim() || `${kindLabel(kind)} 1`))} busy={busy === "new"} disabled={!!busy && busy !== "new"} primary size="md">
            Create with {count} picture{count === 1 ? "" : "s"}
          </BrandButton>
        </div>
      </div>
    </Modal>
  )
}
