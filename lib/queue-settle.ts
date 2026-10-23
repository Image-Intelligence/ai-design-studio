/**
 * Failing a GenerationQueue job exactly once, and putting its tickets back the
 * way they were taken (2026-10-23 billing sweep).
 *
 * Two different charging models share the queue table:
 *   - 'reserve': /api/generate's fal-webhook images and the canvas. Tickets are
 *     only RESERVED at submit (Ticket.reserved += cost); the webhook turns the
 *     reservation into spend when the result lands. A failure RELEASES it.
 *   - 'deduct': polled images (usePolling: NanoBanana 2, Kling, GPT Image 2,
 *     Wan...) and every fal video. The balance is charged at submit; a failure
 *     REFUNDS it (balance += cost).
 * Several give-up paths (the cron's stale pass, the promoter's failures, the
 * jobs poll's 404 sweep, the admin cancel) used to flip rows to 'failed'
 * without touching tickets, or released a reservation for a row that had
 * been charged - so reservations stuck forever (24 accounts, 2026-10-23) and
 * charged users got nothing back.
 *
 * failQueueRow flips the row with a status-guarded updateMany, so of any
 * number of racing callers exactly one gets the flip - and only that one moves
 * tickets. It never touches the concurrency counters: the caller knows
 * whether a slot was held.
 */
import prisma from '@/lib/prisma'
import { releaseReservedTickets } from '@/lib/ticket-gate'

export type ChargeMode = 'reserve' | 'deduct'

/**
 * How a row's tickets were taken. New rows say so (parameters.chargeMode);
 * older ones are told apart the way they were made: polled jobs and videos
 * were charged at submit, everything else on the queue was reserved.
 */
export function chargeModeOf(row: { modelType?: string | null; parameters?: unknown }): ChargeMode {
  const p = (row.parameters ?? {}) as { chargeMode?: unknown; usePolling?: unknown }
  if (p.chargeMode === 'reserve' || p.chargeMode === 'deduct') return p.chargeMode
  if (p.usePolling === true) return 'deduct'
  if (row.modelType === 'video') return 'deduct'
  return 'reserve'
}

/** Give back what a job took: release a reservation, or refund a charge. Never both. */
export async function returnJobTickets(row: { userId: number; ticketCost: number; modelType?: string | null; parameters?: unknown }): Promise<void> {
  const cost = Math.max(0, Math.round(row.ticketCost || 0))
  if (!cost) return
  if (chargeModeOf(row) === 'reserve') {
    await releaseReservedTickets(row.userId, cost)
  } else {
    await prisma.$executeRaw`UPDATE "Ticket" SET balance = balance + ${cost} WHERE "userId" = ${row.userId}`
  }
}

/**
 * Mark a job failed if it is still in one of `from` (default: queued or
 * processing), and give its tickets back. True only for the caller whose flip
 * won - racing callers get false and must do nothing else (no refund, no
 * counter change).
 */
export async function failQueueRow(id: number, errorMessage: string, from: string[] = ['queued', 'processing']): Promise<boolean> {
  const row = await prisma.generationQueue.findUnique({
    where: { id },
    select: { id: true, userId: true, ticketCost: true, modelType: true, parameters: true, status: true },
  })
  if (!row || !from.includes(row.status)) return false
  const flipped = await prisma.generationQueue.updateMany({
    where: { id, status: { in: from } },
    data: { status: 'failed', completedAt: new Date(), errorMessage: errorMessage.slice(0, 500) },
  })
  if (flipped.count === 0) return false
  try {
    await returnJobTickets(row)
  } catch (e) {
    console.error(`[queue-settle] tickets for failed job #${id} could not be returned:`, e)
  }
  return true
}
