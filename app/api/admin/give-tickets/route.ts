import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'



export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { password, userEmail, ticketsToAdd } = body

    // Verify admin password
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Invalid admin password' },
        { status: 401 }
      )
    }

    if (!userEmail || !ticketsToAdd || ticketsToAdd < 1) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    console.log(`Admin adding ${ticketsToAdd} free tickets to ${userEmail}`)

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: userEmail }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Update ticket balance
    const updatedTicket = await prisma.ticket.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        balance: ticketsToAdd,
        totalBought: ticketsToAdd,
        totalUsed: 0,
      },
      update: {
        balance: { increment: ticketsToAdd },
        totalBought: { increment: ticketsToAdd },
      },
    })

    // Create a record of the free ticket grant
    await prisma.ticketPurchase.create({
      data: {
        userId: user.id,
        ticketsCount: ticketsToAdd,
        amount: 0, // Free tickets
        paypalOrderId: `admin-grant-${Date.now()}`,
        paypalPayerId: 'admin',
        paymentStatus: 'completed',
      }
    })

    console.log(`Successfully added ${ticketsToAdd} tickets to ${userEmail}. New balance: ${updatedTicket.balance}`)

    return NextResponse.json({
      success: true,
      message: `Added ${ticketsToAdd} tickets to ${userEmail}`,
      newBalance: updatedTicket.balance,
      user: {
        id: user.id,
        email: user.email,
        ticketBalance: updatedTicket.balance
      }
    })

  } catch (error: any) {
    console.error('Error adding free tickets:', error)
    return NextResponse.json(
      { error: 'Failed to add tickets', details: error.message },
      { status: 500 }
    )
  }
}
