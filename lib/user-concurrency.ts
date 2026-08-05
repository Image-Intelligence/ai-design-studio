import prisma from '@/lib/prisma'

const OWNER_EMAILS = ['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com']

// Limits per tier: owner=unlimited, dev=6, free=2
export async function getUserConcurrencyLimit(userId: number): Promise<number> {
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.subscription.findFirst({
      where: {
        userId,
        tier: 'prompt-studio-dev',
        status: 'active',
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { id: true },
    }),
  ])
  if (!user) return 2
  if (OWNER_EMAILS.includes(user.email)) return 999
  // Audit/reviewer accounts (@audit.pp, e.g. CCBill compliance) test as Dev Tier
  if (user.email.endsWith('@audit.pp')) return 6
  return sub ? 6 : 2
}

// Count active (processing or queued) image generations for this user
export async function getUserActiveGenerations(userId: number): Promise<number> {
  return prisma.generationQueue.count({
    where: {
      userId,
      modelType: 'image',
      status: { in: ['processing', 'queued'] },
    },
  })
}

export async function checkUserConcurrency(
  userId: number,
  slotsNeeded = 1
): Promise<{ allowed: boolean; activeCount: number; limit: number }> {
  const [activeCount, limit] = await Promise.all([
    getUserActiveGenerations(userId),
    getUserConcurrencyLimit(userId),
  ])
  return { allowed: activeCount + slotsNeeded <= limit, activeCount, limit }
}
