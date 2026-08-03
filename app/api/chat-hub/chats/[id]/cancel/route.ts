import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { requestChatCancel } from '@/lib/chat-hub-cancel'

// POST /api/chat-hub/chats/[id]/cancel — flag the chat's in-flight run for a
// graceful wind-down: in-flight generations/edits finish, no further rounds,
// the reply persists marked "canceled".
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = parseInt((await params).id)
  if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId: user.id }, select: { id: true } })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  requestChatCancel(chatId)
  return NextResponse.json({ ok: true })
}
