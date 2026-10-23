// POST /api/webhooks/ccbill?secret=<CCBILL_WEBHOOK_SECRET>&eventType=<event>
//
// CCBill Webhooks send form-encoded POSTs (eventType usually in the query
// string). CCBill does NOT sign payloads, so this endpoint:
//   1. Requires the shared secret in the URL (constant-time compare, fail
//      closed when the env var is missing).
//   2. Verifies clientAccnum matches our account.
//   3. Is idempotent: NewSaleSuccess upserts by ccbillSubscriptionId;
//      renewals skip already-processed transaction ids.
//   4. (billing sweep 2026-10-23) Trusts no passthrough field it did not
//      sign: X-userId / X-planId / X-replaces carry our HMAC (X-sig), and the
//      sale's billed price/period must equal the claimed plan's. Plan credits
//      are exactly-once claims inside transactions (lib/plan-tickets), so
//      redeliveries and retries after a crash are both safe.
//
// Register in the CCBill admin (Webhooks) with events: NewSaleSuccess,
// RenewalSuccess, Cancellation, Expiration, Chargeback, Refund.

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyWebhookSecret, expectedClientAccnum, getCcbillPlan, ccbillCancelSubscription, verifyPassthroughSig, saleMatchesPlan, renewalAmountUsd } from '@/lib/ccbill'
import { startPlanTickets, refillPlanTickets, endPlanTickets } from '@/lib/plan-tickets'

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

/** A date CCBill sent (e.g. "2026-11-22"), or null when missing / unparseable. */
function ccbillDate(v: string | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
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
      /*
       * Billing sweep 2026-10-23 - CRITICAL: the X- passthrough fields are NOT
       * covered by CCBill's formDigest (that signs price/period only), so a
       * buyer could pay the Creator price with X-planId=max (or another
       * X-userId / X-replaces) and this handler granted whatever they claimed.
       * Two independent checks now, both fail closed:
       *   1. X-sig: our HMAC over userId|planId|replaces (lib/ccbill
       *      verifyPassthroughSig) - the fields are exactly what the server put
       *      in the form link.
       *   2. The sale's own price/period from CCBill (saleMatchesPlan) equals
       *      the claimed plan's - proof of what was actually paid.
       * A refused sale is acknowledged (200, so CCBill stops retrying) and
       * logged loudly for a manual look; nothing is granted.
       */
      if (!verifyPassthroughSig({ userId: body['X-userId'], planId: body['X-planId'], replaces: body['X-replaces'] ?? '', sig: body['X-sig'] })) {
        console.error(`CCBill NewSaleSuccess REFUSED: bad or missing X-sig (user ${userId}, plan ${plan.id}, sub ${subscriptionId}, tx ${transactionId}) - check it by hand in the CCBill admin`)
        return NextResponse.json({ received: true })
      }
      const priced = saleMatchesPlan(body, plan)
      if (!priced.ok) {
        console.error(`CCBill NewSaleSuccess REFUSED: price/period mismatch - ${priced.reason} (user ${userId}, sub ${subscriptionId}, tx ${transactionId}) - check it by hand in the CCBill admin`)
        return NextResponse.json({ received: true })
      }
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        console.error(`CCBill NewSaleSuccess: unknown user ${userId}`)
        return NextResponse.json({ received: true })
      }

      /*
       * Idempotency, retry-safe (billing sweep 2026-10-23): a subscription row
       * that already exists is NOT the end of it. If the first delivery died
       * after creating the row but before the tickets landed (startPlanTickets
       * threw -> 500 -> CCBill retried), returning here lost the credit for
       * good. Now the retry carries on with the same row; startPlanTickets is
       * itself exactly-once (it claims the subscription in a transaction), so
       * a delivery that already credited credits nothing again.
       */
      const dupe = await prisma.subscription.findUnique({ where: { ccbillSubscriptionId: subscriptionId } })
      if (dupe && dupe.userId !== userId) {
        console.error(`CCBill NewSaleSuccess: subscription ${subscriptionId} belongs to user ${dupe.userId}, event says ${userId} - ignored`)
        return NextResponse.json({ received: true })
      }

      // CCBill names the next charge `nextRenewalDate` (review fix 2026-10-23: this read `renewalDate`, which it never sends on a sale)
      const nextBilling = ccbillDate(body.nextRenewalDate) ?? new Date(Date.now() + plan.periodDays * 24 * 60 * 60 * 1000)

      const created = dupe ?? await prisma.subscription.create({
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
      /*
       * A plan change (X-replaces = the Subscription it replaces, set by
       * /api/user/subscription/manage). The new plan is paid for, so the old
       * one ends now: its renewal is cancelled at CCBill and it stops granting
       * anything. Its unused plan tickets count toward the new plan's bar
       * (the account is filled UP to the new plan, not given it on top);
       * pack tickets carry over untouched (lib/plan-tickets).
       */
      const replacesId = parseInt(body['X-replaces'] ?? '')
      const old = !isNaN(replacesId) ? await prisma.subscription.findFirst({ where: { id: replacesId, userId } }) : null
      const fill = await startPlanTickets(created, old)
      // One history row per real credit (a redelivery that credited nothing writes none)
      if (!fill.already) await recordCharge(created.id, userId, plan.price, fill.credited, fill, `${plan.name} plan - first month (filled to ${plan.tickets} tickets)`, transactionId)

      // Already retired by an earlier delivery of this same sale: nothing more to do
      // (`retiredBy` is written only by the retirement below; startPlanTickets sets replacedBy)
      const oldMeta = (old?.metadata as Record<string, unknown> | null) ?? {}
      if (old && old.id !== created.id && oldMeta.retiredBy !== created.id) {
        let cancelNote: string | null = null
        if (old.ccbillSubscriptionId && old.autoRenew) {
          const r = await ccbillCancelSubscription(old.ccbillSubscriptionId)
          if (!r.ok) {
            // Flag it loudly: the old renewal must be stopped by hand
            cancelNote = r.detail ?? 'cancel failed'
            console.error(`CCBill plan change: could not cancel old subscription ${old.ccbillSubscriptionId} (ours ${old.id}) - cancel it in the CCBill admin. ${cancelNote}`)
          }
        }
        /*
         * ONE statement (review fix 2026-10-23): status/endDate and
         * planTicketsOpen:false land together, so settleEndedPlans can never
         * see the old plan "ended" with its plan tickets still open and end
         * them out of the new plan's bar. (startPlanTickets already closed
         * them inside its credit transaction; this keeps it true regardless.)
         * Metadata is merged in place, never a stale copy written back.
         */
        const patch = JSON.stringify({
          replacedBy: created.id,
          retiredBy: created.id,
          // its plan tickets moved into the new plan's bar - never "end" them again
          planTicketsOpen: false,
          ...(cancelNote ? { ccbillCancelPending: cancelNote } : {}),
        })
        await prisma.$executeRaw`
          UPDATE "Subscription"
          SET status = 'expired', "autoRenew" = false, "endDate" = now(), "cancelledAt" = COALESCE("cancelledAt", now()), "updatedAt" = now(),
              metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb
          WHERE id = ${old.id}`
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
      /*
       * Billing sweep 2026-10-23: the redelivery check used to be a read
       * (sub.ccbillLastTransactionId === transactionId) followed by a separate
       * update - two deliveries at once both passed and both refilled. The
       * claim (move ccbillLastTransactionId to this one only if it is not
       * already this one) now happens INSIDE refillPlanTickets' transaction,
       * so exactly one delivery refills, and a refill that fails rolls the
       * claim back for CCBill's retry. Without a transaction id there is
       * nothing to make it exactly-once with, so it is refused and logged.
       */
      if (!transactionId) {
        console.error(`CCBill RenewalSuccess REFUSED: no transactionId (sub ${subscriptionId}) - check it by hand in the CCBill admin`)
        return NextResponse.json({ received: true })
      }
      const plan = getCcbillPlan((sub.metadata as any)?.planId)
      // The renewal's own charge, when CCBill states it, must cover the plan's price
      const paid = renewalAmountUsd(body)
      const due = sub.billingAmount ?? plan?.price ?? null
      if (paid != null && due != null && Math.round(paid * 100) < Math.round(due * 100)) {
        console.error(`CCBill RenewalSuccess REFUSED: charged ${paid} but the plan costs ${due} (sub ${subscriptionId}, tx ${transactionId}) - check it by hand in the CCBill admin`)
        return NextResponse.json({ received: true })
      }
      // `nextRenewalDate` is the next charge; a renewal's `renewalDate` is THIS charge's date, so it is not used
      const nextBilling = ccbillDate(body.nextRenewalDate)
        ?? (plan ? new Date(Date.now() + plan.periodDays * 24 * 60 * 60 * 1000) : null)

      // Claim + refill to the plan's bar, one transaction - only what was used comes back (lib/plan-tickets)
      const fill = await refillPlanTickets(sub, { ccbillTransactionId: transactionId, nextBillingDate: nextBilling })
      if (fill.already) return NextResponse.json({ received: true })
      await recordCharge(sub.id, sub.userId, sub.billingAmount ?? plan?.price ?? 0, fill.credited, fill, `${plan?.name ?? 'Dev Tier'} plan - renewal (refilled to ${plan?.tickets ?? 'plan'} tickets)`, transactionId)
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
      // The plan's unused tickets end with it; pack tickets stay (lib/plan-tickets)
      const ended = await prisma.subscription.findUnique({ where: { ccbillSubscriptionId: subscriptionId }, select: { id: true, userId: true, metadata: true } })
      if (ended) await endPlanTickets(ended)
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
