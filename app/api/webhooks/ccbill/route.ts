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
import { verifyWebhookSecret, expectedClientAccnum, getCcbillPlan } from '@/lib/ccbill'

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

async function creditTickets(userId: number, tickets: number) {
  await prisma.ticket.upsert({
    where: { userId },
    create: { userId, balance: tickets, totalBought: tickets, totalUsed: 0 },
    update: { balance: { increment: tickets }, totalBought: { increment: tickets } },
  })
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

      await prisma.subscription.create({
        data: {
          userId,
          tier: 'prompt-studio-dev',
          status: 'active',
          billingCycle: plan.id,
          billingAmount: plan.price,
          nextBillingDate: nextBilling,
          autoRenew: true,
          ccbillSubscriptionId: subscriptionId,
          ccbillLastTransactionId: transactionId || null,
          metadata: { provider: 'ccbill', planName: plan.name, ticketsPerCycle: plan.tickets },
        },
      })
      await creditTickets(userId, plan.tickets)
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
      const plan = getCcbillPlan(sub.billingCycle)
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
      if (tickets > 0) await creditTickets(sub.userId, tickets)
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
