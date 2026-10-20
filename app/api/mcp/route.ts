import prisma from '@/lib/prisma'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { mcpResource, siteOrigin } from '@/lib/mcp/oauth'
import { CORS, preflight } from '@/lib/mcp/http'
import { SUPPORTED_VERSIONS, handleRpc, type RpcRequest, type RpcResponse } from '@/lib/mcp/server'
import type { ToolCtx } from '@/lib/mcp/tools'

/**
 * /api/mcp - the AI Design Studio connector for ChatGPT and Claude (and any
 * MCP client): Streamable HTTP, JSON responses, stateless (lib/mcp/server).
 *
 * Every request needs a bearer token: the connection's OAuth access token
 * (lib/mcp/oauth - checked to be FOR this server, RFC 8707) or a personal
 * API key (pp_live_..., for MCP clients set up by hand). Without one the
 * answer is 401 with the WWW-Authenticate challenge that starts the apps'
 * sign-in flow.
 */
export const runtime = 'nodejs'
// An image is waited for inside the call (up to ~50s); video is started and fetched later
export const maxDuration = 120

function challenge(origin: string, error?: string): Response {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource"`, 'scope="studio"', ...(error ? [`error="${error}"`, 'error_description="Sign in to AI Design Studio again"'] : [])]
  return new Response(JSON.stringify({ error: error ?? 'unauthorized', error_description: 'Connect your AI Design Studio account' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer ${parts.join(', ')}`, ...CORS },
  })
}

async function context(req: Request, origin: string): Promise<ToolCtx | 'invalid' | null> {
  const auth = await authenticateApiKey(req)
  if (auth === null || auth === 'invalid') return auth
  // A connector token must have been issued for THIS server
  const row = await prisma.apiKey.findUnique({ where: { id: auth.keyId }, select: { permissions: true } })
  const oauth = (row?.permissions as { oauth?: { resource?: string; clientName?: string } } | null)?.oauth
  if (oauth && (oauth.resource ?? '').replace(/\/$/, '') !== mcpResource(origin)) return 'invalid'
  return {
    auth, origin,
    headers: { authorization: req.headers.get('authorization') ?? '' },
    app: oauth?.clientName ?? 'MCP',
  }
}

export async function POST(req: Request) {
  const origin = siteOrigin(req)
  const ctx = await context(req, origin)
  if (ctx === null) return challenge(origin)
  if (ctx === 'invalid') return challenge(origin, 'invalid_token')

  let body: unknown
  try { body = await req.json() } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }
  const batch = Array.isArray(body)
  const msgs = (batch ? body : [body]) as RpcRequest[]
  if (!msgs.length || msgs.some(m => !m || typeof m !== 'object' || typeof m.method !== 'string')) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, { status: 400, headers: CORS })
  }
  /*
   * The protocol version (2026-07-28: an MCP-Protocol-Version header and the
   * same value in each request's _meta). One this server does not speak gets
   * the spec's -32022 with the versions it does, and the client retries with
   * one of them (or falls back to initialize).
   */
  const asked = req.headers.get('mcp-protocol-version') ?? (msgs[0]?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] as string | undefined)
  if (asked && !SUPPORTED_VERSIONS.includes(asked) && !msgs.some(m => m.method === 'initialize')) {
    console.log(`[mcp] unsupported protocol version ${asked} (${msgs.map(m => m.method).join(',')})`)
    return Response.json({ jsonrpc: '2.0', id: msgs[0]?.id ?? null, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED_VERSIONS, requested: asked } } }, { status: 400, headers: CORS })
  }
  const answers = (await Promise.all(msgs.map(m => handleRpc(m, ctx, origin)))).filter((a): a is RpcResponse => !!a)
  // One line per call in the function log (methods and outcome only - no prompts, no tokens)
  console.log(`[mcp] ${ctx.app} v=${asked ?? '-'} ${msgs.map(m => m.method === 'tools/call' ? `tools/call:${String(m.params?.name ?? '')}` : m.method).join(',')} -> ${answers.map(a => (a.error ? `err${a.error.code}` : 'ok')).join(',') || '202'}`)
  // Only notifications: accepted, nothing to say
  if (!answers.length) return new Response(null, { status: 202, headers: CORS })
  // A method this server does not have: 404 as well as -32601 (2026-07-28)
  const status = !batch && answers[0].error?.code === -32601 ? 404 : 200
  return new Response(JSON.stringify(batch ? answers : answers[0]), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } })
}

/** No server-to-client stream: everything is answered in the POST. */
export function GET() {
  return new Response(JSON.stringify({ error: 'Use POST - this MCP server answers every request directly' }), { status: 405, headers: { allow: 'POST, OPTIONS', 'content-type': 'application/json', ...CORS } })
}
/** Nothing to end - no sessions are kept. */
export function DELETE() { return new Response(null, { status: 204, headers: CORS }) }
export const OPTIONS = preflight
