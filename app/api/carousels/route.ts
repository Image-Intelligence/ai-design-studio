import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'


export async function GET() {
  try {
    // Get user from session
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value

    let userId: number | null = null

    if (token) {
      const user = await getUserFromSession(token)
      if (user) {
        userId = user.id
      }
    }

    // If user is logged in, fetch their carousel images
    // Otherwise return empty arrays
    if (!userId) {
      return NextResponse.json({
        left: [],
        right: []
      })
    }

    // Get user's carousel images
    const leftImages = await prisma.carouselImage.findMany({
      where: {
        userId: userId,
        side: 'left',
        isActive: true
      },
      orderBy: {
        position: 'asc'
      }
    })

    const rightImages = await prisma.carouselImage.findMany({
      where: {
        userId: userId,
        side: 'right',
        isActive: true
      },
      orderBy: {
        position: 'asc'
      }
    })

    return NextResponse.json({
      left: leftImages || [],
      right: rightImages || []
    })
  } catch (error) {
    console.error('Error fetching carousel images:', error)
    // Return empty arrays instead of error to prevent JSON parsing issues
    return NextResponse.json({
      left: [],
      right: []
    })
  }
}
