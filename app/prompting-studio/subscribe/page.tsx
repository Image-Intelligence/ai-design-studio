'use client';

// Development Tier subscribe page — monochrome brand design (SiteBrandHero,
// frosted cards, sheen CTAs, animated silver rim on the flagship plan).
// Checkout is CCBill-ready: the page asks /api/ccbill/checkout (GET) whether
// the processor is configured — until the CCBill env vars exist it shows the
// "coming soon" state, and the moment they're set the same build starts
// selling. The client only ever sends a plan id; all pricing, periods and
// the signed FlexForm URL are produced server-side.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FlaskRound, Check, Zap, Crown, Ticket, ShieldCheck,
  Lock, ImageIcon, Clapperboard, BookMarked, Sparkles, ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader';

interface UserData {
  id: number;
  email: string;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  tickets: number;
  interval: 'biweekly' | 'monthly';
  intervalLabel: string;
  ticketNote: string;
  popular?: boolean;
}

// Display catalog — must mirror CCBILL_PLANS in lib/ccbill.ts (the server
// list is authoritative; this one only renders)
const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'biweekly',
    name: 'Biweekly',
    price: 20,
    tickets: 250,
    interval: 'biweekly',
    intervalLabel: 'every 2 weeks',
    ticketNote: '250 tickets every 2 weeks',
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: 40,
    tickets: 500,
    interval: 'monthly',
    intervalLabel: 'per month',
    ticketNote: '500 tickets every month',
    popular: true,
  },
];

// The hero comparison — what changes between tiers (and what doesn't)
const TIER_COMPARISON: { feature: string; free: string; dev: string; devWins: boolean }[] = [
  { feature: 'Ticket pricing',          free: 'Standard',       dev: '10% off every package',            devWins: true },
  { feature: 'Tickets on autopilot',    free: '—',              dev: '250–500 auto-delivered per cycle', devWins: true },
  { feature: 'Concurrent generations',  free: '2 at a time',    dev: '8 at a time (6 image + 2 video)',  devWins: true },
  { feature: 'Reference library',       free: '50 slots',       dev: '250 slots + folders',              devWins: true },
  { feature: 'AI prompt generation',    free: '—',              dev: 'Included (Gemini-powered)',        devWins: true },
  { feature: 'Experimental features',   free: '—',              dev: 'Early access',                     devWins: true },
  { feature: 'Image & video models',    free: 'Every model',    dev: 'Every model',                      devWins: false },
  { feature: 'Tickets expire?',         free: 'Never',          dev: 'Never',                            devWins: false },
];

const DEV_TIER_FEATURES = [
  { icon: Ticket, text: '10% off every ticket package, forever while subscribed', highlight: true },
  { icon: Zap, text: 'Tickets auto-delivered each billing cycle — they never expire', highlight: true },
  { icon: Sparkles, text: '8 concurrent generations (6 image + 2 video) — 4× the free tier', highlight: true },
  { icon: BookMarked, text: '250 reference library slots with folders (5× the free tier)', highlight: true },
  { icon: ImageIcon, text: 'Every image model: NanoBanana Pro 2, SeeDream 4.5, FLUX-2, GPT Images 2, Kling', highlight: false },
  { icon: Clapperboard, text: 'Every video model: SeeDance 2.0, Kling 3.0, Wan 2.7 and more', highlight: false },
  { icon: FlaskRound, text: 'AI-powered prompt generation + early access to experimental features', highlight: false },
];

const FAQ = [
  {
    q: 'How does billing work?',
    a: 'Your plan renews automatically each cycle and your tickets are credited the moment payment clears. Payments are processed securely by CCBill, our authorized payment processor — the charge on your statement will show CCBill’s billing descriptor.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from your account settings (or through CCBill’s support portal) and you keep every benefit until the end of the period you already paid for. Tickets you’ve received are yours and never expire.',
  },
  {
    q: 'What happens to unused tickets?',
    a: 'Nothing — tickets never expire. They stay on your account even if you cancel.',
  },
  {
    q: 'Is my payment information safe?',
    a: 'We never see or store your card details. Checkout happens on CCBill’s PCI-DSS compliant secure payment page, and your card data never touches our servers.',
  },
];

const SILVER_CONIC =
  'conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))';

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
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [checkoutReady, setCheckoutReady] = useState<boolean | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    checkAuth();
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

  const handleSubscribe = async () => {
    if (!acceptedTOS || !selectedPlan || purchasing || !checkoutReady) return;
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
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-slate-700 border-t-slate-300 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

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
      <div className="min-h-screen bg-[#050810] text-white">
        <SitePageHeader />
        <div className="max-w-3xl mx-auto px-4 py-10">
          <SiteBrandHero />

          {/* Status header */}
          <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
              <Crown size={16} className="text-slate-200 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold text-white tracking-tight">Development Tier</h1>
                  {isCancelled ? (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                      Cancelled
                    </span>
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  {cycle ? `${cycleLabel[cycle] ?? cycle} plan` : 'Subscription plan'}
                  {formattedRenew && (isCancelled ? ` · Access until ${formattedRenew}` : ` · Renews ${formattedRenew}`)}
                </p>
                {isCancelled && (
                  <p className="text-[11px] text-amber-500/80 mt-1">Your benefits remain active until the end of your billing period.</p>
                )}
              </div>
            </div>

            {/* Stat trio */}
            <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.06]">
              {[
                { value: '10%', label: 'off all ticket purchases' },
                { value: '8×', label: 'concurrent generations' },
                { value: '5×', label: 'reference library slots' },
              ].map(({ value, label }) => (
                <div key={label} className="p-4 text-center">
                  <div className="text-2xl font-black text-white mb-1">{value}</div>
                  <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
                </div>
              ))}
            </div>

            {/* Benefits */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-slate-500 mb-3">Your Active Benefits</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {DEV_TIER_FEATURES.map((f) => (
                  <div key={f.text} className="flex items-start gap-2.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      f.highlight ? 'bg-white/15 border border-white/30' : 'bg-white/5 border border-white/10'
                    }`}>
                      <Check size={9} className={f.highlight ? 'text-white' : 'text-slate-600'} />
                    </div>
                    <span className={`text-[13px] leading-snug ${f.highlight ? 'text-white font-medium' : 'text-slate-500'}`}>
                      {f.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-white/[0.06] bg-black/30">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                <span className="text-slate-300 font-semibold">Free tier features are also included</span> — the full studio, all AI models, and 2 concurrent generations.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/admin/portal-v2">
              <SheenButton className="px-5 py-2.5 text-sm">Go to Studio</SheenButton>
            </Link>
            <Link href="/dashboard">
              <button className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-slate-300 hover:text-white text-sm font-semibold transition-all">
                Dashboard
              </button>
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
          </div>
        </div>
      </div>
    );
  }

  // ── Checkout view ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#050810] text-white">
      <SitePageHeader />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <SiteBrandHero />

        <div className="text-center mt-6 mb-10">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Development Tier</h1>
          <p className="text-slate-400 text-sm max-w-2xl mx-auto mt-2">
            Discounted tickets on autopilot, 8 concurrent generations, a bigger reference
            library, and every model in the studio.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03]">
            <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
              <span className="text-white font-bold text-[11px]">{user.email?.[0]?.toUpperCase() || '?'}</span>
            </div>
            <span className="text-xs text-slate-400">Subscribing as <span className="text-white font-semibold">{user.email}</span></span>
          </div>
        </div>

        {!selectedPlan ? (
          <>
            {/* ── Main display: Free vs Dev Tier ─────────────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden mb-8">
              {/* Column headers */}
              <div className="grid grid-cols-[1.1fr_1fr_1.3fr] border-b border-white/10">
                <div className="px-4 py-3.5 flex items-center">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-slate-500">What you get</span>
                </div>
                <div className="px-3 py-3.5 text-center border-l border-white/5">
                  <div className="text-sm font-black text-slate-400">FREE</div>
                  <div className="text-[9px] text-slate-600">what you have now</div>
                </div>
                <div className="px-3 py-3.5 text-center border-l border-white/15 bg-white/[0.05]">
                  <div className="flex items-center justify-center gap-1.5">
                    <Crown size={13} className="text-slate-200" />
                    <span className="text-sm font-black text-white">DEV TIER</span>
                  </div>
                  <div className="text-[9px] text-slate-500">from $20 · cancel anytime</div>
                </div>
              </div>
              {/* Rows */}
              {TIER_COMPARISON.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[1.1fr_1fr_1.3fr] ${i % 2 === 0 ? 'bg-white/[0.015]' : ''} ${
                    i < TIER_COMPARISON.length - 1 ? 'border-b border-white/5' : ''
                  }`}
                >
                  <div className="px-4 py-3 flex items-center">
                    <span className="text-xs sm:text-sm text-slate-300 font-medium leading-snug">{row.feature}</span>
                  </div>
                  <div className="px-3 py-3 flex items-center justify-center text-center border-l border-white/5">
                    <span className={`text-[11px] sm:text-xs leading-snug ${row.free === '—' ? 'text-slate-700' : 'text-slate-500'}`}>
                      {row.free}
                    </span>
                  </div>
                  <div className={`px-3 py-3 flex items-center justify-center gap-1.5 text-center border-l ${
                    row.devWins ? 'border-white/10 bg-white/[0.04]' : 'border-white/5'
                  }`}>
                    {row.devWins && <Check size={12} className="text-white shrink-0" />}
                    <span className={`text-[11px] sm:text-xs leading-snug ${row.devWins ? 'text-white font-semibold' : 'text-slate-500'}`}>
                      {row.dev}
                    </span>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 border-t border-white/10 bg-black/30">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Nothing is taken away on free</span> — every AI model and the
                  full studio stay available. Dev Tier upgrades your capacity, pricing and workflow.
                </p>
              </div>
            </div>

            {/* ── Plans ──────────────────────────────────────────────────── */}
            <h3 className="text-[11px] font-mono font-semibold text-slate-500 uppercase tracking-[0.2em] mb-3 text-center">Choose your plan</h3>
            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-12">
              {SUBSCRIPTION_PLANS.map((plan) => {
                const card = (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className={`relative w-full text-left p-5 transition-all group ${
                      plan.popular
                        ? 'rounded-[14px] bg-[#0a0f1a] hover:bg-[#0d1322]'
                        : 'rounded-2xl border border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    {plan.popular && (
                      <span className="absolute -top-2.5 left-4 text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full bg-white text-slate-900 z-10">
                        MOST POPULAR
                      </span>
                    )}

                    <div className="text-sm font-bold text-slate-300 mb-1">{plan.name}</div>
                    <div className="flex items-baseline gap-1 mb-0.5">
                      <span className="text-3xl font-black text-white">${plan.price}</span>
                      <span className="text-xs text-slate-500">{plan.intervalLabel}</span>
                    </div>

                    <div className="mt-3 p-2.5 rounded-lg bg-white/[0.05] border border-white/15">
                      <div className="flex items-center gap-2">
                        <Ticket size={13} className="text-slate-200 shrink-0" />
                        <span className="text-xs text-white font-bold">{plan.ticketNote}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 pl-5">Auto-delivered · never expire</p>
                    </div>

                    <div className={`mt-4 w-full py-2 rounded-lg text-center text-xs font-bold transition-colors ${
                      plan.popular
                        ? 'bg-white/15 text-white group-hover:bg-white/20'
                        : 'bg-white/5 text-slate-300 group-hover:bg-white/10'
                    }`}>
                      Select {plan.name}
                    </div>
                  </button>
                );
                // The flagship plan gets the animated silver rim
                return plan.popular ? (
                  <div key={plan.id} className="relative rounded-2xl overflow-visible">
                    <div className="relative isolate rounded-2xl overflow-hidden p-[1.5px]">
                      <span
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[300%] animate-spin pointer-events-none -z-10"
                        style={{ background: SILVER_CONIC, animationDuration: '5s' }}
                      />
                      {card}
                    </div>
                  </div>
                ) : card;
              })}
            </div>
          </>
        ) : (
          /* ── Checkout summary for the selected plan ── */
          <div className="max-w-xl mx-auto">
            <div className="p-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] mb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Order Summary</h3>
                <button
                  onClick={() => { setSelectedPlan(null); setPurchaseError(null); }}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Change Plan
                </button>
              </div>

              <div className="mb-4 pb-4 border-b border-white/[0.08] flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{selectedPlan.name} Plan</p>
                  <p className="text-xs text-slate-500 mt-0.5">Auto-renews {selectedPlan.intervalLabel} · cancel anytime</p>
                </div>
                <p className="text-3xl font-black text-white">${selectedPlan.price}</p>
              </div>

              <div className="mb-4 p-3 rounded-lg bg-white/[0.05] border border-white/15">
                <div className="flex items-center gap-2 mb-0.5">
                  <Zap size={14} className="text-slate-200" />
                  <span className="text-sm font-bold text-white">{selectedPlan.ticketNote}</span>
                </div>
                <p className="text-[11px] text-slate-400 pl-6">
                  Credited automatically every billing cycle — plus all Dev Tier benefits.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                {['Cancel anytime', 'Instant activation', 'Tickets never expire'].map(t => (
                  <div key={t} className="flex items-center gap-1.5">
                    <Check size={12} className="text-white shrink-0" />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Consent */}
            <div className="mb-4 p-4 rounded-xl border border-white/[0.08] bg-black/20">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTOS}
                  onChange={(e) => setAcceptedTOS(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-white cursor-pointer"
                />
                <span className="text-xs text-slate-300 leading-relaxed">
                  I am at least 18 years old and agree to the{' '}
                  <a href="/terms" target="_blank" className="text-white underline">Terms of Service</a>
                  {', '}
                  <a href="/privacy" target="_blank" className="text-white underline">Privacy Policy</a>
                  {', and '}
                  <a href="/refund" target="_blank" className="text-white underline">Refund Policy</a>
                  . I understand this subscription auto-renews {selectedPlan.intervalLabel} until cancelled, and
                  that I can cancel anytime from account settings.
                </span>
              </label>
            </div>

            {purchaseError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
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
                {purchasing ? 'Redirecting to secure checkout…' : `Subscribe — $${selectedPlan.price} ${selectedPlan.intervalLabel}`}
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
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[10px] text-slate-600">
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
        )}

        {/* FAQ */}
        <div className="max-w-2xl mx-auto mt-4">
          <h3 className="text-[11px] font-mono font-semibold text-slate-500 uppercase tracking-[0.2em] mb-3">FAQ</h3>
          <div className="space-y-2">
            {FAQ.map((item, i) => (
              <div key={item.q} className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm text-slate-200 font-medium">{item.q}</span>
                  <ChevronDown size={14} className={`text-slate-500 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-3 text-xs text-slate-400 leading-relaxed">{item.a}</div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 pt-4 border-t border-white/5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
            <a href="/terms" className="hover:text-slate-400 transition-colors">Terms</a>
            <span>·</span>
            <a href="/privacy" className="hover:text-slate-400 transition-colors">Privacy</a>
            <span>·</span>
            <a href="/refund" className="hover:text-slate-400 transition-colors">Refunds</a>
            <span>·</span>
            <a href="/report" className="hover:text-slate-400 transition-colors">Report Content</a>
            <span>·</span>
            <a href="mailto:promptandprotocol@gmail.com" className="hover:text-slate-400 transition-colors">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}
