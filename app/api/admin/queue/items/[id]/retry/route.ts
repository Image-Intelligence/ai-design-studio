import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkAdminRequest } from '@/lib/admin-check'
import { chargeModeOf, returnJobTickets } from '@/lib/queue-settle'
import { chargeTicketsAtomic, reserveTicketsAtomic } from '@/lib/ticket-gate'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

/**
 * POST - Retry a failed or cancelled queue item.
 *
 * 2026-10-23 billing sweep. The old version just flipped the row back to
 * 'queued'. But a failed or cancelled job has had its tickets given back
 * (lib/queue-settle), so the re-run then completed and was either charged
 * from a reservation that no longer existed or - for a job charged at submit
 * - not charged at all: a free generation. It also kept the old fal request
 * id, so the promoter (which now skips queued rows that have one) would never
 * pick it up, and a late webhook for the OLD run could settle the new one.
 *
 * Now the tickets are taken again exactly the way they were the first time
 * (reserve or charge - chargeModeOf), atomically and only if the free balance
 * covers it; then the row is flipped back with a guarded updateMany. If two
 * retries race, both may take tickets but only one flip wins - the loser
 * gives its tickets straight back. Only rows that stored their fal endpoint
 * and input can be re-run by the promoter; anything else (submitted directly
 * by its own route) is refused rather than charged and then failed.
 */
export async function POST(
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
      select: { id: true, userId: true, ticketCost: true, modelType: true, parameters: true, status: true },
    });

    if (!item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    if (item.status !== 'failed' && item.status !== 'cancelled') {
      return NextResponse.json({ error: 'Can only retry failed or cancelled items' }, { status: 400 });
    }

    const p = (item.parameters ?? {}) as { falEndpoint?: unknown; falInput?: unknown }
    if (!p.falEndpoint || !p.falInput) {
      return NextResponse.json({ error: 'This job was sent straight to the provider by its own route and has no stored input — it cannot be re-run from the queue. Generate it again instead.' }, { status: 400 });
    }

    // Take the tickets again, the same way as the first time
    const cost = Math.max(0, Math.round(item.ticketCost || 0))
    if (cost > 0) {
      const taken = chargeModeOf(item) === 'reserve'
        ? await reserveTicketsAtomic(item.userId, cost)
        : await chargeTicketsAtomic(item.userId, cost)
      if (!taken.ok) {
        return NextResponse.json({ error: `The account cannot cover the retry: needs ${taken.need} ticket(s), has ${taken.have} free.` }, { status: 402 });
      }
    }

    // Reset item to queued state - clearing the old run's request id, result and webhook claim
    const freshParams: Record<string, unknown> = { ...((item.parameters ?? {}) as Record<string, unknown>) }
    // slotClaimed too (2026-10-23 review): the promoter takes a fresh slot for the retry, and a
    // leftover `false` (a non-admin video) would keep that slot from ever being given back
    for (const k of ['webhookClaimAt', 'harvestSeenAt', 'completedImageIds', 'completedImageUrls', 'falError', 'slotClaimed']) delete freshParams[k]
    const flipped = await prisma.generationQueue.updateMany({
      where: { id, status: { in: ['failed', 'cancelled'] } },
      data: {
        status: 'queued',
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        resultUrl: null,
        resultImageId: null,
        falRequestId: null,
        parameters: freshParams as object,
      },
    });
    if (flipped.count === 0) {
      // Another retry won the row - give back what this one took
      if (cost > 0) await returnJobTickets(item).catch(e => console.error(`[queue-retry] tickets for #${id} could not be returned:`, e))
      return NextResponse.json({ error: 'The job changed state while retrying — refresh and try again' }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to retry queue item:', error);
    return NextResponse.json({ error: 'Failed to retry queue item' }, { status: 500 });
  }
}
