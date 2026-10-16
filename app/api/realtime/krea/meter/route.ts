import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { KREA3_REALTIME_BLOCK_SEC, KREA3_REALTIME_BLOCK_TICKETS } from '@/lib/ticket-pricing'

export const dynamic = 'force-dynamic'

/**
 * POST /api/realtime/krea/meter - pays for the next 30 seconds of a Krea 3
 * Realtime session. fal bills every second the socket is open ($0.013/s), so
 * the page calls this when it opens one and every 30 seconds while it stays
 * open, and closes the socket when a block can't be paid (or after 20 idle
 * seconds - an idle socket still bills).
 *
 * Returns: { ok, tickets, seconds, balance }. Admins are not charged
 * (lib/ticket-gate); ADMIN ONLY while under test.
 */
export async function POST() {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Krea 3 Realtime is not available' }, { status: 403 })
  const paid = await deductGenerationTickets(user.id, user.email, KREA3_REALTIME_BLOCK_TICKETS)
  if (!paid.ok) {
    return jsonPrivate({ error: `The next ${KREA3_REALTIME_BLOCK_SEC} seconds need ${paid.need} tickets - you have ${paid.have}`, needTickets: true }, { status: 402 })
  }
  // Admins aren't deducted (newBalance -1) - the panel's counter shows 0 for them, not a charge that never happened
  return jsonPrivate({ ok: true, tickets: paid.newBalance === -1 ? 0 : KREA3_REALTIME_BLOCK_TICKETS, seconds: KREA3_REALTIME_BLOCK_SEC, balance: paid.newBalance })
}
