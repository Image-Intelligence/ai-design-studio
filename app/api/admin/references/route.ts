import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Admin browser for user reference libraries (dataset page "Reference" mode).
// Includes soft-cleared refs when includeCleared=true — admins can see
// everything a user has ever uploaded, even after they "clear" it.

function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

export async function GET(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(request.url)

    // Tree mode: one user's full folder structure + refs
    const treeUser = parseInt(searchParams.get('treeUser') || '')
    const includeCleared = searchParams.get('includeCleared') === 'true'

    if (!isNaN(treeUser)) {
      // Tree mode shows the user's ORGANIZED library (library-source only) —
      // backfilled generation-history refs are folderless and would flood the root
      const [folders, references] = await Promise.all([
        prisma.userRefFolder.findMany({
          where: { userId: treeUser },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, parentId: true },
        }),
        prisma.userReference.findMany({
          where: { userId: treeUser, source: 'library', ...(includeCleared ? {} : { isCleared: false }) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5000,
          select: { id: true, url: true, folderId: true, isCleared: true, clearedAt: true, createdAt: true, source: true },
        }),
      ])
      return NextResponse.json({ folders, references })
    }

    // Flat mode: paginated grid across users
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(120, Math.max(1, parseInt(searchParams.get('limit') || '60')))
    const sort = searchParams.get('sort') === 'oldest' ? 'asc' : 'desc'
    const userIds = searchParams.getAll('userId').map(Number).filter(n => !isNaN(n) && n > 0)
    // source filter: 'library' (dropdown uploads) | 'generation' (backfilled history)
    const sourceParam = searchParams.get('source')
    const source = sourceParam === 'library' || sourceParam === 'generation' ? sourceParam : null

    const where = {
      ...(userIds.length === 1 ? { userId: userIds[0] } : userIds.length > 1 ? { userId: { in: userIds } } : {}),
      ...(includeCleared ? {} : { isCleared: false }),
      ...(source ? { source } : {}),
    }

    const [total, rows, userGroups] = await Promise.all([
      prisma.userReference.count({ where }),
      prisma.userReference.findMany({
        where,
        orderBy: [{ createdAt: sort }, { id: sort }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, url: true, userId: true, folderId: true,
          isCleared: true, clearedAt: true, createdAt: true, source: true,
          user: { select: { email: true, name: true } },
          folder: { select: { name: true } },
        },
      }),
      // Users facet: everyone who has ever uploaded a ref (cleared included)
      prisma.userReference.groupBy({
        by: ['userId'],
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 100,
      }),
    ])

    const facetUsers = await prisma.user.findMany({
      where: { id: { in: userGroups.map(g => g.userId) } },
      select: { id: true, email: true, name: true },
    })
    const emailById = new Map(facetUsers.map(u => [u.id, u]))

    return NextResponse.json({
      references: rows.map(r => ({
        id: r.id,
        url: r.url,
        userId: r.userId,
        userEmail: r.user?.email ?? null,
        userName: r.user?.name ?? null,
        folderId: r.folderId,
        folderName: r.folder?.name ?? null,
        isCleared: r.isCleared,
        clearedAt: r.clearedAt,
        createdAt: r.createdAt,
        source: r.source,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      facets: {
        users: userGroups.map(g => ({
          id: g.userId,
          email: emailById.get(g.userId)?.email ?? `user ${g.userId}`,
          name: emailById.get(g.userId)?.name ?? null,
          count: g._count._all,
        })),
      },
    })
  } catch (error) {
    console.error('admin references GET error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
