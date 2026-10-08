"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Boxes, Check, ChevronLeft, Folder, Images, Loader2, Search, X } from "lucide-react"

/*
 * "Choose from My Generations" (2026-10-08) - pick pictures for a video
 * model's image slots (start / end frame, references, a tool's pictures) from
 * the account's own library instead of uploading them again.
 *
 *   My Generations   the folder tree (searchable) and its pictures, newest first
 *   Assets           the characters / places / props saved on My Generations
 *
 * One host is mounted on the page (<LibraryPickerHost />); any slot opens it
 * with openLibraryPicker({ max }) and gets back the chosen pictures' links
 * (signed - they work as previews, and the generate route stores them
 * canonical), or [] when closed. No props threaded through the panels.
 */
type Folder = { id: number; name: string; parentId: number | null }
type Pic = { id: string; url: string; thumb: string }
type Asset = { id: number; name: string; kind: string; refs: { id: string; url: string; thumb?: string | null }[] }
type Request = { max: number; title?: string; resolve: (urls: string[]) => void }

let setRequestGlobal: ((r: Request | null) => void) | null = null
/** Open the picker; resolves with up to `max` picture links ([] if closed). */
export function openLibraryPicker(o: { max?: number; title?: string } = {}): Promise<string[]> {
  return new Promise(resolve => {
    if (!setRequestGlobal) { resolve([]); return }
    setRequestGlobal({ max: Math.max(1, o.max ?? 1), title: o.title, resolve })
  })
}

const PAGE = 48
const thumbOf = (img: any): string => img.thumbnailUrl || img.videoMetadata?.thumbnailUrl || `/api/images/${img.id}?thumb=1`

export function LibraryPickerHost() {
  const [req, setReq] = useState<Request | null>(null)
  useEffect(() => { setRequestGlobal = setReq; return () => { setRequestGlobal = null } }, [])
  if (!req || typeof document === "undefined") return null
  return createPortal(<Picker req={req} close={urls => { req.resolve(urls); setReq(null) }} />, document.body)
}

function Picker({ req, close }: { req: Request; close: (urls: string[]) => void }) {
  const [tab, setTab] = useState<"gens" | "assets">("gens")
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState<number | "root" | "all">("all")
  const [q, setQ] = useState("")
  const [pics, setPics] = useState<Pic[]>([])
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [openAsset, setOpenAsset] = useState<Asset | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/user/generation-folders").then(r => (r.ok ? r.json() : null)).then(d => setFolders(d?.folders ?? [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (tab !== "assets" || assets) return
    fetch("/api/user/assets").then(r => (r.ok ? r.json() : null)).then(d => setAssets(d?.assets ?? [])).catch(() => setAssets([]))
  }, [tab, assets])

  // A folder's pictures (images only), a page at a time
  const load = useCallback(async (p: number, reset: boolean) => {
    setLoading(true)
    try {
      const fq = folderId === "all" ? "" : `&folderId=${folderId}`
      const r = await fetch(`/api/my-images?type=image&page=${p}&limit=${PAGE}&count=0${fq}`)
      const d = r.ok ? await r.json() : null
      const rows: Pic[] = (d?.images ?? []).map((img: any) => ({ id: String(img.id), url: img.imageUrl, thumb: thumbOf(img) }))
      setPics(prev => (reset ? rows : [...prev, ...rows]))
      setMore(rows.length === PAGE)
      setPage(p)
    } finally { setLoading(false) }
  }, [folderId])
  useEffect(() => { if (tab === "gens") load(1, true) }, [tab, folderId, load])

  const toggle = (url: string) => setPicked(prev => {
    if (prev.includes(url)) return prev.filter(u => u !== url)
    if (req.max === 1) return [url]
    return prev.length >= req.max ? prev : [...prev, url]
  })

  // The folder tree, flattened with depth; a search shows matches with their path
  const tree = useMemo(() => {
    const kids = new Map<number | null, Folder[]>()
    for (const f of folders) kids.set(f.parentId ?? null, [...(kids.get(f.parentId ?? null) ?? []), f])
    const out: { f: Folder; depth: number }[] = []
    const walk = (pid: number | null, depth: number) => {
      for (const f of (kids.get(pid) ?? []).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ f, depth }); walk(f.id, depth + 1) }
    }
    walk(null, 0)
    return out
  }, [folders])
  const shown = q.trim() ? tree.filter(t => t.f.name.toLowerCase().includes(q.trim().toLowerCase())).map(t => ({ ...t, depth: 0 })) : tree

  const tile = (p: Pic) => {
    const on = picked.includes(p.url)
    return (
      <button key={p.id} onClick={() => toggle(p.url)}
        className={`relative aspect-square rounded-lg overflow-hidden bg-slate-800 border transition-all ${on ? "border-white ring-2 ring-white/60" : "border-white/10 hover:border-white/30"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
        {on && (
          <span className="absolute top-1.5 right-1.5 min-w-5 h-5 px-1 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">
            {req.max > 1 ? picked.indexOf(p.url) + 1 : <Check size={12} />}
          </span>
        )}
      </button>
    )
  }
  const folderBtn = (id: number | "root" | "all", label: string, depth = 0, icon = <Folder size={12} className="shrink-0 text-slate-500" />) => (
    <button key={String(id)} onClick={() => setFolderId(id)} style={{ paddingLeft: 8 + depth * 12 }}
      className={`w-full flex items-center gap-1.5 pr-2 py-1.5 rounded-md text-left text-[12px] truncate ${folderId === id ? "bg-white/[0.10] text-white" : "text-slate-400 hover:bg-white/[0.05] hover:text-white"}`}>
      {icon}<span className="truncate">{label}</span>
    </button>
  )

  return (
    <div data-keep-refs-open className="fixed inset-0 z-[10050] flex items-start justify-center p-3 pt-[6dvh] bg-black/75 backdrop-blur-sm" onClick={() => close([])}>
      <div className="w-full max-w-5xl h-[84dvh] rounded-2xl silver-edge bg-[#070b14] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header: tabs, close */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <p className="text-sm font-bold text-white mr-2">{req.title ?? (req.max > 1 ? `Choose up to ${req.max} pictures` : "Choose a picture")}</p>
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-black/40">
            {([["gens", "My Generations", Images], ["assets", "Assets", Boxes]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setTab(k); setOpenAsset(null) }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold ${tab === k ? "bg-white/[0.14] text-white" : "text-slate-500 hover:text-slate-200"}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => close([])} className="ml-auto p-1 text-slate-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {tab === "gens" ? (
            <>
              {/* Folders */}
              <div className="hidden sm:flex w-56 shrink-0 flex-col border-r border-white/[0.06] p-2 gap-1">
                <div className="relative mb-1">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search folders…"
                    className="w-full pl-7 pr-2 py-1.5 rounded-md bg-black/40 border border-white/10 text-[12px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] space-y-0.5">
                  {!q.trim() && folderBtn("all", "All pictures", 0, <Images size={12} className="shrink-0 text-slate-500" />)}
                  {!q.trim() && folderBtn("root", "Unfiled")}
                  {shown.map(({ f, depth }) => folderBtn(f.id, f.name, depth))}
                </div>
              </div>
              {/* Pictures */}
              <div className="flex-1 min-w-0 overflow-y-auto p-3">
                {/* Phones: the folder list as a dropdown */}
                <select value={String(folderId)} onChange={e => setFolderId(e.target.value === "all" || e.target.value === "root" ? e.target.value : Number(e.target.value))}
                  className="sm:hidden w-full mb-3 rounded-lg bg-black/40 border border-white/10 px-2 py-2 text-[12px] text-white">
                  <option value="all">All pictures</option>
                  <option value="root">Unfiled</option>
                  {tree.map(({ f, depth }) => <option key={f.id} value={f.id}>{"  ".repeat(depth)}{f.name}</option>)}
                </select>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">{pics.map(tile)}</div>
                {!loading && pics.length === 0 && <p className="py-16 text-center text-sm text-slate-500">No pictures in this folder</p>}
                {loading && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-slate-400" /></div>}
                {more && !loading && (
                  <div className="flex justify-center py-4">
                    <button onClick={() => load(page + 1, false)} className="px-4 py-2 rounded-lg border border-white/15 bg-white/[0.05] text-xs text-slate-200 hover:bg-white/10">Load more</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-w-0 overflow-y-auto p-3">
              {assets === null ? (
                <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
              ) : openAsset ? (
                <>
                  <button onClick={() => setOpenAsset(null)} className="mb-3 flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ChevronLeft size={13} /> All assets</button>
                  <p className="mb-2 text-sm font-bold text-white">{openAsset.name} <span className="text-[10px] font-mono uppercase text-slate-500">{openAsset.kind}</span></p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {openAsset.refs.map(r => tile({ id: r.id, url: r.url, thumb: r.thumb || r.url }))}
                  </div>
                </>
              ) : assets.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-500">No assets yet - make them on My Generations</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {assets.map(a => (
                    <button key={a.id} onClick={() => setOpenAsset(a)} className="text-left rounded-xl overflow-hidden silver-edge hover:-translate-y-0.5 transition-transform">
                      <div className="aspect-square grid grid-cols-2 grid-rows-2 gap-px bg-black/40">
                        {[0, 1, 2, 3].map(k => (
                          <div key={k} className="relative overflow-hidden bg-white/[0.03]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {a.refs[k] && <img src={a.refs[k].thumb || a.refs[k].url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                          </div>
                        ))}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[12px] font-bold text-white truncate">{a.name}</p>
                        <p className="text-[10px] font-mono uppercase text-slate-500">{a.kind} · {a.refs.length} picture{a.refs.length === 1 ? "" : "s"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-500">{picked.length ? `${picked.length} chosen` : "Tap a picture to choose it"}</span>
          <button onClick={() => close([])} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">Cancel</button>
          <button onClick={() => close(picked)} disabled={!picked.length}
            className="px-4 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold hover:bg-slate-200 disabled:opacity-40">
            Use {picked.length > 1 ? `${picked.length} pictures` : "picture"}
          </button>
        </div>
      </div>
    </div>
  )
}
