// PayPal Subscription Webhook Handler
// Handles events from PayPal for subscription lifecycle

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import crypto from 'crypto';


const PAYPAL_API = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

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

// Verify webhook signature from PayPal
async function verifyWebhookSignature(req: NextRequest, body: any): Promise<boolean> {
  if (!PAYPAL_WEBHOOK_ID) {
    console.warn('⚠️ PAYPAL_WEBHOOK_ID not set - skipping signature verification');
    return true; // Allow in development
  }

  const accessToken = await getPayPalAccessToken();

  const headers = {
    'transmission-id': req.headers.get('paypal-transmission-id') || '',
    'transmission-time': req.headers.get('paypal-transmission-time') || '',
    'cert-url': req.headers.get('paypal-cert-url') || '',
    'auth-algo': req.headers.get('paypal-auth-algo') || '',
    'transmission-sig': req.headers.get('paypal-transmission-sig') || '',
  };

  const verifyResponse = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      transmission_id: headers['transmission-id'],
      transmission_time: headers['transmission-time'],
      cert_url: headers['cert-url'],
      auth_algo: headers['auth-algo'],
      transmission_sig: headers['transmission-sig'],
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    }),
  });

  const verifyData = await verifyResponse.json();
  return verifyData.verification_status === 'SUCCESS';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.event_type;

    console.log(`\n📨 PayPal Webhook Received: ${eventType}`);
    console.log('Event ID:', body.id);

    // Verify webhook signature (important for production!)
    const isValid = await verifyWebhookSignature(req, body);
    if (!isValid) {
      console.error('❌ Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Handle different event types
    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        await handleSubscriptionCreated(body);
        break;

      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(body);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        await handlePaymentCompleted(body);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(body);
        break;

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        await handleSubscriptionSuspended(body);
        break;

      case 'BILLING.SUBSCRIPTION.EXPIRED':
        await handleSubscriptionExpired(body);
        break;

      case 'BILLING.SUBSCRIPTION.UPDATED':
        await handleSubscriptionUpdated(body);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// BILLING.SUBSCRIPTION.CREATED - User clicked subscribe
async function handleSubscriptionCreated(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`✅ Subscription created: ${paypalSubscriptionId}`);
  console.log('Status:', resource.status);

  // Parse custom_id to get userId
  let userId: number;
  try {
    const customData = JSON.parse(resource.custom_id);
    userId = customData.userId;
  } catch (err) {
    console.error('Failed to parse custom_id:', err);
    return;
  }

  // Create subscription record (status: pending until activated)
  const subscription = await prisma.subscription.create({
    data: {
      userId: userId,
      tier: 'prompt-studio-dev',
      status: 'pending',
      paypalSubscriptionId: paypalSubscriptionId,
      startDate: new Date(resource.create_time),
      autoRenew: true,
    },
  });

  console.log(`📝 Created subscription record ID: ${subscription.id}`);
}

// BILLING.SUBSCRIPTION.ACTIVATED - First payment processed, subscription active
async function handleSubscriptionActivated(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`✅ Subscription activated: ${paypalSubscriptionId}`);

  // Get billing info
  const billingInfo = resource.billing_info;
  const planId = resource.plan_id;

  // Calculate next billing date
  const nextBillingTime = billingInfo?.next_billing_time
    ? new Date(billingInfo.next_billing_time)
    : null;

  // Get plan details to determine amount and cycle
  let billingAmount: number | null = null;
  let billingCycle: string | null = null;

  if (resource.plan_overridden?.billing_cycles) {
    const cycle = resource.plan_overridden.billing_cycles[0];
    billingAmount = parseFloat(cycle?.pricing_scheme?.fixed_price?.value || '0');
    const frequency = cycle?.frequency;
    billingCycle = `${frequency?.interval_count} ${frequency?.interval_unit}`.toLowerCase();
  }

  // Update subscription to active
  const subscription = await prisma.subscription.updateMany({
    where: { paypalSubscriptionId: paypalSubscriptionId },
    data: {
      status: 'active',
      billingAmount: billingAmount,
      billingCycle: billingCycle,
      nextBillingDate: nextBillingTime,
      startDate: new Date(resource.start_time || resource.create_time),
      metadata: {
        planId: planId,
        subscriber: resource.subscriber,
      },
    },
  });

  console.log(`✅ Activated subscription (updated ${subscription.count} records)`);

  // Get the subscription record to create initial payment transaction
  const activatedSub = await prisma.subscription.findFirst({
    where: { paypalSubscriptionId: paypalSubscriptionId },
  });

  if (activatedSub && billingAmount) {
    // Create initial payment transaction record
    await prisma.subscriptionTransaction.create({
      data: {
        subscriptionId: activatedSub.id,
        userId: activatedSub.userId,
        type: 'payment',
        amount: billingAmount,
        paypalTransactionId: resource.id, // Subscription ID as reference
        description: `Initial subscription payment - ${billingCycle}`,
        metadata: {
          planId: planId,
          billingCycle: billingCycle,
          isInitialPayment: true,
          activationTime: resource.start_time || resource.create_time,
        }
      }
    });

    console.log(`✅ Created initial payment transaction record: $${billingAmount}`);
  }

  // Award initial tickets based on plan
  await awardTickets(paypalSubscriptionId, billingAmount);
}

// PAYMENT.SALE.COMPLETED - Recurring payment processed successfully
async function handlePaymentCompleted(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.billing_agreement_id;
  const amount = parseFloat(resource.amount.total);
  const paypalTransactionId = resource.id; // Capture ID

  if (!paypalSubscriptionId) {
    console.log('ℹ️ Payment not associated with subscription');
    return;
  }

  console.log(`💰 Payment completed: $${amount} for subscription ${paypalSubscriptionId}`);

  // Get subscription
  const subscription = await prisma.subscription.findFirst({
    where: { paypalSubscriptionId: paypalSubscriptionId },
  });

  if (!subscription) {
    console.error('Subscription not found for payment');
    return;
  }

  // Create payment transaction record
  await prisma.subscriptionTransaction.create({
    data: {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      type: 'payment',
      amount: amount,
      paypalTransactionId: paypalTransactionId,
      description: `PayPal subscription payment - ${subscription.billingCycle}`,
      metadata: {
        paypalSubscriptionId: paypalSubscriptionId,
        billingCycle: subscription.billingCycle,
        paymentDetails: {
          state: resource.state,
          paymentMode: resource.payment_mode,
          createTime: resource.create_time,
          updateTime: resource.update_time,
        }
      }
    }
  });

  console.log(`✅ Created payment transaction record: $${amount}`);

  // Award tickets for this billing cycle
  await awardTickets(paypalSubscriptionId, amount);

  // Update next billing date
  if (subscription.billingCycle) {
    // Calculate next billing date based on cycle
    const now = new Date();
    let nextBilling = new Date(now);

    if (subscription.billingCycle.includes('biweekly') || subscription.billingCycle.includes('2 week')) {
      nextBilling.setDate(nextBilling.getDate() + 14);
    } else if (subscription.billingCycle.includes('month')) {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    } else if (subscription.billingCycle.includes('year')) {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { nextBillingDate: nextBilling },
    });
  }
}

// BILLING.SUBSCRIPTION.CANCELLED - User or admin cancelled subscription
async function handleSubscriptionCancelled(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`❌ Subscription cancelled: ${paypalSubscriptionId}`);

  const subscription = await prisma.subscription.updateMany({
    where: { paypalSubscriptionId: paypalSubscriptionId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      autoRenew: false,
      // Keep endDate as-is - user retains access until then
    },
  });

  console.log(`✅ Cancelled subscription (updated ${subscription.count} records)`);
}

// BILLING.SUBSCRIPTION.SUSPENDED - Payment failed or other issue
async function handleSubscriptionSuspended(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`⚠️ Subscription suspended: ${paypalSubscriptionId}`);

  await prisma.subscription.updateMany({
    where: { paypalSubscriptionId: paypalSubscriptionId },
    data: {
      status: 'suspended',
      autoRenew: false,
    },
  });
}

// BILLING.SUBSCRIPTION.EXPIRED - Subscription period ended
async function handleSubscriptionExpired(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`⏰ Subscription expired: ${paypalSubscriptionId}`);

  await prisma.subscription.updateMany({
    where: { paypalSubscriptionId: paypalSubscriptionId },
    data: {
      status: 'expired',
      endDate: new Date(),
      autoRenew: false,
    },
  });
}

// BILLING.SUBSCRIPTION.UPDATED - Subscription details changed
async function handleSubscriptionUpdated(body: any) {
  const resource = body.resource;
  const paypalSubscriptionId = resource.id;

  console.log(`🔄 Subscription updated: ${paypalSubscriptionId}`);
  // You can update relevant fields here if needed
}

// Helper: Award tickets based on subscription plan
async function awardTickets(paypalSubscriptionId: string, amount: number | null) {
  // Get subscription to find userId
  const subscription = await prisma.subscription.findFirst({
    where: { paypalSubscriptionId: paypalSubscriptionId },
  });

  if (!subscription) {
    console.error('Subscription not found for ticket award');
    return;
  }

  // Determine ticket amount based on billing amount
  let ticketsToAward = 0;
  let planName = '';
  if (amount === 20) {
    ticketsToAward = 250; // Biweekly
    planName = 'Dev Tier - Biweekly';
  } else if (amount === 40) {
    ticketsToAward = 500; // Monthly
    planName = 'Dev Tier - Monthly';
  } else if (amount === 480) {
    ticketsToAward = 500; // Yearly (500/month but only awarded monthly)
    planName = 'Dev Tier - Yearly';
  }

  if (ticketsToAward === 0) {
    console.log('No tickets to award for this amount:', amount);
    return;
  }

  // Get current balance before awarding
  const currentTicket = await prisma.ticket.findUnique({
    where: { userId: subscription.userId },
  });

  const previousBalance = currentTicket?.balance || 0;

  // Award tickets
  const updatedTicket = await prisma.ticket.upsert({
    where: { userId: subscription.userId },
    create: {
      userId: subscription.userId,
      balance: ticketsToAward,
      totalBought: ticketsToAward,
    },
    update: {
      balance: { increment: ticketsToAward },
      totalBought: { increment: ticketsToAward },
    },
  });

  const newBalance = updatedTicket.balance;

  console.log(`🎟️ Awarded ${ticketsToAward} tickets to user ${subscription.userId} (${previousBalance} → ${newBalance})`);

  // Create ticket distribution transaction record
  await prisma.subscriptionTransaction.create({
    data: {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      type: 'ticket_distribution',
      ticketsAdded: ticketsToAward,
      previousBalance: previousBalance,
      newBalance: newBalance,
      description: `${planName} - ${ticketsToAward} tickets distributed`,
      metadata: {
        planName: planName,
        billingAmount: amount,
        billingCycle: subscription.billingCycle,
        paypalSubscriptionId: paypalSubscriptionId,
      }
    }
  });

  console.log(`✅ Created ticket distribution transaction record`);
}
