"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { SITE_EMPLOYEES, STUDIO_MEDIA, StudioMedia } from "@/components/employees/EmployeesView"
import { employeeVisibleTo, type EmployeeId } from "@/lib/employees"

/*
 * The live studios on the dashboard (2026-10-08): Image Studio, Storyboard
 * Studio and the Frame Extractor, each a card with the Studios page's art (its
 * still, and its loop where it has one, taking turns with the page's other
 * videos). A card opens the studio (/) straight on that studio: the portal
 * restores "pv2-view-mode" + "pv2-employee" on load, and the Frame Extractor -
 * a popup there, not a workspace - reads the one-time "pv2-open-frames".
 */

const LIVE: EmployeeId[] = ["image-studio", "storyboard", "frames"]

/** Each studio's eyebrow colour and its three words, like the home page panels. */
const LOOK: Partial<Record<EmployeeId, { eyebrow: string; steps: string }>> = {
  "image-studio": { eyebrow: "text-rose-300/90", steps: "Layers · Masks · AI select" },
  storyboard: { eyebrow: "text-sky-300/90", steps: "Plan · Shoot · Final Cut" },
  frames: { eyebrow: "text-amber-200/90", steps: "Upload · Rank · Keep the best" },
}

function openStudio(id: EmployeeId) {
  try {
    if (id === "frames") {
      // The popup opens over the feed
      sessionStorage.setItem("pv2-view-mode", "image")
      sessionStorage.setItem("pv2-open-frames", "1")
    } else {
      sessionStorage.setItem("pv2-view-mode", "employees")
      sessionStorage.setItem("pv2-employee", id)
    }
  } catch {}
}

export function StudioLaunchers({ isAdmin, className = "" }: { isAdmin: boolean; className?: string }) {
  const studios = LIVE.map(id => SITE_EMPLOYEES.find(e => e.id === id)).filter(e => e && employeeVisibleTo(e.id, isAdmin))
  if (!studios.length) return null
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 xl:gap-4 ${className}`}>
      {studios.map(emp => {
        const e = emp!
        const media = STUDIO_MEDIA[e.id]
        const look = LOOK[e.id]
        const Icon = e.icon
        return (
          <Link
            key={e.id}
            href="/"
            onClick={() => openStudio(e.id)}
            className="group relative isolate block min-h-[150px] aspect-[16/9] sm:aspect-[4/3] lg:aspect-video xl:aspect-auto xl:h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1a] transition-all duration-200 hover:border-white/30 hover:scale-[1.004]"
          >
            {media && <StudioMedia poster={media.poster} video={media.video} className="transition-transform duration-500 group-hover:scale-[1.03]" />}
            {/* The words sit on a dark fade at the foot, never on bare art */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 sm:p-3.5 xl:p-4">
              <span className="hidden sm:flex xl:short:hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-black/50 text-white backdrop-blur-sm">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                {look && <p className={`text-[9px] font-mono uppercase tracking-[0.2em] leading-none mb-1 truncate ${look.eyebrow}`}>{look.steps}</p>}
                <p className="text-sm xl:text-base 2xl:text-lg font-black text-white leading-tight truncate">{e.name}</p>
                <p className="text-[11px] xl:text-xs text-slate-300/90 leading-snug truncate">{e.tagline}</p>
              </div>
              <span className="relative overflow-hidden shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/25 text-white text-[11px] font-bold backdrop-blur-sm group-hover:bg-white/20 group-hover:border-white/40 transition-all">
                {e.cta ?? "Open"} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
