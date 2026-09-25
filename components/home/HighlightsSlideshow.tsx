"use client"

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, EyeOff, Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, Star, X } from "lucide-react"
import { loadTiles, packRow, resetHidden, setHidden, type HighlightSource, type Tile } from "./highlights"

/*
 * Fullscreen slideshow of the user's own work, opened from the home page's
 * My Generations wall - either from a tile (it starts there) or from the
 * card's Slideshow button.
 *
 * Two rules every theme keeps:
 *
 *   NOTHING IS CROPPED OR ZOOMED. Every image is drawn in a box of its own
 *   exact shape. (An earlier version panned and zoomed, and cover-cropped
 *   pages; both cut parts of the image off and magnified it past its pixels.)
 *
 *   SHARP, AND IN TIME. Slides are drawn from each image's screen-sized copy
 *   (2048px WebP, a few hundred KB - see lib/display-image.ts), preloaded and
 *   decoded ahead. The originals are ~20MB PNGs: a Gallery page of three was
 *   a 60MB download, so at normal speed images arrived late or not at all,
 *   and a long run piled decoded 17-megapixel images up in memory.
 *   Auto-advance waits for the next slide to be ready; the thumbnail is only
 *   a stand-in when someone skips ahead faster than the network.
 *
 * Themes (several images on screen at once, laid out for the screen's shape):
 *   Carousel   a rotating strip: the current image large in the centre, its
 *              neighbours at the sides, the whole strip gliding along
 *   Gallery    a wall of images packed edge to edge in exact proportion (one
 *              tall row on a landscape screen, two rows on a portrait one)
 *              that changes one or two images at a time rather than the page
 *   Spotlight  one image, as large as it fits, crossfading
 *   Prints     prints dropped onto a pile, the older ones dimming
 *
 * Every layout is computed from the viewport, so the same code serves a
 * phone held either way, a tablet and a wide monitor.
 *
 * It streams from /api/user/highlights (Mix, Favourites or Everything),
 * fetching more before it runs out, so it keeps going through the whole
 * history instead of looping.
 */

type Theme = "carousel" | "gallery" | "spotlight" | "prints"

const THEMES: { id: Theme; label: string }[] = [
  { id: "carousel", label: "Carousel" },
  { id: "gallery", label: "Gallery" },
  { id: "spotlight", label: "Spotlight" },
  { id: "prints", label: "Prints" },
]
const SPEEDS = [{ ms: 3500, label: "Fast" }, { ms: 5500, label: "Normal" }, { ms: 9000, label: "Slow" }]
const SOURCES: { id: HighlightSource; label: string }[] = [
  { id: "mix", label: "Mix" }, { id: "fav", label: "Favourites" }, { id: "all", label: "Everything" },
]
const PREF_KEY = "home-slideshow-v2"
/** Prints keeps this many prints on the pile. */
const PILE = 5

/** A slide: rows of tiles (one row of one tile for everything but Gallery). */
type Slide = Tile[][]
type Layer = { key: string; slide: Slide; leaving: boolean; seed: number }
type Rect = { x: number; y: number; w: number; h: number }

// ── Full-size preloading ────────────────────────────────────────────────────

const fullState = new Map<string, "loading" | "ok" | "err">()

/** Load and decode a full-size image once; later draws of it are instant. */
function preloadFull(url: string) {
  if (fullState.has(url)) return
  fullState.set(url, "loading")
  const img = new Image()
  img.decoding = "async"
  img.onload = () => {
    const done = () => fullState.set(url, "ok")
    if (img.decode) img.decode().then(done, done)
    else done()
  }
  img.onerror = () => fullState.set(url, "err")
  img.src = url
}

const tilesOf = (s: Slide | undefined) => (s ? s.flat() : [])
const preloadSlide = (s: Slide | undefined) => tilesOf(s).forEach(t => { if (!t.isVideo) preloadFull(t.full) })
/** Ready = every image in it has finished (a failed one counts, it will show its thumbnail). */
const slideReady = (s: Slide | undefined) =>
  tilesOf(s).every(t => t.isVideo || (fullState.get(t.full) ?? "loading") !== "loading")

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * The area slides are laid out in: the screen minus room for the controls, so
 * nothing jumps when the controls fade in and out.
 */
function stageRect(vp: { w: number; h: number }): Rect {
  const phone = Math.min(vp.w, vp.h) < 600
  const portrait = vp.h > vp.w
  const top = phone ? 60 : 72
  const bottom = phone ? (portrait ? 150 : 76) : 112
  const x = phone ? 10 : Math.max(24, vp.w * 0.025)
  return { x, y: top, w: Math.max(100, vp.w - x * 2), h: Math.max(100, vp.h - top - bottom) }
}

/**
 * Gallery pages. A landscape screen gets one tall row (three or four
 * portraits at full height, or two landscapes and a portrait); a portrait
 * screen gets two rows stacked. Rows are filled to the page's shape, then
 * scaled as a block to fit, so every image keeps its exact proportions.
 */
function galleryPages(tiles: Tile[], stage: Rect): Slide[] {
  const portrait = stage.h > stage.w
  const rows = portrait ? 2 : 1
  const target = stage.w / (stage.h / rows)
  // Rows stop by themselves once full; the cap only stops a run of slim
  // portraits turning a wide screen into a picket fence.
  const maxPerRow = portrait ? 3 : 5
  const pool = [...tiles]
  const pages: Slide[] = []
  while (pool.length > 0) {
    const page: Tile[][] = []
    for (let r = 0; r < rows && pool.length > 0; r++) page.push(packRow(pool, target, maxPerRow))
    pages.push(page)
  }
  return pages
}

function readPrefs(): { theme: Theme; speed: number; source: HighlightSource } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}")
    return {
      theme: THEMES.some(t => t.id === p.theme) ? p.theme : "carousel",
      speed: SPEEDS.some(s => s.ms === p.speed) ? p.speed : 5500,
      source: SOURCES.some(s => s.id === p.source) ? p.source : "mix",
    }
  } catch { return { theme: "carousel", speed: 5500, source: "mix" } }
}

/** Deterministic pseudo-random in [0, 1) per layer, so re-renders do not reshuffle. */
const rnd = (seed: number, k: number) => {
  const x = Math.sin(seed * 9301 + k * 49297) * 233280
  return x - Math.floor(x)
}

export function HighlightsSlideshow({ start, onClose, onHidden }: {
  start: Tile | null
  onClose: () => void
  /** Tell the wall an image was hidden here. */
  onHidden: (id: number) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const init = useMemo(readPrefs, [])
  const [theme, setTheme] = useState<Theme>(init.theme)
  const [speed, setSpeed] = useState(init.speed)
  const [source, setSource] = useState<HighlightSource>(init.source)
  const [tiles, setTiles] = useState<Tile[]>(start ? [start] : [])
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [layers, setLayers] = useState<Layer[]>([])
  const [chrome, setChrome] = useState(true)
  const [full, setFull] = useState(false)
  const [canFull, setCanFull] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const [toast, setToast] = useState<{ text: string; undo?: Tile } | null>(null)
  const [vp, setVp] = useState({ w: 1600, h: 900 })

  const anchor = useRef<string | null>(start?.key ?? null)
  const seedRef = useRef(1)
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ theme, speed, source })) } catch {}
  }, [theme, speed, source])

  // Viewport, body scroll lock, fullscreen state.
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener("resize", onResize)
    // iPhone Safari cannot put a page element into full screen.
    setCanFull(!!document.fullscreenEnabled)
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("resize", onResize)
      document.removeEventListener("fullscreenchange", onFs)
      document.body.style.overflow = prevOverflow
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  const stage = stageRect(vp)

  // One image per slide. (Gallery keeps its own wall - see LivingGallery - and
  // only uses this list as its supply.)
  const slides: Slide[] = useMemo(() => tiles.map(t => [[t]]), [tiles])
  const galleryRef = useRef<GalleryHandle>(null)
  const [galleryTick, setGalleryTick] = useState(0)

  // Repacking (theme change, resize, more tiles) can move the image on screen to another index.
  useEffect(() => {
    if (!anchor.current) return
    const i = slides.findIndex(s => tilesOf(s).some(t => t.key === anchor.current))
    if (i >= 0 && i !== pos) setPos(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides])

  // A hide can take away the last slide; stay in range.
  useEffect(() => {
    if (slides.length > 0 && pos >= slides.length) setPos(slides.length - 1)
  }, [pos, slides.length])

  const loadMore = (src: HighlightSource, replace: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    loadTiles(30, src)
      .then(({ tiles: got, hiddenCount: hc }) => {
        setHiddenCount(hc)
        setTiles(prev => {
          if (replace) return got
          // Skip images shown recently, so a small library does not stutter.
          const recent = new Set(prev.slice(-40).map(t => t.id))
          const fresh = got.filter(t => !recent.has(t.id))
          if (fresh.length === 0) setExhausted(true)
          return [...prev, ...fresh]
        })
      })
      .catch(() => {})
      .finally(() => { loadingRef.current = false; setLoading(false) })
  }

  // First batch (after the tile it was opened from, if any).
  useEffect(() => { loadMore(source, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ahead of the viewer.
  useEffect(() => {
    if (!exhausted && slides.length > 0 && slides.length - pos <= 4) loadMore(source, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, slides.length, exhausted])

  // Warm the display files of what comes next (the carousel shows its neighbours too).
  useEffect(() => {
    if (theme === "gallery") return
    const ahead = theme === "carousel" ? [-2, -1, 0, 1, 2, 3] : [0, 1, 2]
    ahead.forEach(d => preloadSlide(slides[pos + d]))
  }, [pos, slides, theme])

  const changeSource = (s: HighlightSource) => {
    if (s === source) return
    setSource(s)
    setExhausted(false)
    setTiles([])
    setLayers([])
    setPos(0)
    anchor.current = null
    loadingRef.current = false
    loadMore(s, true)
  }

  const go = (d: 1 | -1) => {
    if (theme === "gallery") { galleryRef.current?.step(d); return }
    if (slides.length === 0) return
    setPos(p => {
      const n = p + d
      if (n >= slides.length) return exhausted || !loading ? 0 : p
      if (n < 0) return slides.length - 1
      return n
    })
  }

  /*
   * Auto-advance - but only onto a slide whose full-size files are ready, so
   * a slow connection shows each image late rather than blurry. It gives up
   * waiting after ten seconds and moves on regardless.
   */
  useEffect(() => {
    if (!playing || slides.length < 2 || theme === "gallery") return
    let tries = 0
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const next = slides[(pos + 1) % slides.length]
      if (!slideReady(next) && tries++ < 25) { preloadSlide(next); t = setTimeout(tick, 400); return }
      go(1)
    }
    t = setTimeout(tick, speed)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, playing, speed, slides.length, theme])

  // Layered themes: a new slide becomes a new layer; the previous one leaves.
  const lastTheme = useRef(theme)
  useEffect(() => {
    const slide = slides[pos]
    if (!slide) return
    anchor.current = slide[0][0].key
    if (theme === "carousel" || theme === "gallery") { lastTheme.current = theme; setLayers([]); return }
    const key = tilesOf(slide).map(t => t.key).join("|")
    const themeChanged = lastTheme.current !== theme
    lastTheme.current = theme
    setLayers(prev => {
      if (!themeChanged && prev.length && prev[prev.length - 1].key.startsWith(key + "#")) return prev
      const layer: Layer = { key: `${key}#${seedRef.current}`, slide, leaving: false, seed: seedRef.current++ }
      if (themeChanged) return [layer]
      if (theme === "prints") {
        // The pile: older prints stay, the oldest past PILE fade away.
        const kept = prev.filter(l => !l.leaving)
        return [...kept.map((l, i) => i < kept.length - (PILE - 1) ? { ...l, leaving: true } : l), layer]
      }
      return [...prev.map(l => ({ ...l, leaving: true })), layer]
    })
  }, [pos, slides, theme])

  // Drop layers once their exit is done.
  useEffect(() => {
    if (!layers.some(l => l.leaving)) return
    const t = setTimeout(() => setLayers(prev => prev.filter(l => !l.leaving)), 1400)
    return () => clearTimeout(t)
  }, [layers])

  const flash = (text: string, undo?: Tile) => {
    setToast({ text, undo })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  const hide = (t: Tile) => {
    setHidden(t.id, true)
    onHidden(t.id)
    setHiddenCount(c => c + 1)
    anchor.current = null
    setTiles(prev => prev.filter(x => x.id !== t.id))
    flash("Hidden from My Generations", t)
  }

  const undoHide = (t: Tile) => {
    setHidden(t.id, false)
    setHiddenCount(c => Math.max(0, c - 1))
    setToast(null)
  }

  const restoreAll = async () => {
    await resetHidden()
    setHiddenCount(0)
    flash("Hidden images will show again")
  }

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  // Controls fade out while playing and the pointer is still.
  const poke = () => {
    setChrome(true)
    if (chromeTimer.current) clearTimeout(chromeTimer.current)
    chromeTimer.current = setTimeout(() => setChrome(false), 2800)
  }
  useEffect(() => { poke(); return () => { if (chromeTimer.current) clearTimeout(chromeTimer.current) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const showChrome = chrome || !playing

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose()
      else if (e.key === "ArrowRight") { go(1); poke() }
      else if (e.key === "ArrowLeft") { go(-1); poke() }
      else if (e.key === " ") { e.preventDefault(); setPlaying(p => !p); poke() }
      else if ((e.key === "f" || e.key === "F") && canFull) toggleFull()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Swipe.
  const swipeX = useRef<number | null>(null)

  const current = slides[pos]
  const single = theme !== "gallery" && current && current.length === 1 && current[0].length === 1 ? current[0][0] : null
  const bg = theme === "prints"
    ? "bg-[radial-gradient(ellipse_at_center,#2a2320_0%,#120f0d_70%)]"
    : "bg-[radial-gradient(ellipse_at_center,#161a22_0%,#050608_75%)]"

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[300] ${bg} select-none overscroll-none touch-pan-y ${showChrome ? "" : "cursor-none"}`}
      onMouseMove={poke}
      onPointerDown={e => { swipeX.current = e.clientX }}
      onPointerUp={e => {
        if (swipeX.current === null) return
        const dx = e.clientX - swipeX.current
        swipeX.current = null
        if (Math.abs(dx) > 50) { go(dx < 0 ? 1 : -1); poke() }
      }}
      onClick={e => e.stopPropagation()}
    >
      <style>{`@keyframes ss-progress { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>

      {/* Stage */}
      <div className="absolute inset-0 overflow-hidden" onClick={() => setChrome(c => !c)}>
        {theme === "carousel" ? (
          <Carousel tiles={tiles} pos={pos} stage={stage} vp={vp} onPick={i => { setPos(i); poke() }} />
        ) : theme === "gallery" ? (
          <LivingGallery
            key={source}
            ref={galleryRef}
            tiles={tiles}
            stage={stage}
            speed={speed}
            playing={playing}
            onHide={hide}
            onNeedMore={() => { if (!exhausted) loadMore(source, false) }}
            onSwap={() => setGalleryTick(n => n + 1)}
          />
        ) : (
          layers.map((l, i) => (
            <SlideLayer key={l.key} layer={l} top={i === layers.length - 1} theme={theme} stage={stage} vp={vp} onHide={hide} />
          ))
        )}
        {tiles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm gap-2">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Gathering your work…</> : "Nothing to show here yet."}
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className={`absolute inset-x-0 top-0 px-3 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center gap-2 sm:gap-3 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${showChrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="min-w-0 mr-auto">
          <p className="text-sm font-bold text-white truncate">My Generations</p>
          <p className="text-[11px] text-white/50 flex items-center gap-1 truncate">
            {single?.score ? <><Star size={10} className="text-amber-300 fill-amber-300" /> {single.score} · </> : null}
            {SOURCES.find(s => s.id === source)?.label}
          </p>
        </div>
        <Seg options={SOURCES.map(s => ({ id: s.id, label: s.label }))} value={source} onChange={v => changeSource(v as HighlightSource)} />
        {hiddenCount > 0 && (
          <button onClick={restoreAll} title="Show every hidden image in this section again" className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] text-white/85">
            <RotateCcw size={12} /> Restore {hiddenCount} hidden
          </button>
        )}
        {canFull && <IconBtn title={full ? "Exit full screen (F)" : "Full screen (F)"} onClick={toggleFull}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconBtn>}
        <IconBtn title="Close (Esc)" onClick={onClose}><X size={18} /></IconBtn>
      </div>

      {/* Bottom bar */}
      <div className={`absolute inset-x-0 bottom-0 px-3 sm:px-5 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${showChrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5">
          <div className="flex justify-center gap-1 order-2 lg:order-1 lg:flex-1 lg:justify-start">
            <Seg options={THEMES.map(t => ({ id: t.id, label: t.label }))} value={theme} onChange={v => setTheme(v as Theme)} />
          </div>
          <div className="flex items-center gap-2 order-1 lg:order-2">
            <IconBtn title="Previous (←)" onClick={() => go(-1)}><ChevronLeft size={20} /></IconBtn>
            <button
              onClick={() => setPlaying(p => !p)}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
            >
              {playing ? <Pause size={20} className="fill-black" /> : <Play size={20} className="fill-black ml-0.5" />}
            </button>
            <IconBtn title="Next (→)" onClick={() => go(1)}><ChevronRight size={20} /></IconBtn>
          </div>
          <div className="flex items-center justify-center gap-2 order-3 lg:flex-1 lg:justify-end">
            <Seg options={SPEEDS.map(s => ({ id: String(s.ms), label: s.label }))} value={String(speed)} onChange={v => setSpeed(Number(v))} />
            {single && (
              <button
                onClick={() => hide(single)}
                title="Don't show this image in My Generations"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-red-500/70 text-[11px] font-semibold text-white/85 transition-colors"
              >
                <EyeOff size={12} /> <span className="hidden sm:inline">Don&apos;t show</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress to the next slide. */}
      {slides.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
          <div
            key={`${pos}-${speed}-${theme}-${galleryTick}`}
            className="h-full bg-white/70 origin-left"
            style={{ animation: `ss-progress ${speed}ms linear forwards`, animationPlayState: playing ? "running" : "paused" }}
          />
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-36 sm:bottom-28 flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-slate-900/95 border border-white/15 shadow-2xl text-xs text-white/85 whitespace-nowrap">
          {toast.text}
          {toast.undo && (
            <button onClick={() => undoHide(toast.undo!)} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-white">Undo</button>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="w-9 h-9 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
      {children}
    </button>
  )
}

function Seg({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex p-0.5 rounded-lg bg-white/10 shrink-0">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${value === o.id ? "bg-white text-black" : "text-white/75 hover:text-white"}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

/**
 * Carousel: a strip of images gliding sideways, the current one large in the
 * middle and its neighbours smaller and dimmer at the sides.
 *
 * Every image in the window is placed by its offset from the current one, and
 * keeps its key as the index moves, so a change of index animates the whole
 * strip along instead of swapping pictures. On a landscape screen the centre
 * image takes up to 60% of the width, so several neighbours show; on a
 * portrait one it takes most of the width with just a peek either side.
 */
function Carousel({ tiles, pos, stage, vp, onPick }: {
  tiles: Tile[]
  pos: number
  stage: Rect
  vp: { w: number; h: number }
  onPick: (i: number) => void
}) {
  const portrait = vp.h > vp.w
  const phone = Math.min(vp.w, vp.h) < 600
  if (pos >= tiles.length) return null
  // Landscape keeps room under the strip for its reflection.
  const maxH = stage.h * (portrait ? 0.92 : 0.84)
  const maxW = stage.w * (portrait ? 0.84 : phone ? 0.5 : 0.6)
  const gap = portrait ? 14 : phone ? 18 : 34
  const side = portrait ? 0.86 : 0.8

  const box = (t: Tile) => {
    const w = Math.min(t.aspect * maxH, maxW)
    return { w, h: w / t.aspect }
  }
  const scaleOf = (i: number) => (i === pos ? 1 : side)

  // Centre offsets from the current image, walking outwards.
  const lo = Math.max(0, pos - 6)
  const hi = Math.min(tiles.length - 1, pos + 6)
  const offs = new Map<number, number>([[pos, 0]])
  for (let i = pos + 1; i <= hi; i++) {
    const a = box(tiles[i - 1]).w * scaleOf(i - 1), b = box(tiles[i]).w * scaleOf(i)
    offs.set(i, offs.get(i - 1)! + a / 2 + gap + b / 2)
  }
  for (let i = pos - 1; i >= lo; i--) {
    const a = box(tiles[i + 1]).w * scaleOf(i + 1), b = box(tiles[i]).w * scaleOf(i)
    offs.set(i, offs.get(i + 1)! - a / 2 - gap - b / 2)
  }

  const cx = stage.x + stage.w / 2
  const cy = stage.y + (portrait ? stage.h / 2 : maxH / 2 + stage.h * 0.04)

  // Mount only what is on screen, plus one beyond each edge so the next image
  // glides in from off-screen rather than appearing - and so the carousel
  // loads a handful of full-size files, not thirteen.
  const onScreen = (i: number) => Math.abs(offs.get(i)!) - (box(tiles[i]).w * scaleOf(i)) / 2 < vp.w / 2
  let first = pos, last = pos
  while (first > lo && onScreen(first - 1)) first--
  while (last < hi && onScreen(last + 1)) last++
  first = Math.max(lo, first - 1)
  last = Math.min(hi, last + 1)

  const items = []
  for (let i = first; i <= last; i++) {
    const t = tiles[i]
    const { w, h } = box(t)
    const on = i === pos
    const dist = Math.abs(i - pos)
    items.push(
      <div
        key={t.key}
        onClick={e => { if (!on) { e.stopPropagation(); onPick(i) } }}
        className={`absolute rounded-lg overflow-hidden bg-white/5 transition-[transform,opacity,filter] duration-[900ms] ease-[cubic-bezier(.22,.61,.36,1)] ${on ? "shadow-2xl shadow-black/70" : "cursor-pointer"}`}
        style={{
          width: w, height: h, left: cx - w / 2, top: cy - h / 2,
          transform: `translateX(${offs.get(i)}px) scale(${scaleOf(i)})`,
          opacity: on ? 1 : Math.max(0, 0.55 - (dist - 1) * 0.15),
          filter: on ? "none" : "saturate(.7)",
          zIndex: 10 - dist,
          // A soft reflection on landscape screens, where there is room under the strip.
          WebkitBoxReflect: portrait ? undefined : "below 6px linear-gradient(transparent 78%, rgba(255,255,255,.14))",
        } as React.CSSProperties}
      >
        <FullImage tile={t} video={on} />
      </div>,
    )
  }
  return <>{items}</>
}

type GalleryHandle = { step: (d: 1 | -1) => void }
type GSlot = { id: string; box: number; tile: Tile; since: number }

/**
 * Gallery: a wall that changes a little at a time.
 *
 * The layout is packed once for the screen (one tall row on landscape, two
 * rows on portrait) and then stays put. Each tick replaces one image - two
 * once the wall holds five or more - so every image stays up for several
 * ticks and only one or two new files are needed at a time, instead of a
 * whole page at once.
 *
 * A replacement must already be loaded, and is chosen from the next dozen in
 * line as the one closest in shape to the space it fills - usually an exact
 * match, since most generations share a handful of aspect ratios. When it is
 * not exact the image is fitted whole (never cropped) over a blurred copy of
 * itself. The slots changed are the ones shown longest, never two side by side.
 *
 * Next swaps at once; Previous puts back the last image replaced.
 */
const LivingGallery = forwardRef<GalleryHandle, {
  tiles: Tile[]
  stage: Rect
  speed: number
  playing: boolean
  onHide: (t: Tile) => void
  onNeedMore: () => void
  onSwap: () => void
}>(function LivingGallery({ tiles, stage, speed, playing, onHide, onNeedMore, onSwap }, ref) {
  const [rows, setRows] = useState<GSlot[][]>([])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  // Every tile key the wall has used, so it moves on through the supply.
  const used = useRef(new Set<string>())
  const history = useRef<{ id: string; tile: Tile }[]>([])
  const layoutKey = `${Math.round(stage.w)}x${Math.round(stage.h)}`

  const candidates = () => {
    const onWall = new Set(rowsRef.current.flat().map(s => s.tile.id))
    let list = tilesRef.current.filter(t => !used.current.has(t.key) && !onWall.has(t.id))
    if (list.length < 10) onNeedMore()
    if (list.length === 0 && tilesRef.current.length > onWall.size) {
      // Through the whole supply: start again, minus what is up now.
      used.current = new Set(rowsRef.current.flat().map(s => s.tile.key))
      list = tilesRef.current.filter(t => !onWall.has(t.id))
    }
    return list
  }

  /*
   * Lay the wall out once there is something to show, again on a resize, and
   * again while it is under-filled and more images arrive (opened from one
   * tile, the first layout has only that one to work with).
   */
  const hasTiles = tiles.length > 0
  const rowTarget = rows.length ? stage.w / (stage.h / rows.length) : 1
  const fill = rows.length ? Math.min(...rows.map(r => r.reduce((a, s) => a + s.box, 0))) / rowTarget : 0
  const relayoutSig = fill < 0.75 ? tiles.length : -1
  useEffect(() => {
    if (!hasTiles) return
    const keep = rowsRef.current.flat().map(s => s.tile)
    const pool = [...keep, ...candidates().filter(t => !keep.some(k => k.key === t.key))]
    const page = galleryPages(pool, stage)[0] ?? []
    const now = Date.now()
    let n = 0
    const next = page.map((row, ri) => row.map((t, ci) => {
      used.current.add(t.key)
      // Staggered "ages", so the first swaps do not all hit one side.
      return { id: `${layoutKey}:${ri}:${ci}`, box: t.aspect, tile: t, since: now - ((n++ * 7919) % 5) * 1000 }
    }))
    rowsRef.current = next
    setRows(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, hasTiles, relayoutSig])

  // Keep the next few replacements downloading.
  useEffect(() => {
    candidates().slice(0, 6).forEach(t => { if (!t.isVideo) preloadFull(t.full) })
  })

  const swapIn = (slotIds: string[], force = false) => {
    const pool = candidates().slice(0, 12)
    const taken = new Set<string>()
    let changed = false
    const next = rowsRef.current.map(row => row.map(slot => {
      if (!slotIds.includes(slot.id)) return slot
      const ready = pool.filter(t => !taken.has(t.key) && (force || t.isVideo || fullState.get(t.full) === "ok"))
      if (ready.length === 0) return slot
      const pick = ready.reduce((best, t) =>
        Math.abs(Math.log(t.aspect / slot.box)) < Math.abs(Math.log(best.aspect / slot.box)) ? t : best)
      taken.add(pick.key)
      used.current.add(pick.key)
      history.current.push({ id: slot.id, tile: slot.tile })
      if (history.current.length > 40) history.current.shift()
      changed = true
      return { ...slot, tile: pick, since: Date.now() }
    }))
    if (changed) { rowsRef.current = next; setRows(next); onSwap() }
  }

  /** The slots shown longest, never two neighbours in one row. */
  const pickSlots = (k: number) => {
    const all = rowsRef.current.flatMap((row, ri) => row.map((s, ci) => ({ s, ri, ci })))
    all.sort((a, b) => a.s.since - b.s.since)
    const chosen: typeof all = []
    for (const c of all) {
      if (chosen.length >= k) break
      if (chosen.some(x => x.ri === c.ri && Math.abs(x.ci - c.ci) === 1)) continue
      chosen.push(c)
    }
    return chosen.map(c => c.s.id)
  }

  const perTick = () => (rowsRef.current.flat().length >= 5 ? 2 : 1)

  useImperativeHandle(ref, () => ({
    step: (d: 1 | -1) => {
      if (d === 1) { swapIn(pickSlots(perTick())); return }
      const last = history.current.pop()
      if (!last) return
      const next = rowsRef.current.map(row => row.map(s => s.id === last.id ? { ...s, tile: last.tile, since: Date.now() } : s))
      rowsRef.current = next
      setRows(next)
      onSwap()
    },
  }))

  useEffect(() => {
    if (!playing || rows.length === 0) return
    const t = setInterval(() => swapIn(pickSlots(perTick())), speed)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, rows.length > 0])

  // Each row filled to the stage's width at its own height, then the block
  // scaled to fit the stage's height: exact proportions, no crop.
  const gap = Math.max(6, Math.min(stage.w, stage.h) * 0.012)
  const sized = rows.map(row => {
    const sum = row.reduce((a, s) => a + s.box, 0)
    return { row, h: (stage.w - gap * (row.length - 1)) / sum }
  })
  const total = sized.reduce((a, r) => a + r.h, 0) + gap * (sized.length - 1)
  const k = total > 0 ? Math.min(1, stage.h / total) : 1

  return (
    <div className="absolute flex flex-col items-center justify-center" style={{ left: stage.x, top: stage.y, width: stage.w, height: stage.h, gap }}>
      {sized.map((r, ri) => (
        <div key={ri} className="flex justify-center" style={{ gap }}>
          {r.row.map(slot => (
            <GallerySlot
              key={slot.id}
              slot={slot}
              w={slot.box * r.h * k}
              h={r.h * k}
              onHide={t => { onHide(t); swapIn([slot.id], true) }}
            />
          ))}
        </div>
      ))}
    </div>
  )
})

/** One space on the wall: the new image fades in over the old one. */
function GallerySlot({ slot, w, h, onHide }: { slot: GSlot; w: number; h: number; onHide: (t: Tile) => void }) {
  const [stack, setStack] = useState<Tile[]>([slot.tile])
  useEffect(() => {
    setStack(prev => (prev[prev.length - 1]?.key === slot.tile.key ? prev : [...prev.slice(-1), slot.tile]))
    const t = setTimeout(() => setStack(prev => prev.slice(-1)), 1200)
    return () => clearTimeout(t)
  }, [slot.tile])
  return (
    <div className="group relative rounded-md overflow-hidden shadow-xl shadow-black/60 bg-white/5" style={{ width: w, height: h }}>
      {stack.map((t, i) => (
        <SlotLayer key={t.key} tile={t} box={slot.box} fadeIn={i > 0} />
      ))}
      <HideChip tile={slot.tile} onHide={onHide} />
    </div>
  )
}

function SlotLayer({ tile, box, fadeIn }: { tile: Tile; box: number; fadeIn: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (fadeIn) ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: "ease-in-out", fill: "both" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // An image not quite the space's shape is fitted whole over a blurred copy of itself.
  const exact = Math.abs(Math.log(tile.aspect / box)) < 0.03
  return (
    <div ref={ref} className="absolute inset-0 bg-[#0b0d12]">
      {!exact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-50" />
      )}
      <FullImage tile={tile} video={false} />
    </div>
  )
}

/** Spotlight and Prints: one slide on the stage, with its entrance and exit. */
function SlideLayer({ layer, top, theme, stage, vp, onHide }: {
  layer: Layer
  /** The newest layer; on the prints pile, everything under it dims. */
  top: boolean
  theme: Theme
  stage: Rect
  vp: { w: number; h: number }
  onHide: (t: Tile) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const { slide, seed, leaving } = layer
  const portrait = vp.h > vp.w

  // Entrance: fades and slides only, never a zoom.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (theme === "prints") {
      const card = printRef.current
      if (card) {
        const r = (rnd(seed, 3) - 0.5) * 12
        const fromX = (rnd(seed, 7) > 0.5 ? 1 : -1) * 40
        card.animate([
          { transform: `translate(${fromX}vw, 30vh) rotate(${r * 3}deg)`, opacity: 0 },
          { transform: `translate(0, 0) rotate(${r}deg)`, opacity: 1 },
        ], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" })
      }
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1100, easing: "ease-in-out", fill: "both" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Exit.
  useEffect(() => {
    if (!leaving || !ref.current) return
    ref.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: theme === "prints" ? 0 : 350, easing: "ease-in-out", fill: "both" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])

  const t = slide[0][0]

  if (theme === "prints") {
    const frame = portrait ? 10 : 14
    const ph = Math.min(stage.h * 0.8 - frame * 4, (stage.w * (portrait ? 0.84 : 0.55)) / t.aspect)
    const dx = (rnd(seed, 1) - 0.5) * stage.w * 0.12
    const dy = (rnd(seed, 2) - 0.5) * stage.h * 0.06
    return (
      <div ref={ref} className="absolute inset-0 pointer-events-none">
        <div
          className="absolute"
          style={{ left: stage.x + stage.w / 2 + dx, top: stage.y + stage.h / 2 + dy, transform: "translate(-50%, -50%)" }}
        >
          <div
            ref={printRef}
            className="bg-[#f3efe6] shadow-[0_18px_50px_rgba(0,0,0,.6)] transition-[filter] duration-700"
            style={{ padding: frame, paddingBottom: frame * 3.6, filter: top ? undefined : "brightness(.5)" }}
          >
            <div className="relative overflow-hidden" style={{ width: t.aspect * ph, height: ph }}>
              <FullImage tile={t} video={false} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Spotlight: the image as large as the screen allows, over a blurred copy.
  const w = Math.min(stage.w, (stage.h + 40) * t.aspect)
  const h = w / t.aspect
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-30" />
      <div className="absolute rounded-md overflow-hidden shadow-2xl shadow-black/70" style={{ width: w, height: h, left: stage.x + (stage.w - w) / 2, top: stage.y + (stage.h - h) / 2 }}>
        <FullImage tile={t} video />
      </div>
    </div>
  )
}

/**
 * The full-size file, filling a box of its exact shape. If it has already
 * been preloaded it draws at once; otherwise the thumbnail stands in until
 * it arrives. Videos play (muted) where `video` is set, and show their
 * poster elsewhere.
 */
function FullImage({ tile, video }: { tile: Tile; video: boolean }) {
  const ready = !tile.isVideo && fullState.get(tile.full) === "ok"
  const [loaded, setLoaded] = useState(ready)
  useEffect(() => { if (!tile.isVideo) preloadFull(tile.full) }, [tile])
  const cls = "absolute inset-0 w-full h-full object-contain"
  return (
    <>
      {!loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.thumb} alt="" draggable={false} className={cls} />
      )}
      {tile.isVideo ? (
        video && <video src={tile.full} autoPlay muted loop playsInline className={`${cls} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`} onLoadedData={() => setLoaded(true)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tile.full}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`${cls} ${ready ? "" : "transition-opacity duration-500"} ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </>
  )
}

function HideChip({ tile, onHide }: { tile: Tile; onHide: (t: Tile) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onHide(tile) }}
      title="Don't show this image in My Generations"
      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border border-white/15 text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-all"
    >
      <EyeOff size={11} /> Don&apos;t show
    </button>
  )
}
