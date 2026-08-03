import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { encryptKey, keyCryptoAvailable } from '@/lib/chat-key-crypto'
import { loadInstagramCreds, igMe } from '@/lib/chat-hub-instagram'

// Instagram connector credentials — encrypted JSON blob {accessToken, igUserId}
// in ChatProviderKey (provider 'instagram'). Deliberately separate from the
// LLM keys route: its key-format validation doesn't fit a JSON credential blob.

export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await loadInstagramCreds(user.id)
  if (!creds) return NextResponse.json({ connected: false })
  const me = await igMe(creds)
  if ('error' in me) return NextResponse.json({ connected: true, username: null, warning: me.error })
  return NextResponse.json({ connected: true, username: me.username })
}

export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!keyCryptoAvailable()) {
    return NextResponse.json({ error: 'Key encryption is not configured on the server (CHAT_KEYS_SECRET / ADMIN_PASSWORD)' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
  const igUserId = typeof body.igUserId === 'string' ? body.igUserId.trim() : ''
  if (!accessToken || accessToken.length > 600) {
    return NextResponse.json({ error: 'A valid access token is required (max 600 chars)' }, { status: 400 })
  }
  if (!igUserId || !/^\d{5,25}$/.test(igUserId)) {
    return NextResponse.json({ error: 'A valid numeric Instagram user ID is required' }, { status: 400 })
  }

  const encrypted = encryptKey(JSON.stringify({ accessToken, igUserId }))
  await prisma.chatProviderKey.upsert({
    where: { userId_provider: { userId: user.id, provider: 'instagram' } },
    create: { userId: user.id, provider: 'instagram', encrypted },
    update: { encrypted },
  })
  return NextResponse.json({ success: true })
}

export async function DELETE() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.chatProviderKey.deleteMany({ where: { userId: user.id, provider: 'instagram' } })
  return NextResponse.json({ success: true })
}
