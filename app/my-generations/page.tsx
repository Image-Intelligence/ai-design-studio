"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Download, ExternalLink, Copy, Sparkles, AlertTriangle, Trash2, X, Square, CheckSquare,
  Images, LayoutDashboard, Folder, FolderOpen, FolderPlus, MoreVertical, Music,
  ChevronRight, ChevronLeft, FolderInput, EyeOff, Eye, Loader2, Home, Layers, Boxes, ImagePlus,
  FolderPlus as FolderAdd, FolderMinus, Search, Image as ImageIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FeedDropdown } from "@/components/feed/FeedDropdown"
import { MyGenFeed, type MyGenImage } from "@/components/feed/MyGenFeed"
import { MYGEN_FEED_DEFAULTS, sanitizeMyGenFeed, type MyGenFeedSettings } from "@/lib/mygen-feed-settings"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { ShopBackdrop } from "@/components/shop/ShopKit"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import {
  useUserAssets, AssetsGrid, AssetEditor, NewAssetModal, AddToAssetModal, type UserAsset,
} from "@/components/my-generations/Assets"
import type { AssetKind } from "@/lib/storyboard"
import { FolderPicker, touchRecentFolders, type PickerMode } from "@/components/my-generations/FolderPicker"
import { holdCardVideos } from "@/components/home/card-video-scheduler"
import { RefLibraryGrid } from "@/components/my-generations/RefLibraryGrid"

interface GeneratedImage extends MyGenImage {
  prompt: string
  imageUrl: string
  model?: string
  referenceImageUrls?: string[]
  createdAt?: string
  expiresAt?: string
}

/** A folder, and (from /api/user/generation-folders) what its card shows: newest pictures, counts. */
type GenFolder = { id: number; name: string; parentId: number | null; count?: number; subfolders?: number; previews?: string[]; previewsFromSubfolders?: boolean }
/** "library" = the account's reference library (the Refs panel's uploads) */
type View = "generations" | "assets" | "library"

/*
 * The feed layout is site-wide: admins set it in the Feed dropdown for every
 * account (/api/site/mygen-feed). The last copy seen is kept in localStorage
 * only so the feed can start with the right page size before the request
 * returns; the server's copy always wins.
 */
const FEED_CACHE_KEY = "mg-feed-global"
const readFeedCache = (): MyGenFeedSettings | null => {
  try { const v = localStorage.getItem(FEED_CACHE_KEY); return v ? sanitizeMyGenFeed(JSON.parse(v)) : null } catch { return null }
}
const writeFeedCache = (v: MyGenFeedSettings) => {
  try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(v)) } catch {}
}
const VIEW_KEY = "mg-view"

/*
 * /my-generations — the user's whole library, in folders, and the assets
 * (characters, vehicles, props, places...) they build from it.
 *
 * LAYOUT. Full width to a 2560px cap, with a gutter that grows with the
 * screen. Wide screens (lg+) get a folder tree in a sticky sidebar and more
 * feed columns (Auto runs from 2 on a phone to 8 on an ultrawide); narrower
 * ones keep the folders as chips above the feed. The toolbar stays pinned.
 *
 * BRAND (2026-10-07). The site's silver: the synced logo in its spinning
 * ring, silver-shimmer titles, static .silver-edge panels and BrandButtons -
 * the Studios' treatment, replacing the old cyan / amber / fuchsia accents.
 *
 * ASSETS (2026-10-07). Saved to the account (/api/user/assets) and used in
 * Storyboard Studio. Pictures come from the feed: Select → Add to asset, or
 * an asset's "Add pictures", which drops into Select mode aimed at it.
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
  const [view, setViewState] = useState<View>("generations")
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch {} }
  useEffect(() => { try { if (localStorage.getItem(VIEW_KEY) === "assets") setViewState("assets") } catch {} }, [])

  // The toolbar's height (it wraps on narrow screens): the select bar pins just below it
  const headerRef = useRef<HTMLElement>(null)
  const [headerH, setHeaderH] = useState(60)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Force the feed to fully reload (after move / delete / hide).
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpFeed = useCallback(() => setRefreshKey(k => k + 1), [])

  // A short note at the foot of the screen ("Added 4 pictures to Captain Mara")
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3800)
  }

  // --- Feed layout (site-wide; admins edit it) ---
  const [feedOpen, setFeedOpen] = useState(false)
  const [feed, setFeed] = useState<MyGenFeedSettings>(MYGEN_FEED_DEFAULTS)
  const [feedReady, setFeedReady] = useState(false)
  const [canEditFeed, setCanEditFeed] = useState(false)
  const [feedSave, setFeedSave] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedRef = useRef(feed)
  feedRef.current = feed
  // Personal, per visit: viewing your own hidden generations is not a layout choice.
  const [feedShowHidden, setFeedShowHidden] = useState(false)

  useEffect(() => {
    const cached = readFeedCache()
    if (cached) setFeed(cached)
    setFeedReady(true)
    fetch("/api/site/mygen-feed", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const s = sanitizeMyGenFeed(d.settings)
        setFeed(s)
        writeFeedCache(s)
        setCanEditFeed(!!d.canEdit)
      })
      .catch(() => {})
  }, [])

  /** An admin's change: applied here at once, saved for everyone shortly after. */
  const updateFeed = (patch: Partial<MyGenFeedSettings>) => {
    if (!canEditFeed) return
    const next = { ...feedRef.current, ...patch }
    feedRef.current = next
    setFeed(next)
    writeFeedCache(next)
    // One save for a burst of changes (dragging the column slider).
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setFeedSave("saving")
    saveTimer.current = setTimeout(() => {
      fetch("/api/site/mygen-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: feedRef.current }),
      })
        .then(r => setFeedSave(r.ok ? "saved" : "error"))
        .catch(() => setFeedSave("error"))
    }, 500)
  }

  // --- Folder state ---
  const [folders, setFolders] = useState<GenFolder[]>([])
  // The latest list for handlers that run right after a change (a folder made
  // in the picker is moved into before the next render)
  const foldersRef = useRef<GenFolder[]>(folders)
  foldersRef.current = folders
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
  // In-page confirm (the old window.confirm froze the page and looked foreign)
  const [folderToDelete, setFolderToDelete] = useState<GenFolder | null>(null)

  // --- Select / move / delete ---
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  // The folder picker: Move (where they live) or Add to folder (shown there too)
  const [picker, setPicker] = useState<PickerMode | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [isHiding, setIsHiding] = useState(false)
  // Sidebar tree search (every folder)
  const [treeQuery, setTreeQuery] = useState("")

  // --- Assets ---
  const assetsApi = useUserAssets(signedIn)
  // How many references are in the library (badge on the Library entry);
  // RefLibraryGrid keeps it current once it's open
  const [refCount, setRefCount] = useState<number | null>(null)
  useEffect(() => {
    if (!signedIn) return
    fetch("/api/user/references", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j && typeof j.count === "number") setRefCount(j.count) })
      .catch(() => {})
  }, [signedIn])
  const [openAssetId, setOpenAssetId] = useState<number | null>(null)
  const openAsset = assetsApi.assets?.find(a => a.id === openAssetId) ?? null
  const [newAssetOpen, setNewAssetOpen] = useState(false)
  const [addToAssetOpen, setAddToAssetOpen] = useState(false)
  /** "Add pictures" from an asset: Select mode, aimed at it. */
  const [pickingFor, setPickingFor] = useState<UserAsset | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  // --- Preview modal ---
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
  // The current page's items, for the preview's previous / next (and Select page).
  const [navList, setNavList] = useState<MyGenImage[]>([])
  const [fullLoaded, setFullLoaded] = useState(false)
  const [fullFailed, setFullFailed] = useState(false)
  useEffect(() => { setFullLoaded(false); setFullFailed(false) }, [selectedImage?.id])
  // A viewer or the folder picker over the feed: the feed's video cycle holds
  // still (frozen frames, nothing new starts) until it closes - crossfading
  // tiles behind a popup shimmer and take the viewer's decoders
  const overlayOpen = !!selectedImage || !!picker
  useEffect(() => (overlayOpen ? holdCardVideos() : undefined), [overlayOpen])

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
      if (res.ok) { touchRecentFolders([(await res.json())?.folder?.id]); await fetchFolders() }
    } catch {}
  }

  /** A folder made from the picker (it then saves the selection into it). */
  const createFolderIn = async (name: string, parentId: number | null): Promise<GenFolder | null> => {
    const res = await fetch("/api/user/generation-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    })
    if (!res.ok) return null
    const f = (await res.json())?.folder as GenFolder | undefined
    if (!f) return null
    touchRecentFolders([f.id])
    foldersRef.current = [...foldersRef.current, { id: f.id, name: f.name, parentId: f.parentId ?? null }]
    setFolders(prev => [...prev, { id: f.id, name: f.name, parentId: f.parentId ?? null }])
    return { id: f.id, name: f.name, parentId: f.parentId ?? null }
  }

  const renameFolder = async (id: number) => {
    const name = renameValue.trim()
    setRenamingFolderId(null)
    setMenuFolderId(null)
    if (!name) return
    touchRecentFolders([id])
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
    setFolderToDelete(null)
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
  const exitSelectMode = () => { setIsSelectMode(false); setSelectedIds(new Set()); setPickingFor(null) }
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const pageIds = navList.map(i => i.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  const selectPage = () => setSelectedIds(prev => {
    const next = new Set(prev)
    if (allPageSelected) pageIds.forEach(id => next.delete(id))
    else pageIds.forEach(id => next.add(id))
    return next
  })

  const folderName = (id: number | null) => (id === null ? "Unfiled" : foldersRef.current.find(f => f.id === id)?.name ?? "the folder")

  /** Move: the selection now LIVES in this folder (and leaves the one being viewed). Throws so the picker can say why. */
  const moveSelectedTo = async (targetFolderId: number | null) => {
    if (selectedIds.size === 0) return
    const n = selectedIds.size
    const res = await fetch("/api/my-images", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", ids: Array.from(selectedIds), folderId: targetFolderId, fromFolderId: currentFolderId }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Could not move them")
    touchRecentFolders([targetFolderId])
    setPicker(null)
    exitSelectMode()
    bumpFeed()
    fetchFolders()
    flash(`Moved ${n} to ${folderName(targetFolderId)}`)
  }

  /** Add to folder: the selection is ALSO shown in these folders; it stays where it is. */
  const addSelectedTo = async (folderIds: number[]) => {
    if (selectedIds.size === 0 || folderIds.length === 0) return
    const n = selectedIds.size
    const res = await fetch("/api/my-images", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", ids: Array.from(selectedIds), folderIds }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Could not add them")
    touchRecentFolders(folderIds)
    setPicker(null)
    exitSelectMode()
    bumpFeed()
    fetchFolders()
    flash(`Added ${n} to ${folderIds.length === 1 ? folderName(folderIds[0]) : `${folderIds.length} folders`}`)
  }

  /** Out of the folder being viewed (added ones lose the link; ones living here go to Unfiled). */
  const removeSelectedFromFolder = async () => {
    if (selectedIds.size === 0 || currentFolderId === null) return
    setIsRemoving(true)
    try {
      const n = selectedIds.size
      const res = await fetch("/api/my-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", ids: Array.from(selectedIds), folderId: currentFolderId }),
      })
      if (res.ok) { exitSelectMode(); bumpFeed(); fetchFolders(); flash(`Took ${n} out of ${folderName(currentFolderId)}`) }
    } catch {}
    finally { setIsRemoving(false) }
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
      if (res.ok) { exitSelectMode(); bumpFeed(); fetchFolders() }
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
      if (res.ok) { exitSelectMode(); bumpFeed(); fetchFolders() }
    } catch {}
    finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // --- Asset handlers ---
  /** These pictures into an asset; says how many went in (videos and duplicates do not). */
  const addIdsToAsset = async (a: UserAsset, ids: number[]) => {
    const { asset, added } = await assetsApi.update({ id: a.id, addImageIds: ids })
    const skipped = ids.length - added
    flash(added === 0
      ? `Nothing added to ${asset.name} - already there, videos, or the asset is full`
      : `Added ${added} picture${added === 1 ? "" : "s"} to ${asset.name}${skipped > 0 ? ` (${skipped} skipped)` : ""}`)
    return asset
  }
  const startPickingFor = (a: UserAsset) => {
    setOpenAssetId(null)
    setView("generations")
    setFeedShowHidden(false)
    setSelectedIds(new Set())
    setIsSelectMode(true)
    setPickingFor(a)
  }
  const finishPicking = async () => {
    if (!pickingFor || selectedIds.size === 0) return
    setIsAdding(true)
    try {
      const a = await addIdsToAsset(pickingFor, Array.from(selectedIds))
      exitSelectMode()
      setView("assets")
      setOpenAssetId(a.id)
    } catch (e: any) { flash(String(e?.message || e)) }
    finally { setIsAdding(false) }
  }
  const createAsset = async (kind: AssetKind, name: string) => {
    const a = await assetsApi.create({ kind, name })
    setNewAssetOpen(false)
    startPickingFor(a)
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
    flash("Prompt copied")
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
  const openFolder = (path: GenFolder[]) => { setFolderPath(path); setView("generations") }

  const folderMenu = (f: GenFolder) => menuFolderId === f.id && renamingFolderId !== f.id && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuFolderId(null)} />
      <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-xl border border-white/10 bg-[#0b111d]/95 backdrop-blur-md shadow-2xl overflow-hidden">
        <button
          onClick={() => { setRenamingFolderId(f.id); setRenameValue(f.name) }}
          className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.06] transition-colors"
        >
          Rename
        </button>
        <button
          onClick={() => { setMenuFolderId(null); setFolderToDelete(f) }}
          className="w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10 transition-colors"
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
      className={`px-3 py-2 rounded-lg bg-black/40 border border-white/30 text-sm text-white placeholder:text-slate-600 focus:outline-none ${cls}`}
    />
  ) : (
    <button
      onClick={() => setNewFolderOpen(true)}
      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:border-white/40 hover:bg-white/[0.05] text-slate-400 hover:text-white text-[12px] font-semibold transition-all ${cls}`}
    >
      <FolderPlus size={13} /> New folder{currentFolderId !== null ? " here" : ""}
    </button>
  )

  /** Sidebar tree (wide screens): every folder, nested; the open path always expanded. */
  const onPath = new Set(folderPath.map(f => f.id))
  const renderTree = (parentId: number | null, depth: number): React.ReactNode => {
    const kids = folders.filter(f => (f.parentId ?? null) === parentId)
    if (kids.length === 0) return null
    return kids.map(f => {
      const active = view === "generations" && f.id === currentFolderId
      const hasKids = folders.some(c => c.parentId === f.id)
      const expanded = onPath.has(f.id) || expandedIds.has(f.id)
      return (
        <div key={f.id}>
          <div className="relative group/row" style={{ paddingLeft: depth * 12 }}>
            {renamingFolderId === f.id ? (
              renameInput(f, "w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/30 text-[13px] text-white focus:outline-none")
            ) : (
              <div className={`flex items-center gap-0.5 rounded-lg pr-1 border transition-colors ${active ? "bg-white/[0.10] border-white/20 text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}>
                <button
                  onClick={() => setExpandedIds(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}
                  className={`w-5 h-7 flex items-center justify-center shrink-0 ${hasKids ? "text-slate-500 hover:text-white" : "invisible"}`}
                  aria-label={expanded ? "Collapse" : "Expand"}
                >
                  <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                <button onClick={() => openFolder(pathTo(f.id))} className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-[13px] text-left">
                  {active
                    ? <FolderOpen size={14} className="text-slate-100 shrink-0" />
                    : <Folder size={14} className="text-slate-500 shrink-0" />}
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

  /*
   * Folder cards (2026-10-07): the open folder's subfolders, first in the feed
   * among the generations, like the admin dataset page's folders - a 2x2 of
   * the newest pictures inside (or the subfolders' when it has none of its
   * own), the name and counts. Click to open; the menu renames / deletes.
   */
  const folderTiles = pickingFor ? [] : visibleFolders.map(f => {
    const pics = f.previews ?? []
    const parts = [f.count ? `${f.count.toLocaleString()} item${f.count === 1 ? "" : "s"}` : null, f.subfolders ? `${f.subfolders} folder${f.subfolders === 1 ? "" : "s"}` : null].filter(Boolean)
    return {
      key: `folder-${f.id}`,
      node: (
        <div className="relative group/folder">
          {renamingFolderId === f.id ? (
            <div className="aspect-square rounded-xl silver-edge flex items-center p-3">
              {renameInput(f, "w-full px-2.5 py-2 rounded-lg bg-black/50 border border-white/30 text-sm text-white focus:outline-none")}
            </div>
          ) : (
            <button
              onClick={() => setFolderPath(p => [...p, f])}
              title={`Open ${f.name}`}
              className="relative block w-full aspect-square rounded-xl overflow-hidden silver-edge bg-[#0b111d] text-left transition-transform hover:-translate-y-0.5"
            >
              {pics.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                  {f.count ? <Music size={34} /> : <Folder size={38} />}
                </div>
              ) : pics.length === 1 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pics[0]} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-black/40">
                  {[0, 1, 2, 3].map(k => (
                    <div key={k} className="relative overflow-hidden bg-white/[0.03]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {pics[k] && <img src={pics[k]} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = "none" }} />}
                    </div>
                  ))}
                </div>
              )}
              {/* The name over a dark foot, with what is inside */}
              <div className="absolute inset-x-0 bottom-0 pt-8 pb-2.5 px-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-white truncate">
                  <Folder size={13} className="shrink-0 text-slate-300" /> <span className="truncate">{f.name}</span>
                </p>
                <p className="text-[10px] font-mono text-slate-400 truncate">
                  {parts.length ? parts.join(" · ") : "Empty"}{f.previewsFromSubfolders ? " · from subfolders" : ""}
                </p>
              </div>
            </button>
          )}
          {renamingFolderId !== f.id && (
            <button
              onClick={e => { e.stopPropagation(); setMenuFolderId(menuFolderId === f.id ? null : f.id) }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/65 border border-white/15 text-slate-200 hover:text-white opacity-0 group-hover/folder:opacity-100 focus:opacity-100 transition-opacity"
              aria-label="Folder options"
            >
              <MoreVertical size={13} />
            </button>
          )}
          <div className="absolute top-9 right-2">{folderMenu(f)}</div>
        </div>
      ),
    }
  })

  const gutter = "px-3 sm:px-6 lg:px-8 2xl:px-12"
  const chip = "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all"
  const chipOff = "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white"
  const chipOn = "border-white/30 bg-white/[0.12] text-white"
  const segBtn = (on: boolean) => `px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-all ${on ? "bg-white/[0.14] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" : "text-slate-500 hover:text-slate-200"}`

  return (
    <div className="min-h-screen bg-[#05080f] text-white">
      <ShopBackdrop />

      {/* Toolbar - pinned, so filters and Select stay in reach down a long page. */}
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#05080f]/85 backdrop-blur-xl">
        <div className={`w-full max-w-[2560px] mx-auto ${gutter} py-2.5 flex flex-wrap items-center gap-2 sm:gap-3`}>
          {/* Brand: the synced logo and the page's title */}
          <div className="min-w-0 mr-auto flex items-center gap-2.5">
            <button onClick={() => goStudio("home")} title="Home" className="shrink-0"><SiteLogoBox size={34} rounded={9} /></button>
            <div className="min-w-0">
              <h1 className="text-[15px] sm:text-lg font-black tracking-tight leading-tight silver-shimmer-text whitespace-nowrap">My Generations</h1>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap">
                {view === "assets"
                  ? `${assetsApi.assets?.length ?? 0} asset${assetsApi.assets?.length === 1 ? "" : "s"}`
                  : view === "library"
                  ? `${refCount ?? 0} reference${refCount === 1 ? "" : "s"}`
                  : total !== null ? `${total.toLocaleString()} ${total === 1 ? "item" : "items"}${feedShowHidden ? " hidden" : ""}` : "Your library"}
              </p>
            </div>
          </div>

          {/* Generations / Assets */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-black/40">
            <button onClick={() => setView("generations")} className={`${segBtn(view === "generations")} flex items-center gap-1.5`}>
              <Images size={12} /> <span>Generations</span>
            </button>
            <button onClick={() => { setView("assets"); if (isSelectMode && !pickingFor) exitSelectMode() }} className={`${segBtn(view === "assets")} flex items-center gap-1.5`}>
              <Boxes size={12} /> <span>Assets</span>
              {!!assetsApi.assets?.length && <span className="text-[9.5px] font-mono text-slate-400">{assetsApi.assets.length}</span>}
            </button>
            <button onClick={() => { setView("library"); if (isSelectMode && !pickingFor) exitSelectMode() }} className={`${segBtn(view === "library")} flex items-center gap-1.5`}
              title="Your reference library - the pictures you've uploaded to Refs">
              <ImageIcon size={12} /> <span>Library</span>
              {!!refCount && <span className="text-[9.5px] font-mono text-slate-400">{refCount}</span>}
            </button>
          </div>

          {view === "generations" && (
            <>
              {/* Type filter */}
              <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-black/40">
                {(["all", "image", "video"] as const).map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)} className={segBtn(typeFilter === t)}>
                    {t === "all" ? "All" : t === "image" ? "Images" : "Videos"}
                  </button>
                ))}
              </div>

              {/* Your hidden generations (personal). */}
              <button
                onClick={() => setFeedShowHidden(v => !v)}
                title={feedShowHidden ? "Back to your generations" : "View the generations you have hidden"}
                className={`${chip} ${feedShowHidden ? chipOn : chipOff}`}
              >
                {feedShowHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                <span className="hidden sm:inline">{feedShowHidden ? "Viewing hidden" : "Hidden"}</span>
                {feedShowHidden && <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />}
              </button>

              {/* Feed layout - admins only, and it changes the page for every account. */}
              {canEditFeed && (
                <FeedDropdown
                  open={feedOpen}
                  onToggle={() => setFeedOpen(o => !o)}
                  cols={feed.cols}
                  onColsChange={cols => updateFeed({ cols })}
                  fullSize={feed.fullSize}
                  onFullSizeChange={fullSize => updateFeed({ fullSize })}
                  fullSizeLayout={feed.fullSizeLayout}
                  onFullSizeLayoutChange={fullSizeLayout => updateFeed({ fullSizeLayout })}
                  masonryMode={feed.masonryMode}
                  onMasonryModeChange={masonryMode => updateFeed({ masonryMode })}
                  tileRes={feed.tileRes}
                  onTileResChange={tileRes => updateFeed({ tileRes })}
                  pageSize={feed.pageSize}
                  onPageSizeChange={pageSize => updateFeed({ pageSize })}
                  scope="All users"
                  status={feedSave === "saving" ? "Saving…" : feedSave === "saved" ? "Saved for everyone" : feedSave === "error" ? <span className="text-red-400">Not saved</span> : null}
                />
              )}

              {/* Select toggle */}
              <button
                onClick={() => (isSelectMode ? exitSelectMode() : setIsSelectMode(true))}
                className={`${chip} ${isSelectMode ? chipOn : chipOff}`}
              >
                {isSelectMode ? <><X size={12} /> Done</> : <><CheckSquare size={12} /> Select</>}
              </button>
            </>
          )}

          {view === "assets" && (
            <BrandButton onClick={() => setNewAssetOpen(true)} primary size="md" icon={<ImagePlus size={13} />}>New asset</BrandButton>
          )}

          {/* Way out: Home, the feed, or the dashboard. Icons only on a phone. */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-black/40">
            <button onClick={() => goStudio("home")} title="Home" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <Home size={12} /> <span className="hidden xl:inline">Home</span>
            </button>
            <button onClick={() => goStudio("image")} title="Studio feed" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <Layers size={12} /> <span className="hidden xl:inline">Studio</span>
            </button>
            <Link href="/dashboard" title="Dashboard" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
              <LayoutDashboard size={12} /> <span className="hidden xl:inline">Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      <div className={`relative z-10 w-full max-w-[2560px] mx-auto ${gutter} py-4 sm:py-6 flex gap-6 2xl:gap-8`}>

        {/* Folder sidebar (wide screens) */}
        <aside className="hidden lg:block w-56 xl:w-64 shrink-0">
          <div className="sticky top-[76px] max-h-[calc(100vh-96px)] overflow-y-auto [scrollbar-width:thin] silver-edge rounded-2xl p-3 space-y-0.5">
            <div className="px-1 pb-2.5">
              <BrandTitle title="Folders" eyebrow={`${folders.length} folder${folders.length === 1 ? "" : "s"}`} logo={22} size="sm" />
            </div>
            {/* Search every folder in the tree */}
            {folders.length > 0 && (
              <div className="relative pb-1.5">
                <Search size={12} className="absolute left-2.5 top-[13px] text-slate-500" />
                <input value={treeQuery} onChange={e => setTreeQuery(e.target.value)} placeholder="Search folders…"
                  className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[12px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
                {treeQuery && <button onClick={() => setTreeQuery("")} className="absolute right-2 top-[11px] text-slate-500 hover:text-white"><X size={12} /></button>}
              </div>
            )}
            {treeQuery.trim() ? (() => {
              const tq = treeQuery.trim().toLowerCase()
              const hits = folders.filter(f => f.name.toLowerCase().includes(tq))
                .sort((a, b) => (a.name.toLowerCase().startsWith(tq) ? 0 : 1) - (b.name.toLowerCase().startsWith(tq) ? 0 : 1) || a.name.localeCompare(b.name))
              return hits.length === 0
                ? <p className="px-2 py-3 text-[11px] text-slate-600">No folders match</p>
                : hits.slice(0, 80).map(f => {
                  const trail = pathTo(f.id)
                  const active = view === "generations" && f.id === currentFolderId
                  return (
                    <button key={f.id} onClick={() => { openFolder(trail); setTreeQuery("") }}
                      className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${active ? "bg-white/[0.10] border-white/20 text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}>
                      <Folder size={13} className="mt-0.5 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{f.name}</span>
                        {trail.length > 1 && <span className="block truncate text-[10px] text-slate-600">{trail.slice(0, -1).map(x => x.name).join(" › ")}</span>}
                      </span>
                    </button>
                  )
                })
            })() : (
              <>
                <button
                  onClick={() => openFolder([])}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] text-left transition-colors ${view === "generations" && currentFolderId === null ? "bg-white/[0.10] border-white/20 text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}
                >
                  <Images size={14} className="shrink-0" /> Unfiled
                </button>
                {renderTree(null, 0)}
              </>
            )}
            <div className="pt-2">{newFolderControl("w-full")}</div>
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <button
                onClick={() => setView("assets")}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] text-left transition-colors ${view === "assets" ? "bg-white/[0.10] border-white/20 text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}
              >
                <Boxes size={14} className="shrink-0" /> Assets
                <span className="ml-auto text-[10px] font-mono text-slate-500">{assetsApi.assets?.length ?? ""}</span>
              </button>
              {/* The reference library: what's been uploaded to Refs */}
              <button
                onClick={() => setView("library")}
                className={`mt-0.5 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] text-left transition-colors ${view === "library" ? "bg-white/[0.10] border-white/20 text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"}`}
              >
                <ImageIcon size={14} className="shrink-0" /> Library
                <span className="ml-auto text-[10px] font-mono text-slate-500">{refCount ?? ""}</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {view === "assets" ? (
            <AssetsGrid assets={assetsApi.assets} onOpen={a => setOpenAssetId(a.id)} onNew={() => setNewAssetOpen(true)} />
          ) : view === "library" ? (
            <RefLibraryGrid signedIn={signedIn} onCount={setRefCount} />
          ) : (
            <>
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

              {/* Viewing hidden: say so, and the way back */}
              {feedShowHidden && !isSelectMode && (
                <div className="mb-4 flex flex-wrap items-center gap-2 px-3.5 py-2.5 rounded-xl silver-edge">
                  <EyeOff size={13} className="text-slate-300" />
                  <span className="text-[12px] text-slate-300">Showing your <span className="text-white font-semibold">hidden</span> generations - Select them to unhide.</span>
                  <button onClick={() => setFeedShowHidden(false)} className="ml-auto text-[11.5px] font-semibold text-slate-400 hover:text-white">Back to all</button>
                </div>
              )}

              {/* Select-mode action bar - at the top of the feed, and pinned just
                  under the toolbar (its measured height) as you scroll, so its
                  buttons stay in reach down a long page. */}
              {isSelectMode && (
                <div style={{ top: headerH + 8 }} className="sticky z-20 mb-4 rounded-2xl silver-edge bg-[#070b14]/95 backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
                  {pickingFor && (
                    <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-[12px] text-slate-300">
                      <ImagePlus size={13} className="text-slate-200" />
                      Pick pictures for <span className="font-bold text-white">{pickingFor.name}</span>
                      <span className="text-slate-500">- any folder; videos are skipped</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap p-2.5">
                    <span className="px-2.5 py-1 rounded-full bg-white/[0.10] border border-white/15 text-[11.5px] font-mono text-white">{selectedIds.size} selected</span>
                    <button onClick={selectPage} disabled={pageIds.length === 0} className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold text-slate-400 hover:text-white disabled:opacity-30">
                      {allPageSelected ? <Square size={12} /> : <CheckSquare size={12} />} {allPageSelected ? "Unselect page" : "Select page"}
                    </button>
                    {selectedIds.size > 0 && (
                      <button onClick={() => setSelectedIds(new Set())} className="px-2 py-1 text-[11.5px] font-semibold text-slate-500 hover:text-white">Clear</button>
                    )}
                    <div className="flex-1" />
                    {pickingFor ? (
                      <>
                        <button onClick={exitSelectMode} className="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-slate-400 hover:text-white">Cancel</button>
                        <BrandButton onClick={finishPicking} busy={isAdding} disabled={selectedIds.size === 0} primary size="md">
                          Add {selectedIds.size || ""} to {pickingFor.name}
                        </BrandButton>
                      </>
                    ) : (
                      <>
                        <BrandButton onClick={() => setAddToAssetOpen(true)} disabled={selectedIds.size === 0 || feedShowHidden} primary size="sm" icon={<Boxes size={13} />}>
                          Add to asset
                        </BrandButton>
                        <button
                          onClick={() => setPicker("add")}
                          disabled={selectedIds.size === 0}
                          title="Show them in more folders - they stay where they are too"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/10 hover:border-white/30 text-slate-100 text-xs font-semibold transition-all disabled:opacity-30"
                        >
                          <FolderAdd size={12} /> Add to folder
                        </button>
                        <button
                          onClick={() => setPicker("move")}
                          disabled={selectedIds.size === 0}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/10 hover:border-white/30 text-slate-100 text-xs font-semibold transition-all disabled:opacity-30"
                        >
                          <FolderInput size={12} /> Move
                        </button>
                        {currentFolderId !== null && (
                          <button
                            onClick={removeSelectedFromFolder}
                            disabled={selectedIds.size === 0 || isRemoving}
                            title={`Take them out of ${folderName(currentFolderId)}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/10 hover:border-white/30 text-slate-100 text-xs font-semibold transition-all disabled:opacity-30"
                          >
                            {isRemoving ? <Loader2 size={12} className="animate-spin" /> : <FolderMinus size={12} />} Remove from folder
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedHidden(!feedShowHidden)}
                          disabled={selectedIds.size === 0 || isHiding}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/10 hover:border-white/30 text-slate-100 text-xs font-semibold transition-all disabled:opacity-30"
                        >
                          {isHiding ? <Loader2 size={12} className="animate-spin" /> : feedShowHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                          {feedShowHidden ? "Unhide" : "Hide"}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={selectedIds.size === 0}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-all disabled:opacity-30"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* New folder (narrower screens; wide ones have it in the sidebar) - the
                  folders themselves are cards at the start of the feed */}
              <div className="lg:hidden flex items-center flex-wrap gap-2 mb-4">
                {newFolderControl("w-44")}
              </div>
            </>
          )}

          {/* Feed - starts loading at once, alongside the session check. Kept
              mounted (just hidden) on the Assets view, so going back is instant. */}
          <div className={view !== "generations" ? "hidden" : ""}>
            <MyGenFeed
              signedIn={signedIn && feedReady}
              cols={feed.cols}
              fullSize={feed.fullSize}
              fullSizeLayout={feed.fullSizeLayout}
              masonryMode={feed.masonryMode}
              tileRes={feed.tileRes}
              showHidden={feedShowHidden}
              typeFilter={pickingFor ? "image" : typeFilter}
              folderId={currentFolderId}
              pageSize={feed.pageSize}
              selectMode={isSelectMode}
              selectedIds={selectedIds}
              onSelectToggle={toggleSelect}
              onImageClick={(img) => setSelectedImage(img as GeneratedImage)}
              onNavListChange={setNavList}
              onTotalChange={setTotal}
              refreshKey={refreshKey}
              leadingTiles={folderTiles}
            />
          </div>
        </main>
      </div>

      {/* ── Assets: new / edit / add-to ───────────────────────────────────── */}
      {newAssetOpen && <NewAssetModal onCreate={createAsset} onClose={() => setNewAssetOpen(false)} />}
      {openAsset && (
        <AssetEditor
          asset={openAsset}
          onClose={() => setOpenAssetId(null)}
          onUpdate={async o => { await assetsApi.update({ id: openAsset.id, ...o }) }}
          onDelete={async () => { await assetsApi.remove(openAsset.id); setOpenAssetId(null); flash(`Deleted ${openAsset.name}`) }}
          onAddPictures={() => startPickingFor(openAsset)}
        />
      )}
      {addToAssetOpen && (
        <AddToAssetModal
          count={selectedIds.size}
          assets={assetsApi.assets}
          onAdd={async a => { await addIdsToAsset(a, Array.from(selectedIds)); setAddToAssetOpen(false); exitSelectMode() }}
          onCreate={async (kind, name) => {
            const a = await assetsApi.create({ kind, name, imageIds: Array.from(selectedIds) })
            setAddToAssetOpen(false)
            exitSelectMode()
            flash(`Made ${a.name} with ${a.refs.length} picture${a.refs.length === 1 ? "" : "s"}`)
          }}
          onClose={() => setAddToAssetOpen(false)}
        />
      )}

      {/* ── Folder picker: Move / Add to folder ───────────────────────────── */}
      {picker && (
        <FolderPicker
          mode={picker}
          count={selectedIds.size}
          folders={folders}
          onCreateFolder={createFolderIn}
          onMove={moveSelectedTo}
          onAdd={addSelectedTo}
          onClose={() => setPicker(null)}
        />
      )}

      {/* ── Preview Modal ────────────────────────────────────────────────────── */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={() => setSelectedImage(null)}>
          <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedImage(null) }}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-black/60 backdrop-blur-sm text-slate-200 hover:text-white text-xs font-medium transition-all"
            >
              <X size={13} /> Close
            </button>
            {navIndex >= 0 && navList.length > 1 && (
              <span className="px-2.5 py-1 rounded-md bg-black/60 border border-white/10 text-[11px] font-mono text-slate-300">{navIndex + 1} / {navList.length}</span>
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
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {navIndex >= 0 && navIndex < navList.length - 1 && (
              <button
                onClick={() => stepPreview(1)}
                aria-label="Next"
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          <div className="border-t border-white/[0.08] bg-[#05080f]/90 backdrop-blur-md px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4" onClick={(e) => e.stopPropagation()}>
            <div className="max-w-4xl mx-auto">
              <div className="flex items-start gap-2.5 mb-3">
                <SiteLogoBox size={20} rounded={5} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs sm:text-sm line-clamp-2">{selectedImage.prompt}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/15 text-slate-200 text-[10px] font-mono">
                      {getModelDisplayName(selectedImage.model)}
                    </span>
                    <span className="text-[10px] text-slate-500">{formatDate(selectedImage.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <BrandButton onClick={() => downloadImage(selectedImage)} primary size="md" icon={<Download size={13} />}>Download</BrandButton>
                <BrandButton onClick={() => copyPrompt(selectedImage.prompt)} size="md" icon={<Copy size={13} />}>Copy Prompt</BrandButton>
                <BrandButton
                  onClick={() => {
                    localStorage.setItem("rescan_prompt", selectedImage.prompt)
                    if (selectedImage.referenceImageUrls && selectedImage.referenceImageUrls.length > 0) {
                      localStorage.setItem("rescan_reference_images", JSON.stringify(selectedImage.referenceImageUrls))
                    } else {
                      localStorage.removeItem("rescan_reference_images")
                    }
                    router.push("/")
                  }}
                  size="md"
                  icon={<Sparkles size={13} />}
                >
                  Rescan
                </BrandButton>
                {!selectedImage.videoMetadata?.isVideo && (
                  <BrandButton
                    onClick={() => { setSelectedIds(new Set([selectedImage.id])); setSelectedImage(null); setAddToAssetOpen(true) }}
                    size="md"
                    icon={<Boxes size={13} />}
                  >
                    Add to asset
                  </BrandButton>
                )}
                <a
                  href={selectedImage.videoMetadata?.isVideo ? selectedImage.imageUrl : `/api/images/${selectedImage.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.05] border border-white/15 text-slate-100 text-[11.5px] font-bold hover:bg-white/10 hover:border-white/30 transition-all"
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
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 font-semibold text-xs transition-all disabled:opacity-50"
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

      {/* ── Delete folder (in-page, not window.confirm) ──────────────────────── */}
      {folderToDelete && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => setFolderToDelete(null)}>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <BrandTitle title={`Delete "${folderToDelete.name}"?`} eyebrow="Nothing inside is lost" logo={26} />
            <p className="text-slate-400 text-sm my-4 leading-relaxed">Its pictures and any subfolders move up to the folder above it.</p>
            <div className="flex gap-2">
              <button onClick={() => setFolderToDelete(null)} className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 font-semibold text-xs transition-all">Keep</button>
              <button onClick={() => deleteFolder(folderToDelete.id)} className="flex-1 py-2.5 rounded-xl bg-red-600/80 hover:bg-red-600 border border-red-500/30 text-white font-bold text-xs transition-all">Delete folder</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 rounded-xl silver-edge bg-[#0b111d]/95 backdrop-blur-md text-[12px] text-slate-100 shadow-2xl max-w-[calc(100vw-32px)]`}>
          {toast}
        </div>
      )}
    </div>
  )
}
