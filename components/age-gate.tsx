"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { SiteLogoBox } from "@/components/SitePageHeader"

// CCBill compliance: age confirmation warning shown before granting site access.
// Confirmed once per browser (localStorage). Policy + report pages stay reachable
// without attesting so minors/reporters can read the rules and file complaints.
const STORAGE_KEY = "age-gate-confirmed"
const EXEMPT_PATHS = ["/terms", "/privacy", "/refund", "/report", "/policies", "/contact"]

export default function AgeGate() {
  const pathname = usePathname()
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true)
    } catch {
      setShow(true)
    }
    // A logged-in session already carries an 18+ certification (signup checkbox
    // or the account attestation modal) — pages with session data dispatch this
    // so the visitor splash never stacks on top of the account modal
    const satisfied = () => {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()))
      } catch {}
      setShow(false)
    }
    window.addEventListener("age-gate-satisfied", satisfied)
    return () => window.removeEventListener("age-gate-satisfied", satisfied)
  }, [])

  if (!show || EXEMPT_PATHS.some((p) => pathname?.startsWith(p))) return null

  const confirm = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {}
    setShow(false)
  }

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4">
      <style>{`@keyframes age-gate-sheen { 0% { transform: translateX(-150%) } 100% { transform: translateX(400%) } }`}</style>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      {/* Frost card + the site's animated silver rim (masked to a thin band) */}
      <div className="relative isolate w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#070b14]/95 backdrop-blur-md shadow-2xl p-6">
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none z-20"
          style={{
            padding: "1.5px",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "exclude",
          } as React.CSSProperties}
        >
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[300%] animate-spin"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))",
              animationDuration: "5s",
            }}
          />
        </div>

        {/* Brand header — synced site logo chip + gradient silver title */}
        <div className="flex items-center gap-3 mb-4">
          <SiteLogoBox size={40} rounded={12} />
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-none bg-gradient-to-r from-slate-100 via-white to-slate-400 bg-clip-text text-transparent">
              Adults Only
            </h2>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-slate-500 mt-1.5 leading-none">
              18+ · Age Verification
            </p>
          </div>
        </div>

        <p className="text-slate-400 text-[13px] leading-relaxed mb-3">
          This website contains AI-generated content intended for adults. You must
          be at least 18 years of age (or the age of majority in your jurisdiction)
          to enter.
        </p>
        <p className="text-slate-500 text-[12px] leading-relaxed mb-5">
          By entering, you certify that you are 18 years of age or older and agree
          to our{" "}
          <a href="/terms" className="text-slate-300 hover:text-white underline decoration-slate-500 underline-offset-2 transition-colors">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-slate-300 hover:text-white underline decoration-slate-500 underline-offset-2 transition-colors">
            Privacy Policy
          </a>
          .
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              window.location.href = "https://www.google.com"
            }}
            className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          >
            Leave
          </button>
          <button
            onClick={confirm}
            className="relative overflow-hidden flex-1 py-2.5 rounded-xl bg-white/10 border border-white/25 text-white text-[12px] font-semibold hover:bg-white/15 transition-colors"
          >
            <span
              className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none"
              style={{ animation: "age-gate-sheen 2.6s infinite" }}
            />
            I am 18 or older — Enter
          </button>
        </div>
      </div>
    </div>
  )
}
