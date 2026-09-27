"use client"

import { useState, useEffect } from "react"
import { Ticket, LogOut, CreditCard, Image as ImageIcon, Receipt, Settings, Terminal, Sparkles, ArrowRight, ShieldCheck, KeyRound, X, Eye, EyeOff, AlertTriangle, FileText, Mail } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import ChatWidget from "@/components/ChatWidget"
import { SiteBrandMark, SiteLogoBox } from "@/components/SitePageHeader"
import { FEATURED_MODELS } from "@/components/home/featured"
import { CatalogCard, type CatalogMedia } from "@/components/dashboard/CatalogStrip"
import { ProhibitedContentNotice } from "@/components/ProhibitedContentNotice"
import { GenerationsCarousel } from "@/components/home/GenerationsCarousel"

interface UserData {
  id: number
  email: string
  ticketBalance: number
  avatarUrl?: string | null
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
      // Just the count, for the library heading; the wall fetches its own images.
      const res = await fetch('/api/my-images?page=1&limit=1')
      const data = await res.json()
      if (data.success) setTotalImageCount(data.pagination?.total || data.images.length)
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

  /*
   * The studio (/) opens on whichever view sessionStorage "pv2-view-mode"
   * names - the key it writes itself as you switch views - so each launcher
   * sets it first: Catalog opens the Home page, Open Studio the feed.
   */
  const openStudioAt = (mode: "home" | "image") => {
    try { sessionStorage.setItem("pv2-view-mode", mode) } catch {}
  }

  // Every model card with a picture or clip (featured first), for the Catalog card's strip.
  const [catalogMedia, setCatalogMedia] = useState<CatalogMedia[]>([])
  useEffect(() => {
    fetch("/api/admin/home-cards").then(r => r.ok ? r.json() : null).then(d => {
      const cards: Record<string, { mediaUrl?: string; mediaType?: string }> = d?.cards ?? {}
      const featured = FEATURED_MODELS.map(m => `${m.kind}:${m.name}`)
      const keys = [
        ...featured.filter(k => cards[k]?.mediaUrl),
        ...Object.keys(cards).filter(k => (k.startsWith("image:") || k.startsWith("video:")) && !featured.includes(k) && cards[k]?.mediaUrl),
      ]
      setCatalogMedia(keys.map(k => ({ name: k, url: cards[k].mediaUrl!, type: cards[k].mediaType || "image" })))
    }).catch(() => {})
  }, [])

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

      {/*
        Fills the window. On wide screens (xl+) it is a full-height layout:
        header across the top; on the left the library wall takes all the
        height left over, with the launchers and the policy notice under it;
        account, shop and documents in a sidebar on the right. The page used
        to be a fixed-height block centred in the window, which left bands of
        empty space above and below on a 16:9 monitor. Narrower screens stack
        the same sections and scroll.
      */}
      <div className="relative z-10 flex-1 w-full max-w-[2560px] mx-auto px-3 sm:px-6 lg:px-8 2xl:px-12 py-3 sm:py-5 xl:py-6 flex flex-col gap-2.5 sm:gap-3 xl:gap-4">

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
          <div className="flex items-center gap-5 min-w-0">
            <SiteBrandMark size={38} />
            <p className="hidden xl:block text-sm font-semibold text-white truncate">
              Welcome back, <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">{user.email.split('@')[0]}</span>
            </p>
          </div>
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
        <div className="shrink-0 xl:hidden flex items-center justify-between px-3 py-2 rounded-xl border border-white/6 bg-white/2 [@media(max-height:460px)]:hidden">
          <p className="text-xs sm:text-sm font-semibold text-white">Welcome back, <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">{user.email.split('@')[0]}</span></p>
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-slate-600">All systems online</span>
          </div>
        </div>

        <div className="xl:flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,380px)] 2xl:grid-cols-[minmax(0,1fr)_420px] gap-2.5 sm:gap-3 xl:gap-4">
        <div className="min-w-0 flex flex-col gap-2.5 sm:gap-3 xl:gap-4">

        {/*
          Your library - the home page's living masonry wall (drifting columns,
          new work flowing in, hover to hide or start a slideshow). It replaces
          a fixed strip of thumbnails that wrapped 12 into rows of 10 and 2. On
          wide screens it takes all the height the page has left over.
        */}
        <section className="xl:flex-1 xl:min-h-[320px] flex flex-col gap-2 min-w-0">
          <div className="shrink-0 flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <ImageIcon size={13} className="text-slate-300" />
              <span className="text-xs font-semibold text-white">Your Library</span>
              {totalImageCount > 0 && (
                <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">{totalImageCount.toLocaleString()}</span>
              )}
              <span className="hidden sm:inline text-[10px] text-slate-600">favourites and rediscoveries · hover to pause</span>
            </div>
            <Link href="/my-generations" className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white transition-colors">
              View All <ArrowRight size={10} />
            </Link>
          </div>
          <div className="relative xl:flex-1">
            <GenerationsCarousel
              signedIn
              showLabel={false}
              colTarget={170}
              maxCols={12}
              aspect="aspect-[4/3] sm:aspect-video lg:aspect-[21/9] xl:aspect-auto"
              className="xl:absolute xl:inset-0"
            />
          </div>
        </section>

        {/* Launchers: Catalog (the Home page) and the Studio (the feed). Side by
            side from md up, stacked on phones. */}
        <div className="shrink-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:h-[200px] 2xl:h-[220px] gap-2.5 sm:gap-3 xl:gap-4">

        {/* Catalog — opens the studio's Home page: every model and studio in one place. */}
        <Link href="/" onClick={() => openStudioAt("home")} className="block group">
          <div className="relative h-full rounded-2xl overflow-hidden border border-white/10 bg-[#0a0f1a] transition-all duration-200 group-hover:border-white/25 group-hover:scale-[1.004]">
            {/* The model cards' own 4:3 pictures and clips, cycling, beside or above
                the text - never under it (components/dashboard/CatalogStrip). */}
            <CatalogCard media={catalogMedia} />
          </div>
        </Link>

        {/* AI Design Studio — launcher with the animated silver rim (natural height) */}
        <Link href="/" onClick={() => openStudioAt("image")} className="block group">
          <div className="relative h-full rounded-2xl overflow-hidden p-[2px] transition-transform duration-200 group-hover:scale-[1.004]">
            {/* Rotating silver rim (oversized square so the sweep covers the wide card) */}
            <span
              className="absolute left-1/2 top-1/2 w-[250%] aspect-square -translate-x-1/2 -translate-y-1/2 animate-spin pointer-events-none"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(226,232,240,0.08), #f8fafc, #94a3b8, rgba(226,232,240,0.12), #cbd5e1, #64748b, rgba(226,232,240,0.08))",
                animationDuration: "6s",
              }}
            />
            <div className="relative h-full rounded-[14px] bg-[#0a0f1a] px-3.5 sm:px-5 py-3.5 sm:py-4 flex items-center gap-3 sm:gap-4">
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
        </div>

        {/* Content policy notice (CCBill) - the same one as on the Home page.
            Here below the launchers on narrower screens; on wide ones it sits
            at the foot of the right-hand column instead (below). */}
        <div className="xl:hidden"><ProhibitedContentNotice /></div>

        </div>

        {/*
          Sidebar from xl, filling the column top to bottom: the ticket balance,
          then Account and Shop - whose buttons grow to share the height - then
          documents and the policy notice. Below xl these follow the main column
          as before (Account and Shop side by side), without the balance panel,
          since the header already shows the balance.
        */}
        <div className="min-w-0 flex flex-col gap-2.5 sm:gap-3 xl:gap-4">

        {/* Ticket balance (wide screens) */}
        <div className="hidden xl:flex flex-col justify-between gap-4 xl:flex-[1.15] min-h-[180px] rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.02] to-transparent p-5 2xl:p-6">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono text-slate-500 uppercase tracking-[0.2em]">Ticket balance</p>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full leading-none border ${hasPromptStudioDev ? "bg-white/10 border-white/25 text-white" : "border-white/10 text-slate-500"}`}>
              {hasPromptStudioDev ? "DEV TIER" : "FREE PLAN"}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <Ticket size={30} className="text-slate-400 mb-2 shrink-0" />
            <p className="text-5xl 2xl:text-6xl font-black tracking-tight tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 leading-none">
              {user.ticketBalance.toLocaleString()}
            </p>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            {hasPromptStudioDev ? "Dev tier is active: 10% off every ticket pack." : "Upgrade to Dev tier for 10% off every ticket pack."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/buy-tickets" className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors">
              <Ticket size={13} /> Buy tickets
            </Link>
            <Link href={hasPromptStudioDev ? "/subscriptions" : "/prompting-studio/subscribe"} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/20 bg-white/[0.04] text-white text-xs font-semibold hover:bg-white/10 transition-colors">
              <Sparkles size={13} /> {hasPromptStudioDev ? "Manage plan" : "See plans"}
            </Link>
          </div>
        </div>

        {/* Account + Shop — side by side; stacked in the sidebar, sharing its height */}
        <div className="shrink-0 xl:shrink xl:flex-[2.4] xl:min-h-0 grid grid-cols-2 xl:grid-cols-1 xl:grid-rows-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2 sm:gap-3 xl:gap-4">

          {/* Account */}
          <div className="rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3 xl:p-4 flex flex-col min-h-0">
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2 xl:mb-3">Account</p>
            <div className="space-y-1.5 xl:space-y-0 xl:flex-1 xl:flex xl:flex-col xl:gap-2 xl:min-h-0">
              <Link href="/subscriptions" className="block xl:flex-1">
                <button className="w-full flex items-center gap-2 xl:gap-3 px-2.5 xl:px-3.5 py-1.5 xl:py-0 xl:h-full xl:min-h-[40px] rounded-lg xl:rounded-xl border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] xl:text-[13px] text-slate-400 hover:text-white transition-all">
                  <Settings size={11} className="shrink-0 xl:w-4 xl:h-4" />
                  <span className="truncate">Subscriptions</span>
                </button>
              </Link>
              <Link href="/purchase-history" className="block xl:flex-1">
                <button className="w-full flex items-center gap-2 xl:gap-3 px-2.5 xl:px-3.5 py-1.5 xl:py-0 xl:h-full xl:min-h-[40px] rounded-lg xl:rounded-xl border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] xl:text-[13px] text-slate-400 hover:text-white transition-all">
                  <Receipt size={11} className="shrink-0 xl:w-4 xl:h-4" />
                  <span className="truncate">Purchase History</span>
                </button>
              </Link>
              <Link href="/requests-feedback" className="block xl:flex-1">
                <button className="w-full flex items-center gap-2 xl:gap-3 px-2.5 xl:px-3.5 py-1.5 xl:py-0 xl:h-full xl:min-h-[40px] rounded-lg xl:rounded-xl border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] xl:text-[13px] text-slate-400 hover:text-white transition-all">
                  <Terminal size={11} className="shrink-0 xl:w-4 xl:h-4" />
                  <span className="truncate">Feedback</span>
                </button>
              </Link>
              <div className="xl:flex-1">
                <button
                  onClick={() => { setShowPasswordModal(true); setPwError(""); setPwSuccess(false) }}
                  className="w-full flex items-center gap-2 xl:gap-3 px-2.5 xl:px-3.5 py-1.5 xl:py-0 xl:h-full xl:min-h-[40px] rounded-lg xl:rounded-xl border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[11px] xl:text-[13px] text-slate-400 hover:text-white transition-all"
                >
                  <KeyRound size={11} className="shrink-0 xl:w-4 xl:h-4" />
                  <span className="truncate">Change Password</span>
                </button>
              </div>
            </div>
          </div>

          {/* Shop */}
          <div className="rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3 xl:p-4 flex flex-col min-h-0">
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2 xl:mb-3">Shop</p>
            <div className="space-y-1.5 xl:space-y-0 xl:flex-1 xl:flex xl:flex-col xl:gap-2 xl:min-h-0">
              <Link href="/buy-tickets" className="block xl:flex-1">
                <div className="flex items-center justify-between px-2.5 xl:px-4 py-2 xl:py-0 xl:h-full xl:min-h-[52px] rounded-lg xl:rounded-xl border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 xl:gap-3 min-w-0">
                    <Ticket size={12} className="text-white shrink-0 xl:w-4 xl:h-4" />
                    <div className="min-w-0">
                      <p className="text-[11px] xl:text-[13px] font-semibold text-white truncate">Buy Tickets</p>
                      <p className="text-[9px] xl:text-[11px] text-slate-600 truncate">
                        {hasPromptStudioDev ? 'Dev tier — 10% off' : 'From $5.00'}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={11} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                </div>
              </Link>
              <Link href={hasPromptStudioDev ? "/subscriptions" : "/prompting-studio/subscribe"} className="block xl:flex-1">
                <div className="flex items-center justify-between px-2.5 xl:px-4 py-2 xl:py-0 xl:h-full xl:min-h-[52px] rounded-lg xl:rounded-xl border border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 xl:gap-3 min-w-0">
                    <Sparkles size={12} className="text-slate-300 shrink-0 xl:w-4 xl:h-4" />
                    <div className="min-w-0">
                      <p className="text-[11px] xl:text-[13px] font-semibold text-white truncate">{hasPromptStudioDev ? "Dev Tier Active" : "Upgrade to Dev Tier"}</p>
                      <p className="text-[9px] xl:text-[11px] text-slate-600 truncate">{hasPromptStudioDev ? "Manage subscription" : "10% off tickets · From $20"}</p>
                    </div>
                  </div>
                  <ArrowRight size={11} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* Documents & Support — every page from the Policies hub, one tap away */}
        <div className="shrink-0 xl:shrink xl:flex-[0.9] xl:min-h-[118px] rounded-xl border border-white/6 bg-white/2 p-2.5 sm:p-3 xl:p-4 flex flex-col">
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2 xl:mb-3">Documents &amp; Support</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-3 xl:grid-rows-2 xl:flex-1 gap-1.5 xl:gap-2">
            {[
              { href: "/policies", label: "Policies", icon: FileText },
              { href: "/contact", label: "Contact", icon: Mail },
              { href: "/terms", label: "Terms", icon: FileText },
              { href: "/privacy", label: "Privacy", icon: FileText },
              { href: "/refund", label: "Refund", icon: FileText },
              { href: "/report", label: "Report", icon: ShieldCheck },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="block">
                <button className="w-full h-full flex xl:flex-col items-center justify-center gap-1.5 xl:gap-1 px-2 py-1.5 rounded-lg xl:rounded-xl border border-white/6 bg-white/2 hover:border-white/25 hover:bg-white/[0.06] text-[10px] xl:text-[11px] text-slate-400 hover:text-white transition-all">
                  <Icon size={10} className="shrink-0 xl:w-3.5 xl:h-3.5" />
                  <span className="truncate">{label}</span>
                </button>
              </Link>
            ))}
          </div>
        </div>

        {/* The policy notice, at the foot of the sidebar on wide screens. */}
        <div className="hidden xl:block shrink-0"><ProhibitedContentNotice /></div>

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
