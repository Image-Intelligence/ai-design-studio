import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'

export const dynamic = 'force-dynamic'

/**
 * POST /api/realtime/krea - the token for a Krea 3 Realtime session
 * (components/realtime/KreaLiveSession, 2026-10-15).
 *
 * The page talks to fal's realtime socket itself (frames come back in ~0.3s;
 * going through our server would double that). To open the socket it needs a
 * short-lived fal token, and @fal-ai/client fetches one through `proxyUrl` -
 * which is this route. It is NOT a general fal proxy: it answers only the
 * token request (x-fal-target-url = fal's /tokens/), and only for Krea 3's app,
 * so the browser never holds the account's key and can't reach anything else.
 *
 * ADMIN ONLY while under test. Time is paid separately, in 30-second blocks
 * (./meter) - before this goes public, minting must also check that the
 * session's block is paid, so a page can't keep a socket open unmetered.
 */
const TOKENS_URL = 'https://rest.alpha.fal.ai/tokens/'
/** fal's app alias for krea/v3 (the realtime endpoint is its /realtime path). */
const APP_ALIAS = 'v3'

export async function POST(req: NextRequest) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Krea 3 Realtime is not available' }, { status: 403 })
  const target = (req.headers.get('x-fal-target-url') ?? '').replace(/\/+$/, '/')
  if (target !== TOKENS_URL) return jsonPrivate({ error: 'Only realtime tokens are issued here' }, { status: 400 })
  const key = process.env.FAL_KEY
  if (!key) return jsonPrivate({ error: 'fal is not set up' }, { status: 500 })

  const r = await fetch(TOKENS_URL, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    // Whatever the page asked for, the token opens Krea 3 and nothing else, for 2 minutes
    body: JSON.stringify({ allowed_apps: [APP_ALIAS], token_expiration: 120 }),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok || !body) return jsonPrivate({ error: 'Could not start a realtime session' }, { status: 502 })
  // fal answers with the token as a JSON string - handed back as is
  return jsonPrivate(body)
}
