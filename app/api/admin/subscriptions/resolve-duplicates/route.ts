import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

// POST — find users with multiple subscription records and delete the stale ones.
// Pass { force: true } to also resolve cases where both records still have active access
// (keeps the one with the newest startDate / lsSubscriptionId, deletes the older one).
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password')
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const force = body.force === true

    const all = await prisma.subscription.findMany({
      where: { tier: 'prompt-studio-dev', status: { not: 'expired' } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      select: {
        id: true,
        userId: true,
        status: true,
        startDate: true,
        lsSubscriptionId: true,
        endDate: true,
        lsCurrentPeriodEnd: true,
        user: { select: { email: true } },
      },
    })

    // Group by userId
    const byUser: Record<number, typeof all> = {}
    for (const s of all) {
      if (!byUser[s.userId]) byUser[s.userId] = []
      byUser[s.userId].push(s)
    }

    const deleted: { id: number; email: string; reason: string }[] = []
    const now = new Date()

    for (const [, subs] of Object.entries(byUser)) {
      if (subs.length <= 1) continue

      // Pick winner: prefer active status, then latest startDate
      const winner = subs.find(s => s.status === 'active') ?? subs[0]
      const stale  = subs.filter(s => s.id !== winner.id)

      for (const s of stale) {
        const periodEnd = s.lsCurrentPeriodEnd ? new Date(s.lsCurrentPeriodEnd) : null
        const endDate   = s.endDate ? new Date(s.endDate) : null
        const hasAccess = (periodEnd && periodEnd > now) || (endDate && endDate > now)

        if (s.status === 'active' || hasAccess) {
          if (!force) continue
          // Force mode: retire the older record instead of deleting so transaction history is preserved
          await prisma.subscription.update({
            where: { id: s.id },
            data: { status: 'expired', autoRenew: false, endDate: new Date(), lsSubscriptionId: null },
          })
          deleted.push({ id: s.id, email: s.user.email, reason: `force-retired (both had access — kept newer record #${winner.id})` })
          continue
        }

        await prisma.subscription.delete({ where: { id: s.id } })
        deleted.push({ id: s.id, email: s.user.email, reason: `${s.status} · no remaining access` })
      }
    }

    return NextResponse.json({ success: true, deleted, count: deleted.length })
  } catch (error: any) {
    console.error('[resolve-duplicates] error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

// GET — count duplicates and return which users are affected
export async function GET(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password')
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const all = await prisma.subscription.findMany({
      where: { tier: 'prompt-studio-dev', status: { not: 'expired' } },
      select: {
        id: true,
        userId: true,
        status: true,
        startDate: true,
        lsSubscriptionId: true,
        endDate: true,
        lsCurrentPeriodEnd: true,
        user: { select: { email: true } },
      },
    })

    const byUser: Record<number, typeof all> = {}
    for (const s of all) {
      if (!byUser[s.userId]) byUser[s.userId] = []
      byUser[s.userId].push(s)
    }

    const now = new Date()
    const duplicates = Object.entries(byUser)
      .filter(([, subs]) => subs.length > 1)
      .map(([, subs]) => {
        const email = subs[0].user.email
        const canAutoResolve = subs.some(s => {
          const periodEnd = s.lsCurrentPeriodEnd ? new Date(s.lsCurrentPeriodEnd) : null
          const endDate   = s.endDate ? new Date(s.endDate) : null
          const hasAccess = (periodEnd && periodEnd > now) || (endDate && endDate > now)
          return s.status !== 'active' && !hasAccess
        })
        return { email, count: subs.length, canAutoResolve }
      })

    return NextResponse.json({ success: true, duplicateUserCount: duplicates.length, duplicates })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}
