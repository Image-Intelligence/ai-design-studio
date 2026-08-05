import prisma from '@/lib/prisma'
import { isAdminEmail } from '@/lib/ticket-gate'

// Max ACTIVE (non-cleared) reference-library images per account.
// Cleared refs don't count — they're soft-deleted (kept for admin review).
export const REF_LIMIT_FREE = 50
export const REF_LIMIT_DEV = 250
export const REF_LIMIT_ADMIN = 1000

export async function getUserRefLimit(userId: number, email: string): Promise<number> {
  if (isAdminEmail(email)) return REF_LIMIT_ADMIN
  // Audit/reviewer accounts (@audit.pp, e.g. CCBill compliance) test as Dev Tier
  if (email.endsWith('@audit.pp')) return REF_LIMIT_DEV
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      tier: 'prompt-studio-dev',
      status: 'active',
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    select: { id: true },
  })
  return sub ? REF_LIMIT_DEV : REF_LIMIT_FREE
}
