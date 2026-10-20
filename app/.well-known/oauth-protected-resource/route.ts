import { protectedResourceMetadata, siteOrigin } from '@/lib/mcp/oauth'
import { json, preflight } from '@/lib/mcp/http'

/** OAuth Protected Resource Metadata (RFC 9728): the MCP server (/api/mcp) and who issues its tokens. */
export const dynamic = 'force-dynamic'
export function GET(req: Request) { return json(protectedResourceMetadata(siteOrigin(req)), { headers: { 'cache-control': 'public, max-age=300' } }) }
export const OPTIONS = preflight
