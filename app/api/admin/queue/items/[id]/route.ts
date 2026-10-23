import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkAdminRequest } from '@/lib/admin-check'
import { returnJobTickets } from '@/lib/queue-settle'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

/**
 * DELETE - Cancel a queue item that has not been sent to the provider yet.
 *
 * 2026-10-23 billing sweep. The old version read the row, then refunded the
 * balance AND released the reservation for a queued row (one job's tickets
 * given back twice over - a reserved job was never charged, a charged one was
 * never reserved), then flipped the status unguarded, so two clicks (or a
 * click racing the promoter) did it all twice. It also "cancelled" processing
 * rows that fal went on to finish and the webhook then saved and charged.
 *
 * Now:
 *  - Only a row still waiting in OUR queue can be cancelled: status 'queued'
 *    with no fal request id. A 'processing' row - or a canvas row, which sits
 *    'queued' while fal runs it - is with the provider, which may still
 *    finish it; cancelling it here would either hand the tickets back for
 *    work that then lands in the feed, or need every settler (webhook, video
 *    and image pollers, harvesters) to honour 'cancelled'. Those are refused
 *    with 409: let them finish or fail, or use reset-stale for dead ones.
 *  - The flip is a guarded updateMany; only the caller whose flip matched the
 *    row gives the tickets back, once, the way they were taken (release a
 *    reservation / refund a charge - lib/queue-settle).
 *  - A row waiting in our queue holds no concurrency slot (the promoter
 *    claims one only when it promotes the row), so there is no counter to
 *    give back.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const item = await prisma.generationQueue.findUnique({
      where: { id },
      select: { id: true, userId: true, ticketCost: true, modelType: true, parameters: true, status: true, falRequestId: true },
    });

    if (!item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    if (item.status !== 'queued' || item.falRequestId) {
      const running = item.status === 'processing' || (item.status === 'queued' && !!item.falRequestId)
      return NextResponse.json({
        error: running
          ? 'This job is already with the provider and may still finish — it cannot be cancelled. Let it finish or fail (or reset it if it is stale).'
          : `Cannot cancel a ${item.status} item`,
      }, { status: 409 });
    }

    const flipped = await prisma.generationQueue.updateMany({
      where: { id, status: 'queued', falRequestId: null },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: 'Cancelled by an admin',
      },
    });
    if (flipped.count === 0) {
      // The promoter (or another cancel) got there first
      return NextResponse.json({ error: 'The job changed state while cancelling — refresh and try again' }, { status: 409 });
    }

    try {
      await returnJobTickets(item)
    } catch (e) {
      console.error(`[queue-cancel] tickets for cancelled job #${id} could not be returned:`, e)
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to cancel queue item:', error);
    return NextResponse.json({ error: 'Failed to cancel queue item' }, { status: 500 });
  }
}
