'use client';

// /subscriptions - manage a Dev Tier subscription (rebuilt 2026-10-08).
// Where the Shop sends an account that already has a plan: what it is, when it
// renews or ends, what it unlocks, change plan (upgrade / downgrade), cancel,
// billing history and where billing help lives. Data + actions:
// /api/user/subscription/manage. Same ShopKit look as /buy-tickets and the
// subscribe page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowUp, BadgeCheck, CalendarClock, Check, CircleAlert, CreditCard, ExternalLink,
  Gauge, History, Images, Layers, Loader2, Sparkles, Ticket, X, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SilverRim, LoopVideo, ShopHeader, ShopBackdrop, ShopFooter, SHOP_MEDIA } from '@/components/shop/ShopKit';

const HERO_POSTER = `${SHOP_MEDIA}/sub/manage-hero-7a0de64f-211b-4a1e-a54a-10d9a08cbc05.webp`;
const HERO_VIDEO = `${SHOP_MEDIA}/sub/manage-loop-7bdb07a7-4514-47fb-ad05-4155a8c37941.mp4`;
// The plan cards' metal art, shared with the subscribe page
const PLAN_ART: Record<string, string> = {
  creator: `${SHOP_MEDIA}/sub/creator-01e97508-07a2-477d-861a-83d9e52d1023.webp`,
  pro: `${SHOP_MEDIA}/sub/pro-ce1f8eb8-cfeb-499d-a7a1-72978292a443.webp`,
  studio: `${SHOP_MEDIA}/sub/studio-a2589590-9079-4b86-80d7-ca0fa98159c4.webp`,
  max: `${SHOP_MEDIA}/sub/max-5bbe0716-dff8-4551-899b-7d53762eefa6.webp`,
};

type Plan = { id: string; name: string; price: number; tickets: number; periodDays: number; enhancePerDay: number };
type Current = {
  id: number; kind: 'ccbill' | 'manual'; planId: string; planName: string; price: number; ticketsPerCycle: number;
  status: string; renewing: boolean; startDate: string; nextBillingDate: string | null; endDate: string | null;
  cancelledAt: string | null; cancelRequestedAt: string | null; scheduledPlanId: string | null; enhancePerDay: number;
};
type Data = {
  checkoutAvailable: boolean; cancelFromHere: boolean; supportUrl: string;
  plans: Plan[]; perks: { packDiscountPct: number; concurrency: { free: number; dev: number }; refLibrary: { free: number; dev: number } };
  enhanceFree: number; current: Current | null; endedScheduledPlanId: string | null; lastEndedAt: string | null;
  balance: number; history: { id: number; type: string; amount: number | null; ticketsAdded: number | null; description: string | null; createdAt: string }[];
  cancelReasons: string[];
};

const REASON_LABEL: Record<string, string> = {
  'too-expensive': "It's too expensive", 'not-using': "I'm not using it enough", 'missing-feature': "It's missing something I need",
  quality: "The results weren't good enough", switching: "I'm switching to another tool", other: 'Something else',
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
const money = (n: number) => `$${n.toFixed(2)}`;

export default function ManageSubscriptionPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string; link?: { href: string; label: string } } | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/user/subscription/manage', { cache: 'no-store' }).catch(() => null);
    if (r?.status === 401) { setSignedOut(true); return; }
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (!j) { setError("Couldn't load your subscription - try refreshing."); return; }
    setData(j);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setNotice(null);
    try {
      const r = await fetch('/api/user/subscription/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice({ tone: 'warn', text: j.error || 'Something went wrong', ...(j.supportUrl ? { link: { href: j.supportUrl, label: 'Open CCBill support' } } : {}) }); return j; }
      if (j.checkoutUrl) { window.location.href = j.checkoutUrl; return j; }
      await load();
      return j;
    } finally { setBusy(null); }
  };

  const cur = data?.current ?? null;
  const curPlan = useMemo(() => data?.plans.find(p => p.id === cur?.planId) ?? null, [data, cur]);

  if (signedOut) {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <p className="text-lg font-semibold text-white">Sign in to manage your subscription</p>
          <Link href="/login?next=/subscriptions" className="mt-4 inline-flex rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white">Sign in</Link>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return <Shell><div className="flex items-center justify-center py-32 text-slate-500">{error ? <p className="text-sm text-red-400">{error}</p> : <Loader2 className="animate-spin" />}</div></Shell>;
  }

  // ── what the hero says ──
  const ending = !!cur && (cur.status === 'cancelled' || !!cur.cancelRequestedAt);
  const statusLine = !cur
    ? (data.endedScheduledPlanId ? `Your plan ended ${day(data.lastEndedAt)}.` : "You don't have a plan right now.")
    : cur.kind === 'manual'
      ? (cur.endDate ? `Granted by an admin · ends ${day(cur.endDate)}` : 'Granted by an admin · no billing')
      : cur.status === 'cancelled'
        ? `Cancelled · everything stays until ${day(cur.endDate ?? cur.nextBillingDate)}`
        : cur.cancelRequestedAt
          ? 'Cancellation requested · finish it at CCBill'
          : `Renews ${day(cur.nextBillingDate)} for ${money(cur.price)}`;

  return (
    <Shell>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#070b14]">
        <div className="absolute inset-0">
          <LoopVideo src={HERO_VIDEO} poster={HERO_POSTER} className="absolute inset-0 h-full w-full object-cover object-[70%_50%]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#05080f] via-[#05080f]/85 to-[#05080f]/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#05080f]/80 via-transparent to-transparent" />
        </div>
        <div className="relative px-5 py-10 sm:px-10 sm:py-14 lg:py-20 max-w-2xl">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">Dev Tier · your subscription</p>
          <h1 className="mt-2 text-3xl sm:text-5xl font-black tracking-tight text-white">
            {cur ? <>{cur.planName} <span className="text-slate-400">plan</span></> : 'Choose a plan'}
          </h1>
          <p className={cn('mt-3 text-sm sm:text-base', ending ? 'text-amber-300' : 'text-slate-300')}>{statusLine}</p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <a href="#plans" className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white">
              <Layers size={15} /> {cur ? 'Change plan' : 'See the plans'}
            </a>
            <Link href="/buy-tickets" className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm text-slate-200 hover:bg-white/[0.1]">
              <Ticket size={15} /> Buy tickets{cur ? ` · ${data.perks.packDiscountPct}% off` : ''}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Notices ── */}
      <div className="mt-5 space-y-2.5">
        {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)} link={notice.link}>{notice.text}</Notice>}
        {!data.checkoutAvailable && (
          <Notice tone="info">Payments are being set up - plan purchases and changes open soon.{cur ? <> Your current plan isn&apos;t affected.</> : null}</Notice>
        )}
        {cur?.cancelRequestedAt && cur.status === 'active' && (
          <Notice tone="warn" link={{ href: data.supportUrl, label: 'Finish at CCBill' }}
            action={<SmallBtn onClick={() => act({ action: 'resume' }, 'resume')} busy={busy === 'resume'}>Keep my plan</SmallBtn>}>
            Your cancellation is recorded, but the renewal is stopped at CCBill, our payment processor. Open CCBill support and search for your subscription to finish -
            you keep everything until {day(cur.nextBillingDate)}.
          </Notice>
        )}
        {cur?.scheduledPlanId && (
          <Notice tone="info" action={<SmallBtn onClick={() => act({ action: 'clear-schedule' }, 'clear')} busy={busy === 'clear'}>Don&apos;t switch</SmallBtn>}>
            You&apos;re switching to <b className="text-white">{data.plans.find(p => p.id === cur.scheduledPlanId)?.name}</b> when this plan ends on {day(cur.endDate ?? cur.nextBillingDate)}.
            We&apos;ll have its checkout ready here then.
          </Notice>
        )}
        {!cur && data.endedScheduledPlanId && (() => {
          const p = data.plans.find(x => x.id === data.endedScheduledPlanId)!;
          return (
            <Notice tone="ok" action={<SmallBtn primary onClick={() => act({ action: 'change', planId: p.id }, `plan-${p.id}`)} busy={busy === `plan-${p.id}`} disabled={!data.checkoutAvailable}>Start {p.name}</SmallBtn>}>
              Ready for your switch to <b className="text-white">{p.name}</b> - {money(p.price)}/month, {p.tickets.toLocaleString()} tickets.
            </Notice>
          );
        })()}
      </div>

      {/* ── At a glance ── */}
      {/* Only with a plan - otherwise four dashes say nothing */}
      {cur && <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<CreditCard size={14} />} label="Price" value={cur ? (cur.kind === 'manual' ? 'Complimentary' : `${money(cur.price)}/mo`) : '—'} />
        <Stat icon={<Sparkles size={14} />} label="Tickets each month" value={cur ? cur.ticketsPerCycle.toLocaleString() : '—'} />
        <Stat icon={<CalendarClock size={14} />} label={cur?.renewing ? 'Next renewal' : 'Plan ends'}
          value={!cur ? '—' : cur.renewing ? day(cur.nextBillingDate) : cur.endDate ? day(cur.endDate) : cur.kind === 'manual' ? 'No end date' : day(cur.nextBillingDate)} />
        <Stat icon={<Ticket size={14} />} label="Ticket balance" value={data.balance.toLocaleString()} />
      </section>}

      {/* ── What the plan unlocks ── */}
      <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white">{cur ? 'What your plan unlocks' : 'What Dev Tier unlocks'}</h2>
        <p className="text-[12px] text-slate-500">Compared with a free account.</p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Perk icon={<Ticket size={15} />} title={`${data.perks.packDiscountPct}% off ticket packs`} sub="Every pack in the shop, every time" />
          <Perk icon={<Zap size={15} />} title={`${data.perks.concurrency.dev} generations at once`} sub={`Free accounts run ${data.perks.concurrency.free}`} />
          <Perk icon={<Images size={15} />} title={`${data.perks.refLibrary.dev}-picture reference library`} sub={`Free accounts keep ${data.perks.refLibrary.free}`} />
          <Perk icon={<Layers size={15} />} title="Image Studio layers" sub="Layers, groups, masks - kept with your edits" />
          <Perk icon={<Sparkles size={15} />} title={`${cur?.enhancePerDay ?? '25-300'} prompt enhances a day`} sub={`Free accounts get ${data.enhanceFree}`} />
          <Perk icon={<Gauge size={15} />} title={`${(cur?.ticketsPerCycle ?? curPlan?.tickets ?? 250).toLocaleString()} tickets every month`} sub="Credited with each payment" />
        </div>
      </section>

      {/* ── Plans ── */}
      <section id="plans" className="mt-8 scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-white">{cur ? 'Change plan' : 'Choose a plan'}</h2>
            <p className="text-[12px] text-slate-500">Every plan includes all Dev Tier perks - bigger plans add tickets and daily enhances.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.plans.map(p => {
            const isCurrent = !!cur && cur.planId === p.id && cur.kind === 'ccbill';
            const curPrice = cur?.price ?? 0;
            const dir: 'current' | 'up' | 'down' | 'new' = isCurrent ? 'current' : !cur || cur.kind === 'manual' ? 'new' : p.price > curPrice ? 'up' : 'down';
            const scheduled = cur?.scheduledPlanId === p.id;
            return (
              <div key={p.id} className={cn('relative flex flex-col overflow-hidden rounded-2xl border bg-[#070b14]', isCurrent ? 'border-white/25' : 'border-white/[0.08]')}>
                {isCurrent && <SilverRim />}
                <div className="relative aspect-[16/10] overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={PLAN_ART[p.id]} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#070b14] via-transparent to-transparent" />
                  {isCurrent && <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-900"><BadgeCheck size={11} /> Your plan</span>}
                  {scheduled && <span className="absolute left-3 top-3 rounded-full bg-sky-300 px-2 py-0.5 text-[10px] font-bold text-slate-900">Switching here</span>}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-lg font-bold text-white">{p.name}</p>
                  <p className="mt-0.5"><span className="text-2xl font-black text-white">{money(p.price)}</span><span className="text-[12px] text-slate-500"> /month</span></p>
                  <ul className="mt-3 space-y-1.5 text-[12.5px] text-slate-300">
                    <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />{p.tickets.toLocaleString()} tickets a month</li>
                    <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />{p.enhancePerDay} prompt enhances a day</li>
                    <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />All Dev Tier perks</li>
                  </ul>
                  <div className="mt-auto pt-4">
                    {dir === 'current' ? (
                      <div className="w-full rounded-lg border border-white/15 bg-white/[0.04] py-2 text-center text-[13px] font-semibold text-slate-300">Current plan</div>
                    ) : (
                      <button
                        onClick={() => setConfirmPlan(p)}
                        disabled={!data.checkoutAvailable || !!busy || scheduled}
                        className={cn('flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                          dir === 'down' ? 'border border-white/15 bg-white/[0.04] text-slate-200 hover:bg-white/[0.09]' : 'bg-slate-100 text-slate-900 hover:bg-white')}
                      >
                        {dir === 'up' ? <><ArrowUp size={14} /> Upgrade</> : dir === 'down' ? <><ArrowDown size={14} /> Downgrade</> : <>Choose {p.name}</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] text-slate-500 leading-relaxed">
          Upgrades start right away as a new monthly plan - your current plan ends once the payment goes through, and tickets you already have stay yours.
          Downgrades stop the current renewal; the cheaper plan starts when this one ends, so you never pay twice for the same month.
        </p>
      </section>

      {/* ── Billing history ── */}
      <section className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white"><History size={16} /> Billing history</h2>
        {data.history.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">No charges yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-2 text-left font-semibold">Date</th><th className="py-2 text-left font-semibold">What</th><th className="py-2 text-right font-semibold">Amount</th></tr>
              </thead>
              <tbody>
                {data.history.map(h => (
                  <tr key={h.id} className="border-t border-white/[0.05]">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-400">{day(h.createdAt)}</td>
                    <td className="py-2.5 pr-3 text-slate-200">{h.description ?? (h.type === 'payment' ? 'Payment' : 'Tickets credited')}</td>
                    <td className="py-2.5 text-right whitespace-nowrap font-mono">
                      {h.type === 'payment' && h.amount != null ? <span className="text-slate-100">{money(h.amount)}</span>
                        : h.ticketsAdded ? <span className="text-emerald-300">+{h.ticketsAdded.toLocaleString()} tickets</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Help + cancel ── */}
      <section className="mt-8 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
          <h2 className="text-base font-semibold text-white">Billing help</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
            Payments are handled by <b className="text-slate-200">CCBill</b>. To update your card, get a receipt or cancel directly with them, use CCBill support.
            Your statement shows the charge from CCBill.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={data.supportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12.5px] text-slate-200 hover:bg-white/[0.09]">
              CCBill support <ExternalLink size={12} />
            </a>
            <a href="/refund" className="inline-flex items-center rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-slate-400 hover:text-white">Refund policy</a>
            <a href="mailto:promptandprotocol@gmail.com" className="inline-flex items-center rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-slate-400 hover:text-white">Contact us</a>
          </div>
        </div>
        {cur && !(cur.status === 'cancelled') && !cur.cancelRequestedAt && (
          <div className="flex flex-col justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 lg:w-80">
            <p className="text-[13px] text-slate-400">{cur.kind === 'manual' ? 'This plan was granted by an admin.' : 'Cancel any time - you keep your plan until the end of the period you paid for.'}</p>
            <button onClick={() => setCancelOpen(true)} className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] px-4 py-2 text-[13px] font-semibold text-rose-300 hover:bg-rose-500/15">
              Cancel subscription
            </button>
          </div>
        )}
      </section>

      {/* ── Change-plan confirmation ── */}
      {confirmPlan && cur !== undefined && (
        <Modal onClose={() => setConfirmPlan(null)}>
          {(() => {
            const p = confirmPlan;
            const down = !!cur && cur.kind === 'ccbill' && p.price < cur.price;
            return (
              <>
                <h3 className="text-lg font-bold text-white">{!cur || cur.kind === 'manual' ? `Start ${p.name}` : down ? `Downgrade to ${p.name}` : `Upgrade to ${p.name}`}</h3>
                <p className="mt-1 text-[13px] text-slate-400">{money(p.price)}/month · {p.tickets.toLocaleString()} tickets a month · {p.enhancePerDay} enhances a day</p>
                <ul className="mt-4 space-y-2 text-[13px] text-slate-300">
                  {down ? (
                    <>
                      <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />Your {cur!.planName} plan stops renewing now - you won&apos;t be charged {money(cur!.price)} again.</li>
                      <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />You keep {cur!.planName} and all its perks until {day(cur!.nextBillingDate ?? cur!.endDate)}.</li>
                      <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />Then start {p.name} here with one tap.</li>
                    </>
                  ) : (
                    <>
                      <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />You pay {money(p.price)} at CCBill now and get {p.tickets.toLocaleString()} tickets straight away.</li>
                      {cur && <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />Your {cur.planName} plan ends as soon as the payment goes through - no double billing. Tickets you already have stay yours.</li>}
                      <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />Renews monthly - cancel any time from this page.</li>
                    </>
                  )}
                </ul>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setConfirmPlan(null)} className="rounded-lg px-4 py-2 text-[13px] text-slate-400 hover:text-white">Not now</button>
                  <button
                    onClick={async () => { const j = await act({ action: 'change', planId: p.id }, `plan-${p.id}`); if (!j?.checkoutUrl) setConfirmPlan(null); if (j?.needsCcbillCancel) setNotice({ tone: 'warn', text: `Almost done: stop your ${cur?.planName} renewal at CCBill, then ${p.name} starts when it ends.`, link: { href: data.supportUrl, label: 'Finish at CCBill' } }); else if (j?.scheduled) setNotice({ tone: 'ok', text: `Done - you'll switch to ${p.name} when your current plan ends.` }); }}
                    disabled={busy === `plan-${p.id}`}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-white disabled:opacity-50"
                  >
                    {busy === `plan-${p.id}` && <Loader2 size={14} className="animate-spin" />}
                    {down ? `Switch to ${p.name}` : 'Continue to checkout'}
                  </button>
                </div>
              </>
            );
          })()}
        </Modal>
      )}

      {/* ── Cancel ── */}
      {cancelOpen && cur && (
        <CancelModal cur={cur} reasons={data.cancelReasons} busy={busy === 'cancel'} onClose={() => setCancelOpen(false)}
          onConfirm={async (reason, note) => {
            const j = await act({ action: 'cancel', reason, note }, 'cancel');
            setCancelOpen(false);
            if (j?.needsCcbillCancel) setNotice({ tone: 'warn', text: 'One more step: stop the renewal at CCBill, our payment processor. Search for your subscription there - you keep everything until the period ends.', link: { href: data.supportUrl, label: 'Finish at CCBill' } });
            else if (j?.endedNow) setNotice({ tone: 'ok', text: 'Your plan has ended.' });
            else if (j?.ok) setNotice({ tone: 'ok', text: `Cancelled. You keep everything until ${day(j.endsAt)}.` });
          }} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#05080f] text-white">
      <ShopBackdrop />
      <ShopHeader title="Your subscription" right={
        <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400 hover:text-white">Dashboard</Link>
      } />
      <main className="relative mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
        {children}
        <ShopFooter />
      </main>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{icon}{label}</p>
      <p className="mt-1.5 text-base sm:text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function Perk({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300">{icon}</span>
      <div><p className="text-[13px] font-semibold text-slate-100">{title}</p><p className="text-[11.5px] text-slate-500">{sub}</p></div>
    </div>
  );
}

function Notice({ tone, children, link, action, onClose }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode; link?: { href: string; label: string }; action?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed',
      tone === 'warn' ? 'border-amber-400/25 bg-amber-400/[0.06] text-amber-100' : tone === 'ok' ? 'border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100' : 'border-white/10 bg-white/[0.03] text-slate-300')}>
      <CircleAlert size={15} className="mt-0.5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        {link && <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[12px] text-white hover:bg-white/[0.12]">{link.label} <ExternalLink size={11} /></a>}
        {action}
        {onClose && <button onClick={onClose} className="text-slate-500 hover:text-white" aria-label="Dismiss"><X size={14} /></button>}
      </div>
    </div>
  );
}

function SmallBtn({ children, onClick, busy, disabled, primary }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40', primary ? 'bg-slate-100 text-slate-900 hover:bg-white' : 'border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]')}>
      {busy && <Loader2 size={12} className="animate-spin" />}{children}
    </button>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-md rounded-2xl border border-white/12 bg-[#0b0f17] p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 rounded-md p-1 text-slate-500 hover:text-white" aria-label="Close"><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

function CancelModal({ cur, reasons, busy, onClose, onConfirm }: { cur: Current; reasons: string[]; busy: boolean; onClose: () => void; onConfirm: (reason: string | null, note: string) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const manual = cur.kind === 'manual';
  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-bold text-white">Cancel your {cur.planName} plan?</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
        {manual
          ? 'This plan was granted by an admin, so it ends straight away and your account returns to Free.'
          : `It won't renew. You keep everything - perks and tickets - until ${day(cur.nextBillingDate)}; after that the account returns to Free. Tickets you have never expire.`}
      </p>
      {!manual && (
        <>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mind telling us why? (optional)</p>
          <div className="mt-2 grid gap-1.5">
            {reasons.map(r => (
              <label key={r} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px]', reason === r ? 'border-white/30 bg-white/[0.07] text-white' : 'border-white/[0.07] text-slate-300 hover:bg-white/[0.04]')}>
                <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-slate-200" /> {REASON_LABEL[r] ?? r}
              </label>
            ))}
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Anything else? (optional)"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-semibold text-slate-200 hover:text-white">Keep my plan</button>
        <button onClick={() => onConfirm(reason, note)} disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-[13px] font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Cancel subscription
        </button>
      </div>
    </Modal>
  );
}
