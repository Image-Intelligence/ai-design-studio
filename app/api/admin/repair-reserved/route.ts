import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { isAdminEmail, repairNegativeReserved } from '@/lib/ticket-gate'

export async function POST(req: Request) {
  const adminPass = process.env.ADMIN_PASSWORD
  const hasAdminPass = adminPass && req.headers.get('x-admin-password') === adminPass
  if (!hasAdminPass) {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user || !isAdminEmail(user.email ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const fixed = await repairNegativeReserved()
  return NextResponse.json({ fixed, message: `Reset ${fixed} user(s) with negative reserved balance to 0.` })
}
