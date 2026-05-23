import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

// POST /api/admin/use-tickets
// Deducts or refunds tickets from the current session user.
// Used by portal-v2 for async models (NB2, Kling V3, Kling O3) that bypass /api/generate.
// body: { action: "deduct" | "refund", amount: number }
// Returns: { success: true, newBalance: number }
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const user = await getUserFromSession(token)
    if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const { action, amount } = await req.json()
    if (!action || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Invalid action or amount' }, { status: 400 })
    }

    if (action === 'deduct') {
      const ticket = await prisma.ticket.findUnique({ where: { userId: user.id } })
      if (!ticket || ticket.balance < amount) {
        return NextResponse.json({ error: 'Insufficient tickets' }, { status: 402 })
      }
      const updated = await prisma.ticket.update({
        where: { userId: user.id },
        data: { balance: { decrement: amount }, totalUsed: { increment: amount } },
        select: { balance: true },
      })
      return NextResponse.json({ success: true, newBalance: updated.balance })
    }

    if (action === 'refund') {
      const ticket = await prisma.ticket.findUnique({ where: { userId: user.id } })
      if (!ticket) return NextResponse.json({ error: 'No ticket record' }, { status: 400 })
      // Cap refund: balance can never exceed totalBought (prevents arbitrary ticket inflation)
      const maxRefundable = Math.max(0, ticket.totalBought - ticket.balance)
      const effectiveAmount = Math.min(amount, maxRefundable)
      if (effectiveAmount <= 0) {
        return NextResponse.json({ success: true, newBalance: ticket.balance })
      }
      const updated = await prisma.ticket.update({
        where: { userId: user.id },
        data: { balance: { increment: effectiveAmount } },
        select: { balance: true },
      })
      return NextResponse.json({ success: true, newBalance: updated.balance })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('use-tickets error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
