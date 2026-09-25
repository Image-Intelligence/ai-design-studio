"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { FolderOpen, Star } from "lucide-react"
import { SilverRimOverlay } from "./SilverRimOverlay"

/*
 * The "My Generations" home card: a live slideshow of the signed-in user's own
 * work. Clicking opens /my-generations; logged out or empty, it falls back to
 * a placeholder.
 *
 * WHAT IT SHOWS. /api/user/highlights samples the whole history, half from
 * generations rated 4-5 stars and half at random, interleaved. When the
 * slideshow reaches its last pass it asks for a fresh sample, so it keeps
 * surfacing different work instead of looping the newest dozen.
 *
 * HOW IT FITS PORTRAITS. The card is landscape, and a single cover-cropped
 * portrait showed only a thin band across its middle. So each pass is a row of
 * tiles packed to the card's own shape: three 9:16 portraits side by side make
 * a 27:16 row, which is almost exactly a 16:9 card. Tiles are packed from each
 * image's real aspect (measured when it preloads), so a mix of portraits and
 * landscapes still lands close to the card's width and nothing is cropped by
 * more than a sliver. A pass that falls short is centred over a blurred copy
 * of itself instead of leaving bars.
 */

interface Highlight {
  id: number
  imageUrl: string
  thumbnailUrl: string | null
  videoThumbnailUrl: string | null
  isVideo: boolean
  score: number | null
}

type Tile = { key: string; id: number; src: string; aspect: number; score: number | null }

const PASS_MS = 5000
/** No pass holds more tiles than this, or each gets too narrow to read. */
const MAX_PER_PASS = 4

const srcOf = (h: Highlight) =>
  h.thumbnailUrl || h.videoThumbnailUrl || (h.isVideo ? null : `/api/images/${h.id}?thumb=1`)

/** Preload one thumbnail and read its real shape; null if it will not draw. */
function loadTile(h: Highlight, batch: number): Promise<Tile | null> {
  const src = srcOf(h)
  if (!src) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    const t = setTimeout(() => resolve(null), 10000)
    img.onload = () => {
      clearTimeout(t)
      const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
      // Clamp freak shapes (a 1px strip) so they cannot wreck a pass.
      resolve(aspect > 0 ? { key: `${batch}:${h.id}`, id: h.id, src, aspect: Math.min(Math.max(aspect, 0.4), 3), score: h.score } : null)
    }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

/**
 * Group tiles into passes whose combined aspect is close to the card's.
 *
 * Greedy with a short look-ahead: each pass starts from the next tile in the
 * sample's order (which keeps favourites and random picks mixed), then adds
 * whichever of the next few tiles brings the row closest to the card's shape
 * without overshooting it by much. It stops once the row is nearly full.
 */
function pack(tiles: Tile[], target: number): Tile[][] {
  const pool = [...tiles]
  const passes: Tile[][] = []
  while (pool.length > 0) {
    const group = [pool.shift()!]
    let sum = group[0].aspect
    while (group.length < MAX_PER_PASS && sum < target * 0.85) {
      let best = -1
      let bestGap = Infinity
      for (let i = 0; i < Math.min(pool.length, 8); i++) {
        const next = sum + pool[i].aspect
        if (next > target * 1.25) continue
        const gap = Math.abs(target - next)
        if (gap < bestGap) { bestGap = gap; best = i }
      }
      if (best < 0) break
      const [t] = pool.splice(best, 1)
      group.push(t)
      sum += t.aspect
    }
    passes.push(group)
  }
  return passes
}

export function GenerationsCarousel({ signedIn, className = "", aspect = "aspect-[4/3]" }: {
  signedIn: boolean
  className?: string
  aspect?: string
}) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  // The card's own width:height, measured, since its aspect class changes by breakpoint.
  const [target, setTarget] = useState(16 / 9)
  const targetRef = useRef(target)
  targetRef.current = target
  /*
   * At most two samples: the one playing, and the next. Keeping the old one
   * while the new one starts lets the last pass crossfade into the first new
   * pass instead of cutting.
   */
  const [batches, setBatches] = useState<Tile[][]>([])
  const batchesRef = useRef(batches)
  batchesRef.current = batches
  const [idx, setIdx] = useState(0)
  const fetching = useRef(false)
  const batchNo = useRef(0)
  const paused = useRef(false)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 0 && height > 0) setTarget(Math.round((width / height) * 20) / 20)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fetchBatch = async (): Promise<Tile[]> => {
    const r = await fetch("/api/user/highlights?n=20", { cache: "no-store" })
    const d = r.ok ? await r.json() : null
    const items: Highlight[] = d?.items ?? []
    const n = ++batchNo.current
    const tiles = await Promise.all(items.map(h => loadTile(h, n)))
    return tiles.filter((t): t is Tile => !!t)
  }

  // First sample.
  useEffect(() => {
    if (!signedIn) { setBatches([]); return }
    let alive = true
    fetching.current = true
    fetchBatch()
      .then(tiles => { if (alive) { setBatches(tiles.length ? [tiles] : []); setIdx(0) } })
      .catch(() => {})
      .finally(() => { fetching.current = false })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  const passes = useMemo(
    () => batches.flatMap(b => pack(b, target).map(tiles => ({ key: tiles[0].key, tiles }))),
    [batches, target],
  )

  /*
   * Reaching the last pass fetches the next sample. The pass on screen is kept
   * as the new first pass (its batch stays as batches[0]), so the index is
   * moved to it and the next tick crossfades into fresh work.
   */
  useEffect(() => {
    if (!signedIn || passes.length === 0 || fetching.current) return
    if (idx !== passes.length - 1) return
    fetching.current = true
    fetchBatch()
      .then(tiles => {
        if (tiles.length === 0) return
        const kept = batchesRef.current[batchesRef.current.length - 1]
        if (!kept) return
        setBatches([kept, tiles])
        setIdx(pack(kept, targetRef.current).length - 1)
      })
      .catch(() => {})
      .finally(() => { fetching.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, passes.length, signedIn])

  // A resize repacks the passes; keep the index inside the new count.
  useEffect(() => {
    if (idx >= passes.length && passes.length > 0) setIdx(0)
  }, [idx, passes.length])

  useEffect(() => {
    if (passes.length < 2) return
    const t = setInterval(() => {
      if (paused.current || document.hidden) return
      setIdx(i => (i + 1) % passes.length)
    }, PASS_MS)
    return () => clearInterval(t)
  }, [passes.length])

  const hasFavourites = batches.some(b => b.some(t => (t.score ?? 0) >= 4))

  return (
    <div
      ref={rootRef}
      onClick={() => router.push("/my-generations")}
      onMouseEnter={() => { paused.current = true }}
      onMouseLeave={() => { paused.current = false }}
      className={`group relative ${aspect} rounded-2xl overflow-hidden border border-white/10 bg-slate-950 cursor-pointer transition-all hover:border-white/25 hover:shadow-xl hover:shadow-black/40 ${className}`}
    >
      {passes.length > 0 ? (
        passes.map((p, i) => {
          const sum = p.tiles.reduce((a, t) => a + t.aspect, 0)
          const short = sum < target * 0.98
          const on = i === idx
          return (
            <div
              key={p.key}
              aria-hidden={!on}
              // Fade, plus a slow settle from a hair larger while showing.
              className={`absolute inset-0 transition-[opacity,transform] [transition-duration:900ms,6000ms] ease-out ${on ? "opacity-100 scale-100" : "opacity-0 scale-[1.03]"}`}
            >
              {/* Behind a pass that does not fill the width: a blurred copy of it. */}
              {short && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.tiles[0].src} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-40" />
              )}
              <div className="absolute inset-0 flex justify-center gap-0.5">
                {p.tiles.map(t => (
                  <div
                    key={t.key}
                    className="relative h-full min-w-0 overflow-hidden"
                    // Width in proportion to the tile's shape. When the row is
                    // narrower than the card the tiles stop at their true width
                    // and centre; when wider, they share it and crop a sliver.
                    style={{ flex: `${t.aspect} 1 0%`, maxWidth: short ? `${(t.aspect / target) * 100}%` : undefined }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    {(t.score ?? 0) >= 4 && (
                      <span className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-[9px] font-semibold text-amber-300">
                        <Star size={9} className="fill-amber-300" />{t.score}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] via-transparent to-black/50 flex items-center justify-center">
          <FolderOpen size={26} className="text-white/25" />
        </div>
      )}

      {/* Legibility scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-transparent pointer-events-none" />

      {/* Animated silver rim */}
      <SilverRimOverlay />

      {/* Label */}
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2 pointer-events-none">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight text-white drop-shadow truncate">My Generations</p>
          <p className="text-[11px] text-white/60 truncate">
            {passes.length === 0 ? "All your images & videos"
              : hasFavourites ? "Your top-rated work, and some from the archive"
              : "Rediscovered from your whole history"}
          </p>
        </div>
      </div>
    </div>
  )
}
