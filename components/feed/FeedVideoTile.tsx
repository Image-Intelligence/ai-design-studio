"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { registerCardVideo, type CardVideoHandle } from "@/components/home/card-video-scheduler"

/*
 * A video in the My Generations feed (2026-10-07) - the studio feed's video
 * tile (portal-v2 VideoTile), so both feeds behave the same:
 *
 * PLAYBACK. Every tile shows its STILL. Only the few tiles holding a turn in
 * the shared cycle (components/home/card-video-scheduler) mount a <video> at
 * all: it plays through (a short clip loops to a minimum), fades back to the
 * still, and the turn moves on to the next tile on screen - so as you scroll,
 * what is in view is what plays. How many play at once follows the device
 * (phone 3, tablet 5, desktop 8) and drops when videos stall, so a page of
 * videos never asks a phone for more decoders than it has.
 *
 * SHAPE. The stored aspect ratio is unreliable for videos (the save path long
 * recorded 16:9 for everything), so in Full Size the tile measures the real
 * picture from its still or metadata - remembered with the video it came
 * from - and takes that shape.
 */
const TILE_FADE_MS = 400

export function FeedVideoTile({ videoSrc, stillSrc, natural, initialAspect, className, children }: {
  videoSrc: string
  /** The poster shown while the tile isn't playing; none (or a failed one) falls back to the first frame. */
  stillSrc?: string | null
  /** Full Size: take the measured shape. Otherwise the grid's square crop. */
  natural: boolean
  /** The shape to reserve before anything is measured (CSS aspect-ratio, e.g. "9/16"). */
  initialAspect?: string | null
  className?: string
  children?: ReactNode
}) {
  const [measuredFor, setMeasuredFor] = useState<{ src: string; ar: string } | null>(null)
  const measured = measuredFor && measuredFor.src === videoSrc ? measuredFor.ar : null
  const measure = (w: number, h: number) => { if (natural && w > 0 && h > 0) setMeasuredFor({ src: videoSrc, ar: `${w}/${h}` }) }
  const tileRef = useRef<HTMLDivElement>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const [loaded, setLoaded] = useState(false)

  // The still: a poster being made right now answers 503 (the server makes a
  // couple at a time), so a failed load retries before falling back to the first frame
  const [stillTry, setStillTry] = useState(0)
  const [stillFailed, setStillFailed] = useState(false)
  useEffect(() => { setStillTry(0); setStillFailed(false) }, [stillSrc])
  const onStillError = () => {
    if (stillTry >= 3) { setStillFailed(true); return }
    setTimeout(() => setStillTry(t => t + 1), 4000 + stillTry * 3000)
  }
  const stillUrl = stillSrc && !stillFailed
    ? stillTry ? `${stillSrc}${stillSrc.includes("?") ? "&" : "?"}r=${stillTry}` : stillSrc
    : null

  // Its turn: `live` mounts the video, `shown` fades the still off once it is
  // really playing, `turn` restarts a video that is still mounted
  const [live, setLive] = useState(false)
  const [shown, setShown] = useState(false)
  const [turn, setTurn] = useState(0)
  const handleRef = useRef<CardVideoHandle | null>(null)
  useEffect(() => {
    const el = tileRef.current
    if (!el) return
    let unmount: ReturnType<typeof setTimeout> | null = null
    const handle = registerCardVideo(el, {
      start: () => { if (unmount) clearTimeout(unmount); setLive(true); setTurn(t => t + 1) },
      stop: () => {
        setShown(false)
        if (unmount) clearTimeout(unmount)
        unmount = setTimeout(() => setLive(false), TILE_FADE_MS + 50)
      },
      // A viewer opened on top: hold this frame, then carry on from it
      pause: () => { vidRef.current?.pause() },
      resume: () => { vidRef.current?.play()?.catch(() => handleRef.current?.failed()) },
    })
    handleRef.current = handle
    return () => {
      if (unmount) clearTimeout(unmount)
      handle.unregister()
      handleRef.current = null
      setLive(false)
      setShown(false)
    }
  }, [videoSrc])

  // Each turn from the top, muted through the DOM property (React's attribute
  // is unreliable, and browsers refuse unmuted autoplay)
  useEffect(() => {
    const v = vidRef.current
    if (!live || !v || !turn) return
    v.muted = true
    v.currentTime = 0
    v.play()
      ?.then(() => { setShown(true); handleRef.current?.started() })
      .catch((e: unknown) => handleRef.current?.failed((e as DOMException)?.name === "NotAllowedError"))
  }, [live, turn])

  const onEnded = () => {
    const v = vidRef.current
    if (v && handleRef.current?.ended()) { v.currentTime = 0; v.play()?.catch(() => handleRef.current?.failed()) }
  }
  const src = videoSrc.includes("#") ? videoSrc : `${videoSrc}#t=0.001`
  const fit = natural ? "object-contain" : "object-cover"
  return (
    <div
      ref={tileRef}
      className={`relative overflow-hidden bg-black ${natural ? "" : "aspect-square"} ${className ?? ""}`}
      style={natural ? { aspectRatio: measured ?? initialAspect ?? "16/9" } : undefined}
    >
      {!loaded && <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700/70 to-slate-800 animate-pulse" />}
      {/* The video exists only during the tile's turn */}
      {live && (
        <video
          ref={vidRef}
          src={src}
          className={`absolute inset-0 w-full h-full pointer-events-none ${fit}`}
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={e => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          onPlaying={() => { setShown(true); handleRef.current?.started() }}
          onWaiting={() => handleRef.current?.stalled()}
          onEnded={onEnded}
          onError={() => handleRef.current?.failed()}
        />
      )}
      {/* The still covers it whenever it is not playing */}
      <div className="absolute inset-0 transition-opacity ease-out pointer-events-none" style={{ opacity: shown ? 0 : 1, transitionDuration: `${TILE_FADE_MS}ms` }}>
        {stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stillUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={`w-full h-full ${fit}`}
            onLoad={e => { setLoaded(true); measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) }}
            onError={onStillError}
          />
        ) : (
          // No usable poster: the first frame stands in (never played here)
          <video
            src={src}
            className={`w-full h-full ${fit}`}
            playsInline
            muted
            preload="metadata"
            onLoadedData={() => setLoaded(true)}
            onLoadedMetadata={e => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          />
        )}
      </div>
      {children}
    </div>
  )
}
