"use client"

/**
 * The ticket RECHARGE STATION (2026-10-13): a silver ring that drains as a
 * plan's monthly tickets are used and fills back up at each renewal (plan
 * tickets are a bar that refills, not a pile - lib/plan-tickets).
 *
 *   <RechargeRing />     the small ring that replaces the ticket glyph in pills
 *   <RechargeStation />  the full panel: ring, plan tickets left, refill date,
 *                        pack tickets (which never expire)
 *   <TicketPill />       a balance pill with the ring that opens the panel
 *
 * Accounts without a plan see the plain ticket glyph and no panel. The plan's
 * share is recomputed from the LIVE balance the page already has, so the ring
 * moves the moment a generation spends tickets, without refetching.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { Ticket } from "lucide-react"
import { ADMIN_TEXT } from "@/components/ui/admin-mark"

export type PlanTickets = {
  active: boolean
  planId: string | null
  planName: string | null
  cap: number
  planRemaining: number
  packTickets: number
  balance: number
  renewsAt: string | null
  ending: boolean
  packDiscountPct: number
  admin?: boolean
}

// One request shared by every ring on the page; refreshed on focus and every few minutes
let cache: { at: number; data: PlanTickets | null; inflight: Promise<PlanTickets | null> | null } = { at: 0, data: null, inflight: null }
const listeners = new Set<(d: PlanTickets | null) => void>()
async function loadPlanTickets(force = false): Promise<PlanTickets | null> {
  if (!force && cache.data && Date.now() - cache.at < 120_000) return cache.data
  if (cache.inflight) return cache.inflight
  cache.inflight = fetch("/api/user/plan-tickets", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d: PlanTickets | null) => {
      cache = { at: Date.now(), data: d, inflight: null }
      listeners.forEach(l => l(d))
      return d
    })
  return cache.inflight
}

/** Re-read the plan tickets now (after a plan change) - every ring on the page updates. */
export const refreshPlanTickets = () => loadPlanTickets(true)

/** The account's plan tickets, with the plan share worked out from the live balance. */
export function usePlanTickets(liveBalance?: number | null) {
  const [data, setData] = useState<PlanTickets | null>(cache.data)
  const lastBalance = useRef<number | null>(null)
  useEffect(() => {
    listeners.add(setData)
    loadPlanTickets()
    const onFocus = () => loadPlanTickets(true)
    window.addEventListener("focus", onFocus)
    const t = setInterval(() => loadPlanTickets(true), 300_000)
    return () => { listeners.delete(setData); window.removeEventListener("focus", onFocus); clearInterval(t) }
  }, [])
  // A balance that went UP (a refill, a pack, a refund) may have moved the split: re-read it
  useEffect(() => {
    if (typeof liveBalance !== "number") return
    if (lastBalance.current !== null && liveBalance > lastBalance.current) loadPlanTickets(true)
    lastBalance.current = liveBalance
  }, [liveBalance])
  if (!data || !data.active || data.cap <= 0) return { data, plan: null as null | { left: number; cap: number; pack: number; pct: number } }
  const balance = typeof liveBalance === "number" ? liveBalance : data.balance
  const pack = Math.max(0, Math.min(data.packTickets, balance))
  const left = Math.max(0, balance - pack)
  return { data, plan: { left, cap: data.cap, pack, pct: Math.max(0, Math.min(1, left / data.cap)) } }
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "")

/** The silver ring. `pct` 0..1 of the plan bar still left. */
export function RechargeRing({ pct, size = 16, stroke, children }: { pct: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const sw = stroke ?? Math.max(2, Math.round(size / 8))
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const id = useRef(`rs-${Math.random().toString(36).slice(2, 8)}`).current
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.5" stopColor="#AEB7C4" />
            <stop offset="1" stopColor="#EEF1F5" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray 600ms cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 2px rgba(220,228,240,0.55))" }}
        />
      </svg>
      {children && <span className="relative flex items-center justify-center">{children}</span>}
    </span>
  )
}

/** The full panel. */
export function RechargeStation({ balance, className = "" }: { balance?: number | null; className?: string }) {
  const { data, plan } = usePlanTickets(balance)
  if (!data || !plan) return null
  return (
    <div className={`@container relative overflow-hidden rounded-xl border border-white/15 bg-[#070b14] p-3.5 ${className}`}
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px rgba(160,180,210,0.06)" }}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full" style={{ background: "radial-gradient(circle, rgba(200,212,230,0.14), transparent 70%)" }} />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-400">Recharge station</span>
        <span className="rounded-full border border-white/20 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white">{data.planName}</span>
      </div>
      {/* Narrow panels (a folded phone, a slim sidebar) stack the ring over the text */}
      <div className="mt-3 flex items-center gap-3.5 @max-[279px]:flex-col @max-[279px]:items-center @max-[279px]:text-center">
        <RechargeRing pct={plan.pct} size={84} stroke={7}>
          <span className="flex flex-col items-center leading-none">
            <span className="text-[17px] font-black tabular-nums text-white">{plan.left.toLocaleString()}</span>
            <span className="mt-0.5 text-[8.5px] font-mono uppercase tracking-wider text-slate-500">of {plan.cap.toLocaleString()}</span>
          </span>
        </RechargeRing>
        <div className="min-w-0 flex-1 space-y-1.5 text-[11.5px] @max-[279px]:w-full">
          <p className="font-semibold text-white">{plan.left.toLocaleString()} plan tickets left</p>
          <p className="text-slate-400">
            {data.admin
              ? <span className={ADMIN_TEXT}>Admin account · not billed</span>
              : data.ending
              ? <>Plan ends {day(data.renewsAt)}</>
              : <>Refills to <b className="text-slate-200">{plan.cap.toLocaleString()}</b>{data.renewsAt ? <> on {day(data.renewsAt)}</> : null}</>}
          </p>
          {plan.pack > 0 && <p className="text-slate-400"><b className="text-slate-200">+{plan.pack.toLocaleString()}</b> {data.admin ? "extra tickets" : "pack tickets · never expire"}</p>}
          <p className="text-[10.5px] text-slate-500">{data.packDiscountPct}% off ticket packs on your plan</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/buy-tickets" className="min-w-[110px] flex-1 rounded-lg border border-white/15 bg-white/[0.05] py-2 text-center text-[11px] font-semibold text-slate-200 hover:bg-white/10">Buy a pack</Link>
        <Link href="/subscriptions" className="min-w-[110px] flex-1 rounded-lg border border-white/15 bg-white/[0.05] py-2 text-center text-[11px] font-semibold text-slate-200 hover:bg-white/10">Manage plan</Link>
      </div>
    </div>
  )
}

/**
 * A balance pill: the ring (or the plain ticket glyph without a plan) and the
 * balance; with a plan, a click opens the station below it.
 */
/** Gap kept between the panel and every screen edge. */
const EDGE = 8
const PANEL_W = 320

type PanelPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/**
 * Where the panel goes, in VIEWPORT pixels. The pill can sit anywhere in a
 * header (mid-row on a phone), so the panel is not hung off the pill's edge:
 * it is as wide as the screen allows (up to 320px), right-aligned to the pill
 * when that fits and slid back inside the screen when it doesn't, opened below
 * the pill - or above it when the space below is short (landscape phones) -
 * and scrolls inside itself if even that space is too small.
 */
function panelPos(anchor: DOMRect): PanelPos {
  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(PANEL_W, vw - EDGE * 2)
  const left = Math.min(Math.max(anchor.right - width, EDGE), vw - width - EDGE)
  const below = vh - anchor.bottom - EDGE * 2
  const above = anchor.top - EDGE * 2
  if (below >= 240 || below >= above) return { left, width, top: anchor.bottom + EDGE, maxHeight: Math.max(120, below) }
  return { left, width, bottom: vh - anchor.top + EDGE, maxHeight: Math.max(120, above) }
}

export function TicketPill({ balance, className = "", textClassName = "", iconSize = 11 }: { balance: number | null | undefined; className?: string; textClassName?: string; iconSize?: number }) {
  const { plan } = usePlanTickets(balance)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPos | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The panel is portalled to <body> (position: fixed), so a header with
  // overflow, a transform or a backdrop blur can't clip or re-anchor it.
  // Re-measured on resize, rotation and scroll so it follows the pill.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    let raf = 0
    const place = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if (ref.current) setPos(panelPos(ref.current.getBoundingClientRect())) })
    }
    if (ref.current) setPos(panelPos(ref.current.getBoundingClientRect()))
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    window.visualViewport?.addEventListener("resize", place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      window.visualViewport?.removeEventListener("resize", place)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc) }
  }, [open])
  const glyph = plan
    ? <RechargeRing pct={plan.pct} size={iconSize + 7}><Ticket size={Math.max(7, iconSize - 3)} className="text-slate-300" /></RechargeRing>
    : <Ticket size={iconSize} className="text-slate-400" />
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => plan && setOpen(v => !v)}
        className={`${className} ${plan ? "cursor-pointer hover:border-white/30" : "cursor-default"}`}
        title={plan ? `${plan.left.toLocaleString()} of ${plan.cap.toLocaleString()} plan tickets left - click for details` : undefined}
        style={{ boxShadow: "0 0 8px rgba(255,255,255,0.06), inset 0 0 12px rgba(0,0,0,0.6)" }}
      >
        {glyph}
        <span className={textClassName}>{typeof balance === "number" ? balance.toLocaleString() : "---"}</span>
      </button>
      {open && plan && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[200] overflow-y-auto overscroll-contain rounded-xl"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          <RechargeStation balance={balance} />
        </div>,
        document.body,
      )}
    </div>
  )
}

/** One line for big balance cards: the ring, plan tickets left and the refill date. */
export function RechargeInline({ balance, className = "" }: { balance?: number | null; className?: string }) {
  const { data, plan } = usePlanTickets(balance)
  if (!data || !plan) return null
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <RechargeRing pct={plan.pct} size={30} stroke={3.5}><Ticket size={11} className="text-slate-300" /></RechargeRing>
      <div className="min-w-0 text-[11px] leading-snug">
        <p className="font-semibold text-slate-200">{plan.left.toLocaleString()} of {plan.cap.toLocaleString()} {data.planName} plan tickets left</p>
        <p className="text-slate-500">
          {data.admin ? <span className={ADMIN_TEXT}>Admin account · not billed</span> : data.ending ? <>Plan ends {day(data.renewsAt)}</> : <>Refills to {plan.cap.toLocaleString()}{data.renewsAt ? <> on {day(data.renewsAt)}</> : null}</>}
          {plan.pack > 0 ? <> · +{plan.pack.toLocaleString()} {data.admin ? "extra" : "pack"} tickets</> : null}
        </p>
      </div>
    </div>
  )
}
