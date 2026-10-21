"use client"

import { useEffect, useRef, useState } from "react"
import {
  BookOpen, Bookmark, Compass, EyeOff, Gauge, HelpCircle, Image as ImageIcon, Layers, Loader2,
  MoreHorizontal, RotateCcw, Shrink, SlidersHorizontal, Ticket, Video, X,
} from "lucide-react"
import { NovaFigure, type NovaLive } from "@/components/nova/NovaStage"
import { PRISM_ADMIN_ONLY, type NovaContextMark, type NovaMessage } from "@/lib/nova/config"
import { AdminTag, ADMIN_TEXT } from "@/components/ui/admin-mark"

/*
 * Prism's own pieces (2026-10-20): the header (context meter, the menu with
 * Compact / Clear context, Budget, Memory and Hide) and the welcome. The chat
 * itself is Nova Studio's (components/nova/NovaStudio, persona "prism").
 */

/** Messages Prism re-reads word for word with each reply (lib/nova/agent NOVA_HISTORY). */
const REPLAY = 12

/** How full the context is: messages since the last compact / clear, up to the replay window. */
export function contextLoad(messages: NovaMessage[], marks: NovaContextMark[]): { n: number; summary: boolean } {
  const floor = marks.reduce((a, m) => Math.max(a, m.afterId), 0)
  const n = messages.filter(m => m.id > floor && m.id > 0 && !m.system).length
  const last = marks.reduce<NovaContextMark | null>((a, m) => (!a || m.afterId > a.afterId ? m : a), null)
  return { n: Math.min(REPLAY, n), summary: last ? last.kind === "compact" : messages.length > REPLAY }
}

function ContextMeter({ n, summary, onClick }: { n: number; summary: boolean; onClick: () => void }) {
  const level = n <= 2 ? "fresh" : n <= 8 ? "light" : "full"
  const colour = level === "fresh" ? "bg-emerald-300" : level === "light" ? "bg-sky-300" : "bg-amber-300"
  return (
    <button type="button" onClick={onClick}
      title={`Context: Prism re-reads ${n} recent message${n === 1 ? "" : "s"}${summary ? " and a short summary" : ""} with each reply. Compact or Clear it from the menu to make replies cheaper.`}
      className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:border-white/20">
      <span className="flex items-end gap-[2px] h-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`w-[3px] rounded-sm ${i < Math.ceil((n / REPLAY) * 6) ? colour : "bg-white/15"}`} style={{ height: `${5 + i}px` }} />
        ))}
      </span>
      <span className="hidden sm:inline text-[10px] font-semibold text-slate-400 capitalize">{level}</span>
    </button>
  )
}

export function PrismHeader({ live, working, balance, context, onCompact, onClear, onBudget, onMemory, onHide, onClose, contextBusy }: {
  live: NovaLive
  working: boolean
  /** null = admin (free). */
  balance: number | null | undefined
  context: { n: number; summary: boolean }
  onCompact: () => void
  onClear: () => void
  onBudget: () => void
  onMemory: () => void
  onHide?: () => void
  onClose?: () => void
  contextBusy: false | "compact" | "clear"
}) {
  const [menu, setMenu] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) { setMenu(false); setConfirmClear(false) } }
    window.addEventListener("pointerdown", away)
    return () => window.removeEventListener("pointerdown", away)
  }, [menu])
  const item = "w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <div className="shrink-0 border-b border-white/[0.06] px-3 py-2 flex items-center gap-2 bg-[#070b14]/95">
      <NovaFigure pose={live.pose} size={34} animated={false} glow={false} className="rounded-full ring-1 ring-white/15" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-black tracking-tight silver-shimmer-text leading-tight">Prism</p>
          {/* Red while Prism is admin-only (PRISM_ADMIN_ONLY) */}
          {PRISM_ADMIN_ONLY && <AdminTag />}
        </div>
        <p className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-slate-500 truncate">{working ? live.line : "your guide"}</p>
      </div>
      <ContextMeter n={context.n} summary={context.summary} onClick={() => setMenu(true)} />
      {balance !== undefined && (
        <span className="hidden min-[380px]:inline-flex shrink-0 items-center gap-1 h-7 px-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-[10.5px] text-slate-300 tabular-nums" title="Your ticket balance">
          <Ticket size={10} /> {balance === null ? <span className={ADMIN_TEXT}>admin</span> : balance}
        </span>
      )}
      <div ref={wrap} className="relative shrink-0">
        <button type="button" onClick={() => { setMenu(m => !m); setConfirmClear(false) }} aria-label="Prism menu" aria-expanded={menu}
          className={`p-1.5 rounded-lg ${menu ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white hover:bg-white/[0.06]"}`}>
          <MoreHorizontal size={17} />
        </button>
        {menu && (
          <div className="absolute right-0 top-full mt-1.5 z-50 w-[min(18rem,calc(100vw-1.5rem))] p-1.5 rounded-2xl silver-edge bg-[#070b14] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.95)]">
            <p className="px-3 pt-1.5 pb-1 text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500">Context · {context.n} recent message{context.n === 1 ? "" : "s"}{context.summary ? " + summary" : ""}</p>
            <button type="button" className={item} disabled={working || !!contextBusy} onClick={() => { setMenu(false); onCompact() }}>
              {contextBusy === "compact" ? <Loader2 size={15} className="mt-0.5 animate-spin text-sky-300" /> : <Shrink size={15} className="mt-0.5 text-sky-300" />}
              <span><span className="block text-[12.5px] font-semibold text-white">Compact</span><span className="block text-[10.5px] text-slate-500 leading-snug">Fold the conversation into a short summary - Prism keeps the gist and replies get cheaper.</span></span>
            </button>
            {confirmClear ? (
              <div className="px-3 py-2 rounded-lg bg-red-500/[0.07] border border-red-500/20">
                <p className="text-[11.5px] text-red-100 leading-snug">Start fresh? Prism forgets this conversation (messages stay on screen). What it remembers about you stays.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => { setMenu(false); setConfirmClear(false); onClear() }} className="px-2.5 py-1 rounded-md bg-red-500/80 hover:bg-red-500 text-[11.5px] font-semibold text-white">Clear context</button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="px-2 py-1 text-[11.5px] text-slate-400 hover:text-white">Keep</button>
                </div>
              </div>
            ) : (
              <button type="button" className={item} disabled={working || !!contextBusy} onClick={() => setConfirmClear(true)}>
                {contextBusy === "clear" ? <Loader2 size={15} className="mt-0.5 animate-spin text-amber-300" /> : <RotateCcw size={15} className="mt-0.5 text-amber-300" />}
                <span><span className="block text-[12.5px] font-semibold text-white">Clear context</span><span className="block text-[10.5px] text-slate-500 leading-snug">A fresh start at the cheapest point. Your remembered preferences stay.</span></span>
              </button>
            )}
            <div className="my-1 border-t border-white/[0.06]" />
            <button type="button" className={item} onClick={() => { setMenu(false); onBudget() }}>
              <SlidersHorizontal size={15} className="mt-0.5 text-emerald-300" />
              <span><span className="block text-[12.5px] font-semibold text-white">Budget &amp; limits</span><span className="block text-[10.5px] text-slate-500 leading-snug">Per day, per month and the default run budget.</span></span>
            </button>
            <button type="button" className={item} onClick={() => { setMenu(false); onMemory() }}>
              <Bookmark size={15} className="mt-0.5 text-violet-300" />
              <span><span className="block text-[12.5px] font-semibold text-white">What Prism remembers</span><span className="block text-[10.5px] text-slate-500 leading-snug">Your saved preferences - read or remove them.</span></span>
            </button>
            {onHide && (
              <button type="button" className={item} onClick={() => { setMenu(false); onHide() }}>
                <EyeOff size={15} className="mt-0.5 text-slate-400" />
                <span><span className="block text-[12.5px] font-semibold text-white">Hide Prism</span><span className="block text-[10.5px] text-slate-500 leading-snug">Only for your account. Bring it back from the Feed menu.</span></span>
              </button>
            )}
          </div>
        )}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]" aria-label="Close Prism">
          <X size={17} />
        </button>
      )}
    </div>
  )
}

const STARTERS: { text: string; hint: string; icon: typeof Compass }[] = [
  { text: "What can you do?", hint: "A quick tour of Prism and the site", icon: Compass },
  { text: "How do tickets and plans work?", hint: "Packs, plans and what things cost", icon: Ticket },
  { text: "Which model is best for product photos?", hint: "Picks with live prices", icon: HelpCircle },
  { text: "Design a logo for my brand", hint: "Prism asks a couple of questions first", icon: ImageIcon },
  { text: "Turn my latest picture into a short video", hint: "From your library to a clip", icon: Video },
  { text: "Where do I find everything I've made?", hint: "My Generations, folders and assets", icon: Layers },
]

/**
 * Prism while the chat loads (2026-10-21, owner: the panel showed an empty
 * chat, then "loading your chat", then the chat - "just add an
 * animation/display/graphic of prism while it is loading"). Prism floats with
 * her sparks spinning fast, her name in silver, and the line breathing.
 */
export function PrismLoading() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center" role="status" aria-live="polite">
      <NovaFigure pose="thinking" size={132} busy />
      <p className="mt-3 text-[17px] font-black tracking-tight silver-shimmer-text">Prism</p>
      <p className="mt-1 flex items-center gap-1 text-[11.5px] text-slate-400">
        Getting your chat ready
        <span className="inline-flex gap-[3px] pl-0.5" aria-hidden>
          {[0, 1, 2].map(i => (
            <span key={i} className="h-1 w-1 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: `${i * 0.22}s` }} />
          ))}
        </span>
      </p>
    </div>
  )
}

export function PrismWelcome({ onPick, disabled, freeLeft }: { onPick: (text: string) => void; disabled: boolean; freeLeft: number | null | undefined }) {
  return (
    <div className="max-w-xl mx-auto">
      <div className="flex flex-col items-center text-center pt-2">
        <NovaFigure pose="portrait" size={150} />
        <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.25em] text-slate-500">Your guide</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight silver-shimmer-text leading-tight">Hi, I&apos;m Prism.</h2>
        <p className="mt-2 text-[13px] text-slate-300 leading-relaxed">
          Ask me how anything on the site works, which model to use or what it costs. Or tell me what to make -
          images, video, audio, 3D, even a finished cut - and I&apos;ll make it with you.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <BookOpen size={12} /> {freeLeft != null ? `Quick questions are free - ${freeLeft} left today.` : "Quick questions are free."} Making things costs tickets.
        </p>
      </div>
      <div className="mt-5 grid grid-cols-1 min-[520px]:grid-cols-2 gap-2">
        {STARTERS.map(st => (
          <button key={st.text} type="button" onClick={() => onPick(st.text)} disabled={disabled}
            className="group text-left flex gap-2.5 p-3 rounded-2xl silver-edge bg-[#0b0f1a] hover:bg-white/[0.05] transition-colors disabled:opacity-50">
            <span className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-white/[0.12] to-white/[0.03] border border-white/[0.10] flex items-center justify-center group-hover:border-white/25">
              <st.icon size={15} className="text-slate-200" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-slate-100 leading-snug">{st.text}</span>
              <span className="block mt-0.5 text-[10.5px] text-slate-500">{st.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Where the context was compacted / cleared, between two messages. */
export function ContextDivider({ mark }: { mark: NovaContextMark }) {
  const when = (() => { const d = new Date(mark.at); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) })()
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500" role="separator">
      <span className="flex-1 h-px bg-gradient-to-r from-transparent via-white/15 to-white/15" />
      <span className="inline-flex items-center gap-1.5">
        {mark.kind === "compact" ? <Shrink size={11} className="text-sky-300" /> : <Gauge size={11} className="text-amber-300" />}
        {mark.kind === "compact" ? "Compacted - Prism keeps a summary" : "Context cleared - fresh start"}{when ? ` · ${when}` : ""}
      </span>
      <span className="flex-1 h-px bg-gradient-to-l from-transparent via-white/15 to-white/15" />
    </div>
  )
}
