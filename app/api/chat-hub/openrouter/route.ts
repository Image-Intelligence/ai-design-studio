import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { encryptKey, decryptKey, keyCryptoAvailable } from '@/lib/chat-key-crypto'

// OpenRouter connection — a single API key, stored encrypted in
// ChatProviderKey provider 'openrouter'. Models resolve via the OpenAI-compatible
// endpoint (see resolveChatModel). The full key never leaves the server; a
// masked hint is returned for the UI.

function mask(key: string): string {
  return key.length > 8 ? `${key.slice(0, 6)}…${key.slice(-4)}` : '••••'
}

// GET — connection status + masked key hint
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await prisma.chatProviderKey.findUnique({
    where: { userId_provider: { userId: user.id, provider: 'openrouter' } },
    select: { encrypted: true },
  }).catch(() => null)
  const plain = row ? decryptKey(row.encrypted) : null
  return NextResponse.json(
    { connected: !!plain, hint: plain ? mask(plain) : null, canSave: keyCryptoAvailable() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// POST — save/replace the OpenRouter API key. Body: { apiKey }
export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!keyCryptoAvailable()) {
    return NextResponse.json({ error: 'Server key crypto not configured (CHAT_KEYS_SECRET / ADMIN_PASSWORD)' }, { status: 500 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey || apiKey.length < 12) {
    return NextResponse.json({ error: 'A valid OpenRouter API key is required (starts with sk-or-…)' }, { status: 400 })
  }

  const encrypted = encryptKey(apiKey)
  await prisma.chatProviderKey.upsert({
    where: { userId_provider: { userId: user.id, provider: 'openrouter' } },
    update: { encrypted },
    create: { userId: user.id, provider: 'openrouter', encrypted },
  })
  return NextResponse.json({ connected: true, hint: mask(apiKey) })
}

// DELETE — unlink (models stop resolving on the next request)
export async function DELETE() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.chatProviderKey.deleteMany({ where: { userId: user.id, provider: 'openrouter' } })
  return NextResponse.json({ connected: false })
}
