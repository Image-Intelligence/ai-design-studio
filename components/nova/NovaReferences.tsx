"use client"

import { useEffect, useMemo, useState } from "react"
import { AudioLines, BookMarked, Check, ChevronDown, Images, Library, Loader2, Package, Plus, Search, Video, X } from "lucide-react"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton } from "@/components/employees/StudioBrand"
import { openLibraryPickerItems, type PickedItem } from "@/components/feed/LibraryPicker"
import { ASSET_KINDS } from "@/lib/storyboard"
import type { NovaChatBible, NovaChatRefs } from "./novaApi"

/*
 * The chat's references, in the studio panel (2026-10-19, owner): which of
 * the account's assets - and which My Generations items - Nova uses in this
 * chat. Switch assets on and off, add generations from My Generations, or
 * make a new asset right here (name, kind, notes, pictures from My
 * Generations) - it is switched on as it is made. The server keeps the set
 * on the chat (PATCH /api/nova/chats/[id] { refs }) and tells Nova about it
 * every turn (lib/nova/chat-refs).
 */

export const NOVA_MAX_REF_ASSETS = 8
export const NOVA_MAX_REF_GENERATIONS = 12

type AssetRow = { id: number; kind: string; name: string; notes: string; refs: { url: string; thumb?: string | null }[] }
export type RefIds = { assets: number[]; generations: number[] }

const kindLabel = (k: string) => ASSET_KINDS.find(x => x.id === k)?.label ?? k

/**
 * The look bible Nova locked for this chat (2026-10-19): who and where the
 * production's characters and places are, and its style - shown so the user
 * can see what every shot is held to, and clear it to start over.
 */
function LookBible({ bible, onClear }: { bible: NovaChatBible; onClear?: () => void }) {
  const entries = [...bible.characters.map(c => ({ ...c, what: "Character" })), ...bible.places.map(p => ({ ...p, what: "Place" }))]
  return (
    <div className="rounded-xl border border-sky-300/20 bg-sky-500/[0.05] p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <BookMarked size={12} className="text-sky-200" />
        <p className="text-[11px] font-semibold text-sky-100">Look bible</p>
        <span className="text-[9.5px] text-slate-500">set by Nova</span>
        {onClear && <button onClick={onClear} className="ml-auto text-[10px] text-slate-400 hover:text-white" title="Nova stops holding shots to these">Clear</button>}
      </div>
      {entries.map(e => (
        <div key={`${e.what}-${e.name}`} className="flex items-center gap-1.5 min-w-0">
          <div className="flex -space-x-1.5 shrink-0">
            {e.pictures.slice(0, 3).map(p => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.thumb ?? ""} alt="" loading="lazy" title={`#${p.id}`} className="w-7 h-7 rounded-md object-cover border border-black/60 bg-slate-800" />
            ))}
          </div>
          <span className="min-w-0 text-[10.5px] leading-tight">
            <span className="block text-white truncate">{e.name}</span>
            <span className="block text-[9.5px] text-slate-500">{e.what} · {e.pictures.map(p => `#${p.id}`).join(" ")}</span>
          </span>
        </div>
      ))}
      {bible.style && <p className="text-[10px] text-slate-400 leading-snug line-clamp-3" title={bible.style}>{bible.style}</p>}
    </div>
  )
}

export function NovaReferences({ refs, saving, error, onChange, bible, onClearBible }: {
  refs: NovaChatRefs
  saving: boolean
  error: string | null
  /** The new set of ids - the parent saves it on the chat (making the chat first if there is none yet). */
  onChange: (next: RefIds) => void
  bible?: NovaChatBible | null
  onClearBible?: () => void
}) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [q, setQ] = useState("")
  const [creating, setCreating] = useState(false)
  // The switches flip at once; the saved set (with names and pictures) replaces this when it lands
  const [pending, setPending] = useState<RefIds | null>(null)
  const [seenRefs, setSeenRefs] = useState(refs)
  const [seenErr, setSeenErr] = useState(error)
  if (refs !== seenRefs || error !== seenErr) { setSeenRefs(refs); setSeenErr(error); setPending(null) }
  const ids: RefIds = pending ?? { assets: refs.assets.map(a => a.id), generations: refs.generations.map(g => g.id) }
  const change = (next: RefIds) => { setPending(next); onChange(next) }

  const loadAssets = () => fetch("/api/user/assets", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(d => setAssets(Array.isArray(d?.assets) ? d.assets : [])).catch(() => setAssets([]))
  useEffect(() => { void loadAssets() }, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (assets ?? []).filter(a => !t || a.name.toLowerCase().includes(t) || a.kind.includes(t) || a.notes.toLowerCase().includes(t))
  }, [assets, q])
  const toggleAsset = (id: number) => {
    const on = ids.assets.includes(id)
    if (!on && ids.assets.length >= NOVA_MAX_REF_ASSETS) return
    change({ ...ids, assets: on ? ids.assets.filter(x => x !== id) : [...ids.assets, id] })
  }
  const addGenerations = async () => {
    const room = NOVA_MAX_REF_GENERATIONS - ids.generations.length
    if (room <= 0) return
    const items = await openLibraryPickerItems({ max: room, media: "all", title: `Reference up to ${room} from My Generations` })
    const add = items.map(i => i.generationId).filter((n): n is number => typeof n === "number" && !ids.generations.includes(n))
    if (add.length) change({ ...ids, generations: [...ids.generations, ...add].slice(0, NOVA_MAX_REF_GENERATIONS) })
  }
  const total = ids.assets.length + ids.generations.length

  return (
    <section className="rounded-2xl silver-edge bg-[#0b0f1a]/80 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-slate-400">References</p>
        {saving && <Loader2 size={11} className="animate-spin text-slate-500" />}
        <span className="ml-auto text-[10.5px] text-fuchsia-200/80 tabular-nums">{total ? `${total} on` : "none on"}</span>
      </div>
      <p className="text-[10.5px] text-slate-500 leading-snug">Nova uses these in every message of this chat - who &ldquo;the character&rdquo; is, which product, which shot.</p>
      {error && <p className="text-[10.5px] text-red-300">{error}</p>}
      {bible && <LookBible bible={bible} onClear={onClearBible} />}

      {/* what is switched on */}
      {!!refs.assets.length && (
        <div className="space-y-1">
          {refs.assets.map(a => (
            <div key={a.id} className="flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-lg border border-fuchsia-300/25 bg-fuchsia-500/[0.07]">
              <span className="shrink-0 w-8 h-8 rounded-md overflow-hidden bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.thumb ? <img src={a.thumb} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Package size={13} className="m-2.5 text-slate-500" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-semibold text-white truncate">{a.name}</span>
                <span className="block text-[9.5px] text-slate-400">{kindLabel(a.kind)} · {a.pictures.length} picture{a.pictures.length === 1 ? "" : "s"}</span>
              </span>
              <button onClick={() => toggleAsset(a.id)} className="p-1 text-fuchsia-200/60 hover:text-white" aria-label={`Stop referencing ${a.name}`} title="Stop referencing"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {!!refs.generations.length && (
        <div className="grid grid-cols-4 gap-1.5">
          {refs.generations.map(g => (
            <div key={g.id} className="group relative aspect-square rounded-lg overflow-hidden bg-black/40 border border-fuchsia-300/25" title={g.prompt || `#${g.id}`}>
              {g.kind === "audio"
                ? <span className="w-full h-full flex items-center justify-center bg-amber-500/10"><AudioLines size={16} className="text-amber-200" /></span>
                // eslint-disable-next-line @next/next/no-img-element
                : g.thumb || g.kind === "image" ? <img src={g.thumb || g.url} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { e.currentTarget.style.display = "none" }} />
                : <span className="w-full h-full flex items-center justify-center"><Video size={16} className="text-slate-400" /></span>}
              {(g.kind === "video" || g.kind === "cut") && <span className="absolute bottom-0.5 left-0.5 p-0.5 rounded bg-black/70"><Video size={9} className="text-white" /></span>}
              <span className="absolute top-0.5 left-0.5 px-1 rounded bg-black/70 text-[8px] font-mono text-slate-300">#{g.id}</span>
              <button onClick={() => change({ ...ids, generations: ids.generations.filter(x => x !== g.id) })}
                className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 text-slate-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100" aria-label={`Stop referencing #${g.id}`}><X size={10} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => void addGenerations()} disabled={ids.generations.length >= NOVA_MAX_REF_GENERATIONS}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-white/10 text-[10.5px] font-semibold text-slate-300 hover:text-white hover:border-white/25 disabled:opacity-40">
          <Images size={12} /> My Generations
        </button>
        <button onClick={() => setCreating(c => !c)}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-[10.5px] font-semibold ${creating ? "border-fuchsia-300/40 text-white bg-fuchsia-500/10" : "border-white/10 text-slate-300 hover:text-white hover:border-white/25"}`}>
          <Plus size={12} /> New asset
        </button>
      </div>

      {creating && (
        <NewAssetForm
          onCancel={() => setCreating(false)}
          onCreated={a => {
            setCreating(false)
            setAssets(xs => [a, ...(xs ?? [])])
            if (ids.assets.length < NOVA_MAX_REF_ASSETS) change({ ...ids, assets: [...ids.assets, a.id] })
          }}
        />
      )}

      {/* every asset, with its switch */}
      <div className="rounded-xl border border-white/[0.07]">
        <button onClick={() => setListOpen(o => !o)} className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left">
          <Library size={12} className="text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-200">Your assets</span>
          <span className="text-[10px] text-slate-500">{assets ? `${assets.length} available` : "…"}</span>
          <ChevronDown size={13} className={`ml-auto text-slate-500 transition-transform ${listOpen ? "rotate-180" : ""}`} />
        </button>
        {listOpen && (
          <div className="px-2 pb-2 space-y-1.5">
            {(assets?.length ?? 0) > 6 && (
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search assets"
                  className="w-full pl-6 pr-2 py-1 rounded-md bg-black/40 border border-white/10 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
              </div>
            )}
            {!assets && <div className="py-3 flex justify-center"><Loader2 size={14} className="animate-spin text-slate-500" /></div>}
            {assets && !assets.length && <p className="py-2 text-[10.5px] text-slate-500">No assets yet - make one with New asset.</p>}
            <div className="max-h-72 overflow-y-auto overscroll-contain space-y-0.5 pr-0.5">
              {shown.map(a => {
                const on = ids.assets.includes(a.id)
                const full = !on && ids.assets.length >= NOVA_MAX_REF_ASSETS
                const cover = a.refs[0]?.thumb || a.refs[0]?.url
                return (
                  <button key={a.id} onClick={() => toggleAsset(a.id)} disabled={full} title={full ? `Up to ${NOVA_MAX_REF_ASSETS} assets per chat` : on ? "Stop referencing" : "Reference in this chat"}
                    className={`w-full flex items-center gap-2 px-1.5 py-1 rounded-lg text-left transition-colors disabled:opacity-40 ${on ? "bg-fuchsia-500/[0.08]" : "hover:bg-white/[0.04]"}`}>
                    <span className="shrink-0 w-7 h-7 rounded-md overflow-hidden bg-slate-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {cover && <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-slate-200 truncate">{a.name}</span>
                      <span className="block text-[9.5px] text-slate-500">{kindLabel(a.kind)} · {a.refs.length}</span>
                    </span>
                    {/* the switch */}
                    <span className={`shrink-0 w-7 h-4 rounded-full p-0.5 transition-colors ${on ? "bg-fuchsia-400" : "bg-white/15"}`}>
                      <span className={`block w-3 h-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Make an asset here: name, kind, notes and pictures from My Generations (POST /api/user/assets). */
function NewAssetForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (a: AssetRow) => void }) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState("character")
  const [notes, setNotes] = useState("")
  const [pics, setPics] = useState<PickedItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pick = async () => {
    const items = await openLibraryPickerItems({ max: Math.max(1, 8 - pics.length), title: "Pictures of this asset" })
    setPics(p => [...p, ...items.filter(i => i.generationId !== null && !p.some(x => x.generationId === i.generationId))].slice(0, 8))
  }
  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch("/api/user/assets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim(), notes: notes.trim(), imageIds: pics.map(p => p.generationId) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.asset) throw new Error(d.error || "Could not make the asset")
      onCreated(d.asset)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-xl border border-fuchsia-300/25 bg-fuchsia-500/[0.04] p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Nova, the red sneaker)" maxLength={80} autoFocus
          className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-black/40 border border-white/10 text-[11.5px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
        <Dropdown value={kind} options={ASSET_KINDS.map(k => ({ value: k.id, label: k.label }))} onChange={setKind} className="w-28" />
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes Nova should keep to (look, colours, personality, rules)"
        className="w-full px-2 py-1.5 rounded-md bg-black/40 border border-white/10 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30 resize-y" />
      <div className="flex flex-wrap items-center gap-1.5">
        {pics.map(p => (
          <span key={p.url} className="relative w-10 h-10 rounded-md overflow-hidden border border-white/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb || p.url} alt="" className="w-full h-full object-cover" />
            <button onClick={() => setPics(xs => xs.filter(x => x.url !== p.url))} className="absolute top-0 right-0 p-0.5 bg-black/70 text-slate-200" aria-label="Remove picture"><X size={9} /></button>
          </span>
        ))}
        {pics.length < 8 && (
          <button onClick={() => void pick()} className="h-10 px-2 rounded-md border border-dashed border-white/20 text-[10px] text-slate-400 hover:text-white hover:border-white/40 flex items-center gap-1">
            <Images size={11} /> {pics.length ? "More" : "Pictures"}
          </button>
        )}
      </div>
      {err && <p className="text-[10.5px] text-red-300">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="text-[10.5px] text-slate-500 hover:text-white">Cancel</button>
        <BrandButton primary size="xs" busy={busy} disabled={busy || !name.trim()} onClick={() => void create()} className="ml-auto" icon={<Check size={11} />}>
          Make &amp; reference
        </BrandButton>
      </div>
      <p className="text-[9.5px] text-slate-500">Saved to your Assets (My Generations) too, so every studio can use it.</p>
    </div>
  )
}
