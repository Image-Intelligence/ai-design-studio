import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'


export async function GET(request: Request) {
  try {
    // Check authentication
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    console.log('Fetching purchase history for user:', user.id, 'email:', user.email)

    // Fetch all ticket purchases for this specific user only
    const ticketPurchases = await prisma.ticketPurchase.findMany({
      where: {
        userId: user.id,
        paymentStatus: 'completed'
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    console.log('Found', ticketPurchases.length, 'ticket purchases for user ID:', user.id)

    // Format for display
    const formattedPurchases = ticketPurchases.map(purchase => ({
      id: purchase.id,
      type: 'Tickets',
      description: `${purchase.ticketsCount} AI Generation Ticket${purchase.ticketsCount > 1 ? 's' : ''}`,
      amount: purchase.amount,
      date: purchase.createdAt,
      status: purchase.paymentStatus,
      paypalOrderId: purchase.paypalOrderId
    }))

    return NextResponse.json(formattedPurchases)

  } catch (error: any) {
    console.error('Error fetching purchase history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch purchase history' },
      { status: 500 }
    )
  }
}

