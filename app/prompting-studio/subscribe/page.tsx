'use client';

// Development Tier subscribe page - redesigned 2026-10-04 to match the shop
// (/buy-tickets): full width at every screen size, a looping hero, one card
// per plan with its own metal-card art, and a checkout panel that sits beside
// the plans on desktop and below them (with a sticky bar) on phones.
//
// Checkout is CCBill-ready: the page asks /api/ccbill/checkout (GET) whether
// the processor is configured - until the CCBill env vars exist it shows the
// "coming soon" state, and the moment they're set the same build starts
// selling. The client only ever sends a plan id; all pricing, periods and the
// signed FlexForm URL are produced server-side from the same catalog this page
// renders (lib/dev-tier-plans.ts).

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Check, Zap, Crown, Ticket, ShieldCheck, Lock, Sparkles, ChevronDown,
  Layers, BookMarked, FlaskRound, Wand2, Infinity as InfinityIcon, CalendarClock,
} from 'lucide-react';
import { CCBILL_PLANS, planUsdPerTicket, type CcbillPlan, type CcbillPlanId } from '@/lib/dev-tier-plans';
import { SilverRim, LoopVideo, ShopHeader, ShopBackdrop, ShopFooter, SHOP_MEDIA } from '@/components/shop/ShopKit';

interface UserData {
  id: number;
  email: string;
}

/*
 * Page visuals (2026-10-04), made on the site on the promptandprotocol@gmail.com
 * account: metal membership cards with the real site logo (NanoBanana 2 edits),
 * one finish per plan - brushed aluminium, mirror silver, graphite black
 * chrome, glowing platinum - and a black-chrome hero card animated by
 * SeeDance 2.5 (1080p, locked camera, first frame = last frame).
 */
const HERO_POSTER = `${SHOP_MEDIA}/sub/hero-8ef21abc-8005-4df3-9c0c-c7a4f091cfb7.webp`;
const HERO_VIDEO: string | null = `${SHOP_MEDIA}/sub/hero-loop-1fc997d8-9b8f-439d-8f97-fb7a5532d927.mp4`;
const PLAN_ART: Record<CcbillPlanId, string> = {
  creator: `${SHOP_MEDIA}/sub/creator-01e97508-07a2-477d-861a-83d9e52d1023.webp`,
  pro:     `${SHOP_MEDIA}/sub/pro-ce1f8eb8-cfeb-499d-a7a1-72978292a443.webp`,
  studio:  `${SHOP_MEDIA}/sub/studio-a2589590-9079-4b86-80d7-ca0fa98159c4.webp`,
  max:     `${SHOP_MEDIA}/sub/max-5bbe0716-dff8-4551-899b-7d53762eefa6.webp`,
};
// Display-only extras per plan (the catalog itself is shared with the server)
const PLAN_META: Record<CcbillPlanId, { blurb: string; badge?: string }> = {
  creator: { blurb: 'For steady weekly creating.' },
  pro:     { blurb: 'Room for daily images and the odd video.', badge: 'MOST POPULAR' },
  studio:  { blurb: 'For video-heavy projects and big batches.' },
  max:     { blurb: 'The most tickets one monthly charge allows.', badge: 'MOST TICKETS' },
};
const DEFAULT_PLAN: CcbillPlanId = 'pro';

const usd = (n: number) => `$${n.toFixed(2)}`;
const MIN_PRICE = Math.min(...CCBILL_PLANS.map(p => p.price));
const MIN_TICKETS = Math.min(...CCBILL_PLANS.map(p => p.tickets));
const MAX_TICKETS = Math.max(...CCBILL_PLANS.map(p => p.tickets));

// What changes between Free and Dev Tier (and what doesn't). Every plan
// carries the same Dev Tier benefits; plans differ by tickets per month.
const TIER_COMPARISON: { feature: string; free: string; dev: string; devWins: boolean }[] = [
  { feature: 'Monthly tickets',         free: '—',             dev: `${MIN_TICKETS.toLocaleString()}–${MAX_TICKETS.toLocaleString()} delivered every month`, devWins: true },
  { feature: 'Ticket packs',            free: 'Standard price', dev: '10% off every pack',                devWins: true },
  { feature: 'Concurrent generations',  free: '2 at a time',    dev: '8 at a time (6 image + 2 video)',   devWins: true },
  { feature: 'Reference library',       free: '50 slots',       dev: '250 slots + folders',               devWins: true },
  { feature: 'AI prompt generation',    free: '—',              dev: 'Included',                          devWins: true },
  { feature: 'Experimental features',   free: '—',              dev: 'Early access',                      devWins: true },
  { feature: 'Image, video & audio models', free: 'Every model', dev: 'Every model',                      devWins: false },
  { feature: 'Tickets expire?',         free: 'Never',          dev: 'Never',                             devWins: false },
];

const DEV_TIER_FEATURES = [
  { icon: CalendarClock, title: 'Tickets on autopilot', text: 'Fresh tickets land every month - and they never expire.' },
  { icon: Ticket,        title: '10% off every pack',   text: 'Top up any time from the Ticket Dispenser for less.' },
  { icon: Layers,        title: '4× the capacity',      text: '8 generations at once: 6 image + 2 video.' },
  { icon: BookMarked,    title: '5× the references',    text: '250 reference slots, organised in folders.' },
  { icon: Sparkles,      title: 'AI prompt generation', text: 'Turn a rough idea into a detailed prompt.' },
  { icon: FlaskRound,    title: 'Early access',         text: 'Try experimental features before anyone else.' },
];

const FAQ = [
  {
    q: 'Which plan should I pick?',
    a: 'Every plan has the same Dev Tier benefits and the same $0.08 a ticket - the only difference is how many tickets arrive each month. Pick the one closest to what you use; you can always top up with a pack at 10% off.',
  },
  {
    q: 'How does billing work?',
    a: 'Your plan renews automatically every month and your tickets are credited the moment payment clears. Payments are processed securely by CCBill, our authorized payment processor - the charge on your statement will show CCBill’s billing descriptor.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from your account settings (or through CCBill’s support portal) and you keep every benefit until the end of the period you already paid for. Tickets you’ve received are yours and never expire.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes - cancel your current plan, and choose a new one once the period you have already paid for ends.',
  },
  {
    q: 'What happens to unused tickets?',
    a: 'Nothing - tickets never expire. They stay on your account even if you cancel.',
  },
  {
    q: 'Is my payment information safe?',
    a: 'We never see or store your card details. Checkout happens on CCBill’s PCI-DSS compliant secure payment page, and your card data never touches our servers.',
  },
];

// Frosted primary button with the site's animated sheen sweep
function SheenButton({ children, onClick, disabled = false, className = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative overflow-hidden rounded-xl font-bold transition-all ${
        disabled
          ? 'bg-white/5 border border-white/10 text-slate-600 cursor-not-allowed'
          : 'bg-white/10 border border-white/25 text-white hover:bg-white/15 hover:border-white/40'
      } ${className}`}
    >
      {!disabled && (
        <span
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
          style={{ animation: 'sheen-sweep 2.6s infinite' }}
        />
      )}
      {children}
    </button>
  );
}

/** The looping hero: the clip fills the panel on desktop, sits above the copy on phones. */
function Hero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
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
        <p className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.3em] text-slate-400">{eyebrow}</p>
        <h1 className="mt-2 text-3xl sm:text-5xl xl:text-6xl font-black tracking-tight leading-[1.05] bg-gradient-to-r from-slate-100 via-white to-slate-400 bg-clip-text text-transparent">
          {title}
        </h1>
        {children}
      </div>
    </section>
  );
}

function PlanCard({ plan, active, onSelect }: { plan: CcbillPlan; active: boolean; onSelect: () => void }) {
  const meta = PLAN_META[plan.id];
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative isolate text-left rounded-2xl overflow-hidden border transition-all duration-200 bg-[#070b14] ${
        active
          ? 'border-white/30 shadow-[0_0_40px_-12px_rgba(226,232,240,0.45)] -translate-y-0.5'
          : 'border-white/[0.08] hover:border-white/25 hover:-translate-y-0.5'
      }`}
    >
      {active && <SilverRim />}
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={PLAN_ART[plan.id]}
          alt=""
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${active ? 'scale-[1.04]' : 'group-hover:scale-[1.03]'}`}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#070b14] to-transparent" />
        {meta.badge && (
          <span className={`absolute top-2 left-2 text-[9px] sm:text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full ${
            meta.badge === 'MOST POPULAR'
              ? 'bg-white text-slate-900'
              : 'bg-gradient-to-r from-slate-100 to-slate-400 text-black'
          }`}>
            {meta.badge}
          </span>
        )}
        {active && (
          <span className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            <Check size={14} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="px-3 sm:px-4 pb-3 sm:pb-4 -mt-3 relative">
        <p className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.2em] text-slate-400">{plan.name}</p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className={`text-2xl sm:text-3xl font-black leading-none ${active ? 'text-white' : 'bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent'}`}>
            {usd(plan.price)}
          </span>
          <span className="text-[11px] sm:text-xs text-slate-500">/mo</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-200 font-semibold">
          <Ticket size={12} className="text-slate-300 flex-shrink-0" />
          {plan.tickets.toLocaleString()} tickets / month
        </div>
        <p className="hidden sm:block text-[11px] text-slate-500 mt-1 leading-snug">{meta.blurb}</p>
      </div>
    </button>
  );
}

export default function SubscribePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptedTOS, setAcceptedTOS] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [subscriptionDetails, setSubscriptionDetails] = useState<{
    status?: string | null;
    billingCycle?: string | null;
    nextBillingDate?: string | null;
    endDate?: string | null;
    startDate?: string | null;
    lsCurrentPeriodEnd?: string | null;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<CcbillPlanId>(DEFAULT_PLAN);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [checkoutReady, setCheckoutReady] = useState<boolean | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    checkAuth();
    // ?plan=<id> (the shop dropdown's quick picks) preselects that plan
    const wanted = new URLSearchParams(window.location.search).get('plan');
    const match = CCBILL_PLANS.find(p => p.id === wanted);
    if (match) setSelectedId(match.id);
    // Is the payment processor configured yet? (CCBill env vars server-side)
    fetch('/api/ccbill/checkout')
      .then(r => r.json())
      .then(d => setCheckoutReady(!!d.configured))
      .catch(() => setCheckoutReady(false));
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();

      if (!data.authenticated) {
        router.push('/login');
        return;
      }

      setUser(data.user);

      const subRes = await fetch('/api/user/subscription');
      const subData = await subRes.json();
      if (subData.success && subData.hasPromptStudioDev) {
        setHasSubscription(true);
        if (subData.subscription) setSubscriptionDetails(subData.subscription);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const selectedPlan = CCBILL_PLANS.find(p => p.id === selectedId) ?? CCBILL_PLANS[0];

  const handleSubscribe = async () => {
    if (!acceptedTOS || purchasing || !checkoutReady) return;
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const res = await fetch('/api/ccbill/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlan.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setPurchaseError(err.message || 'Something went wrong. Please try again.');
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-slate-700 border-t-slate-300 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const headerRight = (
    <>
      <Link
        href="/buy-tickets"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all"
      >
        <Ticket size={13} />
        <span className="hidden sm:inline">Buy tickets</span>
      </Link>
      <Link
        href="/admin/portal-v2"
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white hover:border-white/20 transition-all"
      >
        <Wand2 size={13} />
        Studio
      </Link>
    </>
  );

  // ── Active / cancelled-within-period status view ──────────────────────────
  if (hasSubscription) {
    const cycleLabel: Record<string, string> = {
      biweekly: 'Biweekly',
      monthly: 'Monthly',
      yearly: 'Yearly',
    };
    const isCancelled = subscriptionDetails?.status === 'cancelled';
    const accessUntil = subscriptionDetails?.lsCurrentPeriodEnd || subscriptionDetails?.endDate;
    const renewDate = isCancelled ? accessUntil : (subscriptionDetails?.nextBillingDate || subscriptionDetails?.endDate);
    const formattedRenew = renewDate
      ? new Date(renewDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    const cycle = subscriptionDetails?.billingCycle || null;

    return (
      <div className="min-h-screen bg-[#05080f] text-white relative overflow-x-hidden">
        <style>{`@keyframes sheen-sweep { 0% { transform: translateX(-150%) } 100% { transform: translateX(400%) } }`}</style>
        <ShopBackdrop />
        <ShopHeader title="Dev Tier" right={headerRight} />
        <main className="relative z-10 max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-16">
          <Hero eyebrow="Development Tier" title={isCancelled ? 'Still on until the end.' : 'You’re on Dev Tier.'}>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isCancelled ? (
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">Cancelled</span>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">Active</span>
              )}
              <span className="text-sm text-slate-300">
                {cycle ? `${cycleLabel[cycle] ?? cycle} plan` : 'Subscription plan'}
                {formattedRenew && (isCancelled ? ` · Access until ${formattedRenew}` : ` · Renews ${formattedRenew}`)}
              </span>
            </div>
            {isCancelled && (
              <p className="text-xs text-amber-500/80 mt-2">Your benefits remain active until the end of your billing period.</p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/admin/portal-v2">
                <SheenButton className="px-5 py-2.5 text-sm">Go to Studio</SheenButton>
              </Link>
              {isCancelled ? (
                <button
                  onClick={() => setHasSubscription(false)}
                  className="px-5 py-2.5 rounded-xl border border-white/25 bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-all"
                >
                  Re-subscribe
                </button>
              ) : (
                <Link href="/subscriptions">
                  <button className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-slate-300 hover:text-white text-sm font-semibold transition-all">
                    Manage Subscription
                  </button>
                </Link>
              )}
              {/* Browse the plan ladder (checkout still refuses a second subscription server-side) */}
              {!isCancelled && (
                <button
                  onClick={() => setHasSubscription(false)}
                  className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-slate-300 hover:text-white text-sm font-semibold transition-all"
                >
                  See all plans
                </button>
              )}
            </div>
          </Hero>

          <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
              {[
                { value: '10%', label: 'off every ticket pack' },
                { value: '8×', label: 'concurrent generations' },
                { value: '5×', label: 'reference library slots' },
              ].map(({ value, label }) => (
                <div key={label} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-center lg:text-left">
                  <div className="text-2xl sm:text-3xl font-black text-white">{value}</div>
                  <div className="text-[10px] sm:text-xs text-slate-500 leading-tight mt-1">{label}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Your active benefits</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {DEV_TIER_FEATURES.map(f => (
                  <div key={f.title} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center flex-shrink-0">
                      <f.icon size={15} className="text-slate-200" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{f.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <ShopFooter />
        </main>
      </div>
    );
  }

  // ── Checkout view ──────────────────────────────────────────────────────────
  const goToCheckout = () => document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-screen bg-[#05080f] text-white relative overflow-x-hidden">
      <style>{`@keyframes sheen-sweep { 0% { transform: translateX(-150%) } 100% { transform: translateX(400%) } }`}</style>
      <ShopBackdrop />
      <ShopHeader title="Dev Tier" right={headerRight} />

      <main className="relative z-10 max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 sm:pt-8 pb-28 lg:pb-16">
        <Hero eyebrow="Development Tier · monthly plans" title="Create on autopilot.">
          <p className="mt-3 sm:mt-4 text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
            Fresh tickets every month, 10% off every pack, four times the generations at once and a five times
            bigger reference library. Cancel anytime.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { icon: <Crown size={12} />, t: `From ${usd(MIN_PRICE)} a month` },
              { icon: <Ticket size={12} />, t: '$0.08 a ticket on every plan' },
              { icon: <InfinityIcon size={12} />, t: 'Tickets never expire' },
            ].map(c => (
              <span key={c.t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.05] text-[11px] sm:text-xs text-slate-200 backdrop-blur">
                {c.icon} {c.t}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            Subscribing as <span className="text-slate-300 font-semibold">{user.email}</span>
          </p>
        </Hero>

        {/* ── Plans + checkout ── */}
        <section className="mt-8 sm:mt-10">
          <div className="mb-4">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">Choose your plan</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Same benefits on every plan - pick how many tickets you want each month.</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] items-start">
            <div className="grid grid-cols-2 2xl:grid-cols-4 gap-3 sm:gap-4">
              {CCBILL_PLANS.map(plan => (
                <PlanCard key={plan.id} plan={plan} active={plan.id === selectedId} onSelect={() => setSelectedId(plan.id)} />
              ))}
            </div>

            {/* ── Checkout: sticky beside the plans on desktop, below them on phones ── */}
            <aside id="checkout" className="lg:sticky lg:top-20 scroll-mt-20">
              <div className="relative isolate rounded-2xl border border-white/[0.08] bg-[#070b14]/95 backdrop-blur-md shadow-2xl p-4 sm:p-5 space-y-4">
                <SilverRim />

                <div className="flex items-center gap-3">
                  <div className="w-16 h-12 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                    <img src={PLAN_ART[selectedPlan.id]} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">Dev Tier</p>
                    <p className="text-sm font-bold text-white truncate">{selectedPlan.name} plan</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-white leading-none">{usd(selectedPlan.price)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">per month</p>
                  </div>
                </div>

                <div className="rounded-xl bg-white/[0.05] border border-white/15 p-3">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-slate-200" />
                    <span className="text-sm font-bold text-white">{selectedPlan.tickets.toLocaleString()} tickets every month</span>
                  </div>
                  <p className="text-[11px] text-slate-400 pl-6 mt-0.5">
                    ${planUsdPerTicket(selectedPlan).toFixed(3)} a ticket · credited every cycle · never expire
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
                  {['10% off every pack', '8 generations at once', '250 reference slots', 'Cancel anytime'].map(t => (
                    <div key={t} className="flex items-center gap-1.5">
                      <Check size={12} className="text-white shrink-0" />
                      <span>{t}</span>
                    </div>
                  ))}
                </div>

                {/* Consent */}
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-white/[0.08] hover:border-white/20 transition-colors">
                  <input
                    type="checkbox"
                    checked={acceptedTOS}
                    onChange={(e) => setAcceptedTOS(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-white cursor-pointer flex-shrink-0"
                  />
                  <span className="text-xs text-slate-400 leading-relaxed">
                    I am at least 18 years old and agree to the{' '}
                    <a href="/terms" target="_blank" className="text-slate-200 underline">Terms of Service</a>
                    {', '}
                    <a href="/privacy" target="_blank" className="text-slate-200 underline">Privacy Policy</a>
                    {', and '}
                    <a href="/refund" target="_blank" className="text-slate-200 underline">Refund Policy</a>
                    . I understand this subscription auto-renews every month until cancelled, and
                    that I can cancel anytime from account settings.
                  </span>
                </label>

                {purchaseError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {purchaseError}
                  </div>
                )}

                {/* Checkout button / coming-soon state */}
                {checkoutReady ? (
                  <SheenButton
                    onClick={handleSubscribe}
                    disabled={!acceptedTOS || purchasing}
                    className="w-full py-4 text-base tracking-wide"
                  >
                    {purchasing ? 'Redirecting to secure checkout…' : `Subscribe — ${usd(selectedPlan.price)} / month`}
                  </SheenButton>
                ) : (
                  <div className="space-y-2">
                    <div className="w-full py-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-center cursor-not-allowed">
                      <p className="font-black text-base tracking-widest text-amber-400">COMING SOON</p>
                      <p className="text-[10px] font-normal mt-0.5 text-amber-400/50">Subscriptions are temporarily unavailable</p>
                    </div>
                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                      We&apos;re finalizing our new payment system. Check back soon — your existing tickets and benefits are unaffected.
                    </p>
                  </div>
                )}

                {/* Trust strip */}
                <div className="flex flex-col items-center gap-1 text-[10px] text-slate-600 text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <Lock size={11} className="text-slate-500" />
                    Secure checkout by CCBill — card details never touch our servers
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={11} className="text-slate-500" />
                    18+ only · billed discreetly under CCBill&apos;s descriptor
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* ── Everything in every plan ── */}
        <section className="mt-12 sm:mt-16">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">Everything in every plan</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 mb-4">Dev Tier upgrades your capacity, pricing and workflow - whichever plan you pick.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {DEV_TIER_FEATURES.map(f => (
              <div key={f.title} className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center flex-shrink-0">
                  <f.icon size={16} className="text-slate-200" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{f.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Free vs Dev Tier + FAQ ── */}
        <section className="mt-12 sm:mt-16 grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-4">Free vs Dev Tier</h2>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
              <div className="grid grid-cols-[1.1fr_0.9fr_1.3fr] border-b border-white/10">
                <div className="px-3 sm:px-4 py-3.5 flex items-center">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-slate-500">Feature</span>
                </div>
                <div className="px-2 sm:px-3 py-3.5 text-center border-l border-white/5">
                  <div className="text-xs sm:text-sm font-black text-slate-400">FREE</div>
                </div>
                <div className="px-2 sm:px-3 py-3.5 text-center border-l border-white/15 bg-white/[0.05]">
                  <div className="flex items-center justify-center gap-1.5">
                    <Crown size={13} className="text-slate-200" />
                    <span className="text-xs sm:text-sm font-black text-white">DEV TIER</span>
                  </div>
                </div>
              </div>
              {TIER_COMPARISON.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[1.1fr_0.9fr_1.3fr] ${i % 2 === 0 ? 'bg-white/[0.015]' : ''} ${
                    i < TIER_COMPARISON.length - 1 ? 'border-b border-white/5' : ''
                  }`}
                >
                  <div className="px-3 sm:px-4 py-3 flex items-center">
                    <span className="text-[11px] sm:text-sm text-slate-300 font-medium leading-snug">{row.feature}</span>
                  </div>
                  <div className="px-2 sm:px-3 py-3 flex items-center justify-center text-center border-l border-white/5">
                    <span className={`text-[10px] sm:text-xs leading-snug ${row.free === '—' ? 'text-slate-700' : 'text-slate-500'}`}>{row.free}</span>
                  </div>
                  <div className={`px-2 sm:px-3 py-3 flex items-center justify-center gap-1.5 text-center border-l ${
                    row.devWins ? 'border-white/10 bg-white/[0.04]' : 'border-white/5'
                  }`}>
                    {row.devWins && <Check size={12} className="text-white shrink-0 hidden sm:block" />}
                    <span className={`text-[10px] sm:text-xs leading-snug ${row.devWins ? 'text-white font-semibold' : 'text-slate-500'}`}>{row.dev}</span>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 border-t border-white/10 bg-black/30">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Nothing is taken away on free</span> — every AI model and the full studio stay available.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-4">Questions</h2>
            <div className="space-y-2">
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
            <img src={PLAN_ART[selectedPlan.id]} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white leading-tight">{selectedPlan.name} · {usd(selectedPlan.price)}/mo</p>
            <p className="text-[11px] text-slate-400 leading-tight">{selectedPlan.tickets.toLocaleString()} tickets every month</p>
          </div>
          <button
            onClick={goToCheckout}
            className="px-4 py-2.5 rounded-xl bg-white text-black text-sm font-black tracking-wide active:scale-[0.98] transition-transform flex-shrink-0"
          >
            Subscribe
          </button>
        </div>
      </div>
    </div>
  );
}
