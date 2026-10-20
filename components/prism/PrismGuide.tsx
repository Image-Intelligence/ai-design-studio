"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { NovaStudio, type NovaViewerRow } from "@/components/nova/NovaStudio"
import { PRISM_FACE } from "@/components/nova/novaArt"

/*
 * Prism, the site guide (2026-10-20, owner) - replaces the AI Guide
 * (components/ChatWidget + /api/chat). It is Nova Studio's engine and chat as
 * ONE continuous conversation per account (components/nova/NovaStudio,
 * persona "prism"): questions about the site, and making things, with the
 * same budget, plans, memory and tools.
 *
 * WHERE IT LIVES (the owner: the old right-edge tab "sits in awkward spots"):
 * nothing floats over the page any more. A small Prism button sits in the
 * header beside the ticket balance (PrismLauncher), and opens Prism as a
 * panel docked to the right edge, under nothing and over nothing but the page
 * itself: on a phone it is a full-screen sheet, from `lg` a 440px dock with no
 * backdrop - the page stays usable beside it, Esc or the button closes it.
 * Once opened it stays mounted while closed, so a reply keeps streaming and
 * the button shows Prism at work.
 *
 * ON / OFF is per account (2026-10-20, owner - it used to be one admin switch
 * for the whole site): `prismHidden` in portalPreferences, mirrored in
 * localStorage so the button does not flash in before the preferences load.
 * The Feed menu's "Prism guide" row and Prism's own "Hide Prism" set it.
 */

// ── one small store, shared by the button(s) and the panel ──────────────────

/** `mounted`: opened at least once on this page - the panel then stays mounted while closed. */
type PrismState = { open: boolean; hidden: boolean; working: boolean; mounted: boolean }
let state: PrismState = { open: false, hidden: false, working: false, mounted: false }
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const set = (patch: Partial<PrismState>) => { state = { ...state, ...patch, ...(patch.open ? { mounted: true } : {}) }; emit() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const SERVER: PrismState = { open: false, hidden: true, working: false, mounted: false }
export const usePrism = () => useSyncExternalStore(subscribe, () => state, () => SERVER)

const HIDDEN_KEY = "prism-hidden"
let loaded = false
/** Read the account's switch once per page: the local copy first, then the saved preference. */
function loadVisibility() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try { set({ hidden: localStorage.getItem(HIDDEN_KEY) === "1" }) } catch {}
  fetch("/api/user/preferences", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d) return
      const hidden = d.preferences?.prismHidden === true
      try { localStorage.setItem(HIDDEN_KEY, hidden ? "1" : "0") } catch {}
      set({ hidden })
    })
    .catch(() => {})
}

export function openPrism() { set({ open: true }) }
export function closePrism() { set({ open: false }) }
/** Show / hide Prism for this account (saved to the account; signed-out visitors keep it on this device). */
export function setPrismVisible(visible: boolean) {
  set({ hidden: !visible, ...(visible ? {} : { open: false }) })
  try { localStorage.setItem(HIDDEN_KEY, visible ? "0" : "1") } catch {}
  void fetch("/api/user/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prismHidden: !visible }) }).catch(() => {})
}

/** The header button. `compact`: the face only (phones). */
export function PrismLauncher({ compact = false }: { compact?: boolean }) {
  const p = usePrism()
  useEffect(loadVisibility, [])
  if (p.hidden) return null
  return (
    <button type="button" onClick={() => set({ open: !p.open })} aria-label={p.open ? "Close Prism, your guide" : "Open Prism, your guide"} aria-expanded={p.open}
      title="Prism - your guide: ask anything, or say what to make"
      className={`group relative shrink-0 inline-flex items-center gap-1.5 rounded-full transition-colors ${compact ? "p-0.5" : "pl-0.5 pr-2.5 py-0.5"} ${p.open ? "bg-white/[0.12]" : "hover:bg-white/[0.08]"}`}>
      <span className="relative block rounded-full p-[1.5px] bg-[conic-gradient(from_200deg,#64748b,#e2e8f0,#a78bfa,#5eead4,#fbbf24,#e2e8f0,#64748b)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PRISM_FACE} alt="" draggable={false} className={`block rounded-full bg-[#0b0f1a] object-cover ${compact ? "w-[22px] h-[22px]" : "w-6 h-6"}`} />
        {p.working && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-fuchsia-400 ring-2 ring-slate-950 animate-pulse" />}
      </span>
      {!compact && <span className="text-[11px] font-extrabold tracking-wide silver-shimmer-text">Prism</span>}
    </button>
  )
}

/**
 * The panel - mount once per page. `onOpenMedia` opens Prism's pictures and
 * clips in the page's own viewers (the portal's feed viewers).
 */
export function PrismGuide({ isAdmin = false, onBalanceChange, onOpenMedia }: {
  isAdmin?: boolean
  onBalanceChange?: (b: number) => void
  onOpenMedia?: (kind: "image" | "video", row: NovaViewerRow, list: NovaViewerRow[]) => void
}) {
  const p = usePrism()
  useEffect(loadVisibility, [])
  // The page under a phone-sized sheet must not scroll; the desktop dock leaves the page alone
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)")
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  useEffect(() => {
    if (!p.open) return
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-prism-modal]")) closePrism() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [p.open])
  /*
   * From lg the dock starts under the page's header (marked data-prism-anchor),
   * so the header - and Prism's own button - stay in view; a phone gets the
   * whole screen.
   */
  const [top, setTop] = useState(0)
  useEffect(() => {
    if (!p.open || narrow) return
    const measure = () => setTop(Math.max(0, Math.round(document.querySelector("[data-prism-anchor]")?.getBoundingClientRect().bottom ?? 0)))
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, { passive: true })
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure) }
  }, [p.open, narrow])
  const onWorking = useCallback((w: boolean) => { if (state.working !== w) set({ working: w }) }, [])

  // Mounted on first open, then kept (a reply streams on while the panel is closed)
  if (p.hidden || !p.mounted) return null
  return (
    <>
      {/* Phones: a dim backdrop behind the sheet; the desktop dock has none */}
      <div onClick={closePrism} aria-hidden
        className={`lg:hidden fixed inset-0 z-[89] bg-black/60 transition-opacity duration-300 ${p.open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
      <aside aria-label="Prism, your guide" aria-hidden={!p.open}
        className={`fixed z-[90] bottom-0 right-0 w-full lg:w-[440px] flex flex-col bg-[#070b14] border-l border-white/[0.08] shadow-[0_0_60px_-10px_rgba(0,0,0,0.9)] transition-transform duration-300 ease-out ${p.open ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
        style={narrow ? { top: 0, height: p.open ? "var(--nova-vvh, 100dvh)" : undefined } : { top }}>
        <NovaStudio persona="prism" isAdmin={isAdmin} active={p.open && narrow} onBalanceChange={onBalanceChange} onOpenMedia={onOpenMedia}
          onClose={closePrism} onHide={() => setPrismVisible(false)} onWorkingChange={onWorking} />
      </aside>
    </>
  )
}
