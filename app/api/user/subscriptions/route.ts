import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/auth';
import { cookies } from 'next/headers';


export async function GET(req: NextRequest) {
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

    // Fetch all subscriptions for this user
    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Check and update expired subscriptions
    const now = new Date();
    for (const sub of subscriptions) {
      if (sub.status === 'active' && sub.endDate && sub.endDate < now) {
        // Mark as expired
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired' }
        });
        sub.status = 'expired';
      }
    }

    return NextResponse.json({
      success: true,
      subscriptions: subscriptions.map(sub => ({
        id: sub.id,
        tier: sub.tier,
        status: sub.status,
        startDate: sub.startDate.toISOString(),
        endDate: sub.endDate?.toISOString() || null,
        nextBillingDate: sub.nextBillingDate?.toISOString() || null,
        billingAmount: sub.billingAmount,
        billingCycle: sub.billingCycle,
        autoRenew: sub.autoRenew,
        cancelledAt: sub.cancelledAt?.toISOString() || null
      }))
    });

  } catch (error: any) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}
