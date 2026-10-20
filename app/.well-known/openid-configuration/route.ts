import { authorizationServerMetadata, siteOrigin } from '@/lib/mcp/oauth'
import { json, preflight } from '@/lib/mcp/http'

/**
 * Some MCP clients look for the authorization server here first (OpenID
 * discovery). The same metadata as /.well-known/oauth-authorization-server -
 * the connector does not issue ID tokens.
 */
export const dynamic = 'force-dynamic'
export function GET(req: Request) { return json(authorizationServerMetadata(siteOrigin(req)), { headers: { 'cache-control': 'public, max-age=300' } }) }
export const OPTIONS = preflight
