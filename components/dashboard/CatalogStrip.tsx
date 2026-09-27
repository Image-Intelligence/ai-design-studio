"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

/*
 * The picture strip behind the dashboard's Catalog card.
 *
 * The home page's model cards are framed 4:3 (landscape). An earlier version
 * sliced five of them into thin portrait columns, which showed a narrow band
 * of each. This shows two or three at their own 4:3 shape instead - sized
 * from the card's height, as many as fit its width - lined up on the right,
 * where the card's text does not cover them.
 *
 * It cycles through every model card that has a picture or clip, one frame
 * at a time, with at least one video playing whenever there is one: a frame
 * holding the only video on show is only ever replaced by another video.
 */

export type CatalogMedia = { name: string; url: string; type: string }

const SWAP_MS = 3500

export function CatalogStrip({ media }: { media: CatalogMedia[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [shown, setShown] = useState<string[]>([])
  const shownRef = useRef(shown)
  shownRef.current = shown
  const nextIdx = useRef(0)
  const nextSlot = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const slotW = size.h * (4 / 3)
  const count = slotW > 0 ? Math.min(media.length, 3, Math.max(2, Math.floor((size.w * 0.9) / slotW))) : 0
  const byName = new Map(media.map(m => [m.name, m]))
  const isVideo = (name: string) => byName.get(name)?.type === "video"

  // First set: a video if there is one, then the rest in order.
  useEffect(() => {
    if (count === 0) { setShown([]); return }
    const firstVideo = media.find(m => m.type === "video")
    const picks: string[] = firstVideo ? [firstVideo.name] : []
    for (const m of media) {
      if (picks.length >= count) break
      if (!picks.includes(m.name)) picks.push(m.name)
    }
    // The video in the middle of three, or last of two, reads best against the text.
    if (firstVideo && picks.length === 3) picks.splice(0, 2, picks[1], picks[0])
    setShown(picks)
    const lastUsed = Math.max(...picks.map(n => media.findIndex(m => m.name === n)))
    nextIdx.current = lastUsed + 1
    nextSlot.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, media])

  // One frame at a time, round the slots, through the whole list.
  useEffect(() => {
    if (count === 0 || media.length <= count) return
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
    <div ref={ref} className="absolute inset-0 flex justify-end gap-1 pointer-events-none">
      {shown.map((name, i) => {
        const m = byName.get(name)
        return m ? (
          <div key={i} className="relative h-full shrink-0 overflow-hidden" style={{ width: slotW }}>
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
  return (
    <>
      {stack.map((m, i) => <Layer key={m.url} media={m} fadeIn={i > 0} />)}
    </>
  )
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
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
      )}
    </div>
  )
}
