"use client"

// Multi-select dropdown — allows picking multiple options simultaneously.
// Shared by /admin/dataset (generation filters) and its Reference mode panel.

import { useState, useEffect, useRef, memo } from "react"
import { ChevronDown, Search, X } from "lucide-react"

export const MultiFilterSelect = memo(function MultiFilterSelect({ values, onChange, options, placeholder, searchable = false }: {
  values:       string[]
  onChange:     (v: string[]) => void
  options:      { value: string; label: string }[]
  placeholder:  string
  searchable?:  boolean
}) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState("")
  const ref                 = useRef<HTMLDivElement>(null)
  const searchRef           = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery("") }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, searchable])

  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  }

  const active   = values.length > 0
  const filtered = searchable && query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all whitespace-nowrap
          ${active
            ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
            : "bg-white/[0.05] border-white/[0.08] text-slate-300 hover:text-white hover:border-white/20"}`}
      >
        {active ? `${placeholder.split(':')[0]}: ${values.length}` : placeholder}
        {active && (
          <span
            onClick={e => { e.stopPropagation(); onChange([]) }}
            className="ml-0.5 text-cyan-500 hover:text-white cursor-pointer"
            title="Clear"
          >
            <X size={9} />
          </span>
        )}
        <ChevronDown size={10} className={`text-slate-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[260px] rounded-xl bg-[#131320] border border-white/[0.1] shadow-2xl overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-white/[0.06]">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    <X size={9} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="overflow-y-auto max-h-56 py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-slate-600 text-center">No results</p>
            ) : filtered.map(opt => {
              const checked = values.includes(opt.value)
              return (
                <button key={opt.value} onClick={() => toggle(opt.value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left
                    ${checked ? "text-cyan-300 bg-cyan-500/10" : "text-slate-400 hover:text-white hover:bg-white/[0.06]"}`}>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border transition-colors
                    ${checked ? "bg-cyan-500 border-cyan-500" : "border-white/20"}`}>
                    {checked && <span className="text-black text-[8px] font-bold leading-none">✓</span>}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>
          {values.length > 0 && (
            <div className="border-t border-white/[0.06] p-1">
              <button onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors rounded-lg hover:bg-white/[0.04]">
                Clear {values.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
