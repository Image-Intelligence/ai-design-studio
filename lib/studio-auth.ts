import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/ticket-gate'

/**
 * Who may use the Image Studio's editing engine.
 *
 * The Studios section (canvas list, the studio page) stays admin-only, but
 * the same editor now runs inside the Edit Image popup for EVERY signed-in
 * account (2026-10-06) - so its uploads and AI tools take any session. The AI
 * tools charge tickets (lib/ticket-gate), so a user only spends their own.
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
    where: { userId, tier: 'prompt-studio-dev', status: 'active', OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
    select: { id: true },
  })
  return !!sub
}
