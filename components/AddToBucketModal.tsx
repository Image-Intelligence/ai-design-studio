"use client"

// Shared "Add to Bucket" modal — used by the admin dataset page and the
// portal-v2 select mode (admin only). Browse the folder/bucket tree, search
// across all levels, or create a new bucket and add the selection to it.

import { useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronLeft, ChevronRight, X, Search, FolderOpen, FolderPlus, Plus, Loader2,
} from "lucide-react"

export interface Bucket { id: number; name: string; description: string | null; color: string | null; folderId: number | null; count: number; createdAt: string; previewUrls: string[] }
export interface BucketFolder { id: number; name: string; parentId?: number | null; createdAt: string; previewUrls: string[] }

export function AddToBucketModal({ count, buckets, folders, recentBucketIds, loading = false, error = null, onClose, onAdd, onCreateAndAdd }: {
  count:            number
  buckets:          Bucket[]
  folders:          BucketFolder[]
  recentBucketIds:  number[]
  loading?:         boolean
  error?:           string | null
  onClose:          () => void
  onAdd:            (bucketId: number) => Promise<void>
  onCreateAndAdd:   (name: string) => Promise<void>
}) {
  const [browsePath,   setBrowsePath]   = useState<number[]>([])
  const [creating,     setCreating]     = useState(false)
  const [newName,      setNewName]      = useState("")
  const [saving,       setSaving]       = useState(false)
  const [modalSearch,  setModalSearch]  = useState("")

  const currentFolderId = browsePath.length > 0 ? browsePath[browsePath.length - 1] : null

  const q = modalSearch.trim().toLowerCase()
  const isSearching = !!q

  // Returns the chain of folder names from root down to (but not including) folderId
  function getFolderAncestorNames(folderId: number | null): string[] {
    if (!folderId) return []
    const f = folders.find(x => x.id === folderId)
    if (!f) return []
    return [...getFolderAncestorNames(f.parentId ?? null), f.name]
  }

  // Returns the full browsePath array needed to navigate into folderId
  function buildPathToFolder(folderId: number): number[] {
    const path: number[] = []
    let cur: BucketFolder | undefined = folders.find(x => x.id === folderId)
    while (cur) {
      path.unshift(cur.id)
      cur = cur.parentId ? folders.find(x => x.id === cur!.parentId) : undefined
    }
    return path
  }

  // Browse mode — items at the current level only
  const visibleFolders = isSearching ? [] : folders.filter(f =>
    currentFolderId === null ? !f.parentId : f.parentId === currentFolderId
  )
  const visibleBuckets = isSearching ? [] : buckets.filter(b =>
    b.folderId === currentFolderId
  )

  // Search mode — all levels, flat
  const searchFolders = isSearching ? folders.filter(f => f.name.toLowerCase().includes(q)) : []
  const searchBuckets = isSearching ? buckets.filter(b => b.name.toLowerCase().includes(q)) : []

  async function handleAdd(bucketId: number) {
    setSaving(true)
    try {
      await onAdd(bucketId)
      onClose()
    } catch { /* network error — modal stays open so user can retry */ }
    finally { setSaving(false) }
  }

  async function handleCreateAndAdd() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await onCreateAndAdd(newName.trim())
      onClose()
    } catch { /* network error — modal stays open so user can retry */ }
    finally { setSaving(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-[#0f0f1a] border border-white/[0.1] shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            {browsePath.length > 0 && (
              <button onClick={() => { setBrowsePath(p => p.slice(0, -1)); setModalSearch("") }}
                className="p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
                <ChevronLeft size={14} />
              </button>
            )}
            <div>
              <p className="text-sm font-semibold text-white">Add to Bucket</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {count} image{count !== 1 ? "s" : ""}
                {browsePath.length > 0 && (
                  <span> · {browsePath.map(id => folders.find(f => f.id === id)?.name ?? '…').join(' / ')}</span>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Search bar */}
        {!creating && (
          <div className="px-4 pt-3 pb-0 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] focus-within:border-white/15 transition-colors">
              <Search size={11} className="text-slate-600 shrink-0" />
              <input
                value={modalSearch}
                onChange={e => setModalSearch(e.target.value)}
                placeholder="Search buckets & folders…"
                className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-600 focus:outline-none"
              />
              {modalSearch && (
                <button onClick={() => setModalSearch("")} className="text-slate-600 hover:text-slate-400 transition-colors">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="overflow-y-auto flex-1 p-4">
          {creating ? (
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Bucket name…" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreateAndAdd()}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40" />
          ) : error ? (
            <p className="text-xs text-red-400 text-center py-10">{error}</p>
          ) : loading && buckets.length === 0 && folders.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-xs">
              <Loader2 size={13} className="animate-spin" /> Loading buckets…
            </div>
          ) : (
            <>
            {/* Recent buckets row — root level only, hidden during search */}
            {!isSearching && browsePath.length === 0 && recentBucketIds.length > 0 && (() => {
              const recentBuckets = recentBucketIds.map(id => buckets.find(b => b.id === id)).filter(Boolean) as Bucket[]
              if (recentBuckets.length === 0) return null
              return (
                <div className="mb-4">
                  <p className="text-[9px] font-mono uppercase tracking-wider text-slate-600 mb-2">Recent</p>
                  <div className="flex items-end gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {recentBuckets.map(b => (
                      <div key={b.id} onClick={() => !saving && handleAdd(b.id)} className="shrink-0 w-[72px] cursor-pointer group">
                        <div className="w-full h-[46px] rounded-t-lg overflow-hidden relative border-t border-l border-r border-violet-500/20 group-hover:border-violet-500/50 transition-colors">
                          <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
                            <FolderOpen size={14} className="text-slate-700" />
                          </div>
                          {b.previewUrls[0] && (
                            <img src={b.previewUrls[0]} alt="" className="absolute inset-0 w-full h-full object-cover"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Plus size={14} className="text-violet-300" />
                          </div>
                        </div>
                        <div className="px-1.5 py-1 rounded-b-lg border-b border-l border-r bg-white/[0.03] border-violet-500/20 group-hover:border-violet-500/40 transition-colors">
                          <p className="text-[9px] truncate leading-tight text-slate-400 group-hover:text-white transition-colors">{b.name}</p>
                          <p className="text-[8px] text-slate-600">{b.count}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-b border-white/[0.05] mb-4" />
                </div>
              )
            })()}

            {isSearching ? (
              /* ── Flat search results across all levels ── */
              searchFolders.length === 0 && searchBuckets.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-10">No results for &ldquo;{modalSearch}&rdquo;</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {searchFolders.map(folder => {
                    const path = getFolderAncestorNames(folder.parentId ?? null)
                    return (
                      <div key={folder.id}
                        onClick={() => { setBrowsePath(buildPathToFolder(folder.id)); setModalSearch("") }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors group">
                        <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                          <FolderOpen size={14} className="text-amber-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-amber-400 truncate">{folder.name}</p>
                          {path.length > 0 && (
                            <p className="text-[10px] text-slate-600 truncate">{path.join(' / ')}</p>
                          )}
                        </div>
                        <ChevronRight size={12} className="text-slate-700 group-hover:text-amber-400 transition-colors shrink-0" />
                      </div>
                    )
                  })}
                  {searchBuckets.map(b => {
                    const path = getFolderAncestorNames(b.folderId)
                    return (
                      <div key={b.id}
                        onClick={() => !saving && handleAdd(b.id)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors group">
                        <div className="w-8 h-8 rounded-md bg-violet-500/10 border border-violet-500/20 shrink-0 overflow-hidden relative flex items-center justify-center">
                          {b.previewUrls[0] ? (
                            <img src={b.previewUrls[0]} alt="" className="absolute inset-0 w-full h-full object-cover"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            <FolderOpen size={14} className="text-violet-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-300 truncate group-hover:text-white transition-colors">{b.name}</p>
                          {path.length > 0
                            ? <p className="text-[10px] text-slate-600 truncate">{path.join(' / ')}</p>
                            : <p className="text-[10px] text-slate-600">{b.count} image{b.count !== 1 ? 's' : ''}</p>
                          }
                        </div>
                        <div className="w-6 h-6 rounded-md bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus size={11} className="text-violet-300" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              /* ── Normal browse grid ── */
              visibleFolders.length === 0 && visibleBuckets.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-10">No buckets here</p>
              ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">

                {/* Folder cards */}
                {visibleFolders.map(folder => {
                  const directCount = folders.filter(f => f.parentId === folder.id).length
                                    + buckets.filter(b => b.folderId === folder.id).length
                  return (
                    <div key={folder.id} onClick={() => { setBrowsePath(p => [...p, folder.id]); setModalSearch("") }} className="cursor-pointer group">
                      <div className="w-full aspect-square rounded-t-lg overflow-hidden relative border-t border-l border-r border-amber-500/20 group-hover:border-amber-500/50 transition-colors">
                        <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-px bg-black/30">
                          {[0,1,2,3].map(i => (
                            <div key={i} className="overflow-hidden bg-white/[0.02] relative">
                              {folder.previewUrls?.[i] && (
                                <img src={folder.previewUrls[i]} alt="" className="absolute inset-0 w-full h-full object-cover"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight size={18} className="text-amber-300" />
                        </div>
                      </div>
                      <div className="px-1.5 py-1 rounded-b-lg border-b border-l border-r bg-amber-500/5 border-amber-500/20 group-hover:border-amber-500/40 transition-colors">
                        <p className="text-[9px] truncate leading-tight text-amber-400">{folder.name}</p>
                        <p className="text-[8px] text-slate-600">{directCount} item{directCount !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  )
                })}

                {/* Bucket cards */}
                {visibleBuckets.map(b => (
                  <div key={b.id} onClick={() => !saving && handleAdd(b.id)} className="cursor-pointer group">
                    <div className="w-full aspect-square rounded-t-lg overflow-hidden relative border-t border-l border-r border-violet-500/20 group-hover:border-violet-500/50 transition-colors">
                      <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
                        <FolderOpen size={20} className="text-slate-700" />
                      </div>
                      {b.previewUrls[0] && (
                        <img src={b.previewUrls[0]} alt="" className="absolute inset-0 w-full h-full object-cover"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus size={18} className="text-violet-300" />
                      </div>
                    </div>
                    <div className="px-1.5 py-1 rounded-b-lg border-b border-l border-r bg-white/[0.03] border-violet-500/20 group-hover:border-violet-500/40 transition-colors">
                      <p className="text-[9px] truncate leading-tight text-slate-400 group-hover:text-white transition-colors">{b.name}</p>
                      <p className="text-[8px] text-slate-600">{b.count}</p>
                    </div>
                  </div>
                ))}

              </div>
              )
            )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.07] flex items-center gap-2 shrink-0">
          {creating ? (
            <>
              <button onClick={handleCreateAndAdd}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-500/25 transition-all disabled:opacity-50">
                {saving && <Loader2 size={11} className="animate-spin" />}
                Create & Add
              </button>
              <button onClick={() => { setCreating(false); setNewName("") }}
                className="px-4 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-slate-500 hover:text-white text-xs transition-all">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setCreating(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-white/[0.1] text-slate-600 hover:text-slate-300 hover:border-white/25 text-xs transition-all">
                <FolderPlus size={12} /> Create new bucket
              </button>
              {saving && (
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 size={11} className="animate-spin" /> Adding…
                </span>
              )}
            </>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}
