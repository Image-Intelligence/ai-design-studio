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

  // Single atomic UPDATE prevents TOCTOU race: concurrent requests that both
  // pass a separate balance check can both decrement, causing negative balances.
  const affected = await prisma.$executeRaw`
    UPDATE "Ticket"
    SET balance = balance - ${cost}, "totalUsed" = "totalUsed" + ${cost}
    WHERE "userId" = ${userId}
      AND (balance - COALESCE(reserved, 0)) >= ${cost}
  `

  if (affected === 0) {
    const ticket = await prisma.ticket.findUnique({ where: { userId } })
    const available = Math.max(0, (ticket?.balance ?? 0) - (ticket?.reserved ?? 0))
    return { ok: false, have: available, need: cost }
  }

  const updated = await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } })
  return { ok: true, newBalance: updated?.balance ?? 0 }
}

/**
 * Atomically reserve tickets before submitting an async FAL job.
 * Uses the same atomic UPDATE pattern as deductGenerationTickets to prevent
 * TOCTOU races where two concurrent requests both pass the balance check.
 * Admin emails are skipped. Returns { ok: false } if balance is insufficient.
 */
export async function reserveGenerationTickets(
  userId: number,
  userEmail: string,
  cost: number,
): Promise<{ ok: true } | { ok: false; have: number; need: number }> {
  if (cost <= 0 || isAdminEmail(userEmail)) return { ok: true }

  const affected = await prisma.$executeRaw`
    UPDATE "Ticket"
    SET reserved = reserved + ${cost}
    WHERE "userId" = ${userId}
      AND (balance - COALESCE(reserved, 0)) >= ${cost}
  `

  if (affected === 0) {
    const ticket = await prisma.ticket.findUnique({ where: { userId } })
    const available = Math.max(0, (ticket?.balance ?? 0) - (ticket?.reserved ?? 0))
    return { ok: false, have: available, need: cost }
  }

  return { ok: true }
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
