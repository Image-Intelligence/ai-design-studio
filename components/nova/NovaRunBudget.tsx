"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Gauge, Loader2, SlidersHorizontal } from "lucide-react"
import { NOVA_RUN_BUDGET_PRESETS, cleanRunBudget } from "@/lib/nova/config"

/*
 * The run budget, in the prompt box (2026-10-19, owner): how much Nova may
 * spend on the NEXT request without asking - with every turn it carries on by
 * itself (renders landing, out of steps). Bigger jobs come back as a plan to
 * approve; a plan that fits inside it is approved by the studio and Nova goes
 * straight on. The per-chat / day / month limits (NovaBudgetPanel) still cap
 * everything; "All limits" opens them. The account's askAbove is the value a
 * new visitor starts at, and "Make this my default" saves the chosen one there.
 */
export function NovaRunBudget({ value, accountDefault, onChange, onSaveDefault, onOpenLimits, disabled }: {
  value: number
  /** The account's default (budget.askAbove). */
  accountDefault: number | undefined
  onChange: (tickets: number) => void
  onSaveDefault?: (tickets: number) => Promise<void>
  onOpenLimits: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState("")
  const [saving, setSaving] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("pointerdown", away)
    window.addEventListener("keydown", esc)
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc) }
  }, [open])

  const pick = (n: number) => { onChange(n); setCustom("") }
  const customN = cleanRunBudget(custom)
  const isPreset = (NOVA_RUN_BUDGET_PRESETS as readonly number[]).includes(value)

  return (
    <div ref={wrap} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={disabled}
        title={`Budget for this run: Nova may spend up to ${value} tickets on your next request without asking`}
        aria-label={`Budget for this run, ${value} tickets`} aria-expanded={open}
        className={`h-10 inline-flex items-center gap-1 px-2 rounded-xl border text-[11.5px] font-semibold tabular-nums transition-colors disabled:opacity-40 ${open
          ? "border-white/30 bg-white/[0.08] text-white"
          : "border-white/[0.10] bg-white/[0.03] text-slate-300 hover:text-white hover:border-white/20"}`}>
        <Gauge size={14} className="text-emerald-300/90" />
        <span className="hidden sm:inline text-slate-500 font-medium">Up to</span>
        <span className="silver-shimmer-text">{value}</span>
        <span className="hidden md:inline text-slate-500 font-medium">tickets</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-50 w-[min(19rem,calc(100vw-2rem))] rounded-2xl silver-edge bg-[#070b14] p-3.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.95)]">
          <div className="flex items-center gap-2">
            <Gauge size={15} className="text-emerald-300" />
            <p className="text-[13px] font-bold text-white">Budget for this run</p>
          </div>
          <p className="mt-1 text-[10.5px] text-slate-400 leading-snug">
            Nova may spend up to this on your next request without asking, including the renders it carries on with by itself.
            Bigger jobs come to you as a plan first; plans that fit are approved automatically.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {NOVA_RUN_BUDGET_PRESETS.map(n => (
              <button key={n} type="button" onClick={() => pick(n)}
                className={`py-1.5 rounded-lg border text-[12px] font-semibold tabular-nums transition-colors ${value === n
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                  : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:text-white hover:border-white/20"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input type="number" min={1} inputMode="numeric" value={custom} placeholder={isPreset ? "Other" : String(value)}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && customN) { pick(customN); setOpen(false) } }}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[12.5px] text-white tabular-nums focus:outline-none focus:border-white/30" />
            <span className="text-[11px] text-slate-500">tickets</span>
            <button type="button" disabled={!customN} onClick={() => { if (customN) { pick(customN); setOpen(false) } }}
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] text-[11.5px] font-semibold text-white hover:bg-white/[0.14] disabled:opacity-40">
              Set
            </button>
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/[0.07] flex items-center gap-2 text-[11px]">
            {onSaveDefault && (accountDefault === value
              ? <span className="inline-flex items-center gap-1 text-slate-500"><Check size={11} /> Your default</span>
              : (
                <button type="button" disabled={saving} onClick={async () => { setSaving(true); try { await onSaveDefault(value) } finally { setSaving(false) } }}
                  className="inline-flex items-center gap-1 text-slate-300 hover:text-white disabled:opacity-50">
                  {saving && <Loader2 size={11} className="animate-spin" />} Make {value} my default
                </button>
              ))}
            <button type="button" onClick={() => { setOpen(false); onOpenLimits() }}
              className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-white">
              <SlidersHorizontal size={11} /> All limits
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
