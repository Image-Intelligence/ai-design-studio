import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { CHAT_HUB_PROVIDERS, DIRECT_KEY_ENV } from '@/lib/chat-hub-models'
import { encryptKey, decryptKey, keyCryptoAvailable } from '@/lib/chat-key-crypto'

const KEY_PROVIDERS = ['gateway', ...CHAT_HUB_PROVIDERS] as const

function mask(key: string): string {
  return key.length > 4 ? `••••${key.slice(-4)}` : '••••'
}

// GET /api/chat-hub/settings — provider credential status for this user.
// `env` flags = server env vars; `saved` = masked hints of the user's own
// stored keys. Full key values never leave the server.
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.chatProviderKey.findMany({
    where: { userId: user.id },
    select: { provider: true, encrypted: true },
  })
  const saved: Record<string, string | null> = {}
  for (const p of KEY_PROVIDERS) saved[p] = null
  for (const row of rows) {
    const plain = decryptKey(row.encrypted)
    if (plain) saved[row.provider] = mask(plain)
  }

  const direct: Record<string, boolean> = {}
  for (const provider of CHAT_HUB_PROVIDERS) {
    direct[provider] = !!process.env[DIRECT_KEY_ENV[provider]]
  }
  return NextResponse.json(
    { gateway: !!process.env.AI_GATEWAY_API_KEY, direct, saved, canSaveKeys: keyCryptoAvailable() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// POST /api/chat-hub/settings — save or remove one of the user's provider keys.
// { provider: 'gateway' | <ChatHubProvider>, key: string } — empty key removes.
export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const provider = typeof body.provider === 'string' ? body.provider : ''
  if (!(KEY_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const key = typeof body.key === 'string' ? body.key.trim() : ''

  try {
    if (!key) {
      await prisma.chatProviderKey.deleteMany({ where: { userId: user.id, provider } })
      return NextResponse.json({ ok: true, saved: null })
    }
    if (key.length < 10 || key.length > 400) {
      return NextResponse.json({ error: 'That does not look like a valid API key' }, { status: 400 })
    }
    if (!keyCryptoAvailable()) {
      return NextResponse.json({ error: 'Key storage is not configured on the server' }, { status: 500 })
    }
    const encrypted = encryptKey(key)
    await prisma.chatProviderKey.upsert({
      where: { userId_provider: { userId: user.id, provider } },
      create: { userId: user.id, provider, encrypted },
      update: { encrypted },
    })
    return NextResponse.json({ ok: true, saved: mask(key) })
  } catch (error) {
    console.error('chat-hub settings POST error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
