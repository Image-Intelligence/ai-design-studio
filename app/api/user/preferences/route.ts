import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'

async function getAuthUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return null
  return getUserFromSession(token)
}

// GET /api/user/preferences
export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { portalPreferences: true },
    })

    return NextResponse.json({ preferences: row?.portalPreferences ?? {} })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PUT /api/user/preferences — shallow-merge update
export async function PUT(req: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { portalPreferences: true },
    })
    const current = (existing?.portalPreferences as Record<string, any>) ?? {}
    const merged = { ...current, ...body }

    await prisma.user.update({
      where: { id: user.id },
      data: { portalPreferences: merged },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
