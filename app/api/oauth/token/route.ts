import { exchangeCode, refreshTokens, siteOrigin } from '@/lib/mcp/oauth'
import { json, preflight, readParams } from '@/lib/mcp/http'

/**
 * POST /api/oauth/token - swap an authorization code (with its PKCE verifier)
 * or a refresh token for the connector's tokens (lib/mcp/oauth).
 */
export async function POST(req: Request) {
  const p = await readParams(req)
  const clientId = p.client_id ?? ''
  if (!clientId) return json({ error: 'invalid_client', error_description: 'client_id is required' }, { status: 401 })
  const out = p.grant_type === 'authorization_code'
    ? await exchangeCode({ code: p.code ?? '', verifier: p.code_verifier ?? '', clientId, redirectUri: p.redirect_uri ?? null, resource: p.resource ?? null }, siteOrigin(req))
    : p.grant_type === 'refresh_token'
      ? await refreshTokens({ refreshToken: p.refresh_token ?? '', clientId })
      : { error: 'unsupported_grant_type', error_description: 'Use authorization_code or refresh_token' }
  return json(out, { status: 'error' in out ? 400 : 200, headers: { pragma: 'no-cache' } })
}
export const OPTIONS = preflight
