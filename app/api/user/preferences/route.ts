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
    // `_enhance` is the server's daily prompt-enhancement count
    // (lib/prompt-enhance) - never writable from the browser
    if (body && typeof body === 'object') delete body._enhance

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected an object' }, { status: 400 })
    }
    // Shallow merge done IN the database (jsonb ||), not read-merge-write:
    // a read-then-write here could overwrite a field another request changed
    // in between - like the enhancement count above
    await prisma.$executeRaw`
      UPDATE "User"
      SET "portalPreferences" = COALESCE("portalPreferences"::jsonb, '{}'::jsonb) || ${JSON.stringify(body)}::jsonb
      WHERE id = ${user.id}`

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
