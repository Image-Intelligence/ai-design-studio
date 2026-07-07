import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// POST /api/admin/subscriptions/revoke-access
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
    const { subscriptionId } = body;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'subscriptionId is required' },
        { status: 400 }
      );
    }

    // Update the subscription - set to cancelled and end it immediately
    const now = new Date();

    // Fetch existing metadata so we can merge manualOverrideAt without wiping other fields
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { metadata: true },
    });
    const existingMeta: any = existing?.metadata ?? {};

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'cancelled',
        autoRenew: false,
        cancelledAt: now,
        endDate: now,
        updatedAt: now,
        metadata: { ...existingMeta, manualOverrideAt: now.toISOString(), revokedManually: true } as any,
      },
      include: {
        user: {
          select: {
            email: true,
            name: true
          }
        }
      }
    });

    console.log(`⚠️ SUBSCRIPTION REVOKED: ${subscription.tier} for ${subscription.user.email} (ID: ${subscriptionId})`);
    console.log(`   - Status set to: cancelled`);
    console.log(`   - End date set to: ${now.toISOString()}`);
    console.log(`   - Auto-renew disabled`);

    return NextResponse.json({
      success: true,
      subscription,
      message: `Access revoked for ${subscription.user.email}. Subscription status set to cancelled.`
    });

  } catch (error: any) {
    console.error('Error revoking access:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to revoke access' },
      { status: 500 }
    );
  }
}
