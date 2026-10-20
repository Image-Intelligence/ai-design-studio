import { authorizationServerMetadata, siteOrigin } from '@/lib/mcp/oauth'
import { json, preflight } from '@/lib/mcp/http'

/** OAuth 2.0 Authorization Server Metadata (RFC 8414) for the connector (lib/mcp/oauth). */
export const dynamic = 'force-dynamic'
export function GET(req: Request) { return json(authorizationServerMetadata(siteOrigin(req)), { headers: { 'cache-control': 'public, max-age=300' } }) }
export const OPTIONS = preflight
