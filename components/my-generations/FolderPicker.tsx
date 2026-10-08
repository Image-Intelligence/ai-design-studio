"use client"

import { useMemo, useState } from "react"
import { Check, ChevronRight, Clock, Folder, FolderInput, FolderPlus, Loader2, Plus, Search, Square, CheckSquare, X } from "lucide-react"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"

/**
 * My Generations' folder picker (2026-10-07) - one popup, two jobs:
 *
 *   Move          the selection goes to ONE folder (where it lives)
 *   Add to folder the selection is ALSO shown in one or more folders; it
 *                 stays where it is (tick as many as you like)
 *
 * Long trees: a search box scoped to where you are (every folder at the root,
 * the folder's own subfolders inside one), recent folders across the top, and
 * a new folder made right here - "Create & move" saves the selection into it
 * in the same step.
 */
export type GenFolder = { id: number; name: string; parentId: number | null }
export type PickerMode = "move" | "add"

const RECENT_KEY = "mg-recent-folders"
const RECENT_MAX = 8
/** Folders moved or added into, made or renamed lately - newest first (this browser). */
export function readRecentFolders(): number[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.filter(n => typeof n === "number") : [] } catch { return [] }
}
export function touchRecentFolders(ids: (number | null | undefined)[]) {
  const fresh = ids.filter((n): n is number => typeof n === "number")
  if (!fresh.length) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([...fresh, ...readRecentFolders().filter(n => !fresh.includes(n))].slice(0, RECENT_MAX))) } catch {}
}

export function FolderPicker({
  mode: initialMode, count, folders, onCreateFolder, onMove, onAdd, onClose,
}: {
  mode: PickerMode
  count: number
  folders: GenFolder[]
  /** Makes a folder (under parentId) and returns it. */
  onCreateFolder: (name: string, parentId: number | null) => Promise<GenFolder | null>
  onMove: (folderId: number | null) => Promise<void>
  onAdd: (folderIds: number[]) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<PickerMode>(initialMode)
  const [path, setPath] = useState<GenFolder[]>([])
  const [query, setQuery] = useState("")
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const here = path.length ? path[path.length - 1] : null
  const byId = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])
  const pathTo = (id: number): GenFolder[] => {
    const out: GenFolder[] = []
    let cur = byId.get(id)
    for (let guard = 0; cur && guard < 50; guard++) { out.unshift(cur); cur = cur.parentId == null ? undefined : byId.get(cur.parentId) }
    return out
  }
  const kids = folders.filter(f => (f.parentId ?? null) === (here?.id ?? null)).sort((a, b) => a.name.localeCompare(b.name))
  const hasKids = (id: number) => folders.some(f => f.parentId === id)

  // Search: every folder at the root, else the open folder's whole subtree
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return []
    const inScope = (f: GenFolder) => {
      if (!here) return true
      for (let p = f.parentId, guard = 0; p != null && guard < 50; guard++) { if (p === here.id) return true; p = byId.get(p)?.parentId ?? null }
      return false
    }
    return folders.filter(f => f.name.toLowerCase().includes(q) && inScope(f))
      .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name))
      .slice(0, 60)
  }, [q, folders, here, byId])

  const recent = useMemo(() => readRecentFolders().map(id => byId.get(id)).filter((f): f is GenFolder => !!f), [byId])

  const toggle = (id: number) => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  /** A folder picked from search or recents: move -> go into it; add -> tick it. */
  const pick = (f: GenFolder) => {
    if (mode === "add") toggle(f.id)
    else { setPath(pathTo(f.id)); setQuery("") }
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || "Something went wrong") } finally { setBusy(false) }
  }
  const create = () => run(async () => {
    const name = newName.trim()
    if (!name) return
    const f = await onCreateFolder(name, here?.id ?? null)
    if (!f) throw new Error("Could not make the folder")
    setNewName(""); setCreating(false)
    // Move: straight in. Add: ticked, so more can be picked before adding.
    if (mode === "move") await onMove(f.id)
    else setChecked(prev => new Set(prev).add(f.id))
  })

  const crumb = (f: GenFolder) => f.name
  const rowCls = "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors"
  const pathLabel = (f: GenFolder) => pathTo(f.id).slice(0, -1).map(crumb).join(" › ")

  return (
    // Anchored near the top (not centred), so it doesn't jump as the list
    // under the search box grows and shrinks
    <div className="fixed inset-0 z-[9998] flex items-start justify-center p-4 pt-[8dvh] bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-5 max-w-lg w-full max-h-[84dvh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <SilverRimOverlay />
        <div className="relative mb-3">
          <BrandTitle
            title={mode === "move" ? `Move ${count} item${count !== 1 ? "s" : ""}` : `Add ${count} item${count !== 1 ? "s" : ""} to folders`}
            eyebrow={mode === "move" ? "Pick a folder" : "Tick one or more - they stay where they are too"}
            logo={26}
            right={<button onClick={onClose} className="p-1 text-slate-500 hover:text-white"><X size={16} /></button>}
          />
        </div>

        {/* Move / Add to folder */}
        <div className="relative flex items-center gap-0.5 p-1 mb-3 rounded-lg border border-white/10 bg-black/40 self-start">
          {(["move", "add"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null) }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${mode === m ? "bg-white/[0.14] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" : "text-slate-500 hover:text-slate-200"}`}>
              {m === "move" ? <><FolderInput size={12} /> Move</> : <><Plus size={12} /> Add to folder</>}
            </button>
          ))}
        </div>

        {/* Recent folders */}
        {recent.length > 0 && (
          <div className="relative mb-3">
            <p className="flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.18em] text-slate-500 mb-1.5"><Clock size={10} /> Recent</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {recent.map(f => {
                const on = mode === "add" && checked.has(f.id)
                return (
                  <button key={f.id} onClick={() => pick(f)} title={[pathLabel(f), f.name].filter(Boolean).join(" › ")}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] transition-colors ${on ? "border-white/50 bg-white/15 text-white" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/30 hover:text-white"}`}>
                    {on ? <Check size={11} /> : <Folder size={11} className="text-slate-500" />}
                    <span className="max-w-[140px] truncate">{f.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Search - scoped to where you are */}
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={here ? `Search in ${here.name}…` : "Search all folders…"}
            className="w-full pl-8 pr-8 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30" />
          {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={12} /></button>}
        </div>

        {/* Breadcrumb */}
        {!q && (
          <div className="relative flex items-center gap-1 flex-wrap mb-2 text-xs">
            <button onClick={() => setPath([])} className={`px-2 py-1 rounded-md ${!here ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}>
              {mode === "move" ? "Unfiled" : "All folders"}
            </button>
            {path.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight size={12} className="text-slate-700" />
                <button onClick={() => setPath(path.slice(0, i + 1))} className={`px-2 py-1 rounded-md ${i === path.length - 1 ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}>{f.name}</button>
              </span>
            ))}
          </div>
        )}

        {/* Folders: search results, or the open folder's subfolders */}
        <div className="relative flex-1 min-h-[120px] rounded-xl border border-white/[0.07] bg-black/30 p-2 mb-3 overflow-y-auto">
          {q ? (
            results.length === 0 ? <p className="text-[11px] text-slate-600 text-center py-6">No folders match “{query.trim()}”{here ? ` in ${here.name}` : ""}</p> : (
              <div className="flex flex-col gap-1">
                {results.map(f => {
                  const on = mode === "add" && checked.has(f.id)
                  return (
                    <button key={f.id} onClick={() => pick(f)} className={`${rowCls} text-left ${on ? "border-white/40 bg-white/[0.10] text-white" : "border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06] text-slate-200"}`}>
                      {mode === "add" ? (on ? <CheckSquare size={13} className="shrink-0" /> : <Square size={13} className="shrink-0 text-slate-500" />) : <Folder size={13} className="text-slate-400 shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{f.name}</span>
                        {pathLabel(f) && <span className="block truncate text-[10px] text-slate-500">{pathLabel(f)}</span>}
                      </span>
                      {mode === "move" && <ChevronRight size={13} className="text-slate-600 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-1">
              {/* Add mode: the open folder itself can be ticked */}
              {mode === "add" && here && (
                <button onClick={() => toggle(here.id)} className={`${rowCls} ${checked.has(here.id) ? "border-white/40 bg-white/[0.10] text-white" : "border-dashed border-white/15 text-slate-300 hover:border-white/30"}`}>
                  {checked.has(here.id) ? <CheckSquare size={13} /> : <Square size={13} className="text-slate-500" />}
                  <span className="truncate">{here.name}</span><span className="text-[10px] text-slate-500">this folder</span>
                </button>
              )}
              {kids.length === 0 && !(mode === "add" && here) && <p className="text-[11px] text-slate-600 text-center py-6">No subfolders here</p>}
              {kids.map(f => {
                const on = mode === "add" && checked.has(f.id)
                return (
                  <div key={f.id} className={`flex items-stretch rounded-lg border transition-colors ${on ? "border-white/40 bg-white/[0.10]" : "border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]"}`}>
                    {mode === "add" && (
                      <button onClick={() => toggle(f.id)} className="pl-2.5 pr-1 flex items-center text-slate-300 hover:text-white" aria-label={on ? "Untick" : "Tick"}>
                        {on ? <CheckSquare size={13} /> : <Square size={13} className="text-slate-500" />}
                      </button>
                    )}
                    <button onClick={() => (mode === "add" && !hasKids(f.id) ? toggle(f.id) : setPath(p => [...p, f]))}
                      className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-2 text-xs text-slate-200 text-left">
                      <span className="flex items-center gap-2 truncate"><Folder size={13} className="text-slate-400 shrink-0" /> <span className="truncate">{f.name}</span></span>
                      {(mode === "move" || hasKids(f.id)) && <ChevronRight size={13} className="text-slate-600 shrink-0" />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* New folder, right here */}
        <div className="relative mb-3">
          {creating ? (
            <div className="flex gap-1.5">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value.slice(0, 120))}
                onKeyDown={e => { if (e.key === "Enter" && newName.trim()) create(); if (e.key === "Escape") { setCreating(false); setNewName("") } }}
                placeholder={`New folder${here ? ` in ${here.name}` : ""}…`}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/40 border border-white/30 text-xs text-white placeholder:text-slate-600 focus:outline-none" />
              <BrandButton onClick={create} disabled={!newName.trim() || busy} size="md" icon={busy ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}>
                {mode === "move" ? "Create & move" : "Create"}
              </BrandButton>
              <button onClick={() => { setCreating(false); setNewName("") }} className="px-1.5 text-slate-500 hover:text-white"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => { setCreating(true); setQuery("") }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:border-white/40 hover:bg-white/[0.05] text-slate-400 hover:text-white text-[12px] font-semibold transition-all">
              <FolderPlus size={13} /> New folder{here ? ` in ${here.name}` : ""}
            </button>
          )}
        </div>

        {error && <p className="relative mb-2 text-[11px] text-red-300">{error}</p>}
        {mode === "move" ? (
          <BrandButton onClick={() => run(() => onMove(here?.id ?? null))} busy={busy} primary size="lg" className="relative w-full" icon={<Check size={14} />}>
            Move here - {here ? here.name : "Unfiled"}
          </BrandButton>
        ) : (
          <BrandButton onClick={() => run(() => onAdd([...checked]))} busy={busy} disabled={checked.size === 0} primary size="lg" className="relative w-full" icon={<Plus size={14} />}>
            {checked.size === 0 ? "Tick the folders to add to" : `Add to ${checked.size} folder${checked.size === 1 ? "" : "s"}`}
          </BrandButton>
        )}
      </div>
    </div>
  )
}
