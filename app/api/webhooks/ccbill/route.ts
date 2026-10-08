// POST /api/webhooks/ccbill?secret=<CCBILL_WEBHOOK_SECRET>&eventType=<event>
//
// CCBill Webhooks send form-encoded POSTs (eventType usually in the query
// string). CCBill does NOT sign payloads, so this endpoint:
//   1. Requires the shared secret in the URL (constant-time compare, fail
//      closed when the env var is missing).
//   2. Verifies clientAccnum matches our account.
//   3. Is idempotent: NewSaleSuccess upserts by ccbillSubscriptionId;
//      renewals skip already-processed transaction ids.
//
// Register in the CCBill admin (Webhooks) with events: NewSaleSuccess,
// RenewalSuccess, Cancellation, Expiration, Chargeback, Refund.

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyWebhookSecret, expectedClientAccnum, getCcbillPlan, ccbillCancelSubscription } from '@/lib/ccbill'

export const dynamic = 'force-dynamic'

async function parseBody(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ct = request.headers.get('content-type') ?? ''
  try {
    if (ct.includes('application/json')) {
      const j = await request.json()
      if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries(j)) out[k] = String(v)
      }
    } else {
      const fd = await request.formData()
      fd.forEach((v, k) => { out[k] = String(v) })
    }
  } catch {}
  return out
}

async function creditTickets(userId: number, tickets: number): Promise<{ before: number; after: number }> {
  const before = (await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0
  const t = await prisma.ticket.upsert({
    where: { userId },
    create: { userId, balance: tickets, totalBought: tickets, totalUsed: 0 },
    update: { balance: { increment: tickets }, totalBought: { increment: tickets } },
    select: { balance: true },
  })
  return { before, after: t.balance }
}

/**
 * The billing history /subscriptions shows: one payment row and one ticket
 * row per successful charge. Best effort - a history row must never fail the
 * webhook (CCBill would retry and the idempotency guards make that safe, but
 * there's no reason to bounce a good payment over a log line).
 */
async function recordCharge(subscriptionId: number, userId: number, amount: number, tickets: number, balance: { before: number; after: number }, description: string, transactionId: string) {
  try {
    await prisma.subscriptionTransaction.createMany({
      data: [
        { subscriptionId, userId, type: 'payment', amount, description, metadata: { provider: 'ccbill', transactionId: transactionId || null } },
        { subscriptionId, userId, type: 'ticket_distribution', ticketsAdded: tickets, previousBalance: balance.before, newBalance: balance.after, description: `${tickets} tickets credited` },
      ],
    })
  } catch (e) {
    console.error('CCBill webhook: could not record billing history', e)
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (!verifyWebhookSecret(url.searchParams.get('secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await parseBody(request)
  const eventType = url.searchParams.get('eventType') ?? body.eventType ?? ''

  // Wrong-account traffic is dropped (200 so CCBill doesn't retry forever)
  const accnum = body.clientAccnum ?? ''
  const expected = expectedClientAccnum()
  if (expected && accnum && accnum !== expected) {
    console.warn(`CCBill webhook: clientAccnum mismatch (${accnum})`)
    return NextResponse.json({ received: true })
  }

  const subscriptionId = body.subscriptionId ?? ''
  const transactionId = body.transactionId ?? ''

  try {
    if (eventType === 'NewSaleSuccess') {
      const userId = parseInt(body['X-userId'] ?? '')
      const plan = getCcbillPlan(body['X-planId'])
      if (isNaN(userId) || !plan || !subscriptionId) {
        console.error('CCBill NewSaleSuccess missing fields', { userId, planId: body['X-planId'], subscriptionId })
        return NextResponse.json({ received: true })
      }
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        console.error(`CCBill NewSaleSuccess: unknown user ${userId}`)
        return NextResponse.json({ received: true })
      }

      // Idempotency: this subscription was already recorded
      const dupe = await prisma.subscription.findUnique({
        where: { ccbillSubscriptionId: subscriptionId },
        select: { id: true },
      })
      if (dupe) return NextResponse.json({ received: true })

      const nextBilling = body.renewalDate
        ? new Date(body.renewalDate)
        : new Date(Date.now() + plan.periodDays * 24 * 60 * 60 * 1000)

      const created = await prisma.subscription.create({
        data: {
          userId,
          tier: 'prompt-studio-dev',
          status: 'active',
          // The cycle, not the plan id: admin tools compute periods from it.
          // Which plan it is lives in metadata.planId.
          billingCycle: plan.cycle,
          billingAmount: plan.price,
          nextBillingDate: nextBilling,
          autoRenew: true,
          ccbillSubscriptionId: subscriptionId,
          ccbillLastTransactionId: transactionId || null,
          metadata: { provider: 'ccbill', planId: plan.id, planName: plan.name, ticketsPerCycle: plan.tickets },
        },
      })
      const bal = await creditTickets(userId, plan.tickets)
      await recordCharge(created.id, userId, plan.price, plan.tickets, bal, `${plan.name} plan - first month`, transactionId)

      /*
       * A plan change (X-replaces = the Subscription it replaces, set by
       * /api/user/subscription/manage). The new plan is paid for, so the old
       * one ends now: its renewal is cancelled at CCBill and it stops granting
       * anything. Tickets it already credited stay with the account.
       */
      const replacesId = parseInt(body['X-replaces'] ?? '')
      if (!isNaN(replacesId)) {
        const old = await prisma.subscription.findFirst({ where: { id: replacesId, userId } })
        if (old && old.id !== created.id) {
          let cancelNote: string | null = null
          if (old.ccbillSubscriptionId && old.autoRenew) {
            const r = await ccbillCancelSubscription(old.ccbillSubscriptionId)
            if (!r.ok) {
              // Flag it loudly: the old renewal must be stopped by hand
              cancelNote = r.detail ?? 'cancel failed'
              console.error(`CCBill plan change: could not cancel old subscription ${old.ccbillSubscriptionId} (ours ${old.id}) - cancel it in the CCBill admin. ${cancelNote}`)
            }
          }
          await prisma.subscription.update({
            where: { id: old.id },
            data: {
              status: 'expired',
              autoRenew: false,
              endDate: new Date(),
              cancelledAt: old.cancelledAt ?? new Date(),
              metadata: {
                ...((old.metadata as Record<string, unknown> | null) ?? {}),
                replacedBy: created.id,
                ...(cancelNote ? { ccbillCancelPending: cancelNote } : {}),
              },
            },
          })
        }
      }
      return NextResponse.json({ received: true })
    }

    if (eventType === 'RenewalSuccess') {
      if (!subscriptionId) return NextResponse.json({ received: true })
      const sub = await prisma.subscription.findUnique({
        where: { ccbillSubscriptionId: subscriptionId },
      })
      if (!sub) {
        console.error(`CCBill RenewalSuccess: unknown subscription ${subscriptionId}`)
        return NextResponse.json({ received: true })
      }
      // Idempotency: skip a redelivered renewal
      if (transactionId && sub.ccbillLastTransactionId === transactionId) {
        return NextResponse.json({ received: true })
      }
      const plan = getCcbillPlan((sub.metadata as any)?.planId)
      const tickets = plan?.tickets
        ?? (typeof (sub.metadata as any)?.ticketsPerCycle === 'number' ? (sub.metadata as any).ticketsPerCycle : 0)
      const nextBilling = body.renewalDate
        ? new Date(body.renewalDate)
        : plan
          ? new Date(Date.now() + plan.periodDays * 24 * 60 * 60 * 1000)
          : null

      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'active',
          ...(nextBilling ? { nextBillingDate: nextBilling } : {}),
          ...(transactionId ? { ccbillLastTransactionId: transactionId } : {}),
        },
      })
      if (tickets > 0) {
        const bal = await creditTickets(sub.userId, tickets)
        await recordCharge(sub.id, sub.userId, sub.billingAmount ?? plan?.price ?? 0, tickets, bal, `${plan?.name ?? 'Dev Tier'} plan - renewal`, transactionId)
      }
      return NextResponse.json({ received: true })
    }

    if (eventType === 'Cancellation') {
      if (!subscriptionId) return NextResponse.json({ received: true })
      // Access continues until the paid period ends (nextBillingDate)
      await prisma.subscription.updateMany({
        where: { ccbillSubscriptionId: subscriptionId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          autoRenew: false,
        },
      })
      const sub = await prisma.subscription.findUnique({
        where: { ccbillSubscriptionId: subscriptionId },
        select: { id: true, nextBillingDate: true, endDate: true },
      })
      if (sub && !sub.endDate && sub.nextBillingDate) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { endDate: sub.nextBillingDate },
        })
      }
      return NextResponse.json({ received: true })
    }

    if (eventType === 'Expiration' || eventType === 'Chargeback' || eventType === 'Refund') {
      if (!subscriptionId) return NextResponse.json({ received: true })
      await prisma.subscription.updateMany({
        where: { ccbillSubscriptionId: subscriptionId },
        data: {
          status: 'expired',
          autoRenew: false,
          endDate: new Date(),
        },
      })
      return NextResponse.json({ received: true })
    }

    // Unhandled event types are acknowledged so CCBill stops retrying
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error(`CCBill webhook error (${eventType}):`, error)
    // 500 → CCBill retries later; safe because every branch is idempotent
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
