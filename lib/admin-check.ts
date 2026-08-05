import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'

// Canonical server-side admin check — AdminAccount table with a hardcoded
// fallback for initial setup (mirrors app/api/admin/verify). Use this to gate
// admin-only API surfaces; do NOT use ticket-gate's isAdminEmail (that list
// only decides who generates for free).
export const FALLBACK_ADMIN_EMAILS = ['promptandprotocol@gmail.com', 'dirtysecretai@gmail.com']

export async function checkIsAdmin(email: string): Promise<boolean> {
  try {
    const count = await prisma.adminAccount.count()
    if (count === 0) return FALLBACK_ADMIN_EMAILS.includes(email)
    const account = await prisma.adminAccount.findUnique({ where: { email } })
    return !!(account?.canAccessAdmin)
  } catch {
    return FALLBACK_ADMIN_EMAILS.includes(email)
  }
}

// Dual admin gate for tool routes the browser calls directly: accepts the
// x-admin-password header (script/tool clients) OR a session cookie belonging
// to an admin account. FAIL-CLOSED on any error.
export async function checkAdminRequest(req: Request): Promise<boolean> {
  const pass = process.env.ADMIN_PASSWORD
  if (pass && req.headers.get('x-admin-password') === pass) return true
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user?.email) return false
    return await checkIsAdmin(user.email)
  } catch {
    return false
  }
}
