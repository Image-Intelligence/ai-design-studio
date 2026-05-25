import prisma from '@/lib/prisma'

const ADMIN_EMAILS = new Set(['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'])

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase())
}

/**
 * Atomically check and deduct tickets before a generation is submitted to FAL.
 * Admin emails bypass the check entirely.
 * Returns { ok: true } on success or { ok: false, have, need } if insufficient.
 */
export async function deductGenerationTickets(
  userId: number,
  userEmail: string,
  cost: number,
): Promise<{ ok: true; newBalance: number } | { ok: false; have: number; need: number }> {
  if (cost <= 0 || isAdminEmail(userEmail)) return { ok: true, newBalance: -1 }

  const ticket = await prisma.ticket.findUnique({ where: { userId } })
  const available = (ticket?.balance ?? 0) - (ticket?.reserved ?? 0)

  if (available < cost) {
    return { ok: false, have: Math.max(0, available), need: cost }
  }

  const updated = await prisma.ticket.update({
    where: { userId },
    data: { balance: { decrement: cost }, totalUsed: { increment: cost } },
    select: { balance: true },
  })
  return { ok: true, newBalance: updated.balance }
}

/**
 * Refund tickets after a generation fails post-submission.
 * Admin emails are skipped (they were never charged).
 */
export async function refundGenerationTickets(
  userId: number,
  userEmail: string,
  cost: number,
): Promise<void> {
  if (cost <= 0 || isAdminEmail(userEmail)) return
  await prisma.ticket.update({
    where: { userId },
    data: { balance: { increment: cost } },
  }).catch(() => {})
}
