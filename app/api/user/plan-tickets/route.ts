import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { planTicketsState } from '@/lib/plan-tickets'
import { checkIsAdmin } from '@/lib/admin-check'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/plan-tickets - the account's plan ticket bar for the silver
 * recharge display: the plan's monthly bar, how much of it is left, pack
 * tickets (which never expire) and when it refills. `active: false` for
 * accounts without a plan (the display hides itself).
 */
export async function GET() {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  try {
    return jsonPrivate(await planTicketsState(user.id, { isAdmin: await checkIsAdmin(user.email) }))
  } catch (e) {
    console.error('plan-tickets failed', e)
    return jsonPrivate({ error: 'Could not load plan tickets' }, { status: 500 })
  }
}
