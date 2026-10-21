"use client"

import { createContext, memo, useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle, AudioLines, Box, Check, CheckCircle2, Clapperboard, ClipboardList, FolderInput, FolderPlus,
  Image as ImageIcon, Library, Loader2, Package, Search, Ticket, Video, X, Eye, Layers, Wand2, Clock,
  ScanEye, Bookmark, BookmarkX, Tags, Sparkles, LayoutGrid, Gavel, Route, ArrowUpRight, NotebookPen, Download, Play, Pause, BookOpen, BookMarked, ScanFace, Repeat,
} from "lucide-react"
import type { NovaMessage, NovaPlan, NovaStep } from "@/lib/nova/config"
import { NovaMarkdown } from "./NovaMarkdown"
import { BrandButton } from "@/components/employees/StudioBrand"
import { NovaFigure, seenAt, fmtElapsed, useNow } from "./NovaStage"
import type { NovaPose } from "./novaArt"
import { usePersona } from "./persona"
import { AudioCardArt } from "@/components/home/AudioCardArt"

/*
 * One message of a Nova chat (2026-10-18): the user's bubble (or a system
 * line), or Nova's reply - its text, the steps it took (library actions as
 * one-line rows, generations as media cards), its plan card and the
 * "Done · N media · X tickets" strip.
 */

const MEDIA_KINDS = new Set(["image", "video", "audio", "3d", "cut"])
const isMediaStep = (s: NovaStep) => !!s.kind && MEDIA_KINDS.has(s.kind)

/** An icon per tool, for the one-line library rows. */
function toolIcon(tool: string) {
  const t = tool.toLowerCase()
  if (t === "inspect_media") return ScanEye
  if (t === "remember") return Bookmark
  if (t === "forget") return BookmarkX
  if (t === "caption_asset") return Tags
  if (t === "update_asset_notes") return NotebookPen
  if (t === "find_similar") return Sparkles
  if (t === "save_storyboard") return LayoutGrid
  if (t === "recommend_models") return Route
  if (t === "load_recipe") return BookOpen
  if (t === "set_look_bible") return BookMarked
  if (t === "check_shots") return ScanFace
  if (t === "make_loop") return Repeat
  if (t.includes("search") || t.includes("browse")) return Search
  if (t.includes("view")) return Eye
  if (t.includes("create_folder")) return FolderPlus
  if (t.includes("folder") || t.includes("move") || t.includes("file")) return FolderInput
  if (t.includes("asset")) return Package
  if (t.includes("plan")) return ClipboardList
  if (t.includes("model")) return Layers
  if (t.includes("library")) return Library
  if (t.includes("wait")) return Clock
  return Wand2
}

function kindIcon(kind?: string) {
  if (kind === "video" || kind === "cut") return kind === "cut" ? Clapperboard : Video
  if (kind === "audio") return AudioLines
  if (kind === "3d") return Box
  return ImageIcon
}

/**
 * Opens a finished picture or clip in the portal's feed viewer (2026-10-19,
 * owner: "the same popup as the image/video feed"). NovaStudio provides it
 * when the portal handed it one; it answers false when it cannot (no My
 * Generations id), and the card falls back to its own lightbox / player.
 */
export const NovaOpenMediaContext = createContext<((step: NovaStep) => boolean) | null>(null)

/** How long a step has been running - from when it really began (seenAt), so a reload keeps the count; shared with the side panel. */
function useElapsed(id: string, active: boolean, startedAt?: number) {
  const now = useNow(active)
  return fmtElapsed(now - seenAt(id, startedAt))
}

export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close">
        <X size={18} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
    </div>,
    document.body,
  )
}

/**
 * Download a finished video from the chat (2026-10-19, owner). With its My
 * Generations id it goes through the owner-only proxy (/api/images/[id]?
 * download=1): same-origin and sent as an attachment, so the browser saves it
 * straight to disk - on iPhone too - without holding it in memory first. A
 * step without an id fetches the (signed) file itself; if even that is
 * refused, the video opens in a new tab to save from there.
 */
function DownloadVideo({ step }: { step: NovaStep }) {
  const [busy, setBusy] = useState(false)
  const name = `${(step.prompt || step.model || step.label || "nova-video").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48) || "nova-video"}${step.generationId ? `-${step.generationId}` : ""}.mp4`
  // A round button over the clip's corner, so the card's footer stays model + tickets
  const cls = "absolute top-2 right-2 z-10 w-8 h-8 inline-flex items-center justify-center rounded-full bg-black/60 border border-white/20 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-50"
  if (step.generationId) {
    return <a href={`/api/images/${step.generationId}?download=1`} download={name} className={cls} title="Download the video" aria-label="Download the video" onClick={e => e.stopPropagation()}><Download size={14} /></a>
  }
  const url = step.mediaUrl
  if (!url) return null
  return (
    <button type="button" disabled={busy} className={cls} title="Download the video" aria-label="Download the video" onClick={async e => {
      e.stopPropagation()
      setBusy(true)
      try {
        const r = await fetch(url)
        if (!r.ok) throw new Error(String(r.status))
        const href = URL.createObjectURL(await r.blob())
        const a = document.createElement("a")
        a.href = href; a.download = name
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(href), 4000)
      } catch {
        window.open(url, "_blank", "noopener")
      } finally {
        setBusy(false)
      }
    }}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
    </button>
  )
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/**
 * A finished audio take: the waveform art the home page's audio cards use
 * (shaped by the take, so each has its own), a play button and a thin
 * progress line - in place of the browser's own audio bar.
 */
function AudioTile({ step, url }: { step: NovaStep; url: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
  }
  return (
    <div className="relative aspect-video overflow-hidden">
      <AudioCardArt seed={`${step.generationId ?? step.id}${step.model ?? ""}`} tint="text-fuchsia-300" />
      <audio ref={ref} src={url} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={e => setDur(e.currentTarget.duration || 0)} onTimeUpdate={e => setPos(e.currentTarget.currentTime)} />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}
        className="absolute left-1/2 top-[41%] -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center bg-black/55 border border-white/25 text-white backdrop-blur-sm hover:bg-black/75 transition-colors">
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="absolute inset-x-3 bottom-2.5 flex items-center gap-2 text-[10px] tabular-nums text-slate-300">
        <span>{fmtTime(pos)}</span>
        <div onClick={seek} className="relative flex-1 h-4 flex items-center cursor-pointer">
          <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full bg-fuchsia-300/80" style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} />
          </div>
        </div>
        <span>{dur ? fmtTime(dur) : "--:--"}</span>
      </div>
    </div>
  )
}

/**
 * One run of work in a reply: the library rows, the critic's cards and the
 * media grid, for the steps taken between two pieces of the reply's text.
 */
function StepGroup({ steps }: { steps: NovaStep[] }) {
  const media = steps.filter(isMediaStep)
  const critics = steps.filter(s => s.tool === "critique_work")
  // Model lookups are behind-the-scenes; the library rows are what the user follows
  const rows = steps.filter(s => !isMediaStep(s) && s.tool !== "critique_work" && s.tool !== "recommend_models" && s.tool !== "browse_models")
  if (!rows.length && !critics.length && !media.length) return null
  return (
    <>
      {!!rows.length && <div className="mt-2.5 grid gap-1 md:grid-cols-2 max-w-[1100px]">{rows.map(s => <StepRow key={s.id} step={s} />)}</div>}
      {!!critics.length && <div className="mt-2.5 space-y-1.5 max-w-[720px]">{critics.map(s => <CriticCard key={s.id} step={s} />)}</div>}
      {!!media.length && (
        /*
         * A grid, not CSS columns (2026-10-20): Safari (iPhone / iPad) paints
         * animated pieces inside multi-column layout in the wrong place - the
         * floating figure on a "Making the image..." tile landed on another
         * tile or over the "still working" banner. Rows come from the cards'
         * own mb-2.5; items-start keeps a short tile from stretching.
         * Columns follow the reply's own width (a container query), not the
         * screen's: Prism's narrow dock gets one column, Nova Studio up to four.
         */
        <div className="mt-2.5 @container">
          <div className={media.length === 1 ? "max-w-[560px]" : media.length === 2 ? "grid grid-cols-1 @sm:grid-cols-2 gap-x-2.5 items-start max-w-[900px]" : "grid grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4 gap-x-2.5 items-start"}>
            {media.map(s => <MediaCard key={s.id} step={s} />)}
          </div>
        </div>
      )}
    </>
  )
}

/** A generation: the media itself, its status, and model · tickets · #id under it. */
const MediaCard = memo(function MediaCard({ step }: { step: NovaStep }) {
  const [open, setOpen] = useState(false)
  // Inline player for a clip the feed viewer cannot open (no My Generations id yet)
  const [inline, setInline] = useState(false)
  const openInViewer = useContext(NovaOpenMediaContext)
  const pending = step.status === "pending"
  const running = step.status === "running"
  const elapsed = useElapsed(step.id, pending || running, step.startedAt)
  const Icon = kindIcon(step.kind)
  const url = step.mediaUrl
  const isGlb = !!url && /\.(glb|gltf)(\?|$)/i.test(url)
  // A still for a clip: the step's poster, only when it is a picture (older steps carry the mp4 itself)
  const still = step.posterUrl && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(step.posterUrl) ? step.posterUrl : null

  let body: React.ReactNode
  if (step.status === "error") {
    body = (
      <div className="aspect-video flex flex-col items-center justify-center gap-1.5 p-3 bg-red-500/[0.06] text-center">
        <AlertCircle size={18} className="text-red-400" />
        <p className="text-[11px] text-red-300 leading-snug line-clamp-4">{step.error || "This generation failed"}</p>
      </div>
    )
  } else if (!url || running || pending) {
    body = (
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-white/[0.04] to-white/[0.01]">
        <div className="absolute inset-0 nova-shimmer" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <NovaFigure pose={pending ? "rendering" : "creating"} size={56} busy glow={false} />
          <p className="text-[11px] text-slate-300">{pending ? `Rendering · ${elapsed}` : `Making ${step.kind === "cut" ? "the cut" : step.kind === "3d" ? "a 3D model" : `the ${step.kind ?? "media"}`}…`}</p>
        </div>
      </div>
    )
  } else if (step.kind === "image") {
    body = (
      <button onClick={() => { if (!openInViewer?.(step)) setOpen(true) }} className="block w-full bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={step.prompt ?? ""} loading="lazy" className="w-full max-h-[520px] object-contain" />
      </button>
    )
  } else if (step.kind === "video" || step.kind === "cut") {
    // A still of the clip with a play button: a tap opens it in the feed's
    // video viewer (or plays it right here when that cannot)
    body = (
      <div className="relative bg-black">
        {inline
          ? <video src={url} controls autoPlay playsInline className="w-full max-h-[480px] bg-black" />
          : (
            <button type="button" onClick={() => { if (!openInViewer?.(step)) setInline(true) }} className="group block w-full relative" aria-label="Play the video">
              {/* The clip's still when there is one: an unplayed <video> shows nothing on iPhones (2026-10-20) */}
              {still
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={still} alt="" loading="lazy" className="w-full max-h-[480px] object-contain bg-black pointer-events-none" />
                : <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="w-full max-h-[480px] bg-black pointer-events-none" />}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-12 h-12 rounded-full flex items-center justify-center bg-black/55 border border-white/25 text-white backdrop-blur-sm group-hover:bg-black/75 transition-colors">
                  <Play size={18} fill="currentColor" className="ml-0.5" />
                </span>
              </span>
            </button>
          )}
        {step.status === "done" && <DownloadVideo step={step} />}
      </div>
    )
  } else if (step.kind === "audio") {
    body = <AudioTile step={step} url={url} />
  } else {
    body = (
      <div className="relative bg-black/40">
        {step.posterUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={step.posterUrl} alt="" loading="lazy" className="w-full max-h-[360px] object-contain" />
          : <div className="aspect-video flex items-center justify-center"><Box size={28} className="text-slate-500" /></div>}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 border border-white/15 text-[9.5px] font-bold uppercase tracking-wider text-slate-200">3D model</span>
        {isGlb && (
          <a href={url} target="_blank" rel="noreferrer"
            className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/70 border border-white/15 text-[11px] text-white hover:bg-black/90">
            Open model
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#0b0f1a] break-inside-avoid mb-2.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] hover:border-white/20 transition-colors">
      {body}
      {/* Just the model (whole, wrapping if it must) and what it cost - the prompt lives in the viewer */}
      <div className="flex items-start gap-2 px-2.5 py-2 border-t border-white/[0.06] text-[11px] min-w-0">
        <Icon size={12} className="shrink-0 mt-px text-slate-500" />
        <span className="flex-1 min-w-0 break-words leading-snug font-medium text-slate-200">{step.model || step.label}</span>
        {typeof step.tickets === "number" && step.tickets > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1 text-slate-400 tabular-nums"><Ticket size={11} />{step.tickets}</span>
        )}
      </div>
      {open && url && <Lightbox url={url} onClose={() => setOpen(false)} />}
    </div>
  )
})

/**
 * Open Storyboard Studio from a "Saved storyboard" step. The portal restores
 * its open studio from sessionStorage on load (pv2-view-mode + pv2-employee,
 * the same way Lab cards open a studio), so this sets both and reloads.
 */
function openStoryboardStudio() {
  try {
    sessionStorage.setItem("pv2-view-mode", "employees")
    sessionStorage.setItem("pv2-employee", "storyboard")
  } catch {}
  window.location.reload()
}

/** The critic's verdict: pass (emerald) or revise (amber), its score and summary. */
function CriticCard({ step }: { step: NovaStep }) {
  const running = step.status === "running"
  const pass = /critic:\s*pass/i.test(step.label)
  const score = step.label.match(/(\d+)\s*\/\s*10/)?.[1]
  if (step.status === "error") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] text-[11.5px] text-red-200">
        <Gavel size={13} className="shrink-0" /> The critic could not run{step.error ? `: ${step.error}` : ""}
      </div>
    )
  }
  const tone = running ? "border-white/[0.08] bg-white/[0.02]" : pass ? "border-emerald-400/30 bg-emerald-500/[0.07]" : "border-amber-400/30 bg-amber-500/[0.07]"
  return (
    <div className={`relative overflow-hidden rounded-xl border px-3 py-2.5 ${tone}`}>
      {running && <div className="absolute inset-0 nova-shimmer" />}
      <div className="relative flex items-center gap-2">
        {running ? <Loader2 size={13} className="shrink-0 animate-spin text-slate-300" /> : <Gavel size={13} className={`shrink-0 ${pass ? "text-emerald-300" : "text-amber-300"}`} />}
        <span className={`text-[12px] font-semibold ${running ? "text-slate-200" : pass ? "text-emerald-100" : "text-amber-100"}`}>
          {running ? "The critic is reviewing…" : pass ? "Critic: ready to ship" : "Critic: needs revising"}
        </span>
        {!running && score && (
          <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${pass ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>{score}/10</span>
        )}
      </div>
      {!running && step.note && <p className="relative mt-1.5 text-[11.5px] leading-snug text-slate-300">{step.note}</p>}
      {running && <p className="relative mt-1 text-[10.5px] text-slate-500 truncate">{step.label}</p>}
    </div>
  )
}

/** A library action (search, folders, assets...) as a single row. */
function StepRow({ step }: { step: NovaStep }) {
  const Icon = toolIcon(step.tool)
  const memory = step.tool === "remember" || step.tool === "forget"
  if (step.tool === "save_storyboard" && step.status === "done") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[11.5px] min-w-0">
        <LayoutGrid size={12} className="shrink-0 text-slate-400" />
        <span className="text-slate-200 truncate">{step.label}</span>
        <button onClick={openStoryboardStudio} className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-sky-300 hover:text-sky-200" title="Open Storyboard Studio">
          Open in Storyboard Studio <ArrowUpRight size={11} />
        </button>
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11.5px] min-w-0 ${memory ? "border-violet-400/20 bg-violet-500/[0.05]" : "border-white/[0.06] bg-white/[0.02]"}`}>
      {step.status === "running"
        ? <Loader2 size={12} className="shrink-0 animate-spin text-slate-400" />
        : step.status === "error"
          ? <AlertCircle size={12} className="shrink-0 text-red-400" />
          : <Icon size={12} className={`shrink-0 ${memory ? "text-violet-300" : "text-slate-400"}`} />}
      <span className="text-slate-200 truncate">{step.label}</span>
      {(step.note || step.error) && (
        <span className={`ml-auto shrink-0 max-w-[45%] truncate ${step.error ? "text-red-300" : "text-slate-500"}`} title={step.error || step.note}>
          {step.error || step.note}
        </span>
      )}
    </div>
  )
}

function PlanCard({ plan, actionable, busy, onApprove, onDecline }: {
  plan: NovaPlan
  actionable: boolean
  busy: boolean
  onApprove: (tickets: number) => void
  onDecline: () => void
}) {
  const { name } = usePersona()
  const [tickets, setTickets] = useState(String(plan.totalTickets))
  const n = Math.max(0, Math.round(Number(tickets) || 0))
  const chip = plan.status === "approved"
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-semibold text-emerald-300"
        title={plan.auto ? `It fitted inside this run's budget, so ${name} went straight on` : undefined}>
        <CheckCircle2 size={10} /> {plan.auto ? "Within your budget" : "Approved"}{plan.approvedTickets !== undefined ? ` · ${plan.approvedTickets} tickets` : ""}
      </span>
    : plan.status === "declined"
      ? <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-semibold text-slate-400">Declined</span>
      : plan.status === "replaced"
        ? <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-semibold text-slate-400">Replaced by a newer plan</span>
        : <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/30 text-[10px] font-semibold text-amber-300">Waiting for you</span>
  return (
    <div className="mt-3 rounded-xl silver-edge bg-[#0b0f1a] p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardList size={14} className="text-slate-300" />
        <p className="text-[12px] font-bold text-white">{name}&apos;s plan</p>
        <span className="ml-auto">{chip}</span>
      </div>
      <p className="text-[12.5px] text-slate-300 leading-relaxed mb-2.5">{plan.summary}</p>
      <ol className="space-y-1 mb-2.5">
        {plan.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px]">
            <span className="shrink-0 w-5 h-5 rounded-full bg-white/[0.07] border border-white/10 text-[10px] font-bold text-slate-300 flex items-center justify-center">{i + 1}</span>
            <span className="flex-1 text-slate-200 leading-snug pt-0.5">{s.title}</span>
            <span className="shrink-0 pt-0.5 text-[11px] text-slate-500 tabular-nums">{s.tickets > 0 ? `${s.tickets} t` : "free"}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2 text-[12px]">
        <span className="text-slate-400">Estimated total</span>
        <span className="font-bold text-white tabular-nums">{plan.totalTickets} tickets</span>
      </div>
      {actionable && plan.status === "proposed" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            Budget
            <input type="number" min={0} value={tickets} onChange={e => setTickets(e.target.value)}
              className="w-20 px-2 py-1 rounded-md bg-black/40 border border-white/10 text-[12px] text-white tabular-nums focus:outline-none focus:border-white/30" />
            tickets
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onDecline} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-[12px] text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40">
              Decline
            </button>
            <BrandButton primary size="sm" disabled={busy || n <= 0} onClick={() => onApprove(n)} icon={<Check size={13} />}>
              Approve plan
            </BrandButton>
          </div>
          {n !== plan.totalTickets && n > 0 && (
            <p className="w-full text-[10.5px] text-slate-500">{name} will work within {n} tickets and check back if it needs more.</p>
          )}
        </div>
      )}
    </div>
  )
}

const TIER_WORD: Record<string, string> = { light: "Quick", create: "Create", production: "Planning", run: "Running plan" }

/** "auto" model ids → the short name shown on the route chip. */
function shortModel(id: string): string {
  return id.replace(/^gemini-/, "Gemini ").replace(/-preview$/, "").replace(/-flash-lite$/, " Flash Lite").replace(/-flash$/, " Flash").replace(/-pro$/, " Pro").replace(/-argon$/, " Argon").replace(/^Gemini (\d)/, "Gemini $1")
}

/** Which model answered and why (the router's tier), muted, on Nova's message header. */
function RouteChip({ route }: { route: NonNullable<NovaMessage["route"]> }) {
  const pinned = route.why === "pinned by an admin"
  const tier = TIER_WORD[route.tier] ?? route.tier
  // Steps on different models (judging on the strong one, the rest on Flash): "Argon ×3 + Flash ×5"
  const models = route.mix && Object.keys(route.mix).length > 1 ? Object.entries(route.mix).map(([m, n]) => `${m} ×${n}`).join(" + ") : shortModel(route.model)
  const text = pinned ? shortModel(route.model) : route.tier === "run" ? `${tier} · ${models}` : `Auto · ${tier} · ${models}`
  return (
    <span title={route.why ? `Routed: ${route.why}` : undefined}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/[0.07] bg-white/[0.02] text-[9.5px] font-mono text-slate-500 whitespace-nowrap">
      <Route size={9} className="text-slate-600" /> {text}
    </span>
  )
}

export const NovaMessageView = memo(function NovaMessageView({ message, streaming, livePose, isLatestAssistant, busy, onApprovePlan, onDeclinePlan, onOpenAttachment }: {
  message: NovaMessage
  streaming?: boolean
  /** While this reply streams: Nova's pose beside it (thinking / creating). */
  livePose?: NovaPose
  isLatestAssistant: boolean
  busy: boolean
  onApprovePlan: (messageId: number, tickets: number) => void
  onDeclinePlan: (messageId: number) => void
  onOpenAttachment?: (url: string) => void
}) {
  const { name } = usePersona()
  const [viewing, setViewing] = useState<string | null>(null)

  if (message.role === "user") {
    if (message.system) {
      return (
        <div className="flex items-center gap-2 my-1 text-[10.5px] text-slate-500">
          <span className="flex-1 h-px bg-white/[0.06]" />
          <span className="max-w-[80%] text-center">{message.content}</span>
          <span className="flex-1 h-px bg-white/[0.06]" />
        </div>
      )
    }
    return (
      <div id={`nova-msg-${message.id}`} className="scroll-mt-24 flex flex-col items-end gap-1.5">
        {!!message.assets?.length && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {message.assets.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border border-fuchsia-300/30 bg-fuchsia-500/[0.08] text-[11px] text-fuchsia-100" title={`Asset: ${a.name} (${a.kind})`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.thumb ? <img src={a.thumb} alt="" loading="lazy" className="w-5 h-5 rounded-full object-cover" /> : null}
                <span className="max-w-[10rem] truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        {!!message.attachments?.length && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {message.attachments.map(a => (
              <button key={`${a.id}-${a.url}`} onClick={() => (onOpenAttachment ? onOpenAttachment(a.url) : setViewing(a.url))}
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/15 bg-slate-800">
                {a.kind === "image"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <span className="w-full h-full flex items-center justify-center text-slate-400">{(() => { const I = kindIcon(a.kind); return <I size={18} /> })()}</span>}
                {a.id > 0 && <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[8.5px] font-mono text-slate-300">#{a.id}</span>}
              </button>
            ))}
          </div>
        )}
        {message.content && (
          <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md px-3.5 py-2.5 bg-gradient-to-br from-white/[0.11] to-white/[0.05] border border-white/[0.10] text-[13.5px] text-slate-100 whitespace-pre-wrap break-words shadow-[0_6px_20px_-12px_rgba(0,0,0,0.8)]">
            {message.content}
          </div>
        )}
        {viewing && <Lightbox url={viewing} onClose={() => setViewing(null)} />}
      </div>
    )
  }

  const steps = message.steps ?? []
  const media = steps.filter(isMediaStep)
  const settledMedia = media.filter(s => s.status === "done").length
  const content = message.content ?? ""
  /*
   * Text and work in the order they happened (2026-10-20, owner: Prism's
   * "done" recap sat ABOVE the pictures it was about). Each step knows how much
   * of the reply was written when it began (textAt), so the reply is cut there:
   * what was said before the work, the work, then the wrap-up under it. Steps
   * from before textAt existed count as 0 - the work first, then the text.
   */
  const parts: ({ text: string } | { steps: NovaStep[] })[] = []
  let at = 0
  for (const st of steps) {
    const cut = Math.min(content.length, Math.max(at, st.textAt ?? 0))
    if (cut > at && content.slice(at, cut).trim()) parts.push({ text: content.slice(at, cut) })
    at = Math.max(at, cut)
    const last = parts[parts.length - 1]
    if (last && "steps" in last) last.steps.push(st)
    else parts.push({ steps: [st] })
  }
  if (content.slice(at).trim()) parts.push({ text: content.slice(at) })
  const t = message.tickets
  const total = t ? t.chat + t.media : 0

  return (
    <div id={`nova-msg-${message.id}`} className="scroll-mt-24 flex gap-2.5 sm:gap-3">
      {/* Nova herself, not an icon: her live pose while this reply is being written */}
      <NovaFigure pose={streaming ? (livePose ?? "thinking") : "portrait"} size={40} busy={streaming} animated={!!streaming} glow={!!streaming} className="-mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12.5px] font-black tracking-tight silver-shimmer-text">{name}</span>
          {streaming && <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-200"><span className="w-1 h-1 rounded-full bg-fuchsia-300 animate-pulse" />working</span>}
          {message.route ? <RouteChip route={message.route} /> : message.model && <span className="text-[10px] font-mono text-slate-600">{message.model}</span>}
        </div>
        {!content.trim() && streaming && !steps.length && (
          <div className="flex items-center gap-2 text-[12px] text-slate-500"><Loader2 size={12} className="animate-spin" /> Thinking…</div>
        )}
        {parts.map((p, k) => "text" in p
          ? <div key={`t${k}`} className={`max-w-[78ch] ${k ? "mt-2.5" : ""}`}><NovaMarkdown text={p.text.trim()} /></div>
          : <StepGroup key={`s${k}`} steps={p.steps} />)}
        {message.plan && (
          <div className="max-w-[720px]">
          <PlanCard plan={message.plan} actionable={isLatestAssistant && !streaming} busy={busy}
            onApprove={n => onApprovePlan(message.id, n)} onDecline={() => onDeclinePlan(message.id)} />
          </div>
        )}
        {!streaming && t && (total > 0 || settledMedia > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2 border-t border-emerald-400/15 text-[10.5px] text-emerald-300/80">
            <CheckCircle2 size={11} />
            <span>Done</span>
            {settledMedia > 0 && <span>· {settledMedia} media</span>}
            <span>· {total} ticket{total === 1 ? "" : "s"}</span>
            {t.free
              ? <span className="text-slate-500">(free quick question{t.media ? ` · media ${t.media}` : ""})</span>
              : <span className="text-slate-500">(chat {t.chat} · media {t.media})</span>}
            {!t.charged && !t.free && <span className="text-slate-500">(chat free for admins)</span>}
          </div>
        )}
      </div>
    </div>
  )
})
