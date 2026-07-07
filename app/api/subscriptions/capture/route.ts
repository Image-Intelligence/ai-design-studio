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

    const { interval = 'monthly', tickets = 0, plan = 'legacy' } = planInfo;

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

    // Create subscription in database
    const subscription = await prisma.subscription.create({
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

    // Add tickets to user's account if included in plan
    if (tickets > 0) {
      const userTicket = await prisma.ticket.findUnique({
        where: { userId: user.id },
      });

      if (userTicket) {
        await prisma.ticket.update({
          where: { userId: user.id },
          data: {
            balance: userTicket.balance + tickets,
            totalBought: userTicket.totalBought + tickets,
          },
        });
      } else {
        // Create ticket record if it doesn't exist
        await prisma.ticket.create({
          data: {
            userId: user.id,
            balance: tickets,
            totalBought: tickets,
            totalUsed: 0,
          },
        });
      }

      console.log(`✅ Added ${tickets} tickets to user ${user.id}`);
    }

    // Log the purchase
    await prisma.purchase.create({
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

    console.log(`✅ Subscription created for user ${user.id}: ${subscription.id} (${interval}, ${tickets} tickets)`);

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      ticketsAdded: tickets,
    });
  } catch (error) {
    console.error('Subscription capture error:', error);
    return NextResponse.json(
      { error: 'Failed to process subscription payment' },
      { status: 500 }
    );
  }
}
