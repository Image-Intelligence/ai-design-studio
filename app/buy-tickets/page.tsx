"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Ticket, Zap, Crown, Sparkles, ChevronLeft, Check, Shield } from "lucide-react"
import Link from "next/link"

interface UserData {
  id: number
  email: string
  ticketBalance: number
}

// Dev Tier discount is 10% (cut from 20/30% on 2026-07-29 — keep in sync with
// the subscribe page, shop dropdown, and dashboard copy)
const TICKET_PACKAGES = [
  { tickets: 25,   freeTierPrice: 5.00,   devTierPrice: 4.50  },
  { tickets: 50,   freeTierPrice: 9.00,   devTierPrice: 8.10,  popular: true  },
  { tickets: 100,  freeTierPrice: 16.00,  devTierPrice: 14.40 },
  { tickets: 250,  freeTierPrice: 35.00,  devTierPrice: 31.50 },
  { tickets: 500,  freeTierPrice: 65.00,  devTierPrice: 58.50, bestValue: true },
  { tickets: 1000, freeTierPrice: 120.00, devTierPrice: 108.00 },
]

const BENEFITS = [
  {
    icon: <Zap size={15} />,
    title: "Every model, every scanner",
    desc: "Works across all scanners — NanoBanana Pro, SeeDream 4.5, FLUX 2, Kling 3.0, and more.",
  },
  {
    icon: <Sparkles size={15} />,
    title: "4K resolution support",
    desc: "4K quality outputs available on select models for 2 tickets per generation.",
  },
  {
    icon: <Check size={15} />,
    title: "Reference image support",
    desc: "Use your own reference images to guide generations across all models.",
  },
  {
    icon: <Shield size={15} />,
    title: "Privacy guaranteed",
    desc: "Paid API — your prompts and images are never used to train AI models.",
  },
  {
    icon: <Ticket size={15} />,
    title: "Tickets never expire",
    desc: "Unused tickets stay in your account indefinitely.",
  },
]

export default function BuyTicketsPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(TICKET_PACKAGES[1]) // default: 50
  const [hasPromptStudioDev, setHasPromptStudioDev] = useState(false)
  const [acceptedTOS, setAcceptedTOS] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [successTickets, setSuccessTickets] = useState<number | null>(null)
  const [dispenserDown, setDispenserDown] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const [sessionRes, configRes] = await Promise.all([
          fetch('/api/auth/session'),
          fetch('/api/admin/config'),
        ])
        const data = await sessionRes.json()
        if (!data.authenticated) { router.push('/login'); return }
        if (configRes.ok) {
          const cfg = await configRes.json()
          if (cfg.ticketDispenserMaintenance) setDispenserDown(true)
        }
        const ticketRes = await fetch(`/api/user/tickets?userId=${data.user.id}`)
        const ticketData = await ticketRes.json()
        const liveBalance = ticketData.success ? ticketData.balance : data.user.ticketBalance
        setUser({ ...data.user, ticketBalance: liveBalance })
        const subRes = await fetch('/api/user/subscription')
        const subData = await subRes.json()
        if (subData.success && subData.hasPromptStudioDev) setHasPromptStudioDev(true)
      } catch {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  // Show success banner if redirected back from LS checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      const t = parseInt(params.get('tickets') ?? '0')
      if (t > 0) setSuccessTickets(t)
      // Clean the URL without reloading
      window.history.replaceState({}, '', '/buy-tickets')
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="text-cyan-400 font-mono animate-pulse tracking-widest">LOADING...</div>
      </div>
    )
  }
  if (!user) return null

  const devPrice   = hasPromptStudioDev ? selected.devTierPrice : null
  const price      = devPrice ?? selected.freeTierPrice
  const savings    = selected.freeTierPrice - (devPrice ?? selected.freeTierPrice)
  const ppt        = price / selected.tickets
  const devSavePct = devPrice ? Math.round((savings / selected.freeTierPrice) * 100) : 0

  const handleDispense = async () => {
    if (!acceptedTOS || purchasing) return
    setPurchasing(true)
    setPurchaseError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'tickets', tickets: selected.tickets }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout')
      window.location.href = data.checkoutUrl
    } catch (err: any) {
      setPurchaseError(err.message || 'Something went wrong. Please try again.')
      setPurchasing(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#050810] text-white relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.012)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-32 left-16 w-96 h-96 bg-cyan-500/4 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-32 right-16 w-96 h-96 bg-fuchsia-500/4 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8">

        {/* Back link */}
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-cyan-400 text-sm mb-8 transition-colors">
          <ChevronLeft size={16} />Back to Dashboard
        </Link>

        {/* Success banner */}
        {successTickets !== null && (
          <div className="mb-6 px-4 py-3 rounded-xl border border-green-500/40 bg-green-500/10 flex items-center gap-3">
            <Check size={15} className="text-green-400 flex-shrink-0" />
            <p className="text-sm text-slate-300">
              <span className="font-bold text-green-400">Purchase successful!</span> {successTickets} tickets have been added to your account. It may take a moment to reflect.
            </p>
          </div>
        )}

        {/* Page header row */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-500 mb-1">
              TICKET DISPENSER
            </h1>
            <p className="text-slate-500 text-sm font-mono">1 ticket = 1 AI image generation</p>
          </div>

          {/* Balance chip */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl border border-cyan-500/30 bg-slate-900/80 backdrop-blur-sm">
            <Ticket size={18} className="text-cyan-400" />
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider leading-none mb-0.5">Your balance</p>
              <p className="text-xl font-black text-cyan-400 leading-none">{user.ticketBalance} <span className="text-sm font-medium">tickets</span></p>
            </div>
          </div>
        </div>

        {/* Dev Tier banner */}
        {hasPromptStudioDev && (
          <div className="mb-6 px-4 py-3 rounded-xl border border-purple-500/40 bg-purple-500/10 flex items-center gap-3">
            <Sparkles size={15} className="text-purple-400 flex-shrink-0" />
            <p className="text-sm text-slate-300">
              <span className="font-bold text-purple-400">Dev Tier pricing active</span> — you're saving 10% on every package.
            </p>
          </div>
        )}

        {/* ── What are tickets? ── */}
        <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">What are tickets?</p>
          <p className="text-sm text-slate-300 leading-relaxed mb-5">
            Tickets are your creative fuel. Every time you generate an AI image on AI Design Studio, one ticket is spent.
            There's no subscription required — you buy what you need and use it whenever you want.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3">
              <p className="text-lg font-black text-cyan-400 font-mono leading-none mb-1">1 ticket</p>
              <p className="text-xs text-slate-400 font-medium leading-snug">One standard AI image generation, any model, any style.</p>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3">
              <p className="text-lg font-black text-fuchsia-400 font-mono leading-none mb-1">2 tickets</p>
              <p className="text-xs text-slate-400 font-medium leading-snug">4K resolution output on supported models — twice the detail.</p>
            </div>
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3">
              <p className="text-lg font-black text-emerald-400 font-mono leading-none mb-1">Never expire</p>
              <p className="text-xs text-slate-400 font-medium leading-snug">Unused tickets stay in your account indefinitely. No pressure.</p>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">

          {/* ── Benefits column ─────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">What's included</p>

            {BENEFITS.map(b => (
              <div key={b.title} className="flex items-start gap-3">
                <div className="mt-0.5 text-cyan-400 flex-shrink-0">{b.icon}</div>
                <div>
                  <p className="text-sm font-bold text-white leading-snug">{b.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}

            {/* Dev Tier upsell for non-subscribers */}
            {!hasPromptStudioDev && (
              <div className="mt-2 p-3 rounded-xl border border-purple-500/25 bg-purple-500/5">
                <p className="text-xs font-bold text-purple-400 mb-1">Save 10% on every package</p>
                <p className="text-xs text-slate-500 mb-2.5 leading-relaxed">
                  Dev Tier subscribers get 10% off every ticket package.
                </p>
                <Link href="/prompting-studio/subscribe" className="text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors underline underline-offset-2">
                  Upgrade to Dev Tier →
                </Link>
              </div>
            )}
          </div>

          {/* ── Dispenser column ────────────────────────────────────────── */}
          <div className="lg:col-span-3">

            {/* Machine top bar */}
            <div className="rounded-t-2xl border border-b-0 border-slate-700 bg-gradient-to-b from-slate-800 to-slate-850 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">MULTIVERSE TICKET DISPENSER v1</span>
              <Ticket size={13} className="text-slate-700" />
            </div>

            {/* Machine body */}
            <div className="border border-t-0 border-slate-700 bg-slate-950 rounded-b-2xl p-5 space-y-5">

              {/* ── LCD display ── */}
              <div className="rounded-xl bg-black border border-cyan-900/50 p-4 shadow-inner shadow-cyan-950/50 font-mono">
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-[9px] text-cyan-600/70 uppercase tracking-[0.2em] mb-1">Quantity selected</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-black text-cyan-400">{selected.tickets}</span>
                      <span className="text-sm text-cyan-700">tickets</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-[9px] text-cyan-600/70 uppercase tracking-[0.2em] mb-1">Total</p>
                    {hasPromptStudioDev ? (
                      <div className="text-right">
                        <p className="text-xs text-slate-700 line-through leading-none mb-0.5">
                          ${selected.freeTierPrice.toFixed(2)}
                        </p>
                        <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 leading-none">
                          ${price.toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-4xl font-black text-cyan-400 leading-none">
                        ${selected.freeTierPrice.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Lower display row */}
                <div className="flex items-center justify-between border-t border-cyan-900/30 pt-2.5">
                  <p className="text-[10px] text-slate-700">${ppt.toFixed(3)}&thinsp;/&thinsp;ticket</p>
                  {hasPromptStudioDev ? (
                    <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                      ✓ Dev Tier — save ${savings.toFixed(2)} ({devSavePct}%)
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-700">
                      Dev Tier price: <span className="text-slate-500">${selected.devTierPrice.toFixed(2)}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* ── Package selector ── */}
              <div>
                <p className="text-[9px] text-slate-700 uppercase tracking-widest font-mono mb-2">Select amount</p>
                <div className="grid grid-cols-3 gap-2">
                  {TICKET_PACKAGES.map(pkg => {
                    const isActive = selected.tickets === pkg.tickets
                    const displayPrice = hasPromptStudioDev ? pkg.devTierPrice : pkg.freeTierPrice
                    return (
                      <button
                        key={pkg.tickets}
                        onClick={() => setSelected(pkg)}
                        className={`relative py-3 px-2 rounded-xl font-mono font-bold text-sm transition-all ${
                          isActive
                            ? 'bg-cyan-500 text-black border-2 border-cyan-300 shadow-lg shadow-cyan-500/25'
                            : 'bg-slate-900 text-slate-400 border-2 border-slate-800 hover:border-slate-600 hover:text-white'
                        }`}
                      >
                        {pkg.bestValue && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-fuchsia-500 text-white px-1.5 py-0.5 rounded-full whitespace-nowrap leading-tight">
                            BEST VALUE
                          </span>
                        )}
                        {pkg.popular && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-cyan-600 text-black px-1.5 py-0.5 rounded-full whitespace-nowrap leading-tight">
                            POPULAR
                          </span>
                        )}
                        <span className="block text-xl leading-tight">{pkg.tickets}</span>
                        <span className={`text-xs font-semibold leading-tight ${isActive ? 'text-black/70' : 'text-slate-500'}`}>
                          ${displayPrice.toFixed(2)}
                        </span>
                        {hasPromptStudioDev && (
                          <span className={`block text-[9px] font-normal leading-tight line-through ${isActive ? 'text-black/30' : 'text-slate-700'}`}>
                            ${pkg.freeTierPrice.toFixed(2)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── TOS ── */}
              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-800/80 hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={acceptedTOS}
                  onChange={e => setAcceptedTOS(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 cursor-pointer flex-shrink-0"
                />
                <span className="text-xs text-slate-500 leading-relaxed">
                  I agree to the{' '}
                  <a href="/terms" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">Terms of Service</a>
                  {', '}
                  <a href="/privacy" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">Privacy Policy</a>
                  {', and '}
                  <a href="/refund" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">Refund Policy</a>.
                  {' '}All ticket purchases are final and non-refundable. Images stored for 30 days.
                </span>
              </label>

              {/* ── Dispense button ── */}
              {dispenserDown ? (
                <div className="space-y-3">
                  <div className="w-full py-4 rounded-xl border-2 border-orange-500/30 bg-orange-500/5 text-center cursor-not-allowed">
                    <p className="font-black text-base tracking-widest text-orange-400">COMING SOON</p>
                    <p className="text-[10px] font-normal mt-0.5 text-orange-400/50">Ticket purchasing is temporarily unavailable</p>
                  </div>
                  <p className="text-xs text-slate-600 text-center leading-relaxed">
                    We're setting up a new payment system. Check back soon — your existing tickets are unaffected.
                  </p>
                </div>
              ) : (
                <>
                  {purchaseError && (
                    <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                      {purchaseError}
                    </p>
                  )}
                  <button
                    onClick={handleDispense}
                    disabled={!acceptedTOS || purchasing}
                    className={`w-full py-4 rounded-xl font-black text-base tracking-widest transition-all ${
                      !acceptedTOS
                        ? 'cursor-not-allowed bg-slate-900 border-2 border-slate-800 text-slate-600'
                        : purchasing
                        ? 'cursor-wait bg-slate-800 border-2 border-cyan-500/50 text-cyan-400 animate-pulse'
                        : 'cursor-pointer bg-gradient-to-r from-cyan-500 to-fuchsia-500 border-2 border-cyan-400/50 text-black hover:shadow-lg hover:shadow-cyan-500/30 active:scale-[0.99]'
                    }`}
                  >
                    {purchasing ? 'REDIRECTING TO CHECKOUT...' : 'DISPENSE TICKETS'}
                    <span className={`block text-[10px] font-normal mt-0.5 tracking-normal ${
                      !acceptedTOS ? 'text-slate-700' : purchasing ? 'text-cyan-600' : 'text-black/60'
                    }`}>
                      {purchasing
                        ? 'Opening secure checkout...'
                        : !acceptedTOS
                        ? 'Accept the terms above to continue'
                        : `${selected.tickets} tickets · $${price.toFixed(2)}`}
                    </span>
                  </button>
                  <p className="text-[9px] text-slate-800 text-center font-mono tracking-widest uppercase">
                    All transactions encrypted · Secured checkout
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
