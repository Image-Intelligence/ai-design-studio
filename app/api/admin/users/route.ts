import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'


export async function GET() {
  try {
    // Fetch all users with their related data
    const users = await prisma.user.findMany({
      include: {
        _count: {
          select: { generatedImages: { where: { isDeleted: false } } }
        },
        tickets: true,
        subscriptions: {
          where: {
            status: 'active'
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        purchases: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Limit to last 10 purchases per user
        },
        ticketPurchases: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Limit to last 10 ticket purchases per user
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // Format the data for display
    const formattedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      ticketBalance: user.tickets?.balance || 0,
      totalTicketsBought: user.tickets?.totalBought || 0,
      totalTicketsUsed: user.tickets?.totalUsed || 0,

      // Subscription info
      hasDevTier: user.subscriptions.length > 0,
      subscription: user.subscriptions[0] ? {
        tier: user.subscriptions[0].tier,
        status: user.subscriptions[0].status,
        billingCycle: user.subscriptions[0].billingCycle,
        billingAmount: user.subscriptions[0].billingAmount,
        nextBillingDate: user.subscriptions[0].nextBillingDate,
        createdAt: user.subscriptions[0].createdAt,
        metadata: user.subscriptions[0].metadata
      } : null,

      // Purchase history
      recentPurchases: user.purchases.map(purchase => ({
        id: purchase.id,
        type: purchase.itemType,
        amount: purchase.amount,
        date: purchase.createdAt,
        paypalOrderId: purchase.paypalOrderId,
        discountCode: purchase.discountCodeUsed,
        description: purchase.description
      })),

      // Ticket purchases
      recentTicketPurchases: user.ticketPurchases.map(purchase => ({
        id: purchase.id,
        tickets: purchase.ticketsCount,
        amount: purchase.amount,
        date: purchase.createdAt,
        paypalOrderId: purchase.paypalOrderId,
        discountCode: purchase.discountCodeUsed,
        originalAmount: purchase.originalAmount,
        discountAmount: purchase.discountAmount
      })),

      // Totals
      totalSpent: [
        ...user.purchases.map(p => p.amount),
        ...user.ticketPurchases.map(p => p.amount)
      ].reduce((sum, amount) => sum + amount, 0),

      totalPurchases: user.purchases.length + user.ticketPurchases.length,
      generationCount: user._count.generatedImages
    }))

    return NextResponse.json({
      success: true,
      users: formattedUsers,
      totalUsers: formattedUsers.length,
      devTierUsers: formattedUsers.filter(u => u.hasDevTier).length,
      freeUsers: formattedUsers.filter(u => !u.hasDevTier).length
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}
