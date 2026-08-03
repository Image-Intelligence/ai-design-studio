"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react"

// A carousel "News & Updates" card for the home page — flips through the latest
// published articles and short portal notifications one at a time (auto-advancing,
// with dots + prev/next). Data sources mirror portal-v2's NewsDropdown
// (GET /api/news + GET /api/notifications?target=portal); articles open /news/{slug}.
// Not admin-uploadable — it's live content.

interface NewsArticlePreview {
  id: number
  title: string
  slug: string
  type: string
  summary: string
  previewImage?: string | null
}
interface PortalNotification {
  id: number
  message: string
  type: string
}

type NewsItem =
  | { kind: "article"; id: number; type: string; title: string; summary: string; slug: string; previewImage?: string | null }
  | { kind: "notif"; id: number; type: string; text: string; url?: string }

// Per-type accent (dot + soft gradient tint). Static literals for Tailwind JIT.
const TYPE_DOT: Record<string, string> = {
  info: "bg-cyan-400", update: "bg-violet-400", success: "bg-emerald-400", warning: "bg-amber-400", tutorial: "bg-fuchsia-400",
}
const TYPE_GRAD: Record<string, string> = {
  info: "from-cyan-500/25", update: "from-violet-500/25", success: "from-emerald-500/25", warning: "from-amber-500/25", tutorial: "from-fuchsia-500/25",
}

// Pull the first markdown link out of a notification message; return clean text + url.
function parseNotif(message: string): { text: string; url?: string } {
  const m = message.match(/\[([^\]]+)\]\(([^)]+)\)/)
  const text = message.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").trim()
  return { text, url: m?.[2] }
}

export function NewsStreamCard({ className = "" }: { className?: string }) {
  const router = useRouter()
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [nRes, notRes] = await Promise.all([
          fetch("/api/news"),
          fetch("/api/notifications?target=portal"),
        ])
        if (!alive) return
        const articles: NewsArticlePreview[] = nRes.ok ? (await nRes.json().then(d => Array.isArray(d) ? d : (d.articles ?? d.news ?? [])).catch(() => [])) : []
        const notifs: PortalNotification[] = notRes.ok ? (await notRes.json().then(d => Array.isArray(d) ? d : (d.notifications ?? [])).catch(() => [])) : []
        const merged: NewsItem[] = [
          ...articles.map(a => ({ kind: "article" as const, id: a.id, type: a.type, title: a.title, summary: a.summary, slug: a.slug, previewImage: a.previewImage })),
          ...notifs.map(n => { const p = parseNotif(n.message); return { kind: "notif" as const, id: n.id, type: n.type, text: p.text, url: p.url } }),
        ]
        setItems(merged)
      } catch {}
      finally { if (alive) setLoading(false) }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  // Keep the index valid as the list changes.
  useEffect(() => { if (idx >= items.length) setIdx(0) }, [items.length, idx])

  // Auto-advance (paused on hover).
  useEffect(() => {
    if (items.length < 2 || paused) return
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 5000)
    return () => clearInterval(t)
  }, [items.length, paused])

  const go = (n: number) => { if (items.length) setIdx(((n % items.length) + items.length) % items.length) }

  const openItem = (it: NewsItem) => {
    if (it.kind === "article") router.push(`/news/${it.slug}`)
    else if (it.url) { it.url.startsWith("/") ? router.push(it.url) : window.open(it.url, "_blank", "noopener") }
  }

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border border-white/10 bg-slate-900 h-full min-h-[240px] ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Header chip */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10">
        <Bell size={12} className="text-cyan-400" />
        <span className="text-[11px] font-bold text-white">News &amp; Updates</span>
      </div>

      {/* Slides */}
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.06] via-transparent to-fuchsia-500/[0.06] flex items-center justify-center text-xs text-slate-600">No news yet</div>
      ) : (
        items.map((it, i) => {
          const active = i === idx
          const clickable = it.kind === "article" || (it.kind === "notif" && !!it.url)
          return (
            <div
              key={`${it.kind}-${it.id}`}
              onClick={() => clickable && openItem(it)}
              className={`absolute inset-0 transition-opacity duration-700 ${active ? "opacity-100" : "opacity-0 pointer-events-none"} ${clickable ? "cursor-pointer group" : ""}`}
            >
              {/* Background: article preview image, else a themed gradient */}
              {it.kind === "article" && it.previewImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.previewImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />
                </>
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${TYPE_GRAD[it.type] ?? "from-slate-500/20"} via-slate-900 to-slate-950`} />
              )}

              {/* Content */}
              <div className="absolute inset-x-0 bottom-0 p-4 pr-10">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[it.type] ?? "bg-slate-400"}`} />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                    {it.type}{it.kind === "notif" ? " · announcement" : ""}
                  </span>
                </div>
                {it.kind === "article" ? (
                  <>
                    <p className="text-base font-bold text-white leading-snug line-clamp-2 group-hover:text-cyan-200 transition-colors">{it.title}</p>
                    {it.summary && <p className="text-[12px] text-slate-300/80 line-clamp-2 mt-1">{it.summary}</p>}
                    <span className="inline-flex items-center gap-1 text-[11px] text-cyan-300 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Read article <ArrowUpRight size={12} /></span>
                  </>
                ) : (
                  <p className="text-sm text-slate-100 leading-relaxed line-clamp-4">{it.text}</p>
                )}
              </div>
            </div>
          )
        })
      )}

      {/* Prev / next + dots */}
      {items.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); go(idx - 1) }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-black/50 border border-white/10 backdrop-blur-sm flex items-center justify-center text-slate-300 hover:text-white hover:bg-black/70 transition-all"
            aria-label="Previous"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(idx + 1) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-black/50 border border-white/10 backdrop-blur-sm flex items-center justify-center text-slate-300 hover:text-white hover:bg-black/70 transition-all"
            aria-label="Next"
          >
            <ChevronRight size={15} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); go(i) }}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`}
                aria-label={`Go to item ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
