import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * The ONE rule for "this account has Dev Tier right now" (2026-10-08).
 *
 * A subscription counts when it is active (open-ended, or ending in the
 * future) OR cancelled but still inside the period that was paid for -
 * cancelling stops the next charge, it does not take away what was bought.
 * The perk checks used to disagree: /api/user/subscription and prompt enhance
 * honoured the paid period, while the reference limit, Image Studio layers and
 * the concurrency limit dropped a cancelled account to Free the same minute.
 */
export function devTierWhere(now = new Date()): Prisma.SubscriptionWhereInput {
  return {
    tier: 'prompt-studio-dev',
    OR: [
      { status: 'active', OR: [{ endDate: null }, { endDate: { gt: now } }] },
      { status: 'cancelled', OR: [{ endDate: { gt: now } }, { lsCurrentPeriodEnd: { gt: now } }] },
    ],
  }
}

/** This account's current Dev Tier subscription (newest first), or null. */
export async function findDevTierSubscription(userId: number) {
  return prisma.subscription.findFirst({ where: { userId, ...devTierWhere() }, orderBy: { createdAt: 'desc' } })
}

/** What Dev Tier unlocks, plan by plan where it differs - shown on /subscriptions. */
export const DEV_TIER_PERKS = {
  packDiscountPct: 10,
  concurrency: { free: 2, dev: 6 },
  refLibrary: { free: 50, dev: 250 },
} as const
