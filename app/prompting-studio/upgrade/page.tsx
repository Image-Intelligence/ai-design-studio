'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check, X, ArrowLeft, Sparkles, Zap, Ticket, Crown } from 'lucide-react';
import Link from 'next/link';

export default function PromptStudioUpgradePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (!data.authenticated) { router.push('/login'); return; }
      setUser(data.user);
      const subRes = await fetch('/api/user/subscription');
      const subData = await subRes.json();
      if (subData.success && subData.hasPromptStudioDev) setHasSubscription(true);
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="text-cyan-400 font-mono animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-32 left-16 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-32 right-16 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8">

        {/* Back */}
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-cyan-400 text-sm mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 text-xs font-bold uppercase tracking-widest mb-4">
            <Crown size={12} /> Development Tier
          </div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 mb-3">
            Unlock More. Spend Less.
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Dev Tier gives you discounted tickets, auto delivery, 8 concurrent generations, and access to the full AI Design Studio.
          </p>
        </div>

        {hasSubscription ? (
          <div className="text-center p-10 rounded-2xl border-2 border-green-500/30 bg-green-900/20 mb-8">
            <Sparkles className="mx-auto text-green-400 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-green-400 mb-2">You're Already Subscribed!</h2>
            <p className="text-slate-300 mb-6">You have full access to the Development Tier.</p>
            <Link href="/prompting-studio/canvas">
              <Button className="bg-green-600 hover:bg-green-500 font-bold">Open Canvas Scanner</Button>
            </Link>
          </div>
        ) : (
          <>
            {/* 3 Hero Stats */}
            <div className="grid grid-cols-3 gap-4 mb-10">
              <div className="p-5 rounded-2xl border border-purple-500/30 bg-purple-500/10 text-center">
                <div className="text-3xl font-black text-purple-400 mb-1">20%</div>
                <div className="text-xs font-bold text-slate-300 mb-1">OFF TICKETS</div>
                <div className="text-[11px] text-slate-500">10-20% off every ticket package, by plan</div>
              </div>
              <div className="p-5 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-center">
                <div className="text-3xl font-black text-cyan-400 mb-1">8×</div>
                <div className="text-xs font-bold text-slate-300 mb-1">CONCURRENT GENS</div>
                <div className="text-[11px] text-slate-500">Run 8 generations at once (6 image + 2 video) vs 2 on the free tier</div>
              </div>
              <div className="p-5 rounded-2xl border border-green-500/30 bg-green-500/10 text-center">
                <div className="text-3xl font-black text-green-400 mb-1">500</div>
                <div className="text-xs font-bold text-slate-300 mb-1">TICKETS / MONTH</div>
                <div className="text-[11px] text-slate-500">Auto-delivered to your account every billing cycle</div>
              </div>
            </div>

            {/* Free vs Dev Comparison */}
            <div className="grid md:grid-cols-2 gap-6 mb-10">

              {/* Free Tier */}
              <div className="p-6 rounded-2xl border-2 border-slate-700 bg-slate-900/80">
                <div className="mb-5">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Free Tier</div>
                  <div className="text-4xl font-black text-white">$0 <span className="text-base font-normal text-slate-500">/ forever</span></div>
                </div>

                <ul className="space-y-2.5 mb-6">
                  {[
                    'Main Scanner',
                    'Video Scanner',
                    'All AI models (NanoBanana Pro, SeeDream 4.5, Kling V3, FLUX, and more)',
                    '2 concurrent generations',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check size={15} className="text-slate-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  {[
                    'Ticket discount on purchases',
                    'Auto ticket delivery',
                    'Up to 8 concurrent generations (6 image + 2 video)',
                    'AI Design Studio sections',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                      <X size={15} className="text-slate-700 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href="/prompting-studio">
                  <Button className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold">
                    Continue with Free Tier
                  </Button>
                </Link>
              </div>

              {/* Dev Tier */}
              <div className="p-6 rounded-2xl border-2 border-purple-500/50 bg-gradient-to-b from-purple-900/20 to-slate-900/80 relative overflow-hidden">
                <div className="absolute top-4 right-4">
                  <span className="bg-gradient-to-r from-purple-500 to-cyan-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Recommended
                  </span>
                </div>

                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Crown size={14} className="text-cyan-400" />
                    <div className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Dev Tier</div>
                  </div>
                  <div className="text-4xl font-black text-white">$20 <span className="text-base font-normal text-slate-400">/ 2 weeks</span></div>
                  <div className="text-xs text-slate-500 mt-0.5">or $40/mo · $480/yr</div>
                </div>

                <ul className="space-y-2.5 mb-6">
                  <li className="flex items-start gap-2.5 text-sm text-slate-400">
                    <Check size={15} className="text-slate-500 flex-shrink-0 mt-0.5" />
                    Everything in Free Tier
                  </li>
                  {[
                    { text: 'Up to 20% off all ticket packages', highlight: true },
                    { text: '250–500 tickets auto-delivered each billing cycle', highlight: true },
                    { text: 'Up to 8 concurrent generations — 6 image + 2 video (vs 2 on free tier)', highlight: true },
                    { text: '100 reference image slots in the Refs library (2× the free limit)', highlight: true },
                    { text: 'AI-powered prompt generation (Gemini models)', highlight: false },
                    { text: 'Early access to new features and experimental tools', highlight: false },
                  ].map((f) => (
                    <li key={f.text} className={`flex items-start gap-2.5 text-sm ${f.highlight ? 'text-white font-semibold' : 'text-slate-300'}`}>
                      <Check size={15} className={`flex-shrink-0 mt-0.5 ${f.highlight ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      {f.text}
                    </li>
                  ))}
                </ul>

                <Link href="/prompting-studio/subscribe">
                  <Button className="w-full bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 font-bold h-11">
                    <Zap size={16} className="mr-2" />
                    View Plans & Upgrade
                  </Button>
                </Link>
                <p className="text-center text-xs text-slate-600 mt-3">Cancel anytime · Instant access</p>
              </div>
            </div>

            {/* Plans — price + tickets only, no repeated features */}
            <div className="mb-10">
              <h3 className="text-lg font-black text-white text-center mb-1">Choose Your Billing Cycle</h3>
              <p className="text-xs text-slate-500 text-center mb-6">All plans include the same Dev Tier features — the only difference is billing frequency and ticket delivery rate.</p>

              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { name: 'Biweekly', price: 20, interval: 'every 2 weeks', tickets: 250, note: '125 tickets/week' },
                  { name: 'Monthly', price: 40, interval: 'per month', tickets: 500, popular: true },
                  { name: 'Yearly', price: 480, interval: 'per year', tickets: 500, note: '500 tickets/month · $40/mo equivalent', bestValue: true },
                ].map((plan) => (
                  <div
                    key={plan.name}
                    className={`p-5 rounded-xl border-2 relative ${
                      plan.bestValue
                        ? 'border-fuchsia-500/50 bg-fuchsia-500/5'
                        : plan.popular
                        ? 'border-purple-500/50 bg-purple-500/5'
                        : 'border-slate-700 bg-slate-900/50'
                    }`}
                  >
                    {(plan.popular || plan.bestValue) && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className={`text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap ${
                          plan.bestValue ? 'bg-fuchsia-500 text-white' : 'bg-purple-500 text-white'
                        }`}>
                          {plan.bestValue ? 'BEST VALUE' : 'POPULAR'}
                        </span>
                      </div>
                    )}

                    <div className="text-center mb-3 mt-1">
                      <h4 className="font-bold text-white text-lg mb-1">{plan.name}</h4>
                      <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                        ${plan.price}
                      </div>
                      <div className="text-xs text-slate-500">{plan.interval}</div>
                    </div>

                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-green-400 font-bold text-sm">
                        <Ticket size={14} />
                        {plan.tickets} tickets
                      </div>
                      {plan.note && <div className="text-[10px] text-slate-500 mt-0.5">{plan.note}</div>}
                      {!plan.note && <div className="text-[10px] text-slate-500 mt-0.5">{plan.interval}</div>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-center mt-6">
                <Link href="/prompting-studio/subscribe">
                  <Button className="bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 font-bold px-8">
                    Choose Your Plan
                  </Button>
                </Link>
              </div>
            </div>

            {/* FAQ */}
            <div className="max-w-3xl mx-auto">
              <h3 className="text-lg font-bold text-cyan-400 mb-5 text-center">FAQ</h3>
              <div className="space-y-3">
                {[
                  {
                    q: 'What scanners does the free tier include?',
                    a: 'Free tier gets full access to the Main Scanner and Video Scanner — including every AI model available on each. You can generate images and videos across both tools with 2 concurrent generations running at the same time.',
                  },
                  {
                    q: 'What does Dev Tier add on top of that?',
                    a: 'Dev Tier unlocks the AI Design Studio sections — most importantly the Canvas Scanner, an infinite multi-panel workspace for serious generation sessions. You also get AI-powered prompt generation, 8 concurrent generations (vs 2), and early access to new experimental features.',
                  },
                  {
                    q: 'How does the ticket discount work?',
                    a: 'Dev Tier subscribers see 10% (Creator), 15% (Pro) or 20% (Max) off every ticket package in the Ticket Dispenser. For example, 50 tickets costs $9 at free tier and $7.20 at Dev Tier. This discount stacks with your automatic ticket delivery.',
                  },
                  {
                    q: 'How do automatic tickets work?',
                    a: 'Tickets are automatically credited to your account with every billing cycle. Biweekly plan delivers 250 tickets every 2 weeks. Monthly and Yearly plans deliver 500 tickets per month. No manual purchases needed — they just appear.',
                  },
                  {
                    q: 'Can I cancel anytime?',
                    a: 'Yes. Cancel from your account settings at any time. You keep access until the end of the current billing period. After that, unused plan tickets end; tickets from packs stay in your account permanently.',
                  },
                ].map((item) => (
                  <div key={item.q} className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                    <h4 className="font-bold text-white mb-1.5 text-sm">{item.q}</h4>
                    <p className="text-sm text-slate-400 leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
