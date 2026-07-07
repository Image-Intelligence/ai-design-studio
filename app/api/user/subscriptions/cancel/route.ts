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

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const user = await getUserFromSession(token);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid session' },
        { status: 401 }
      );
    }

    const { subscriptionId } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json(
        { success: false, error: 'Subscription ID is required' },
        { status: 400 }
      );
    }

    // Find the subscription and verify ownership
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        userId: user.id
      }
    });

    if (!subscription) {
      return NextResponse.json(
        { success: false, error: 'Subscription not found' },
        { status: 404 }
      );
    }

    if (subscription.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Subscription is not active' },
        { status: 400 }
      );
    }

    if (subscription.cancelledAt) {
      return NextResponse.json(
        { success: false, error: 'Subscription is already cancelled' },
        { status: 400 }
      );
    }

    // Calculate end date if not set (use next billing date or 30 days from now)
    const endDate = subscription.endDate ||
                    subscription.nextBillingDate ||
                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Cancel with LemonSqueezy if this is a LS subscription
    if (subscription.lsSubscriptionId) {
      try {
        const lsApiKey = process.env.LEMONSQUEEZY_API_KEY;
        if (!lsApiKey) throw new Error('LEMONSQUEEZY_API_KEY not configured');

        const lsResponse = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions/${subscription.lsSubscriptionId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${lsApiKey}`,
              'Accept': 'application/vnd.api+json',
            },
          }
        );

        if (!lsResponse.ok) {
          const errorText = await lsResponse.text();
          console.error('LemonSqueezy cancellation failed:', lsResponse.status, errorText);
          // Continue anyway — still cancel in our DB
        } else {
          console.log(`✅ LemonSqueezy subscription cancelled: ${subscription.lsSubscriptionId}`);
        }
      } catch (lsError) {
        console.error('LemonSqueezy API error:', lsError);
        // Continue anyway - still cancel in our system
      }
    }

    // Cancel with PayPal if this is a PayPal subscription
    if (subscription.paypalSubscriptionId) {
      try {
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
          // Continue anyway - update our database even if PayPal call fails
        } else {
          console.log(`✅ PayPal subscription cancelled: ${subscription.paypalSubscriptionId}`);
        }
      } catch (paypalError) {
        console.error('PayPal API error:', paypalError);
        // Continue anyway - still cancel in our system
      }
    }

    // Cancel the subscription in our database
    // - Set cancelledAt to now
    // - Set autoRenew to false
    // - Keep status as 'active' until endDate passes
    // - The endDate represents when access will be revoked
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelledAt: new Date(),
        autoRenew: false,
        endDate: endDate,
        // Note: status stays 'active' - user keeps access until endDate
        // A cron job or check at login should update to 'expired' after endDate
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled successfully',
      subscription: {
        id: updatedSubscription.id,
        status: updatedSubscription.status,
        cancelledAt: updatedSubscription.cancelledAt?.toISOString(),
        endDate: updatedSubscription.endDate?.toISOString(),
        accessUntil: endDate.toISOString()
      }
    });

  } catch (error: any) {
    console.error('Error cancelling subscription:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
