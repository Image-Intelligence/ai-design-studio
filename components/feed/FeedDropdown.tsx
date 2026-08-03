"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Layers, EyeOff, ChevronDown } from "lucide-react"

// Feed settings dropdown for the my-generations page. Copied from the portal-v2
// FeedDropdown with the admin feed-filter section removed (regular users only).
// Exposes: Columns, View Hidden, Full Size, Layout, Packing, Quality.

// Segmented pill control.
function FeedSeg<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; accent?: "cyan" | "amber" }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/20">
      {options.map((opt, i) => {
        const active = value === opt.value
        const activeCls = (opt.accent ?? "cyan") === "amber"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-cyan-500/20 text-cyan-300"
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${active ? activeCls : "text-slate-500 hover:text-white hover:bg-white/5"}`}
          >
            {opt.label}
          </button>
        )
      })}
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
function FeedToggleRow({ label, icon, on, onChange, accent = "cyan" }: {
  label: string
  icon?: ReactNode
  on: boolean
  onChange: (v: boolean) => void
  accent?: "cyan" | "amber"
}) {
  const activeCls = accent === "amber"
    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
    : "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
  const pillCls = accent === "amber" ? "bg-amber-500/25 text-amber-300" : "bg-cyan-500/25 text-cyan-300"
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium transition-all ${on ? activeCls : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"}`}
    >
      <span className="flex items-center gap-1.5">{icon}{label}</span>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${on ? pillCls : "bg-white/10 text-slate-500"}`}>{on ? "ON" : "OFF"}</span>
    </button>
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
  showHidden: boolean
  onShowHiddenChange: (on: boolean) => void
  pageSize: number
  onPageSizeChange: (n: number) => void
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
      setMenuPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8)) })
    }
  }, [open])

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Layers size={15} />
        Feed
        {cols !== null && (
          <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full leading-none">{cols}</span>
        )}
        {showHidden && (
          <EyeOff size={11} className="text-amber-400 shrink-0" aria-label="Viewing hidden generations" />
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-[min(540px,calc(100vw-16px))] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl z-[9999] overflow-hidden" style={{ top: menuPos.top, left: menuPos.left }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
            <Layers size={13} className="text-cyan-400" />
            <span className="text-[12px] font-semibold text-white">Feed Settings</span>
          </div>

          <div className="p-3 space-y-3 max-h-[calc(100vh-140px)] overflow-y-auto">
            {/* Two-column layout: Columns + View | Display */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <div className="space-y-3">
                {/* COLUMNS */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Columns</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none border ${cols === null ? "border-white/10 text-slate-500" : "border-cyan-500/30 text-cyan-300"}`}>{cols ?? "Auto"}</span>
                  </div>
                  <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/20">
                    <button onClick={() => onColsChange(null)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${cols === null ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>Auto</button>
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => onColsChange(n)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium border-l border-white/10 transition-colors ${cols === n ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>{n}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5 px-0.5">
                    <span className="text-[10px] font-mono text-slate-600">1</span>
                    <input type="range" min={1} max={6} step={1} value={cols ?? 4} onChange={e => onColsChange(+e.target.value)} className="flex-1 accent-cyan-400 cursor-pointer" />
                    <span className="text-[10px] font-mono text-slate-600">6</span>
                  </div>
                  <p className="text-[9.5px] text-slate-600 leading-relaxed"><span className="text-slate-400">Auto</span> adapts to your screen size.</p>
                </section>

                {/* PAGE SIZE */}
                <section className="border-t border-white/5 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Page Size</span>
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none border border-cyan-500/30 text-cyan-300">{pageSize}</span>
                  </div>
                  <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/20">
                    {[8, 12, 24, 48, 96].map((n, i) => (
                      <button
                        key={n}
                        onClick={() => onPageSizeChange(n)}
                        className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${pageSize === n ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-white hover:bg-white/5"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9.5px] text-slate-600 leading-relaxed">Generations shown per page.</p>
                </section>

                {/* VIEW */}
                <section className="border-t border-white/5 pt-3 space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">View</span>
                  <FeedToggleRow label="View Hidden" icon={<EyeOff size={11} />} on={showHidden} onChange={onShowHiddenChange} accent="amber" />
                  {showHidden && <p className="text-[9.5px] text-slate-600 leading-relaxed px-0.5">Showing only hidden generations — select them to unhide.</p>}
                </section>
              </div>

              {/* DISPLAY */}
              <section className="space-y-2 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:border-white/5 sm:pl-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display</span>
                <FeedToggleRow label="Full Size" on={fullSize} onChange={onFullSizeChange} />
                {fullSize && (
                  <div className="rounded-lg bg-black/20 border border-white/10 p-2.5 space-y-2">
                    <FeedOptionRow label="Layout">
                      <FeedSeg value={fullSizeLayout} onChange={onFullSizeLayoutChange} options={[{ value: "grid", label: "Grid" }, { value: "masonry", label: "Masonry" }]} />
                    </FeedOptionRow>
                    {fullSizeLayout === "masonry" && (
                      <FeedOptionRow label="Packing">
                        <FeedSeg value={masonryMode} onChange={onMasonryModeChange} options={[{ value: "rows", label: "Rows" }, { value: "flow", label: "Flow" }]} />
                      </FeedOptionRow>
                    )}
                    <FeedOptionRow label="Quality">
                      <FeedSeg value={tileRes} onChange={onTileResChange} options={[{ value: "thumb", label: "Thumbnail" }, { value: "full", label: "Full size", accent: "amber" }]} />
                    </FeedOptionRow>
                    <p className="text-[9.5px] text-slate-600 leading-relaxed pt-0.5">
                      {tileRes === "full"
                        ? <><span className="text-amber-400">Full size</span> loads originals — sharper, but long scrolls may reload the page.</>
                        : fullSizeLayout === "masonry"
                          ? <><span className="text-white">Rows</span> stays put as images load; <span className="text-white">Flow</span> fills each column top-to-bottom.</>
                          : <>Whole images at their natural shape — nothing cropped. Tap any for full resolution.</>}
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
