"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Download, ExternalLink, Copy, Sparkles, AlertTriangle, Trash2, X, Square,
  Image as ImageIcon, LayoutDashboard, Folder, FolderPlus, MoreVertical,
  ChevronRight, ChevronLeft, FolderInput, EyeOff, Eye, Check, Loader2, Home, Layers,
} from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FeedDropdown } from "@/components/feed/FeedDropdown"
import { MyGenFeed, type MyGenImage } from "@/components/feed/MyGenFeed"

interface GeneratedImage extends MyGenImage {
  prompt: string
  imageUrl: string
  model?: string
  referenceImageUrls?: string[]
  createdAt?: string
  expiresAt?: string
}

type GenFolder = { id: number; name: string; parentId: number | null }

// --- Feed-style persistence (independent from portal-v2's pv2-feed-* keys) ---
const readLS = (key: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
const writeLS = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch {}
}

/*
 * /my-generations — the user's whole library, in folders.
 *
 * LAYOUT. Full width to a 2560px cap, with a gutter that grows with the
 * screen. It used to be a 1152px column, which left most of a 16:9 monitor
 * empty. Wide screens (lg+) get a folder tree in a sticky sidebar and more
 * feed columns (Auto runs from 2 on a phone to 8 on an ultrawide); narrower
 * ones keep the folders as chips above the feed. The toolbar stays pinned.
 *
 * SPEED. The feed starts loading immediately instead of waiting for the
 * session check to come back first (a 401 from the feed sends the user to
 * /login just as the check would). See MyGenFeed for the page cache and
 * prefetch.
 */
export default function MyGenerationsPage() {
  const router = useRouter()
  // Optimistic: assume signed in so the feed starts at once; the check can still say otherwise.
  const [signedIn, setSignedIn] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false)
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all")
  const [total, setTotal] = useState<number | null>(null)

  // Force the feed to fully reload (after move / delete / hide).
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpFeed = useCallback(() => setRefreshKey(k => k + 1), [])

  // --- Feed-style state (hydrated from mg-feed-*) ---
  const [feedOpen, setFeedOpen] = useState(false)
  const [feedCols, setFeedCols] = useState<number | null>(null)
  const [feedFullSize, setFeedFullSize] = useState(true)
  const [feedFullSizeLayout, setFeedFullSizeLayout] = useState<"grid" | "masonry">("masonry")
  const [feedMasonryMode, setFeedMasonryMode] = useState<"flow" | "rows">("rows")
  const [feedTileRes, setFeedTileRes] = useState<"thumb" | "full">("thumb")
  const [feedShowHidden, setFeedShowHidden] = useState(false) // session-only
  const [feedPageSize, setFeedPageSize] = useState(24)
  const [feedHydrated, setFeedHydrated] = useState(false)

  useEffect(() => {
    const colsRaw = readLS("mg-feed-cols", "auto")
    setFeedCols(colsRaw === "auto" || colsRaw === "" ? null : parseInt(colsRaw))
    setFeedFullSize(readLS("mg-feed-fullsize", "1") !== "0")
    setFeedFullSizeLayout(readLS("mg-feed-fullsize-layout", "masonry") === "grid" ? "grid" : "masonry")
    setFeedMasonryMode(readLS("mg-feed-masonry-mode", "rows") === "flow" ? "flow" : "rows")
    setFeedTileRes(readLS("mg-feed-tile-res", "thumb") === "full" ? "full" : "thumb")
    const sizeRaw = parseInt(readLS("mg-feed-page-size", "24"))
    setFeedPageSize([8, 12, 24, 48, 96].includes(sizeRaw) ? sizeRaw : 24)
    setFeedHydrated(true)
  }, [])

  // Persist feed-style changes (only after hydration, so we don't clobber saved prefs)
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-cols", feedCols == null ? "auto" : String(feedCols)) }, [feedCols, feedHydrated])
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-fullsize", feedFullSize ? "1" : "0") }, [feedFullSize, feedHydrated])
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-fullsize-layout", feedFullSizeLayout) }, [feedFullSizeLayout, feedHydrated])
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-masonry-mode", feedMasonryMode) }, [feedMasonryMode, feedHydrated])
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-tile-res", feedTileRes) }, [feedTileRes, feedHydrated])
  useEffect(() => { if (feedHydrated) writeLS("mg-feed-page-size", String(feedPageSize)) }, [feedPageSize, feedHydrated])

  // --- Folder state ---
  const [folders, setFolders] = useState<GenFolder[]>([])
  const [folderPath, setFolderPath] = useState<GenFolder[]>([])
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null
  const visibleFolders = folders.filter(f => (f.parentId ?? null) === currentFolderId)
  // Sidebar tree: folders opened by hand (the path to the current one is always open).
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [menuFolderId, setMenuFolderId] = useState<number | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")

  // --- Select / move / delete ---
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showMovePicker, setShowMovePicker] = useState(false)
  const [movePickerPath, setMovePickerPath] = useState<GenFolder[]>([])
  const [isMoving, setIsMoving] = useState(false)
  const [isHiding, setIsHiding] = useState(false)

  // --- Preview modal ---
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
  // The current page's items, for the preview's previous / next.
  const [navList, setNavList] = useState<MyGenImage[]>([])
  const [fullLoaded, setFullLoaded] = useState(false)
  const [fullFailed, setFullFailed] = useState(false)
  useEffect(() => { setFullLoaded(false); setFullFailed(false) }, [selectedImage?.id])

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/user/generation-folders")
      if (res.ok) {
        const data = await res.json()
        setFolders(data.folders || [])
      }
    } catch {}
  }, [])

  useEffect(() => {
    checkAuth()
    fetchMaintenanceStatus()
    fetchFolders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFolders])

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/session")
      const data = await res.json()
      if (!data.authenticated) { setSignedIn(false); router.push("/login"); return }
      setUser(data.user)
    } catch {
      setSignedIn(false)
      router.push("/login")
    }
  }

  const fetchMaintenanceStatus = async () => {
    try {
      const res = await fetch("/api/admin/config")
      if (res.ok) {
        const data = await res.json()
        setIsMaintenanceMode(!!data.isMaintenanceMode)
      }
    } catch {}
  }

  // --- Folder handlers ---
  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderOpen(false); return }
    setNewFolderName("")
    setNewFolderOpen(false)
    try {
      const res = await fetch("/api/user/generation-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: currentFolderId }),
      })
      if (res.ok) await fetchFolders()
    } catch {}
  }

  const renameFolder = async (id: number) => {
    const name = renameValue.trim()
    setRenamingFolderId(null)
    setMenuFolderId(null)
    if (!name) return
    // Optimistic
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f))
    setFolderPath(prev => prev.map(f => f.id === id ? { ...f, name } : f))
    try {
      await fetch("/api/user/generation-folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      })
    } catch { await fetchFolders() }
  }

  const deleteFolder = async (id: number) => {
    setMenuFolderId(null)
    if (!window.confirm("Delete this folder? Its images and any subfolders move up to the parent — nothing is lost.")) return
    try {
      const res = await fetch(`/api/user/generation-folders?id=${id}`, { method: "DELETE" })
      if (res.ok) {
        // If we're inside the deleted folder (or a descendant), pop back to its parent
        setFolderPath(prev => {
          const idx = prev.findIndex(f => f.id === id)
          return idx >= 0 ? prev.slice(0, idx) : prev
        })
        await fetchFolders()
        bumpFeed()
      }
    } catch {}
  }

  // --- Select handlers ---
  const exitSelectMode = () => { setIsSelectMode(false); setSelectedIds(new Set()) }
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const moveSelectedTo = async (targetFolderId: number | null) => {
    if (selectedIds.size === 0) return
    setIsMoving(true)
    try {
      const res = await fetch("/api/my-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", ids: Array.from(selectedIds), folderId: targetFolderId }),
      })
      if (res.ok) {
        setShowMovePicker(false)
        exitSelectMode()
        bumpFeed()
      }
    } catch {}
    finally { setIsMoving(false) }
  }

  const setSelectedHidden = async (hidden: boolean) => {
    if (selectedIds.size === 0) return
    setIsHiding(true)
    try {
      const res = await fetch("/api/my-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), hidden }),
      })
      if (res.ok) { exitSelectMode(); bumpFeed() }
    } catch {}
    finally { setIsHiding(false) }
  }

  const handleDeleteConfirmed = async () => {
    if (selectedIds.size === 0) return
    setIsDeleting(true)
    try {
      const res = await fetch("/api/my-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      if (res.ok) { exitSelectMode(); bumpFeed() }
    } catch {}
    finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // --- Formatting helpers ---
  const formatDate = (dateString?: string) => {
    if (!dateString) return ""
    const d = new Date(dateString)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  const getModelDisplayName = (model?: string) => {
    if (!model) return ""
    if (model === "nano-banana") return "NanaBanana"
    if (model === "nano-banana-pro") return "NanaBanana Pro"
    if (model === "seedream-4.5") return "SeeDream 4.5"
    if (model === "wan-2.5") return "WAN 2.5"
    if (model === "kling-v3") return "Kling 3.0"
    if (model === "kling-o3") return "Kling O3"
    if (model === "seedance-1.5") return "SeeDance 1.5"
    if (model.includes("gemini") && model.includes("pro")) return "Gemini Pro"
    if (model.includes("gemini") && model.includes("flash")) return "Gemini Flash"
    return model
  }

  const downloadImage = async (image: GeneratedImage) => {
    try {
      const isVideo = !!image.videoMetadata?.isVideo
      const src = isVideo ? image.imageUrl : `/api/images/${image.id}?download=1`
      const response = await fetch(src)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${image.prompt.substring(0, 50)}.${isVideo ? "mp4" : "png"}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {}
  }

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      try {
        const ta = document.createElement("textarea")
        ta.value = prompt
        ta.style.cssText = "position:fixed;left:-999999px"
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      } catch {}
    }
  }

  // --- Preview navigation ---
  const navIndex = selectedImage ? navList.findIndex(i => i.id === selectedImage.id) : -1
  const stepPreview = useCallback((d: 1 | -1) => {
    if (navIndex < 0) return
    const next = navList[navIndex + d]
    if (next) setSelectedImage(next as GeneratedImage)
  }, [navIndex, navList])

  useEffect(() => {
    if (!selectedImage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedImage(null)
      else if (e.key === "ArrowRight") stepPreview(1)
      else if (e.key === "ArrowLeft") stepPreview(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedImage, stepPreview])

  /*
   * Back to the studio at a given view. The studio (/) restores its view from
   * sessionStorage "pv2-view-mode" on load - the same key it writes as you
   * switch views - so setting it first opens the page on Home or the feed.
   */
  const goStudio = (mode: "home" | "image") => {
    try { sessionStorage.setItem("pv2-view-mode", mode) } catch {}
    router.push("/")
  }

  const isAdmin = user?.email === "dirtysecretai@gmail.com"

  if (isMaintenanceMode && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center p-6">
        <div className="text-center p-12 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 max-w-md">
          <AlertTriangle className="mx-auto text-yellow-500 mb-4 animate-pulse" size={48} />
          <h1 className="text-xl font-black text-yellow-400 mb-2">MAINTENANCE MODE</h1>
          <p className="text-slate-400 text-sm">The gallery is temporarily offline. We'll be back soon!</p>
        </div>
      </div>
    )
  }

  // Move-picker: folders navigable from root (all folders shown by parent).
  const movePickerCurrentId = movePickerPath.length > 0 ? movePickerPath[movePickerPath.length - 1].id : null
  const movePickerVisible = folders.filter(f => (f.parentId ?? null) === movePickerCurrentId)

  // The path from the root to a folder, for the sidebar tree.
  const pathTo = (id: number): GenFolder[] => {
    const out: GenFolder[] = []
    let cur = folders.find(f => f.id === id)
    for (let guard = 0; cur && guard < 50; guard++) {
      out.unshift(cur)
      const parentId = cur.parentId
      cur = parentId == null ? undefined : folders.find(f => f.id === parentId)
    }
    return out
  }

  const folderMenu = (f: GenFolder) => menuFolderId === f.id && renamingFolderId !== f.id && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuFolderId(null)} />
      <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-lg border border-white/10 bg-slate-900 shadow-xl overflow-hidden">
        <button
          onClick={() => { setRenamingFolderId(f.id); setRenameValue(f.name) }}
          className="w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5 transition-colors"
        >
          Rename
        </button>
        <button
          onClick={() => deleteFolder(f.id)}
          className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Delete
        </button>
      </div>
    </>
  )

  const renameInput = (f: GenFolder, cls: string) => (
    <input
      autoFocus
      value={renameValue}
      onChange={e => setRenameValue(e.target.value)}
      onBlur={() => renameFolder(f.id)}
      onKeyDown={e => { if (e.key === "Enter") renameFolder(f.id); if (e.key === "Escape") { setRenamingFolderId(null); setMenuFolderId(null) } }}
      className={cls}
    />
  )

  const newFolderControl = (cls: string) => newFolderOpen ? (
    <input
      autoFocus
      value={newFolderName}
      onChange={e => setNewFolderName(e.target.value)}
      onBlur={createFolder}
      onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") { setNewFolderOpen(false); setNewFolderName("") } }}
      placeholder="Folder name"
      className={`px-3 py-2 rounded-lg bg-slate-950 border border-cyan-500/40 text-sm text-white placeholder:text-slate-600 focus:outline-none ${cls}`}
    />
  ) : (
    <button
      onClick={() => setNewFolderOpen(true)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:border-cyan-500/40 hover:bg-cyan-500/5 text-slate-400 hover:text-cyan-300 text-sm transition-all ${cls}`}
    >
      <FolderPlus size={14} /> New folder{currentFolderId !== null ? " here" : ""}
    </button>
  )

  /** Sidebar tree (wide screens): every folder, nested; the open path always expanded. */
  const onPath = new Set(folderPath.map(f => f.id))
  const renderTree = (parentId: number | null, depth: number): React.ReactNode => {
    const kids = folders.filter(f => (f.parentId ?? null) === parentId)
    if (kids.length === 0) return null
    return kids.map(f => {
      const active = f.id === currentFolderId
      const hasKids = folders.some(c => c.parentId === f.id)
      const expanded = onPath.has(f.id) || expandedIds.has(f.id)
      return (
        <div key={f.id}>
          <div className="relative group/row" style={{ paddingLeft: depth * 14 }}>
            {renamingFolderId === f.id ? (
              renameInput(f, "w-full px-2.5 py-1.5 rounded-md bg-slate-950 border border-cyan-500/40 text-[13px] text-white focus:outline-none")
            ) : (
              <div className={`flex items-center gap-0.5 rounded-md pr-1 transition-colors ${active ? "bg-amber-500/10 text-amber-100" : "text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}>
                <button
                  onClick={() => setExpandedIds(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}
                  className={`w-5 h-7 flex items-center justify-center shrink-0 ${hasKids ? "text-slate-500 hover:text-white" : "invisible"}`}
                  aria-label={expanded ? "Collapse" : "Expand"}
                >
                  <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                <button onClick={() => setFolderPath(pathTo(f.id))} className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-[13px] text-left">
                  <Folder size={14} className={active ? "text-amber-300 shrink-0" : "text-amber-400/70 shrink-0"} />
                  <span className="truncate">{f.name}</span>
                </button>
                <button
                  onClick={() => setMenuFolderId(menuFolderId === f.id ? null : f.id)}
                  className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
                  aria-label="Folder options"
                >
                  <MoreVertical size={12} />
                </button>
              </div>
            )}
            {folderMenu(f)}
          </div>
          {expanded && renderTree(f.id, depth + 1)}
        </div>
      )
    })
  }

  const gutter = "px-3 sm:px-6 lg:px-8 2xl:px-12"

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      {/* Subtle grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      {/* Ambient glows */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[300px] bg-fuchsia-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Toolbar - pinned, so filters and Select stay in reach down a long page. */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#050810]/85 backdrop-blur-xl">
        <div className={`w-full max-w-[2560px] mx-auto ${gutter} py-2.5 flex flex-wrap items-center gap-2 sm:gap-3`}>
          <div className="min-w-0 mr-auto flex items-baseline gap-2.5">
            <h1 className="text-lg sm:text-xl font-black text-white tracking-tight whitespace-nowrap">My Generations</h1>
            {total !== null && (
              <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">{total.toLocaleString()} {total === 1 ? "item" : "items"}</span>
            )}
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/6 bg-black/30">
            {(["all", "image", "video"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  typeFilter === t ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t === "all" ? "All" : t === "image" ? "Images" : "Videos"}
              </button>
            ))}
          </div>

          {/* Feed settings */}
          <div className="w-[104px]">
            <FeedDropdown
              open={feedOpen}
              onToggle={() => setFeedOpen(o => !o)}
              cols={feedCols}
              onColsChange={setFeedCols}
              fullSize={feedFullSize}
              onFullSizeChange={setFeedFullSize}
              fullSizeLayout={feedFullSizeLayout}
              onFullSizeLayoutChange={setFeedFullSizeLayout}
              masonryMode={feedMasonryMode}
              onMasonryModeChange={setFeedMasonryMode}
              tileRes={feedTileRes}
              onTileResChange={setFeedTileRes}
              showHidden={feedShowHidden}
              onShowHiddenChange={setFeedShowHidden}
              pageSize={feedPageSize}
              onPageSizeChange={setFeedPageSize}
            />
          </div>

          {/* Select toggle */}
          {isSelectMode ? (
            <button
              onClick={exitSelectMode}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all"
            >
              <X size={12} /> Cancel
            </button>
          ) : (
            <button
              onClick={() => setIsSelectMode(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs transition-all"
            >
              <Square size={12} /> Select
            </button>
          )}

          {/* Way out: Home, the feed, or the dashboard. Icons only on a phone. */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/6 bg-black/30">
            <button onClick={() => goStudio("home")} title="Home" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <Home size={12} /> <span className="hidden sm:inline">Home</span>
            </button>
            <button onClick={() => goStudio("image")} title="Feed" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <Layers size={12} /> <span className="hidden sm:inline">Feed</span>
            </button>
            <Link href="/dashboard" title="Dashboard" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <LayoutDashboard size={12} /> <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      <div className={`relative z-10 w-full max-w-[2560px] mx-auto ${gutter} py-4 sm:py-6 flex gap-6 2xl:gap-8`}>

        {/* Folder sidebar (wide screens) */}
        <aside className="hidden lg:block w-56 xl:w-64 shrink-0">
          <div className="sticky top-[76px] max-h-[calc(100vh-96px)] overflow-y-auto pr-1 space-y-0.5 [scrollbar-width:thin]">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Folders</p>
            <button
              onClick={() => setFolderPath([])}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors ${currentFolderId === null ? "bg-cyan-500/10 text-cyan-200" : "text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}
            >
              <ImageIcon size={14} className="shrink-0" /> Unfiled
            </button>
            {renderTree(null, 0)}
            <div className="pt-2">{newFolderControl("w-full")}</div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 flex-wrap mb-3 text-sm">
            <button
              onClick={() => setFolderPath([])}
              className={`px-2 py-1 rounded-md transition-colors ${currentFolderId === null ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}
            >
              My Generations
            </button>
            {folderPath.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight size={13} className="text-slate-700" />
                <button
                  onClick={() => setFolderPath(folderPath.slice(0, i + 1))}
                  className={`px-2 py-1 rounded-md transition-colors ${i === folderPath.length - 1 ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </div>

          {/* Select-mode action bar - pinned under the toolbar while selecting. */}
          {isSelectMode && (
            <div className="lg:sticky lg:top-[64px] z-20 flex items-center gap-2 flex-wrap mb-4 p-2.5 rounded-xl border border-cyan-500/20 bg-[#07121a]/95 backdrop-blur-md">
              <span className="text-xs text-slate-400 px-1">{selectedIds.size} selected</span>
              <div className="flex-1" />
              <button
                onClick={() => { setMovePickerPath([]); setShowMovePicker(true) }}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold transition-all disabled:opacity-30"
              >
                <FolderInput size={12} /> Move
              </button>
              {feedShowHidden ? (
                <button
                  onClick={() => setSelectedHidden(false)}
                  disabled={selectedIds.size === 0 || isHiding}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-all disabled:opacity-30"
                >
                  <Eye size={12} /> Unhide
                </button>
              ) : (
                <button
                  onClick={() => setSelectedHidden(true)}
                  disabled={selectedIds.size === 0 || isHiding}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-all disabled:opacity-30"
                >
                  <EyeOff size={12} /> Hide
                </button>
              )}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-all disabled:opacity-30"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}

          {/* Folder chips (narrower screens; wide ones have the sidebar) */}
          <div className="lg:hidden flex items-center flex-wrap gap-2 mb-5">
            {visibleFolders.map(f => (
              <div key={f.id} className="relative">
                {renamingFolderId === f.id ? (
                  renameInput(f, "w-40 px-3 py-2 rounded-lg bg-slate-950 border border-cyan-500/40 text-sm text-white focus:outline-none")
                ) : (
                  <div className="flex items-center gap-1.5 pl-3 pr-1 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] hover:border-amber-500/40 transition-colors">
                    <button
                      onClick={() => setFolderPath(p => [...p, f])}
                      className="flex items-center gap-2 text-sm text-amber-200/90 hover:text-amber-100 transition-colors max-w-[180px] truncate"
                    >
                      <Folder size={14} className="text-amber-400 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                    <button
                      onClick={() => setMenuFolderId(menuFolderId === f.id ? null : f.id)}
                      className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <MoreVertical size={13} />
                    </button>
                  </div>
                )}
                {folderMenu(f)}
              </div>
            ))}
            {newFolderControl("w-40")}
          </div>

          {/* Feed - starts loading at once, alongside the session check. */}
          <MyGenFeed
            signedIn={signedIn}
            cols={feedCols}
            fullSize={feedFullSize}
            fullSizeLayout={feedFullSizeLayout}
            masonryMode={feedMasonryMode}
            tileRes={feedTileRes}
            showHidden={feedShowHidden}
            typeFilter={typeFilter}
            folderId={currentFolderId}
            pageSize={feedPageSize}
            selectMode={isSelectMode}
            selectedIds={selectedIds}
            onSelectToggle={toggleSelect}
            onImageClick={(img) => setSelectedImage(img as GeneratedImage)}
            onNavListChange={setNavList}
            onTotalChange={setTotal}
            refreshKey={refreshKey}
          />
        </main>
      </div>

      {/* ── Move picker ──────────────────────────────────────────────────────── */}
      {showMovePicker && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowMovePicker(false)}>
          <div className="rounded-2xl border border-white/8 bg-[#0a0f1a] p-5 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-bold text-base flex items-center gap-2">
                <FolderInput size={16} className="text-cyan-400" />
                Move {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}
              </h2>
              <button onClick={() => setShowMovePicker(false)} className="p-1 text-slate-500 hover:text-white"><X size={16} /></button>
            </div>

            {/* Picker breadcrumb */}
            <div className="flex items-center gap-1 flex-wrap mb-2 text-xs">
              <button
                onClick={() => setMovePickerPath([])}
                className={`px-2 py-1 rounded-md ${movePickerCurrentId === null ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}
              >
                Unfiled
              </button>
              {movePickerPath.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <ChevronRight size={12} className="text-slate-700" />
                  <button
                    onClick={() => setMovePickerPath(movePickerPath.slice(0, i + 1))}
                    className={`px-2 py-1 rounded-md ${i === movePickerPath.length - 1 ? "text-white font-semibold" : "text-slate-500 hover:text-white"}`}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>

            {/* Picker folder list */}
            <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2 mb-4 max-h-56 overflow-y-auto">
              {movePickerVisible.length === 0 ? (
                <p className="text-[11px] text-slate-600 text-center py-6">No subfolders here</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {movePickerVisible.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setMovePickerPath(p => [...p, f])}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-amber-500/15 bg-amber-500/[0.04] hover:border-amber-500/40 text-amber-200/90 text-xs transition-colors"
                    >
                      <span className="flex items-center gap-2 truncate"><Folder size={13} className="text-amber-400 shrink-0" /> {f.name}</span>
                      <ChevronRight size={13} className="text-slate-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => moveSelectedTo(movePickerCurrentId)}
              disabled={isMoving}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-sm font-semibold transition-all disabled:opacity-40"
            >
              {isMoving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Move here — {movePickerCurrentId === null ? "Unfiled (My Generations)" : movePickerPath[movePickerPath.length - 1].name}
            </button>
          </div>
        </div>
      )}

      {/* ── Preview Modal ────────────────────────────────────────────────────── */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={() => setSelectedImage(null)}>
          <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedImage(null) }}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-black/60 backdrop-blur-sm text-slate-300 hover:text-white text-xs font-medium transition-all"
            >
              <X size={13} /> Close
            </button>
            {navIndex >= 0 && navList.length > 1 && (
              <span className="px-2.5 py-1 rounded-md bg-black/60 text-[11px] font-mono text-slate-400">{navIndex + 1} / {navList.length}</span>
            )}
          </div>

          <div className="relative flex-1 flex items-center justify-center p-4 pt-14 min-h-0" onClick={(e) => e.stopPropagation()}>
            {selectedImage.videoMetadata?.isVideo ? (
              <video key={selectedImage.id} src={selectedImage.imageUrl} controls autoPlay loop playsInline className="max-w-full max-h-full object-contain rounded-xl" />
            ) : (
              /*
               * The full-size file straight from storage (the URL comes signed),
               * with the thumbnail shown under it until it arrives - rather than
               * a blank wait on /api/images/[id], which proxies the whole file
               * through the server first. That route stays as the fallback.
               */
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                {!fullLoaded && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedImage.thumbnailUrl || `/api/images/${selectedImage.id}?thumb=1`}
                    alt=""
                    className="max-w-full max-h-[calc(100vh-220px)] object-contain rounded-xl blur-[1px]"
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={selectedImage.id}
                  src={fullFailed ? `/api/images/${selectedImage.id}` : selectedImage.imageUrl}
                  alt={selectedImage.prompt}
                  onLoad={() => setFullLoaded(true)}
                  onError={() => { if (!fullFailed) setFullFailed(true) }}
                  className={`max-w-full max-h-[calc(100vh-220px)] object-contain rounded-xl ${fullLoaded ? "" : "absolute inset-0 m-auto opacity-0"}`}
                />
              </div>
            )}

            {/* Previous / next within the page (also the arrow keys). */}
            {navIndex > 0 && (
              <button
                onClick={() => stepPreview(-1)}
                aria-label="Previous"
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 border border-white/10 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {navIndex >= 0 && navIndex < navList.length - 1 && (
              <button
                onClick={() => stepPreview(1)}
                aria-label="Next"
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 border border-white/10 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          <div className="border-t border-white/6 bg-black/80 backdrop-blur-sm px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4" onClick={(e) => e.stopPropagation()}>
            <div className="max-w-4xl mx-auto">
              <div className="flex items-start gap-2 mb-3">
                <Sparkles className="text-cyan-400 flex-shrink-0 mt-0.5" size={13} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs sm:text-sm line-clamp-2">{selectedImage.prompt}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono">
                      {getModelDisplayName(selectedImage.model)}
                    </span>
                    <span className="text-[10px] text-slate-500">{formatDate(selectedImage.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => downloadImage(selectedImage)}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 transition-all"
                >
                  <Download size={13} /> Download
                </button>
                <button
                  onClick={() => copyPrompt(selectedImage.prompt)}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold hover:bg-purple-500/30 transition-all"
                >
                  <Copy size={13} /> Copy Prompt
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("rescan_prompt", selectedImage.prompt)
                    if (selectedImage.referenceImageUrls && selectedImage.referenceImageUrls.length > 0) {
                      localStorage.setItem("rescan_reference_images", JSON.stringify(selectedImage.referenceImageUrls))
                    } else {
                      localStorage.removeItem("rescan_reference_images")
                    }
                    router.push("/")
                  }}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-500/30 transition-all"
                >
                  <Sparkles size={13} /> Rescan
                </button>
                <a
                  href={selectedImage.videoMetadata?.isVideo ? selectedImage.imageUrl : `/api/images/${selectedImage.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/10 transition-all"
                >
                  <ExternalLink size={13} /> Open
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ──────────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/8 bg-[#0a0f1a] p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                <Trash2 className="text-red-400" size={18} />
              </div>
              <div>
                <h2 className="text-white font-bold text-base">Delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}?</h2>
                <p className="text-slate-500 text-xs mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">
              {selectedIds.size === 1
                ? "Permanently delete this generation from your gallery?"
                : `Permanently delete these ${selectedIds.size} generations from your gallery?`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 text-slate-300 font-semibold text-xs transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600/80 hover:bg-red-600 border border-red-500/30 disabled:opacity-50 text-white font-bold text-xs transition-all"
              >
                {isDeleting ? "Deleting..." : `Delete ${selectedIds.size === 1 ? "Item" : `${selectedIds.size} Items`}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
