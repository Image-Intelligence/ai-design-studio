import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

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

// POST — re-activates an existing subscription record (updates it in place, no new record created)
// This avoids the "user already has an active subscription" conflict when a user has multiple records.
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscriptionId, billingCycle, endDate, deliverTickets } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId required' }, { status: 400 });
    }

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const cycle = billingCycle || sub.billingCycle || 'monthly';
    const price = BILLING_PRICE_MAP[cycle] ?? sub.billingAmount ?? null;
    const now   = new Date();

    // Resolve end date: explicit > auto-calc from cycle
    let resolvedEndDate: Date;
    if (endDate) {
      resolvedEndDate = new Date(endDate);
    } else {
      resolvedEndDate = new Date(now);
      if (cycle === 'biweekly') resolvedEndDate.setDate(resolvedEndDate.getDate() + 14);
      else if (cycle === 'monthly') resolvedEndDate.setMonth(resolvedEndDate.getMonth() + 1);
      else if (cycle === 'yearly') resolvedEndDate.setFullYear(resolvedEndDate.getFullYear() + 1);
    }

    const existingMeta: any = sub.metadata ?? {};

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status:         'active',
        billingCycle:   cycle,
        billingAmount:  price,
        endDate:        resolvedEndDate,
        nextBillingDate: resolvedEndDate,
        cancelledAt:    null,
        autoRenew:      false,
        metadata: {
          ...existingMeta,
          grantedManually: true,
          billingCycle: cycle,
          manualOverrideAt: now.toISOString(),
          reactivatedAt: now.toISOString(),
        } as any,
      },
    });

    // Optionally deliver tickets
    let ticketsDelivered = 0;
    if (deliverTickets) {
      ticketsDelivered = BILLING_TICKET_MAP[cycle] ?? 500;
      const ticketRecord = await prisma.ticket.findUnique({ where: { userId: sub.userId } });
      const previousBalance = ticketRecord?.balance ?? 0;
      const newBalance      = previousBalance + ticketsDelivered;

      await prisma.$transaction([
        prisma.ticket.upsert({
          where:  { userId: sub.userId },
          update: { balance: { increment: ticketsDelivered }, totalBought: { increment: ticketsDelivered } },
          create: { userId: sub.userId, balance: ticketsDelivered, totalBought: ticketsDelivered },
        }),
        prisma.subscriptionTransaction.create({
          data: {
            subscriptionId,
            userId:         sub.userId,
            type:           'ticket_distribution',
            ticketsAdded:   ticketsDelivered,
            previousBalance,
            newBalance,
            description:    `Manual re-activation — Dev Tier ${cycle} tickets`,
          },
        }),
      ]);
    }

    console.log(`✅ Subscription reactivated: ID ${subscriptionId} (${cycle}) for ${sub.user.email} — tickets: ${ticketsDelivered}`);

    return NextResponse.json({ success: true, subscription: updated, ticketsDelivered });
  } catch (error: any) {
    console.error('reactivate error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
