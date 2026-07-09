import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { checkAuth } from '@/lib/admin-auth'


// GET - Fetch all generated images with user info (admin only)
// Query params: page, limit, type (all | image | video), userIds (comma-separated), rated (true)
export async function GET(request: Request) {
  // This returns EVERY user's images + emails/names — was fully public. Admin-gated now.
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(request.url)
    const page         = parseInt(searchParams.get('page')  || '1')
    const limit        = parseInt(searchParams.get('limit') || '24')
    const type         = searchParams.get('type') || 'all'
    const userIdsParam = searchParams.get('userIds') || ''
    const ratedOnly    = searchParams.get('rated') === 'true'
    const skip         = (page - 1) * limit

    const userIds = userIdsParam
      ? userIdsParam.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
      : []

    let whereClause: Prisma.GeneratedImageWhereInput = { isDeleted: false }

    if (type === 'video') {
      whereClause = { ...whereClause, NOT: { videoMetadata: { equals: Prisma.JsonNull } } }
    } else if (type === 'image') {
      whereClause = { ...whereClause, videoMetadata: { equals: Prisma.AnyNull } }
    }

    if (userIds.length > 0) {
      whereClause = { ...whereClause, userId: { in: userIds } }
    }

    if (ratedOnly) {
      whereClause = { ...whereClause, imageRating: { isNot: null } }
    }

    const [total, images] = await prisma.$transaction([
      prisma.generatedImage.count({ where: whereClause }),
      prisma.generatedImage.findMany({
        where: whereClause,
        include: {
          user: { select: { id: true, email: true, name: true } },
          imageRating: { select: { score: true, feedbackText: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    return NextResponse.json({
      images,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Error fetching admin images:', error)
    return NextResponse.json({ error: 'Failed to fetch images' }, { status: 500 })
  }
}
