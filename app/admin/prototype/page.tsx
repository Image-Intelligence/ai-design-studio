"use client"

import { useEffect, useState, useRef } from "react"
import { FlaskConical, ChevronLeft, ChevronRight, Loader2, FolderInput } from "lucide-react"
import Link from "next/link"

const SECTIONS = ["Workspace", "Prototype", "Updating", "In Development", "Archived"] as const
type Section = typeof SECTIONS[number]

const SECTION_DOT: Record<Section, string> = {
  "Workspace":      "bg-green-400",
  "Prototype":      "bg-amber-400",
  "Updating":       "bg-fuchsia-400",
  "In Development": "bg-violet-400",
  "Archived":       "bg-slate-600",
}

const DEFAULT_PROTOTYPES: { name: string; description: string; href: string; status: Section; accent: string; features: string[] }[] = [
  {
    name: "NanoBanana Pro 2 — Live",
    description: "Live fal-ai/nano-banana-2 with full param control: aspect ratio, resolution, safety, web search, seed.",
    href: "/admin/nano-banana-2-live",
    status: "Workspace",
    accent: "text-green-400",
    features: ["All Params", "4K", "Web Search"],
  },
  {
    name: "Scanner Canvas",
    description: "Canvas-based AI scanner with infinite canvas, 3 view modes, 6 scanners, reference panel, session saving.",
    href: "/prompting-studio/canvas",
    status: "Updating",
    accent: "text-fuchsia-400",
    features: ["Infinite Canvas", "3 View Modes", "Session Saving"],
  },
  {
    name: "SeedDream 5.0 Lite Edit",
    description: "Multi-image AI editor. Upload up to 10 reference images and edit with natural language prompts.",
    href: "/admin/seedream-5-lite-edit",
    status: "Prototype",
    accent: "text-teal-400",
    features: ["10 Images", "Edit Mode", "2K–3K"],
  },
  {
    name: "NanoBanana Pro 2",
    description: "Full-parameter prototype for fal-ai/nano-banana-2.",
    href: "/admin/nano-banana-2",
    status: "Prototype",
    accent: "text-amber-400",
    features: ["All Params", "4K", "Web Search"],
  },
  {
    name: "Custom Model Scanner",
    description: "Create reusable custom models from up to 8 reference images for consistent generations.",
    href: "/custom-model-scanner",
    status: "In Development",
    accent: "text-purple-400",
    features: ["Custom Models", "8 References", "Reusable"],
  },
  {
    name: "Composition Canvas",
    description: "Layer-based AI composition with multi-layer support, grid regen, inpainting, and 4K export.",
    href: "/composition-canvas",
    status: "In Development",
    accent: "text-purple-400",
    features: ["Multi-layer", "Inpainting", "4K Export"],
  },
  {
    name: "AI Canvas",
    description: "Drawing and painting tool with AI-powered generation.",
    href: "/ai-canvas",
    status: "In Development",
    accent: "text-emerald-400",
    features: ["Draw & Paint", "Upload Images", "AI Gen"],
  },
  {
    name: "Portal V2",
    description: "New main page redesign — taskbar with model dropdowns and profile bubble.",
    href: "/",
    status: "In Development",
    accent: "text-cyan-400",
    features: ["New UI", "Taskbar", "Model Dropdowns"],
  },
  {
    name: "Video Scanner — Kling O3",
    description: "Archived scanner with WAN 2.5, Kling O3, and Kling 3.0. Kling O3 removed from live scanner.",
    href: "/admin/video-scanner-kling-o3",
    status: "Archived",
    accent: "text-orange-400",
    features: ["WAN 2.5", "Kling O3", "Kling 3.0"],
  },
  {
    name: "Multiverse Portal V1",
    description: "Original portal design preserved as an archive before the AI Design Studio rebrand.",
    href: "/admin/portal-original",
    status: "Archived",
    accent: "text-cyan-400",
    features: ["Original Design", "Cyan/Purple", "Reference"],
  },
  {
    name: "Legacy Scanner — Main",
    description: "Original main scanner page with model selector, reference upload, prompt builder, and 6-slot generation queue.",
    href: "/scanner",
    status: "Archived",
    accent: "text-violet-400",
    features: ["Model Selector", "6-Slot Queue", "Ref Images"],
  },
  {
    name: "Video Scanner",
    description: "Dedicated video generation page with WAN 2.5, Kling, and other video models.",
    href: "/video-scanner",
    status: "Archived",
    accent: "text-orange-400",
    features: ["WAN 2.5", "Kling", "Video Gen"],
  },
  {
    name: "Legacy Scanner — Studio",
    description: "Original single-panel prompting studio scanner with model selector, reference upload, prompt builder, 6-slot queue.",
    href: "/prompting-studio/legacy",
    status: "Archived",
    accent: "text-slate-400",
    features: ["Model Selector", "6-Slot Queue", "Ref Images"],
  },
]

const STORAGE_KEY = "admin-prototype-sections"

function loadSectionOverrides(): Record<string, Section> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
  } catch {
    return {}
  }
}

function saveSectionOverrides(overrides: Record<string, Section>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

// Small popover for moving a prototype to another section
function MoveMenu({ current, onMove }: { current: Section; onMove: (s: Section) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        title="Move to section"
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] text-slate-600 hover:text-slate-300 transition-all"
      >
        <FolderInput size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-white/[0.1] bg-[#111118] shadow-xl py-1">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-3 pt-1.5 pb-1">Move to</p>
          {SECTIONS.map(s => (
            <button
              key={s}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMove(s); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.05] transition-colors text-left ${s === current ? "text-white font-semibold" : "text-slate-400"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SECTION_DOT[s]}`} />
              {s}
              {s === current && <span className="ml-auto text-[10px] text-slate-600">current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminPrototypePage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Section>>({})

  useEffect(() => {
    const auth = localStorage.getItem("multiverse-admin-auth")
    const pass = sessionStorage.getItem("admin-password")
    if (auth === "true" && pass) {
      setAuthed(true)
      setOverrides(loadSectionOverrides())
    } else {
      setAuthed(false)
    }
  }, [])

  const movePrototype = (name: string, newSection: Section) => {
    const next = { ...overrides, [name]: newSection }
    setOverrides(next)
    saveSectionOverrides(next)
  }

  if (authed === null) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center">
        <Loader2 size={20} className="text-slate-600 animate-spin" />
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-slate-400 mb-4 text-sm">Admin authentication required.</p>
          <button onClick={() => window.location.href = "/admin"}
            className="text-sm text-cyan-400 hover:underline">Go to Admin Login</button>
        </div>
      </div>
    )
  }

  // Apply overrides to get effective section for each prototype
  const prototypes = DEFAULT_PROTOTYPES.map(p => ({
    ...p,
    status: (overrides[p.name] ?? p.status) as Section,
  }))

  const grouped = Object.fromEntries(
    SECTIONS.map(s => [s, prototypes.filter(p => p.status === s)])
  ) as Record<Section, typeof prototypes>

  return (
    <div className="min-h-screen bg-[#09090f] relative">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-violet-500/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-5 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.href = "/admin"}
              className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center hover:bg-white/[0.07] transition-colors text-slate-400 hover:text-white"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <FlaskConical size={16} className="text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Prototype Lab</h1>
              <p className="text-[11px] text-slate-600 mt-0.5">Experimental features</p>
            </div>
          </div>
          <span className="text-[11px] text-slate-600">{prototypes.length} prototypes</span>
        </div>

        {/* Grouped sections */}
        <div className="space-y-6">
          {SECTIONS.map(section => {
            const items = grouped[section]
            if (items.length === 0) return null
            return (
              <div key={section}>
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2 px-0.5">
                  {section}
                </p>
                <div className="space-y-1.5">
                  {items.map(proto => (
                    <div key={proto.name} className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all">
                      {/* Status dot */}
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SECTION_DOT[section]}`} />

                      {/* Clickable name + description */}
                      <Link href={proto.href} className="flex-1 min-w-0 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-none ${proto.accent}`}>{proto.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-1">{proto.description}</p>
                        </div>
                        {/* Feature tags */}
                        <div className="hidden sm:flex items-center gap-1 shrink-0">
                          {proto.features.map(f => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-slate-500">
                              {f}
                            </span>
                          ))}
                        </div>
                        <ChevronRight size={13} className="text-slate-700 group-hover:text-slate-500 shrink-0 transition-colors" />
                      </Link>

                      {/* Move menu */}
                      <MoveMenu current={section} onMove={(s) => movePrototype(proto.name, s)} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
