"use client"

import { useState, useEffect } from "react"
import { Ticket, LogOut, CreditCard, Image as ImageIcon, Receipt, Settings, Terminal, Sparkles, ArrowRight, ShieldCheck, KeyRound, X, Eye, EyeOff, AlertTriangle } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import ChatWidget from "@/components/ChatWidget"

interface UserData {
  id: number
  email: string
  ticketBalance: number
}

interface GeneratedImage {
  id: number
  prompt: string
  imageUrl: string
  model: string
  createdAt: string
  expiresAt: string
  videoMetadata?: {
    isVideo?: boolean
    thumbnailUrl?: string
    duration?: string
    resolution?: string
  } | null
}

interface Purchase {
  id: number
  type: string
  description: string
  amount: number
  date: string
  status: string
  paypalOrderId: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [totalImageCount, setTotalImageCount] = useState(0)
  const [hasPromptStudioDev, setHasPromptStudioDev] = useState(false)
  const [isGrandfathered, setIsGrandfathered] = useState(false)
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false)
  const [isGenerationMaintenance, setIsGenerationMaintenance] = useState(false)

  // Echo Chamber state
  const [echoMessage, setEchoMessage] = useState("")
  const [isTransmitting, setIsTransmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Change password state
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pwCurrent, setPwCurrent] = useState("")
  const [pwCurrentConfirm, setPwCurrentConfirm] = useState("")
  const [pwNew, setPwNew] = useState("")
  const [pwNewConfirm, setPwNewConfirm] = useState("")
  const [pwError, setPwError] = useState("")
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwSubmitting, setPwSubmitting] = useState(false)
  const [showPwCurrent, setShowPwCurrent] = useState(false)
  const [showPwCurrentConfirm, setShowPwCurrentConfirm] = useState(false)
  const [showPwNew, setShowPwNew] = useState(false)
  const [showPwNewConfirm, setShowPwNewConfirm] = useState(false)

  useEffect(() => {
    checkAuth()
    fetchMaintenanceStatus()
  }, [])

  // Refresh ticket balance when tab becomes visible
  useEffect(() => {
    if (!user?.id) return
    const refreshBalance = async () => {
      try {
        const res = await fetch(`/api/user/tickets?userId=${user.id}`)
        const data = await res.json()
        if (data.success) {
          setUser(prev => prev ? { ...prev, ticketBalance: data.balance } : prev)
        }
      } catch {}
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshBalance()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [user?.id])

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const data = await res.json()
      if (!data.authenticated) { router.push('/login'); return }
      setUser(data.user)
      const ticketRes = await fetch(`/api/user/tickets?userId=${data.user.id}`)
      const ticketData = await ticketRes.json()
      if (ticketData.success) {
        setUser(prev => prev ? { ...prev, ticketBalance: ticketData.balance } : prev)
      }
      fetchSubscriptionStatus()
      fetchGeneratedImages()
    } catch {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const fetchMaintenanceStatus = async () => {
    try {
      const res = await fetch('/api/admin/config')
      if (res.ok) {
        const data = await res.json()
        setIsMaintenanceMode(!!data.isMaintenanceMode)
        setIsGenerationMaintenance(!!data.aiGenerationMaintenance)
      }
    } catch {}
  }

  const fetchGeneratedImages = async () => {
    try {
      const res = await fetch('/api/my-images?page=1&limit=5')
      const data = await res.json()
      if (data.success) {
        setGeneratedImages(data.images)
        setTotalImageCount(data.pagination?.total || data.images.length)
      }
    } catch {}
  }

  const fetchSubscriptionStatus = async () => {
    try {
      const res = await fetch('/api/user/subscription')
      const data = await res.json()
      if (data.success) {
        setHasPromptStudioDev(data.hasPromptStudioDev)
        if (data.isGrandfathered) setIsGrandfathered(true)
      }
    } catch {}
  }

  const handleEchoSubmit = async () => {
    if (!echoMessage.trim()) return
    setIsTransmitting(true)
    setSubmitSuccess(false)
    try {
      const response = await fetch('/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: echoMessage })
      })
      if (!response.ok) throw new Error('Failed')
      setEchoMessage("")
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 2000)
    } catch {}
    finally { setIsTransmitting(false) }
  }

  const handleChangePassword = async () => {
    setPwError("")
    setPwSubmitting(true)
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwCurrent,
          currentPasswordConfirm: pwCurrentConfirm,
          newPassword: pwNew,
          newPasswordConfirm: pwNewConfirm,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPwError(data.error || 'Something went wrong')
      } else {
        setPwSuccess(true)
        setPwCurrent(""); setPwCurrentConfirm(""); setPwNew(""); setPwNewConfirm("")
        setTimeout(() => { setPwSuccess(false); setShowPasswordModal(false) }, 2000)
      }
    } catch {
      setPwError('Network error. Please try again.')
    } finally {
      setPwSubmitting(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  const ADMIN_EMAILS = ["dirtysecretai@gmail.com", "promptandprotocol@gmail.com"]
  const isAdmin = ADMIN_EMAILS.includes(user.email)


  return (
    <>
    <div className="min-h-screen bg-[#050810] text-white">
      {/* Subtle grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      {/* Ambient glows */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[300px] bg-fuchsia-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-10">

        {/* Generation maintenance banner — admin emails bypass this */}
        {isGenerationMaintenance && user !== null && !['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'].includes(user.email) && (
          <div className="mb-6 flex items-start gap-3 px-4 py-4 rounded-xl border border-red-500/40 bg-red-500/10">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-300">Generation Temporarily Unavailable</p>
              <p className="text-xs text-slate-400 mt-0.5">AI generation is currently disabled for maintenance. Your tickets are safe — please check back soon.</p>
            </div>
          </div>
        )}

        {/* Brand header */}
        <div className="mb-8">
          {/* Logo + wordmark */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/25 to-fuchsia-500/25 border border-cyan-500/20 flex items-center justify-center shadow-lg shadow-cyan-500/10">
                <Sparkles size={18} className="text-cyan-400" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 bg-clip-text text-transparent leading-none">
                  AI Design Studio
                </h1>
                <p className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mt-0.5">Prompt Protocol</p>
              </div>
            </div>
            {/* User actions */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/20 bg-black/40 font-mono text-xs">
                <Ticket size={11} className="text-cyan-500/70" />
                <span className="text-cyan-400 tabular-nums">{user.ticketBalance.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/8 bg-white/3">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-black text-black">
                  {user.email[0].toUpperCase()}
                </div>
                <span className="text-xs text-slate-400 max-w-[130px] truncate hidden sm:block">{user.email}</span>
                {hasPromptStudioDev && (
                  <span className="text-[9px] font-black bg-gradient-to-r from-purple-500 to-cyan-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                    DEV
                  </span>
                )}
              </div>
              {isAdmin && (
                <Link href="/admin">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:border-cyan-400/50 hover:bg-cyan-500/15 text-xs text-cyan-400 transition-all">
                    <ShieldCheck size={12} />
                    <span className="hidden sm:inline">Admin</span>
                  </button>
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/8 bg-white/3 hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400 text-xs text-slate-400 transition-all"
              >
                <LogOut size={12} />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>

          {/* Welcome bar */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/6 bg-white/2">
            <div>
              <p className="text-sm font-semibold text-white">Welcome back, <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">{user.email.split('@')[0]}</span></p>
              <p className="text-[11px] text-slate-600 mt-0.5">Your creative workspace is ready.</p>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-[10px] font-mono text-slate-600">All systems online</span>
            </div>
          </div>
        </div>

        {/* Recent Generations */}
        <div className="rounded-2xl border border-white/6 bg-white/2 backdrop-blur-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ImageIcon size={14} className="text-fuchsia-400" />
              <span className="text-sm font-semibold text-white">Recent Generations</span>
              {totalImageCount > 0 && (
                <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{totalImageCount.toLocaleString()} total</span>
              )}
            </div>
            <Link href="/my-images">
              <button className="flex items-center gap-1 text-xs text-fuchsia-400 hover:text-fuchsia-300 transition-colors">
                View All <ArrowRight size={11} />
              </button>
            </Link>
          </div>

          {generatedImages.length === 0 ? (
            <div className="flex items-center justify-center h-24 rounded-xl border border-dashed border-white/8 text-slate-600 text-sm">
              No generations yet
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {generatedImages.slice(0, 5).map((img, idx) => (
                <Link href="/my-images" key={img.id || idx}>
                  <div className="aspect-square rounded-lg overflow-hidden border border-white/6 hover:border-fuchsia-500/40 transition-all group relative">
                    {img.videoMetadata?.isVideo ? (() => {
                      const thumb = img.videoMetadata?.thumbnailUrl
                      const videoUrl = img.imageUrl
                      const needsVideoThumb = !thumb || thumb === videoUrl || /\.(mp4|webm|mov)(\?|$)/i.test(thumb)
                      return needsVideoThumb ? (
                        <video src={videoUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform" muted playsInline preload="metadata" />
                      ) : (
                        <img src={thumb} alt={`Generation ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      )
                    })() : (
                      <img src={`/api/images/${img.id}?thumb=1`} alt={`Generation ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    )}
                    {img.videoMetadata?.isVideo && (
                      <div className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-black/70 rounded px-1 py-0.5">
                        <svg className="w-2.5 h-2.5 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
              {generatedImages.length < 5 && [...Array(5 - generatedImages.length)].map((_, idx) => (
                <div key={`empty-${idx}`} className="aspect-square rounded-lg border border-white/4 bg-white/2 flex items-center justify-center">
                  <ImageIcon className="text-slate-700" size={14} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Design Studio */}
        <div className="mb-4">
          <Link href="/">
            <div className="group rounded-2xl border border-cyan-500/20 hover:border-cyan-400/50 bg-cyan-500/5 backdrop-blur-sm p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 transition-all duration-200 hover:shadow-xl cursor-pointer">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 flex items-center justify-center shrink-0">
                <Sparkles size={22} className="text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-black text-cyan-400 mb-1">AI Design Studio</p>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Your full creative workspace — generate images and videos with 20+ AI models, use reference images to guide your generations, and manage your entire session history in one place.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["20+ Models", "Image Generation", "Video Generation", "Reference Images", "Session History", "Multi-Queue"].map(tag => (
                    <span key={tag} className="text-[9px] font-mono text-cyan-400/70 bg-cyan-500/10 border border-cyan-500/15 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all">
                Open Studio <ArrowRight size={11} />
              </button>
            </div>
          </Link>
        </div>

        {/* Bottom row: Account + Shop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

          {/* Account */}
          <div className="rounded-2xl border border-white/6 bg-white/2 backdrop-blur-sm p-5">
            <p className="text-[11px] font-mono text-slate-600 uppercase tracking-widest mb-3">Account</p>
            <div className="space-y-2">
              <Link href="/subscriptions">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:border-purple-500/30 hover:bg-purple-500/5 text-xs text-slate-400 hover:text-purple-400 transition-all">
                  <Settings size={12} />
                  Manage Subscriptions
                </button>
              </Link>
              <Link href="/purchase-history">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-xs text-slate-400 hover:text-cyan-400 transition-all">
                  <Receipt size={12} />
                  Purchase History
                </button>
              </Link>
              <Link href="/requests-feedback">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:border-fuchsia-500/30 hover:bg-fuchsia-500/5 text-xs text-slate-400 hover:text-fuchsia-400 transition-all">
                  <Terminal size={12} />
                  Feedback
                </button>
              </Link>
              <button
                onClick={() => { setShowPasswordModal(true); setPwError(""); setPwSuccess(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2 hover:border-amber-500/30 hover:bg-amber-500/5 text-xs text-slate-400 hover:text-amber-400 transition-all"
              >
                <KeyRound size={12} />
                Change Password
              </button>
            </div>
          </div>

          {/* Shop */}
          <div className="rounded-2xl border border-white/6 bg-white/2 backdrop-blur-sm p-5">
            <p className="text-[11px] font-mono text-slate-600 uppercase tracking-widest mb-3">Shop</p>
            <div className="space-y-2">
              <Link href="/buy-tickets">
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 hover:border-cyan-400/40 hover:bg-cyan-500/10 transition-all cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <Ticket size={13} className="text-cyan-400" />
                    <div>
                      <p className="text-xs font-semibold text-cyan-400">Buy Tickets</p>
                      <p className="text-[10px] text-slate-600">
                        {hasPromptStudioDev ? `Dev tier — ${isGrandfathered ? '30%' : '20%'} off` : 'From $5.00'}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={12} className="text-cyan-500/50 group-hover:text-cyan-400 transition-colors" />
                </div>
              </Link>
              {!hasPromptStudioDev && (
                <Link href="/prompting-studio/subscribe">
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 hover:border-purple-400/40 hover:bg-purple-500/10 transition-all cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-purple-400" />
                      <div>
                        <p className="text-xs font-semibold text-purple-400">Upgrade to Dev Tier</p>
                        <p className="text-[10px] text-slate-600">20% off tickets · From $20</p>
                      </div>
                    </div>
                    <ArrowRight size={12} className="text-purple-500/50 group-hover:text-purple-400 transition-colors" />
                  </div>
                </Link>
              )}
              {hasPromptStudioDev && (
                <Link href="/subscriptions">
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 hover:border-purple-400/40 hover:bg-purple-500/10 transition-all cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-purple-400" />
                      <div>
                        <p className="text-xs font-semibold text-purple-400">Dev Tier Active</p>
                        <p className="text-[10px] text-slate-600">Manage subscription</p>
                      </div>
                    </div>
                    <ArrowRight size={12} className="text-purple-500/50 group-hover:text-purple-400 transition-colors" />
                  </div>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Quick Message */}
        <div className="rounded-2xl border border-white/6 bg-white/2 backdrop-blur-sm p-5">
          <p className="text-[11px] font-mono text-slate-600 uppercase tracking-widest mb-1">Quick Message</p>
          <p className="text-[11px] text-slate-600 mb-3 leading-snug">
            Messages sent here are <span className="text-slate-500">anonymous</span>. For account-level concerns or support, please use the <span className="text-fuchsia-400/80">Feedback</span> button above.
          </p>
          <div className="flex gap-2">
            <input
              value={echoMessage}
              onChange={(e) => setEchoMessage(e.target.value)}
              placeholder="Send feedback or a request..."
              className="flex-1 bg-black/30 border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/40 transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && !isTransmitting && echoMessage.trim() && handleEchoSubmit()}
            />
            <button
              onClick={handleEchoSubmit}
              disabled={isTransmitting || !echoMessage.trim()}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold hover:from-cyan-500/30 hover:to-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {submitSuccess ? '✓' : isTransmitting ? '...' : 'Send'}
            </button>
          </div>
        </div>

      </div>
    </div>

    <ChatWidget />

    {/* Change Password Modal */}
    {showPasswordModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)} />
        <div className="relative w-full max-w-md rounded-2xl border border-amber-500/20 bg-[#080c18] shadow-2xl shadow-amber-500/5 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <KeyRound size={15} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white">Change Password</h2>
                <p className="text-[10px] text-slate-600 font-mono">{user.email}</p>
              </div>
            </div>
            <button onClick={() => setShowPasswordModal(false)} className="text-slate-600 hover:text-slate-400 transition-colors">
              <X size={16} />
            </button>
          </div>

          {pwSuccess ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <span className="text-2xl">✓</span>
              </div>
              <p className="text-sm font-semibold text-green-400">Password updated successfully</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Current password */}
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1.5 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showPwCurrent ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500/40 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPwCurrent(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    {showPwCurrent ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {/* Confirm current password */}
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1.5 block">Confirm Current Password</label>
                <div className="relative">
                  <input
                    type={showPwCurrentConfirm ? 'text' : 'password'}
                    value={pwCurrentConfirm}
                    onChange={e => setPwCurrentConfirm(e.target.value)}
                    placeholder="Re-enter current password"
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500/40 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPwCurrentConfirm(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    {showPwCurrentConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              <div className="border-t border-white/6 my-1" />

              {/* New password */}
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1.5 block">New Password</label>
                <div className="relative">
                  <input
                    type={showPwNew ? 'text' : 'password'}
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500/40 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPwNew(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    {showPwNew ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1">Min 8 chars, uppercase, lowercase, and number</p>
              </div>

              {/* Confirm new password */}
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1.5 block">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPwNewConfirm ? 'text' : 'password'}
                    value={pwNewConfirm}
                    onChange={e => setPwNewConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    onKeyDown={e => e.key === 'Enter' && !pwSubmitting && handleChangePassword()}
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500/40 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPwNewConfirm(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    {showPwNewConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {pwError && (
                <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">{pwError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 py-2 rounded-lg border border-white/8 bg-white/3 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={pwSubmitting || !pwCurrent || !pwCurrentConfirm || !pwNew || !pwNewConfirm}
                  className="flex-1 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-semibold text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {pwSubmitting ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  )
}
