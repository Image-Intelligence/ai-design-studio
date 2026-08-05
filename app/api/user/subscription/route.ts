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

    // Audit/reviewer accounts (created via /admin/audit-accounts, email
    // <name>@audit.pp — e.g. the CCBill compliance reviewer) get the full Dev
    // Tier experience so they can evaluate everything a paying user can use.
    // They have NO admin access — AdminAccount gating is entirely separate.
    const isAuditAccount = (user.email ?? '').endsWith('@audit.pp')

    // Check for active prompt-studio-dev subscription — includes cancelled subs still within billing period
    const now = new Date()
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        tier: 'prompt-studio-dev',
        OR: [
          { status: 'active' },
          {
            status: 'cancelled',
            OR: [
              { endDate: { gt: now } },
              { lsCurrentPeriodEnd: { gt: now } },
            ],
          },
        ],
      }
    });

    // Grandfathered = subscribed before the discount cut (Apr 23 2026) and still in that billing period.
    // lsCurrentPeriodEnd being null means a manually granted/indefinite subscription — treat as always active.
    const GRANDFATHER_CUTOFF = new Date('2026-04-23T00:00:00Z')
    const isGrandfathered = !!(
      subscription &&
      new Date(subscription.createdAt) < GRANDFATHER_CUTOFF &&
      (!subscription.lsCurrentPeriodEnd || new Date(subscription.lsCurrentPeriodEnd) > new Date())
    )

    return NextResponse.json({
      success: true,
      hasPromptStudioDev: !!subscription || isAuditAccount,
      isGrandfathered,
      subscription: subscription ? {
        tier: subscription.tier,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        billingCycle: subscription.billingCycle,
        nextBillingDate: subscription.nextBillingDate,
        lsCurrentPeriodEnd: subscription.lsCurrentPeriodEnd,
        createdAt: subscription.createdAt,
      } : null
    });

  } catch (error: any) {
    console.error('Error checking subscription:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check subscription' },
      { status: 500 }
    );
  }
}
