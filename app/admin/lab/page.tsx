"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FlaskConical, Sparkles, ExternalLink, Clapperboard, MessagesSquare, ArrowRight, SlidersHorizontal } from "lucide-react"
import { ChatProviderSettings, ChatLayoutSettings, ChatAgentSettings, ChatAgentCapabilities, ChatApiKeysSettings } from "@/components/chat-hub"
import AdminScannerPage from "../scanner/page"
import { SITE_EMPLOYEES, LAB_STUDIOS, StudioCard, openLabStudio, AdminModelBadge } from "@/components/employees/EmployeesView"
import { BrandTitle } from "@/components/employees/StudioBrand"

// Lab — the merged testing ground: the admin Scanner, the Studios that are not
// on the public Studios page (Movie Studio, Face Swap Studio, Character Design -
// moved here 2026-10-07; they replaced the Prototype tab, which is now one of
// the quick links), the AI Chat Hub (2026-10-12), plus quick links to the
// standalone one-off test pages.

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
 * The AI Chat Hub (2026-10-12): moved here from the portal's logo menu and the
 * home page's admin tools. It is a view of the portal (its Refs, uploads and
 * feed), so the card opens the portal on it, like the studios above.
 */
function openChatHub() {
  try { sessionStorage.setItem("pv2-view-mode", "chat") } catch {}
  window.location.href = "/"
}

function ChatHubCard() {
  return (
    <button
      onClick={openChatHub}
      className="group relative isolate flex flex-col text-left rounded-2xl overflow-hidden border border-white/[0.08] bg-[#070b14] silver-edge transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className="relative aspect-video overflow-hidden shrink-0 bg-[radial-gradient(120%_90%_at_30%_20%,rgba(226,232,240,0.10),transparent_60%),linear-gradient(160deg,#0d1220,#05070d)]">
        <div className="absolute inset-0 flex items-center justify-center">
          <MessagesSquare size={56} strokeWidth={1.2} className="text-slate-300/70 transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#070b14] to-transparent" />
        <span className="absolute top-3 left-3 w-9 h-9 rounded-xl border border-white/15 bg-black/55 flex items-center justify-center">
          <MessagesSquare size={16} className="text-slate-200" />
        </span>
        <span className="absolute top-3 right-3"><AdminModelBadge /></span>
      </div>
      <div className="relative flex flex-col gap-2 p-4 sm:p-5 flex-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-400">Multi-provider chat</div>
        <div className="font-black tracking-tight text-slate-50 text-lg sm:text-xl">AI Chat Hub</div>
        <p className="text-[12.5px] leading-relaxed text-slate-400 line-clamp-3">Chat with any model, hand work to the studio employees, and make or edit media from the conversation.</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {["Any provider", "Agents", "Media tools"].map(h => (
            <span key={h} className="px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-[10.5px] text-slate-300">{h}</span>
          ))}
        </div>
        <div className="pt-2 mt-auto flex items-center gap-1.5 text-[12px] font-bold text-slate-200 group-hover:text-white">
          Open chat hub
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  )
}

/**
 * The AI Chat Hub's settings (2026-10-12): moved here from the portal's
 * profile menu. They are stored on the account (and in this browser), so the
 * hub picks them up when it opens.
 */
const CHAT_TABS = [
  ["layout", "Layout"],
  ["providers", "Providers"],
  ["agent", "Agent"],
  ["capabilities", "Capabilities"],
  ["keys", "API Keys"],
] as const

function ChatHubSettings() {
  const [tab, setTab] = useState<(typeof CHAT_TABS)[number][0]>("layout")
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#070b14] silver-edge overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <SlidersHorizontal size={14} className="text-slate-300 shrink-0" />
        <span className="text-sm text-white font-medium">Chat Hub settings</span>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Admin only</span>
      </div>
      <div className="flex border-b border-white/5 overflow-x-auto">
        {CHAT_TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 min-w-[96px] py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              tab === id
                ? "border-white/80 text-white bg-white/[0.05]"
                : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="px-4 py-4 max-w-3xl">
        {tab === "layout" && <ChatLayoutSettings />}
        {tab === "providers" && <ChatProviderSettings />}
        {tab === "agent" && <ChatAgentSettings />}
        {tab === "capabilities" && <ChatAgentCapabilities />}
        {tab === "keys" && <ChatApiKeysSettings />}
      </div>
    </section>
  )
}

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
        <ChatHubCard />
      </div>
      <ChatHubSettings />
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
