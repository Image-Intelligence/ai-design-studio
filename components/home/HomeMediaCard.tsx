"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, Trash2, Loader2, Film, Image as ImageIcon } from "lucide-react"
import { FrameModal } from "./FrameModal"
import { SilverRimOverlay } from "./SilverRimOverlay"

export type CardMedia = { mediaUrl: string; mediaType: string }

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
   * The card's alternative (stored under "<cardKey>::alt"), e.g. the still start
   * frame of an animated card. When present, admins get a toggle that swaps them.
   */
  altMedia?: CardMedia | null
  /**
   * A portrait card for a grid of landscape ones: it fills two grid rows, shows
   * its media in an exact 3:4 frame, and puts the title in a strip underneath
   * that takes up the rest of the height - so nothing is cropped and no gap is
   * left, whatever the column width. (Two 4:3 rows are a little taller than one
   * 3:4 frame of the same width.)
   */
  tall?: boolean
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string | null>(null) // image awaiting framing
  const videoRef = useRef<HTMLVideoElement>(null)

  // Only play the card's video while it's on-screen. Desktop browsers cap how many
  // videos can decode at once, so autoplaying every card (including the ones scrolled
  // off in the horizontal rows) starves the decoders and leaves some stuck/black or
  // stuttering. Gating playback to visible cards — what iOS Safari does on its own —
  // lets them all load and play smoothly.
  const isVideo = media?.mediaType === "video"
  useEffect(() => {
    const v = videoRef.current
    if (!v || !isVideo) return
    v.muted = true // React's `muted` attribute is unreliable; set the property so desktop autoplay isn't blocked
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) { v.muted = true; const p = v.play(); if (p) p.catch(() => {}) }
          else v.pause()
        }
      },
      { threshold: 0.1 }
    )
    io.observe(v)
    return () => io.disconnect()
  }, [isVideo, media?.mediaUrl])

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

  // Flip between the card's media and its alternative (still <-> animated).
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
    setUploading(true)
    try {
      await fetch(`/api/admin/home-cards?key=${encodeURIComponent(cardKey)}`, { method: "DELETE" })
      onMediaChange?.(cardKey, null)
    } catch {}
    finally { setUploading(false) }
  }

  return (
    <div
      onClick={activate}
      className={`group relative ${tall ? "h-full flex flex-col" : aspect} rounded-2xl overflow-hidden border border-white/10 bg-slate-900 cursor-pointer transition-all hover:border-white/25 hover:shadow-xl hover:shadow-black/40 ${className}`}
    >
      {/* Media: the whole card, or (tall) an exact 3:4 frame at the top */}
      <div className={tall ? "relative w-full aspect-[3/4] shrink-0 overflow-hidden" : "absolute inset-0"}>
      {media?.mediaType === "video" ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          // #t=0.001 forces the first frame to render immediately (poster-like) even
          // before/without playing, so no card ever shows as a black tile.
          src={`${media.mediaUrl}#t=0.001`}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : media?.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.mediaUrl} alt={title} className="absolute inset-0 w-full h-full object-cover" />
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

      {/* Legibility scrim (a tall card's title sits below the media, so it only needs a soft edge) */}
      <div className={`absolute inset-0 bg-gradient-to-t ${tall ? "from-black/40 via-transparent" : "from-black/80 via-black/10"} to-transparent`} />
      </div>

      {/* Hover sheen — the site's travelling band of silver light */}
      <span
        className="absolute inset-y-0 left-0 w-1/3 z-10 bg-gradient-to-r from-transparent via-white/[0.09] to-transparent pointer-events-none opacity-0 group-hover:opacity-100"
        style={{ animation: "sheen-sweep 2.4s infinite" }}
      />

      {/* Animated silver rim */}
      <SilverRimOverlay />

      {badge && <div className="absolute top-2 left-2 z-20 pointer-events-none">{badge}</div>}

      {/* Foreground label: over the media, or (tall) in the strip below it */}
      <div className={tall ? "relative flex-1 min-h-[40px] px-3 py-2 flex items-center justify-between gap-2 bg-gradient-to-b from-slate-900 to-black" : "absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2"}>
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight truncate drop-shadow text-white">{title}</p>
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
              title={isVideo ? "Show the still image" : "Show the animation"}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border border-white/15 text-[10px] text-white hover:bg-black/90 transition-colors"
            >
              {isVideo ? <ImageIcon size={11} /> : <Film size={11} />}
              {isVideo ? "Still" : "Animate"}
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
