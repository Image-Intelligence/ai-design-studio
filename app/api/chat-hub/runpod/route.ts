import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { encryptKey, decryptKey, keyCryptoAvailable } from '@/lib/chat-key-crypto'
import { parseRunpodConfig, normalizeRunpodBaseUrl } from '@/lib/runpod-config'

// RunPod endpoint config — a rented-GPU OpenAI-compatible server (vLLM).
// Stored encrypted as JSON {baseUrl, apiKey} in ChatProviderKey provider
// 'runpod' (same crypto as provider API keys).

// GET — connection status (base URL is not a secret; the key never leaves)
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await prisma.chatProviderKey.findUnique({
    where: { userId_provider: { userId: user.id, provider: 'runpod' } },
    select: { encrypted: true },
  }).catch(() => null)
  const cfg = row ? parseRunpodConfig(decryptKey(row.encrypted)) : null
  return NextResponse.json(
    { connected: !!cfg, baseUrl: cfg?.baseUrl ?? null, keySet: !!cfg?.apiKey, canSave: keyCryptoAvailable() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// POST — save/replace the endpoint. Body: { baseUrl, apiKey? }
export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!keyCryptoAvailable()) {
    return NextResponse.json({ error: 'Server key crypto not configured (CHAT_KEYS_SECRET / ADMIN_PASSWORD)' }, { status: 500 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }
  const baseUrl = typeof body?.baseUrl === 'string' ? normalizeRunpodBaseUrl(body.baseUrl) : null
  if (!baseUrl) return NextResponse.json({ error: 'A valid endpoint URL is required' }, { status: 400 })
  const apiKey = typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined

  const encrypted = encryptKey(JSON.stringify({ baseUrl, apiKey }))
  await prisma.chatProviderKey.upsert({
    where: { userId_provider: { userId: user.id, provider: 'runpod' } },
    update: { encrypted },
    create: { userId: user.id, provider: 'runpod', encrypted },
  })
  return NextResponse.json({ connected: true, baseUrl, keySet: !!apiKey })
}

// DELETE — unlink the endpoint (synced models stop resolving immediately)
export async function DELETE() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.chatProviderKey.deleteMany({ where: { userId: user.id, provider: 'runpod' } })
  return NextResponse.json({ connected: false })
}
