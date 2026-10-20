import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { authRedirect, consentTokenOk, issueCode, parseAuthRequest, siteOrigin } from '@/lib/mcp/oauth'
import { checkIsAdmin } from '@/lib/admin-check'
import { CONNECTOR_ADMIN_ONLY } from '@/lib/nova/config'

/**
 * POST /api/oauth/authorize - the consent form's answer (app/oauth/authorize).
 * The request is validated again from the form (never trusted from the page),
 * the anti-forgery token must match the session, and the browser is sent back
 * to the app: with a one-time code when approved, access_denied when not.
 */
export async function POST(req: Request) {
  const form = await req.formData()
  const q = new URLSearchParams()
  for (const [k, v] of form) if (typeof v === 'string' && k !== 'consent' && k !== 'decision') q.set(k, v)
  const origin = siteOrigin(req)
  const go = (url: string) => new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } })

  const parsed = await parseAuthRequest(q, origin)
  if (!parsed.ok) return 'redirect' in parsed ? go(parsed.redirect) : go(`/oauth/authorize?${q.toString()}`)
  const r = parsed.req
  const session = (await cookies()).get('session')?.value
  const user = session ? await getUserFromSession(session) : null
  if (!session || !user) return go(`/login?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`)
  if (!consentTokenOk(session, r, String(form.get('consent') ?? ''))) return go(`/oauth/authorize?${q.toString()}`)

  const state: Record<string, string> = r.state ? { state: r.state } : {}
  // Admin-only until the connector is public (CONNECTOR_ADMIN_ONLY)
  if (CONNECTOR_ADMIN_ONLY && !(await checkIsAdmin(user.email))) return go(authRedirect(r.redirectUri, origin, { error: 'access_denied', error_description: 'AI Design Studio in ChatGPT and Claude is not available yet', ...state }))
  if (form.get('decision') !== 'approve') return go(authRedirect(r.redirectUri, origin, { error: 'access_denied', error_description: 'The user cancelled', ...state }))
  const code = await issueCode(user.id, r)
  return go(authRedirect(r.redirectUri, origin, { code, ...state }))
}
