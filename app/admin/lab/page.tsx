"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FlaskConical, Sparkles, ExternalLink, Clapperboard } from "lucide-react"
import AdminScannerPage from "../scanner/page"
import { SITE_EMPLOYEES, LAB_STUDIOS, StudioCard, openLabStudio } from "@/components/employees/EmployeesView"
import { BrandTitle } from "@/components/employees/StudioBrand"

// Lab — the merged testing ground: the admin Scanner, the Studios that are not
// on the public Studios page (Movie Studio, Face Swap Studio, Character Design -
// moved here 2026-10-07; they replaced the Prototype tab, which is now one of
// the quick links), plus quick links to the standalone one-off test pages.

const TEST_PAGES = [
  { name: "Prototype", href: "/admin/prototype" },
  { name: "NanoBanana 2", href: "/admin/nano-banana-2" },
  { name: "NanoBanana 2 Live", href: "/admin/nano-banana-2-live" },
  { name: "SeeDream 5 Lite Edit", href: "/admin/seedream-5-lite-edit" },
  { name: "Kling O3 Video", href: "/admin/video-scanner-kling-o3" },
  { name: "Portal (original)", href: "/admin/portal-original" },
]

type Tab = "scanner" | "studios"

/**
 * The Lab's studios. Their workspaces run inside the portal - they use its Refs
 * library, uploads and feed - so a card opens the portal on that studio; its
 * back link comes back here.
 */
function LabStudios() {
  const studios = SITE_EMPLOYEES.filter(e => LAB_STUDIOS.includes(e.id))
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <BrandTitle
        title="Studios"
        eyebrow="Admin only · not on the Studios page · open in the portal"
        logo={30}
        size="lg"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {studios.map(emp => <StudioCard key={emp.id} emp={emp} onSelect={openLabStudio} />)}
      </div>
    </div>
  )
}

export default function AdminLabPage() {
  const [tab, setTab] = useState<Tab>("scanner")
  // ?tab=studios - where a Lab studio's back link returns to
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("tab") === "studios") setTab("studios") } catch {}
  }, [])
  return (
    <div className="min-h-screen bg-[#050810]">
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#050810]/95 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center gap-2 overflow-x-auto">
          <FlaskConical size={15} className="text-slate-400 shrink-0" />
          <span className="text-sm font-semibold text-white mr-3 shrink-0">Lab</span>
          <button
            onClick={() => setTab("scanner")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 ${tab === "scanner" ? "bg-white/[0.1] text-white border border-white/20" : "text-slate-500 hover:text-white border border-transparent"}`}
          >
            <Sparkles size={12} /> Scanner
          </button>
          <button
            onClick={() => setTab("studios")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 ${tab === "studios" ? "bg-white/[0.1] text-white border border-white/20" : "text-slate-500 hover:text-white border border-transparent"}`}
          >
            <Clapperboard size={12} /> Studios
          </button>
          <span className="mx-1 h-4 w-px bg-white/10 shrink-0" />
          {TEST_PAGES.map(p => (
            <Link key={p.href} href={p.href}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-600 hover:text-slate-300 transition-colors shrink-0">
              {p.name} <ExternalLink size={9} />
            </Link>
          ))}
        </div>
      </div>
      {tab === "scanner" ? <AdminScannerPage /> : <LabStudios />}
    </div>
  )
}
