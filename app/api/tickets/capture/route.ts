import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { packPriceFor } from '@/lib/plan-tickets'
import { devTierWhere } from '@/lib/dev-tier'

/*
 * POST /api/tickets/capture { orderId, discountCode? } - PayPal ticket packs.
 *
 * Billing sweep 2026-10-23 - this used to credit whatever the order SAID:
 * the ticket count from its reference_id (or a guess from its description /
 * amount, or "1 to avoid total failure"), at whatever amount was captured.
 * Since the PayPal client id is public, anyone can create an order in the
 * browser for any amount with any reference_id, so "TICKETS_825" for $1 was
 * credited as 825 tickets. Now, before ANY money is captured:
 *   1. the order is read back from PayPal (GET) - it must be for this
 *      account (custom_id set by /api/tickets/purchase), in USD, for a real
 *      pack (lib/ticket-pricing TICKET_PACKAGES), at exactly the price the
 *      server computes for it (lib/plan-tickets packPriceFor: pack, plan
 *      discount, re-validated discount code);
 *   2. a discount code's single use is claimed (so it can't ride on two
 *      orders at once), and released again if the capture fails;
 * then it is captured, the CAPTURED amount/currency/status are checked again,
 * and the purchase rows + the ticket credit are written in ONE transaction,
 * keyed by the order id (TicketPurchase.paypalOrderId is unique) - a repeat
 * call credits nothing twice. Prices are unchanged.
 */

const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalAccessToken() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured')
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const data = await response.json()
  return data.access_token
}

const cents = (v: unknown) => Math.round(Number(v) * 100)

export async function POST(request: Request) {
  try {
    // Check authentication
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as { orderId?: unknown; discountCode?: unknown }
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId || !/^[A-Za-z0-9-]{5,64}$/.test(orderId)) {
      return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })
    }

    // Already credited (a repeat call / double click): answer with what was done, credit nothing
    const done = await prisma.ticketPurchase.findUnique({ where: { paypalOrderId: orderId }, select: { id: true, userId: true, ticketsCount: true } })
    if (done) {
      if (done.userId !== user.id) return NextResponse.json({ error: 'That order belongs to another account' }, { status: 403 })
      const t = await prisma.ticket.findUnique({ where: { userId: user.id }, select: { balance: true } })
      return NextResponse.json({ success: true, purchaseId: done.id, ticketsAdded: 0, newBalance: t?.balance ?? 0, message: 'This purchase was already added to your account.' })
    }

    const accessToken = await getPayPalAccessToken()

    // ── 1. read the order back and check it BEFORE capturing anything ──
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    const order = await orderRes.json().catch(() => ({})) as Record<string, any>
    if (!orderRes.ok) {
      return NextResponse.json({ error: 'Could not read that PayPal order' }, { status: 400 })
    }
    const unit = order.purchase_units?.[0] ?? {}
    const referenceId = String(unit.reference_id ?? '')
    const ticketsClaimed = referenceId.startsWith('TICKETS_') ? parseInt(referenceId.slice('TICKETS_'.length)) : NaN
    /*
     * COMPLETED = captured on an earlier call whose credit then failed (the
     * transaction below rolled back): it is credited now from the capture
     * PayPal already holds, without capturing again. Nothing else is.
     */
    const alreadyCaptured = order.status === 'COMPLETED'
    if (order.intent !== 'CAPTURE' || !(order.status === 'APPROVED' || alreadyCaptured)) {
      return NextResponse.json({ error: `That order can't be captured (${String(order.status ?? 'unknown')})` }, { status: 409 })
    }
    if (unit.custom_id !== `user:${user.id}`) {
      console.error(`Ticket capture REFUSED: order ${orderId} is not this account's (custom_id ${String(unit.custom_id)}, user ${user.id})`)
      return NextResponse.json({ error: 'That order was not made for this account' }, { status: 403 })
    }
    const price = await packPriceFor(user.id, ticketsClaimed, body.discountCode, { codeClaimed: alreadyCaptured })
    if (!price.ok) {
      return NextResponse.json({ error: price.error }, { status: 400 })
    }
    if (unit.amount?.currency_code !== 'USD' || cents(unit.amount?.value) !== cents(price.usd)) {
      console.error(`Ticket capture REFUSED: order ${orderId} is for ${unit.amount?.value} ${unit.amount?.currency_code}, ${price.tickets} tickets cost ${price.usd.toFixed(2)} USD (user ${user.id})`)
      return NextResponse.json({ error: "That order's price doesn't match the pack - nothing was charged. Please start the purchase again." }, { status: 409 })
    }

    // ── 2. a discount code's one use is claimed before the money moves ──
    let codeClaimed = false
    if (price.code && !alreadyCaptured) {
      try {
        await prisma.discountUsage.create({ data: { userId: user.id, discountCodeId: price.code.id } })
        codeClaimed = true
        const counted = await prisma.$executeRaw`
          UPDATE "DiscountCode" SET "timesUsed" = "timesUsed" + 1
          WHERE id = ${price.code.id} AND ("usageLimit" IS NULL OR "timesUsed" < "usageLimit")`
        if (!counted) throw new Error('limit reached')
      } catch {
        if (codeClaimed) await prisma.discountUsage.deleteMany({ where: { userId: user.id, discountCodeId: price.code.id } }).catch(() => {})
        return NextResponse.json({ error: 'That discount code can no longer be used - nothing was charged.' }, { status: 409 })
      }
    }
    const releaseCode = async () => {
      if (!price.code) return
      await prisma.discountUsage.deleteMany({ where: { userId: user.id, discountCodeId: price.code.id } }).catch(() => {})
      await prisma.$executeRaw`UPDATE "DiscountCode" SET "timesUsed" = GREATEST(0, "timesUsed" - 1) WHERE id = ${price.code.id}`.catch(() => {})
    }

    // ── 3. capture (or, for an order captured before, the capture PayPal already holds) ──
    const captureResponse = alreadyCaptured ? null : await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        // PayPal's idempotency key: a retried capture call is the same capture
        'PayPal-Request-Id': `tickets-capture-${orderId}`,
      },
    })
    const captureData = captureResponse ? await captureResponse.json().catch(() => ({})) as Record<string, any> : order
    if (captureResponse && !captureResponse.ok) {
      await releaseCode()
      console.error('PayPal capture failed:', orderId, captureData?.name, captureData?.message)
      return NextResponse.json(
        { error: 'Payment capture failed', details: captureData.message || captureData.error || 'Unknown error' },
        { status: 500 }
      )
    }

    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0]
    if (!capture) {
      console.error('No capture data in response for order', orderId)
      return NextResponse.json({ error: 'Invalid payment response from PayPal' }, { status: 500 })
    }

    // ── 4. what was really captured must be what the pack costs ──
    if (capture.amount?.currency_code !== 'USD' || cents(capture.amount?.value) !== cents(price.usd)) {
      console.error(`Ticket capture NOT CREDITED: order ${orderId} captured ${capture.amount?.value} ${capture.amount?.currency_code}, expected ${price.usd.toFixed(2)} USD (user ${user.id}) - refund or credit it by hand`)
      return NextResponse.json({ error: 'The captured amount does not match the pack - contact support with your PayPal receipt.' }, { status: 409 })
    }
    if (capture.status !== 'COMPLETED') {
      // A PENDING capture (eCheck, PayPal review) has not paid us yet
      console.error(`Ticket capture NOT CREDITED: order ${orderId} capture ${capture.id} is ${capture.status} (user ${user.id}) - credit it by hand once PayPal completes it`)
      return NextResponse.json({ error: `PayPal has the payment as ${String(capture.status).toLowerCase()} - your tickets are added once it completes. Contact support if they don't arrive.` }, { status: 202 })
    }

    const amount = price.usd
    const ticketsCount = price.tickets
    const captureId = capture.id
    const payerId = captureData.payer?.payer_id ?? null
    const description = unit.description || `${ticketsCount} AI Generation Tickets`
    const payerEmail = captureData.payer?.email_address || null
    const payerName = captureData.payer?.name
      ? `${captureData.payer.name.given_name || ''} ${captureData.payer.name.surname || ''}`.trim()
      : null
    const paypalFee = capture.seller_receivable_breakdown?.paypal_fee?.value
      ? parseFloat(capture.seller_receivable_breakdown.paypal_fee.value)
      : null
    const netAmount = capture.seller_receivable_breakdown?.net_amount?.value
      ? parseFloat(capture.seller_receivable_breakdown.net_amount.value)
      : null
    const billingAddress = captureData.payer?.address || captureData.purchase_units?.[0]?.shipping?.address || null

    // ── 5. the records and the credit, all or nothing, once per order ──
    let credited: { purchaseId: number; balance: number }
    try {
      credited = await prisma.$transaction(async (tx) => {
        /*
         * A discount code's one use, made certain here (review fix 2026-10-23):
         * under a per-user-and-code lock, no OTHER credited purchase may carry
         * the code - two orders racing on one claim can't both be credited.
         */
        if (price.code) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`discount-${user.id}-${price.code.id}`}))`
          const other = await tx.ticketPurchase.count({ where: { userId: user.id, discountCodeUsed: price.code.code, NOT: { paypalOrderId: orderId } } })
          if (other) throw Object.assign(new Error('discount code already used'), { code: 'DISCOUNT_REUSED' })
        }
        const purchase = await tx.ticketPurchase.create({
          data: {
            userId: user.id,
            ticketsCount,
            amount,
            paypalOrderId: orderId,
            paypalCaptureId: captureId,
            paypalPayerId: payerId,
            payerEmail,
            payerName,
            paymentStatus: 'completed',
            paypalFee,
            netAmount,
            currency: 'USD',
            billingAddress,
            description,
            discountCodeUsed: price.code?.code ?? null,
            originalAmount: price.listUsd,
            discountAmount: Math.max(0, Math.round((price.listUsd - amount) * 100) / 100),
          },
        })
        // Purchase history display
        await tx.purchase.create({
          data: {
            userId: user.id,
            itemType: 'tickets',
            itemId: purchase.id,
            amount,
            currency: 'USD',
            paypalOrderId: orderId,
            paypalCaptureId: captureId,
            paypalPayerId: payerId,
            payerEmail,
            payerName,
            paymentStatus: 'completed',
            paypalFee,
            netAmount,
            billingAddress,
            description,
            discountCodeUsed: price.code?.code ?? null,
          },
        })
        const ticketRecord = await tx.ticket.upsert({
          where: { userId: user.id },
          create: { userId: user.id, balance: ticketsCount, totalBought: ticketsCount, totalUsed: 0 },
          update: { balance: { increment: ticketsCount }, totalBought: { increment: ticketsCount } },
          select: { balance: true },
        })
        /*
         * Pack tickets never expire - while a plan runs they are recorded as
         * pack tickets so its refill / end never touches them. This used to be
         * notePackTickets AFTER the credit (a separate read-then-write whose
         * errors were only logged); it is now an atomic jsonb update in the
         * same transaction (review fix 2026-10-23), with lib/plan-tickets'
         * rule: pack = min(recorded pack, balance before) + added.
         */
        const balanceBefore = ticketRecord.balance - ticketsCount
        const plan = await tx.subscription.findFirst({ where: { userId: user.id, ...devTierWhere() }, orderBy: { createdAt: 'desc' }, select: { id: true } })
        if (plan) {
          await tx.$executeRaw`
            UPDATE "Subscription"
            SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || jsonb_build_object('packTickets',
                  LEAST(GREATEST(0, FLOOR(COALESCE((metadata::jsonb ->> 'packTickets')::numeric, ${balanceBefore}))), GREATEST(0, ${balanceBefore})) + ${ticketsCount})
            WHERE id = ${plan.id} AND metadata::jsonb ->> 'planTicketsOpen' = 'true'`
        }
        return { purchaseId: purchase.id, balance: ticketRecord.balance }
      })
    } catch (e: any) {
      // The unique order id: a concurrent call already credited this order
      if (e?.code === 'DISCOUNT_REUSED') {
        console.error(`Ticket capture NOT CREDITED: order ${orderId} reuses discount code ${price.code?.code} already spent by user ${user.id} - refund it in PayPal`)
        return NextResponse.json({ error: 'That discount code was already used on another purchase - contact support about this payment.' }, { status: 409 })
      }
      if (e?.code === 'P2002') {
        const t = await prisma.ticket.findUnique({ where: { userId: user.id }, select: { balance: true } })
        return NextResponse.json({ success: true, ticketsAdded: 0, newBalance: t?.balance ?? 0, message: 'This purchase was already added to your account.' })
      }
      throw e
    }

    return NextResponse.json({
      success: true,
      purchaseId: credited.purchaseId,
      ticketsAdded: ticketsCount,
      newBalance: credited.balance,
      message: `Successfully added ${ticketsCount} ticket${ticketsCount > 1 ? 's' : ''} to your account!`,
    })

  } catch (error: any) {
    console.error('=== TICKET PURCHASE CAPTURE ERROR ===')
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
