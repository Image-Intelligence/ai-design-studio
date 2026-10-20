import { registerClient } from '@/lib/mcp/oauth'
import { json, preflight } from '@/lib/mcp/http'

/**
 * POST /api/oauth/register - OAuth Dynamic Client Registration (RFC 7591) for
 * MCP clients that do not publish a client metadata document. Stateless: the
 * client_id carries its redirect URIs, signed (lib/mcp/oauth).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ error: 'invalid_client_metadata', error_description: 'A JSON body is required' }, { status: 400 })
  const r = registerClient(body)
  if (!r.ok) return json({ error: 'invalid_redirect_uri', error_description: r.error }, { status: 400 })
  return json(r.client, { status: 201 })
}
export const OPTIONS = preflight
