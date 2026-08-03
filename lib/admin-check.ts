import prisma from '@/lib/prisma'

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
