import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// GET - List all subscriptions (filtered by Dev Tier)
export async function GET(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        tier: 'prompt-studio-dev' // Filter for Dev Tier only
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true
          }
        },
        transactions: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: [
        { status: 'asc' }, // Active subscriptions first
        { createdAt: 'desc' } // Then newest first
      ]
    });

    return NextResponse.json({
      success: true,
      subscriptions,
      count: subscriptions.length
    });

  } catch (error: any) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}

const BILLING_TICKET_MAP: Record<string, number> = {
  biweekly: 250,
  monthly:  500,
  yearly:   6000,
}

const BILLING_PRICE_MAP: Record<string, number> = {
  biweekly: 20,
  monthly:  40,
  yearly:   480,
}

// POST - Create/Grant subscription (optionally deliver initial tickets)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, userEmail, userId: bodyUserId, tier, endDate, billingCycle, deliverTickets } = body;

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!tier) {
      return NextResponse.json({ error: 'tier is required' }, { status: 400 });
    }
    if (!userEmail && !bodyUserId) {
      return NextResponse.json({ error: 'userEmail or userId is required' }, { status: 400 });
    }

    // Find user by userId or email
    const user = bodyUserId
      ? await prisma.user.findUnique({ where: { id: bodyUserId } })
      : await prisma.user.findFirst({ where: { email: userEmail } });

    if (!user) {
      return NextResponse.json(
        { error: bodyUserId ? `User not found: id ${bodyUserId}` : `User not found: ${userEmail}` },
        { status: 404 }
      );
    }

    // Check if user already has an active subscription for this tier
    const existingSub = await prisma.subscription.findFirst({
      where: { userId: user.id, tier, status: 'active' }
    });

    if (existingSub) {
      return NextResponse.json(
        { error: `User already has an active ${tier} subscription` },
        { status: 400 }
      );
    }

    const cycle = billingCycle || 'monthly'
    const price = BILLING_PRICE_MAP[cycle] ?? null

    // Auto-calculate end date from billing cycle if not explicitly provided
    const now = new Date()
    let resolvedEndDate: Date | null = endDate ? new Date(endDate) : null
    if (!resolvedEndDate) {
      const d = new Date(now)
      if (cycle === 'biweekly') d.setDate(d.getDate() + 14)
      else if (cycle === 'monthly') d.setMonth(d.getMonth() + 1)
      else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
      resolvedEndDate = d
    }

    // Create subscription
    const subscription = await prisma.subscription.create({
      data: {
        userId:      user.id,
        tier,
        status:      'active',
        billingCycle: cycle,
        billingAmount: price,
        startDate:   now,
        endDate:     resolvedEndDate,
        nextBillingDate: resolvedEndDate,
        autoRenew:   false, // manual grant — no auto-renew by default
        metadata:    { grantedManually: true, billingCycle: cycle, manualOverrideAt: now.toISOString() } as any,
      },
      include: {
        user: { select: { id: true, email: true, name: true } }
      }
    });

    // Optionally deliver initial tickets
    let ticketsDelivered = 0
    if (deliverTickets) {
      ticketsDelivered = BILLING_TICKET_MAP[cycle] ?? 500
      const ticketRecord = await prisma.ticket.findUnique({ where: { userId: user.id } })
      const previousBalance = ticketRecord?.balance ?? 0
      const newBalance = previousBalance + ticketsDelivered

      await prisma.$transaction([
        prisma.ticket.upsert({
          where:  { userId: user.id },
          update: { balance: { increment: ticketsDelivered }, totalBought: { increment: ticketsDelivered } },
          create: { userId: user.id, balance: ticketsDelivered, totalBought: ticketsDelivered },
        }),
        prisma.subscriptionTransaction.create({
          data: {
            subscriptionId: subscription.id,
            userId:         user.id,
            type:           'ticket_distribution',
            ticketsAdded:   ticketsDelivered,
            previousBalance,
            newBalance,
            description:    `Manual grant — Dev Tier ${cycle} initial tickets`,
          },
        }),
      ])
    }

    console.log(`✅ Subscription granted: ${tier} (${cycle}) to ${userEmail} — tickets: ${ticketsDelivered}`)

    return NextResponse.json({
      success: true,
      subscription,
      ticketsDelivered,
    });

  } catch (error: any) {
    console.error('Error creating subscription:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create subscription' },
      { status: 500 }
    );
  }
}

// PUT - Update subscription status
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, id, status, endDate } = body;

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Subscription id is required' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    const subscription = await prisma.subscription.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    console.log(`✅ Subscription updated: ID ${id} -> status: ${status}`);

    return NextResponse.json({
      success: true,
      subscription
    });

  } catch (error: any) {
    console.error('Error updating subscription:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update subscription' },
      { status: 500 }
    );
  }
}

// DELETE - Remove subscription
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const password = searchParams.get('password');
    const id = searchParams.get('id');

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Subscription id is required' },
        { status: 400 }
      );
    }

    await prisma.subscription.delete({
      where: { id: parseInt(id) }
    });

    console.log(`✅ Subscription deleted: ID ${id}`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting subscription:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete subscription' },
      { status: 500 }
    );
  }
}
