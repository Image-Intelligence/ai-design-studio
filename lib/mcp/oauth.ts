/**
 * Sign-in for the AI Design Studio connector (2026-10-20) - the OAuth 2.1
 * authorization server ChatGPT and Claude use before they may call the MCP
 * server (app/api/mcp) on a user's behalf. Server only.
 *
 * THE FLOW (MCP authorization spec / OpenAI Apps SDK auth):
 *  1. The app calls /api/mcp without a token -> 401 + WWW-Authenticate
 *     pointing at /.well-known/oauth-protected-resource, which names this site
 *     as the authorization server (/.well-known/oauth-authorization-server).
 *  2. It identifies itself - a Client ID Metadata Document (CIMD: its
 *     client_id is an https URL describing it; ChatGPT and Claude both do
 *     this) or Dynamic Client Registration (/api/oauth/register) - and sends
 *     the user to /oauth/authorize with a PKCE (S256) challenge.
 *  3. The user signs in with their normal account and approves; the app gets a
 *     one-time code, swaps it at /api/oauth/token for an access + refresh token.
 *
 * NO NEW TABLES: a connection IS a personal API key (ApiKey, lib/api-key-auth)
 * - the same revocable, scoped, hashed key the site's generation routes
 * already accept (Nova's background runs use one). Approving creates the row
 * disabled, holding the hashed code and its PKCE challenge in
 * permissions.oauth; the token exchange enables it ONCE (an atomic UPDATE ...
 * WHERE disabled) and sets its key to the new access token. A refresh rotates
 * the key, so the old access token dies with it. Disconnecting deletes the row.
 * Access tokens also expire (permissions.oauth.accessExp, checked in
 * lib/api-key-auth).
 *
 * DCR clients are stateless too: the client_id carries its redirect URIs and
 * name, signed with a key derived from an existing server secret.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma'
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from '@/lib/api-key-auth'

// ── where we are ─────────────────────────────────────────────────────────────

/** This site's public origin for the request (the issuer, and the MCP resource's host). */
export function siteOrigin(req: Request): string {
  const h = req.headers
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  if (host) return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`
  return new URL(req.url).origin
}
export const mcpResource = (origin: string) => `${origin}/api/mcp`

/** The one consent scope the apps ask for, and what it allows (the key's scopes). */
export const OAUTH_SCOPE = 'studio'
export const CONNECTOR_KEY_SCOPES = ['tickets:read', 'tickets:spend', 'generate:image', 'generate:video', 'jobs:read', 'feed:read', 'references:read']
export const CONNECTOR_KEY_PREFIX = 'Connector: '

const CODE_TTL_MS = 5 * 60_000
/** An access token lives a day; the refresh token (rotated on use) keeps the connection going. */
export const ACCESS_TTL_S = 24 * 3600
const REFRESH_TTL_MS = 120 * 24 * 3600_000

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [OAUTH_SCOPE],
    client_id_metadata_document_supported: true,
    // Every redirect back (errors included) carries iss = issuer (RFC 9207)
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/connect`,
  }
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'AI Design Studio',
    resource_documentation: `${origin}/connect`,
  }
}

// ── clients ──────────────────────────────────────────────────────────────────

export type OAuthClient = { clientId: string; name: string; logo: string | null; redirectUris: string[]; kind: 'cimd' | 'dcr' }

const SECRET = createHmac('sha256', process.env.OAUTH_SECRET || process.env.MEDIA_SIGNING_SECRET || process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || 'dev-only').update('oauth-dcr-v1').digest()
const b64 = (s: string) => Buffer.from(s).toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
const sign = (s: string) => createHmac('sha256', SECRET).update(s).digest('base64url')
const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/**
 * Who may host a client metadata document (CIMD): the apps this connector is
 * for. Anyone else registers through DCR. (Fetching any URL a request names
 * would let the endpoint be pointed at arbitrary hosts.)
 */
const CIMD_HOSTS = ['chatgpt.com', 'openai.com', 'claude.ai', 'claude.com', 'anthropic.com']
const cimdAllowed = (u: URL) => u.protocol === 'https:' && CIMD_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))

const okRedirect = (u: unknown): u is string => {
  if (typeof u !== 'string' || u.length > 500) return false
  try {
    const x = new URL(u)
    if (x.hash) return false
    // https everywhere; plain http only back to this machine (local MCP tools)
    return x.protocol === 'https:' || (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1'))
  } catch { return false }
}

export function registerClient(body: Record<string, unknown>): { ok: true; client: Record<string, unknown> } | { ok: false; error: string } {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) return { ok: false, error: 'redirect_uris must be 1-10 https URLs' }
  const name = String(body.client_name ?? 'An AI app').replace(/\s+/g, ' ').trim().slice(0, 80) || 'An AI app'
  const payload = b64(JSON.stringify({ r: uris, n: name, t: Date.now() }))
  const clientId = `dcr.${payload}.${sign(payload)}`
  return {
    ok: true,
    client: {
      client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: OAUTH_SCOPE,
    },
  }
}

const cimdCache = new Map<string, { at: number; client: OAuthClient | null }>()

/** Resolve a client_id (a signed DCR id or a CIMD URL); null = unknown / invalid. */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (clientId.startsWith('dcr.')) {
    const [, payload, sig] = clientId.split('.')
    if (!payload || !sig || !sameText(sign(payload), sig)) return null
    try {
      const o = JSON.parse(unb64(payload)) as { r: string[]; n: string }
      return { clientId, name: o.n, logo: null, redirectUris: o.r.filter(okRedirect), kind: 'dcr' }
    } catch { return null }
  }
  let url: URL
  try { url = new URL(clientId) } catch { return null }
  if (!cimdAllowed(url)) return null
  const hit = cimdCache.get(clientId)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.client
  let client: OAuthClient | null = null
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(6000) })
    const text = r.ok ? await r.text() : ''
    if (text && text.length < 64_000) {
      const doc = JSON.parse(text) as Record<string, unknown>
      // The document must name itself (CIMD)
      if (doc.client_id === clientId && Array.isArray(doc.redirect_uris)) {
        client = {
          clientId, kind: 'cimd',
          name: String(doc.client_name ?? url.hostname).slice(0, 80),
          logo: typeof doc.logo_uri === 'string' && doc.logo_uri.startsWith('https://') ? doc.logo_uri : null,
          redirectUris: doc.redirect_uris.filter(okRedirect),
        }
      }
    }
  } catch { client = null }
  cimdCache.set(clientId, { at: Date.now(), client })
  return client
}

/**
 * The app's name as the user knows it (the consent screen and Connected
 * apps) - from WHERE the code is sent, never from the name the app gives
 * itself: anyone can register a client called "ChatGPT", but only ChatGPT
 * receives codes at chatgpt.com. Any other app is shown by its own name,
 * marked unverified.
 */
export function friendlyClientName(c: Pick<OAuthClient, 'name' | 'clientId' | 'redirectUris' | 'kind'>): string {
  const hosts = [c.kind === 'cimd' ? safeHost(c.clientId) : null, ...c.redirectUris.map(safeHost)].filter((h): h is string => !!h)
  const all = (re: RegExp) => hosts.length > 0 && c.redirectUris.every(u => re.test(safeHost(u) ?? ''))
  if (all(/(^|\.)(chatgpt\.com|openai\.com)$/)) return 'ChatGPT'
  if (all(/(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/)) return 'Claude'
  return `${c.name} (unverified app)`
}
function safeHost(u: string): string | null { try { return new URL(u).hostname.toLowerCase() } catch { return null } }

// ── the authorization request ───────────────────────────────────────────────

export type AuthRequest = {
  client: OAuthClient
  redirectUri: string
  state: string | null
  codeChallenge: string
  resource: string
  scope: string
}

/**
 * Validate /oauth/authorize's query. A bad client or redirect URI is shown to
 * the user (never redirected to); anything else goes back to the app as an error.
 */
export async function parseAuthRequest(q: URLSearchParams, origin: string): Promise<
  { ok: true; req: AuthRequest } | { ok: false; show: string } | { ok: false; redirect: string }
> {
  const clientId = q.get('client_id') ?? ''
  const client = clientId ? await resolveClient(clientId) : null
  if (!client) return { ok: false, show: 'This app could not be identified, so it cannot connect to your account.' }
  const redirectUri = q.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '')
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, show: 'This app asked to return somewhere it did not register, so the request was stopped.' }
  const state = q.get('state')
  const back = (error: string, description: string) => ({ ok: false as const, redirect: authRedirect(redirectUri, origin, { error, error_description: description, ...(state ? { state } : {}) }) })
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported')
  const codeChallenge = q.get('code_challenge') ?? ''
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return back('invalid_request', 'PKCE with S256 is required')
  // The token is for THIS site's MCP server (RFC 8707); a missing resource means it
  const resource = q.get('resource') || mcpResource(origin)
  if (resource.replace(/\/$/, '') !== mcpResource(origin)) return back('invalid_target', 'Unknown resource')
  return { ok: true, req: { client, redirectUri, state, codeChallenge, resource: mcpResource(origin), scope: OAUTH_SCOPE } }
}

export function authRedirect(redirectUri: string, origin: string, params: Record<string, string>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('iss', origin)
  return u.toString()
}

type OAuthMeta = {
  clientId: string; clientName: string; redirectUri: string; resource: string; scope: string
  codeHash?: string; challenge?: string; codeExp?: number
  refreshHash?: string; refreshExp?: number; accessExp?: number; connectedAt: string
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** The user approved: the connection row is made (disabled until the code is swapped) and the code returned. */
export async function issueCode(userId: number, r: AuthRequest): Promise<string> {
  const code = randomBytes(32).toString('base64url')
  const oauth: OAuthMeta = {
    clientId: r.client.clientId, clientName: friendlyClientName(r.client), redirectUri: r.redirectUri, resource: r.resource, scope: r.scope,
    codeHash: sha(code), challenge: r.codeChallenge, codeExp: Date.now() + CODE_TTL_MS, connectedAt: new Date().toISOString(),
  }
  // A placeholder key until the exchange sets the real one (never handed out)
  const placeholder = hashApiKey(`${API_KEY_PREFIX}pending-${randomBytes(16).toString('hex')}`)
  await prisma.apiKey.create({
    data: {
      userId, name: `${CONNECTOR_KEY_PREFIX}${oauth.clientName}`, keyHash: placeholder, keyPrefix: 'oauth',
      disabled: true, permissions: { scopes: CONNECTOR_KEY_SCOPES, models: { image: '*', video: '*' }, oauth } as object,
    },
  })
  // Approvals that were never exchanged go after a while
  await prisma.$executeRaw`DELETE FROM "ApiKey" WHERE "userId" = ${userId} AND disabled = true AND permissions->'oauth' IS NOT NULL AND "createdAt" < now() - interval '1 hour'`.catch(() => {})
  return code
}

type TokenOut = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
type TokenErr = { error: string; error_description: string }

function tokens(): { access: ReturnType<typeof generateApiKey>; refresh: string } {
  return { access: generateApiKey(), refresh: `pp_rt_${randomBytes(32).toString('base64url')}` }
}

/** grant_type=authorization_code */
export async function exchangeCode(p: { code: string; verifier: string; clientId: string; redirectUri: string | null; resource: string | null }, origin: string): Promise<TokenOut | TokenErr> {
  const bad = (d: string): TokenErr => ({ error: 'invalid_grant', error_description: d })
  if (!p.code || !p.verifier) return { error: 'invalid_request', error_description: 'code and code_verifier are required' }
  const rows = await prisma.$queryRaw<{ id: string; userId: number; permissions: any }[]>`
    SELECT id, "userId", permissions FROM "ApiKey" WHERE disabled = true AND permissions->'oauth'->>'codeHash' = ${sha(p.code)} LIMIT 1`
  const row = rows[0]
  const o = row?.permissions?.oauth as OAuthMeta | undefined
  if (!row || !o) return bad('Unknown or used code')
  if ((o.codeExp ?? 0) < Date.now()) return bad('The code has expired')
  if (o.clientId !== p.clientId) return bad('The code was issued to another client')
  if (p.redirectUri && p.redirectUri !== o.redirectUri) return bad('redirect_uri does not match')
  if (p.resource && p.resource.replace(/\/$/, '') !== mcpResource(origin)) return { error: 'invalid_target', error_description: 'Unknown resource' }
  const challenge = createHash('sha256').update(p.verifier).digest('base64url')
  if (!o.challenge || !sameText(challenge, o.challenge)) return bad('PKCE verification failed')
  const t = tokens()
  const next: OAuthMeta = { ...o, codeHash: undefined, challenge: undefined, codeExp: undefined, refreshHash: sha(t.refresh), refreshExp: Date.now() + REFRESH_TTL_MS, accessExp: Date.now() + ACCESS_TTL_S * 1000 }
  // Once: only the request that flips it from disabled gets the tokens
  const done = await prisma.$executeRaw`
    UPDATE "ApiKey" SET disabled = false, "keyHash" = ${t.access.keyHash}, "keyPrefix" = ${t.access.keyPrefix},
      permissions = jsonb_set(permissions::jsonb, '{oauth}', ${JSON.stringify(next)}::jsonb), "updatedAt" = now()
    WHERE id = ${row.id} AND disabled = true`
  if (!done) return bad('Unknown or used code')
  // One live connection per app per account: an older one from the same app goes
  await prisma.$executeRaw`DELETE FROM "ApiKey" WHERE "userId" = ${row.userId} AND id <> ${row.id} AND disabled = false AND permissions->'oauth'->>'clientId' = ${o.clientId}`.catch(() => {})
  return { access_token: t.access.key, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope: o.scope }
}

/** grant_type=refresh_token - both tokens are rotated. */
export async function refreshTokens(p: { refreshToken: string; clientId: string }): Promise<TokenOut | TokenErr> {
  const bad = (d: string): TokenErr => ({ error: 'invalid_grant', error_description: d })
  if (!p.refreshToken.startsWith('pp_rt_')) return bad('Unknown refresh token')
  const h = sha(p.refreshToken)
  const rows = await prisma.$queryRaw<{ id: string; permissions: any }[]>`
    SELECT id, permissions FROM "ApiKey" WHERE disabled = false AND permissions->'oauth'->>'refreshHash' = ${h} LIMIT 1`
  const row = rows[0]
  const o = row?.permissions?.oauth as OAuthMeta | undefined
  if (!row || !o) return bad('Unknown refresh token')
  if (o.clientId !== p.clientId) return bad('The token was issued to another client')
  if ((o.refreshExp ?? 0) < Date.now()) return bad('The refresh token has expired - connect again')
  const t = tokens()
  const next: OAuthMeta = { ...o, refreshHash: sha(t.refresh), refreshExp: Date.now() + REFRESH_TTL_MS, accessExp: Date.now() + ACCESS_TTL_S * 1000 }
  const done = await prisma.$executeRaw`
    UPDATE "ApiKey" SET "keyHash" = ${t.access.keyHash}, "keyPrefix" = ${t.access.keyPrefix},
      permissions = jsonb_set(permissions::jsonb, '{oauth}', ${JSON.stringify(next)}::jsonb), "updatedAt" = now()
    WHERE id = ${row.id} AND permissions->'oauth'->>'refreshHash' = ${h}`
  if (!done) return bad('Unknown refresh token')
  return { access_token: t.access.key, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope: o.scope }
}

/** RFC 7009: revoking either token ends the connection. */
export async function revokeToken(token: string): Promise<void> {
  if (token.startsWith('pp_rt_')) {
    await prisma.$executeRaw`DELETE FROM "ApiKey" WHERE permissions->'oauth'->>'refreshHash' = ${sha(token)}`.catch(() => {})
  } else if (token.startsWith(API_KEY_PREFIX)) {
    await prisma.$executeRaw`DELETE FROM "ApiKey" WHERE "keyHash" = ${hashApiKey(token)} AND permissions->'oauth' IS NOT NULL`.catch(() => {})
  }
}

// ── the user's connections (account settings) ───────────────────────────────

export type ConnectionRow = { id: string; app: string; connectedAt: string; lastUsedAt: string | null }
export async function listConnections(userId: number): Promise<ConnectionRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; permissions: any; lastUsedAt: Date | null; createdAt: Date }[]>`
    SELECT id, permissions, "lastUsedAt", "createdAt" FROM "ApiKey"
    WHERE "userId" = ${userId} AND disabled = false AND permissions->'oauth' IS NOT NULL ORDER BY "createdAt" DESC`
  return rows.map(r => ({ id: r.id, app: String(r.permissions?.oauth?.clientName ?? 'An app'), connectedAt: r.permissions?.oauth?.connectedAt ?? r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }))
}
export async function disconnect(userId: number, id: string): Promise<boolean> {
  return (await prisma.$executeRaw`DELETE FROM "ApiKey" WHERE id = ${id} AND "userId" = ${userId} AND permissions->'oauth' IS NOT NULL`) > 0
}

/**
 * The consent form's anti-forgery token: bound to the user's session and to
 * this exact request, so another site cannot post an approval for them (a DCR
 * client may register any redirect URI, so approvals must come from our page).
 */
export function consentToken(session: string, r: AuthRequest): string {
  return sign(`consent|${sha(session)}|${r.client.clientId}|${r.redirectUri}|${r.codeChallenge}`)
}
export const consentTokenOk = (session: string, r: AuthRequest, token: string) => !!token && sameText(consentToken(session, r), token)
