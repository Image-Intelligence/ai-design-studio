import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


async function buildSkipSet(
  excludeAdmins: boolean,
  excludeAuditAccounts: boolean,
  excludeUserIds: number[],
): Promise<number[]> {
  const skip = new Set<number>(excludeUserIds)

  if (excludeAdmins) {
    const adminAccounts = await prisma.adminAccount.findMany({ select: { email: true } })
    if (adminAccounts.length) {
      const adminUsers = await prisma.user.findMany({
        where: { email: { in: adminAccounts.map(a => a.email) } },
        select: { id: true },
      })
      adminUsers.forEach(u => skip.add(u.id))
    }
  }

  if (excludeAuditAccounts) {
    const auditAccounts = await prisma.auditAccount.findMany({ select: { userId: true } })
    auditAccounts.forEach(a => skip.add(a.userId))
  }

  return Array.from(skip)
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { excludeAdmins = false, excludeAuditAccounts = false, excludeUserIds = [] } = await req.json()
    const skipArray = await buildSkipSet(excludeAdmins, excludeAuditAccounts, excludeUserIds)

    const now = new Date()
    const result = await prisma.subscription.updateMany({
      where: {
        status: 'active',
        ...(skipArray.length ? { userId: { notIn: skipArray } } : {}),
      },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        endDate: now,
        autoRenew: false,
      },
    })

    return NextResponse.json({ ok: true, revokedCount: result.count, excludedCount: skipArray.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to revoke subscriptions' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const excludeAdmins = url.searchParams.get('excludeAdmins') === 'true'
    const excludeAuditAccounts = url.searchParams.get('excludeAuditAccounts') === 'true'
    const excludeUserIds: number[] = JSON.parse(url.searchParams.get('excludeUserIds') ?? '[]')

    const skipArray = await buildSkipSet(excludeAdmins, excludeAuditAccounts, excludeUserIds)

    const willRevoke = await prisma.subscription.count({
      where: {
        status: 'active',
        ...(skipArray.length ? { userId: { notIn: skipArray } } : {}),
      },
    })

    return NextResponse.json({ willRevoke, excluded: skipArray.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to preview' }, { status: 500 })
  }
}
