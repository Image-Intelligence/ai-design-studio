import { NextResponse } from 'next/server'
import { getUserFromSession } from '@/lib/auth'
import { getUserActiveGenerations, getUserConcurrencyLimit } from '@/lib/user-concurrency'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

// GET /api/admin/my-active-count
// Returns the current user's active generation count and their limit.
// Polled every 10s by the portal to keep the counter in sync across devices.
export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null

    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const [activeCount, limit] = await Promise.all([
      getUserActiveGenerations(sessionUser.id),
      getUserConcurrencyLimit(sessionUser.id),
    ])

    return NextResponse.json({ activeCount, limit })
  } catch (err: any) {
    console.error('my-active-count error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
