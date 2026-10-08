import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import {
  CCBILL_PLANS, getCcbillPlan, ccbillConfigured, buildFlexFormUrl,
  ccbillDatalinkConfigured, ccbillCancelSubscription, CCBILL_SUPPORT_URL, type CcbillPlan, type CcbillPlanId,
} from '@/lib/ccbill'
import { findDevTierSubscription, DEV_TIER_PERKS } from '@/lib/dev-tier'
import { ENHANCE_LIMITS } from '@/lib/prompt-enhance'

/**
 * /subscriptions (Manage subscription) - 2026-10-08.
 *
 * GET  -> the account's plan, its dates and perks, the ticket balance, the
 *         billing history, and what this deployment can do (checkout live?
 *         DataLink set up for cancelling from here?).
 * POST { action: 'change', planId }      upgrade / downgrade
 *      { action: 'cancel', reason, note } stop the renewal (access lasts to the paid period's end)
 *      { action: 'resume' }               undo a cancellation that hasn't reached CCBill yet (or an admin grant's)
 *      { action: 'clear-schedule' }       forget a scheduled switch
 *
 * Plan changes are CANCEL -> BUY NEW (CCBill can't re-price a running
 * subscription for us yet):
 *   upgrade    a FlexForm checkout for the new plan carrying X-replaces = the
 *              current subscription; the webhook ends the old one only after
 *              the new payment succeeds. Tickets are credited per charge, so
 *              nothing is lost by switching mid-month.
 *   downgrade  the current renewal is cancelled now (no higher charge next
 *              month), the plan keeps its perks to the end of the period, and
 *              the page offers the cheaper plan's checkout from then.
 * Admin-granted subscriptions (no payment provider) have nothing to cancel at
 * CCBill - they change in the database only.
 */

const CANCEL_REASONS = ['too-expensive', 'not-using', 'missing-feature', 'quality', 'switching', 'other'] as const

type Kind = 'ccbill' | 'manual'
type Meta = Record<string, unknown>

const metaOf = (m: unknown): Meta => (m && typeof m === 'object' ? (m as Meta) : {})

/** Which plan a subscription is: metadata.planId, else the retired cycles' nearest (as prompt enhance maps them). */
function planOf(sub: { billingCycle: string | null; metadata: unknown }): CcbillPlan {
  const id = metaOf(sub.metadata).planId
  const p = getCcbillPlan(id)
  if (p) return p
  return getCcbillPlan(sub.billingCycle === 'biweekly' ? 'creator' : 'pro')!
}

const kindOf = (sub: { ccbillSubscriptionId: string | null }): Kind => (sub.ccbillSubscriptionId ? 'ccbill' : 'manual')

async function user() {
  const token = (await cookies()).get('session')?.value
  return token ? await getUserFromSession(token) : null
}

export async function GET() {
  const u = await user()
  if (!u) return jsonPrivate({ error: 'Sign in to manage your subscription' }, { status: 401 })

  const [sub, ticket, history, lastEnded] = await Promise.all([
    findDevTierSubscription(u.id),
    prisma.ticket.findUnique({ where: { userId: u.id }, select: { balance: true } }),
    prisma.subscriptionTransaction.findMany({
      where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, type: true, amount: true, ticketsAdded: true, description: true, createdAt: true },
    }),
    // A plan that ended recently with a switch scheduled - the page offers that plan next
    prisma.subscription.findFirst({
      where: { userId: u.id, tier: 'prompt-studio-dev', endDate: { lt: new Date(), gt: new Date(Date.now() - 60 * 864e5) } },
      orderBy: { endDate: 'desc' },
      select: { metadata: true, endDate: true },
    }),
  ])

  let current = null
  if (sub) {
    const meta = metaOf(sub.metadata)
    const plan = planOf(sub)
    const kind = kindOf(sub)
    current = {
      id: sub.id,
      kind,
      planId: plan.id,
      planName: plan.name,
      // An admin grant may predate the current plans; show what it maps to
      price: sub.billingAmount ?? plan.price,
      ticketsPerCycle: typeof meta.ticketsPerCycle === 'number' ? meta.ticketsPerCycle : plan.tickets,
      status: sub.status,
      renewing: sub.status === 'active' && sub.autoRenew && kind === 'ccbill' && !meta.cancelRequestedAt,
      startDate: sub.startDate.toISOString(),
      nextBillingDate: sub.nextBillingDate?.toISOString() ?? null,
      endDate: (sub.endDate ?? sub.lsCurrentPeriodEnd)?.toISOString() ?? null,
      cancelledAt: sub.cancelledAt?.toISOString() ?? null,
      cancelRequestedAt: typeof meta.cancelRequestedAt === 'string' ? meta.cancelRequestedAt : null,
      scheduledPlanId: getCcbillPlan(meta.scheduledPlanId)?.id ?? null,
      enhancePerDay: ENHANCE_LIMITS[plan.id],
    }
  }
  const endedScheduled = !sub && lastEnded ? getCcbillPlan(metaOf(lastEnded.metadata).scheduledPlanId)?.id ?? null : null

  return jsonPrivate({
    checkoutAvailable: ccbillConfigured(),
    cancelFromHere: ccbillDatalinkConfigured(),
    supportUrl: CCBILL_SUPPORT_URL,
    plans: CCBILL_PLANS.map(p => ({ ...p, enhancePerDay: ENHANCE_LIMITS[p.id] })),
    perks: DEV_TIER_PERKS,
    enhanceFree: ENHANCE_LIMITS.free,
    current,
    endedScheduledPlanId: endedScheduled,
    lastEndedAt: lastEnded?.endDate?.toISOString() ?? null,
    balance: ticket?.balance ?? 0,
    history: history.map(h => ({ ...h, createdAt: h.createdAt.toISOString() })),
    cancelReasons: CANCEL_REASONS,
  })
}

export async function POST(req: Request) {
  const u = await user()
  if (!u) return jsonPrivate({ error: 'Sign in to manage your subscription' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { action?: string; planId?: string; reason?: string; note?: string }
  const sub = await findDevTierSubscription(u.id)
  const bad = (error: string, status = 400) => jsonPrivate({ error }, { status })

  // ── change plan ──
  if (body.action === 'change') {
    const plan = getCcbillPlan(body.planId)
    if (!plan) return bad('Pick a plan')
    if (!ccbillConfigured()) return bad('Plan changes open as soon as payments go live.', 503)

    // No plan right now (or it has run out): an ordinary checkout
    if (!sub) {
      const url = buildFlexFormUrl({ plan, userId: u.id })
      return url ? jsonPrivate({ checkoutUrl: url }) : bad('Checkout is not available right now', 503)
    }
    const cur = planOf(sub)
    if (cur.id === plan.id && kindOf(sub) === 'ccbill' && sub.status === 'active') return bad(`You're already on ${plan.name}`)
    const meta = metaOf(sub.metadata)
    const curPrice = sub.billingAmount ?? cur.price
    const isDowngrade = kindOf(sub) === 'ccbill' && plan.price < curPrice

    if (!isDowngrade) {
      // Upgrade (or replacing an admin grant / a plan already ending): buy the
      // new plan now; the webhook retires this one once the payment lands
      const url = buildFlexFormUrl({ plan, userId: u.id, replacesSubscriptionId: sub.id })
      return url ? jsonPrivate({ checkoutUrl: url }) : bad('Checkout is not available right now', 503)
    }

    // Downgrade: stop the dearer renewal now; the cheaper plan starts when this one ends
    const scheduled = { ...meta, scheduledPlanId: plan.id as CcbillPlanId }
    if (sub.status === 'cancelled' || !sub.autoRenew) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { metadata: scheduled } })
      return jsonPrivate({ ok: true, scheduled: plan.id, endsAt: (sub.endDate ?? sub.nextBillingDate)?.toISOString() ?? null })
    }
    return await stopRenewal(sub, scheduled, `Downgrade to ${plan.name}`)
  }

  // ── cancel ──
  if (body.action === 'cancel') {
    if (!sub) return bad('You have no plan to cancel')
    const reason = CANCEL_REASONS.includes(body.reason as (typeof CANCEL_REASONS)[number]) ? body.reason : null
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : ''
    const meta = { ...metaOf(sub.metadata), cancelReason: reason, ...(note ? { cancelNote: note } : {}) }
    if (kindOf(sub) === 'manual') {
      // An admin grant: nothing is billed, so it simply ends now
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'cancelled', autoRenew: false, cancelledAt: new Date(), endDate: new Date(), metadata: meta },
      })
      return jsonPrivate({ ok: true, endedNow: true })
    }
    if (sub.status === 'cancelled' || !sub.autoRenew) return bad('This plan is already set to end')
    return await stopRenewal(sub, meta, 'Cancellation')
  }

  // ── resume ──
  if (body.action === 'resume') {
    if (!sub) return bad('There is nothing to resume - choose a plan below')
    const meta = metaOf(sub.metadata)
    if (kindOf(sub) === 'ccbill' && meta.cancelRequestedAt && sub.status === 'active') {
      // The cancellation never reached CCBill (it was a request): forget it
      const { cancelRequestedAt: _r, scheduledPlanId: _s, cancelReason: _c, cancelNote: _n, ...rest } = meta
      await prisma.subscription.update({ where: { id: sub.id }, data: { metadata: rest as object } })
      return jsonPrivate({ ok: true })
    }
    // Once CCBill has cancelled a renewal it can't be switched back on from
    // here: subscribe again when the current period ends
    return bad('This plan has already been cancelled at CCBill. You keep everything until it ends, then you can subscribe again.')
  }

  // ── clear a scheduled switch ──
  if (body.action === 'clear-schedule') {
    if (!sub) return bad('Nothing is scheduled')
    const { scheduledPlanId: _s, ...rest } = metaOf(sub.metadata)
    await prisma.subscription.update({ where: { id: sub.id }, data: { metadata: rest as object } })
    return jsonPrivate({ ok: true })
  }

  return bad('Unknown action')
}

/**
 * Stop a CCBill subscription's renewal: through DataLink when it's set up
 * (then it's done - status cancelled, access to the period's end), otherwise
 * recorded as requested and the customer finishes at CCBill's own page; the
 * Cancellation webhook brings our copy in line either way.
 */
async function stopRenewal(sub: { id: number; ccbillSubscriptionId: string | null; nextBillingDate: Date | null }, meta: Meta, what: string) {
  if (ccbillDatalinkConfigured() && sub.ccbillSubscriptionId) {
    const r = await ccbillCancelSubscription(sub.ccbillSubscriptionId)
    if (!r.ok) {
      console.error(`[subscription/manage] ${what}: DataLink cancel failed for ${sub.ccbillSubscriptionId}: ${r.detail}`)
      return jsonPrivate({ error: `We couldn't reach CCBill to stop the renewal. You can cancel it at ${CCBILL_SUPPORT_URL} - your plan stays until the end of the period.`, supportUrl: CCBILL_SUPPORT_URL }, { status: 502 })
    }
    const endDate = sub.nextBillingDate ?? new Date()
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'cancelled', autoRenew: false, cancelledAt: new Date(), endDate, metadata: meta as object },
    })
    return jsonPrivate({ ok: true, endsAt: endDate.toISOString() })
  }
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { metadata: { ...meta, cancelRequestedAt: new Date().toISOString() } as object },
  })
  return jsonPrivate({ ok: true, needsCcbillCancel: true, supportUrl: CCBILL_SUPPORT_URL })
}
