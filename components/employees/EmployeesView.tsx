"use client"

import { useState } from "react"
import { Clapperboard, ScanFace, Lock, ArrowLeft, UsersRound, Box, Film, ShieldAlert } from "lucide-react"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { EMPLOYEE_ADMIN_ONLY, employeeVisibleTo, type EmployeeId } from "@/lib/employees"

export type { EmployeeId }

/**
 * The Employees section of portal-v2.
 *
 * The chat hub exposes every employee through one conversational surface. This
 * is the opposite: a small, fixed set of employees the site actually ships,
 * each with a purpose-built UI that hides the conversation and asks only for
 * what that job needs. The employee behind it is the same one the hub runs.
 *
 * Released one at a time: each employee's admin-only flag lives in
 * lib/employees.ts. A gated one is shown to admins alone, with a red
 * "Admin model" badge; everyone else never sees it. This component fails
 * closed on top of the taskbar gate.
 */

export type EmployeeDef = {
  id: EmployeeId
  name: string
  tagline: string
  blurb: string
  icon: typeof Clapperboard
  /** Tailwind accent used for the card edge and icon. */
  accent: string
  /**
   * Opens over the picker instead of as a workspace inside it. The frame
   * extractor is a modal already; wrapping it in a second shell would give it
   * two headers and two close buttons.
   */
  opensOverlay?: boolean
}

export const SITE_EMPLOYEES: EmployeeDef[] = [
  {
    id: "movie-studio",
    name: "Movie Studio",
    tagline: "Stills in, finished film out",
    blurb:
      "Give it your characters, a setting, a look — up to 16 references — and a line about the story. "
      + "It plans the film with you, shoots it shot by shot across the best video models, then cuts and scores it.",
    icon: Clapperboard,
    accent: "fuchsia",
  },
  {
    id: "face-swap",
    name: "Face Swap Studio",
    tagline: "One face, one body, one result",
    blurb:
      "Upload the face and the body. No prompt, no settings — it handles the matching, the blending and the "
      + "cleanup, and the finished image lands in your feed.",
    icon: ScanFace,
    accent: "cyan",
  },
  {
    id: "character-design",
    name: "Character Design",
    tagline: "One character, fully designed",
    blurb:
      "Bring references of a character — or just describe one — and it locks the design down: a written "
      + "canon description plus turnarounds, expressions, poses, wardrobe and accessories, every sheet checked "
      + "against the same face.",
    icon: UsersRound,
    accent: "violet",
  },
  {
    id: "3d-studio",
    name: "3D Studio",
    tagline: "Meshes, scenes and rigs",
    blurb:
      "Turn a reference or a prompt into a 3D model, then texture, rig and animate it across the fal 3D suite. "
      + "Every result opens in the viewer and saves to your library.",
    icon: Box,
    accent: "emerald",
  },
  {
    id: "frames",
    name: "Frames Studio",
    tagline: "The best stills out of any video",
    blurb:
      "Drop in a video and it pulls every frame, ranks them by sharpness and flags motion blur, so the frames "
      + "worth keeping are at the top. Send them to your references or download them as a ZIP.",
    icon: Film,
    accent: "amber",
    opensOverlay: true,
  },
]

const ACCENTS: Record<string, { ring: string; icon: string; glow: string }> = {
  fuchsia: {
    ring: "border-fuchsia-500/30 hover:border-fuchsia-400/60",
    icon: "text-fuchsia-400",
    glow: "from-fuchsia-500/[0.10]",
  },
  cyan: {
    ring: "border-cyan-500/30 hover:border-cyan-400/60",
    icon: "text-cyan-400",
    glow: "from-cyan-500/[0.10]",
  },
  violet: {
    ring: "border-violet-500/30 hover:border-violet-400/60",
    icon: "text-violet-400",
    glow: "from-violet-500/[0.10]",
  },
  emerald: {
    ring: "border-emerald-500/30 hover:border-emerald-400/60",
    icon: "text-emerald-400",
    glow: "from-emerald-500/[0.10]",
  },
  amber: {
    ring: "border-amber-500/30 hover:border-amber-400/60",
    icon: "text-amber-400",
    glow: "from-amber-500/[0.10]",
  },
}

/** The red marker on anything not yet released. Shared with the home page. */
export function AdminModelBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-red-500/35 bg-red-500/10 text-[9px] font-bold uppercase tracking-wider text-red-300">
      <ShieldAlert size={9} className="text-red-400" />
      Admin model
    </span>
  )
}

export function EmployeesView({
  isAdmin,
  active,
  onSelect,
  logo,
  children,
}: {
  isAdmin: boolean
  /** The employee whose workspace is open, or null for the picker. */
  active: EmployeeId | null
  onSelect: (id: EmployeeId | null) => void
  /** The site's own logo control, so this section carries the same mark. */
  logo?: React.ReactNode
  /** The active employee's workspace, rendered by the page. */
  children?: React.ReactNode
}) {
  const [hovered, setHovered] = useState<EmployeeId | null>(null)
  // Only what this account may open. Admins see everything, badged.
  const visible = SITE_EMPLOYEES.filter(e => employeeVisibleTo(e.id, isAdmin))

  // Fails closed: nothing released and not an admin means nothing to show.
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Lock size={22} className="text-slate-600" />
        <p className="text-sm text-slate-400">Studios are not available on this account yet.</p>
      </div>
    )
  }

  if (active && employeeVisibleTo(active, isAdmin)) {
    const def = SITE_EMPLOYEES.find(e => e.id === active)
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 shrink-0">
          {logo}
          <button
            onClick={() => onSelect(null)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={13} /> Studios
          </button>
          {def && (
            <>
              <span className="text-slate-700">/</span>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                <def.icon size={13} className={ACCENTS[def.accent]?.icon} />
                {def.name}
              </span>
            </>
          )}
          {EMPLOYEE_ADMIN_ONLY[active] && <span className="ml-auto"><AdminModelBadge /></span>}
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    )
  }

  return (
    <div className="px-3 sm:px-6 py-6 sm:py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          {logo}
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-100">Studios</h1>
        </div>
        <p className="text-xs text-slate-500 mb-6">
          Workspaces built for one job each. Pick one to start.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map(emp => {
            const a = ACCENTS[emp.accent] ?? ACCENTS.cyan
            return (
              <button
                key={emp.id}
                onClick={() => onSelect(emp.id)}
                onPointerEnter={() => setHovered(emp.id)}
                onPointerLeave={() => setHovered(null)}
                className={`group relative overflow-hidden text-left rounded-2xl border bg-white/[0.02] p-4 sm:p-5 transition-all ${a.ring} ${
                  hovered === emp.id ? "translate-y-[-1px]" : ""
                }`}
              >
                {/* Same animated silver rim the home cards and prompt box use */}
                <SilverRimOverlay />
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${a.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                <div className="relative flex items-start gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center">
                    <emp.icon size={18} className={a.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-slate-100">{emp.name}</div>
                      {/* Per employee, so they can be released one at a time. */}
                      {EMPLOYEE_ADMIN_ONLY[emp.id] && <AdminModelBadge />}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{emp.tagline}</div>
                    <p className="text-[11px] leading-relaxed text-slate-400">{emp.blurb}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
