import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
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

// POST /api/admin/subscriptions/toggle-auto-renew
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { subscriptionId, autoRenew } = body;

    if (!subscriptionId || typeof autoRenew !== 'boolean') {
      return NextResponse.json(
        { error: 'subscriptionId and autoRenew (boolean) are required' },
        { status: 400 }
      );
    }

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });

    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    // If disabling auto-renew, cancel the PayPal subscription
    if (!autoRenew && subscription.paypalSubscriptionId) {
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
              reason: 'Admin disabled auto-renew',
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
        // Continue anyway
      }
    }

    // Update the subscription in our database
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        autoRenew: autoRenew,
        cancelledAt: !autoRenew ? new Date() : null,
        updatedAt: new Date()
      },
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });

    console.log(`✅ Auto-renew ${autoRenew ? 'enabled' : 'disabled'} for subscription ${subscriptionId} (${updatedSubscription.user.email})`);

    return NextResponse.json({
      success: true,
      subscription: updatedSubscription,
      message: `Auto-renew ${autoRenew ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error: any) {
    console.error('Error toggling auto-renew:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to toggle auto-renew' },
      { status: 500 }
    );
  }
}
