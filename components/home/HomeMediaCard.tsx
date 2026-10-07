"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, Trash2, Loader2, Film, Image as ImageIcon, Play, Pause } from "lucide-react"
import { FrameModal } from "./FrameModal"
import { SilverRimOverlay } from "./SilverRimOverlay"
import { registerCardVideo, type CardVideoHandle } from "./card-video-scheduler"

export type CardMedia = { mediaUrl: string; mediaType: string }

// Fade between a card's still and its video (ms). The video stays mounted until
// the still has fully covered it again, so the hand-back is a crossfade.
const FADE_MS = 500

/*
 * Card samples share ONE audio element, so starting a sample stops whatever
 * was playing. Listeners let each button show whether it is the one playing.
 */
let samplePlayer: HTMLAudioElement | null = null
const sampleListeners = new Set<() => void>()
function playSample(url: string) {
  if (!samplePlayer) {
    samplePlayer = new Audio()
    const notify = () => sampleListeners.forEach(f => f())
    samplePlayer.addEventListener("play", notify)
    samplePlayer.addEventListener("pause", notify)
    samplePlayer.addEventListener("ended", notify)
  }
  if (samplePlayer.src === url && !samplePlayer.paused) { samplePlayer.pause(); return }
  if (samplePlayer.src !== url) samplePlayer.src = url
  samplePlayer.currentTime = 0
  samplePlayer.play().catch(() => {})
}
function SamplePlayButton({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const f = () => setPlaying(!!samplePlayer && samplePlayer.src === url && !samplePlayer.paused)
    sampleListeners.add(f)
    return () => { sampleListeners.delete(f) }
  }, [url])
  return (
    <button
      onClick={e => { e.stopPropagation(); playSample(url) }}
      title={playing ? "Stop the sample" : "Play a sample"}
      className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/55 border border-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-lg hover:bg-black/75 hover:scale-105 transition-all"
    >
      {playing ? <Pause size={16} className="fill-white" /> : <Play size={16} className="fill-white ml-0.5" />}
    </button>
  )
}

// A single home-page section card. Admin-uploaded image/video fills it (cover);
// otherwise a themed gradient placeholder. The whole card is clickable (onClick or
// href); admin upload/remove controls float on top and stop propagation so they
// don't trigger the card's navigation.
export function HomeMediaCard({
  cardKey,
  title,
  subtitle,
  accent = "text-white",
  cost,
  media,
  isAdmin,
  onClick,
  href,
  onMediaChange,
  className = "",
  aspect = "aspect-[4/3]",
  frameAspect = 4 / 3,
  badge,
  altMedia,
  tall = false,
  placeholder,
  sampleUrl,
  nameInArt = false,
  contain = false,
}: {
  cardKey: string
  title: string
  subtitle?: string
  accent?: string
  cost?: string
  media?: CardMedia | null
  isAdmin: boolean
  onClick?: () => void
  href?: string
  onMediaChange?: (key: string, media: CardMedia | null) => void
  className?: string
  aspect?: string
  frameAspect?: number
  /** Top-left, always visible (the admin controls take top-right on hover). */
  badge?: React.ReactNode
  /**
   * The card's still already shows the name (the model cards' title art), so
   * the printed name stays tucked away over the still: it rises while the
   * card's video plays, sinks back with the still, and shows on hover. The
   * company line and the price tag always show. A card with no picture yet
   * shows its name as usual.
   */
  nameInArt?: boolean
  /**
   * Show the whole picture inside the card's frame (over a blurred, enlarged
   * copy of itself) instead of cropping it to fill - a portrait card's art in
   * a landscape slot, as in the Featured shortcuts.
   */
  contain?: boolean
  /**
   * The card's alternative (stored under "<cardKey>::alt"): the still of an
   * animated card, or the animation of a still one. A card with both shows the
   * still and plays the video in its turn of the page-wide cycle, whichever
   * slot each is in; the admin toggle swaps the slots (so Replace/Remove act
   * on the other one).
   */
  altMedia?: CardMedia | null
  /**
   * A portrait card for a grid of landscape ones: it fills the height of the
   * cell it is given (two grid rows) instead of taking a fixed aspect, with the
   * media covering it and the title floating over it like every other card.
   * Two 4:3 rows are a little taller than 3:4, so 3:4 media loses a sliver at
   * each side.
   */
  tall?: boolean
  /** Shown when the card has no media (audio cards draw a waveform). */
  placeholder?: React.ReactNode
  /** A short clip the card can play in place, without opening the model. */
  sampleUrl?: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null) // image awaiting framing
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // The card's two faces, wherever they are stored: the main slot or "::alt"
  // (the admin swap only decides which one Replace/Remove act on).
  const isVideo = media?.mediaType === "video"
  const video = isVideo ? media : altMedia?.mediaType === "video" ? altMedia : null
  const fit = contain ? "object-contain" : "object-cover"
  const still = media?.mediaType === "image" && media.mediaUrl ? media : altMedia?.mediaType === "image" && altMedia.mediaUrl ? altMedia : null

  // Its turn in the page-wide cycle (card-video-scheduler): `live` mounts the
  // video, `shown` fades the still off it once it is really playing, and each
  // turn bumps `turn` so a video still mounted from the last one restarts.
  const [live, setLive] = useState(false)
  const [shown, setShown] = useState(false)
  const [turn, setTurn] = useState(0)
  const handleRef = useRef<CardVideoHandle | null>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el || !video?.mediaUrl) return
    let unmount: ReturnType<typeof setTimeout> | null = null
    const handle = registerCardVideo(el, {
      start: () => {
        if (unmount) clearTimeout(unmount)
        setLive(true)
        setTurn(t => t + 1)
      },
      stop: () => {
        setShown(false)
        if (unmount) clearTimeout(unmount)
        unmount = setTimeout(() => setLive(false), FADE_MS + 50)
      },
    })
    handleRef.current = handle
    return () => {
      if (unmount) clearTimeout(unmount)
      handle.unregister()
      handleRef.current = null
      setLive(false)
      setShown(false)
    }
  }, [video?.mediaUrl])

  // Each turn: from the top, muted (the property - React's attribute is
  // unreliable, and desktop browsers refuse unmuted autoplay).
  useEffect(() => {
    const v = videoRef.current
    if (!live || !v || !turn) return
    v.muted = true
    v.currentTime = 0
    // The promise settles when playback really begins - covers a restart of a
    // video that was still running, which fires no fresh "playing" event.
    v.play()
      ?.then(() => { setShown(true); handleRef.current?.started() })
      .catch((e: unknown) => handleRef.current?.failed((e as DOMException)?.name === "NotAllowedError"))
  }, [live, turn])

  const onVideoEnded = () => {
    const v = videoRef.current
    if (v && handleRef.current?.ended()) {
      v.currentTime = 0 // a short clip goes round again until the minimum is up
      v.play()?.catch(() => handleRef.current?.failed())
    }
  }

  const activate = () => {
    if (onClick) onClick()
    else if (href) router.push(href)
  }

  // Uploads go through our server (not a browser→R2 PUT) — the R2 bucket's CORS
  // policy blocks direct browser uploads. The server streams the bytes to R2.

  // Framed image → base64 JSON.
  const saveImage = async (dataUrl: string): Promise<boolean> => {
    setUploading(true)
    setError(false)
    try {
      const res = await fetch("/api/admin/home-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: cardKey, image: dataUrl }),
      })
      if (!res.ok) throw new Error("save")
      const { card } = await res.json()
      onMediaChange?.(cardKey, { mediaUrl: card.mediaUrl, mediaType: card.mediaType })
      return true
    } catch {
      setError(true)
      return false
    } finally {
      setUploading(false)
    }
  }

  // Video → multipart file upload.
  const uploadVideo = async (file: File) => {
    setUploading(true)
    setError(false)
    try {
      const form = new FormData()
      form.append("key", cardKey)
      form.append("file", file)
      const res = await fetch("/api/admin/home-cards", { method: "POST", body: form })
      if (!res.ok) throw new Error("upload")
      const { card } = await res.json()
      onMediaChange?.(cardKey, { mediaUrl: card.mediaUrl, mediaType: card.mediaType })
    } catch {
      setError(true)
    } finally {
      setUploading(false)
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.type.startsWith("image/")) {
      // Images go through the framing modal first (like the profile picture upload).
      const reader = new FileReader()
      reader.onload = () => setFrameSrc(reader.result as string)
      reader.readAsDataURL(file)
    } else if (file.type.startsWith("video/")) {
      // Videos can't be canvas-framed — upload raw; the card fills them via cover.
      uploadVideo(file)
    }
  }

  // Framing confirmed → upload the framed JPEG data URL.
  const onFrameConfirm = async (dataUrl: string) => {
    const ok = await saveImage(dataUrl)
    if (ok) setFrameSrc(null)
  }

  // Swap the card's main and "::alt" slots. Both faces show either way (the
  // still, then the video in its turn); this only changes which one Replace
  // and Remove act on.
  const onSwap = async () => {
    setUploading(true)
    setError(false)
    try {
      const res = await fetch("/api/admin/home-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: cardKey, action: "swap" }),
      })
      if (!res.ok) throw new Error("swap")
      const { card, alt } = await res.json()
      onMediaChange?.(cardKey, { mediaUrl: card.mediaUrl, mediaType: card.mediaType })
      onMediaChange?.(`${cardKey}::alt`, { mediaUrl: alt.mediaUrl, mediaType: alt.mediaType })
    } catch {
      setError(true)
    } finally {
      setUploading(false)
    }
  }

  const onRemove = async () => {
    // Removing deletes the file too, so it is one click from gone: ask first.
    if (!window.confirm(`Remove the ${media?.mediaType === "video" ? "video" : "image"} from "${title}"? The file is deleted.`)) return
    setUploading(true)
    try {
      await fetch(`/api/admin/home-cards?key=${encodeURIComponent(cardKey)}`, { method: "DELETE" })
      onMediaChange?.(cardKey, null)
    } catch {}
    finally { setUploading(false) }
  }

  return (
    <div
      ref={cardRef}
      onClick={activate}
      className={`group relative ${tall ? "h-full min-h-[240px]" : aspect} rounded-2xl overflow-hidden border border-white/10 bg-slate-900 cursor-pointer transition-all hover:border-white/25 hover:shadow-xl hover:shadow-black/40 ${className}`}
    >
      {/* Media */}
      <div className="absolute inset-0">
      {contain && (still?.mediaUrl || (media?.mediaType === "image" && media.mediaUrl)) && (
        // The fill behind a contained picture: the same still, enlarged and blurred
        // eslint-disable-next-line @next/next/no-img-element
        <img src={(still?.mediaUrl ?? media?.mediaUrl)!} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-60" />
      )}
      {video ? (
        <>
          {/* The video exists only during the card's turn. */}
          {live && (
            <video
              ref={videoRef}
              src={video.mediaUrl}
              muted
              playsInline
              preload="auto"
              onPlaying={() => { setShown(true); handleRef.current?.started() }}
              onWaiting={() => handleRef.current?.stalled()}
              onEnded={onVideoEnded}
              onError={() => handleRef.current?.failed()}
              className={`absolute inset-0 w-full h-full ${fit}`}
            />
          )}
          {/* The still covers it whenever it is not playing. */}
          <div
            className="absolute inset-0 transition-opacity ease-out"
            style={{ opacity: shown ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
          >
            {still ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={still.mediaUrl} alt={title} className={`absolute inset-0 w-full h-full ${fit}`} />
            ) : (
              // No still uploaded: the video's first frame stands in (#t=0.001
              // renders it without playing).
              <video src={`${video.mediaUrl}#t=0.001`} muted playsInline preload="metadata" className={`absolute inset-0 w-full h-full ${fit}`} />
            )}
          </div>
        </>
      ) : media?.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.mediaUrl} alt={title} className={`absolute inset-0 w-full h-full ${fit}`} />
      ) : placeholder ? (
        placeholder
      ) : (
        // Branded placeholder — silver gradient wordmark instead of a bare tint
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] via-transparent to-black/50 flex items-center justify-center">
          <span
            className="px-3 text-center text-[10px] font-black tracking-[0.25em] uppercase text-transparent bg-clip-text opacity-40"
            style={{ backgroundImage: "linear-gradient(100deg,#94a3b8,#f8fafc,#cbd5e1,#e2e8f0,#94a3b8)" }}
          >
            AI Design Studio
          </span>
        </div>
      )}

      {/* Legibility scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      </div>

      {/* Hover sheen — the site's travelling band of silver light */}
      <span
        className="absolute inset-y-0 left-0 w-1/3 z-10 bg-gradient-to-r from-transparent via-white/[0.09] to-transparent pointer-events-none opacity-0 group-hover:opacity-100"
        style={{ animation: "sheen-sweep 2.4s infinite" }}
      />

      {/* Animated silver rim */}
      <SilverRimOverlay />

      {badge && <div className="absolute top-2 left-2 z-20 pointer-events-none">{badge}</div>}

      {sampleUrl && <SamplePlayButton url={sampleUrl} />}

      {/* Foreground label */}
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {nameInArt && (media?.mediaUrl || altMedia?.mediaUrl) ? (
            // Collapsed to no height over the still (the art names the model);
            // open while the video plays or on hover. A grid row animates
            // height without measuring it.
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100 ${shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
            >
              <p className="overflow-hidden text-sm font-bold tracking-tight truncate drop-shadow text-white">{title}</p>
            </div>
          ) : (
            <p className="text-sm font-bold tracking-tight truncate drop-shadow text-white">{title}</p>
          )}
          {subtitle && <p className="text-[11px] text-white/60 truncate">{subtitle}</p>}
        </div>
        {cost && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-black/60 border border-white/15 text-[10px] font-mono text-slate-200">{cost}</span>
        )}
      </div>

      {/* Admin media controls */}
      {isAdmin && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPick} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={media?.mediaUrl ? "Replace media" : "Upload media"}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border border-white/15 text-[10px] text-white hover:bg-black/90 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {media?.mediaUrl ? "Replace" : "Upload"}
          </button>
          {media?.mediaUrl && altMedia?.mediaUrl && !uploading && (
            <button
              onClick={onSwap}
              title={isVideo ? "Replace/Remove act on the video - switch them to the still" : "Replace/Remove act on the still - switch them to the video"}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border border-white/15 text-[10px] text-white hover:bg-black/90 transition-colors"
            >
              {isVideo ? <ImageIcon size={11} /> : <Film size={11} />}
              {isVideo ? "Edit still" : "Edit video"}
            </button>
          )}
          {media?.mediaUrl && !uploading && (
            <button
              onClick={onRemove}
              title="Remove media"
              className="p-1 rounded-md bg-black/70 border border-white/15 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-500/80 text-[9px] text-white">Upload failed</div>
      )}

      {/* Image framing modal (portaled to body) */}
      {frameSrc && (
        <div onClick={e => e.stopPropagation()}>
          <FrameModal
            src={frameSrc}
            aspect={frameAspect}
            uploading={uploading}
            onCancel={() => { if (!uploading) setFrameSrc(null) }}
            onConfirm={onFrameConfirm}
          />
        </div>
      )}
    </div>
  )
}
