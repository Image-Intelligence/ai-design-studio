"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0e0e18] shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <span className="text-cyan-300 text-sm font-bold">18+</span>
          </div>
          <h2 className="text-white text-base font-semibold">Adults Only</h2>
        </div>
        <p className="text-slate-400 text-[13px] leading-relaxed mb-3">
          This website contains AI-generated content intended for adults. You must
          be at least 18 years of age (or the age of majority in your jurisdiction)
          to enter.
        </p>
        <p className="text-slate-500 text-[12px] leading-relaxed mb-5">
          By entering, you certify that you are 18 years of age or older and agree
          to our{" "}
          <a href="/terms" className="text-cyan-400 hover:text-cyan-300 underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-cyan-400 hover:text-cyan-300 underline">
            Privacy Policy
          </a>
          .
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              window.location.href = "https://www.google.com"
            }}
            className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] text-slate-400 hover:bg-white/[0.06] transition-colors"
          >
            Leave
          </button>
          <button
            onClick={confirm}
            className="flex-1 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[12px] font-semibold hover:bg-cyan-500/30 transition-colors"
          >
            I am 18 or older — Enter
          </button>
        </div>
      </div>
    </div>
  )
}
