"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, LayoutDashboard, Sparkles } from "lucide-react"

// Shared chrome for standalone site pages (Contact, Policies, …):
//  - SitePageHeader: slim sticky nav — Back on the left, Dashboard on the right
//  - SiteBrandHero: the page's centerpiece — the admin-uploaded site logo
//    (SystemState.logoUrl, public /api/admin/config read) shown LARGE inside the
//    portal's animated silver rim, over the gradient "AI Design Studio" wordmark.

export function SitePageHeader() {
  const router = useRouter()
  return (
    <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#050810]/90 backdrop-blur-md">
      <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all"
        >
          <ArrowLeft size={13} />
          Back
        </button>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all"
        >
          <LayoutDashboard size={13} />
          Dashboard
        </Link>
      </div>
    </div>
  )
}

// Just the silver-rimmed synced logo box (no wordmark) — for cards/buttons
export function SiteLogoBox({ size = 48, rounded = 12 }: { size?: number; rounded?: number }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/config")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.logoUrl) setLogoUrl(d.logoUrl) })
      .catch(() => {})
  }, [])

  return (
    <span className="relative isolate flex items-center justify-center overflow-hidden shrink-0" style={{ width: size, height: size, borderRadius: rounded }}>
      <span
        className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 animate-spin -z-10"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))",
          animationDuration: "5s",
        }}
      />
      <span className="absolute inset-[1.5px] flex items-center justify-center overflow-hidden bg-slate-900" style={{ borderRadius: rounded - 2 }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="AI Design Studio" className="w-full h-full object-cover" />
        ) : (
          <Sparkles size={Math.round(size * 0.45)} className="text-white/50" />
        )}
      </span>
    </span>
  )
}

// Compact horizontal brand (dashboard header rows): synced logo + stacked wordmark
export function SiteBrandMark({ size = 40 }: { size?: number }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/config")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.logoUrl) setLogoUrl(d.logoUrl) })
      .catch(() => {})
  }, [])

  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="relative isolate flex items-center justify-center rounded-xl overflow-hidden shrink-0" style={{ width: size, height: size }}>
        <span
          className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 animate-spin -z-10"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))",
            animationDuration: "5s",
          }}
        />
        <span className="absolute inset-[1.5px] flex items-center justify-center rounded-[10px] overflow-hidden bg-slate-900">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="AI Design Studio" className="w-full h-full object-cover" />
          ) : (
            <Sparkles size={Math.round(size * 0.45)} className="text-white/50" />
          )}
        </span>
      </span>
      <div className="min-w-0">
        <p className="text-lg font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-none truncate">
          AI Design Studio
        </p>
        <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-slate-500 mt-1">Prompt &amp; Protocol LLC</p>
      </div>
    </div>
  )
}

export function SiteBrandHero() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/config")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.logoUrl) setLogoUrl(d.logoUrl) })
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col items-center text-center">
      {/* Logo — large, with a soft glow so it carries the page */}
      <div className="relative">
        <div className="absolute -inset-8 rounded-full bg-white/[0.07] blur-3xl pointer-events-none" />
        <span className="relative isolate flex items-center justify-center rounded-2xl overflow-hidden shrink-0 w-24 h-24 sm:w-28 sm:h-28">
          <span
            className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 animate-spin -z-10"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))",
              animationDuration: "5s",
            }}
          />
          <span className="absolute inset-[2px] flex items-center justify-center rounded-[14px] overflow-hidden bg-slate-900">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="AI Design Studio" className="w-full h-full object-cover" />
            ) : (
              <Sparkles size={34} className="text-white/50" />
            )}
          </span>
        </span>
      </div>

      {/* Wordmark */}
      <span className="mt-5 text-3xl sm:text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white/85 to-white/55">
        AI Design Studio
      </span>
      <span className="mt-1.5 text-[11px] font-mono uppercase tracking-[0.3em] text-slate-500">
        Prompt &amp; Protocol LLC
      </span>
    </div>
  )
}
