import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { acceptContentTerms, createDiditSession, idVerificationAvailable } from '@/lib/id-verification'

/**
 * POST /api/id-verification/session  { acceptTerms: true } -> { url }
 *
 * Records the Content Provider terms (ToS §21) and starts a Didit hosted
 * verification; the page opens `url` in a new tab. Didit sends the person
 * back to /api/id-verification/return, which reads the decision itself.
 */
export async function POST(req: NextRequest) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Sign in first' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { acceptTerms?: unknown }
  if (body.acceptTerms !== true) return jsonPrivate({ error: 'Agree to the Content Provider terms first' }, { status: 400 })
  if (!idVerificationAvailable()) return jsonPrivate({ error: "ID verification isn't available yet - please try again soon" }, { status: 503 })
  if (!(await acceptContentTerms(user.id))) return jsonPrivate({ error: "ID verification isn't available yet - please try again soon" }, { status: 503 })
  // Back to the origin the person is on (localhost, the LAN address or the live site)
  const origin = req.headers.get('origin') || new URL(req.url).origin
  try {
    const { url } = await createDiditSession(user.id, `${origin}/api/id-verification/return`)
    return jsonPrivate({ url })
  } catch (e) {
    console.error('[id-verification] session failed:', (e as Error).message)
    return jsonPrivate({ error: "Couldn't start the verification - please try again" }, { status: 502 })
  }
}
