/**
 * Small HTTP helpers for the connector's public endpoints (OAuth metadata,
 * registration, token, MCP). They take no cookies, so any origin may call
 * them - the MCP Inspector and other browser-based clients read them
 * cross-origin; ChatGPT and Claude call from their servers.
 */
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...(init.headers ?? {}) },
  })
}

export const preflight = () => new Response(null, { status: 204, headers: CORS })

/** A form or JSON body as a flat string map (OAuth endpoints accept both). */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? ''
  const out: Record<string, string> = {}
  if (type.includes('application/json')) {
    const o = await req.json().catch(() => ({})) as Record<string, unknown>
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out[k] = v
  } else {
    const text = await req.text().catch(() => '')
    for (const [k, v] of new URLSearchParams(text)) out[k] = v
  }
  // A public client may also send its id as HTTP Basic (with an empty secret)
  const basic = req.headers.get('authorization')?.match(/^Basic\s+(\S+)$/i)?.[1]
  if (basic && !out.client_id) {
    const [id] = Buffer.from(basic, 'base64').toString('utf8').split(':')
    if (id) out.client_id = decodeURIComponent(id)
  }
  return out
}
