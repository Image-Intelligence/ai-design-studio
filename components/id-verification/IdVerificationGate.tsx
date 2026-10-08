"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BadgeCheck, Clock, IdCard, Loader2, Lock, ShieldCheck, X } from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * ID verification before uploads (2026-10-08, CCBill / card-network rule).
 *
 * Every upload control (reference pictures, start / end frames, source clips,
 * voice tracks, Image Studio imports...) calls
 *
 *     if (!(await requireIdVerification())) return
 *
 * BEFORE it opens a file picker or takes a drop / paste. Verified accounts
 * (and admins) pass straight through; everyone else gets the one-time popup:
 * agree to the Content Provider terms, then Didit's hosted check (ID + selfie)
 * in a new tab, which this polls until the result is in. The routes enforce
 * the same rule server-side (lib/id-verification) - this is the friendly half.
 *
 * One host per page (<IdVerificationHost />), like the library picker: no
 * props threaded through the panels.
 */
type Status = { verified: boolean; status: string | null; termsAccepted: boolean; available: boolean; admin: boolean; signedIn?: boolean }
type Request = { resolve: (ok: boolean) => void }

let cached: Status | null = null
let inflight: Promise<Status | null> | null = null
const listeners = new Set<(s: Status | null) => void>()
let setRequestGlobal: ((r: Request | null) => void) | null = null

/** The account's verification, fetched once per page load (and refreshed on demand). */
export function fetchIdStatus(force = false): Promise<Status | null> {
  if (cached && !force) return Promise.resolve(cached)
  if (inflight && !force) return inflight
  inflight = fetch("/api/id-verification/status", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then((s: Status | null) => {
      cached = s
      // The old Refs "Before You Upload" popup (sessionStorage ref-rights-consent)
      // is folded into this verification popup, agreed to once per account
      // before Didit. A verified account (or an admin) has agreed - grant it so
      // no legacy reader asks again
      if (s?.verified) {
        try { sessionStorage.setItem("ref-rights-consent", "true") } catch {}
        window.dispatchEvent(new Event("pv2-ref-consent"))
      }
      listeners.forEach(l => l(s))
      return s
    })
    .catch(() => null)
    .finally(() => { inflight = null })
  return inflight
}

/**
 * Resolves true when this account may upload; otherwise opens the popup and
 * resolves once it is verified (true) or the popup is closed (false).
 */
export async function requireIdVerification(): Promise<boolean> {
  const s = await fetchIdStatus()
  if (s?.verified) return true
  return new Promise(resolve => {
    if (!setRequestGlobal) { resolve(false); return }
    setRequestGlobal({ resolve })
  })
}

/**
 * Synchronous gate for a drop / paste handler (files already in hand):
 * true = go ahead; false = not verified (or not known yet) - the popup opens
 * and the handler should stop. The host pre-fetches the status on mount, so a
 * verified account is known by the time anyone drops a file.
 */
export function gateUpload(): boolean {
  if (cached?.verified) return true
  void requireIdVerification()
  return false
}

/**
 * onClick for a hidden <input type="file">. Pickers open it with
 * input.click(), which fires this - preventDefault() stops the file dialog,
 * so every button, tile and shortcut that opens the input is gated in one
 * place. Not verified: the popup opens instead (press the button again after).
 */
export function gateFileInput(e: { preventDefault: () => void }) {
  if (cached?.verified) return
  e.preventDefault()
  void requireIdVerification()
}

/** True when a failed response is the server's ID gate (code ID_VERIFICATION_REQUIRED) - then open the popup. */
export function isIdGateError(j: unknown): boolean {
  if ((j as { code?: unknown })?.code !== "ID_VERIFICATION_REQUIRED") return false
  cached = cached ? { ...cached, verified: false } : cached
  void requireIdVerification()
  return true
}

/**
 * The account's full status for badges: `approved` = verified through Didit
 * (an admin's `verified` is true without it). null while loading.
 */
export function useIdStatus(): { verified: boolean; approved: boolean; admin: boolean } | null {
  const pick = (s: Status | null) => (s ? { verified: !!s.verified, approved: s.status === "Approved" && !!s.verified, admin: !!s.admin } : null)
  const [v, setV] = useState(() => pick(cached))
  useEffect(() => {
    const l = (s: Status | null) => setV(pick(s))
    listeners.add(l)
    void fetchIdStatus().then(l)
    return () => { listeners.delete(l) }
  }, [])
  return v
}

/** For UI locks (the Refs section): null while loading, then whether uploads are unlocked. Refreshes on window focus. */
export function useIdVerified(): boolean | null {
  const [v, setV] = useState<boolean | null>(cached ? cached.verified : null)
  useEffect(() => {
    const l = (s: Status | null) => setV(!!s?.verified)
    listeners.add(l)
    void fetchIdStatus().then(l)
    const onFocus = () => { void fetchIdStatus(true) }
    window.addEventListener("focus", onFocus)
    return () => { listeners.delete(l); window.removeEventListener("focus", onFocus) }
  }, [])
  return v
}

export function IdVerificationHost() {
  const [req, setReq] = useState<Request | null>(null)
  useEffect(() => {
    setRequestGlobal = setReq
    // Known before the first upload click (gateFileInput decides synchronously)
    void fetchIdStatus()
    const onFocus = () => { void fetchIdStatus(true) }
    window.addEventListener("focus", onFocus)
    return () => { setRequestGlobal = null; window.removeEventListener("focus", onFocus) }
  }, [])
  if (!req || typeof document === "undefined") return null
  return createPortal(<Modal close={ok => { req.resolve(ok); setReq(null) }} />, document.body)
}

function Modal({ close }: { close: (ok: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(cached)
  const [agree, setAgree] = useState(!!cached?.termsAccepted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const pendingTab = useRef<Window | null>(null)

  // Fresh status on open; poll every 3s once the Didit tab is open
  useEffect(() => { void fetchIdStatus(true).then(s => { setStatus(s); if (s?.termsAccepted) setAgree(true) }) }, [])
  useEffect(() => {
    if (!started) return
    const t = setInterval(() => { void fetchIdStatus(true).then(s => { setStatus(s); if (s?.verified) close(true) }) }, 3000)
    return () => clearInterval(t)
  }, [started, close])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])

  const start = async () => {
    setBusy(true); setError(null)
    // Open the tab inside the click (popup blockers), point it at Didit once we have the link
    pendingTab.current = window.open("about:blank", "_blank")
    try {
      const r = await fetch("/api/id-verification/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptTerms: true }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "Couldn't start the verification")
      if (pendingTab.current && !pendingTab.current.closed) pendingTab.current.location.href = j.url
      else window.location.href = j.url
      setStarted(true)
    } catch (e) {
      pendingTab.current?.close()
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  const st = status?.status ?? null
  const inReview = st === "In Review"
  const declined = !!st && st.startsWith("Declined")
  const unavailable = status ? !status.available : false
  const signedOut = status?.signedIn === false

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onMouseDown={e => { if (e.target === e.currentTarget) close(false) }}>
      <div className="relative w-full max-w-md rounded-2xl border border-white/12 bg-[#0b0f17] p-6 shadow-2xl">
        <button onClick={() => close(false)} className="absolute right-3 top-3 rounded-md p-1 text-slate-500 hover:text-slate-200" aria-label="Close"><X size={16} /></button>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05]"><ShieldCheck size={18} className="text-slate-200" /></span>
          <div>
            <p className="text-[15px] font-semibold text-slate-100">Verify your ID to upload</p>
            <p className="text-[11px] text-slate-500">One time, about 2 minutes</p>
          </div>
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-slate-300">
          Our payment partners require every account that uploads pictures, clips or audio to be ID-verified. Everything else - prompting,
          generating, and re-using your own generations - stays open without it.
        </p>
        <ul className="mt-3 space-y-1.5 text-[12px] text-slate-400">
          <li className="flex gap-2"><IdCard size={14} className="mt-0.5 shrink-0 text-slate-500" />A photo of a government ID and a quick selfie, through our verification partner Didit.</li>
          <li className="flex gap-2"><Lock size={14} className="mt-0.5 shrink-0 text-slate-500" />We keep only the result - never your ID images, name or date of birth.</li>
          <li className="flex gap-2"><BadgeCheck size={14} className="mt-0.5 shrink-0 text-slate-500" />You must be 18 or over. Verify once and every upload unlocks.</li>
        </ul>

        {inReview && <Note icon={<Clock size={13} />}>Your ID is being reviewed - this usually takes a few minutes. Uploads unlock on their own once it&apos;s approved.</Note>}
        {declined && !started && <Note tone="warn">{st === "Declined (age)" ? "The check couldn't confirm you're 18 or over." : "Your last check didn't pass."} You can try again with a valid ID, fully in frame and well lit.</Note>}
        {unavailable && <Note tone="warn">ID verification isn&apos;t available yet - please try again soon.</Note>}
        {signedOut && <Note tone="warn">Sign in first, then press the upload button again.</Note>}

        {/* The one agreement, BEFORE Didit and once per account (saved as
            contentTermsAcceptedAt when the session starts). It replaces the
            old per-session Refs "Before You Upload" popup, whose statements
            and prohibited-content rule (the payment processor's wording) are
            here, so nobody is asked again after verifying. */}
        {/* Shown until this account has agreed once (a retry after a decline skips it) */}
        {!started && !status?.termsAccepted && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Before you upload</p>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-slate-300">
              I own the rights to any images, clips or audio I upload, or have explicit permission to use them as references for AI generation.
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-slate-300">
              If anything I upload shows a real person, they are an adult and I have their consent to use it online.
            </div>
            <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-slate-300">
              <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-[0.18em] text-red-300/80">Prohibited content</span>
              Deepfakes, non-consensual impersonation of any real person, and any illegal or policy-violating AI content are{" "}
              <span className="font-semibold text-white">strictly prohibited</span>. Violations end the account and may be reported to authorities.{" "}
              <a href="/terms#prohibited" target="_blank" rel="noreferrer" className="whitespace-nowrap text-red-200 hover:underline">Full policy</a>
            </div>
          </div>
        )}
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[12px] text-slate-300">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-slate-200" />
          <span>I agree to the statements above and the <a href="/terms#content-provider" target="_blank" rel="noreferrer" className="text-slate-100 underline underline-offset-2 hover:text-white">Content Provider terms (Terms §21)</a>.</span>
        </label>

        {error && <p className="mt-3 text-[11.5px] text-red-300">{error}</p>}

        {started ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[12px] text-slate-300">
            <Loader2 size={14} className="animate-spin text-slate-400" />
            {inReview ? "In review - this updates on its own." : "Finish the check in the new tab - this updates on its own."}
            <button onClick={start} className="ml-auto text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-200">Reopen</button>
          </div>
        ) : (
          <button
            onClick={start}
            disabled={!agree || busy || unavailable || signedOut}
            className={cn(
              "mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors",
              agree && !unavailable && !signedOut ? "bg-slate-100 text-slate-900 hover:bg-white" : "cursor-not-allowed bg-white/[0.06] text-slate-500",
            )}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {declined ? "Try again" : inReview ? "Check again" : "Verify my ID"}
          </button>
        )}
      </div>
    </div>
  )
}

function Note({ children, icon, tone }: { children: React.ReactNode; icon?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={cn("mt-3 flex gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed", tone === "warn" ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-200" : "border-white/10 bg-white/[0.03] text-slate-300")}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}<span>{children}</span>
    </div>
  )
}

/** The Refs section's locked state: what's behind it and the way in. */
export function IdLockedPanel({ className, title = "Verify your ID to unlock Refs", label = "Your reference library unlocks once your ID is verified." }: { className?: string; title?: string; label?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05]"><Lock size={18} className="text-slate-300" /></span>
      <div>
        <p className="text-[14px] font-semibold text-slate-100">{title}</p>
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-slate-400">{label} It takes about 2 minutes, once. Prompting and your own generations stay open.</p>
      </div>
      <button onClick={() => { void requireIdVerification() }} className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-[12.5px] font-semibold text-slate-900 hover:bg-white">
        <ShieldCheck size={14} /> Verify ID to unlock
      </button>
    </div>
  )
}
