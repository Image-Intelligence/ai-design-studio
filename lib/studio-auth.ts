import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/ticket-gate'
import { devTierWhere } from '@/lib/dev-tier'

/**
 * Who may use the Image Studio's editing engine.
 *
 * Any signed-in account: the editor runs inside the Edit Image popup for
 * everyone (2026-10-06) and the full studio (canvas list, the studio page) is
 * public too (2026-10-07; on Home and the dashboard 2026-10-08) - so its
 * uploads and AI tools take any session. The AI tools charge tickets
 * (lib/ticket-gate), so a user only spends their own.
 */
export async function requireStudioUser() {
  const token = (await cookies()).get('session')?.value
  if (!token) return null
  return await getUserFromSession(token)
}

/**
 * Dev Tier (or admin, or an @audit.pp reviewer account - the same rule as the
 * Refs limits in lib/ref-limits): layers, groups, masks, adjustment layers,
 * and keeping the layered version of an edit.
 */
export async function hasDevAccess(userId: number, email: string): Promise<boolean> {
  if (isAdminEmail(email) || email.endsWith('@audit.pp')) return true
  const sub = await prisma.subscription.findFirst({
    // Active, or cancelled but still in its paid period (lib/dev-tier)
    where: { userId, ...devTierWhere() },
    select: { id: true },
  })
  return !!sub
}
