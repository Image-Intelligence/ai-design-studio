"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { GridImage } from "./GridImage"
import { FEED_COL_CLASS, FEED_MASONRY_CLASS, arHeightWeight, distributeMasonry, isVideoUrl } from "./feedHelpers"

// Paginated feed for the my-generations page. Renders one page at a time (page size
// chosen in the Feed dropdown) with a numbered nav bar at the top and bottom — the
// classic pager, not infinite scroll. Layout (grid / masonry-flow / masonry-rows) is
// applied to the current page's items.

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
  // Bump to force a reload of the current page (after move / delete / hide).
  refreshKey?: number
}) {
  const fullRes = tileRes === "full"
  const [autoCols, setAutoCols] = useState(4)
  useEffect(() => {
    const compute = () => setAutoCols(window.innerWidth < 640 ? 2 : 4)
    compute()
    window.addEventListener("resize", compute)
    return () => window.removeEventListener("resize", compute)
  }, [])

  const [images, setImages] = useState<MyGenImage[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: pageSize, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  // Discards stale responses when filters change mid-flight.
  const reqRef = useRef(0)

  const load = useCallback(async (p: number) => {
    const rid = ++reqRef.current
    setLoading(true)
    try {
      const typeQs = typeFilter !== "all" ? `&type=${typeFilter}` : ""
      // Root (folderId null) shows unfiled only; a folder shows its own contents.
      const folderQs = `&folderId=${folderId == null ? "root" : folderId}`
      const res = await fetch(`/api/my-images?page=${p}&limit=${pageSize}${typeQs}${folderQs}${showHidden ? "&hidden=true" : ""}`)
      if (!res.ok) { if (rid === reqRef.current) { setImages([]); setPagination({ page: p, limit: pageSize, total: 0, totalPages: 0 }) } ; return }
      const data = await res.json()
      if (rid !== reqRef.current) return // filters changed mid-flight — discard
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
      setImages(items)
      if (data.pagination) setPagination(data.pagination)
    } finally {
      if (rid === reqRef.current) setLoading(false)
    }
  }, [pageSize, typeFilter, folderId, showHidden])

  // Reset to page 1 whenever the filter set (or refreshKey) changes.
  useEffect(() => { setPage(1) }, [typeFilter, folderId, showHidden, pageSize, refreshKey])

  // Fetch whenever the page or the filter set changes.
  useEffect(() => {
    if (signedIn) load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, page, load, refreshKey])

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
    weight: arHeightWeight(img.aspectRatio),
    node: (
      <GridImage
        key={img.id}
        src={img.imageUrl}
        alt={img.prompt}
        onClick={selectMode ? undefined : () => onImageClick(img)}
        imageId={img.id}
        thumbUrl={img.thumbnailUrl}
        aspectRatio={img.aspectRatio}
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
              <div className={`${cols ? FEED_MASONRY_CLASS[cols] ?? "columns-2 sm:columns-4" : "columns-2 sm:columns-4"} gap-2 [&>*]:mb-2 [&>*]:break-inside-avoid`}>
                {nodes.map(it => it.node)}
              </div>
            )
          }

          // Grid / normal
          return (
            <div className={`grid ${fullSize ? "gap-2 items-start" : "gap-0.5"} ${cols ? FEED_COL_CLASS[cols] ?? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
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
