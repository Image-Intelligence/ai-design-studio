"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowRight, LayoutGrid } from "lucide-react"

/*
 * The dashboard's Catalog card: a row of the home page's model cards beside
 * (or above) the card's own title.
 *
 * The pictures and the text never overlap. An earlier version laid the
 * pictures across the whole card and darkened them under the text, which
 * blacked out whichever frame sat on the left. Now the card measures its own
 * width and picks one of two layouts:
 *
 *   wide (640px+)  text on the left, frames in their own area on the right
 *   narrow         frames as a band across the top, text underneath
 *
 * With `fillHeight` the card is given its height (the dashboard's fixed-height
 * launcher row from xl) instead of growing to its content: the text-beside
 * layout then holds down to 440px wide, and the stacked layout's frames are
 * capped to the height left above the text, so neither overflows the row.
 *
 * Frames keep the model cards' own shape - 4:3, or 3:4 for the portrait cards
 * (TALL_CARDS) - at one shared height, and nothing is laid over them. A frame's
 * width eases to the new shape when a portrait card cycles in or out.
 *
 * They cycle through every model card that has a picture or clip, one frame
 * at a time and at most one swap every SWAP_MS, with at least one video playing
 * whenever there is one: a frame holding the only video on show is only
 * replaced by another video. A frame stays up at least MIN_SHOW_MS, and a video
 * also until it has played through once - the card ads run 10-30s, far past a
 * picture's turn. A video that can't play (autoplay refused, say) gives way
 * after its length plus a margin, so it never holds a frame for good.
 */

export type CatalogMedia = { name: string; url: string; type: string; tall?: boolean }

const SWAP_MS = 3500
/** The least time any frame stays up once it has appeared. */
const MIN_SHOW_MS = 6000
/** A video that hasn't finished by its length plus this is let go anyway. */
const STALL_GRACE_MS = 4000
/** ...and one whose length never loaded, after this. */
const NO_META_MS = 45000
/** Narrower than this, a frame drops out rather than shrinking further. */
const MIN_FRAME_W = 150
const GAP = 6
const PAD = 8

/** The stacked layout's text row: py-3 around the 44px icon. */
const STACKED_TEXT_H = 68

export function CatalogCard({ media, fillHeight = false }: { media: CatalogMedia[]; fillHeight?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => { setW(e.contentRect.width); setH(e.contentRect.height) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stacked = w > 0 && w < (fillHeight ? 440 : 640)
  const hasMedia = media.length > 0

  let strip: React.ReactNode = null
  if (w > 0 && hasMedia) {
    if (stacked) {
      // Band across the top: as many 4:3 frames as fill the width exactly -
      // or, in a card of fixed height, as tall as the room above the text.
      const count = Math.min(media.length, w >= 420 ? 3 : 2)
      const byWidth = (w - PAD * 2 - GAP * (count - 1)) / count
      const frameW = fillHeight && h > 0 ? Math.min(byWidth, (h - STACKED_TEXT_H - PAD) * (4 / 3)) : byWidth
      strip = (
        <div className="flex justify-center px-2 pt-2">
          <CatalogFrames media={media} count={count} frameW={frameW} frameH={frameW * 0.75} />
        </div>
      )
    } else {
      /*
       * Beside the text: up to three frames. Each is as tall as the card allows,
       * but narrows (keeping 4:3) so three fit across; it drops to two or one
       * only if three would be smaller than MIN_FRAME_W.
       */
      const maxW = (Math.max(h, minSide(w)) - PAD * 2) * (4 / 3)
      const room = w - textWidth(w) - PAD * 2
      let count = Math.min(3, media.length)
      while (count > 1 && (room - GAP * (count - 1)) / count < MIN_FRAME_W) count--
      const frameW = Math.min(maxW, (room - GAP * (count - 1)) / count)
      const frameH = frameW * 0.75
      strip = (
        <div className="flex-1 min-w-0 flex items-center justify-end p-2">
          <CatalogFrames media={media} count={count} frameW={frameW} frameH={frameH} />
        </div>
      )
    }
  }

  const text = (
    <div
      className={stacked ? "flex items-center gap-3 px-3.5 py-3" : "shrink-0 flex flex-col justify-center gap-2.5 px-4 sm:px-5 py-3.5"}
      style={stacked || w === 0 ? undefined : { width: textWidth(w) }}
    >
      {/* flex-1 only in the stacked band - beside the frames it pushed the
          button to the foot of a tall card (the dashboard row grew 2026-10-08) */}
      <div className={`flex items-center gap-3 min-w-0 ${stacked ? "flex-1" : ""}`}>
        <div className="w-11 h-11 shrink-0 rounded-[13px] border border-white/15 bg-white/[0.06] flex items-center justify-center">
          <LayoutGrid size={19} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 leading-none mb-1">Home</p>
          <p className={`text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-tight ${fillHeight && !stacked ? "xl:text-xl 2xl:text-2xl" : ""}`}>Catalog</p>
          <p className="text-[11px] sm:text-xs text-slate-400 leading-snug line-clamp-2 mt-0.5 [@media(max-height:460px)]:hidden">
            Browse every model and studio, and see what&apos;s featured.
          </p>
        </div>
      </div>
      <span className={`${stacked ? "self-center" : "self-start"} shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 border border-white/25 text-white text-xs font-bold group-hover:bg-white/15 group-hover:border-white/40 transition-all`}>
        Open Home <ArrowRight size={13} />
      </span>
    </div>
  )

  return (
    <div
      ref={ref}
      className={`relative h-full ${stacked ? "flex flex-col" : "flex items-stretch"}`}
      style={!stacked && w > 0 ? { minHeight: minSide(w) } : { minHeight: 104 }}
    >
      {stacked ? <>{strip}{text}</> : <>{text}{strip}</>}
    </div>
  )
}

/** The card's least height in the wide layout. */
const minSide = (w: number) => (w >= 900 ? 168 : 140)

/** The text column's width in the wide layout. */
const textWidth = (w: number) => (w >= 900 ? 260 : 240)

/** What a frame is showing, for deciding when it may be swapped. */
type SlotState = { name: string; since: number; played: boolean; durMs: number | null }

function CatalogFrames({ media, count, frameH }: {
  media: CatalogMedia[]
  count: number
  frameW: number
  frameH: number
}) {
  const [shown, setShown] = useState<string[]>([])
  const shownRef = useRef(shown)
  shownRef.current = shown
  const slots = useRef<SlotState[]>([])
  const nextIdx = useRef(0)
  const nextSlot = useRef(0)
  const lastSwap = useRef(0)
  const byName = new Map(media.map(m => [m.name, m]))
  const isVideo = (name: string) => byName.get(name)?.type === "video"
  const fresh = (name: string): SlotState => ({ name, since: Date.now(), played: false, durMs: null })

  // First set: a video if there is one, then the rest in order.
  useEffect(() => {
    const firstVideo = media.find(m => m.type === "video")
    const picks: string[] = firstVideo ? [firstVideo.name] : []
    for (const m of media) {
      if (picks.length >= count) break
      if (!picks.includes(m.name)) picks.push(m.name)
    }
    // The video in the middle of three reads best.
    if (firstVideo && picks.length === 3) picks.splice(0, 2, picks[1], picks[0])
    setShown(picks)
    slots.current = picks.map(fresh)
    nextIdx.current = Math.max(...picks.map(n => media.findIndex(m => m.name === n))) + 1
    nextSlot.current = 0
    lastSwap.current = Date.now()
  }, [count, media])

  /** May this frame be replaced yet? */
  const ready = (slot: number, now: number) => {
    const st = slots.current[slot]
    if (!st) return true
    const age = now - st.since
    if (age < MIN_SHOW_MS) return false
    if (!isVideo(st.name) || st.played) return true
    // Not finished: wait for it, unless it has plainly stalled
    return st.durMs != null ? age > st.durMs + STALL_GRACE_MS : age > NO_META_MS
  }

  // One frame at a time, round the slots, through the whole list - skipping
  // any frame whose picture hasn't had its turn or whose video hasn't finished.
  useEffect(() => {
    if (media.length <= count) return
    const t = setInterval(() => {
      const now = Date.now()
      if (document.hidden || now - lastSwap.current < SWAP_MS) return
      const vis = [...shownRef.current]
      for (let attempt = 0; attempt < vis.length; attempt++) {
        const slot = (nextSlot.current + attempt) % vis.length
        if (!ready(slot, now)) continue
        const needVideo = isVideo(vis[slot]) && vis.filter(isVideo).length === 1
        for (let k = 0; k < media.length; k++) {
          const i = (nextIdx.current + k) % media.length
          const m = media[i]
          if (vis.includes(m.name) || (needVideo && m.type !== "video")) continue
          vis[slot] = m.name
          slots.current[slot] = fresh(m.name)
          nextIdx.current = i + 1
          nextSlot.current = slot + 1
          lastSwap.current = now
          setShown(vis)
          return
        }
      }
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, media])

  // Reports from a frame's video, matched by name so a layer still fading out
  // can't speak for the one replacing it.
  const onVideo = (slot: number, name: string, ev: { durMs?: number; ended?: boolean }) => {
    const st = slots.current[slot]
    if (!st || st.name !== name) return
    if (ev.durMs != null) st.durMs = ev.durMs
    if (ev.ended) st.played = true
  }

  return (
    <div className="flex" style={{ gap: GAP }}>
      {shown.map((name, i) => {
        const m = byName.get(name)
        return m ? (
          <div
            key={i}
            className="relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0a0f1a]"
            // One height for every frame; the width follows the card's shape
            style={{ width: frameH * (m.tall ? 3 / 4 : 4 / 3), height: frameH, transition: "width 700ms ease-in-out" }}
          >
            <Frame media={m} onVideo={ev => onVideo(i, m.name, ev)} />
          </div>
        ) : null
      })}
    </div>
  )
}

type VideoEvent = { durMs?: number; ended?: boolean }

/** One frame: the new picture fades in over the old, which is then dropped. */
function Frame({ media, onVideo }: { media: CatalogMedia; onVideo: (ev: VideoEvent) => void }) {
  const [stack, setStack] = useState<CatalogMedia[]>([media])
  useEffect(() => {
    setStack(prev => (prev[prev.length - 1]?.url === media.url ? prev : [...prev.slice(-1), media]))
    const t = setTimeout(() => setStack(prev => prev.slice(-1)), 1100)
    return () => clearTimeout(t)
  }, [media])
  return <>{stack.map((m, i) => <Layer key={m.url} media={m} fadeIn={i > 0} onVideo={m.url === media.url ? onVideo : undefined} />)}</>
}

function Layer({ media, fadeIn, onVideo }: { media: CatalogMedia; fadeIn: boolean; onVideo?: (ev: VideoEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (fadeIn) ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: "ease-in-out", fill: "both" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div ref={ref} className="absolute inset-0 bg-[#0a0f1a]">
      {media.type === "video" ? (
        <video
          src={media.url}
          autoPlay
          muted
          playsInline
          preload="auto"
          // The muted PROPERTY, not just the attribute: without it browsers block the autoplay.
          ref={el => { if (el) { el.muted = true; el.play().catch(() => {}) } }}
          onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d)) onVideo?.({ durMs: d * 1000 }) }}
          // No loop attribute: 'ended' marks the first full play, and the
          // video then starts over by hand so it keeps playing until swapped.
          onEnded={e => { onVideo?.({ ended: true }); const v = e.currentTarget; v.currentTime = 0; v.play().catch(() => {}) }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
    </div>
  )
}
