import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { excludeAdmins = false, excludeAuditAccounts = false, excludeUserIds = [] } = await req.json()

    const skipIds = new Set<number>(excludeUserIds)

    if (excludeAdmins) {
      const adminAccounts = await prisma.adminAccount.findMany({ select: { email: true } })
      if (adminAccounts.length) {
        const adminUsers = await prisma.user.findMany({
          where: { email: { in: adminAccounts.map(a => a.email) } },
          select: { id: true },
        })
        adminUsers.forEach(u => skipIds.add(u.id))
      }
    }

    if (excludeAuditAccounts) {
      const auditAccounts = await prisma.auditAccount.findMany({ select: { userId: true } })
      auditAccounts.forEach(a => skipIds.add(a.userId))
    }

    const skipArray = Array.from(skipIds)

    const result = await prisma.ticket.updateMany({
      where: skipArray.length ? { userId: { notIn: skipArray } } : {},
      data: { balance: 0 },
    })

    return NextResponse.json({ ok: true, resetCount: result.count, excludedCount: skipIds.size })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to reset tickets' }, { status: 500 })
  }
}

// Preview: returns how many accounts would be reset given the exclusion options
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const excludeAdmins = url.searchParams.get('excludeAdmins') === 'true'
    const excludeAuditAccounts = url.searchParams.get('excludeAuditAccounts') === 'true'
    const excludeUserIdsParam = url.searchParams.get('excludeUserIds')
    const excludeUserIds: number[] = excludeUserIdsParam ? JSON.parse(excludeUserIdsParam) : []

    const skipIds = new Set<number>(excludeUserIds)

    if (excludeAdmins) {
      const adminAccounts = await prisma.adminAccount.findMany({ select: { email: true } })
      if (adminAccounts.length) {
        const adminUsers = await prisma.user.findMany({
          where: { email: { in: adminAccounts.map(a => a.email) } },
          select: { id: true },
        })
        adminUsers.forEach(u => skipIds.add(u.id))
      }
    }

    if (excludeAuditAccounts) {
      const auditAccounts = await prisma.auditAccount.findMany({ select: { userId: true } })
      auditAccounts.forEach(a => skipIds.add(a.userId))
    }

    const skipArray = Array.from(skipIds)
    const totalWithTickets = await prisma.ticket.count({
      where: skipArray.length ? { userId: { notIn: skipArray } } : {},
    })

    return NextResponse.json({ willReset: totalWithTickets, excluded: skipIds.size })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to preview' }, { status: 500 })
  }
}
