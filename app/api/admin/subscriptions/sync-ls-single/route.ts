import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// POST — force-syncs a single subscription from LemonSqueezy (always overwrites, no manual-override check)
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscriptionId } = await req.json();
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 });
    }

    const lsApiKey = process.env.LEMONSQUEEZY_API_KEY;
    if (!lsApiKey) {
      return NextResponse.json({ error: 'LEMONSQUEEZY_API_KEY not configured' }, { status: 500 });
    }

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: { select: { email: true } } },
    });

    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    if (!sub.lsSubscriptionId) {
      return NextResponse.json(
        { error: 'This subscription has no LemonSqueezy ID — it was manually created and cannot be synced.' },
        { status: 400 }
      );
    }

    const res = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions/${sub.lsSubscriptionId}`,
      {
        headers: {
          'Authorization': `Bearer ${lsApiKey}`,
          'Accept': 'application/vnd.api+json',
        },
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `LS API error ${res.status}: ${text.substring(0, 200)}` },
        { status: 502 }
      );
    }

    const lsData = await res.json();
    const attrs = lsData.data?.attributes;
    if (!attrs) {
      return NextResponse.json({ error: 'Unexpected LS response format' }, { status: 502 });
    }

    const lsStatus: string = attrs.status;
    const renewsAt  = attrs.renews_at  ? new Date(attrs.renews_at)  : null;
    const endsAt    = attrs.ends_at    ? new Date(attrs.ends_at)    : null;

    const lsIsCancelled = ['cancelled', 'expired'].includes(lsStatus);
    const ourStatus = lsIsCancelled ? lsStatus : 'active';

    const updateData: any = {
      status: ourStatus,
      lsCurrentPeriodEnd: renewsAt,
      nextBillingDate: renewsAt,
    };

    if (lsIsCancelled && !sub.cancelledAt) {
      updateData.cancelledAt = endsAt || new Date();
    }
    if (!lsIsCancelled && sub.cancelledAt) {
      updateData.cancelledAt = null; // user re-subscribed on LS
    }

    await prisma.subscription.update({ where: { id: subscriptionId }, data: updateData });

    return NextResponse.json({ success: true, lsStatus, ourStatus });
  } catch (error: any) {
    console.error('sync-ls-single error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
