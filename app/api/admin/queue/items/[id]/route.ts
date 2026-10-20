import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// DELETE - Cancel a queue item
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);

    const item = await prisma.generationQueue.findUnique({
      where: { id }
    });

    if (!item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    if (item.status === 'completed' || item.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot cancel completed or cancelled item' }, { status: 400 });
    }

    // Refund tickets
    if (item.status === 'queued') {
      await prisma.$executeRaw`UPDATE "Ticket" SET balance = balance + ${item.ticketCost}, reserved = GREATEST(0, COALESCE(reserved, 0) - ${item.ticketCost}) WHERE "userId" = ${item.userId}`;
    }

    // Update item status
    await prisma.generationQueue.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date()
      }
    });

    // Decrement active count if it was processing
    if (item.status === 'processing') {
      await prisma.modelConcurrencyLimit.update({
        where: { modelId: item.modelId },
        data: { currentActive: { decrement: 1 } }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to cancel queue item:', error);
    return NextResponse.json({ error: 'Failed to cancel queue item' }, { status: 500 });
  }
}
