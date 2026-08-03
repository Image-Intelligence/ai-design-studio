import { NextResponse } from 'next/server'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { loadInstagramCreds, igMe } from '@/lib/chat-hub-instagram'

// "Test connection" — verifies the stored token against graph.instagram.com/me
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await loadInstagramCreds(user.id)
  if (!creds) return NextResponse.json({ ok: false, error: 'Instagram is not connected' })
  const me = await igMe(creds)
  if ('error' in me) return NextResponse.json({ ok: false, error: me.error })
  return NextResponse.json({ ok: true, username: me.username, userId: me.userId })
}
