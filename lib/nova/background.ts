/**
 * Nova Studio - productions that carry on after the tab is closed (server only, 2026-10-19).
 *
 * The owner chose this design ("option A"): background runs use a REAL API key
 * of the user's own, made with the site's existing key system - not a new way
 * of signing in. Turning "Run in background" on in Nova's settings:
 *  - creates an ApiKey row on the user's account ("Nova Studio - background
 *    runs"), limited to what a production needs (spend tickets, generate
 *    images and video, read jobs) - it shows in the user's API keys, where it
 *    can be revoked like any other;
 *  - keeps the raw key encrypted (lib/chat-key-crypto, AES-256-GCM) in
 *    ChatProviderKey as provider 'nova-runner' - never sent to a browser.
 * Turning it off deletes both. A revoked (disabled) key simply stops working:
 * backgroundHeaders returns null and the chat waits for the user, as before.
 *
 * The site's generation routes already accept API keys (lib/api-key-auth), so
 * a background turn sends `Authorization: Bearer <key>` on its internal calls
 * and every route applies its normal gates and prices to the user's own
 * balance.
 */
import prisma from '@/lib/prisma'
import { generateApiKey, hashApiKey } from '@/lib/api-key-auth'
import { encryptKey, decryptKey, keyCryptoAvailable } from '@/lib/chat-key-crypto'

const PROVIDER = 'nova-runner'
export const NOVA_KEY_NAME = 'Nova Studio - background runs'
const SCOPES = ['tickets:read', 'tickets:spend', 'generate:image', 'generate:video', 'jobs:read']

export type NovaBackgroundStatus = { enabled: boolean; keyPrefix: string | null; since: string | null; available: boolean }

async function stored(userId: number): Promise<{ key: string; apiKeyId: string } | null> {
  const row = await prisma.chatProviderKey.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } }, select: { encrypted: true } })
  if (!row) return null
  const plain = decryptKey(row.encrypted)
  if (!plain) return null
  try { const j = JSON.parse(plain); return typeof j.key === 'string' && typeof j.apiKeyId === 'string' ? j : null } catch { return null }
}

export async function backgroundStatus(userId: number): Promise<NovaBackgroundStatus> {
  const s = await stored(userId)
  const row = s ? await prisma.apiKey.findFirst({ where: { id: s.apiKeyId, userId }, select: { keyPrefix: true, disabled: true, createdAt: true } }) : null
  const on = !!row && !row.disabled
  return { enabled: on, keyPrefix: on ? row!.keyPrefix : null, since: on ? row!.createdAt.toISOString() : null, available: keyCryptoAvailable() }
}

/** Turn background runs on: a scoped API key of the user's own, kept encrypted. */
export async function enableBackground(userId: number): Promise<NovaBackgroundStatus> {
  if (!keyCryptoAvailable()) throw new Error('Background runs are not configured on this server')
  const cur = await backgroundStatus(userId)
  if (cur.enabled) return cur
  await disableBackground(userId) // a revoked or broken leftover goes first
  const { key, keyHash, keyPrefix } = generateApiKey()
  const row = await prisma.apiKey.create({
    data: { userId, name: NOVA_KEY_NAME, keyHash, keyPrefix, permissions: { scopes: SCOPES, models: { image: '*', video: '*' } } },
    select: { id: true },
  })
  const encrypted = encryptKey(JSON.stringify({ key, apiKeyId: row.id }))
  await prisma.chatProviderKey.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    update: { encrypted },
    create: { userId, provider: PROVIDER, encrypted },
  })
  return backgroundStatus(userId)
}

/** Turn them off: the key is deleted (so it can never be used again) and the stored copy erased. */
export async function disableBackground(userId: number): Promise<NovaBackgroundStatus> {
  const s = await stored(userId)
  if (s) await prisma.apiKey.deleteMany({ where: { id: s.apiKeyId, userId } })
  await prisma.apiKey.deleteMany({ where: { userId, name: NOVA_KEY_NAME } })
  await prisma.chatProviderKey.deleteMany({ where: { userId, provider: PROVIDER } })
  return { enabled: false, keyPrefix: null, since: null, available: keyCryptoAvailable() }
}

/**
 * The header a background turn sends on the user's behalf - or null when
 * background runs are off, the key was revoked, or it no longer matches.
 */
export async function backgroundHeaders(userId: number): Promise<Record<string, string> | null> {
  const s = await stored(userId)
  if (!s) return null
  const row = await prisma.apiKey.findFirst({ where: { id: s.apiKeyId, userId }, select: { keyHash: true, disabled: true } })
  if (!row || row.disabled || row.keyHash !== hashApiKey(s.key)) return null
  return { authorization: `Bearer ${s.key}` }
}
