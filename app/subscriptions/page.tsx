'use client';

// Manage Subscriptions — monochrome brand design (SitePageHeader + SiteBrandHero,
// frosted cards, sheen CTA). Status colors stay semantic: green active, amber
// cancelling, orange cancelled, red destructive actions.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Calendar, RefreshCw, XCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader';

interface Subscription {
  id: number;
  tier: string;
  status: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  billingAmount: number | null;
  billingCycle: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
}

const TIER_DISPLAY: Record<string, { name: string; description: string }> = {
  'prompt-studio-dev': {
    name: 'Development Tier',
    description: 'Discounted tickets on autopilot, 8 concurrent generations, and an expanded reference library',
  }
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState<number | null>(null);

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      const res = await fetch('/api/user/subscriptions');
      const data = await res.json();

      if (!data.success) {
        if (data.error === 'Not authenticated') {
          router.push('/login');
          return;
        }
      }

      setSubscriptions(data.subscriptions || []);
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async (subscriptionId: number) => {
    setCancelling(subscriptionId);
    try {
      const res = await fetch('/api/user/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId })
      });

      const data = await res.json();

      if (data.success) {
        // Refresh subscriptions
        fetchSubscriptions();
        setShowCancelConfirm(null);
      } else {
        alert(data.error || 'Failed to cancel subscription');
      }
    } catch (err) {
      console.error('Failed to cancel subscription:', err);
      alert('Failed to cancel subscription');
    } finally {
      setCancelling(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusBadge = (sub: Subscription) => {
    if (sub.status === 'active' && !sub.cancelledAt) {
      return (
        <span className="flex items-center gap-1 text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full">
          <CheckCircle size={11} />
          Active
        </span>
      );
    } else if (sub.status === 'active' && sub.cancelledAt) {
      return (
        <span className="flex items-center gap-1 text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded-full">
          <AlertTriangle size={11} />
          Cancelling
        </span>
      );
    } else if (sub.status === 'cancelled') {
      return (
        <span className="flex items-center gap-1 text-xs font-bold bg-orange-500/15 border border-orange-500/30 text-orange-400 px-2 py-0.5 rounded-full">
          <XCircle size={11} />
          Cancelled
        </span>
      );
    } else if (sub.status === 'expired') {
      return (
        <span className="flex items-center gap-1 text-xs font-bold bg-white/10 border border-white/15 text-slate-400 px-2 py-0.5 rounded-full">
          <XCircle size={11} />
          Expired
        </span>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-slate-700 border-t-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      <SitePageHeader />
      <div className="max-w-3xl mx-auto px-4 py-10">
        <SiteBrandHero />

        <div className="text-center mt-6 mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Manage Subscriptions</h1>
          <p className="text-sm text-slate-500 mt-1">View and manage your active subscriptions</p>
        </div>

        {/* Subscriptions List */}
        {subscriptions.length === 0 ? (
          <div className="p-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] text-center">
            <CreditCard className="mx-auto text-slate-600 mb-3" size={40} />
            <h2 className="text-base font-bold text-slate-300 mb-1.5">No Active Subscriptions</h2>
            <p className="text-sm text-slate-500 mb-5">You don&apos;t have any active subscriptions yet.</p>
            <Link href="/prompting-studio/subscribe" className="inline-block">
              <span className="relative overflow-hidden inline-flex items-center px-5 py-2.5 rounded-xl bg-white/10 border border-white/25 text-white text-sm font-bold hover:bg-white/15 hover:border-white/40 transition-all">
                <span
                  className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
                  style={{ animation: 'sheen-sweep 2.6s infinite' }}
                />
                Upgrade to Dev Tier
              </span>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {subscriptions.map((sub) => {
              const tierInfo = TIER_DISPLAY[sub.tier] || { name: sub.tier, description: '' };
              const isActive = sub.status === 'active';
              const isCancelled = !!sub.cancelledAt;

              return (
                <div
                  key={sub.id}
                  className={`p-5 sm:p-6 rounded-2xl border ${
                    isActive && !isCancelled
                      ? 'border-white/[0.15] bg-white/[0.04]'
                      : 'border-white/[0.08] bg-white/[0.02]'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-bold text-white tracking-tight">{tierInfo.name}</h3>
                        {getStatusBadge(sub)}
                      </div>
                      <p className="text-[13px] text-slate-500">{tierInfo.description}</p>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 mb-1">
                        <Calendar size={11} />
                        Started
                      </div>
                      <p className="text-sm text-white font-medium">{formatDate(sub.startDate)}</p>
                    </div>

                    {sub.billingAmount && sub.billingCycle && (
                      <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06]">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 mb-1">
                          <CreditCard size={11} />
                          Billing
                        </div>
                        <p className="text-sm text-white font-medium">
                          {formatCurrency(sub.billingAmount)}/{sub.billingCycle === 'monthly' ? 'mo' : 'yr'}
                        </p>
                      </div>
                    )}

                    {sub.nextBillingDate && !isCancelled && (
                      <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06]">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 mb-1">
                          <RefreshCw size={11} />
                          Next Billing
                        </div>
                        <p className="text-sm text-white font-medium">{formatDate(sub.nextBillingDate)}</p>
                      </div>
                    )}

                    <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 mb-1">
                        <Calendar size={11} />
                        {isCancelled ? 'Access Until' : 'Subscription Ends'}
                      </div>
                      <p className={`text-sm font-medium ${isCancelled ? 'text-amber-400' : 'text-white'}`}>
                        {sub.endDate ? formatDate(sub.endDate) : 'Unlimited'}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 mb-1">
                        <RefreshCw size={11} />
                        Auto-Renew
                      </div>
                      <p className={`text-sm font-medium ${sub.autoRenew ? 'text-white' : 'text-slate-500'}`}>
                        {sub.autoRenew ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                  </div>

                  {/* Cancellation Notice */}
                  {isCancelled && sub.endDate && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 mb-4">
                      <p className="text-[13px] text-amber-300 leading-relaxed">
                        <AlertTriangle size={13} className="inline mr-2 -mt-0.5" />
                        Your subscription has been cancelled. You will continue to have access until{' '}
                        <strong>{formatDate(sub.endDate)}</strong>.
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  {isActive && !isCancelled && (
                    <div className="pt-4 border-t border-white/[0.06]">
                      {showCancelConfirm === sub.id ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-[13px] text-slate-400 flex-1 min-w-[200px]">
                            Are you sure? Your access will continue until the end of your billing period.
                          </p>
                          <button
                            onClick={() => setShowCancelConfirm(null)}
                            className="px-4 py-2 rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/10 text-slate-200 hover:text-white text-[13px] font-semibold transition-all"
                          >
                            Keep Subscription
                          </button>
                          <button
                            onClick={() => handleCancelSubscription(sub.id)}
                            disabled={cancelling === sub.id}
                            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13px] font-semibold transition-colors disabled:opacity-50"
                          >
                            {cancelling === sub.id ? 'Cancelling…' : 'Confirm Cancel'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCancelConfirm(sub.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 hover:border-red-500/50 text-red-400 hover:text-red-300 text-[13px] font-semibold transition-all"
                        >
                          <XCircle size={14} />
                          Cancel Subscription
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
