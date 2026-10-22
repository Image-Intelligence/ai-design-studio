"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Boxes, Check, ChevronLeft, Folder, ImagePlus, Images, Loader2, Play, Search, X } from "lucide-react"

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
 *
 * CLIPS (2026-10-21, owner: "users should be able to choose from their
 * generated videos to use in each model as an input"): `media: "video"` lists
 * the account's videos instead - My Generations' clips and the clips saved in
 * Assets) - for the video models' clip slots (reference videos, a tool's source
 * clip, motion / lip-sync / edit sources) and Nova's attachments.
 *
 * REFS (2026-10-21, owner: "there's no option to select from my library (the
 * refs dropdown section library)"): a third tab lists the account's reference
 * library (/api/user/references) - its pictures, or its clips for a clip
 * slot. The Refs panel's own "From My Generations" leaves it out (`refs:
 * false`): adding the library to itself is nothing.
 */
type Folder = { id: number; name: string; parentId: number | null }
type Pic = { id: string; url: string; thumb: string; kind?: "video" | "audio" }
type Asset = { id: number; name: string; kind: string; refs: { id: string; url: string; kind?: "video"; thumb?: string | null }[] }
/**
 * What the picker lists: pictures (the default), clips ("video", 2026-10-21),
 * pictures and clips ("visual" - what the Refs library holds, 2026-10-21),
 * or everything incl. audio ("all" - Nova Studio's references, 2026-10-19).
 */
export type LibraryMedia = "image" | "video" | "visual" | "all"
type PickerOpts = { max?: number; title?: string; media?: LibraryMedia; refs?: boolean }
type Request = { max: number; title?: string; media?: LibraryMedia; refs?: boolean; resolve: (urls: string[]) => void; resolveItems?: (items: PickedItem[]) => void }
/** A picked item with its My Generations row id (null for an asset's own uploaded picture or clip). */
export type PickedItem = { url: string; thumb: string; generationId: number | null; kind: "image" | "video" | "audio" }

let setRequestGlobal: ((r: Request | null) => void) | null = null
/** Open the picker; resolves with up to `max` picture (or, with media "video", clip) links ([] if closed). */
export function openLibraryPicker(o: PickerOpts = {}): Promise<string[]> {
  return new Promise(resolve => {
    if (!setRequestGlobal) { resolve([]); return }
    setRequestGlobal({ max: Math.max(1, o.max ?? 1), title: o.title, media: o.media, refs: o.refs, resolve })
  })
}

/**
 * The same picker, answering with each picture's generation id as well
 * (2026-10-18, Nova Studio - its chat refers to the library by id). An asset's
 * pictures are generations when they were added from My Generations; one
 * uploaded straight into an asset has no row, so its id is null.
 */
export function openLibraryPickerItems(o: PickerOpts = {}): Promise<PickedItem[]> {
  return new Promise(resolve => {
    if (!setRequestGlobal) { resolve([]); return }
    setRequestGlobal({ max: Math.max(1, o.max ?? 1), title: o.title, media: o.media, refs: o.refs, resolve: () => {}, resolveItems: resolve })
  })
}

const PAGE = 48
const CLIP_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i
const MESH_RE = /\.(glb|gltf|obj|stl|fbx|ply|usdz|3mf)(\?|#|$)/i
type RefRow = { id: number; url: string; thumbUrl?: string }

/*
 * Kept between opens for the tab's session (2026-10-21, owner on iPad: "every
 * time I press it takes a few seconds"): the folder list, the folder last
 * looked at, and each folder's first page - shown at once on the next open
 * while a fresh copy loads behind it.
 */
let foldersCache: Folder[] | null = null
let lastFolder: number | "root" | "all" = "all"
const firstPages = new Map<string, { pics: Pic[]; cursor: { before: string; beforeId: number } | null; more: boolean }>()
const thumbOf = (img: any): string => img.thumbnailUrl || img.videoMetadata?.thumbnailUrl || `/api/images/${img.id}?thumb=1`

export function LibraryPickerHost() {
  const [req, setReq] = useState<Request | null>(null)
  useEffect(() => { setRequestGlobal = setReq; return () => { setRequestGlobal = null } }, [])
  if (!req || typeof document === "undefined") return null
  return createPortal(<Picker req={req} close={(urls, items) => { req.resolve(urls); req.resolveItems?.(items); setReq(null) }} />, document.body)
}

function Picker({ req, close: closeUrls }: { req: Request; close: (urls: string[], items: PickedItem[]) => void }) {
  // Every tile shown so far, by url - what a picked url's id and thumbnail are
  const seen = useMemo(() => new Map<string, Pic>(), [])
  const close = (urls: string[]) => closeUrls(urls, urls.map(url => {
    const p = seen.get(url)
    const n = p && /^\d+$/.test(p.id) ? Number(p.id) : null
    return { url, thumb: p?.thumb ?? url, generationId: n, kind: p?.kind ?? "image" }
  }))
  const media: LibraryMedia = req.media ?? "image"
  // What the picker holds, in words
  const noun = (n: number) => (media === "video" ? (n === 1 ? "clip" : "clips") : media === "all" || media === "visual" ? (n === 1 ? "item" : "items") : (n === 1 ? "picture" : "pictures"))
  // An asset's refs this picker can offer (an asset holds pictures and, since 2026-10-21, clips)
  const assetRefs = (a: Asset) => a.refs.filter(r => (media === "video" ? r.kind === "video" : media === "image" ? r.kind !== "video" : true))
  const [tab, setTab] = useState<"gens" | "assets" | "refs">("gens")
  // The reference library (the Refs panel's), loaded when its tab opens; 3D files never offered
  const showRefs = req.refs !== false
  const [refRows, setRefRows] = useState<RefRow[] | null>(null)
  useEffect(() => {
    if (tab !== "refs" || refRows) return
    fetch("/api/user/references").then(r => (r.ok ? r.json() : null)).then(d => setRefRows(d?.references ?? [])).catch(() => setRefRows([]))
  }, [tab, refRows])
  const refPics: Pic[] = (refRows ?? [])
    .filter(r => !MESH_RE.test(r.url) && (media === "video" ? CLIP_RE.test(r.url) : media === "image" ? !CLIP_RE.test(r.url) : true))
    .map(r => (CLIP_RE.test(r.url) ? { id: `ref-${r.id}`, url: r.url, thumb: r.url, kind: "video" as const } : { id: `ref-${r.id}`, url: r.url, thumb: r.thumbUrl || r.url }))
    .reverse()
  const [folders, setFolders] = useState<Folder[]>(() => foldersCache ?? [])
  const [folderId, setFolderIdState] = useState<number | "root" | "all">(() => lastFolder)
  const setFolderId = (id: number | "root" | "all") => { lastFolder = id; setFolderIdState(id) }
  // The scrolling grid, and the marker under it that loads the next page as it comes into view
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // The clip under the pointer plays (one at a time - see tile())
  const [hoverClip, setHoverClip] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [pics, setPics] = useState<Pic[]>([])
  // Where the next page starts (keyset: older than this row) - see load()
  const cursorRef = useRef<{ before: string; beforeId: number } | null>(null)
  const [more, setMore] = useState(false)
  // Only the latest request's answer is used (a folder switched mid-load, a second "Load more")
  const loadSeq = useRef(0)
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [openAsset, setOpenAsset] = useState<Asset | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  /*
   * A clip watched before it is chosen (2026-10-21, owner: "I need to be able
   * to view the videos from that popup so I can know which video it is" - a
   * poster frame does not show the footage). Tiles play while hovered; the
   * play button opens it full size with sound.
   */
  const [preview, setPreview] = useState<Pic | null>(null)

  useEffect(() => {
    fetch("/api/user/generation-folders").then(r => (r.ok ? r.json() : null)).then(d => { if (d?.folders) { foldersCache = d.folders; setFolders(d.folders) } }).catch(() => {})
  }, [])
  useEffect(() => {
    if (tab !== "assets" || assets) return
    fetch("/api/user/assets").then(r => (r.ok ? r.json() : null)).then(d => setAssets(d?.assets ?? [])).catch(() => setAssets([]))
  }, [tab, assets])

  /*
   * A folder's pictures, a page at a time - by CURSOR (2026-10-21, owner: some
   * thumbnails showed twice). Pages by offset slid whenever a new generation
   * landed while the picker was open (the owner generates in big batches), so
   * "Load more" fetched rows already shown. The cursor is the last row's
   * (createdAt, id); rows are de-duplicated by id anyway, and a stale answer
   * (folder switched, a double tap on Load more) is dropped.
   */
  const load = useCallback(async (reset: boolean) => {
    const seq = ++loadSeq.current
    const pageKey = `${media}:${folderId}`
    // A folder seen before shows its first page at once; the fresh one replaces it
    const cached = reset ? firstPages.get(pageKey) : undefined
    if (cached) { setPics(cached.pics); cursorRef.current = cached.cursor; setMore(cached.more) }
    setLoading(true)
    try {
      const fq = folderId === "all" ? "" : `&folderId=${folderId}`
      const cur = reset ? null : cursorRef.current
      const cq = cur ? `&before=${encodeURIComponent(cur.before)}&beforeId=${cur.beforeId}` : ""
      const r = await fetch(`/api/my-images?${media === "all" || media === "visual" ? "" : `type=${media}&`}cursor=1&limit=${PAGE}${fq}${cq}`)
      const d = r.ok ? await r.json() : null
      if (seq !== loadSeq.current) return
      const kindOf = (img: any): Pic["kind"] => {
        const u = String(img.imageUrl ?? "").split("?")[0].toLowerCase()
        if (img.videoMetadata?.isAudio || String(img.model ?? "").startsWith("audio:") || /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/.test(u)) return "audio"
        if (img.videoMetadata?.isVideo || /\.(mp4|webm|mov)$/.test(u)) return "video"
        return undefined
      }
      const rows: Pic[] = (d?.images ?? []).map((img: any) => ({ id: String(img.id), url: img.imageUrl, thumb: thumbOf(img), kind: kindOf(img) }))
        .filter((p: Pic) => media !== "visual" || p.kind !== "audio")
      setPics(prev => {
        const base = reset ? [] : prev
        const have = new Set(base.map(x => x.id))
        return [...base, ...rows.filter(x => !have.has(x.id) && (have.add(x.id), true))]
      })
      cursorRef.current = d?.nextCursor ?? null
      setMore(!!d?.hasMore && !!d?.nextCursor)
      if (reset && d) firstPages.set(pageKey, { pics: rows, cursor: d.nextCursor ?? null, more: !!d.hasMore && !!d.nextCursor })
    } finally { if (seq === loadSeq.current) setLoading(false) }
  }, [folderId, media])
  // A new folder / tab starts from the newest
  useEffect(() => { if (tab === "gens") void load(true) }, [tab, load])
  /*
   * The next page loads as the bottom comes into view (2026-10-21, owner on
   * iPad: a big folder "is barely letting me scroll" - it stopped after the
   * first 48 until "Load more" was found and tapped). The button stays as a
   * fallback.
   */
  useEffect(() => {
    const el = sentinelRef.current, root = scrollRef.current
    if (!el || !root || tab !== "gens" || !more || loading) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) void load(false) }, { root, rootMargin: "0px 0px 600px 0px" })
    io.observe(el)
    return () => io.disconnect()
  }, [tab, more, loading, load, pics.length])

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
    seen.set(p.url, p)
    const on = picked.includes(p.url)
    return (
      <button key={p.id} onClick={() => toggle(p.url)}
        className={`relative aspect-square rounded-lg overflow-hidden bg-slate-800 border transition-all ${on ? "border-white ring-2 ring-white/60" : "border-white/10 hover:border-white/30"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.kind === "audio"
          ? <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-500/20 to-slate-900 text-[10px] font-bold uppercase tracking-wider text-amber-200">Audio</span>
          // A clip: its poster, the footage playing while hovered (no poster: its first frame)
          // A clip WITH a poster is that picture until the pointer is on it (then the footage
          // plays); a page of <video> players was what made the picker slow and stiff on iPad
          : p.kind === "video"
            ? (p.thumb !== p.url && hoverClip !== p.url
                ? <img src={p.thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
                    // A mouse only: on iPad a tap is "hovered" first, and swapping the tile then ate the tap
                    onPointerEnter={e => { if (e.pointerType === "mouse") setHoverClip(p.url) }} />
                : <video src={p.thumb === p.url ? `${p.url}#t=0.1` : p.url} poster={p.thumb === p.url ? undefined : p.thumb} muted loop playsInline
                    preload={p.thumb === p.url ? "metadata" : "auto"} autoPlay={hoverClip === p.url}
                    onPointerEnter={e => { if (e.pointerType !== "mouse") return; setHoverClip(p.url); void e.currentTarget.play().catch(() => {}) }}
                    onPointerLeave={e => { if (e.pointerType !== "mouse") return; e.currentTarget.pause(); setHoverClip(h => (h === p.url ? null : h)) }}
                    className="w-full h-full object-cover pointer-events-auto" />)
            : <img src={p.thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
                onError={e => { if (p.thumb !== p.url && e.currentTarget.src !== p.url) e.currentTarget.src = p.url }} />}
        {p.kind === "video" && <span className="absolute bottom-1.5 left-1.5 px-1 py-px rounded bg-black/70 text-[9px] font-bold uppercase tracking-wider text-white">Video</span>}
        {p.kind === "video" && (
          <span role="button" tabIndex={0} title="Watch this clip" aria-label="Watch this clip"
            onClick={e => { e.stopPropagation(); setPreview(p) }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); setPreview(p) } }}
            className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 border border-white/25 flex items-center justify-center text-white hover:bg-white hover:text-black transition-colors">
            <Play size={12} />
          </span>
        )}
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
    <div data-keep-refs-open className="fixed inset-0 z-[10050] flex items-start justify-center p-3 pt-[6dvh] bg-black/85 overscroll-none" onClick={() => close([])}>
      <div className="relative w-full max-w-5xl h-[84dvh] rounded-2xl silver-edge bg-[#070b14] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header: tabs, close */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <p className="text-sm font-bold text-white mr-2">{req.title ?? (req.max > 1 ? `Choose up to ${req.max} ${noun(2)}` : `Choose a ${noun(1)}`)}</p>
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-black/40">
            {([["gens", "My Generations", Images], ["assets", "Assets", Boxes], ...(showRefs ? [["refs", "Refs library", ImagePlus]] as const : [])] as const).map(([k, label, Icon]) => (
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
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin] space-y-0.5">
                  {!q.trim() && folderBtn("all", `All ${noun(2)}`, 0, <Images size={12} className="shrink-0 text-slate-500" />)}
                  {!q.trim() && folderBtn("root", "Unfiled")}
                  {shown.map(({ f, depth }) => folderBtn(f.id, f.name, depth))}
                </div>
              </div>
              {/* Pictures */}
              <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto overscroll-contain touch-pan-y p-3">
                {/* Phones: the folder list as a dropdown */}
                <select value={String(folderId)} onChange={e => setFolderId(e.target.value === "all" || e.target.value === "root" ? e.target.value : Number(e.target.value))}
                  className="sm:hidden w-full mb-3 rounded-lg bg-black/40 border border-white/10 px-2 py-2 text-[12px] text-white">
                  <option value="all">All {noun(2)}</option>
                  <option value="root">Unfiled</option>
                  {tree.map(({ f, depth }) => <option key={f.id} value={f.id}>{"  ".repeat(depth)}{f.name}</option>)}
                </select>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">{pics.map(tile)}</div>
                {!loading && pics.length === 0 && <p className="py-16 text-center text-sm text-slate-500">No {noun(2)} in this folder</p>}
                {loading && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-slate-400" /></div>}
                <div ref={sentinelRef} className="h-px" />
                {more && !loading && (
                  <div className="flex justify-center py-4">
                    <button onClick={() => void load(false)} className="px-4 py-2 rounded-lg border border-white/15 bg-white/[0.05] text-xs text-slate-200 hover:bg-white/10">Load more</button>
                  </div>
                )}
              </div>
            </>
          ) : tab === "refs" ? (
            <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain touch-pan-y p-3">
              {refRows === null ? (
                <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
              ) : refPics.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-500">
                  {media === "video" ? "No clips in your Refs library yet - upload videos in the Refs panel" : `No ${noun(2)} in your Refs library yet - upload them in the Refs panel`}
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">{refPics.map(tile)}</div>
              )}
            </div>
          ) : (
            <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain touch-pan-y p-3">
              {assets === null ? (
                <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
              ) : openAsset ? (
                <>
                  <button onClick={() => setOpenAsset(null)} className="mb-3 flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ChevronLeft size={13} /> All assets</button>
                  <p className="mb-2 text-sm font-bold text-white">{openAsset.name} <span className="text-[10px] font-mono uppercase text-slate-500">{openAsset.kind}</span></p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {assetRefs(openAsset).map(r => tile({ id: r.id, url: r.url, thumb: r.thumb || r.url, kind: r.kind }))}
                  </div>
                </>
              ) : !assets.some(a => assetRefs(a).length) ? (
                <p className="py-16 text-center text-sm text-slate-500">{media === "video" ? "No clips in your assets yet - add videos to an asset on My Generations" : "No assets yet - make them on My Generations"}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {assets.filter(a => assetRefs(a).length).map(a => { const refs = assetRefs(a); return (
                    <button key={a.id} onClick={() => setOpenAsset(a)} className="text-left rounded-xl overflow-hidden silver-edge hover:-translate-y-0.5 transition-transform">
                      <div className="aspect-square grid grid-cols-2 grid-rows-2 gap-px bg-black/40">
                        {[0, 1, 2, 3].map(k => (
                          <div key={k} className="relative overflow-hidden bg-white/[0.03]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {refs[k] && (refs[k].kind === "video" && !refs[k].thumb
                              ? <video src={`${refs[k].url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                              : <img src={refs[k].thumb || refs[k].url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />)}
                          </div>
                        ))}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[12px] font-bold text-white truncate">{a.name}</p>
                        <p className="text-[10px] font-mono uppercase text-slate-500">{a.kind} · {refs.length} {noun(refs.length)}</p>
                      </div>
                    </button>
                  ) })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* A clip watched full size, with sound, before choosing it */}
        {preview && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 p-4" onClick={() => setPreview(null)}>
            <div className="w-full max-w-3xl space-y-3" onClick={e => e.stopPropagation()}>
              <video src={preview.url} poster={preview.thumb !== preview.url ? preview.thumb : undefined} controls autoPlay playsInline loop
                className="w-full max-h-[62dvh] rounded-xl bg-black object-contain" />
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white">Back</button>
                <button onClick={() => { if (!picked.includes(preview.url)) toggle(preview.url); setPreview(null) }}
                  className="ml-auto px-4 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold hover:bg-slate-200">
                  {picked.includes(preview.url) ? "Chosen" : `Choose this ${noun(1) === "item" ? "clip" : noun(1)}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-500">{picked.length ? `${picked.length} chosen` : `Tap a ${noun(1)} to choose it`}</span>
          <button onClick={() => close([])} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">Cancel</button>
          <button onClick={() => close(picked)} disabled={!picked.length}
            className="px-4 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold hover:bg-slate-200 disabled:opacity-40">
            Use {picked.length > 1 ? `${picked.length} ${noun(2)}` : noun(1)}
          </button>
        </div>
      </div>
    </div>
  )
}
