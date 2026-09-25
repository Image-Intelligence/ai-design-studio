"use client"

import { useState } from "react"
import { Check, Play } from "lucide-react"

// Feed tile for the my-generations page. Copied from the portal-v2 GridImage
// (minus the admin cross-user thumbnail branch — this feed only shows the signed-in
// user's own images, served by /api/images/[id]).

export function GridImage({
  src, alt, onClick, imageId, directUrl, thumbUrl, aspectRatio, aspect,
  posterUrl, fullRes = false, selectMode, selected, onSelect, fullWidth = false, isVideo = false,
}: {
  src: string
  alt: string
  onClick?: () => void
  imageId?: number
  directUrl?: string
  // thumbUrl: a pre-generated thumbnail on public R2 (CDN-cached) — used directly so
  // the feed skips the per-request resize + full-image download.
  thumbUrl?: string | null
  // aspectRatio: the image's known ratio ("2:3", "16:9", "1024x1536"…). In Full Size
  // mode it's applied up front so the tile's height is reserved before the image loads.
  aspectRatio?: string
  // aspect: the real width/height as a number (from the stored pixel size). Wins
  // over aspectRatio, which is "auto" for most images and so reserved nothing.
  aspect?: number | null
  // posterUrl: a video's stored poster frame. Drawn as an image, so the feed no
  // longer opens every video file just to show its first frame.
  posterUrl?: string | null
  // fullRes: in Full Size mode, load the full-resolution original instead of the thumb.
  fullRes?: boolean
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: number) => void
  // fullWidth (Full Size mode): show the entire image at its natural aspect ratio.
  fullWidth?: boolean
  // isVideo: render a muted <video> frame instead of <img>.
  isVideo?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const thumbSrc = thumbUrl
    ? thumbUrl
    : directUrl || (imageId ? `/api/images/${imageId}?thumb=1` : src)
  const fullSrc = directUrl || src
  // Full Size mode: reserve the tile's height from the known shape so images don't
  // shove the layout when they pop in. Null → natural height.
  const arCss = !fullWidth ? null
    : aspect && aspect > 0 ? String(aspect)
    : aspectRatio && aspectRatio !== "auto" ? aspectRatio.replace(":", "/").replace("x", "/")
    : null
  const handleClick = () => {
    if (selectMode && imageId !== undefined) { onSelect?.(imageId); return }
    onClick?.()
  }
  const mediaCls = `${fullWidth ? (arCss ? "w-full h-full object-cover" : "w-full h-auto block") : "w-full h-full object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-85" : ""} ${selected ? "opacity-80" : ""}`
  const poster = isVideo ? (posterUrl || thumbUrl || null) : null
  return (
    <div
      className={`${fullWidth ? "" : "aspect-square"} bg-slate-800/70 overflow-hidden relative ${fullWidth && !loaded && !arCss ? "min-h-40" : ""} ${onClick || selectMode ? "cursor-pointer group" : ""} ${selected ? "ring-2 ring-cyan-400 ring-inset" : ""}`}
      style={arCss ? { aspectRatio: arCss } : undefined}
      onClick={handleClick}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700/70 to-slate-800 animate-pulse" />
      )}
      {isVideo && !poster ? (
        <video
          src={`${fullSrc}${fullSrc.includes("#") ? "" : "#t=0.001"}`}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          className={mediaCls}
        />
      ) : (
        <img
          src={poster ?? (fullWidth && fullRes ? fullSrc : thumbSrc)}
          alt={alt}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={mediaCls}
        />
      )}
      {isVideo && loaded && (
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] font-semibold text-white/85 pointer-events-none">
          <Play size={8} className="fill-white/85" /> VIDEO
        </div>
      )}
      {selectMode && (
        <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selected ? "bg-cyan-400 border-cyan-400" : "border-white/60 bg-black/40"}`}>
          {selected && <Check size={11} className="text-black" />}
        </div>
      )}
    </div>
  )
}
