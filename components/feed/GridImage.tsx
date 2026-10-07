"use client"

import { useRef, useState } from "react"
import { Check, Pause, Play } from "lucide-react"
import { AudioCardArt } from "@/components/home/AudioCardArt"

// Feed tile for the my-generations page. Copied from the portal-v2 GridImage
// (minus the admin cross-user thumbnail branch — this feed only shows the signed-in
// user's own images, served by /api/images/[id]).

export function GridImage({
  src, alt, onClick, imageId, directUrl, thumbUrl, aspectRatio, aspect,
  posterUrl, fullRes = false, selectMode, selected, onSelect, fullWidth = false, isVideo = false, audio,
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
  // audio: an Audio Studio clip - drawn as a waveform card that plays in place
  audio?: { title: string; label?: string | null }
}) {
  const [loaded, setLoaded] = useState(false)
  if (audio) return <AudioTile src={src} audio={audio} imageId={imageId} selectMode={selectMode} selected={selected} onSelect={onSelect} fullWidth={fullWidth} />
  // A saved row always shows its (pre-made, ~40KB) thumbnail, never the full
  // original - a 4K PNG is ~20MB (same rule as the portal's GridImage)
  const thumbSrc = thumbUrl
    ? thumbUrl
    : imageId && imageId > 0 ? `/api/images/${imageId}?thumb=1`
    : directUrl || src
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
      className={`${fullWidth ? "" : "aspect-square"} bg-slate-800/70 overflow-hidden relative ${fullWidth && !loaded && !arCss ? "min-h-40" : ""} ${onClick || selectMode ? "cursor-pointer group" : ""} ${selected ? "ring-2 ring-white/90 ring-inset" : ""}`}
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
          // Full Size quality = the 2048px display copy, not the (up to ~20MB)
          // original - same rule as the portal's GridImage
          src={poster ?? (fullWidth && fullRes ? (imageId && imageId > 0 && !isVideo ? `/api/images/${imageId}?display=tile` : fullSrc) : thumbSrc)}
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
        <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selected ? "bg-white border-white" : "border-white/60 bg-black/40"}`}>
          {selected && <Check size={11} className="text-black" />}
        </div>
      )}
    </div>
  )
}

/** An audio clip in the feed: waveform art, play/pause in place, model name. */
function AudioTile({ src, audio, imageId, selectMode, selected, onSelect, fullWidth }: {
  src: string
  audio: { title: string; label?: string | null }
  imageId?: number
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: number) => void
  fullWidth?: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const toggle = () => {
    if (selectMode && imageId !== undefined) { onSelect?.(imageId); return }
    const a = ref.current
    if (!a) return
    // One clip at a time
    document.querySelectorAll<HTMLAudioElement>("audio[data-feed]").forEach(o => { if (o !== a) o.pause() })
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }
  return (
    <div
      onClick={toggle}
      className={`${fullWidth ? "aspect-[4/3]" : "aspect-square"} relative overflow-hidden cursor-pointer group ${selected ? "ring-2 ring-white/90 ring-inset" : ""}`}
    >
      <AudioCardArt seed={`${audio.title}${imageId ?? ""}`} tint="text-sky-300" />
      <audio ref={ref} data-feed src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 border border-white/25 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
        {playing ? <Pause size={15} className="fill-white" /> : <Play size={15} className="fill-white ml-0.5" />}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <p className="text-[10px] font-bold text-white truncate">{audio.title}</p>
        {audio.label && <p className="text-[9px] uppercase tracking-wider text-sky-300/80">{audio.label}</p>}
      </div>
      {selectMode && (
        <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selected ? "bg-white border-white" : "border-white/60 bg-black/40"}`}>
          {selected && <Check size={11} className="text-black" />}
        </div>
      )}
    </div>
  )
}
