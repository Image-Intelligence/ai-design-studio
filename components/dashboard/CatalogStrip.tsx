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
 * Frames keep the model cards' 4:3 shape, and nothing is laid over them.
 * They cycle through every model card that has a picture or clip, one frame
 * at a time, with at least one video playing whenever there is one: a frame
 * holding the only video on show is only replaced by another video.
 */

export type CatalogMedia = { name: string; url: string; type: string }

const SWAP_MS = 3500
/** Narrower than this, a frame drops out rather than shrinking further. */
const MIN_FRAME_W = 150
const GAP = 6
const PAD = 8

export function CatalogCard({ media }: { media: CatalogMedia[] }) {
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

  const stacked = w > 0 && w < 640
  const hasMedia = media.length > 0

  let strip: React.ReactNode = null
  if (w > 0 && hasMedia) {
    if (stacked) {
      // Band across the top: as many 4:3 frames as fill the width exactly.
      const count = Math.min(media.length, w >= 420 ? 3 : 2)
      const frameW = (w - PAD * 2 - GAP * (count - 1)) / count
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
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-11 h-11 shrink-0 rounded-[13px] border border-white/15 bg-white/[0.06] flex items-center justify-center">
          <LayoutGrid size={19} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 leading-none mb-1">Home</p>
          <p className="text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-tight">Catalog</p>
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

function CatalogFrames({ media, count, frameW, frameH }: {
  media: CatalogMedia[]
  count: number
  frameW: number
  frameH: number
}) {
  const [shown, setShown] = useState<string[]>([])
  const shownRef = useRef(shown)
  shownRef.current = shown
  const nextIdx = useRef(0)
  const nextSlot = useRef(0)
  const byName = new Map(media.map(m => [m.name, m]))
  const isVideo = (name: string) => byName.get(name)?.type === "video"

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
    nextIdx.current = Math.max(...picks.map(n => media.findIndex(m => m.name === n))) + 1
    nextSlot.current = 0
  }, [count, media])

  // One frame at a time, round the slots, through the whole list.
  useEffect(() => {
    if (media.length <= count) return
    const t = setInterval(() => {
      if (document.hidden) return
      const vis = [...shownRef.current]
      for (let attempt = 0; attempt < vis.length; attempt++) {
        const slot = (nextSlot.current + attempt) % vis.length
        const needVideo = isVideo(vis[slot]) && vis.filter(isVideo).length === 1
        for (let k = 0; k < media.length; k++) {
          const i = (nextIdx.current + k) % media.length
          const m = media[i]
          if (vis.includes(m.name) || (needVideo && m.type !== "video")) continue
          vis[slot] = m.name
          nextIdx.current = i + 1
          nextSlot.current = slot + 1
          setShown(vis)
          return
        }
      }
    }, SWAP_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, media])

  return (
    <div className="flex" style={{ gap: GAP }}>
      {shown.map((name, i) => {
        const m = byName.get(name)
        return m ? (
          <div key={i} className="relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0a0f1a]" style={{ width: frameW, height: frameH }}>
            <Frame media={m} />
          </div>
        ) : null
      })}
    </div>
  )
}

/** One frame: the new picture fades in over the old, which is then dropped. */
function Frame({ media }: { media: CatalogMedia }) {
  const [stack, setStack] = useState<CatalogMedia[]>([media])
  useEffect(() => {
    setStack(prev => (prev[prev.length - 1]?.url === media.url ? prev : [...prev.slice(-1), media]))
    const t = setTimeout(() => setStack(prev => prev.slice(-1)), 1100)
    return () => clearTimeout(t)
  }, [media])
  return <>{stack.map((m, i) => <Layer key={m.url} media={m} fadeIn={i > 0} />)}</>
}

function Layer({ media, fadeIn }: { media: CatalogMedia; fadeIn: boolean }) {
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
          loop
          playsInline
          preload="auto"
          // The muted PROPERTY, not just the attribute: without it browsers block the autoplay.
          ref={el => { if (el) { el.muted = true; el.play().catch(() => {}) } }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
    </div>
  )
}
