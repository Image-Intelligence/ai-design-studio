// Bearer authentication for personal API keys ("pp_live_..."), server-only.
// Keys are stored as SHA-256 hashes — lookup is a single unique-index hit.

import { createHash, randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { permissionsFromJson, type ApiKeyPermissions } from '@/lib/api-key-permissions'

export const API_KEY_PREFIX = 'pp_live_'

export type ApiKeyAuth = {
  user: NonNullable<Awaited<ReturnType<typeof getUserFromSession>>>
  keyId: string
  keyName: string
  permissions: ApiKeyPermissions
}

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = API_KEY_PREFIX + randomBytes(20).toString('hex')
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 12) }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * null    → no `Authorization: Bearer pp_...` header (caller falls back to cookie)
 * 'invalid' → header present but the key is unknown/disabled → caller returns 401
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth | 'invalid' | null> {
  const header = request.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(\S+)$/i)
  if (!m || !m[1].startsWith(API_KEY_PREFIX)) return null

  const keyHash = hashApiKey(m[1])
  const row = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: { include: { tickets: true } } },
  })
  if (!row || row.disabled) return 'invalid'
  // A connector's key (lib/mcp/oauth) is an OAuth access token: it expires, and its app refreshes it
  const oauth = (row.permissions as { oauth?: { accessExp?: number } } | null)?.oauth
  if (oauth && (Number(oauth.accessExp) || 0) < Date.now()) return 'invalid'

  // Throttled fire-and-forget lastUsedAt (at most one write per minute per key)
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return {
    user: row.user,
    keyId: row.id,
    keyName: row.name,
    permissions: permissionsFromJson(row.permissions),
  }
}

export function hasScope(auth: ApiKeyAuth, scope: string): boolean {
  return auth.permissions.scopes.includes(scope)
}

export function canUseModel(auth: ApiKeyAuth, kind: 'image' | 'video', modelId: string): boolean {
  const list = auth.permissions.models[kind]
  return list === '*' || (Array.isArray(list) && list.includes(modelId))
}

export function invalidKeyResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid or revoked API key', code: 'INVALID_API_KEY' }, { status: 401 })
}

/** Returns a 403 response if any scope is missing, else null. */
export function requireScopes(auth: ApiKeyAuth, ...scopes: string[]): NextResponse | null {
  for (const s of scopes) {
    if (!hasScope(auth, s)) {
      return NextResponse.json({ error: `Missing scope: ${s}`, code: 'MISSING_SCOPE' }, { status: 403 })
    }
  }
  return null
}

export function modelNotPermittedResponse(modelId: string): NextResponse {
  return NextResponse.json(
    { error: `Model not permitted for this API key: ${modelId}`, code: 'MODEL_NOT_PERMITTED' },
    { status: 403 },
  )
}

/**
 * Who is calling an image route that the portal reaches with its session
 * (the per-model submit routes under /api/admin: SeeDream 5 Lite / Pro,
 * Recraft, Kling V3 / O3 Image, Wan 2.7 Pro, GPT Image 2). Since 2026-10-20
 * they also take a personal API key - the one Nova's background runs, Prism
 * and the ChatGPT / Claude connector send - when it may generate images and
 * spend tickets; before, those models failed for every agent ("not
 * available"). null = no session and no usable key (the route answers 401).
 */
export async function generationCaller(request: Request, kind: 'image' | 'video' = 'image'): Promise<ApiKeyAuth['user'] | null> {
  const apiAuth = await authenticateApiKey(request)
  if (apiAuth === 'invalid') return null
  if (apiAuth) return hasScope(apiAuth, `generate:${kind}`) && hasScope(apiAuth, 'tickets:spend') ? apiAuth.user : null
  const token = (await cookies()).get('session')?.value
  return token ? await getUserFromSession(token) : null
}

export type ResolvedRequestUser =
  | { user: NonNullable<Awaited<ReturnType<typeof getUserFromSession>>>; apiAuth: ApiKeyAuth | null }
  | { error: NextResponse }

/**
 * Dual auth: bearer API key first, session cookie fallback.
 * Cookie behavior is identical to the previous inline blocks in each route.
 */
export async function resolveRequestUser(request: Request): Promise<ResolvedRequestUser> {
  const apiAuth = await authenticateApiKey(request)
  if (apiAuth === 'invalid') return { error: invalidKeyResponse() }
  if (apiAuth) return { user: apiAuth.user, apiAuth }

  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  const user = await getUserFromSession(token)
  if (!user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) }
  }
  return { user, apiAuth: null }
}
