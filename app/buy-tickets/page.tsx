"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Ticket, Sparkles, Check, ChevronDown, Lock, ShieldCheck,
  Infinity as InfinityIcon, Layers, RotateCcw, Wand2,
} from "lucide-react"
import { SilverRim, LoopVideo, ShopHeader, ShopBackdrop, ShopFooter, SHOP_MEDIA } from "@/components/shop/ShopKit"
// Pack prices live in lib/ticket-pricing.ts so the shop and the admin
// Ticket Economics page always quote the same USD-per-ticket.
import { TICKET_PACKAGES, type TicketPackage } from "@/lib/ticket-pricing"

interface UserData {
  id: number
  email: string
  ticketBalance: number
}

/*
 * Page visuals (2026-10-04), all made on the site itself on the
 * promptandprotocol@gmail.com account: the pack art is NanoBanana 2; the hero
 * is "one ticket, perfectly lit" - a NanoBanana 2 edit embossing the real site
 * logo on a single silver ticket, animated by SeeDance 2.5 (1080p, locked
 * camera, first frame = last frame so it loops seamlessly). The first hero
 * (a dispenser with a ticket ribbon) was rejected by the owner.
 * Web copies live on the public bucket under shop/ (webp, and an H.264
 * rendition with no audio for the loop).
 */
const MEDIA = SHOP_MEDIA
const HERO_POSTER = `${MEDIA}/shop/hero2-5d406fbd-02e7-428d-8dc3-b9a8940f3c6f.webp`
const HERO_VIDEO: string | null = `${MEDIA}/shop/hero2-loop-b3ba7184-2b59-402c-909c-251c5d48178f.mp4`
const PACK_ART: Record<number, string> = {
  25:  `${MEDIA}/shop/pack-25-061134d8-4ab8-4a7a-b2d6-d9fbfe473f2d.webp`,
  50:  `${MEDIA}/shop/pack-50-495be024-e8d2-45e5-9c89-784c4dedda48.webp`,
  100: `${MEDIA}/shop/pack-100-fa65505d-61fa-433c-85f4-1587f02949d0.webp`,
  175: `${MEDIA}/shop/pack-175-1b17b778-77ad-482f-a7c8-66f2307a0a62.webp`,
  250: `${MEDIA}/shop/pack-250-815ff085-b7fb-4596-a951-a5250db31841.webp`,
  375: `${MEDIA}/shop/pack-375-fb5258f5-f63c-44e9-99bc-79abd43fb27f.webp`,
  500: `${MEDIA}/shop/pack-500-9c0079fa-12b5-4bc3-99da-ab426b44e6f5.webp`,
  650: `${MEDIA}/shop/pack-650-258a107d-af8e-42f5-bd0e-4e4bbe4b9b0d.webp`,
  825: `${MEDIA}/shop/pack-825-e0184813-a49e-4a78-8582-90004e8fc890.webp`,
}

// "What your tickets make" - existing home-card media (public models only)
const SHOWCASE: { title: string; desc: string; src: string; poster?: string }[] = [
  { title: "Images", desc: "Photoreal, illustration, design and edits - from 1 ticket.", src: `${MEDIA}/home-cards/image-nanobanana-pro-2-card-61d3fd6e-3f9d-47d5-8ebd-34ecb613155d.mp4`, poster: `${MEDIA}/home-cards/image-nanobanana-pro-2-still-d8f1e64b-5778-41a2-940a-85a1e87d5232.jpg` },
  { title: "Video", desc: "Text, image and reference to video, priced by the second.", src: `${MEDIA}/home-cards/video-seedance-2-5-ad-card-e6ad62b1-2798-467a-8e5e-69cddec2840a.mp4`, poster: `${MEDIA}/home-cards/video-seedance-2-5-title-cd2fad12-70ce-45f5-83ba-98535d29c607.jpg` },
  { title: "Audio", desc: "Voices, music and sound effects from the Audio Studio.", src: `${MEDIA}/home-cards/audio-minimax-music-3-title-6313641f-c567-4b6c-babb-cb6e878d2a87.jpg` },
  { title: "Try-On & edits", desc: "Dress a model, swap a background, reshoot a product.", src: `${MEDIA}/home-cards/image-virtual-try-on-thumb-9a9963b8-e190-487a-84ab-b0de8980afe2.jpg` },
]

const FAQ = [
  {
    q: "What is a ticket?",
    a: "Tickets are the one currency for everything on the site - images, video, audio and the studios. Every model shows its ticket price before you generate, so you always know what a run costs. Images start at 1 ticket; video and premium models cost more.",
  },
  {
    q: "Do tickets expire?",
    a: "Never. Unused tickets stay in your account for as long as you have it.",
  },
  {
    q: "What happens if a generation fails?",
    a: "The tickets for a failed generation go straight back to your balance automatically.",
  },
  {
    q: "Can I get a refund on a pack?",
    a: "Ticket purchases are final and non-refundable - see the Refund Policy for the details.",
  },
  {
    q: "How is my card charged?",
    a: "Checkout happens on our payment processor's secure, PCI-DSS compliant page (CCBill) - your card details never touch our servers. The charge shows under CCBill's billing descriptor.",
  },
  {
    q: "Is there a cheaper way to get tickets?",
    a: "Dev Tier plans include tickets every cycle at $0.08 each, and take 10% off every pack on this page.",
  },
]

const usd = (n: number) => `$${n.toFixed(2)}`
// Per-ticket rate of the smallest pack - every "save" badge is against it
const BASE_RATE = TICKET_PACKAGES[0].freeTierPrice / TICKET_PACKAGES[0].tickets
const BEST_RATE = Math.min(...TICKET_PACKAGES.map(p => p.freeTierPrice / p.tickets))

function PackCard({ pkg, active, dev, onSelect, wide }: {
  pkg: TicketPackage; active: boolean; dev: boolean; onSelect: () => void; wide?: boolean
}) {
  const price = dev ? pkg.devTierPrice : pkg.freeTierPrice
  const rate = price / pkg.tickets
  const save = Math.round((1 - pkg.freeTierPrice / pkg.tickets / BASE_RATE) * 100)
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative isolate text-left rounded-2xl overflow-hidden border transition-all duration-200 bg-[#070b14] ${
        wide ? "col-span-2 sm:col-span-1" : ""
      } ${
        active
          ? "border-white/30 shadow-[0_0_40px_-12px_rgba(226,232,240,0.45)] -translate-y-0.5"
          : "border-white/[0.08] hover:border-white/25 hover:-translate-y-0.5"
      }`}
    >
      {active && <SilverRim />}
      <div className={`relative overflow-hidden ${wide ? "aspect-[16/9] sm:aspect-[4/3]" : "aspect-[4/3]"}`}>
        <img
          src={PACK_ART[pkg.tickets]}
          alt=""
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${active ? "scale-[1.04]" : "group-hover:scale-[1.03]"}`}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#070b14] to-transparent" />
        {/* badges */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          {pkg.bestValue ? (
            <span className="text-[9px] sm:text-[10px] font-black tracking-wider bg-gradient-to-r from-slate-100 to-slate-400 text-black px-2 py-0.5 rounded-full">BEST VALUE</span>
          ) : pkg.popular ? (
            <span className="text-[9px] sm:text-[10px] font-black tracking-wider bg-white/20 border border-white/40 text-white px-2 py-0.5 rounded-full backdrop-blur">POPULAR</span>
          ) : <span />}
          {save > 0 && (
            <span className="text-[9px] sm:text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 rounded-full backdrop-blur">
              SAVE {save}%
            </span>
          )}
        </div>
        {active && (
          <span className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            <Check size={14} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="px-3 sm:px-4 pb-3 sm:pb-4 -mt-3 relative">
        <p className="text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">{pkg.name}</p>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className={`text-2xl sm:text-3xl font-black leading-none ${active ? "text-white" : "bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent"}`}>
            {pkg.tickets}
          </span>
          <span className="text-[11px] sm:text-xs text-slate-500">tickets</span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-2 flex-wrap">
          <div className="leading-none">
            {dev && <span className="block text-[10px] text-slate-600 line-through mb-0.5">{usd(pkg.freeTierPrice)}</span>}
            <span className={`text-base sm:text-lg font-bold ${dev ? "text-violet-200" : "text-slate-100"}`}>{usd(price)}</span>
          </div>
          <span className="text-[10px] sm:text-[11px] font-mono text-slate-500">${rate.toFixed(3)}/ticket</span>
        </div>
      </div>
    </button>
  )
}

export default function BuyTicketsPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TicketPackage>(TICKET_PACKAGES.find(p => p.popular) ?? TICKET_PACKAGES[0])
  const [hasPromptStudioDev, setHasPromptStudioDev] = useState(false)
  const [acceptedTOS, setAcceptedTOS] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [successTickets, setSuccessTickets] = useState<number | null>(null)
  const [dispenserDown, setDispenserDown] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

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

  // Show success banner if redirected back from checkout; ?pack=N (the shop
  // dropdown's quick picks) preselects that pack
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wanted = TICKET_PACKAGES.find(p => p.tickets === Number(params.get('pack')))
    if (wanted) setSelected(wanted)
    if (params.get('success') === 'true') {
      const t = parseInt(params.get('tickets') ?? '0')
      if (t > 0) setSuccessTickets(t)
      // Clean the URL without reloading
      window.history.replaceState({}, '', '/buy-tickets')
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
        <div className="text-slate-400 font-mono animate-pulse tracking-widest text-sm">LOADING…</div>
      </div>
    )
  }
  if (!user) return null

  const dev        = hasPromptStudioDev
  const price      = dev ? selected.devTierPrice : selected.freeTierPrice
  const savings    = selected.freeTierPrice - price
  const ppt        = price / selected.tickets

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

  // On phones and tablets the checkout panel sits below the packs; the
  // sticky bar jumps to it
  const goToCheckout = () => document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="min-h-screen bg-[#05080f] text-white relative overflow-x-hidden">
      <style>{`@keyframes ticket-sheen { 0% { transform: translateX(-150%) } 100% { transform: translateX(400%) } }`}</style>
      <ShopBackdrop />

      <ShopHeader
        title="Ticket Dispenser"
        right={<>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#070b14]/95">
            <Ticket size={14} className="text-slate-300" />
            <span className="text-sm font-black text-white leading-none">{user.ticketBalance.toLocaleString()}</span>
            <span className="hidden sm:inline text-[11px] text-slate-500 leading-none">tickets</span>
          </div>
          <Link
            href="/admin/portal-v2"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all"
          >
            <Wand2 size={13} />
            Studio
          </Link>
        </>}
      />

      <main className="relative z-10 max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-28 lg:pb-16">

        {/* Success banner */}
        {successTickets !== null && (
          <div className="mb-5 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3">
            <Check size={15} className="text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-slate-300">
              <span className="font-bold text-emerald-400">Purchase successful!</span> {successTickets} tickets have been added to your account. It may take a moment to reflect.
            </p>
          </div>
        )}

        {/* ── Hero: the loop fills the panel on desktop, sits above the copy on phones ── */}
        <section className="relative isolate rounded-3xl overflow-hidden border border-white/[0.08] bg-[#070b14]">
          <div className="relative aspect-[4/3] sm:aspect-video lg:aspect-[21/9] max-h-[760px] w-full">
            {HERO_VIDEO ? (
              <LoopVideo src={HERO_VIDEO} poster={HERO_POSTER} className="absolute inset-0 w-full h-full object-cover object-[80%_50%] lg:object-right" />
            ) : (
              <img src={HERO_POSTER} alt="" className="absolute inset-0 w-full h-full object-cover object-[80%_50%] lg:object-right" />
            )}
            <div className="hidden lg:block absolute inset-0 bg-gradient-to-r from-[#05080f] via-[#05080f]/75 to-transparent" />
            <div className="lg:hidden absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#070b14] to-transparent" />
          </div>
          <div className="relative lg:absolute lg:inset-y-0 lg:left-0 lg:w-[52%] xl:w-[46%] flex flex-col justify-center px-5 pb-6 -mt-6 sm:px-8 sm:pb-8 lg:mt-0 lg:p-12 xl:p-16">
            <p className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.3em] text-slate-400">One balance · every model</p>
            <h1 className="mt-2 text-3xl sm:text-5xl xl:text-6xl font-black tracking-tight leading-[1.05] bg-gradient-to-r from-slate-100 via-white to-slate-400 bg-clip-text text-transparent">
              Fuel every idea.
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Tickets run every image, video, audio and studio model on the site. Buy a pack once and spend it however you like - they never expire.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.05] text-[11px] sm:text-xs text-slate-200 backdrop-blur">
                <Ticket size={12} /> As low as ${BEST_RATE.toFixed(2)} a ticket
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.05] text-[11px] sm:text-xs text-slate-200 backdrop-blur">
                <InfinityIcon size={12} /> Never expire
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.05] text-[11px] sm:text-xs text-slate-200 backdrop-blur">
                <RotateCcw size={12} /> Failed runs refunded
              </span>
            </div>
          </div>
        </section>

        {/* Dev Tier banner */}
        {dev && (
          <div className="mt-5 px-4 py-3 rounded-xl border border-violet-500/30 bg-violet-500/10 flex items-center gap-3">
            <Sparkles size={15} className="text-violet-300 flex-shrink-0" />
            <p className="text-sm text-slate-300">
              <span className="font-bold text-violet-300">Dev Tier pricing active</span> - you&apos;re saving 10% on every pack.
            </p>
          </div>
        )}

        {/* ── Packs + checkout ── */}
        <section className="mt-8 sm:mt-10">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">Choose your pack</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">Bigger packs, lower price per ticket. Every pack is a single checkout.</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] items-start">
            {/* 2 across on phones (the last pack spans both), 3 across from tablets up */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              {TICKET_PACKAGES.map((pkg, i) => (
                <PackCard
                  key={pkg.tickets}
                  pkg={pkg}
                  dev={dev}
                  active={selected.tickets === pkg.tickets}
                  onSelect={() => setSelected(pkg)}
                  wide={i === TICKET_PACKAGES.length - 1 && TICKET_PACKAGES.length % 2 === 1}
                />
              ))}
            </div>

            {/* ── Checkout: sticky beside the packs on desktop, below them on phones ── */}
            <aside id="checkout" className="lg:sticky lg:top-20 scroll-mt-20">
              <div className="relative isolate rounded-2xl border border-white/[0.08] bg-[#070b14]/95 backdrop-blur-md shadow-2xl p-4 sm:p-5 space-y-4">
                <SilverRim />

                <div className="flex items-center gap-3">
                  <div className="w-16 h-12 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                    <img src={PACK_ART[selected.tickets]} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">{selected.name} pack</p>
                    <p className="text-sm font-bold text-white truncate">{selected.tickets} tickets</p>
                  </div>
                </div>

                {/* Readout */}
                <div className="rounded-xl bg-black/60 border border-white/[0.08] p-4 font-mono">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] mb-1">Tickets</p>
                      <span className="text-4xl xl:text-5xl font-black bg-gradient-to-r from-slate-100 via-white to-slate-400 bg-clip-text text-transparent leading-none">{selected.tickets}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] mb-1">Total</p>
                      {dev && <p className="text-xs text-slate-600 line-through leading-none mb-0.5">{usd(selected.freeTierPrice)}</p>}
                      <p className={`text-3xl xl:text-4xl font-black bg-clip-text text-transparent leading-none ${dev ? "bg-gradient-to-r from-violet-300 to-slate-100" : "bg-gradient-to-r from-slate-100 via-white to-slate-400"}`}>
                        {usd(price)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5 mt-3 flex-wrap">
                    <p className="text-[10px] text-slate-500">${ppt.toFixed(3)}&thinsp;/&thinsp;ticket</p>
                    {dev ? (
                      <span className="text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                        ✓ Dev Tier - save {usd(savings)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">
                        Dev Tier price: <span className="text-slate-300">{usd(selected.devTierPrice)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* TOS */}
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-white/[0.08] hover:border-white/20 transition-colors">
                  <input
                    type="checkbox"
                    checked={acceptedTOS}
                    onChange={e => setAcceptedTOS(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-900 text-slate-200 cursor-pointer flex-shrink-0 accent-white"
                  />
                  <span className="text-xs text-slate-500 leading-relaxed">
                    I agree to the{' '}
                    <a href="/terms" target="_blank" className="text-slate-300 hover:text-white underline decoration-slate-500 underline-offset-2">Terms of Service</a>
                    {', '}
                    <a href="/privacy" target="_blank" className="text-slate-300 hover:text-white underline decoration-slate-500 underline-offset-2">Privacy Policy</a>
                    {', and '}
                    <a href="/refund" target="_blank" className="text-slate-300 hover:text-white underline decoration-slate-500 underline-offset-2">Refund Policy</a>.
                    {' '}All ticket purchases are final and non-refundable. Images stored for 30 days.
                  </span>
                </label>

                {/* Dispense button */}
                {dispenserDown ? (
                  <div className="space-y-3">
                    <div className="w-full py-4 rounded-xl border border-amber-500/25 bg-amber-500/5 text-center cursor-not-allowed">
                      <p className="font-black text-base tracking-widest text-amber-400">COMING SOON</p>
                      <p className="text-[10px] font-normal mt-0.5 text-amber-400/50">Ticket purchasing is temporarily unavailable</p>
                    </div>
                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                      We&apos;re setting up a new payment system. Check back soon - your existing tickets are unaffected.
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
                      className={`relative overflow-hidden w-full py-4 rounded-xl font-black text-base tracking-widest transition-all border ${
                        !acceptedTOS
                          ? 'cursor-not-allowed bg-white/[0.02] border-white/[0.06] text-slate-600'
                          : purchasing
                          ? 'cursor-wait bg-white/[0.06] border-white/20 text-slate-300 animate-pulse'
                          : 'cursor-pointer bg-white/10 border-white/25 text-white hover:bg-white/15 hover:border-white/40 active:scale-[0.99]'
                      }`}
                    >
                      {acceptedTOS && !purchasing && (
                        <span
                          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none"
                          style={{ animation: "ticket-sheen 2.6s infinite" }}
                        />
                      )}
                      {purchasing ? 'REDIRECTING TO CHECKOUT…' : 'DISPENSE TICKETS'}
                      <span className={`block text-[10px] font-normal mt-0.5 tracking-normal ${
                        !acceptedTOS ? 'text-slate-700' : purchasing ? 'text-slate-500' : 'text-slate-400'
                      }`}>
                        {purchasing
                          ? 'Opening secure checkout…'
                          : !acceptedTOS
                          ? 'Accept the terms above to continue'
                          : `${selected.tickets} tickets · ${usd(price)}`}
                      </span>
                    </button>
                  </>
                )}

                {/* Trust strip */}
                <div className="flex flex-col items-center gap-1 text-[10px] text-slate-600 text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <Lock size={11} className="text-slate-500" />
                    Secure checkout by CCBill - card details never touch our servers
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={11} className="text-slate-500" />
                    18+ only · billed discreetly under CCBill&apos;s descriptor
                  </span>
                </div>
              </div>

              {/* Dev Tier upsell for non-subscribers */}
              {!dev && (
                <Link
                  href="/prompting-studio/subscribe"
                  className="mt-4 block rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-transparent p-4 hover:border-violet-400/40 transition-colors"
                >
                  <p className="text-sm font-bold text-violet-200">Make tickets go further</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Dev Tier plans include tickets every cycle at $0.08 each - and take 10% off every pack here.
                  </p>
                  <p className="text-xs font-bold text-violet-300 mt-2">See the plans →</p>
                </Link>
              )}
            </aside>
          </div>
        </section>

        {/* ── What your tickets make ── */}
        <section className="mt-12 sm:mt-16">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">What your tickets make</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 mb-4">One balance across the whole studio. Every model shows its price before you generate.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {SHOWCASE.map(s => (
              <div key={s.title} className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#070b14]">
                <div className="relative aspect-[4/3]">
                  {s.poster ? (
                    <LoopVideo src={s.src} poster={s.poster} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <img src={s.src} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#070b14] to-transparent" />
                </div>
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 -mt-4 relative">
                  <p className="text-sm sm:text-base font-bold text-white">{s.title}</p>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 leading-snug">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works + FAQ ── */}
        <section className="mt-12 sm:mt-16 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">How tickets work</h2>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
              {[
                { icon: <Layers size={16} />, t: "One currency", d: "The same tickets run every image, video, audio and studio model." },
                { icon: <Ticket size={16} />, t: "Priced up front", d: "Each model shows its ticket cost before you press generate." },
                { icon: <InfinityIcon size={16} />, t: "Yours to keep", d: "No expiry, and failed generations are refunded automatically." },
              ].map(f => (
                <div key={f.t} className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="mt-0.5 text-slate-300 flex-shrink-0">{f.icon}</div>
                  <div>
                    <p className="text-sm font-bold text-white">{f.t}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">Questions</h2>
            <div className="mt-4 space-y-2">
              {FAQ.map((item, i) => (
                <div key={item.q} className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    aria-expanded={openFaq === i}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-sm text-slate-200 font-medium">{item.q}</span>
                    <ChevronDown size={14} className={`text-slate-500 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-4 pb-3 text-xs sm:text-sm text-slate-400 leading-relaxed">{item.a}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <ShopFooter />
      </main>

      {/* ── Phones / tablets: the selection and a jump to checkout, always in reach ── */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#05080f]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-12 h-9 rounded-md overflow-hidden border border-white/10 flex-shrink-0">
            <img src={PACK_ART[selected.tickets]} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white leading-tight">{selected.tickets} tickets</p>
            <p className="text-[11px] text-slate-400 leading-tight">
              {usd(price)} · ${ppt.toFixed(3)}/ticket
            </p>
          </div>
          <button
            onClick={goToCheckout}
            className="px-4 py-2.5 rounded-xl bg-white text-black text-sm font-black tracking-wide active:scale-[0.98] transition-transform flex-shrink-0"
          >
            Checkout
          </button>
        </div>
      </div>
    </div>
  )
}
