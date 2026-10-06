"use client"

/*
 * Shared pieces of the shop pages (/buy-tickets and the Dev Tier subscribe
 * page): the sitewide animated silver rim, a looping hero/showcase clip, and
 * the full-width top bar.
 */

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { SiteLogoBox } from "@/components/SitePageHeader"

/** The public bucket the shop visuals live on. */
export const SHOP_MEDIA = "https://pub-738a6d61c61a473595356856a86615a1.r2.dev"

// The sitewide animated silver rim (age gate / portal): a thin masked band
// around the card with the rotating conic highlight inside it.
export function SilverRim({ rounded = "rounded-2xl" }: { rounded?: string }) {
  return (
    <div
      className={`absolute inset-0 ${rounded} overflow-hidden pointer-events-none z-20`}
      style={{
        padding: "1.5px",
        WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        maskComposite: "exclude",
      } as React.CSSProperties}
    >
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[300%] animate-spin rim-spin"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))",
          animationDuration: "5s",
        }}
      />
    </div>
  )
}

/*
 * A looping, muted clip that plays only while it is on screen (and never for
 * viewers who asked for less motion). Started from code rather than the
 * autoPlay attribute: React sets `muted` as a property, not an attribute, so
 * some browsers refuse attribute autoplay; and several clips on a phone should
 * not all decode at once. The poster shows until then.
 */
export function LoopVideo({ src, poster, className }: { src: string; poster?: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    let reduce = false
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches } catch {}
    if (reduce) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => {})
      else v.pause()
    }, { threshold: 0.25 })
    io.observe(v)
    return () => io.disconnect()
  }, [src])
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      className={className}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
    />
  )
}

/** Full-width sticky top bar: Back, the synced logo and the page title on the left, `right` on the right. */
export function ShopHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter()
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#05080f]/85 backdrop-blur-md">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-10 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/admin/portal-v2"))}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all flex-shrink-0"
          >
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <SiteLogoBox size={32} rounded={9} />
          <span className="font-black tracking-tight text-sm sm:text-base bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">{right}</div>
      </div>
    </header>
  )
}

/** Faint silver grid + soft glows behind a shop page. */
export function ShopBackdrop() {
  return (
    <>
      <div className="fixed inset-0 bg-[linear-gradient(rgba(226,232,240,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(226,232,240,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-32 -left-24 w-[28rem] h-[28rem] bg-slate-400/[0.05] rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 -right-24 w-[32rem] h-[32rem] bg-indigo-300/[0.04] rounded-full blur-3xl pointer-events-none" />
    </>
  )
}

/** The legal/support links at the foot of a shop page. */
export function ShopFooter() {
  return (
    <footer className="mt-12 pt-4 border-t border-white/5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
      <a href="/terms" className="hover:text-slate-400 transition-colors">Terms</a>
      <span>·</span>
      <a href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</a>
      <span>·</span>
      <a href="/refund" className="hover:text-slate-400 transition-colors">Refunds</a>
      <span>·</span>
      <a href="/report" className="hover:text-slate-400 transition-colors">Report Content</a>
      <span>·</span>
      <a href="mailto:promptandprotocol@gmail.com" className="hover:text-slate-400 transition-colors">Support</a>
    </footer>
  )
}
