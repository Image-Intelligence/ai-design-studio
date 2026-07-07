"use client"

// Reference mode for /admin/dataset — browses user-uploaded reference images
// (account libraries from the portal-v2 Refs dropdown). Shows EVERYTHING ever
// uploaded, including soft-cleared refs (amber badge), with a multi-user filter
// like generation mode plus an optional per-user folder-tree view.

import { useState, useEffect, useCallback, useRef } from "react"
import {
  ChevronLeft, ChevronRight, Loader2, ImageIcon, FolderOpen, Folder, X, EyeOff,
} from "lucide-react"
import { MultiFilterSelect } from "@/components/MultiFilterSelect"

interface AdminRef {
  id: number
  url: string
  userId: number
  userEmail: string | null
  userName: string | null
  folderId: number | null
  folderName: string | null
  isCleared: boolean
  clearedAt: string | null
  createdAt: string
}

interface RefFacetUser { id: number; email: string; name: string | null; count: number }
interface TreeFolder { id: number; name: string; parentId: number | null }
interface TreeRef { id: number; url: string; folderId: number | null; isCleared: boolean; clearedAt: string | null; createdAt: string }

const PREFS_KEY = "dataset-ref-prefs"

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3",
  4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6",
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) } catch { return "" }
}

export function ReferencePanel({ authHeaders, cols }: {
  authHeaders: () => Record<string, string>
  cols: number
}) {
  const [refs, setRefs] = useState<AdminRef[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [facetUsers, setFacetUsers] = useState<RefFacetUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline admin unlock — the page only checks that a password EXISTS in
  // sessionStorage, not that it's still correct; a stale one 401s silently
  const [authNeeded, setAuthNeeded] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // Filters (persisted)
  const [userFilters, setUserFilters] = useState<string[]>([])
  const [includeCleared, setIncludeCleared] = useState(true)
  const [sort, setSort] = useState<"newest" | "oldest">("newest")
  const [page, setPage] = useState(1)
  const pageSize = 60

  // Tree mode: view one user's folder structure as they organized it
  const [treeUserId, setTreeUserId] = useState<number | null>(null)
  const [treeFolders, setTreeFolders] = useState<TreeFolder[]>([])
  const [treeRefs, setTreeRefs] = useState<TreeRef[]>([])
  const [treePath, setTreePath] = useState<TreeFolder[]>([])
  const [treeLoading, setTreeLoading] = useState(false)

  // Lightbox
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null)

  const prefsLoaded = useRef(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (Array.isArray(p.userFilters)) setUserFilters(p.userFilters)
        if (typeof p.includeCleared === "boolean") setIncludeCleared(p.includeCleared)
        if (p.sort === "newest" || p.sort === "oldest") setSort(p.sort)
      }
    } catch {}
    prefsLoaded.current = true
  }, [])
  useEffect(() => {
    if (!prefsLoaded.current) return
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ userFilters, includeCleared, sort })) } catch {}
  }, [userFilters, includeCleared, sort])

  const abortRef = useRef<AbortController | null>(null)
  const fetchRefs = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", String(pageSize))
      params.set("sort", sort)
      if (includeCleared) params.set("includeCleared", "true")
      userFilters.forEach(u => params.append("userId", u))
      const res = await fetch(`/api/admin/references?${params}`, { headers: authHeaders(), signal: ctrl.signal })
      if (res.status === 401) { setAuthNeeded(true); return }
      if (!res.ok) { setError(`Failed to load references (HTTP ${res.status})`); return }
      setAuthNeeded(false)
      const data = await res.json()
      setRefs(data.references || [])
      setTotal(data.pagination?.total ?? 0)
      setTotalPages(data.pagination?.totalPages ?? 1)
      setFacetUsers(data.facets?.users || [])
    } catch (err: any) {
      if (err?.name !== "AbortError") setError("Failed to load references")
    } finally {
      if (abortRef.current === ctrl) setLoading(false)
    }
  }, [page, sort, includeCleared, userFilters, authHeaders])

  useEffect(() => { if (treeUserId === null) fetchRefs() }, [fetchRefs, treeUserId])
  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [userFilters, includeCleared, sort])

  // Verify a freshly-typed admin password, store it, and retry the fetch
  const handleUnlock = async () => {
    if (!passwordInput.trim() || verifying) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      if (res.ok) {
        try { sessionStorage.setItem("admin-password", passwordInput) } catch {}
        setPasswordInput("")
        setAuthNeeded(false)
        fetchRefs()
      } else {
        const data = await res.json().catch(() => null)
        setVerifyError(data?.error || "Incorrect password")
      }
    } catch {
      setVerifyError("Verification failed — check your connection.")
    } finally {
      setVerifying(false)
    }
  }

  const openTree = useCallback(async (userId: number) => {
    setTreeUserId(userId)
    setTreePath([])
    setTreeLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("treeUser", String(userId))
      if (includeCleared) params.set("includeCleared", "true")
      const res = await fetch(`/api/admin/references?${params}`, { headers: authHeaders() })
      if (!res.ok) { setTreeUserId(null); return }
      const data = await res.json()
      setTreeFolders(data.folders || [])
      setTreeRefs(data.references || [])
    } catch {
      setTreeUserId(null)
    } finally {
      setTreeLoading(false)
    }
  }, [includeCleared, authHeaders])

  const treeUserLabel = facetUsers.find(u => u.id === treeUserId)?.email
    ?? refs.find(r => r.userId === treeUserId)?.userEmail
    ?? (treeUserId !== null ? `user ${treeUserId}` : "")

  const currentTreeFolderId = treePath.length > 0 ? treePath[treePath.length - 1].id : null
  const visibleTreeFolders = treeFolders.filter(f => (f.parentId ?? null) === currentTreeFolderId)
  const visibleTreeRefs = treeRefs.filter(r => (r.folderId ?? null) === currentTreeFolderId)

  const gridCls = GRID_COLS[cols] ?? "grid-cols-4"

  const RefCard = ({ url, label, sub, cleared }: { url: string; label: string; sub: string; cleared: boolean }) => (
    <button
      onClick={() => setPreview({ url, label })}
      className="group relative rounded-xl overflow-hidden border border-white/[0.07] bg-white/[0.02] hover:border-white/20 transition-all text-left"
    >
      <div className="aspect-square bg-black/40">
        <img src={url} alt="" loading="lazy" className={`w-full h-full object-cover ${cleared ? "opacity-50" : ""}`} />
      </div>
      {cleared && (
        <span className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-bold uppercase tracking-wide">
          <EyeOff size={8} /> Cleared
        </span>
      )}
      <div className="px-2 py-1.5">
        <p className="text-[10px] text-slate-300 truncate">{label}</p>
        <p className="text-[9px] text-slate-600 truncate">{sub}</p>
      </div>
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiFilterSelect
          values={userFilters}
          onChange={setUserFilters}
          options={facetUsers.map(u => ({ value: String(u.id), label: `${u.name ? `${u.name} · ` : ""}${u.email} (${u.count})` }))}
          placeholder="Users: all"
          searchable
        />
        <button
          onClick={() => setIncludeCleared(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
            includeCleared
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-white/[0.05] border-white/[0.08] text-slate-400 hover:text-white"
          }`}
        >
          <EyeOff size={11} />
          {includeCleared ? "Cleared: shown" : "Cleared: hidden"}
        </button>
        <button
          onClick={() => setSort(s => s === "newest" ? "oldest" : "newest")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-xs text-slate-300 hover:text-white transition-all"
        >
          {sort === "newest" ? "Newest first" : "Oldest first"}
        </button>
        {/* Per-user folder tree — available when exactly one user is filtered */}
        {treeUserId === null && userFilters.length === 1 && (
          <button
            onClick={() => openTree(Number(userFilters[0]))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 text-xs text-violet-300 hover:bg-violet-500/20 transition-all"
          >
            <FolderOpen size={11} />
            View their folders
          </button>
        )}
        {treeUserId !== null && (
          <button
            onClick={() => setTreeUserId(null)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-xs text-slate-300 hover:text-white transition-all"
          >
            <X size={11} />
            Exit folder view
          </button>
        )}
        <div className="flex-1" />
        {treeUserId === null && (
          <span className="text-[11px] text-slate-600">{total.toLocaleString()} reference{total === 1 ? "" : "s"}</span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      {/* Inline admin unlock — shown when the stored password is missing/stale */}
      {authNeeded && (
        <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] px-4 py-4 max-w-md">
          <p className="text-xs font-semibold text-violet-300 mb-1">Admin verification needed</p>
          <p className="text-[11px] text-slate-500 mb-3">Your stored admin password is missing or out of date. Enter it to load reference libraries.</p>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); handleUnlock() }}>
            <input
              type="password"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              placeholder="Admin password"
              className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
            />
            <button
              type="submit"
              disabled={!passwordInput.trim() || verifying}
              className="px-3 py-2 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-500/25 disabled:opacity-40 transition-all"
            >
              {verifying ? <Loader2 size={12} className="animate-spin" /> : "Unlock"}
            </button>
          </form>
          {verifyError && <p className="text-[11px] text-rose-400 mt-2">{verifyError}</p>}
        </div>
      )}

      {/* ── Tree mode ── */}
      {treeUserId !== null ? (
        treeLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={18} className="animate-spin text-slate-600" /></div>
        ) : (
          <div className="space-y-3">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-violet-300/80 font-medium mr-1">{treeUserLabel}</span>
              <button
                onClick={() => setTreePath([])}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors ${currentTreeFolderId === null ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"}`}
              >
                Library
              </button>
              {treePath.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <span className="text-slate-700 text-[11px]">/</span>
                  <button
                    onClick={() => setTreePath(treePath.slice(0, i + 1))}
                    className={`text-[11px] px-2 py-1 rounded-md transition-colors ${i === treePath.length - 1 ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"}`}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
            {/* Folder tiles */}
            {visibleTreeFolders.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {visibleTreeFolders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setTreePath([...treePath, f])}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] hover:bg-amber-500/[0.12] hover:border-amber-500/35 transition-all"
                  >
                    <Folder size={13} className="text-amber-400/80" />
                    <span className="text-xs text-slate-200">{f.name}</span>
                    <span className="text-[10px] text-slate-600 font-mono">{treeRefs.filter(r => r.folderId === f.id).length}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Refs in current folder */}
            {visibleTreeRefs.length === 0 && visibleTreeFolders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-slate-700">
                <ImageIcon size={22} strokeWidth={1.5} />
                <p className="text-xs">Nothing in this folder</p>
              </div>
            ) : (
              <div className={`grid ${gridCls} gap-3`}>
                {visibleTreeRefs.map(r => (
                  <RefCard key={r.id} url={r.url} label={fmtDate(r.createdAt)} sub={r.isCleared ? `Cleared ${r.clearedAt ? fmtDate(r.clearedAt) : ""}` : "Active"} cleared={r.isCleared} />
                ))}
              </div>
            )}
          </div>
        )
      ) : authNeeded ? null : (
        /* ── Flat grid mode ── */
        <>
          {loading && refs.length === 0 ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={18} className="animate-spin text-slate-600" /></div>
          ) : refs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-700">
              <ImageIcon size={22} strokeWidth={1.5} />
              <p className="text-xs">No reference images match these filters</p>
            </div>
          ) : (
            <div className={`grid ${gridCls} gap-3 ${loading ? "opacity-60" : ""}`}>
              {refs.map(r => (
                <RefCard
                  key={r.id}
                  url={r.url}
                  label={r.userEmail ?? `user ${r.userId}`}
                  sub={`${fmtDate(r.createdAt)}${r.folderName ? ` · ${r.folderName}` : ""}`}
                  cleared={r.isCleared}
                />
              ))}
            </div>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] text-slate-500 font-mono">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {preview && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="max-w-3xl max-h-[85vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <img src={preview.url} alt="" className="max-w-full max-h-[78vh] rounded-xl object-contain" />
            <p className="text-[11px] text-slate-400">{preview.label}</p>
          </div>
          <button onClick={() => setPreview(null)} className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-slate-300 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
