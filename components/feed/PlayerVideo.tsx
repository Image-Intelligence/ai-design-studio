"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from "react"
import { Loader2, RotateCw, VolumeX } from "lucide-react"

/**
 * The video in a viewer (the portal's video popup, My Generations' preview) -
 * built so a click always ends in a playing video, never a black box that
 * needs a page refresh (owner, 2026-10-16):
 *
 * - The tile's still is the poster, so the first frame shows at once instead
 *   of black while the file starts downloading.
 * - A spinner shows while it loads and whenever it stalls to buffer.
 * - It asks to play with sound; a browser that refuses that (Safari / iOS
 *   without a fresh tap) gets the same video muted, with a "Tap for sound"
 *   button, instead of sitting paused.
 * - A link that no longer works (signed links last 12 hours - a tab left open
 *   overnight) is swapped once for a freshly signed one from
 *   /api/images/[id]?stream=1; only if that fails too does it show Retry.
 *
 * The <video> element itself is the caller's through `videoRef` (sizing, the
 * orbit frame), and `onLoadedMetadata` passes through.
 */
export function PlayerVideo({ src, rowId, poster, className, style, videoRef, loop = true, onLoadedMetadata }: {
  src: string
  /** The feed row - lets a dead link be re-signed without a reload (own rows only) */
  rowId?: number
  poster?: string
  className?: string
  style?: CSSProperties
  videoRef?: Ref<HTMLVideoElement>
  loop?: boolean
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
}) {
  const el = useRef<HTMLVideoElement | null>(null)
  const [cur, setCur] = useState(src)
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const [mutedByBrowser, setMutedByBrowser] = useState(false)
  const refreshed = useRef(false)

  // A new video: start over
  useEffect(() => { setCur(src); setBusy(true); setFailed(false); setMutedByBrowser(false); refreshed.current = false }, [src])

  const setRefs = useCallback((node: HTMLVideoElement | null) => {
    el.current = node
    if (typeof videoRef === "function") videoRef(node)
    else if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = node
  }, [videoRef])

  /** Play with sound if allowed, else muted (the user can turn it up) */
  const start = useCallback(() => {
    const v = el.current
    if (!v) return
    v.muted = false
    v.play().catch(err => {
      if (err?.name !== "NotAllowedError" || !el.current) return
      el.current.muted = true
      setMutedByBrowser(true)
      el.current.play().catch(() => {})
    })
  }, [])

  useEffect(() => { start() }, [cur, start])

  const onError = () => {
    // The link may have expired - ask for a freshly signed one, once
    if (rowId && rowId > 0 && !refreshed.current) {
      refreshed.current = true
      setCur(`/api/images/${rowId}?stream=1&t=${Date.now()}`)
      return
    }
    setBusy(false)
    setFailed(true)
  }

  const retry = () => {
    refreshed.current = false
    setFailed(false)
    setBusy(true)
    setCur(rowId && rowId > 0 ? `/api/images/${rowId}?stream=1&t=${Date.now()}` : `${src}${src.includes("?") ? "&" : "?"}r=${Date.now()}`)
  }

  return (
    <>
      <video
        key={cur}
        ref={setRefs}
        src={cur}
        poster={poster}
        controls
        loop={loop}
        playsInline
        preload="auto"
        className={className}
        style={style}
        onLoadedMetadata={onLoadedMetadata}
        onLoadStart={() => setBusy(true)}
        onWaiting={() => setBusy(true)}
        onCanPlay={() => setBusy(false)}
        onPlaying={() => setBusy(false)}
        onError={onError}
        onVolumeChange={e => { if (!e.currentTarget.muted) setMutedByBrowser(false) }}
      />
      {busy && !failed && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="rounded-full bg-black/55 p-3 backdrop-blur-sm"><Loader2 size={26} className="animate-spin text-white/90" /></span>
        </div>
      )}
      {mutedByBrowser && !failed && (
        <button
          onClick={() => { const v = el.current; if (v) { v.muted = false; v.play().catch(() => {}) } setMutedByBrowser(false) }}
          className="absolute left-1/2 top-3 z-20 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm hover:bg-black/85"
        >
          <VolumeX size={14} /> Tap for sound
        </button>
      )}
      {failed && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
          <p className="text-[13px] text-slate-300">This video didn&apos;t load.</p>
          <button onClick={retry} className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/20">
            <RotateCw size={14} /> Try again
          </button>
        </div>
      )}
    </>
  )
}
