import prisma from '@/lib/prisma'

const ADMIN_EMAILS = new Set(['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'])

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase())
}

/*
 * ── A balance can never go below 0 (2026-10-19) ──────────────────────────
 * dirtysecretai@gmail.com reached -89. The cause: routes that READ the
 * balance, checked it, and then subtracted in a separate statement - when
 * Nova (or the portal) starts several renders at once, every request reads
 * the same balance, every one passes, and every one subtracts. Settle steps
 * (a webhook finalising a reserved job) also subtracted with no floor, and a
 * reservation skipped for admin emails could then be charged unreserved.
 * Every spend now goes through one of these, each a SINGLE statement:
 *   chargeTicketsAtomic    subtract only if the free balance covers it
 *   reserveTicketsAtomic   reserve only if the free balance covers it
 *   settleReservedTickets  reserved -> spent, never below 0
 *   removeTicketsFloored   take tickets away (plans, admin revokes), stopping at 0
 */

/** Charge `cost` now - only if the FREE balance (balance - reserved) covers it. No admin bypass: the caller decides. */
export async function chargeTicketsAtomic(userId: number, cost: number): Promise<{ ok: true; newBalance: number } | { ok: false; have: number; need: number }> {
  if (cost <= 0) return { ok: true, newBalance: (await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0 }
  // Single atomic UPDATE prevents TOCTOU race: concurrent requests that both
  // pass a separate balance check can both decrement, causing negative balances.
  const affected = await prisma.$executeRaw`
    UPDATE "Ticket"
    SET balance = balance - ${cost}, "totalUsed" = "totalUsed" + ${cost}
    WHERE "userId" = ${userId}
      AND (balance - GREATEST(0, COALESCE(reserved, 0))) >= ${cost}
  `
  if (affected === 0) {
    const ticket = await prisma.ticket.findUnique({ where: { userId } })
    const available = Math.max(0, (ticket?.balance ?? 0) - Math.max(0, ticket?.reserved ?? 0))
    return { ok: false, have: available, need: cost }
  }
  const updated = await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } })
  return { ok: true, newBalance: updated?.balance ?? 0 }
}

/** Reserve `cost` - only if the free balance covers it. No admin bypass: the caller decides. */
export async function reserveTicketsAtomic(userId: number, cost: number): Promise<{ ok: true; balance: number; reserved: number } | { ok: false; have: number; need: number }> {
  const affected = cost <= 0 ? 1 : await prisma.$executeRaw`
    UPDATE "Ticket"
    SET reserved = GREATEST(0, COALESCE(reserved, 0)) + ${cost}
    WHERE "userId" = ${userId}
      AND (balance - GREATEST(0, COALESCE(reserved, 0))) >= ${cost}
  `
  const t = await prisma.ticket.findUnique({ where: { userId }, select: { balance: true, reserved: true } })
  if (affected === 0) return { ok: false, have: Math.max(0, (t?.balance ?? 0) - Math.max(0, t?.reserved ?? 0)), need: cost }
  return { ok: true, balance: t?.balance ?? 0, reserved: t?.reserved ?? 0 }
}

/** A reserved job finished: its reservation becomes spent. Never takes the balance or the reservation below 0. */
export async function settleReservedTickets(userId: number, cost: number): Promise<void> {
  if (cost <= 0) return
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET balance = GREATEST(0, balance - ${cost}),
        reserved = GREATEST(0, COALESCE(reserved, 0) - ${cost}),
        "totalUsed" = "totalUsed" + LEAST(${cost}, GREATEST(0, balance))
    WHERE "userId" = ${userId}
  `
}

/** Take tickets away (a plan's tickets ending, an admin revoke) - down to 0 at most. */
export async function removeTicketsFloored(userId: number, amount: number): Promise<{ before: number; after: number; removed: number }> {
  const before = (await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0
  if (amount > 0) await prisma.$executeRaw`UPDATE "Ticket" SET balance = GREATEST(0, balance - ${amount}) WHERE "userId" = ${userId}`
  const after = (await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0
  return { before, after, removed: Math.max(0, before - after) }
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
  return chargeTicketsAtomic(userId, cost)
}

/**
 * Atomically reserve tickets before submitting an async FAL job.
 * Uses the same atomic UPDATE pattern as deductGenerationTickets to prevent
 * TOCTOU races where two concurrent requests both pass the balance check.
 * Admin emails are skipped. Returns { ok: false } if balance is insufficient.
 *
 * IMPORTANT: Always pair with releaseReservedTickets on failure/completion.
 */
export async function reserveGenerationTickets(
  userId: number,
  userEmail: string,
  cost: number,
): Promise<{ ok: true } | { ok: false; have: number; need: number }> {
  if (cost <= 0 || isAdminEmail(userEmail)) return { ok: true }

  // Only reserve if (balance - max(0, reserved)) >= cost so negative reserved
  // can never inflate the available balance check.
  const affected = await prisma.$executeRaw`
    UPDATE "Ticket"
    SET reserved = GREATEST(0, COALESCE(reserved, 0)) + ${cost}
    WHERE "userId" = ${userId}
      AND (balance - GREATEST(0, COALESCE(reserved, 0))) >= ${cost}
  `

  if (affected === 0) {
    const ticket = await prisma.ticket.findUnique({ where: { userId } })
    const available = Math.max(0, (ticket?.balance ?? 0) - Math.max(0, ticket?.reserved ?? 0))
    return { ok: false, have: available, need: cost }
  }

  return { ok: true }
}

/**
 * Release reserved tickets after a job completes or fails.
 * Uses GREATEST(0, ...) so reserved can never go negative — a negative reserved
 * field would inflate the effective balance check and allow free generations.
 */
export async function releaseReservedTickets(
  userId: number,
  cost: number,
): Promise<void> {
  if (cost <= 0) return
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET reserved = GREATEST(0, reserved - ${cost})
    WHERE "userId" = ${userId}
  `.catch(() => {})
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

/**
 * Reset any negative reserved values to 0 for all users.
 * Run this once to repair corrupted state from previous bugs.
 */
export async function repairNegativeReserved(): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "Ticket" SET reserved = 0 WHERE reserved < 0
  `
  return result as number
}
