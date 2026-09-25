"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { GridImage } from "./GridImage"
import {
  FEED_AUTO_COL_CLASS, FEED_AUTO_MASONRY_CLASS, FEED_COL_CLASS, FEED_MASONRY_CLASS,
  arHeightWeight, autoColsFor, distributeMasonry, isVideoUrl, tileAspect,
} from "./feedHelpers"

// Paginated feed for the my-generations page. Renders one page at a time (page size
// chosen in the Feed dropdown) with a numbered nav bar at the top and bottom — the
// classic pager, not infinite scroll. Layout (grid / masonry-flow / masonry-rows) is
// applied to the current page's items.
//
// SPEED. Turning pages should feel instant:
//   - pages are cached per filter, so going back is immediate
//   - once a page lands, the next one (and the previous) is fetched in the
//     background, with its thumbnails warmed, so "next" is usually instant too
//   - the total only needs counting once per filter; later pages send count=0
//     and skip that query (see /api/my-images)
//   - tiles reserve their height from the stored pixel size, so a page lays out
//     once instead of jumping as each image arrives

export interface MyGenImage {
  id: number
  imageUrl: string
  thumbnailUrl?: string | null
  prompt: string
  model?: string
  createdAt?: string
  referenceImageUrls?: string[]
  aspectRatio?: string
  quality?: string | null
  videoMetadata?: any
  loraUrl?: string | null
  loraName?: string | null
  folderId?: number | null
}

interface Pagination { page: number; limit: number; total: number; totalPages: number }

// Numbered page nav — mirrors the /admin/dataset PageNav.
function PageNav({ pagination, page, loading, setPage, className = "" }: {
  pagination: Pagination
  page: number
  loading: boolean
  setPage: (p: number) => void
  className?: string
}) {
  const total = pagination.totalPages
  const mid = Math.min(Math.max(page, 4), total - 3)
  const pages = total <= 7
    ? Array.from({ length: total }, (_, i) => i + 1)
    : [...new Set([1, 2, 3, mid - 1, mid, mid + 1, total - 2, total - 1, total].filter(v => v > 0 && v <= total))].sort((a, b) => a - b)

  return (
    <div className={`flex items-center justify-center gap-2 flex-wrap ${className}`}>
      <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1 || loading}
        className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.07] text-slate-400 hover:text-white disabled:opacity-30 transition-all">
        <ChevronLeft size={15} />
      </button>
      <div className="flex items-center gap-1">
        {pages.map(p => (
          <button key={p} onClick={() => setPage(p)}
            className={`w-8 h-8 rounded-lg text-xs font-medium transition-all
              ${p === page ? "bg-cyan-500/20 border border-cyan-500/30 text-cyan-300" : "bg-white/[0.04] border border-white/[0.07] text-slate-500 hover:text-white"}`}>
            {p}
          </button>
        ))}
      </div>
      <button onClick={() => setPage(Math.min(total, page + 1))} disabled={page >= total || loading}
        className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.07] text-slate-400 hover:text-white disabled:opacity-30 transition-all">
        <ChevronRight size={15} />
      </button>
      <form
        onSubmit={e => {
          e.preventDefault()
          const el = e.currentTarget.elements.namedItem("gotopage") as HTMLInputElement
          const val = parseInt(el.value)
          if (!isNaN(val)) setPage(Math.max(1, Math.min(total, val)))
          el.value = ""
        }}
        className="flex items-center gap-1.5 ml-1"
      >
        <span className="text-[10px] text-slate-600">Go to</span>
        <input
          name="gotopage"
          type="number"
          min={1}
          max={total}
          placeholder={String(page)}
          className="w-14 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] text-xs text-white text-center outline-none focus:border-cyan-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </form>
    </div>
  )
}

export function MyGenFeed({
  signedIn,
  cols = null,
  fullSize = false,
  fullSizeLayout = "grid",
  masonryMode = "rows",
  tileRes = "thumb",
  showHidden = false,
  typeFilter = "all",
  folderId = null,
  pageSize = 24,
  selectMode,
  selectedIds,
  onSelectToggle,
  onImageClick,
  onNavListChange,
  onTotalChange,
  refreshKey = 0,
}: {
  signedIn: boolean
  cols?: number | null
  fullSize?: boolean
  fullSizeLayout?: "grid" | "masonry"
  masonryMode?: "flow" | "rows"
  tileRes?: "thumb" | "full"
  showHidden?: boolean
  typeFilter?: "all" | "image" | "video"
  // null = current folder is root (show unfiled only); number = that folder's contents
  folderId?: number | null
  pageSize?: number
  selectMode?: boolean
  selectedIds?: Set<number>
  onSelectToggle?: (id: number) => void
  onImageClick: (img: MyGenImage) => void
  onNavListChange?: (list: MyGenImage[]) => void
  /** The number of items under the current filter, once counted. */
  onTotalChange?: (total: number | null) => void
  // Bump to force a reload of the current page (after move / delete / hide).
  refreshKey?: number
}) {
  const fullRes = tileRes === "full"
  const [autoCols, setAutoCols] = useState(4)
  useEffect(() => {
    const compute = () => setAutoCols(autoColsFor(window.innerWidth))
    compute()
    window.addEventListener("resize", compute)
    return () => window.removeEventListener("resize", compute)
  }, [])

  const [images, setImages] = useState<MyGenImage[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: pageSize, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  // Starts true, or the empty-state message flashes before the first page arrives.
  const [loading, setLoading] = useState(true)
  // Discards stale responses when filters change mid-flight.
  const reqRef = useRef(0)

  // Everything that selects which rows a page holds.
  const filterKey = `${typeFilter}|${folderId ?? "root"}|${showHidden ? 1 : 0}|${pageSize}`
  const cache = useRef(new Map<string, { images: MyGenImage[]; pagination: Pagination | null }>())
  const totals = useRef(new Map<string, Pagination>())
  const inflight = useRef(new Map<string, Promise<void>>())

  /** Fetch one page into the cache (shared by the visible load and the prefetch). */
  const fetchPage = useCallback((p: number): Promise<void> => {
    const key = `${filterKey}#${p}`
    if (cache.current.has(key)) return Promise.resolve()
    const running = inflight.current.get(key)
    if (running) return running
    const typeQs = typeFilter !== "all" ? `&type=${typeFilter}` : ""
    // Root (folderId null) shows unfiled only; a folder shows its own contents.
    const folderQs = `&folderId=${folderId == null ? "root" : folderId}`
    const countQs = totals.current.has(filterKey) ? "&count=0" : ""
    const job = fetch(`/api/my-images?page=${p}&limit=${pageSize}${typeQs}${folderQs}${showHidden ? "&hidden=true" : ""}${countQs}`)
      .then(async res => {
        if (res.status === 401) { window.location.href = "/login"; return }
        if (!res.ok) return
        const data = await res.json()
        if (!data.success) return
        const items: MyGenImage[] = (data.images || []).map((img: any) => ({
          id: img.id,
          imageUrl: img.imageUrl,
          thumbnailUrl: img.thumbnailUrl ?? undefined,
          prompt: img.prompt,
          model: img.model,
          createdAt: img.createdAt,
          referenceImageUrls: img.referenceImageUrls ?? [],
          aspectRatio: img.aspectRatio ?? undefined,
          quality: img.quality ?? undefined,
          videoMetadata: img.videoMetadata ?? undefined,
          loraUrl: img.loraUrl ?? undefined,
          loraName: img.loraName ?? undefined,
          folderId: img.folderId ?? null,
        }))
        if (data.pagination) totals.current.set(filterKey, data.pagination)
        cache.current.set(key, { images: items, pagination: data.pagination ?? null })
      })
      .catch(() => {})
      .finally(() => { inflight.current.delete(key) })
    inflight.current.set(key, job)
    return job
  }, [filterKey, typeFilter, folderId, showHidden, pageSize])

  /** Warm the next page's thumbnails, so its tiles paint at once. */
  const warm = (list: MyGenImage[]) => {
    for (const img of list) {
      const src = img.thumbnailUrl || img.videoMetadata?.thumbnailUrl
      if (src) { const i = new Image(); i.decoding = "async"; i.src = src }
    }
  }

  const load = useCallback(async (p: number) => {
    const rid = ++reqRef.current
    const key = `${filterKey}#${p}`
    const show = () => {
      const hit = cache.current.get(key)
      if (!hit || rid !== reqRef.current) return false
      setImages(hit.images)
      const total = hit.pagination ?? totals.current.get(filterKey)
      if (total) setPagination({ ...total, page: p })
      return true
    }
    if (!show()) {
      setLoading(true)
      await fetchPage(p)
      if (rid !== reqRef.current) return // filters changed mid-flight — discard
      if (!show()) { setImages([]); setPagination({ page: p, limit: pageSize, total: 0, totalPages: 0 }) }
      setLoading(false)
    }
    // Then quietly fetch the neighbours.
    const totalPages = totals.current.get(filterKey)?.totalPages ?? 0
    for (const q of [p + 1, p - 1]) {
      if (q < 1 || q > totalPages) continue
      fetchPage(q).then(() => { if (q === p + 1) warm(cache.current.get(`${filterKey}#${q}`)?.images ?? []) })
    }
  }, [filterKey, fetchPage, pageSize])

  // A move / delete / hide (refreshKey) or a new filter invalidates what is cached.
  useEffect(() => {
    cache.current.clear()
    totals.current.clear()
  }, [refreshKey])

  // Reset to page 1 whenever the filter set (or refreshKey) changes.
  useEffect(() => { setPage(1) }, [typeFilter, folderId, showHidden, pageSize, refreshKey])

  // Fetch whenever the page or the filter set changes.
  useEffect(() => {
    if (signedIn) load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, page, load, refreshKey])

  useEffect(() => {
    onTotalChange?.(loading && pagination.total === 0 ? null : pagination.total)
  }, [pagination.total, loading, onTotalChange])

  // Emit the current page's images for the preview modal's prev/next.
  useEffect(() => {
    if (onNavListChange) onNavListChange(images)
  }, [images, onNavListChange])

  const goToPage = useCallback((p: number) => {
    setPage(p)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  if (!signedIn) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-600 text-sm">
        Sign in to view your generations.
      </div>
    )
  }

  if (!loading && images.length === 0) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-600 text-sm">
        {showHidden ? "No hidden generations" : "No generations here yet"}
      </div>
    )
  }

  const nodes = images.map((img) => ({
    weight: (() => { const a = tileAspect(img); return a ? 1 / a : arHeightWeight(img.aspectRatio) })(),
    node: (
      <GridImage
        key={img.id}
        src={img.imageUrl}
        alt={img.prompt}
        onClick={selectMode ? undefined : () => onImageClick(img)}
        imageId={img.id}
        thumbUrl={img.thumbnailUrl}
        aspectRatio={img.aspectRatio}
        aspect={tileAspect(img)}
        posterUrl={img.videoMetadata?.thumbnailUrl ?? null}
        fullRes={fullRes}
        selectMode={selectMode}
        selected={selectedIds?.has(img.id)}
        onSelect={onSelectToggle}
        fullWidth={fullSize}
        isVideo={!!img.videoMetadata || isVideoUrl(img.imageUrl)}
      />
    ),
  }))

  const showPager = pagination.totalPages > 1

  return (
    <div>
      {showPager && (
        <PageNav pagination={pagination} page={page} loading={loading} setPage={goToPage} className="mb-5" />
      )}

      <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {(() => {
          // Masonry "Rows": JS shortest-column packing.
          if (fullSize && fullSizeLayout === "masonry" && masonryMode === "rows") {
            const n = cols ?? autoCols
            const columns = distributeMasonry(nodes, n)
            return (
              <div className="flex gap-2 items-start">
                {columns.map((colItems, i) => (
                  <div key={i} className="flex-1 min-w-0 flex flex-col gap-2">
                    {colItems.map(it => it.node)}
                  </div>
                ))}
              </div>
            )
          }

          // Masonry "Flow": CSS multi-column.
          if (fullSize && fullSizeLayout === "masonry") {
            return (
              <div className={`${cols ? FEED_MASONRY_CLASS[cols] ?? FEED_AUTO_MASONRY_CLASS : FEED_AUTO_MASONRY_CLASS} gap-2 [&>*]:mb-2 [&>*]:break-inside-avoid`}>
                {nodes.map(it => it.node)}
              </div>
            )
          }

          // Grid / normal
          return (
            <div className={`grid ${fullSize ? "gap-2 items-start" : "gap-0.5"} ${cols ? FEED_COL_CLASS[cols] ?? FEED_AUTO_COL_CLASS : FEED_AUTO_COL_CLASS}`}>
              {nodes.map(it => it.node)}
            </div>
          )
        })()}
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-slate-500" size={20} />
        </div>
      )}

      {showPager && (
        <PageNav pagination={pagination} page={page} loading={loading} setPage={goToPage} className="mt-8" />
      )}
    </div>
  )
}
