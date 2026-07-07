import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// POST - Manually distribute tickets to a subscription user
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
    const { subscriptionId, ticketAmount, description } = body;

    if (!subscriptionId || !ticketAmount) {
      return NextResponse.json(
        { error: 'subscriptionId and ticketAmount are required' },
        { status: 400 }
      );
    }

    if (ticketAmount <= 0) {
      return NextResponse.json(
        { error: 'ticketAmount must be positive' },
        { status: 400 }
      );
    }

    // Get subscription
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
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

    // Get current balance before distributing
    const currentTicket = await prisma.ticket.findUnique({
      where: { userId: subscription.userId },
    });

    const previousBalance = currentTicket?.balance || 0;

    // Distribute tickets
    const updatedTicket = await prisma.ticket.upsert({
      where: { userId: subscription.userId },
      create: {
        userId: subscription.userId,
        balance: ticketAmount,
        totalBought: ticketAmount,
      },
      update: {
        balance: { increment: ticketAmount },
        totalBought: { increment: ticketAmount },
      },
    });

    const newBalance = updatedTicket.balance;

    // Create ticket distribution transaction record
    const transaction = await prisma.subscriptionTransaction.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        type: 'ticket_distribution',
        ticketsAdded: ticketAmount,
        previousBalance: previousBalance,
        newBalance: newBalance,
        description: description || `Manual ticket distribution - ${ticketAmount} tickets`,
        metadata: {
          distributedBy: 'admin',
          distributedAt: new Date().toISOString(),
          subscriptionTier: subscription.tier,
          subscriptionStatus: subscription.status,
        }
      }
    });

    console.log(`✅ Admin distributed ${ticketAmount} tickets to user ${subscription.userId} (${previousBalance} → ${newBalance})`);

    return NextResponse.json({
      success: true,
      message: `Successfully distributed ${ticketAmount} tickets to ${subscription.user.email}`,
      transaction: {
        id: transaction.id,
        previousBalance,
        newBalance,
        ticketsAdded: ticketAmount,
        createdAt: transaction.createdAt,
      }
    });

  } catch (error: any) {
    console.error('Error distributing tickets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to distribute tickets' },
      { status: 500 }
    );
  }
}
