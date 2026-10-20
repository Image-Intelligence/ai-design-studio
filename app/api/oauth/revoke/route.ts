import { revokeToken } from '@/lib/mcp/oauth'
import { json, preflight, readParams } from '@/lib/mcp/http'

/** POST /api/oauth/revoke (RFC 7009) - the app disconnects itself; always 200. */
export async function POST(req: Request) {
  const p = await readParams(req)
  if (p.token) await revokeToken(p.token)
  return json({})
}
export const OPTIONS = preflight
