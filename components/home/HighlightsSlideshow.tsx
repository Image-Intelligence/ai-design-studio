"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, EyeOff, Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, Star, X } from "lucide-react"
import { loadTiles, pack, resetHidden, setHidden, type HighlightSource, type Tile } from "./highlights"

/*
 * Fullscreen slideshow of the user's own work, opened from the home page's
 * My Generations wall - either from a tile (it starts there) or from the
 * card's Slideshow button.
 *
 * Themes, after the ones in Apple Photos:
 *   Ken Burns       slow pan and zoom on each image
 *   Dissolve        a still image, soft crossfade
 *   Sliding Panels  each image slides in over the last
 *   Magazine        two or three images per page, packed to the screen
 *   Vintage Prints  prints dropped onto a pile, the older ones dimming
 *
 * It streams from the same /api/user/highlights sample as the wall (Mix,
 * Favourites or Everything), asking for more before it runs out, so a long
 * slideshow keeps going through the whole history instead of looping.
 *
 * Each slide becomes a "layer". A new layer animates in on top; the one it
 * replaces animates out and is dropped once its exit is done. Animations use
 * the Web Animations API rather than CSS classes, so a layer's enter and
 * exit can differ per theme and per direction without a stylesheet.
 */

type Theme = "kenburns" | "dissolve" | "sliding" | "magazine" | "prints"

const THEMES: { id: Theme; label: string }[] = [
  { id: "kenburns", label: "Ken Burns" },
  { id: "dissolve", label: "Dissolve" },
  { id: "sliding", label: "Sliding Panels" },
  { id: "magazine", label: "Magazine" },
  { id: "prints", label: "Vintage Prints" },
]
const SPEEDS = [{ ms: 3000, label: "Fast" }, { ms: 5000, label: "Normal" }, { ms: 8000, label: "Slow" }]
const SOURCES: { id: HighlightSource; label: string }[] = [
  { id: "mix", label: "Mix" }, { id: "fav", label: "Favourites" }, { id: "all", label: "Everything" },
]
const PREF_KEY = "home-slideshow"
/** Vintage Prints keeps this many prints on the pile. */
const PILE = 5

type Layer = { key: string; slide: Tile[]; leaving: boolean; dir: 1 | -1; seed: number }

function readPrefs(): { theme: Theme; speed: number; source: HighlightSource } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}")
    return {
      theme: THEMES.some(t => t.id === p.theme) ? p.theme : "kenburns",
      speed: SPEEDS.some(s => s.ms === p.speed) ? p.speed : 5000,
      source: SOURCES.some(s => s.id === p.source) ? p.source : "mix",
    }
  } catch { return { theme: "kenburns", speed: 5000, source: "mix" } }
}

/** Deterministic pseudo-random in [0, 1) per layer, so re-renders do not reshuffle motion. */
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
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const [toast, setToast] = useState<{ text: string; undo?: Tile } | null>(null)
  const [vp, setVp] = useState({ w: 1600, h: 900 })

  const dir = useRef<1 | -1>(1)
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

  const screenAspect = vp.w / Math.max(vp.h, 1)

  // Magazine packs several images per page; every other theme shows one.
  const slides = useMemo(
    () => theme === "magazine" ? pack(tiles, screenAspect * 0.95, 3) : tiles.map(t => [t]),
    [tiles, theme, screenAspect],
  )

  // Repacking (theme change, more tiles) can move the image on screen to another index.
  useEffect(() => {
    if (!anchor.current) return
    const i = slides.findIndex(s => s.some(t => t.key === anchor.current))
    if (i >= 0 && i !== pos) setPos(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides])

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

  // A hide can take away the last slide; stay in range.
  useEffect(() => {
    if (slides.length > 0 && pos >= slides.length) setPos(slides.length - 1)
  }, [pos, slides.length])

  // Keep ahead of the viewer.
  useEffect(() => {
    if (!exhausted && slides.length > 0 && slides.length - pos <= 3) loadMore(source, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, slides.length, exhausted])

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
    if (slides.length === 0) return
    dir.current = d
    setPos(p => {
      const n = p + d
      if (n >= slides.length) return exhausted || !loading ? 0 : p
      if (n < 0) return slides.length - 1
      return n
    })
  }

  // Auto-advance.
  useEffect(() => {
    if (!playing || slides.length < 2) return
    const t = setTimeout(() => go(1), speed)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, playing, speed, slides.length, theme])

  // A new slide becomes a new layer; the previous one leaves.
  const lastTheme = useRef(theme)
  useEffect(() => {
    const slide = slides[pos]
    if (!slide) return
    anchor.current = slide[0].key
    const key = slide.map(t => t.key).join("|")
    const themeChanged = lastTheme.current !== theme
    lastTheme.current = theme
    setLayers(prev => {
      if (!themeChanged && prev.length && prev[prev.length - 1].key === key) return prev
      const layer: Layer = { key: `${key}#${seedRef.current}`, slide, leaving: false, dir: dir.current, seed: seedRef.current++ }
      if (themeChanged) return [layer]
      if (theme === "prints") {
        // The pile: older prints stay, the oldest past PILE fade away.
        const kept = prev.filter(l => !l.leaving)
        return [...kept.map((l, i) => i < kept.length - (PILE - 1) ? { ...l, leaving: true } : l), layer]
      }
      // The outgoing slide leaves in the direction of travel (Sliding Panels).
      return [...prev.map(l => ({ ...l, leaving: true, dir: dir.current })), layer]
    })
    // Warm the next slide's full-size images.
    slides[(pos + 1) % slides.length]?.forEach(t => { if (!t.isVideo) { const i = new Image(); i.src = t.full } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, slides, theme])

  // Drop layers once their exit animation is done.
  useEffect(() => {
    if (!layers.some(l => l.leaving)) return
    const t = setTimeout(() => setLayers(prev => prev.filter(l => !l.leaving)), 1300)
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
      else if (e.key === "f" || e.key === "F") toggleFull()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Swipe.
  const swipeX = useRef<number | null>(null)

  const current = slides[pos]
  const single = current && current.length === 1 ? current[0] : null
  const bg = theme === "prints"
    ? "bg-[radial-gradient(ellipse_at_center,#2a2320_0%,#120f0d_70%)]"
    : "bg-black"

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[300] ${bg} select-none ${showChrome ? "" : "cursor-none"}`}
      onMouseMove={poke}
      onPointerDown={e => { swipeX.current = e.clientX }}
      onPointerUp={e => {
        if (swipeX.current === null) return
        const dx = e.clientX - swipeX.current
        swipeX.current = null
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1)
      }}
      onClick={e => e.stopPropagation()}
    >
      <style>{`@keyframes ss-progress { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>

      {/* Stage */}
      <div className="absolute inset-0 overflow-hidden" onClick={() => setChrome(c => !c)}>
        {layers.map((l, i) => (
          <SlideLayer key={l.key} layer={l} top={i === layers.length - 1} theme={theme} speed={speed} vp={vp} onHide={hide} />
        ))}
        {tiles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm gap-2">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Gathering your work…</> : "Nothing to show here yet."}
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className={`absolute inset-x-0 top-0 p-3 sm:p-4 flex items-center gap-2 sm:gap-3 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${showChrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="min-w-0 mr-auto">
          <p className="text-sm font-bold text-white truncate">My Generations</p>
          <p className="text-[11px] text-white/50 flex items-center gap-1">
            {single?.score ? <><Star size={10} className="text-amber-300 fill-amber-300" /> {single.score} · </> : null}
            {SOURCES.find(s => s.id === source)?.label}
          </p>
        </div>
        <Seg options={SOURCES.map(s => ({ id: s.id, label: s.label }))} value={source} onChange={v => changeSource(v as HighlightSource)} />
        {hiddenCount > 0 && (
          <button onClick={restoreAll} title="Show every hidden image in this section again" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] text-white/85">
            <RotateCcw size={12} /> Restore {hiddenCount} hidden
          </button>
        )}
        <IconBtn title={full ? "Exit full screen (F)" : "Full screen (F)"} onClick={toggleFull}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconBtn>
        <IconBtn title="Close (Esc)" onClick={onClose}><X size={18} /></IconBtn>
      </div>

      {/* Bottom bar */}
      <div className={`absolute inset-x-0 bottom-0 px-3 sm:px-5 pt-10 pb-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${showChrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
          <div className="flex flex-wrap justify-center gap-1 order-2 lg:order-1 lg:flex-1 lg:justify-start">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${theme === t.id ? "bg-white text-black" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
              >{t.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 order-1 lg:order-2">
            <IconBtn title="Previous (←)" onClick={() => go(-1)}><ChevronLeft size={20} /></IconBtn>
            <button
              onClick={() => setPlaying(p => !p)}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
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
                <EyeOff size={12} /> Don&apos;t show
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress to the next slide. */}
      {slides.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
          <div
            key={`${pos}-${speed}-${theme}`}
            className="h-full bg-white/70 origin-left"
            style={{ animation: `ss-progress ${speed}ms linear forwards`, animationPlayState: playing ? "running" : "paused" }}
          />
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-28 flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-slate-900/95 border border-white/15 shadow-2xl text-xs text-white/85">
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
    <button title={title} onClick={onClick} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
      {children}
    </button>
  )
}

function Seg({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex p-0.5 rounded-lg bg-white/10">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${value === o.id ? "bg-white text-black" : "text-white/75 hover:text-white"}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

/** One slide on the stage, with its theme's entrance and exit. */
function SlideLayer({ layer, top, theme, speed, vp, onHide }: {
  layer: Layer
  /** The newest layer; on the prints pile, everything under it dims. */
  top: boolean
  theme: Theme
  speed: number
  vp: { w: number; h: number }
  onHide: (t: Tile) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const motionRef = useRef<HTMLDivElement>(null)
  const { slide, seed, dir, leaving } = layer
  const screenAspect = vp.w / Math.max(vp.h, 1)

  // Entrance.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ease = "cubic-bezier(.22,.61,.36,1)"
    if (theme === "sliding") {
      el.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: "translateX(0)" }], { duration: 900, easing: ease, fill: "both" })
    } else if (theme === "prints") {
      const card = motionRef.current
      if (card) {
        const r = (rnd(seed, 3) - 0.5) * 14
        card.animate([
          { transform: `translate(-50%, -50%) translate(${(rnd(seed, 1) - 0.5) * 8}vw, ${(rnd(seed, 2) - 0.5) * 6}vh) rotate(${r * 2.5}deg) scale(1.35)`, opacity: 0 },
          { transform: `translate(-50%, -50%) translate(${(rnd(seed, 1) - 0.5) * 8}vw, ${(rnd(seed, 2) - 0.5) * 6}vh) rotate(${r}deg) scale(1)`, opacity: 1 },
        ], { duration: 800, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" })
      }
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: theme === "magazine" ? 800 : 1200, easing: "ease-in-out", fill: "both" })
      if (theme === "magazine") {
        Array.from(el.querySelectorAll<HTMLElement>("[data-tile]")).forEach((t, i) =>
          t.animate([{ transform: "translateY(18px) scale(.97)", opacity: 0 }, { transform: "none", opacity: 1 }],
            { duration: 700, delay: 120 + i * 140, easing: ease, fill: "both" }))
      }
    }
    // Ken Burns: the motion runs across the whole time on screen, plus the fades.
    if (theme === "kenburns" && motionRef.current && !slide[0].isVideo) {
      const zoomIn = rnd(seed, 4) > 0.4
      const s0 = zoomIn ? 1.02 : 1.16
      const s1 = zoomIn ? 1.16 : 1.02
      const x = (rnd(seed, 5) - 0.5) * 5
      const y = (rnd(seed, 6) - 0.5) * 5
      motionRef.current.animate([
        { transform: `scale(${s0}) translate(${-x}%, ${-y}%)` },
        { transform: `scale(${s1}) translate(${x}%, ${y}%)` },
      ], { duration: speed + 2500, easing: "linear", fill: "both" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Exit.
  useEffect(() => {
    if (!leaving) return
    const el = ref.current
    if (!el) return
    if (theme === "sliding") {
      el.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * 100}%)` }], { duration: 900, easing: "cubic-bezier(.22,.61,.36,1)", fill: "both" })
    } else {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, delay: theme === "prints" ? 0 : 400, easing: "ease-in-out", fill: "both" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])

  if (theme === "magazine") {
    const gap = Math.max(8, vp.w * 0.012)
    const sum = slide.reduce((a, t) => a + t.aspect, 0)
    const rowH = Math.min(vp.h * 0.8, (vp.w * 0.9 - gap * (slide.length - 1)) / sum)
    return (
      <div ref={ref} className="absolute inset-0 flex items-center justify-center" style={{ gap }}>
        {slide.map(t => (
          <div key={t.key} data-tile className="group relative rounded-md overflow-hidden shadow-2xl shadow-black/60 bg-white/5" style={{ width: t.aspect * rowH, height: rowH }}>
            <FullImage tile={t} fit="cover" video={false} />
            <HideChip tile={t} onHide={onHide} />
          </div>
        ))}
      </div>
    )
  }

  if (theme === "prints") {
    const t = slide[0]
    const ph = Math.min(vp.h * 0.7, (vp.w * 0.6) / t.aspect)
    return (
      <div ref={ref} className="absolute inset-0 pointer-events-none">
        <div
          ref={motionRef}
          className="absolute left-1/2 top-1/2 bg-[#f3efe6] p-[10px] pb-[44px] shadow-[0_18px_50px_rgba(0,0,0,.6)] transition-[filter] duration-700"
          style={{ filter: top ? undefined : "brightness(.5)" }}
        >
          <div className="relative overflow-hidden" style={{ width: t.aspect * ph, height: ph }}>
            <FullImage tile={t} fit="cover" video={false} />
          </div>
        </div>
      </div>
    )
  }

  // Ken Burns, Dissolve, Sliding Panels: one image over a blurred copy of itself.
  const t = slide[0]
  // Ken Burns fills the screen when the shape is close; far off (a portrait on
  // a landscape screen) it would crop too much, so it moves the fitted image.
  const cover = theme === "kenburns" && Math.abs(Math.log(t.aspect / screenAspect)) < 0.35
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl scale-125 opacity-40" />
      <div ref={motionRef} className="absolute inset-0">
        <FullImage tile={t} fit={cover ? "cover" : "contain"} video />
      </div>
    </div>
  )
}

/** The thumbnail at once, the full-size image fading in over it when loaded. */
function FullImage({ tile, fit, video }: { tile: Tile; fit: "cover" | "contain"; video: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const cls = `absolute inset-0 w-full h-full ${fit === "cover" ? "object-cover" : "object-contain"}`
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tile.thumb} alt="" draggable={false} className={cls} />
      {tile.isVideo ? (
        video && <video src={tile.full} autoPlay muted loop playsInline className={`${cls} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`} onLoadedData={() => setLoaded(true)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.full} alt="" draggable={false} onLoad={() => setLoaded(true)} className={`${cls} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`} />
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
