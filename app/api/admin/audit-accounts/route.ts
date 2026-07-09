import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { checkAuth } from '@/lib/admin-auth'


function generateUsername(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const suffix = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `auditor_${suffix}`
}

function generatePassword(): string {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower  = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]
  const chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(digits), pick(digits), pick(upper + lower), pick(digits + lower)]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const accounts = await prisma.auditAccount.findMany({ orderBy: { addedAt: 'desc' } })
    if (!accounts.length) return NextResponse.json([])

    const userIds = accounts.map(a => a.userId)
    const tickets = await prisma.ticket.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, balance: true },
    })
    const ticketMap = Object.fromEntries(tickets.map(t => [t.userId, t.balance]))

    return NextResponse.json(accounts.map(a => ({
      id: a.id, username: a.username, internalEmail: a.internalEmail,
      plainPassword: a.plainPassword, notes: a.notes,
      ticketBalance: ticketMap[a.userId] ?? 0, addedAt: a.addedAt,
    })))
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to fetch accounts' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { notes, tickets: ticketCount = 100 } = await req.json()
    const balance = Math.max(0, parseInt(ticketCount) || 0)

    // Generate unique username
    let username = ''
    let internalEmail = ''
    for (let i = 0; i < 10; i++) {
      username = generateUsername()
      internalEmail = `${username}@audit.pp`
      const existing = await prisma.auditAccount.findUnique({ where: { username } })
      if (!existing) break
    }

    const plainPassword = generatePassword()
    const hashed = await hashPassword(plainPassword)

    const user = await prisma.user.create({
      data: { email: internalEmail, password: hashed, name: username },
    })

    await prisma.ticket.create({ data: { userId: user.id, balance } })

    const account = await prisma.auditAccount.create({
      data: { username, internalEmail, plainPassword, userId: user.id, notes: notes || null },
    })

    return NextResponse.json({ ...account, ticketBalance: balance })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to create account' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, notes, tickets } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const account = await prisma.auditAccount.update({
      where: { id },
      data: { notes: notes !== undefined ? (notes || null) : undefined },
    })

    if (typeof tickets === 'number') {
      await prisma.ticket.upsert({
        where: { userId: account.userId },
        update: { balance: Math.max(0, tickets) },
        create: { userId: account.userId, balance: Math.max(0, tickets) },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to update account' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const id = parseInt(new URL(req.url).searchParams.get('id') || '')
    if (isNaN(id)) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await prisma.auditAccount.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to delete account' }, { status: 500 })
  }
}
