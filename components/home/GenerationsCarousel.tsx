"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, EyeOff, FolderOpen, Play, Star } from "lucide-react"
import { SilverRimOverlay } from "./SilverRimOverlay"
import { HighlightsSlideshow } from "./HighlightsSlideshow"
import { loadTiles, setHidden, type Tile } from "./highlights"

/*
 * The "My Generations" home card: a living masonry wall of the signed-in
 * user's own work.
 *
 * WHAT IT SHOWS. /api/user/highlights samples the whole history, half from
 * generations rated 4-5 stars and half at random. The wall keeps a queue of
 * those and asks for more as it runs low, so it keeps surfacing different
 * work rather than looping the newest dozen.
 *
 * HOW IT MOVES. Each column drifts upward at its own slow speed. When a tile
 * has scrolled fully out of the top it is dropped and a new one is appended at
 * the bottom, so the wall is endless and always changing, and every image
 * keeps its own shape - portraits are shown whole, not cropped to a band.
 *
 * The drift is driven by requestAnimationFrame writing transforms straight to
 * the column elements, never through React state, so it costs one style
 * write per column per frame. React only re-renders when a tile enters or
 * leaves. The tricky part is that moment: dropping the top tile makes the
 * column's content jump up by that tile's height, so the offset has to shrink
 * by the same amount in the same paint. The frame loop records that amount as
 * "pending", and a layout effect applies it after React commits and before
 * the browser paints.
 *
 * INTERACTION. Hovering pauses the wall. Each tile offers "don't show here"
 * (with undo) and opens the slideshow from that image; the label opens the
 * full library.
 */

const GAP = 4
/** Aim for columns about this wide; the count follows the card's width. */
const COL_TARGET_PX = 150
/** Pixels per second, per column, so neighbours never move in lockstep. */
const SPEEDS = [10, 14, 8, 12, 9, 13]

export function GenerationsCarousel({ signedIn, className = "", aspect = "aspect-[4/3]" }: {
  signedIn: boolean
  className?: string
  aspect?: string
}) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const colEls = useRef<(HTMLDivElement | null)[]>([])

  const [cols, setCols] = useState<Tile[][]>([])
  const colsRef = useRef<Tile[][]>([])
  const [colCount, setColCount] = useState(0)
  const size = useRef({ w: 0, h: 0 })

  // Tiles waiting to be shown, and ones already shown (recycled if the queue runs dry).
  const pool = useRef<Tile[]>([])
  const spent = useRef<Tile[]>([])
  const fetching = useRef(false)
  const hiddenIds = useRef(new Set<number>())

  const offsets = useRef<number[]>([])
  const pending = useRef<number[]>([])
  const paused = useRef(false)
  const visible = useRef(true)
  const slideshowOpen = useRef(false)

  const [ready, setReady] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [slideshow, setSlideshow] = useState<{ start: Tile | null } | null>(null)
  const [undo, setUndo] = useState<Tile | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The wall holds still behind the slideshow.
  slideshowOpen.current = !!slideshow

  const colWidth = () => {
    const n = colsRef.current.length || 1
    return (size.current.w - GAP * (n - 1)) / n
  }
  const tileH = (t: Tile) => colWidth() / t.aspect + GAP
  const colHeight = (col: Tile[]) => col.reduce((a, t) => a + tileH(t), 0)

  const refill = () => {
    if (fetching.current || !signedIn) return
    fetching.current = true
    loadTiles(24)
      .then(({ tiles }) => { pool.current.push(...tiles.filter(t => !hiddenIds.current.has(t.id))) })
      .catch(() => {})
      .finally(() => { fetching.current = false })
  }

  /** The next tile to show: new work first, preferring images not already on the wall. */
  const takeNext = (onWall: Set<number>): Tile | null => {
    if (pool.current.length < 10) refill()
    const pick = (list: Tile[]) => {
      let i = list.findIndex(t => !onWall.has(t.id) && !hiddenIds.current.has(t.id))
      if (i < 0) i = list.findIndex(t => !hiddenIds.current.has(t.id))
      return i < 0 ? null : list.splice(i, 1)[0]
    }
    const t = pick(pool.current) ?? pick(spent.current)
    // A fresh key: the same image may come round again while its old copy is still leaving.
    return t ? { ...t, key: `${t.key}~${Math.random().toString(36).slice(2, 7)}` } : null
  }

  /** Top every column up so it runs at least a card and a half below the view. */
  const topUp = (next: Tile[][]) => {
    const need = size.current.h * 1.5 + 200
    const onWall = new Set(next.flat().map(t => t.id))
    next.forEach((col, c) => {
      let guard = 0
      while (colHeight(col) - (offsets.current[c] ?? 0) < need && guard++ < 12) {
        const t = takeNext(onWall)
        if (!t) break
        col.push(t)
        onWall.add(t.id)
      }
    })
    return next
  }

  const commit = (next: Tile[][]) => {
    colsRef.current = next
    setCols(next)
  }

  // Measure: the column count follows the width; a new count lays the wall out afresh.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      size.current = { w: width, h: height }
      setColCount(Math.min(6, Math.max(2, Math.round(width / COL_TARGET_PX))))
    })
    ro.observe(el)
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting })
    io.observe(el)
    return () => { ro.disconnect(); io.disconnect() }
  }, [])

  // First sample.
  useEffect(() => {
    if (!signedIn) { setReady(false); setEmpty(false); return }
    let alive = true
    fetching.current = true
    loadTiles(30)
      .then(({ tiles }) => {
        if (!alive) return
        pool.current = tiles
        setEmpty(tiles.length === 0)
        setReady(true)
      })
      .catch(() => {})
      .finally(() => { fetching.current = false })
    return () => { alive = false }
  }, [signedIn])

  // Lay out (again) once there are tiles and a column count.
  useEffect(() => {
    if (!ready || colCount === 0 || size.current.w === 0) return
    // Anything on the wall goes back to the front of the queue.
    pool.current.unshift(...colsRef.current.flat())
    const next: Tile[][] = Array.from({ length: colCount }, () => [])
    colsRef.current = next
    // Deal tiles to the shortest column, like a masonry grid.
    const onWall = new Set<number>()
    for (let guard = 0; guard < 80; guard++) {
      const heights = next.map(colHeight)
      const c = heights.indexOf(Math.min(...heights))
      if (heights[c] >= size.current.h * 1.5 + 200) break
      const t = takeNext(onWall)
      if (!t) break
      next[c].push(t)
      onWall.add(t.id)
    }
    // Staggered start, so columns do not line up.
    offsets.current = next.map((_, c) => (c % 2 ? 40 : 0) + c * 7)
    pending.current = next.map(() => 0)
    commit(next.map(col => [...col]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colCount])

  // After a commit: apply any pending top-tile drop in the same paint.
  useLayoutEffect(() => {
    colEls.current.forEach((el, c) => {
      if (!el) return
      if (pending.current[c]) {
        offsets.current[c] = Math.max(0, offsets.current[c] - pending.current[c])
        pending.current[c] = 0
      }
      el.style.transform = `translate3d(0, ${-offsets.current[c]}px, 0)`
    })
  }, [cols])

  // The drift.
  useEffect(() => {
    if (cols.length === 0) return
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (still) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000
      last = now
      if (!paused.current && visible.current && !document.hidden && !slideshowOpen.current) {
        let shift = false
        const cur = colsRef.current
        cur.forEach((col, c) => {
          const el = colEls.current[c]
          if (!el) return
          offsets.current[c] += SPEEDS[c % SPEEDS.length] * dt
          el.style.transform = `translate3d(0, ${-offsets.current[c]}px, 0)`
          if (!pending.current[c] && col[0] && offsets.current[c] > tileH(col[0])) shift = true
        })
        if (shift) {
          const next = cur.map(col => [...col])
          next.forEach((col, c) => {
            if (!pending.current[c] && col[0] && offsets.current[c] > tileH(col[0])) {
              pending.current[c] = tileH(col[0])
              spent.current.push(col.shift()!)
            }
          })
          if (spent.current.length > 60) spent.current.splice(0, spent.current.length - 60)
          commit(topUp(next))
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols.length > 0])

  /** Take every copy of an image off the wall and out of the queue. */
  const removeFromWall = (id: number) => {
    hiddenIds.current.add(id)
    const next = colsRef.current.map((col, c) => {
      const i = col.findIndex(x => x.id === id)
      if (i < 0) return [...col]
      // Dropping the top tile moves the content up; move the offset with it.
      if (i === 0) pending.current[c] = (pending.current[c] || 0) + Math.min(tileH(col[0]), offsets.current[c])
      return col.filter(x => x.id !== id)
    })
    pool.current = pool.current.filter(x => x.id !== id)
    commit(topUp(next))
  }

  const hide = (t: Tile) => {
    setHidden(t.id, true)
    removeFromWall(t.id)
    setUndo(t)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), 5000)
  }

  const restore = (t: Tile) => {
    hiddenIds.current.delete(t.id)
    setHidden(t.id, false)
    pool.current.unshift(t)
    setUndo(null)
  }

  const showWall = signedIn && !empty && cols.length > 0

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => { paused.current = true }}
      onMouseLeave={() => { paused.current = false }}
      onClick={showWall ? undefined : () => router.push("/my-generations")}
      className={`group/card relative ${aspect} rounded-2xl overflow-hidden border border-white/10 bg-slate-950 transition-all hover:border-white/25 hover:shadow-xl hover:shadow-black/40 ${showWall ? "" : "cursor-pointer"} ${className}`}
    >
      {showWall ? (
        <div className="absolute inset-0 flex" style={{ gap: GAP }}>
          {cols.map((col, c) => (
            <div key={c} className="relative flex-1 min-w-0 overflow-hidden">
              <div ref={el => { colEls.current[c] = el }} className="flex flex-col will-change-transform" style={{ gap: GAP }}>
                {col.map(t => (
                  <div
                    key={t.key}
                    onClick={() => setSlideshow({ start: t })}
                    className="group/tile relative w-full shrink-0 overflow-hidden rounded-[3px] bg-white/[0.03] cursor-pointer"
                    style={{ aspectRatio: t.aspect }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.thumb} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover/tile:scale-[1.04]" />
                    {(t.score ?? 0) >= 4 && (
                      <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-px rounded bg-black/55 backdrop-blur-sm text-[8px] font-semibold text-amber-300">
                        <Star size={8} className="fill-amber-300" />{t.score}
                      </span>
                    )}
                    {/* Hover: slideshow from here, or never show here again. */}
                    <div className="absolute inset-0 bg-black/35 opacity-0 group-hover/tile:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-sm border border-white/25 flex items-center justify-center">
                        <Play size={13} className="text-white fill-white ml-0.5" />
                      </span>
                      <button
                        title="Don't show in this section"
                        onClick={e => { e.stopPropagation(); hide(t) }}
                        className="absolute top-1 right-1 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/70 border border-white/15 text-[9px] font-medium text-white/90 hover:bg-red-500/80 hover:border-red-400/50 transition-colors"
                      >
                        <EyeOff size={10} /> Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] via-transparent to-black/50 flex items-center justify-center">
          <FolderOpen size={26} className="text-white/25" />
        </div>
      )}

      {/* Legibility scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent pointer-events-none" />

      {/* Animated silver rim */}
      <SilverRimOverlay />

      {/* Slideshow, top-right. */}
      {showWall && (
        <button
          onClick={() => setSlideshow({ start: null })}
          className="absolute top-2 right-2 z-10 flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-white opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-black/80"
        >
          <Play size={11} className="fill-white" /> Slideshow
        </button>
      )}

      {/* Label: opens the full library. */}
      <button
        onClick={e => { e.stopPropagation(); router.push("/my-generations") }}
        className="absolute left-0 bottom-0 z-10 p-3 text-left group/label max-w-full"
      >
        <p className="text-sm font-bold tracking-tight text-white drop-shadow flex items-center gap-1">
          My Generations
          <ArrowRight size={13} className="opacity-60 group-hover/label:translate-x-0.5 group-hover/label:opacity-100 transition-all" />
        </p>
        <p className="text-[11px] text-white/60 truncate">
          {showWall ? "Favourites and rediscoveries · hover to pause" : "All your images & videos"}
        </p>
      </button>

      {/* Undo a hide. */}
      {undo && (
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 pl-3 pr-1 py-1 rounded-lg bg-slate-900/95 border border-white/15 shadow-xl text-[11px] text-white/85">
          Hidden from this section
          <button onClick={e => { e.stopPropagation(); restore(undo) }} className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 font-semibold text-white">Undo</button>
        </div>
      )}

      {slideshow && (
        <HighlightsSlideshow
          start={slideshow.start}
          onClose={() => setSlideshow(null)}
          onHidden={removeFromWall}
        />
      )}
    </div>
  )
}
