'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FlaskRound, Sparkles, Check, ArrowLeft, Zap, Crown, Ticket } from 'lucide-react';
import Link from 'next/link';

interface UserData {
  id: number;
  email: string;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  tickets: number;
  interval: 'biweekly' | 'monthly' | 'yearly';
  intervalLabel: string;
  popular?: boolean;
  bestValue?: boolean;
  savings?: string;
}

const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'biweekly',
    name: 'Biweekly Plan',
    price: 20,
    tickets: 250,
    interval: 'biweekly',
    intervalLabel: 'every 2 weeks',
  },
  {
    id: 'monthly',
    name: 'Monthly Plan',
    price: 40,
    tickets: 500,
    interval: 'monthly',
    intervalLabel: 'per month',
    popular: true,
  },
  {
    id: 'yearly',
    name: 'Yearly Plan',
    price: 480,
    tickets: 500,
    interval: 'yearly',
    intervalLabel: 'per year',
    bestValue: true,
    savings: 'Save $0/mo vs Monthly',
  },
];

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

  useEffect(() => {
    checkAuth();
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

      // Check if already subscribed
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
    if (!acceptedTOS || !selectedPlan || purchasing) return;
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription', planId: selectedPlan.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout');
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setPurchaseError(err.message || 'Something went wrong. Please try again.');
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  // Already subscribed (or cancelled-within-period) — show status view instead of checkout
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
      <div className="min-h-screen bg-[#050810] text-white relative overflow-hidden">
        <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="fixed top-20 left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="fixed bottom-20 right-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
          {/* Back link */}
          <Link href="/prompting-studio" className="text-slate-500 hover:text-cyan-400 text-sm mb-6 inline-flex items-center gap-2 transition-colors">
            <ArrowLeft size={15} />
            Back to Studio
          </Link>

          {/* Active badge header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/30 to-cyan-500/30 border border-purple-500/30 flex items-center justify-center shrink-0">
              <FlaskRound size={28} className="text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 mb-0.5">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
                  DEVELOPMENT TIER
                </h1>
                {isCancelled ? (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                    Cancelled
                  </span>
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">
                    Active
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm">
                {cycle ? `${cycleLabel[cycle] ?? cycle} plan` : 'Subscription plan'}
                {formattedRenew && (
                  <span className="text-slate-500">
                    {isCancelled ? ` · Access until ${formattedRenew}` : ` · Renews ${formattedRenew}`}
                  </span>
                )}
              </p>
              {isCancelled && (
                <p className="text-xs text-amber-500/80 mt-1">Your benefits remain active until the end of your billing period.</p>
              )}
            </div>
          </div>

          {/* Stat highlights */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { value: '20%', label: 'off all ticket purchases', color: 'purple' },
              { value: '8×', label: 'concurrent generations', color: 'cyan' },
              { value: '500', label: 'tickets per cycle', color: 'green' },
            ].map(({ value, label, color }) => (
              <div key={value} className={`p-4 rounded-xl border text-center
                ${color === 'purple' ? 'bg-purple-500/8 border-purple-500/20' :
                  color === 'cyan'   ? 'bg-cyan-500/8 border-cyan-500/20' :
                                       'bg-green-500/8 border-green-500/20'}`}>
                <div className={`text-2xl font-black mb-1
                  ${color === 'purple' ? 'text-purple-400' :
                    color === 'cyan'   ? 'text-cyan-400' :
                                         'text-green-400'}`}>
                  {value}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
              </div>
            ))}
          </div>

          {/* Feature list */}
          <div className="rounded-2xl border border-purple-500/20 bg-slate-900/60 backdrop-blur-sm overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
              <Crown size={15} className="text-cyan-400" />
              <span className="font-bold text-white text-sm">Your Active Benefits</span>
              <span className="ml-auto text-[10px] text-slate-500">Everything below is unlocked for your account</span>
            </div>
            <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
              {[
                { text: '20% off all ticket package purchases', highlight: true },
                { text: '250–500 tickets auto-delivered each billing cycle', highlight: true },
                { text: 'Up to 8 concurrent generations (6 image + 2 video)', highlight: true },
                { text: '100 reference image slots in the Refs library', highlight: true },
                { text: 'AI-powered prompt generation (Gemini models)', highlight: false },
                { text: 'Early access to new experimental features', highlight: false },
              ].map((f) => (
                <div key={f.text} className="flex items-start gap-2.5">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5
                    ${f.highlight ? 'bg-cyan-500/15 border border-cyan-500/30' : 'bg-white/5 border border-white/10'}`}>
                    <Check size={9} className={f.highlight ? 'text-cyan-400' : 'text-slate-600'} />
                  </div>
                  <span className={`text-sm leading-snug ${f.highlight ? 'text-white font-medium' : 'text-slate-500'}`}>
                    {f.text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Free tier reminder */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 mb-8">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="text-slate-300 font-semibold">Free tier features are also included</span> — Main Scanner, Legacy Scanner, Video Scanner, all AI models, and 2 concurrent generations.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Link href="/prompting-studio">
              <button className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 text-white text-sm font-bold hover:opacity-90 transition-opacity">
                Go to Studio
              </button>
            </Link>
            <Link href="/dashboard">
              <button className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 text-slate-300 hover:text-white text-sm font-semibold transition-all">
                Dashboard
              </button>
            </Link>
            {isCancelled ? (
              <button
                onClick={() => setHasSubscription(false)}
                className="px-5 py-2.5 rounded-xl border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-white text-sm font-semibold transition-all"
              >
                Re-subscribe
              </button>
            ) : (
              <Link href="/subscriptions">
                <button className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 text-slate-300 hover:text-white text-sm font-semibold transition-all">
                  Manage Subscription
                </button>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const devTierFeatures = [
    { text: '20% off all ticket package purchases', highlight: true },
    { text: '250–500 tickets auto-delivered each billing cycle', highlight: true },
    { text: 'Up to 8 concurrent generations — 6 image + 2 video (vs 2 on free tier)', highlight: true },
    { text: '100 reference image slots in the Refs library (2× the free tier limit of 50)', highlight: true },
    { text: 'AI-powered prompt generation (Gemini models)', highlight: false },
    { text: 'Early access to new experimental features', highlight: false },
  ];

  return (
    <div className="min-h-screen bg-[#050810] text-white relative overflow-hidden">
        {/* Background effects */}
        <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="fixed top-20 left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="fixed bottom-20 right-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-4xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <Link href="/prompting-studio/upgrade" className="text-slate-500 hover:text-cyan-400 text-sm mb-4 inline-block">
              <ArrowLeft className="inline mr-2" size={16} />
              Back to Upgrade Page
            </Link>
            <div className="flex items-center gap-3 mb-3">
              <FlaskRound className="text-purple-400" size={40} />
              <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
                DEVELOPMENT TIER
              </h1>
            </div>
            <p className="text-slate-400 text-lg">Discounted tickets, auto delivery, 8 concurrent generations, and the full AI Design Studio.</p>
          </div>

          {/* Logged in account info */}
          <div className="mb-8 p-4 rounded-xl border-2 border-cyan-500/30 bg-slate-950/50 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center">
                <span className="text-white font-bold text-lg">
                  {user.email?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-500">Purchasing for account:</p>
                <p className="text-sm font-bold text-cyan-400">{user.email}</p>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Left: Features */}
            <div className="p-6 rounded-xl border-2 border-purple-500/30 bg-slate-900/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="text-cyan-400" size={18} />
                <h2 className="text-xl font-bold text-white">Dev Tier Benefits</h2>
              </div>
              <p className="text-xs text-slate-500 mb-5">Everything in the free tier, plus:</p>

              {/* 3 stat highlights */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                  <div className="text-xl font-black text-purple-400">20%</div>
                  <div className="text-[10px] text-slate-500 leading-tight">off tickets</div>
                </div>
                <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-center">
                  <div className="text-xl font-black text-cyan-400">8×</div>
                  <div className="text-[10px] text-slate-500 leading-tight">concurrent gens</div>
                </div>
                <div className="p-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                  <div className="text-xl font-black text-green-400">500</div>
                  <div className="text-[10px] text-slate-500 leading-tight">tickets/mo</div>
                </div>
              </div>

              <ul className="space-y-2.5 mb-5">
                {devTierFeatures.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className={`flex-shrink-0 mt-0.5 ${feature.highlight ? 'text-cyan-400' : 'text-cyan-700'}`} size={15} />
                    <span className={`text-sm ${feature.highlight ? 'text-white font-semibold' : 'text-slate-400'}`}>{feature.text}</span>
                  </li>
                ))}
              </ul>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Free tier includes</span> — Main Scanner, Legacy Scanner, Video Scanner, all AI models, and 2 concurrent generations.
                </p>
              </div>
            </div>

            {/* Right: Plan Selection or Checkout */}
            <div>
              {!selectedPlan ? (
                /* Plan Selection */
                <>
                  <h3 className="text-xl font-black text-white mb-4">Choose Your Plan</h3>
                  <div className="space-y-3">
                    {SUBSCRIPTION_PLANS.map((plan) => (
                      <div
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan)}
                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                          plan.bestValue
                            ? 'border-fuchsia-500/50 bg-gradient-to-br from-fuchsia-500/10 to-transparent hover:border-fuchsia-400'
                            : plan.popular
                            ? 'border-purple-500/50 bg-gradient-to-br from-purple-500/10 to-transparent hover:border-purple-400'
                            : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                        }`}
                      >
                        {/* Badge */}
                        {(plan.popular || plan.bestValue) && (
                          <div className="mb-2">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                              plan.bestValue ? 'bg-fuchsia-500 text-white' : 'bg-purple-500 text-white'
                            }`}>
                              {plan.bestValue ? 'BEST VALUE' : 'POPULAR'}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-bold text-white text-lg">{plan.name}</h4>
                            <p className="text-xs text-slate-400">{plan.intervalLabel}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                              ${plan.price}
                            </p>
                            {plan.interval === 'yearly' && (
                              <p className="text-[10px] text-slate-500">$40/mo equivalent</p>
                            )}
                          </div>
                        </div>

                        {/* Tickets */}
                        <div className="p-2.5 rounded-lg bg-green-500/10 border border-green-500/30">
                          <div className="flex items-center gap-2">
                            <Ticket size={13} className="text-green-400 flex-shrink-0" />
                            <span className="text-xs text-green-400 font-bold">
                              {plan.tickets} tickets {plan.interval === 'yearly' ? 'per month' : plan.intervalLabel}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-600 mt-1 pl-5">Auto-delivered · never expire</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                /* Checkout for Selected Plan */
                <>
                  <div className="p-6 rounded-xl border-2 border-cyan-500/30 bg-slate-900/80 backdrop-blur-sm mb-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-black text-white">Subscription Details</h3>
                      <button
                        onClick={() => setSelectedPlan(null)}
                        className="text-xs text-slate-400 hover:text-cyan-400 transition-colors"
                      >
                        Change Plan
                      </button>
                    </div>

                    {/* Selected Plan Summary */}
                    <div className="mb-4 pb-4 border-b border-slate-800">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-sm text-slate-400">{selectedPlan.name}</p>
                          <p className="text-xs text-slate-500 mt-1">Billed {selectedPlan.intervalLabel}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                            ${selectedPlan.price}
                          </p>
                          {selectedPlan.interval === 'yearly' && (
                            <p className="text-xs text-slate-500">($40/mo equivalent)</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Included Tickets */}
                    <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap size={16} className="text-green-400" />
                        <span className="text-sm font-bold text-green-400">
                          {selectedPlan.tickets} tickets included {selectedPlan.interval === 'yearly' ? 'monthly' : selectedPlan.intervalLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Automatically added to your account with each billing cycle
                      </p>
                    </div>

                    <div className="space-y-2 text-xs text-slate-400">
                      <div className="flex items-center gap-2">
                        <Check size={14} className="text-green-400" />
                        <span>Cancel anytime</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check size={14} className="text-green-400" />
                        <span>Instant access to all features</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check size={14} className="text-green-400" />
                        <span>Auto-renews {selectedPlan.intervalLabel}</span>
                      </div>
                    </div>
                  </div>

                  {/* TOS ACCEPTANCE */}
                  <div className="mb-4 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptedTOS}
                        onChange={(e) => setAcceptedTOS(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                      />
                      <span className="text-xs text-slate-300 leading-relaxed">
                        I agree to the{' '}
                        <a href="/terms" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">
                          Terms of Service
                        </a>
                        {', '}
                        <a href="/privacy" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">
                          Privacy Policy
                        </a>
                        {', and '}
                        <a href="/refund" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline">
                          Refund Policy
                        </a>
                        . I understand that subscriptions auto-renew {selectedPlan.intervalLabel}, are non-refundable, and can be cancelled anytime from account settings.
                      </span>
                    </label>
                  </div>

                  {/* Subscriptions temporarily unavailable */}
                  <div className="space-y-3">
                    <div className="w-full py-4 rounded-xl border-2 border-orange-500/30 bg-orange-500/5 text-center cursor-not-allowed">
                      <p className="font-black text-base tracking-widest text-orange-400">COMING SOON</p>
                      <p className="text-[10px] font-normal mt-0.5 text-orange-400/50">Subscriptions are temporarily unavailable</p>
                    </div>
                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                      We're setting up a new payment system. Check back soon — your existing tickets and benefits are unaffected.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}
