/**
 * The AI Design Studio MCP server (2026-10-20) - JSON-RPC over Streamable
 * HTTP, answered statelessly (app/api/mcp). Server only.
 *
 * Stateless on purpose: the 2026-07-28 MCP spec dropped the initialize
 * handshake and sessions, and every request here stands alone anyway (a
 * Vercel function). Older clients still send `initialize` and get the usual
 * answer; no Mcp-Session-Id is issued, so they never need to keep one.
 * Responses are plain JSON (the transport allows that instead of an SSE
 * stream) - no tool streams progress.
 */
import { TOOLS, callTool, type ToolCtx } from '@/lib/mcp/tools'
import { WIDGET_URI_MCP_APPS, WIDGET_URI_OPENAI, mediaDomains, widgetHtml } from '@/lib/mcp/widget'

const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const LATEST = SUPPORTED_VERSIONS[0]

export type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, any> }
export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const INSTRUCTIONS = [
  'AI Design Studio is an AI image and video studio. These tools work on the signed-in user\'s own account: generations spend the user\'s tickets (each model\'s site price) and are saved to their My Generations.',
  '- Images: generate_image (default nanobanana 2.1; write a full descriptive prompt; reference_ids keep a character or product consistent). Changes to a picture: edit_image.',
  '- Video: generate_video renders for 1-5 minutes; it returns a job id - tell the user it is rendering, and call get_generations to fetch it when they ask (or after a minute or two).',
  '- Before anything expensive (several videos, 4K), say what it will cost (list_models shows prices) and check the balance with get_account.',
  '- The user\'s own pictures: search_library. Results come back as links and a preview you can see - judge them against the request.',
  '- Tickets are bought on the website only (get_account gives the link); never promise to buy them here.',
  '- The site\'s content rules apply to every request: no sexual content, nothing harmful involving minors, no real people\'s likeness without consent.',
].join('\n')

function serverInfo(version: string) {
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    serverInfo: { name: 'ai-design-studio', title: 'AI Design Studio', version: '1.0.0' },
    instructions: INSTRUCTIONS,
  }
}

function resources() {
  return [
    { uri: WIDGET_URI_OPENAI, name: 'studio-results', title: 'Results', mimeType: 'text/html+skybridge', description: 'The pictures and clips a tool made' },
    { uri: WIDGET_URI_MCP_APPS, name: 'studio-results-app', title: 'Results', mimeType: 'text/html;profile=mcp-app', description: 'The pictures and clips a tool made' },
  ]
}

function readResource(uri: string, origin: string) {
  const domains = mediaDomains()
  const html = widgetHtml(origin)
  if (uri === WIDGET_URI_OPENAI) {
    return { contents: [{ uri, mimeType: 'text/html+skybridge', text: html, _meta: {
      'openai/widgetDescription': 'Shows the images and videos AI Design Studio made for this request, with their model and ticket cost.',
      'openai/widgetPrefersBorder': true,
      'openai/widgetCSP': { connect_domains: [], resource_domains: domains },
      'openai/widgetDomain': origin,
    } }] }
  }
  if (uri === WIDGET_URI_MCP_APPS) {
    return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: html, _meta: { ui: { csp: { resourceDomains: domains, connectDomains: [] }, prefersBorder: true } } }] }
  }
  return null
}

/** One JSON-RPC message; null = a notification (no answer). `ctx` is null while the caller is not signed in. */
export async function handleRpc(msg: RpcRequest, ctx: ToolCtx | null, origin: string): Promise<RpcResponse | null> {
  const id = msg.id ?? null
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (msg.id === undefined || msg.id === null) return null // notifications/initialized, cancelled...

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return ok(serverInfo(SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST))
    }
    case 'server/discover':
      return ok(serverInfo(LATEST))
    case 'ping':
      return ok({})
    case 'tools/list':
      // securitySchemes at the top level too (the Apps SDK reads it there; older builds under _meta)
      return ok({ tools: TOOLS.map(t => ({ ...t, securitySchemes: t._meta.securitySchemes })) })
    case 'resources/list':
      return ok({ resources: resources() })
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] })
    case 'resources/read': {
      const r = readResource(String(msg.params?.uri ?? ''), origin)
      return r ? ok(r) : fail(-32002, 'Resource not found')
    }
    case 'prompts/list':
      return ok({ prompts: [] })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      if (!TOOLS.some(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
      if (!ctx) {
        // Not linked yet: the apps show their "connect your account" screen from this
        return ok({
          content: [{ type: 'text', text: 'Connect your AI Design Studio account to use this.' }],
          isError: true,
          _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Sign in to AI Design Studio"`] },
        })
      }
      try {
        return ok(await callTool(ctx, name, (msg.params?.arguments ?? {}) as Record<string, any>))
      } catch (e: any) {
        console.error('[mcp] tool failed', name, e)
        return ok({ content: [{ type: 'text', text: `Something went wrong on AI Design Studio: ${String(e?.message || e).slice(0, 200)}` }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}
