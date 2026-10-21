"use client"

import { useState } from "react"
import { AudioLines, Pause, Play } from "lucide-react"
import type { GenInputGroup, GenInputItem } from "@/lib/gen-inputs"

/*
 * A generation's inputs, laid out the way its model takes them (2026-10-21):
 * one labelled row per input - "Start frame", "Reference videos", "Source
 * clip", "Voice audio"... - built by the page per model (lib/gen-inputs).
 * Pictures and clips show as thumbnails (a clip plays while hovered), audio
 * as a play button. Used by the generating tiles' popups and the finished
 * items' popups.
 */
export function GenInputsView({ groups, empty = "No inputs - made from the prompt alone", compact = false }: {
  groups: GenInputGroup[]
  empty?: string
  /** phones: smaller thumbnails */
  compact?: boolean
}) {
  if (!groups.length) return <p className="text-[11px] italic text-slate-600">{empty}</p>
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => (
        <div key={`${g.label}-${gi}`}>
          <p className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.18em] text-slate-500">
            {g.label}{g.items.length > 1 ? ` (${g.items.length})` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((it, i) => <InputTile key={`${it.url}-${i}`} it={it} compact={compact} />)}
          </div>
          {g.note && <p className="mt-1 text-[10px] text-slate-600">{g.note}</p>}
        </div>
      ))}
    </div>
  )
}

function InputTile({ it, compact }: { it: GenInputItem; compact: boolean }) {
  const size = compact ? "w-14 h-14" : "w-[72px] h-[72px]"
  const tag = it.tag && (
    <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/75 px-1 text-[8.5px] font-mono text-slate-200">{it.tag}</span>
  )
  if (it.kind === "audio") return <AudioTile url={it.url} tag={tag} size={size} />
  return (
    <a href={it.url} target="_blank" rel="noopener noreferrer" title="Open full size"
      className={`relative ${size} shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 hover:border-white/30 transition-colors`}>
      {it.kind === "video"
        ? <video src={`${it.url}#t=0.1`} muted loop playsInline preload="metadata"
            onMouseEnter={e => { void e.currentTarget.play().catch(() => {}) }} onMouseLeave={e => { e.currentTarget.pause() }}
            className="h-full w-full object-cover" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={it.url} alt="" loading="lazy" className="h-full w-full object-cover" />}
      {it.kind === "video" && <span className="pointer-events-none absolute top-0.5 left-0.5 rounded bg-black/75 px-1 text-[8px] font-bold uppercase tracking-wider text-white">Clip</span>}
      {tag}
    </a>
  )
}

function AudioTile({ url, tag, size }: { url: string; tag: React.ReactNode; size: string }) {
  const [el, setEl] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const toggle = () => {
    if (playing && el) { el.pause(); setPlaying(false); return }
    const a = el ?? new Audio(url)
    a.onended = () => setPlaying(false)
    setEl(a)
    void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return (
    <button onClick={toggle} title={playing ? "Pause" : "Listen"}
      className={`relative ${size} shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.06] to-black/40 text-slate-300 hover:border-white/30 transition-colors`}>
      <AudioLines size={16} className="text-slate-400" />
      {playing ? <Pause size={12} /> : <Play size={12} />}
      {tag}
    </button>
  )
}
