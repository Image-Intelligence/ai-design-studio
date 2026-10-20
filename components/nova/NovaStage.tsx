"use client"

import { useEffect, useState } from "react"
import type { NovaMediaKind } from "@/lib/nova/config"
import { AudioLines, Bookmark, Box, Clapperboard, ClipboardList, Image as ImageIcon, ShieldCheck, Ticket, Video } from "lucide-react"
import type { NovaBudget, NovaMessage, NovaSpend, NovaStep } from "@/lib/nova/config"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { NOVA_POSES, NOVA_POSE_ORDER, type NovaPose } from "./novaArt"

/*
 * Nova on screen (2026-10-18): the mascot as the studio's assistant, not a
 * chat bubble icon. Her pose follows what she is doing - thinking while she
 * writes or reads the library, creating while a generation runs, rendering
 * while clips finish in the background, a short celebration when a turn ends -
 * with a line saying exactly what. All five poses are stacked and crossfaded
 * (opacity only), and the float / glow / orbit loops are transform+opacity, so
 * the GPU does the work and iPads keep their frame rate.
 */

export const NOVA_STAGE_CSS = `
@keyframes nova-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6%) } }
@keyframes nova-glow { 0%, 100% { opacity: .45; transform: scale(.92) } 50% { opacity: .85; transform: scale(1.04) } }
@keyframes nova-orbit { to { transform: rotate(360deg) } }
@keyframes nova-shimmer { 0% { transform: translateX(-100%) } 100% { transform: translateX(100%) } }
.nova-float { animation: nova-float 4.2s ease-in-out infinite; will-change: transform; }
.nova-float-fast { animation-duration: 1.9s; }
.nova-glow { animation: nova-glow 3.4s ease-in-out infinite; will-change: transform, opacity; }
.nova-orbit { animation: nova-orbit 9s linear infinite; will-change: transform; }
.nova-orbit-fast { animation-duration: 3.2s; }
.nova-shimmer { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent); animation: nova-shimmer 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .nova-float, .nova-glow, .nova-orbit, .nova-shimmer { animation: none !important; }
}
`

// ── what Nova is doing ───────────────────────────────────────────────────────

export type NovaLive = { pose: NovaPose; line: string; busy: boolean }

const KIND_WORD: Record<string, string> = { image: "an image", video: "a video", audio: "audio", "3d": "a 3D model", cut: "the final cut" }
const PLURAL: Record<string, [string, string]> = { image: ["image", "images"], video: ["video", "videos"], audio: ["audio track", "audio tracks"], "3d": ["3D model", "3D models"], cut: ["cut", "cuts"] }

/**
 * When a step began - what its timer counts from. The server stamps every
 * step with `startedAt`; steps from before that carry their start in their id
 * ("s" + the time in base 36, from lib/nova/agent-tools newStep). Only a step
 * with neither falls back to when this tab first saw it. (2026-10-19, owner: a
 * Kling render at 3+ minutes went back to 0:00 on a page refresh - the timer
 * used to start when the page first saw the step.)
 */
const firstSeen = new Map<string, number>()
export function seenAt(id: string, startedAt?: number): number {
  const now = Date.now()
  if (startedAt && startedAt > 0 && startedAt <= now + 60_000) return Math.min(startedAt, now)
  const fromId = /^s([0-9a-z]{8})/.exec(id)
  if (fromId) {
    const t = parseInt(fromId[1], 36)
    // A real recent time, not some other id that happens to look like one
    if (t > now - 30 * 864e5 && t <= now + 60_000) return Math.min(t, now)
  }
  let t = firstSeen.get(id)
  if (!t) { t = now; firstSeen.set(id, t) }
  return t
}
export const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `0:${String(s).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** A clock that ticks once a second while `on`. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** What Nova is doing, in words, for the tools that are not a plain generation. */
const TOOL_LINE: Record<string, { line: string; pose: NovaPose }> = {
  inspect_media: { line: "Checking the clip…", pose: "thinking" },
  edit_image: { line: "Editing the image…", pose: "creating" },
  export_formats: { line: "Making the other formats…", pose: "creating" },
  expand_image: { line: "Extending the picture…", pose: "creating" },
  cutout: { line: "Cutting out the subject…", pose: "creating" },
  critique_work: { line: "The critic is reviewing…", pose: "thinking" },
  remember: { line: "Remembering that…", pose: "thinking" },
  forget: { line: "Forgetting that…", pose: "thinking" },
  caption_asset: { line: "Reading the asset's pictures…", pose: "thinking" },
  update_asset_notes: { line: "Writing the asset's notes…", pose: "thinking" },
  find_similar: { line: "Looking for similar work…", pose: "thinking" },
  save_storyboard: { line: "Saving the storyboard…", pose: "creating" },
  recommend_models: { line: "Choosing the best model…", pose: "thinking" },
  // The studio tools (2026-10-19)
  extract_frame: { line: "Pulling a frame from the clip…", pose: "creating" },
  make_loop: { line: "Working on the loop's seam…", pose: "creating" },
  check_shots: { line: "Checking the shots stay on-model…", pose: "thinking" },
  edit_clip: { line: "Sending the clip for editing…", pose: "creating" },
  talking_head: { line: "Making the character talk…", pose: "creating" },
}

export function pendingSteps(messages: NovaMessage[]): { messageId: number; step: NovaStep }[] {
  const out: { messageId: number; step: NovaStep }[] = []
  for (const m of messages) for (const s of m.steps ?? []) if (s.status === "pending") out.push({ messageId: m.id, step: s })
  return out
}

export function deriveNovaLive(o: {
  messages: NovaMessage[]
  streamingId: number
  busy: boolean
  /** The finished turn, while the celebration lasts. */
  justDone: NovaMessage | null
  now: number
}): NovaLive {
  const live = o.busy ? o.messages.find(m => m.id === o.streamingId) : undefined
  if (live) {
    const steps = live.steps ?? []
    const special = [...steps].reverse().find(s => s.status === "running" && TOOL_LINE[s.tool])
    if (special) return { pose: TOOL_LINE[special.tool].pose, line: TOOL_LINE[special.tool].line, busy: true }
    const making = [...steps].reverse().find(s => s.status === "running" && s.kind)
    if (making) return { pose: "creating", line: `Making ${KIND_WORD[making.kind!] ?? "something"}${making.model ? ` with ${making.model}` : ""}…`, busy: true }
    const working = [...steps].reverse().find(s => s.status === "running")
    if (working) return { pose: "thinking", line: `${working.label}…`, busy: true }
    if (live.content) return { pose: "thinking", line: "Writing back to you…", busy: true }
    return { pose: "thinking", line: steps.length ? "Deciding what's next…" : "Thinking…", busy: true }
  }
  const pend = pendingSteps(o.messages)
  if (pend.length) {
    const counts = new Map<string, number>()
    for (const p of pend) counts.set(p.step.kind ?? "image", (counts.get(p.step.kind ?? "image") ?? 0) + 1)
    const what = [...counts].map(([k, n]) => `${n} ${(PLURAL[k] ?? ["item", "items"])[n === 1 ? 0 : 1]}`).join(", ")
    const oldest = Math.min(...pend.map(p => seenAt(p.step.id, p.step.startedAt)))
    return { pose: "rendering", line: `Rendering ${what} · ${fmtElapsed(o.now - oldest)}`, busy: true }
  }
  if (o.justDone) {
    const media = (o.justDone.steps ?? []).filter(s => s.kind && s.status === "done").length
    const t = o.justDone.tickets ? o.justDone.tickets.chat + o.justDone.tickets.media : 0
    return { pose: "done", line: `Done${media ? ` · ${media} media` : ""}${t ? ` · ${t} ticket${t === 1 ? "" : "s"}` : ""}`, busy: false }
  }
  return { pose: "portrait", line: o.messages.length ? "Ready for what's next" : "Tell me what to make", busy: false }
}

// ── Nova herself ─────────────────────────────────────────────────────────────

/**
 * Nova in her current pose: every pose stacked, the active one faded in (so a
 * change of state crossfades and no pose ever flashes in unloaded), floating,
 * with a soft glow behind and a ring of sparks that spins faster while she works.
 */
export function NovaFigure({ pose, size, busy, animated = true, glow = true, className = "" }: {
  pose: NovaPose
  size: number
  busy?: boolean
  animated?: boolean
  glow?: boolean
  className?: string
}) {
  const accent = pose === "creating" ? "rgba(232,121,249,0.55)" : pose === "rendering" ? "rgba(56,189,248,0.5)" : pose === "done" ? "rgba(250,204,21,0.45)" : "rgba(129,140,248,0.45)"
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      {glow && (
        <div className={`absolute inset-[8%] rounded-full blur-2xl ${animated ? "nova-glow" : ""}`}
          style={{ background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`, transition: "background 600ms ease" }} />
      )}
      {animated && size >= 48 && (
        <div className={`absolute inset-0 nova-orbit ${busy ? "nova-orbit-fast" : ""}`}>
          {[0, 72, 144, 216, 288].map((deg, i) => (
            <span key={deg} className="absolute left-1/2 top-1/2 rounded-full bg-white"
              style={{
                width: i % 2 ? 2 : 3, height: i % 2 ? 2 : 3,
                transform: `rotate(${deg}deg) translateY(-${size * 0.47}px)`,
                opacity: busy ? 0.85 : 0.4, boxShadow: "0 0 6px rgba(255,255,255,0.9)", transition: "opacity 600ms",
              }} />
          ))}
        </div>
      )}
      <div className={`absolute inset-0 ${animated ? `nova-float ${busy ? "nova-float-fast" : ""}` : ""}`}>
        {NOVA_POSE_ORDER.map(p => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p} src={NOVA_POSES[p]} alt="" draggable={false} decoding="async"
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            style={{ opacity: p === pose ? 1 : 0, transition: "opacity 500ms ease" }} />
        ))}
      </div>
    </div>
  )
}

// ── the stage (right panel) and the bar (narrow screens) ─────────────────────

export function NovaStage({ live, chatTitle }: { live: NovaLive; chatTitle?: string }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,rgba(99,102,241,0.18),transparent_65%),linear-gradient(180deg,#0d1222,#070b14)] border border-white/[0.06]">
      <SilverRimOverlay rounded="rounded-2xl" />
      <div className="relative px-4 pt-5 pb-4 flex flex-col items-center text-center">
        <NovaFigure pose={live.pose} size={168} busy={live.busy} />
        <p className="mt-2 text-[15px] font-black tracking-tight silver-shimmer-text">Nova</p>
        <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-slate-500">your creative partner</p>
        <div className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-[12px] leading-snug ${live.busy ? "border-fuchsia-400/25 bg-fuchsia-500/[0.06] text-fuchsia-100" : live.pose === "done" ? "border-amber-300/25 bg-amber-400/[0.06] text-amber-100" : "border-white/[0.08] bg-white/[0.03] text-slate-300"}`}>
          {live.busy && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-fuchsia-300 animate-pulse" />}
          <span className="min-w-0 truncate">{live.line}</span>
        </div>
        {chatTitle && <p className="mt-2 text-[10.5px] text-slate-500 truncate max-w-full">Working on &ldquo;{chatTitle}&rdquo;</p>}
      </div>
    </div>
  )
}

/** The slim live strip for screens without the side panel. */
export function NovaBar({ live, chips, onOpenPanel }: { live: NovaLive; chips?: React.ReactNode; onOpenPanel?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 px-3 sm:px-4 py-1.5 border-b border-white/[0.06] bg-[linear-gradient(90deg,rgba(99,102,241,0.10),transparent_60%)]">
      <button onClick={onOpenPanel} className="shrink-0 -my-1" aria-label="Open Nova's studio panel" title="Open Nova's studio panel">
        <NovaFigure pose={live.pose} size={44} busy={live.busy} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-white leading-tight">Nova</p>
        <p className={`text-[11px] leading-tight truncate ${live.busy ? "text-fuchsia-200" : live.pose === "done" ? "text-amber-200" : "text-slate-400"}`}>{live.line}</p>
      </div>
      {chips}
    </div>
  )
}

// ── the side panel's sections ────────────────────────────────────────────────

const kindIcon = (k?: string) => (k === "video" ? Video : k === "cut" ? Clapperboard : k === "audio" ? AudioLines : k === "3d" ? Box : ImageIcon)

/** A gallery thumbnail: the picture / poster, else the clip's first frame, else the kind's icon. */
function Thumb({ kind, thumb, media }: { kind?: NovaMediaKind; thumb?: string; media?: string }) {
  const [bad, setBad] = useState(false)
  const I = kindIcon(kind)
  if (thumb && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb} alt="" loading="lazy" onError={() => setBad(true)} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
  }
  if ((kind === "video" || kind === "cut") && media) return <video src={`${media}#t=0.5`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
  return <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/15 to-sky-500/10"><I size={18} className="text-slate-300" /></span>
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl silver-edge bg-[#0b0f1a]/80 p-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-slate-400">{title}</p>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  )
}

/*
 * ── The chat's ticket usage, as a gauge (2026-10-19, owner: "more of a graphic
 * display ... clearly a usage guide ... keep my branding") ──────────────────
 * A ring around the chat's total, split by WHERE the tickets went - images,
 * video, audio, 3D and cuts, and Nova's own thinking (the chat) - in the
 * studio's silver with Nova's glow tones. A thin outer arc shows the limit in
 * force (an approved plan, else the chat's limit, else today's), turning amber
 * near it and red at it. The ring breathes while Nova works.
 */
const USAGE_PARTS: { key: string; label: string; color: string }[] = [
  { key: "image", label: "Images", color: "#7dd3fc" },
  { key: "video", label: "Video", color: "#f0abfc" },
  { key: "audio", label: "Audio", color: "#c4b5fd" },
  { key: "other", label: "3D & cuts", color: "#fcd34d" },
  { key: "chat", label: "Nova chat", color: "#e2e8f0" },
]

/** Where this chat's tickets went, from its messages (generations by kind; the chat's own tokens). */
function usageParts(messages: NovaMessage[]): Record<string, number> {
  const out: Record<string, number> = { image: 0, video: 0, audio: 0, other: 0, chat: 0 }
  for (const m of messages) {
    if (m.role !== "assistant") continue
    out.chat += m.tickets?.chat ?? 0
    for (const st of m.steps ?? []) {
      if (!st.kind || st.status === "error" || !st.tickets) continue
      out[st.kind === "image" || st.kind === "video" || st.kind === "audio" ? st.kind : "other"] += st.tickets
    }
  }
  return out
}

function UsageGauge({ chatSpent, messages, plan, budget, spend, balance, busy }: {
  chatSpent: number
  messages: NovaMessage[]
  plan: { total: number; spent: number } | null
  budget?: NovaBudget
  spend: NovaSpend
  balance: number | null | undefined
  busy: boolean
}) {
  const parts = usageParts(messages)
  const known = Object.values(parts).reduce((a, b) => a + b, 0)
  // The chat's ledger is the authority on the total; the messages give the split (older ones may not be loaded)
  const total = Math.max(chatSpent, known)
  const scale = known > 0 ? total / known : 0
  const limit = plan ? { used: plan.spent, cap: plan.total, label: "approved plan" }
    : budget?.perChat ? { used: chatSpent, cap: budget.perChat, label: "chat limit" }
    : budget?.daily ? { used: spend.today, cap: budget.daily, label: "today's limit" }
    : null
  const frac = limit ? Math.min(1, limit.cap > 0 ? limit.used / limit.cap : 0) : 0
  const tone = frac >= 1 ? "#f87171" : frac >= 0.8 ? "#fbbf24" : "#f8fafc"

  const S = 116, C = S / 2
  const R = 42, W = 9            // the usage ring
  const RO = 53, WO = 2.5        // the limit arc
  const circ = 2 * Math.PI * R, circO = 2 * Math.PI * RO
  const gap = known > 0 ? 2.2 : 0
  const lens = USAGE_PARTS.map(p => (total > 0 ? ((parts[p.key] * scale) / total) * circ : 0))
  // Each segment starts where the ones before it end
  const segs = USAGE_PARTS.map((p, k) => ({ ...p, len: lens[k], at: lens.slice(0, k).reduce((a, b) => a + b, 0) })).filter(x => x.len > 0.5)

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0" style={{ width: S, height: S }}>
          {busy && <span className="absolute inset-3 rounded-full nova-glow" style={{ background: "radial-gradient(circle, rgba(232,121,249,0.28), transparent 70%)" }} />}
          <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} className="relative -rotate-90" aria-hidden>
            <defs>
              <linearGradient id="nova-usage-silver" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" /><stop offset="50%" stopColor="#94a3b8" /><stop offset="100%" stopColor="#e2e8f0" />
              </linearGradient>
            </defs>
            {/* the track */}
            <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={W} />
            {/* where the tickets went */}
            {segs.map(sg => (
              <circle key={sg.key} cx={C} cy={C} r={R} fill="none" stroke={sg.color} strokeWidth={W} strokeLinecap="butt"
                strokeDasharray={`${Math.max(0.5, sg.len - gap)} ${circ}`} strokeDashoffset={-sg.at}
                style={{ transition: "stroke-dasharray 0.7s ease, stroke-dashoffset 0.7s ease", filter: `drop-shadow(0 0 3px ${sg.color}66)` }} />
            ))}
            {/* nothing split yet but something spent: one silver ring */}
            {!segs.length && total > 0 && <circle cx={C} cy={C} r={R} fill="none" stroke="url(#nova-usage-silver)" strokeWidth={W} />}
            {/* the limit in force */}
            {limit && (
              <>
                <circle cx={C} cy={C} r={RO} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={WO} />
                <circle cx={C} cy={C} r={RO} fill="none" stroke={frac >= 0.8 ? tone : "url(#nova-usage-silver)"} strokeWidth={WO} strokeLinecap="round"
                  strokeDasharray={`${frac * circO} ${circO}`} style={{ transition: "stroke-dasharray 0.7s ease" }} />
              </>
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[24px] font-black leading-none tabular-nums silver-shimmer-text">{total}</span>
            <span className="mt-0.5 text-[8.5px] font-mono uppercase tracking-[0.2em] text-slate-400">tickets</span>
          </div>
        </div>
        {/* the legend: where they went */}
        <div className="min-w-0 flex-1 space-y-1">
          {USAGE_PARTS.map(p => {
            const v = Math.round(parts[p.key] * scale)
            return (
              <div key={p.key} className={`flex items-center gap-1.5 text-[10.5px] ${v ? "text-slate-200" : "text-slate-600"}`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: v ? p.color : "rgba(255,255,255,0.12)", boxShadow: v ? `0 0 6px ${p.color}88` : undefined }} />
                <span className="truncate">{p.label}</span>
                <span className="ml-auto tabular-nums font-semibold">{v}</span>
              </div>
            )
          })}
        </div>
      </div>
      {limit ? (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px]">
          <span className="w-2 h-0.5 rounded-full shrink-0" style={{ background: tone }} />
          <span className="text-slate-400">{limit.label === "approved plan" ? <><ClipboardList size={10} className="inline -mt-px mr-0.5 text-amber-200" />Approved plan</> : limit.label === "chat limit" ? "This chat's limit" : "Today's limit"}</span>
          <span className="ml-auto tabular-nums" style={{ color: frac >= 0.8 ? tone : undefined }}>{limit.used} / {limit.cap}{frac >= 1 ? " · reached" : ""}</span>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-slate-500 leading-snug">No limit on this chat - set one in Budget.{budget?.askAbove ? ` Each request may spend what its prompt box budget allows (default ${budget.askAbove}) before Nova asks.` : ""}</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[
          ["Today", `${spend.today}${budget?.daily ? ` / ${budget.daily}` : ""}`],
          ["Balance", balance === null ? "Free · admin" : balance === undefined ? "…" : String(balance)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2 py-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-500">{k}</span>
            <span className="ml-auto text-[11.5px] font-bold text-white tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The same usage ring, small, for the studio's top bar below 2xl (iPad,
 * laptop) where the side panel is folded away (2026-10-19, owner: the grey
 * "This chat 173 t" chip). The ring is split by where the tickets went; a
 * thin outer arc is the approved plan; a tap opens the panel with the full
 * gauge and its legend.
 */
export function UsageChip({ chatSpent, messages, plan, busy, onClick }: {
  chatSpent: number
  messages: NovaMessage[]
  plan: { total: number; spent: number } | null
  busy: boolean
  onClick: () => void
}) {
  const parts = usageParts(messages)
  const known = Object.values(parts).reduce((a, b) => a + b, 0)
  const total = Math.max(chatSpent, known)
  const S = 28, C = S / 2, R = 9.5, W = 3.5, RO = 12.6
  const circ = 2 * Math.PI * R, circO = 2 * Math.PI * RO
  const lens = USAGE_PARTS.map(p => (known > 0 ? (parts[p.key] / known) * circ : 0))
  const segs = USAGE_PARTS.map((p, k) => ({ ...p, len: lens[k], at: lens.slice(0, k).reduce((a, b) => a + b, 0) })).filter(x => x.len > 0.3)
  const frac = plan && plan.total > 0 ? Math.min(1, plan.spent / plan.total) : 0
  const tone = frac >= 1 ? "#f87171" : frac >= 0.8 ? "#fbbf24" : "#e2e8f0"
  const top = USAGE_PARTS.filter(p => parts[p.key] > 0).sort((a, b) => parts[b.key] - parts[a.key]).slice(0, 3)
  return (
    <button type="button" onClick={onClick} title={`Usage in this chat: ${total} tickets${top.length ? ` - ${top.map(p => `${p.label} ${parts[p.key]}`).join(', ')}` : ''}${plan ? ` · plan ${plan.spent}/${plan.total}` : ''}. Tap for the full breakdown.`}
      className="group inline-flex items-center gap-2 pl-1 pr-2.5 py-0.5 rounded-full silver-edge bg-[#0b0f1a] hover:bg-white/[0.04] transition-colors">
      <span className="relative shrink-0" style={{ width: S, height: S }}>
        {busy && <span className="absolute inset-0 rounded-full nova-glow" style={{ background: "radial-gradient(circle, rgba(232,121,249,0.35), transparent 70%)" }} />}
        <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} className="relative -rotate-90" aria-hidden>
          <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={W} />
          {segs.map(sg => (
            <circle key={sg.key} cx={C} cy={C} r={R} fill="none" stroke={sg.color} strokeWidth={W}
              strokeDasharray={`${Math.max(0.4, sg.len - (segs.length > 1 ? 1 : 0))} ${circ}`} strokeDashoffset={-sg.at}
              style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }} />
          ))}
          {!segs.length && total > 0 && <circle cx={C} cy={C} r={R} fill="none" stroke="#e2e8f0" strokeWidth={W} />}
          {plan && <circle cx={C} cy={C} r={RO} fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeDasharray={`${frac * circO} ${circO}`} style={{ transition: "stroke-dasharray 0.6s ease" }} />}
        </svg>
      </span>
      <span className="flex flex-col items-start leading-none">
        <span className="text-[13px] font-black tabular-nums silver-shimmer-text">{total}</span>
        <span className="mt-0.5 text-[8px] font-mono uppercase tracking-[0.16em] text-slate-500 group-hover:text-slate-300">tickets · this chat</span>
      </span>
    </button>
  )
}

export function NovaStudioPanel({ live, chatTitle, plan, chatSpent, spend, budget, balance, messages, onOpenBudget, onOpenMedia, memoryCount, onOpenMemory, references }: {
  live: NovaLive
  chatTitle?: string
  plan: { total: number; spent: number } | null
  chatSpent: number
  spend: NovaSpend
  budget?: NovaBudget
  balance: number | null | undefined
  messages: NovaMessage[]
  onOpenBudget: () => void
  /** A gallery tile: images open in the lightbox, everything else jumps to its message. */
  onOpenMedia: (messageId: number, step: NovaStep) => void
  /** How many things Nova remembers about this user (lib/nova/memory). */
  memoryCount?: number
  onOpenMemory?: () => void
  /** The chat's references section (components/nova/NovaReferences), under the tickets. */
  references?: React.ReactNode
}) {
  const now = useNow(messages.some(m => m.steps?.some(s => s.status === "pending")))
  const pend = pendingSteps(messages)
  const made: { messageId: number; step: NovaStep }[] = []
  for (const m of [...messages].reverse()) for (const s of [...(m.steps ?? [])].reverse()) if (s.kind && s.status === "done" && (s.mediaUrl || s.posterUrl)) made.push({ messageId: m.id, step: s })


  return (
    <div className="space-y-3">
      <NovaStage live={live} chatTitle={chatTitle} />

      <Section title="Usage · this chat" right={
        <button onClick={onOpenBudget} className="inline-flex items-center gap-1 text-[10.5px] text-emerald-300 hover:text-emerald-200"><ShieldCheck size={11} /> Budget</button>
      }>
        <div data-nova-usage className="rounded-xl transition-shadow duration-500">
          <UsageGauge chatSpent={chatSpent} messages={messages} plan={plan} budget={budget} spend={spend} balance={balance} busy={live.busy} />
        </div>
      </Section>

      {references}

      {!!pend.length && (
        <Section title="Rendering now" right={<span className="text-[10.5px] text-sky-300 tabular-nums">{pend.length}</span>}>
          <div className="space-y-1.5">
            {pend.map(({ messageId, step }) => {
              const I = kindIcon(step.kind)
              return (
                <button key={step.id} onClick={() => onOpenMedia(messageId, step)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-white/15 text-left">
                  <span className="relative shrink-0 w-7 h-7 rounded-md bg-sky-500/10 border border-sky-400/20 flex items-center justify-center overflow-hidden">
                    <span className="absolute inset-0 nova-shimmer" />
                    <I size={13} className="relative text-sky-300" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] text-slate-200 truncate">{step.model || step.label}</span>
                    <span className="block text-[10px] text-slate-500 tabular-nums">{fmtElapsed(now - seenAt(step.id, step.startedAt))} · {step.tickets ?? 0} t</span>
                  </span>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Made in this chat" right={<span className="text-[10.5px] text-slate-500 tabular-nums">{made.length}</span>}>
        {made.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {made.slice(0, 24).map(({ messageId, step }) => {
              const I = kindIcon(step.kind)
              const thumb = step.kind === "image" ? step.mediaUrl : step.kind === "3d" ? step.posterUrl : undefined
              return (
                <button key={step.id} onClick={() => onOpenMedia(messageId, step)} title={step.prompt || step.label}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-black/40 border border-white/[0.06] hover:border-white/30">
                  <Thumb kind={step.kind} thumb={thumb} media={step.mediaUrl} />
                  <span className="absolute bottom-1 left-1 p-0.5 rounded bg-black/70"><I size={10} className="text-white" /></span>
                  {step.generationId && <span className="absolute top-1 right-1 px-1 rounded bg-black/70 text-[8px] font-mono text-slate-300">#{step.generationId}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 leading-snug">Everything Nova makes shows up here, and in My Generations in this chat&apos;s folder.</p>
        )}
      </Section>

      {onOpenMemory && (
        <button onClick={onOpenMemory} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl silver-edge bg-[#0b0f1a]/80 hover:bg-white/[0.04] text-left">
          <Bookmark size={13} className="shrink-0 text-violet-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] text-slate-200">What Nova remembers</span>
            <span className="block text-[10px] text-slate-500">{memoryCount ? `${memoryCount} preference${memoryCount === 1 ? "" : "s"} & brand rule${memoryCount === 1 ? "" : "s"}` : "Nothing yet - tell her what to remember"}</span>
          </span>
          {!!memoryCount && <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-[10px] font-bold text-violet-200 tabular-nums">{memoryCount}</span>}
        </button>
      )}

      <p className="flex items-center gap-1.5 px-1 text-[10px] text-slate-600"><Ticket size={10} /> Chat and generations cost tickets.</p>
    </div>
  )
}
