// Cancel PayPal subscription
// This makes the API call to PayPal to cancel the recurring billing

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/auth';
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

    const { subscriptionId } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json({ error: 'Subscription ID is required' }, { status: 400 });
    }

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Verify ownership
    if (subscription.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if already cancelled
    if (subscription.status === 'cancelled' || subscription.cancelledAt) {
      return NextResponse.json({ error: 'Subscription already cancelled' }, { status: 400 });
    }

    // Cancel with PayPal if we have a PayPal subscription ID
    if (subscription.paypalSubscriptionId) {
      const accessToken = await getPayPalAccessToken();

      const cancelResponse = await fetch(
        `${PAYPAL_API}/v1/billing/subscriptions/${subscription.paypalSubscriptionId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            reason: 'User requested cancellation',
          }),
        }
      );

      if (!cancelResponse.ok && cancelResponse.status !== 204) {
        const errorData = await cancelResponse.json();
        console.error('PayPal cancellation failed:', errorData);
        return NextResponse.json(
          { error: 'Failed to cancel PayPal subscription', details: errorData },
          { status: 500 }
        );
      }

      console.log(`✅ PayPal subscription cancelled: ${subscription.paypalSubscriptionId}`);
    }

    // Update our database
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelledAt: new Date(),
        autoRenew: false,
        // Keep status as 'active' until it actually expires
        // endDate remains unchanged - user keeps access until then
      },
    });

    console.log(`✅ Database updated - subscription ${subscriptionId} marked as cancelled`);

    return NextResponse.json({
      success: true,
      subscription: updatedSubscription,
      message: 'Subscription cancelled successfully. You will retain access until the end of your billing period.',
    });
  } catch (error) {
    console.error('Subscription cancellation error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
