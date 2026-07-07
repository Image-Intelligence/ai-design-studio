import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// POST — deducts tickets from a subscription user
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscriptionId, ticketAmount, description } = await req.json();

    if (!subscriptionId || !ticketAmount) {
      return NextResponse.json({ error: 'subscriptionId and ticketAmount are required' }, { status: 400 });
    }

    const amount = Math.abs(parseInt(String(ticketAmount)));
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'ticketAmount must be a positive number' }, { status: 400 });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const currentTicket = await prisma.ticket.findUnique({ where: { userId: subscription.userId } });
    const previousBalance = currentTicket?.balance ?? 0;

    // Don't allow balance to go below 0
    const deduct      = Math.min(amount, previousBalance);
    const newBalance  = previousBalance - deduct;

    const updatedTicket = await prisma.ticket.upsert({
      where:  { userId: subscription.userId },
      create: { userId: subscription.userId, balance: 0, totalBought: 0 },
      update: { balance: { decrement: deduct } },
    });

    const transaction = await prisma.subscriptionTransaction.create({
      data: {
        subscriptionId: subscription.id,
        userId:         subscription.userId,
        type:           'ticket_distribution',
        ticketsAdded:   -deduct,
        previousBalance,
        newBalance:     updatedTicket.balance,
        description:    description || `Admin revoked ${deduct} tickets`,
        metadata: {
          revokedBy:  'admin',
          revokedAt:  new Date().toISOString(),
          requested:  amount,
          actual:     deduct,
        },
      },
    });

    console.log(`⚠️ Admin revoked ${deduct} tickets from user ${subscription.userId} (${previousBalance} → ${updatedTicket.balance})`);

    return NextResponse.json({
      success: true,
      message: `Revoked ${deduct} tickets from ${subscription.user.email}`,
      transaction: {
        id:              transaction.id,
        previousBalance,
        newBalance:      updatedTicket.balance,
        ticketsRevoked:  deduct,
        createdAt:       transaction.createdAt,
      },
    });
  } catch (error: any) {
    console.error('revoke-tickets error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
