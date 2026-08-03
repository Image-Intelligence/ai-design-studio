"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FolderOpen } from "lucide-react"

// The "My Generations" home card — instead of admin-uploaded media it shows a live
// carousel of the signed-in user's most recent generations ("featured"), crossfading
// through them. Per-user (session-scoped via /api/my-images); clicking opens
// /my-generations. Falls back to a gradient placeholder when empty/logged out.

interface GenItem {
  id: number
  imageUrl: string
  thumbnailUrl?: string | null
  videoMetadata?: { thumbnailUrl?: string; isVideo?: boolean } | null
}

const thumbOf = (it: GenItem) =>
  it.thumbnailUrl || it.videoMetadata?.thumbnailUrl || `/api/images/${it.id}?thumb=1`

export function GenerationsCarousel({ signedIn, className = "", aspect = "aspect-[4/3]" }: {
  signedIn: boolean
  className?: string
  aspect?: string
}) {
  const router = useRouter()
  const [items, setItems] = useState<GenItem[]>([])
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (!signedIn) { setItems([]); return }
    let alive = true
    fetch("/api/my-images?page=1&limit=12")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d?.images) setItems(d.images) })
      .catch(() => {})
    return () => { alive = false }
  }, [signedIn])

  // Crossfade through the featured list.
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 3500)
    return () => clearInterval(t)
  }, [items.length])

  return (
    <div
      onClick={() => router.push("/my-generations")}
      className={`group relative ${aspect} rounded-2xl overflow-hidden border border-white/10 bg-slate-900 cursor-pointer transition-all hover:border-white/25 hover:shadow-xl hover:shadow-black/40 ${className}`}
    >
      {items.length > 0 ? (
        items.map((it, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={it.id}
            src={thumbOf(it)}
            alt=""
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden" }}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`}
          />
        ))
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.08] via-transparent to-fuchsia-500/[0.08] flex items-center justify-center">
          <FolderOpen size={26} className="text-white/25" />
        </div>
      )}

      {/* Legibility scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

      {/* Label */}
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight text-white drop-shadow truncate">My Generations</p>
          <p className="text-[11px] text-white/60 truncate">
            {items.length > 0 ? "Your latest images & videos" : "All your images & videos"}
          </p>
        </div>
      </div>
    </div>
  )
}
