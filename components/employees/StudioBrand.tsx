"use client"

import { SiteLogoBox } from "@/components/SitePageHeader"

/*
 * The site's brand, as the Studios wear it: the synced logo (the admin-uploaded
 * SystemState.logoUrl in its spinning silver ring), silver-shimmer titles and
 * silver-on-glass buttons - the treatment the Movie Studio's main button and
 * the Storyboard Studio's Draft with AI panel set. One place, so every studio
 * page carries the same mark rather than its own accent colour.
 *
 * Animated rims (SilverRimOverlay) are for a page's one or two hero panels
 * only; everything else takes the static `.silver-edge` (app/globals.css),
 * since many spinning rims on one screen made iPads drop frames.
 */

type BrandButtonProps = {
  onClick?: () => void
  onBlur?: () => void
  disabled?: boolean
  /** Working: a spinner takes the logo's place. */
  busy?: boolean
  /** The page's next move: brighter, with the light sweep. */
  primary?: boolean
  /** A confirm step ("Shoot 7 for 120 tickets?") - amber, the site's warning colour. */
  warn?: boolean
  size?: "xs" | "sm" | "md" | "lg"
  title?: string
  className?: string
  /** Something other than the logo in the icon slot (rarely - the logo IS the point). */
  icon?: React.ReactNode
  children: React.ReactNode
}

const SIZES = {
  xs: { pad: "px-2 py-1 gap-1 text-[10px] rounded-md", logo: 12, radius: 3 },
  sm: { pad: "px-2.5 py-1.5 gap-1.5 text-[10.5px] rounded-lg", logo: 14, radius: 4 },
  md: { pad: "px-3.5 py-2 gap-1.5 text-[11.5px] rounded-lg", logo: 16, radius: 4 },
  lg: { pad: "px-4 py-2.5 gap-2 text-[12.5px] rounded-xl", logo: 18, radius: 5 },
} as const

export function BrandButton({ onClick, onBlur, disabled, busy, primary, warn, size = "sm", title, className = "", icon, children }: BrandButtonProps) {
  const s = SIZES[size]
  return (
    <button
      onClick={onClick}
      onBlur={onBlur}
      disabled={disabled}
      title={title}
      className={`relative overflow-hidden inline-flex items-center justify-center font-bold whitespace-nowrap transition-all ${s.pad} ${
        disabled
          ? "bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed"
          : warn
          ? "bg-amber-400 border border-amber-300 text-black hover:bg-amber-300"
          : primary
          ? "bg-white/[0.12] border border-white/30 text-white hover:bg-white/[0.18] hover:border-white/50"
          : "bg-white/[0.05] border border-white/15 text-slate-100 hover:bg-white/10 hover:border-white/30"
      } ${className}`}
    >
      {!disabled && primary && !warn && (
        <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" style={{ animation: "sheen-sweep 2.6s infinite" }} />
      )}
      {busy
        ? <span className="shrink-0 rounded-full border-2 border-white/25 border-t-slate-200 animate-spin" style={{ width: s.logo - 2, height: s.logo - 2 }} />
        : icon ?? <SiteLogoBox size={s.logo} rounded={s.radius} />}
      <span className="relative inline-flex items-center gap-1 min-w-0">{children}</span>
    </button>
  )
}

/** A panel's heading: the logo, a silver-shimmer title, and a small eyebrow under it. */
export function BrandTitle({ title, eyebrow, logo = 26, size = "md", right }: {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  /** Logo size in px; 0 hides it. */
  logo?: number
  size?: "sm" | "md" | "lg"
  right?: React.ReactNode
}) {
  const t = size === "lg" ? "text-lg sm:text-xl" : size === "sm" ? "text-[11.5px]" : "text-[13px]"
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logo > 0 && <SiteLogoBox size={logo} rounded={Math.round(logo / 4)} />}
      <div className="min-w-0">
        <div className={`${t} font-black tracking-tight leading-tight silver-shimmer-text truncate`}>{title}</div>
        {eyebrow && <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 truncate">{eyebrow}</div>}
      </div>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  )
}
