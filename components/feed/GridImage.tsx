"use client"

import { useState } from "react"
import { Check } from "lucide-react"

// Feed tile for the my-generations page. Copied from the portal-v2 GridImage
// (minus the admin cross-user thumbnail branch — this feed only shows the signed-in
// user's own images, served by /api/images/[id]).

export function GridImage({
  src, alt, onClick, imageId, directUrl, thumbUrl, aspectRatio,
  fullRes = false, selectMode, selected, onSelect, fullWidth = false, isVideo = false,
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
  // Full Size mode: reserve the tile's height from the known ratio so images don't
  // shove the layout when they pop in. Null → natural height.
  const arCss = fullWidth && aspectRatio && aspectRatio !== "auto"
    ? aspectRatio.replace(":", "/").replace("x", "/")
    : null
  const handleClick = () => {
    if (selectMode && imageId !== undefined) { onSelect?.(imageId); return }
    onClick?.()
  }
  return (
    <div
      className={`${fullWidth ? "" : "aspect-square"} bg-slate-800 overflow-hidden relative ${fullWidth && !loaded && !arCss ? "min-h-40" : ""} ${onClick || selectMode ? "cursor-pointer group" : ""} ${selected ? "ring-2 ring-cyan-400 ring-inset" : ""}`}
      style={arCss ? { aspectRatio: arCss } : undefined}
      onClick={handleClick}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 animate-pulse" />
      )}
      {isVideo ? (
        <video
          src={`${fullSrc}${fullSrc.includes("#") ? "" : "#t=0.001"}`}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          className={`${fullWidth ? (arCss ? "w-full h-full object-cover" : "w-full h-auto block") : "w-full h-full object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-80 transition-opacity" : ""} ${selected ? "opacity-80" : ""}`}
        />
      ) : (
        <img
          src={fullWidth && fullRes ? fullSrc : thumbSrc}
          alt={alt}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`${fullWidth ? (arCss ? "w-full h-full object-cover" : "w-full h-auto block") : "w-full h-full object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-80 transition-opacity" : ""} ${selected ? "opacity-80" : ""}`}
        />
      )}
      {isVideo && loaded && (
        <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-[8px] font-mono text-white/70 pointer-events-none">VID</div>
      )}
      {selectMode && (
        <div className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${selected ? "bg-cyan-400 border-cyan-400" : "border-white/60 bg-black/40"}`}>
          {selected && <Check size={9} className="text-black" />}
        </div>
      )}
    </div>
  )
}
