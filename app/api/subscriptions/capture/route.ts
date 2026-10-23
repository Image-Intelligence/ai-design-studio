// app/api/subscriptions/capture/route.ts
// Captures PayPal payment and creates subscription in database

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';


const PAYPAL_API = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');

  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  return data.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;
    const user = token ? await getUserFromSession(token) : null;
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
    }

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken();

    // Capture the payment
    const captureResponse = await fetch(
      `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = await captureResponse.json();

    if (!captureResponse.ok || captureData.status !== 'COMPLETED') {
      console.error('PayPal capture failed:', captureData);
      return NextResponse.json(
        { error: 'Payment capture failed' },
        { status: 500 }
      );
    }

    // Extract payment details
    const captureDetails = captureData.purchase_units[0].payments.captures[0];
    const amount = parseFloat(captureDetails.amount.value);

    // Parse custom_id to get plan details
    const customId = captureData.purchase_units[0].payments.captures[0].custom_id ||
                     captureData.purchase_units[0].custom_id;
    let planInfo;
    try {
      planInfo = JSON.parse(customId);
    } catch (e) {
      // Fallback for old format
      planInfo = {
        tier: 'prompt-studio-dev',
        interval: 'monthly',
        tickets: 0,
        plan: 'legacy',
      };
    }

    const { interval = 'monthly', plan = 'legacy' } = planInfo;

    /*
     * Billing sweep 2026-10-23: the ticket count came from the order's
     * custom_id and was credited as-is. The PayPal client id is public, so an
     * order can be made in the browser with any custom_id and any amount -
     * {"tickets":100000} for $0.01 was credited. The credit is now decided
     * here: the order must be this account's (custom_id.userId), and the
     * CAPTURED amount + currency must be exactly the plan's price from the
     * same table /api/subscriptions/purchase validates against (prices
     * unchanged). Anything else is logged and not credited.
     */
    const VALID_PLANS: Record<string, { amount: number; tickets: number }> = {
      biweekly: { amount: 20, tickets: 250 },
      monthly: { amount: 40, tickets: 500 },
      yearly: { amount: 480, tickets: 500 },
    };
    const planRow = VALID_PLANS[String(interval)];
    if (
      !planRow ||
      Number(planInfo?.userId) !== user.id ||
      captureDetails.amount?.currency_code !== 'USD' ||
      Math.round(amount * 100) !== Math.round(planRow.amount * 100)
    ) {
      console.error(`Subscription capture NOT CREDITED: order ${orderId} captured ${captureDetails.amount?.value} ${captureDetails.amount?.currency_code} for interval ${String(interval)} / user ${String(planInfo?.userId)} (session user ${user.id}) - check it by hand`);
      return NextResponse.json({ error: 'That payment does not match a plan - contact support with your PayPal receipt.' }, { status: 409 });
    }
    const tickets = planRow.tickets;

    // Calculate next billing date based on interval
    const now = new Date();
    const nextBillingDate = new Date(now);

    if (interval === 'biweekly') {
      nextBillingDate.setDate(nextBillingDate.getDate() + 14);
    } else if (interval === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (interval === 'yearly') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    /*
     * The subscription, the ticket credit and the purchase log in ONE
     * transaction, once per order (advisory lock on the order id + a check
     * for an existing row). The balance is an atomic increment - it used to
     * be read, then overwritten with read+tickets, so a generation charged in
     * between was silently undone (or the credit lost).
     */
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'paypal-sub-order-' + String(orderId)}))`;
      const existing = await tx.subscription.findFirst({ where: { paypalOrderId: String(orderId), userId: user.id }, select: { id: true } });
      if (existing) return { subscriptionId: existing.id, ticketsAdded: 0 };

      const subscription = await tx.subscription.create({
        data: {
          userId: user.id,
          tier: 'prompt-studio-dev',
          status: 'active',
          billingAmount: amount,
          billingCycle: interval,
          nextBillingDate: nextBillingDate,
          autoRenew: true,
          paypalOrderId: orderId,
          paypalCaptureId: captureDetails.id,
          metadata: {
            plan,
            ticketsPerCycle: tickets,
          },
        },
      });

      if (tickets > 0) {
        await tx.ticket.upsert({
          where: { userId: user.id },
          create: { userId: user.id, balance: tickets, totalBought: tickets, totalUsed: 0 },
          update: { balance: { increment: tickets }, totalBought: { increment: tickets } },
        });
        console.log(`✅ Added ${tickets} tickets to user ${user.id}`);
      }

      // Log the purchase
      await tx.purchase.create({
        data: {
          userId: user.id,
          itemType: 'subscription',
          amount: amount,
          currency: 'USD',
          paypalOrderId: orderId,
          paypalPayerId: captureDetails.payer?.payer_id || '',
          paymentStatus: 'completed',
          description: `${interval} subscription with ${tickets} tickets`,
          billingAddress: captureDetails.payer?.address || null,
        },
      });
      return { subscriptionId: subscription.id, ticketsAdded: tickets };
    });

    console.log(`✅ Subscription created for user ${user.id}: ${result.subscriptionId} (${interval}, ${result.ticketsAdded} tickets)`);

    return NextResponse.json({
      success: true,
      subscriptionId: result.subscriptionId,
      ticketsAdded: result.ticketsAdded,
    });
  } catch (error) {
    console.error('Subscription capture error:', error);
    return NextResponse.json(
      { error: 'Failed to process subscription payment' },
      { status: 500 }
    );
  }
}
