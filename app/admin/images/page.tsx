"use client"

import { useState, useEffect, useRef } from "react"
import {
  ChevronLeft, ChevronRight, Download, Copy, Sparkles, X,
  Image as ImageIcon, RefreshCw, ArrowLeft, User, Users, Search, ChevronDown, Check
} from "lucide-react"
import { useRouter } from "next/navigation"

interface GeneratedImage {
  id: number
  prompt: string
  imageUrl: string
  model: string
  quality: string | null
  aspectRatio: string | null
  ticketCost: number
  referenceImageUrls: string[]
  createdAt: string
  videoMetadata?: {
    isVideo?: boolean
    thumbnailUrl?: string
    duration?: string
    resolution?: string
    aspectRatio?: string
    audioEnabled?: boolean
    startFrameUrl?: string
    endFrameUrl?: string
    motionVideoUrl?: string
    characterOrientation?: string
  } | null
  user: {
    id: number
    email: string
    name: string | null
  }
  imageRating?: {
    score: number
    feedbackText: string | null
  } | null
}

interface UserOption {
  id: number
  email: string
  name: string | null
  generationCount: number
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

const MODEL_NAMES: Record<string, string> = {
  'nano-banana':      'NanaBanana',
  'nano-banana-pro':  'NanaBanana Pro',
  'nano-banana-2':    'NanaBanana 2',
  'seedream-4.5':     'SeeDream 4.5',
  'wan-2.5':          'WAN 2.5',
  'wan-2.7-pro':      'WAN 2.7 Pro',
  'kling-v3':         'Kling 3.0',
  'kling-o3':         'Kling O3',
  'kling-v3-image':   'Kling V3 Image',
  'seedance-1.5':     'SeeDance 1.5',
}

function getModelName(model: string) {
  if (MODEL_NAMES[model]) return MODEL_NAMES[model]
  if (model.includes('gemini') && model.includes('pro'))   return 'Gemini Pro'
  if (model.includes('gemini') && model.includes('flash')) return 'Gemini Flash'
  return model
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

// For models whose ticketCost was historically saved as 0, derive it from model + quality
function getDisplayTicketCost(img: GeneratedImage): number {
  if (img.ticketCost > 0) return img.ticketCost
  const q = img.quality
  switch (img.model) {
    case 'nano-banana-pro-2':  return q === '4k' ? 12 : 7
    case 'nano-banana-pro':    return q === '4k' ? 14 : 7
    case 'pro-scanner-v3':     return q === '4k' ? 15 : 7
    case 'seedream-4.5':       return q === '4k' ? 4 : 2
    case 'seedream-5-lite':    return q === '4k' ? 4 : 2
    case 'kling-v3-image':     return 2
    case 'kling-o3-image':     return q === '4k' ? 4 : 2
    case 'wan-2.7-pro':        return 4
    case 'flash-scanner-v2.5': return 1
    default:                   return 0
  }
}

export default function AdminImagesPage() {
  const router = useRouter()

  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")

  // Data
  const [isLoading, setIsLoading]   = useState(true)
  const [images, setImages]         = useState<GeneratedImage[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 24, total: 0, totalPages: 0 })

  // Filters
  const [typeFilter, setTypeFilter]           = useState<'all' | 'image' | 'video'>('all')
  const [ratedOnly, setRatedOnly]             = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())

  // User picker
  const [allUsers, setAllUsers]         = useState<UserOption[]>([])
  const [userSearch, setUserSearch]     = useState('')
  const [userPickerOpen, setUserPickerOpen] = useState(false)
  const [userSort, setUserSort]         = useState<'gens-desc' | 'gens-asc' | 'az' | 'za'>('gens-desc')
  const pickerRef = useRef<HTMLDivElement>(null)

  // Detail modal
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
  const [viewingRef, setViewingRef]       = useState<string | null>(null)

  // Jump-to-page
  const [goToPageTop, setGoToPageTop]       = useState('')
  const [goToPageBottom, setGoToPageBottom] = useState('')

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const ok  = localStorage.getItem("multiverse-admin-auth")
    const pwd = sessionStorage.getItem("admin-password")
    if (ok === "true" && pwd) {
      setIsAuthenticated(true)
      fetchImages(1, 'all', new Set())
      fetchUsers()
    } else {
      setIsLoading(false)
    }
  }, [])

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setUserPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        sessionStorage.setItem("admin-password", password)
        localStorage.setItem("multiverse-admin-auth", "true")
        setIsAuthenticated(true)
        fetchImages(1, 'all', new Set())
        fetchUsers()
      } else {
        alert("Invalid password")
      }
    } catch {
      alert("Authentication failed")
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users')
      if (res.ok) {
        const data = await res.json()
        const users: UserOption[] = (Array.isArray(data) ? data : data.users ?? [])
          .map((u: any) => ({ id: u.id, email: u.email, name: u.name ?? null, generationCount: u.generationCount ?? 0 }))
        setAllUsers(users)
      }
    } catch {}
  }

  const fetchImages = async (
    page: number,
    type: 'all' | 'image' | 'video' = typeFilter,
    userIds: Set<number> = selectedUserIds,
    rated: boolean = ratedOnly,
  ) => {
    setIsLoading(true)
    try {
      const typeParam  = type !== 'all' ? `&type=${type}` : ''
      const userParam  = userIds.size > 0 ? `&userIds=${Array.from(userIds).join(',')}` : ''
      const ratedParam = rated ? `&rated=true` : ''
      const res = await fetch(`/api/admin/images?page=${page}&limit=24${typeParam}${userParam}${ratedParam}`, {
        headers: { 'x-admin-password': sessionStorage.getItem('admin-password') || '' },
      })
      if (res.ok) {
        const data = await res.json()
        setImages(data.images)
        setPagination(data.pagination)
      }
    } catch {}
    finally { setIsLoading(false) }
  }

  // Re-fetch when filters change
  useEffect(() => {
    if (isAuthenticated) fetchImages(1, typeFilter, selectedUserIds, ratedOnly)
  }, [typeFilter, selectedUserIds, ratedOnly])

  const handlePageChange = (newPage: number) => {
    fetchImages(newPage, typeFilter, selectedUserIds, ratedOnly)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── User picker helpers ───────────────────────────────────────────────────

  const toggleUser = (id: number) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const removeUser = (id: number) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const filteredUsers = allUsers
    .filter(u =>
      !userSearch || u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(userSearch.toLowerCase()))
    )
    .sort((a, b) => {
      if (userSort === 'gens-desc') return b.generationCount - a.generationCount || a.email.localeCompare(b.email)
      if (userSort === 'gens-asc')  return a.generationCount - b.generationCount || a.email.localeCompare(b.email)
      if (userSort === 'az')        return a.email.localeCompare(b.email)
      if (userSort === 'za')        return b.email.localeCompare(a.email)
      return 0
    })

  // ── Helpers ───────────────────────────────────────────────────────────────

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = prompt
        ta.style.cssText = 'position:fixed;left:-999999px'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {}
    }
  }

  const isVideo = (img: GeneratedImage) => !!img.videoMetadata?.isVideo

  // ── Login screen ──────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center p-6">
        <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="relative w-full max-w-sm">
          <p className="text-[11px] font-mono text-slate-600 uppercase tracking-widest text-center mb-6">Admin · Image Gallery</p>
          <form onSubmit={handleLogin} className="p-6 rounded-2xl border border-white/6 bg-white/2 backdrop-blur-sm space-y-3">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/8 text-white text-sm placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-cyan-600 hover:from-fuchsia-500 hover:to-cyan-500 text-white font-bold text-sm transition-all"
            >
              Access Gallery
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Main page ─────────────────────────────────────────────────────────────

  const selectedUserList = allUsers.filter(u => selectedUserIds.has(u.id))

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      {/* Background */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-0 left-1/4 w-[500px] h-[300px] bg-fuchsia-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-6 sm:py-10">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <div>
            <p className="text-[11px] font-mono text-slate-600 uppercase tracking-widest mb-1">Admin · All Users</p>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">IMAGE GALLERY</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {pagination.total > 0 ? `${pagination.total.toLocaleString()} total generations` : 'All user generations'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Type filter */}
            <div className="flex items-center gap-0.5 p-1 rounded-lg border border-white/6 bg-black/30">
              {(['all', 'image', 'video'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    typeFilter === t ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Videos'}
                </button>
              ))}
            </div>

            {/* Rated filter — independent toggle, ANDs with type filter */}
            <button
              onClick={() => setRatedOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                ratedOnly
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-white/6 bg-black/30 text-slate-500 hover:text-slate-300 hover:border-white/15'
              }`}
            >
              <svg className={`w-3 h-3 ${ratedOnly ? 'text-amber-400' : 'text-slate-600'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Rated only
            </button>

            {/* Refresh */}
            <button
              onClick={() => fetchImages(pagination.page, typeFilter, selectedUserIds, ratedOnly)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs transition-all disabled:opacity-40"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>

            {/* Back */}
            <button
              onClick={() => router.push('/admin')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/15 hover:bg-white/5 text-slate-400 hover:text-white text-xs transition-all"
            >
              <ArrowLeft size={12} />
              Admin
            </button>
          </div>
        </div>

        {/* ── User filter row ─────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            {/* User picker dropdown */}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setUserPickerOpen(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  selectedUserIds.size > 0
                    ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/15'
                    : 'border-white/6 bg-white/2 text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Users size={13} />
                {selectedUserIds.size === 0
                  ? 'Filter by user'
                  : `${selectedUserIds.size} user${selectedUserIds.size > 1 ? 's' : ''} selected`}
                <ChevronDown size={12} className={`transition-transform ${userPickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {userPickerOpen && (
                <div className="absolute top-full mt-2 left-0 z-30 w-72 rounded-2xl border border-white/8 bg-[#0c1120] shadow-2xl overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-white/6">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                      <input
                        type="text"
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        placeholder="Search users..."
                        className="w-full pl-7 pr-3 py-2 rounded-lg bg-white/5 border border-white/6 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-white/15"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Sort row */}
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/4">
                    {([
                      { value: 'gens-desc', label: 'Most' },
                      { value: 'gens-asc',  label: 'Least' },
                      { value: 'az',        label: 'A→Z' },
                      { value: 'za',        label: 'Z→A' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setUserSort(opt.value)}
                        className={`flex-1 py-1 rounded-md text-[10px] font-semibold transition-all ${
                          userSort === opt.value
                            ? 'bg-white/10 text-white'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/4">
                    <span className="text-[10px] text-slate-600">{filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}</span>
                    {selectedUserIds.size > 0 && (
                      <button
                        onClick={() => setSelectedUserIds(new Set())}
                        className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* User list */}
                  <div className="max-h-64 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-600">No users found</div>
                    ) : (
                      filteredUsers.map(user => {
                        const selected = selectedUserIds.has(user.id)
                        return (
                          <button
                            key={user.id}
                            onClick={() => toggleUser(user.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                              selected ? 'bg-fuchsia-500/10 hover:bg-fuchsia-500/15' : 'hover:bg-white/4'
                            }`}
                          >
                            {/* Checkbox */}
                            <div className={`w-4 h-4 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                              selected ? 'bg-fuchsia-500 border-fuchsia-400' : 'border-white/20 bg-transparent'
                            }`}>
                              {selected && <Check size={10} className="text-white" />}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white truncate">{user.email}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {user.name && <p className="text-[10px] text-slate-500 truncate">{user.name}</p>}
                                {user.name && <span className="text-[10px] text-slate-700">·</span>}
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {user.generationCount.toLocaleString()} gen{user.generationCount !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Selected user chips */}
            {selectedUserList.map(u => (
              <div
                key={u.id}
                className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 text-xs"
              >
                <User size={10} />
                <span className="max-w-[160px] truncate">{u.email}</span>
                <button
                  onClick={() => removeUser(u.id)}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-fuchsia-500/20 transition-colors"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pagination (top) ────────────────────────────────────────────────── */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mb-5">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || isLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={13} />
              Prev
            </button>

            <div className="flex items-center gap-1">
              {pagination.page > 2 && (
                <>
                  <button onClick={() => handlePageChange(1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">1</button>
                  {pagination.page > 3 && <span className="text-slate-600 text-xs px-1">…</span>}
                </>
              )}
              {pagination.page > 1 && (
                <button onClick={() => handlePageChange(pagination.page - 1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.page - 1}</button>
              )}
              <button className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 font-bold text-xs">{pagination.page}</button>
              {pagination.page < pagination.totalPages && (
                <button onClick={() => handlePageChange(pagination.page + 1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.page + 1}</button>
              )}
              {pagination.page < pagination.totalPages - 1 && (
                <>
                  {pagination.page < pagination.totalPages - 2 && <span className="text-slate-600 text-xs px-1">…</span>}
                  <button onClick={() => handlePageChange(pagination.totalPages)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.totalPages}</button>
                </>
              )}
            </div>

            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || isLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next
              <ChevronRight size={13} />
            </button>

            <span className="hidden sm:inline text-[10px] text-slate-600 font-mono ml-2">{pagination.total.toLocaleString()} total</span>

            <form
              onSubmit={e => {
                e.preventDefault()
                const n = parseInt(goToPageTop)
                if (!isNaN(n) && n >= 1 && n <= pagination.totalPages) {
                  handlePageChange(n)
                  setGoToPageTop('')
                }
              }}
              className="flex items-center gap-1.5 ml-2"
            >
              <span className="text-[10px] text-slate-600 hidden sm:inline">Go to</span>
              <input
                type="number"
                min={1}
                max={pagination.totalPages}
                value={goToPageTop}
                onChange={e => setGoToPageTop(e.target.value)}
                placeholder={String(pagination.page)}
                className="w-16 px-2 py-1.5 rounded-lg border border-white/8 bg-white/4 text-white text-xs text-center placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="submit"
                disabled={!goToPageTop || isLoading}
                className="px-2.5 py-1.5 rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 text-slate-300 text-xs disabled:opacity-30 transition-all"
              >
                Go
              </button>
            </form>
          </div>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/4 bg-white/2 overflow-hidden animate-pulse">
                <div className="aspect-square bg-white/5" />
                <div className="p-3 space-y-2">
                  <div className="h-2 bg-white/5 rounded w-3/4" />
                  <div className="h-2 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl border border-white/6 bg-white/2 flex items-center justify-center">
              <ImageIcon size={28} className="text-slate-600" />
            </div>
            <p className="text-slate-500 text-sm">No generations found</p>
            {selectedUserIds.size > 0 && (
              <button
                onClick={() => setSelectedUserIds(new Set())}
                className="text-xs text-fuchsia-400 hover:text-fuchsia-300 transition-colors"
              >
                Clear user filter
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {images.map((image) => (
                <div
                  key={image.id}
                  onClick={() => setSelectedImage(image)}
                  className="group cursor-pointer rounded-2xl border border-white/6 bg-white/2 overflow-hidden hover:border-fuchsia-500/30 hover:shadow-lg hover:shadow-fuchsia-500/5 transition-all duration-200"
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-black/40 relative overflow-hidden">
                    {isVideo(image) ? (
                      <>
                        {(() => {
                          const thumb = image.videoMetadata?.thumbnailUrl
                          const needsVideoThumb = !thumb || thumb === image.imageUrl || /\.(mp4|webm|mov)(\?|$)/i.test(thumb)
                          return needsVideoThumb ? (
                            <video
                              src={image.imageUrl}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              muted playsInline preload="metadata"
                            />
                          ) : (
                            <img src={thumb} alt={image.prompt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          )
                        })()}
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5">
                          <svg className="w-2.5 h-2.5 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                          <span className="text-orange-400 text-[9px] font-mono font-bold">VIDEO</span>
                        </div>
                      </>
                    ) : (
                      <img
                        src={`/api/admin/images/thumb?id=${image.id}`}
                        alt={image.prompt}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}

                    {/* Model badge */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="px-1.5 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[9px] text-cyan-400 font-mono">
                        {getModelName(image.model)}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-2.5">
                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed mb-1">{image.prompt}</p>
                    <div className="flex items-center gap-1 text-[9px] text-slate-600">
                      <User size={8} />
                      <span className="truncate">{image.user.email}</span>
                    </div>
                    <p className="text-[9px] text-slate-700 font-mono mt-0.5">{formatDateTime(image.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1 || isLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={13} />
                  Prev
                </button>

                <div className="flex items-center gap-1">
                  {pagination.page > 2 && (
                    <>
                      <button onClick={() => handlePageChange(1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">1</button>
                      {pagination.page > 3 && <span className="text-slate-600 text-xs px-1">…</span>}
                    </>
                  )}
                  {pagination.page > 1 && (
                    <button onClick={() => handlePageChange(pagination.page - 1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.page - 1}</button>
                  )}
                  <button className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 font-bold text-xs">{pagination.page}</button>
                  {pagination.page < pagination.totalPages && (
                    <button onClick={() => handlePageChange(pagination.page + 1)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.page + 1}</button>
                  )}
                  {pagination.page < pagination.totalPages - 1 && (
                    <>
                      {pagination.page < pagination.totalPages - 2 && <span className="text-slate-600 text-xs px-1">…</span>}
                      <button onClick={() => handlePageChange(pagination.totalPages)} className="w-8 h-8 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 text-xs transition-all">{pagination.totalPages}</button>
                    </>
                  )}
                </div>

                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 text-slate-400 hover:text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Next
                  <ChevronRight size={13} />
                </button>

                <span className="hidden sm:inline text-[10px] text-slate-600 font-mono ml-2">{pagination.total.toLocaleString()} total</span>

                {/* Jump to page */}
                <form
                  onSubmit={e => {
                    e.preventDefault()
                    const n = parseInt(goToPageBottom)
                    if (!isNaN(n) && n >= 1 && n <= pagination.totalPages) {
                      handlePageChange(n)
                      setGoToPageBottom('')
                    }
                  }}
                  className="flex items-center gap-1.5 ml-2"
                >
                  <span className="text-[10px] text-slate-600 hidden sm:inline">Go to</span>
                  <input
                    type="number"
                    min={1}
                    max={pagination.totalPages}
                    value={goToPageBottom}
                    onChange={e => setGoToPageBottom(e.target.value)}
                    placeholder={String(pagination.page)}
                    className="w-16 px-2 py-1.5 rounded-lg border border-white/8 bg-white/4 text-white text-xs text-center placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="submit"
                    disabled={!goToPageBottom || isLoading}
                    className="px-2.5 py-1.5 rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 text-slate-300 text-xs disabled:opacity-30 transition-all"
                  >
                    Go
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Detail Modal ──────────────────────────────────────────────────────── */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={() => setSelectedImage(null)}>
          <button
            onClick={e => { e.stopPropagation(); setSelectedImage(null) }}
            className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-black/60 backdrop-blur-sm text-slate-300 hover:text-white text-xs font-medium transition-all"
          >
            <X size={13} /> Close
          </button>

          <div className="flex-1 flex items-center justify-center p-4 pt-14 min-h-0" onClick={e => e.stopPropagation()}>
            {isVideo(selectedImage) ? (
              <video src={selectedImage.imageUrl} controls autoPlay loop className="max-w-full max-h-full object-contain rounded-xl" />
            ) : (
              <img src={selectedImage.imageUrl} alt={selectedImage.prompt} className="max-w-full max-h-full object-contain rounded-xl" />
            )}
          </div>

          <div className="border-t border-white/6 bg-black/80 backdrop-blur-sm px-3 py-3 sm:p-4" onClick={e => e.stopPropagation()}>
            <div className="max-w-4xl mx-auto">
              {/* Prompt */}
              <div className="flex items-start gap-2 mb-3">
                <Sparkles className="text-cyan-400 flex-shrink-0 mt-0.5" size={13} />
                <p className="text-white text-xs sm:text-sm line-clamp-3 flex-1 min-w-0">{selectedImage.prompt}</p>
              </div>

              {/* Config grid */}
              {(() => {
                const vm = selectedImage.videoMetadata
                const isVid = !!vm?.isVideo
                const cost = getDisplayTicketCost(selectedImage)
                const ar = vm?.aspectRatio || selectedImage.aspectRatio
                const res = vm?.resolution || selectedImage.quality
                const dur = vm?.duration
                const audio = vm?.audioEnabled
                const hasStartFrame = !!vm?.startFrameUrl
                const hasEndFrame = !!vm?.endFrameUrl
                const hasMotion = !!vm?.motionVideoUrl
                const orientation = vm?.characterOrientation

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {/* Model */}
                    <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Model</p>
                      <p className="text-[11px] text-cyan-400 font-mono font-semibold truncate">{getModelName(selectedImage.model)}</p>
                    </div>

                    {/* User */}
                    <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">User</p>
                      <p className="text-[11px] text-slate-300 truncate">{selectedImage.user.email}</p>
                    </div>

                    {/* Tickets */}
                    <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Tickets</p>
                      <p className="text-[11px] text-amber-400 font-mono font-semibold">{cost} ticket{cost !== 1 ? 's' : ''}</p>
                    </div>

                    {/* Date/Time */}
                    <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Created</p>
                      <p className="text-[11px] text-slate-300 font-mono">{formatDateTime(selectedImage.createdAt)}</p>
                    </div>

                    {/* Rating */}
                    <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Rating</p>
                      {selectedImage.imageRating ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-0.5">
                            {[1,2,3,4,5].map(s => (
                              <svg key={s} className={`w-2.5 h-2.5 ${s <= selectedImage.imageRating!.score ? 'text-amber-400' : 'text-slate-700'}`} fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                              </svg>
                            ))}
                            <span className="text-[10px] text-amber-400 font-mono ml-1">{selectedImage.imageRating.score}/5</span>
                          </div>
                          {selectedImage.imageRating.feedbackText && (
                            <p className="text-[9px] text-slate-500 line-clamp-1 italic">"{selectedImage.imageRating.feedbackText}"</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-600 italic">Unrated</p>
                      )}
                    </div>

                    {/* Aspect Ratio */}
                    {ar && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Aspect Ratio</p>
                        <p className="text-[11px] text-slate-300 font-mono">{ar}</p>
                      </div>
                    )}

                    {/* Resolution / Quality */}
                    {res && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">{isVid ? 'Resolution' : 'Quality'}</p>
                        <p className="text-[11px] text-slate-300 font-mono">{res}</p>
                      </div>
                    )}

                    {/* Duration (video only) */}
                    {isVid && dur && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Duration</p>
                        <p className="text-[11px] text-slate-300 font-mono">{dur}s</p>
                      </div>
                    )}

                    {/* Audio (video only) */}
                    {isVid && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Audio</p>
                        <p className={`text-[11px] font-mono font-semibold ${audio ? 'text-green-400' : 'text-slate-500'}`}>{audio ? 'Yes' : 'No'}</p>
                      </div>
                    )}

                    {/* Start frame (video only) */}
                    {isVid && hasStartFrame && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Start Frame</p>
                        <img src={vm!.startFrameUrl!} alt="start frame" onClick={() => setViewingRef(vm!.startFrameUrl!)}
                          className="h-8 w-8 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity mt-0.5" />
                      </div>
                    )}

                    {/* End frame (video only) */}
                    {isVid && hasEndFrame && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">End Frame</p>
                        <img src={vm!.endFrameUrl!} alt="end frame" onClick={() => setViewingRef(vm!.endFrameUrl!)}
                          className="h-8 w-8 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity mt-0.5" />
                      </div>
                    )}

                    {/* Motion Control (video only) */}
                    {isVid && hasMotion && (
                      <div className="rounded-lg bg-white/3 border border-white/6 px-2.5 py-2">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Motion Control</p>
                        <p className="text-[11px] text-orange-400 font-mono">Yes{orientation ? ` · ${orientation}` : ''}</p>
                      </div>
                    )}
                  </div>
                )
              })()}

              {selectedImage.referenceImageUrls?.length > 0 && (
                <div className="mb-3 p-3 rounded-xl bg-white/3 border border-white/6">
                  <p className="text-[10px] text-fuchsia-400 font-semibold mb-2">
                    {selectedImage.referenceImageUrls.length} Reference Image{selectedImage.referenceImageUrls.length > 1 ? 's' : ''}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {selectedImage.referenceImageUrls.map((url, i) => (
                      <img key={i} src={url} alt={`Ref ${i + 1}`} onClick={() => setViewingRef(url)}
                        className="h-14 w-14 object-cover rounded-lg border border-white/10 cursor-pointer hover:border-fuchsia-500/50 transition-colors" />
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <a href={selectedImage.imageUrl} download target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 transition-all">
                  <Download size={13} /> Download
                </a>
                <button onClick={() => copyPrompt(selectedImage.prompt)}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold hover:bg-purple-500/30 transition-all">
                  <Copy size={13} /> Copy Prompt
                </button>
                <button onClick={() => {
                    localStorage.setItem('admin_rescan_prompt', selectedImage.prompt)
                    if (selectedImage.referenceImageUrls?.length > 0) {
                      localStorage.setItem('admin_rescan_reference_images', JSON.stringify(selectedImage.referenceImageUrls))
                    } else {
                      localStorage.removeItem('admin_rescan_reference_images')
                    }
                    router.push('/admin/scanner')
                  }}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-500/30 transition-all">
                  <RefreshCw size={13} /> Rescan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reference full view ───────────────────────────────────────────────── */}
      {viewingRef && (
        <div className="fixed inset-0 bg-black/98 z-[60] flex flex-col" onClick={() => setViewingRef(null)}>
          <button onClick={e => { e.stopPropagation(); setViewingRef(null) }}
            className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-black/60 backdrop-blur-sm text-slate-300 hover:text-white text-xs transition-all">
            <X size={13} /> Back
          </button>
          <div className="flex-1 flex items-center justify-center p-4 pt-14 min-h-0" onClick={e => e.stopPropagation()}>
            <img src={viewingRef} alt="Reference" className="max-w-full max-h-full object-contain rounded-xl" />
          </div>
          <div className="border-t border-white/6 bg-black/80 p-4" onClick={e => e.stopPropagation()}>
            <div className="max-w-xs mx-auto">
              <a href={viewingRef} download="reference.png" target="_blank" rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 transition-all">
                <Download size={13} /> Download Reference
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
