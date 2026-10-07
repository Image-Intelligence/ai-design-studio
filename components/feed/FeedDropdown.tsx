"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { LayoutGrid, EyeOff, ChevronDown } from "lucide-react"
import { SiteLogoBox } from "@/components/SitePageHeader"

// Feed settings dropdown for the my-generations page. Copied from the portal-v2
// FeedDropdown with the admin feed-filter section removed, and in the site's
// silver brand (2026-10-07): the synced logo in its header, silver selections
// instead of the old cyan.
// Exposes: Columns, Page Size, View Hidden (optional), Full Size, Layout, Packing, Quality.
// On /my-generations it is admin-only and edits the layout for every account
// (see lib/mygen-feed-settings.ts); `scope` and `status` say so in its header.

const ON = "bg-white/[0.14] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
const OFF = "text-slate-500 hover:text-white hover:bg-white/5"

// Segmented pill control.
function FeedSeg<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/30">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${value === opt.value ? ON : OFF}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Label + control row for the nested Full Size options.
function FeedOptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium text-slate-400">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ON/OFF toggle row.
function FeedToggleRow({ label, icon, on, onChange }: {
  label: string
  icon?: ReactNode
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium transition-all ${on ? "bg-white/[0.10] border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.07] hover:text-white"}`}
    >
      <span className="flex items-center gap-1.5">{icon}{label}</span>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${on ? "bg-white/90 text-black" : "bg-white/10 text-slate-500"}`}>{on ? "ON" : "OFF"}</span>
    </button>
  )
}

function SectionLabel({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-slate-500">{children}</span>
      {value !== undefined && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none border border-white/15 text-slate-200">{value}</span>}
    </div>
  )
}

export function FeedDropdown({
  open,
  onToggle,
  cols,
  onColsChange,
  fullSize,
  onFullSizeChange,
  fullSizeLayout,
  onFullSizeLayoutChange,
  masonryMode,
  onMasonryModeChange,
  tileRes,
  onTileResChange,
  showHidden,
  onShowHiddenChange,
  pageSize,
  onPageSizeChange,
  scope,
  status,
}: {
  open: boolean
  onToggle: () => void
  cols: number | null
  onColsChange: (n: number | null) => void
  fullSize: boolean
  onFullSizeChange: (on: boolean) => void
  fullSizeLayout: "grid" | "masonry"
  onFullSizeLayoutChange: (layout: "grid" | "masonry") => void
  masonryMode: "flow" | "rows"
  onMasonryModeChange: (mode: "flow" | "rows") => void
  tileRes: "thumb" | "full"
  onTileResChange: (res: "thumb" | "full") => void
  /** Omit both to leave out the View Hidden row. */
  showHidden?: boolean
  onShowHiddenChange?: (on: boolean) => void
  pageSize: number
  onPageSizeChange: (n: number) => void
  /** A note beside the title, e.g. "All users". */
  scope?: string
  /** Right side of the header, e.g. a saving indicator. */
  status?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (ref.current && !ref.current.contains(el)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const panelW = Math.min(540, window.innerWidth - 16)
      // Right-aligned to the button where it fits: it sits at the right of the toolbar
      const left = Math.min(rect.right - panelW, window.innerWidth - panelW - 8)
      setMenuPos({ top: rect.bottom + 8, left: Math.max(8, left) })
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        title="Feed layout - admins only, applies to every account"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
          open ? "border-white/30 bg-white/[0.12] text-white" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white"
        }`}
      >
        <LayoutGrid size={12} />
        <span className="hidden sm:inline">Feed</span>
        {cols !== null && (
          <span className="text-[10px] font-mono bg-white/15 text-white px-1.5 py-0.5 rounded-full leading-none">{cols}</span>
        )}
        {showHidden && (
          <EyeOff size={11} className="text-slate-300 shrink-0" aria-label="Viewing hidden generations" />
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-[min(540px,calc(100vw-16px))] rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322]/[0.97] to-[#080b14]/[0.97] backdrop-blur-md shadow-2xl z-[9999] overflow-hidden" style={{ top: menuPos.top, left: menuPos.left }}>
          {/* Header */}
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-white/[0.06]">
            <SiteLogoBox size={24} rounded={6} />
            <div className="min-w-0">
              <div className="text-[13px] font-black tracking-tight leading-tight silver-shimmer-text">Feed Settings</div>
              <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500">Layout · columns · quality</div>
            </div>
            {scope && <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/20 text-[9px] font-bold uppercase tracking-wider text-slate-200">{scope}</span>}
            {status && <span className="ml-auto text-[10px] text-slate-400">{status}</span>}
          </div>

          <div className="p-3.5 space-y-3 max-h-[calc(100vh-140px)] overflow-y-auto">
            {/* Two-column layout: Columns + View | Display */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <div className="space-y-3">
                {/* COLUMNS */}
                <section className="space-y-2">
                  <SectionLabel value={cols ?? "Auto"}>Columns</SectionLabel>
                  <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/30">
                    <button onClick={() => onColsChange(null)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${cols === null ? ON : OFF}`}>Auto</button>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <button key={n} onClick={() => onColsChange(n)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium border-l border-white/10 transition-colors ${cols === n ? ON : OFF}`}>{n}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5 px-0.5">
                    <span className="text-[10px] font-mono text-slate-600">1</span>
                    <input type="range" min={1} max={8} step={1} value={cols ?? 4} onChange={e => onColsChange(+e.target.value)} className="flex-1 accent-slate-200 cursor-pointer" />
                    <span className="text-[10px] font-mono text-slate-600">8</span>
                  </div>
                  <p className="text-[9.5px] text-slate-600 leading-relaxed"><span className="text-slate-300">Auto</span> adapts to the screen size.</p>
                </section>

                {/* PAGE SIZE */}
                <section className="border-t border-white/[0.06] pt-3 space-y-2">
                  <SectionLabel value={pageSize}>Page Size</SectionLabel>
                  <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/30">
                    {[8, 12, 24, 48, 96].map((n, i) => (
                      <button
                        key={n}
                        onClick={() => onPageSizeChange(n)}
                        className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${pageSize === n ? ON : OFF}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9.5px] text-slate-600 leading-relaxed">Generations shown per page.</p>
                </section>

                {/* VIEW */}
                {onShowHiddenChange && (
                  <section className="border-t border-white/[0.06] pt-3 space-y-1.5">
                    <SectionLabel>View</SectionLabel>
                    <FeedToggleRow label="View Hidden" icon={<EyeOff size={11} />} on={!!showHidden} onChange={onShowHiddenChange} />
                    {showHidden && <p className="text-[9.5px] text-slate-600 leading-relaxed px-0.5">Showing only hidden generations - select them to unhide.</p>}
                  </section>
                )}
              </div>

              {/* DISPLAY */}
              <section className="space-y-2 border-t border-white/[0.06] pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:border-white/[0.06] sm:pl-4">
                <SectionLabel>Display</SectionLabel>
                <FeedToggleRow label="Full Size" on={fullSize} onChange={onFullSizeChange} />
                {fullSize && (
                  <div className="rounded-lg bg-black/30 border border-white/10 p-2.5 space-y-2">
                    <FeedOptionRow label="Layout">
                      <FeedSeg value={fullSizeLayout} onChange={onFullSizeLayoutChange} options={[{ value: "grid", label: "Grid" }, { value: "masonry", label: "Masonry" }]} />
                    </FeedOptionRow>
                    {fullSizeLayout === "masonry" && (
                      <FeedOptionRow label="Packing">
                        <FeedSeg value={masonryMode} onChange={onMasonryModeChange} options={[{ value: "rows", label: "Rows" }, { value: "flow", label: "Flow" }]} />
                      </FeedOptionRow>
                    )}
                    <FeedOptionRow label="Quality">
                      <FeedSeg value={tileRes} onChange={onTileResChange} options={[{ value: "thumb", label: "Thumbnail" }, { value: "full", label: "Full size" }]} />
                    </FeedOptionRow>
                    <p className="text-[9.5px] text-slate-600 leading-relaxed pt-0.5">
                      {tileRes === "full"
                        ? <><span className="text-slate-200">Full size</span> loads large 2048px previews - sharp at any tile size; tap any for the original.</>
                        : fullSizeLayout === "masonry"
                          ? <><span className="text-white">Rows</span> stays put as images load; <span className="text-white">Flow</span> fills each column top-to-bottom.</>
                          : <>Whole images at their natural shape - nothing cropped. Tap any for full resolution.</>}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
