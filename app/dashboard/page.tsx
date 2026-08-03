"use client"

import { useState, useEffect } from "react"
import { Ticket, LogOut, CreditCard, Image as ImageIcon, Receipt, Settings, Terminal, Sparkles, ArrowRight, ShieldCheck, KeyRound, X, Eye, EyeOff, AlertTriangle, FileText, Mail } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import ChatWidget from "@/components/ChatWidget"
import { SiteBrandMark, SiteLogoBox } from "@/components/SitePageHeader"

interface UserData {
  id: number
  email: string
  ticketBalance: number
  avatarUrl?: string | null
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
        <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-white animate-spin" />
      </div>
    )
  }

  if (!user) return null

  const ADMIN_EMAILS = ["dirtysecretai@gmail.com", "promptandprotocol@gmail.com"]
  const isAdmin = ADMIN_EMAILS.includes(user.email)


  return (
    <>
    <div className="min-h-[100dvh] bg-[#050810] text-white flex flex-col">
      {/* Subtle grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      {/* Ambient glows */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[300px] bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[300px] bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-3 sm:px-5 py-3 sm:py-5 flex flex-col justify-center gap-2.5 sm:gap-3">

        {/* Generation maintenance banner — admin emails bypass this */}
        {isGenerationMaintenance && user !== null && !['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'].includes(user.email) && (
          <div className="shrink-0 flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-red-500/40 bg-red-500/10">
            <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-red-300">Generation Temporarily Unavailable</p>
              <p className="text-[11px] text-slate-400 mt-0.5">AI generation is currently disabled for maintenance. Your tickets are safe — please check back soon.</p>
            </div>
          </div>
        )}

        {/* Header row: brand + user actions */}
        <div className="shrink-0 flex items-center justify-between gap-2">
          <SiteBrandMark size={38} />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/40 font-mono text-xs">
              <Ticket size={11} className="text-slate-500" />
              <span className="text-white tabular-nums">{user.ticketBalance.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-white/8 bg-white/3">
              {/* Profile picture — synced account-wide (same avatarUrl as the portal-v2 bubble) */}
              <div className="w-6 h-6 rounded-full overflow-hidden bg-gradient-to-br from-slate-200 to-slate-500 flex items-center justify-center text-[10px] font-black text-black shrink-0">
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  user.email[0].toUpperCase()
                )}
              </div>
              <span className="text-xs text-slate-400 max-w-[130px] truncate hidden md:block">{user.email}</span>
              {hasPromptStudioDev && (
                <span className="text-[9px] font-black bg-white/10 border border-white/20 text-white px-1.5 py-0.5 rounded-full leading-none">
                  DEV
                </span>
              )}
            </div>
            {isAdmin && (
              <Link href="/admin">
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/[0.06] hover:border-white/30 hover:bg-white/10 text-xs text-slate-200 transition-all">
                  <ShieldCheck size={12} />
                  <span className="hidden sm:inline">Admin</span>
                </button>
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/8 bg-white/3 hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400 text-xs text-slate-400 transition-all"
            >
              <LogOut size={12} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Welcome bar — hidden on very short screens (landscape phones) */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 rounded-xl border border-white/6 bg-white/2 [@media(max-height:460px)]:hidden">
          <p className="text-xs sm:text-sm font-semibold text-white">Welcome back, <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">{user.email.split('@')[0]}</span></p>
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-slate-600">All systems online</span>
          </div>
        </div>

        {/* Recent Generations — slim strip, hidden on very short screens */}
        <div className="shrink-0 rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3 [@media(max-height:460px)]:hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ImageIcon size={13} className="text-slate-300" />
              <span className="text-xs font-semibold text-white">Recent Generations</span>
              {totalImageCount > 0 && (
                <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">{totalImageCount.toLocaleString()}</span>
              )}
            </div>
            <Link href="/my-generations">
              <button className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white transition-colors">
                View All <ArrowRight size={10} />
              </button>
            </Link>
          </div>

          {generatedImages.length === 0 ? (
            <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-white/8 text-slate-600 text-sm">
              No generations yet
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {generatedImages.slice(0, 5).map((img, idx) => (
                <Link href="/my-generations" key={img.id || idx}>
                  <div className="aspect-square rounded-lg overflow-hidden border border-white/6 hover:border-white/30 transition-all group relative">
                    {img.videoMetadata?.isVideo ? (() => {
                      const thumb = img.videoMetadata?.thumbnailUrl
                      const videoUrl = img.imageUrl
                      const needsVideoThumb = !thumb || thumb === videoUrl || /\.(mp4|webm|mov)(\?|$)/i.test(thumb)
                      return needsVideoThumb ? (
                        // Autoplaying muted loop (like the home cards); #t=0.001 guarantees a
                        // first frame renders even before playback starts. The callback ref
                        // sets the muted PROPERTY — React's JSX attribute alone is unreliable
                        // and unmuted autoplay gets blocked (which showed as blank tiles).
                        <video
                          src={`${videoUrl}#t=0.001`}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          ref={el => { if (el) { el.muted = true; el.play().catch(() => {}) } }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img src={thumb} alt={`Generation ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      )
                    })() : (
                      <img src={`/api/images/${img.id}?thumb=1`} alt={`Generation ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    )}
                    {img.videoMetadata?.isVideo && (
                      <div className="absolute bottom-0.5 left-0.5 flex items-center bg-black/70 rounded px-0.5 py-0.5 pointer-events-none">
                        <svg className="w-2 h-2 text-white/80" fill="currentColor" viewBox="0 0 24 24">
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

        {/* AI Design Studio — launcher with the animated silver rim (natural height) */}
        <Link href="/" className="shrink-0 block group">
          <div className="relative rounded-2xl overflow-hidden p-[2px] transition-transform duration-200 group-hover:scale-[1.004]">
            {/* Rotating silver rim (oversized square so the sweep covers the wide card) */}
            <span
              className="absolute left-1/2 top-1/2 w-[250%] aspect-square -translate-x-1/2 -translate-y-1/2 animate-spin pointer-events-none"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(226,232,240,0.08), #f8fafc, #94a3b8, rgba(226,232,240,0.12), #cbd5e1, #64748b, rgba(226,232,240,0.08))",
                animationDuration: "6s",
              }}
            />
            <div className="relative rounded-[14px] bg-[#0a0f1a] px-3.5 sm:px-5 py-3.5 sm:py-4 flex items-center gap-3 sm:gap-4">
              {/* Synced site logo */}
              <SiteLogoBox size={48} rounded={14} />
              <div className="flex-1 min-w-0">
                <p className="text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-tight">
                  AI Design Studio
                </p>
                <p className="text-[11px] sm:text-xs text-slate-400 leading-snug line-clamp-2 mt-0.5 [@media(max-height:460px)]:hidden">
                  Your full creative workspace — generate images and videos with 20+ AI models, guided by your reference images.
                </p>
                <div className="hidden lg:flex flex-wrap gap-1.5 mt-2 [@media(max-height:560px)]:hidden">
                  {["20+ Models", "Image Generation", "Video Generation", "Reference Images", "Session History"].map(tag => (
                    <span key={tag} className="text-[9px] font-mono text-slate-300 bg-white/[0.06] border border-white/10 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {/* Open Studio — animated light sweep */}
              <span className="relative overflow-hidden shrink-0 flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-white/10 border border-white/25 text-white text-xs font-bold group-hover:bg-white/15 group-hover:border-white/40 transition-all">
                <span
                  className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
                  style={{ animation: "sheen-sweep 2.6s infinite" }}
                />
                Open Studio <ArrowRight size={13} />
              </span>
            </div>
          </div>
        </Link>

        {/* Bottom row: Account + Shop — side by side on all sizes */}
        <div className="shrink-0 grid grid-cols-2 gap-2 sm:gap-3">

          {/* Account */}
          <div className="rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3">
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2">Account</p>
            <div className="space-y-1.5">
              <Link href="/subscriptions" className="block">
                <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] text-slate-400 hover:text-white transition-all">
                  <Settings size={11} className="shrink-0" />
                  <span className="truncate">Subscriptions</span>
                </button>
              </Link>
              <Link href="/purchase-history" className="block">
                <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] text-slate-400 hover:text-white transition-all">
                  <Receipt size={11} className="shrink-0" />
                  <span className="truncate">Purchase History</span>
                </button>
              </Link>
              <Link href="/requests-feedback" className="block">
                <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] text-slate-400 hover:text-white transition-all">
                  <Terminal size={11} className="shrink-0" />
                  <span className="truncate">Feedback</span>
                </button>
              </Link>
              <button
                onClick={() => { setShowPasswordModal(true); setPwError(""); setPwSuccess(false) }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] text-slate-400 hover:text-white transition-all"
              >
                <KeyRound size={11} className="shrink-0" />
                <span className="truncate">Change Password</span>
              </button>
            </div>
          </div>

          {/* Shop */}
          <div className="rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3">
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2">Shop</p>
            <div className="space-y-1.5">
              <Link href="/buy-tickets" className="block">
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 min-w-0">
                    <Ticket size={12} className="text-white shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-white truncate">Buy Tickets</p>
                      <p className="text-[9px] text-slate-600 truncate">
                        {hasPromptStudioDev ? 'Dev tier — 10% off' : 'From $5.00'}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={11} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                </div>
              </Link>
              {!hasPromptStudioDev && (
                <Link href="/prompting-studio/subscribe" className="block">
                  <div className="flex items-center justify-between px-2.5 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] transition-all cursor-pointer group">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles size={12} className="text-slate-300 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-white truncate">Upgrade to Dev Tier</p>
                        <p className="text-[9px] text-slate-600 truncate">10% off tickets · From $20</p>
                      </div>
                    </div>
                    <ArrowRight size={11} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                  </div>
                </Link>
              )}
              {hasPromptStudioDev && (
                <Link href="/subscriptions" className="block">
                  <div className="flex items-center justify-between px-2.5 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] transition-all cursor-pointer group">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles size={12} className="text-slate-300 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-white truncate">Dev Tier Active</p>
                        <p className="text-[9px] text-slate-600 truncate">Manage subscription</p>
                      </div>
                    </div>
                    <ArrowRight size={11} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                  </div>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Documents & Support — every page from the Policies hub, one tap away */}
        <div className="shrink-0 rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3">
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2">Documents &amp; Support</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {[
              { href: "/policies", label: "Policies", icon: FileText },
              { href: "/contact", label: "Contact", icon: Mail },
              { href: "/terms", label: "Terms", icon: FileText },
              { href: "/privacy", label: "Privacy", icon: FileText },
              { href: "/refund", label: "Refund", icon: FileText },
              { href: "/report", label: "Report", icon: ShieldCheck },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <button className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[10px] text-slate-400 hover:text-white transition-all">
                  <Icon size={10} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>

    <ChatWidget />

    {/* Change Password Modal */}
    {showPasswordModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)} />
        <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#080c18] shadow-2xl shadow-black/40 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/15 flex items-center justify-center">
                <KeyRound size={15} className="text-slate-200" />
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
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-white/25 transition-colors"
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
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-white/25 transition-colors"
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
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-white/25 transition-colors"
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
                    className="w-full bg-black/40 border border-white/8 rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-white/25 transition-colors"
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
                  className="flex-1 py-2 rounded-lg bg-white/10 border border-white/20 text-xs font-semibold text-slate-200 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
