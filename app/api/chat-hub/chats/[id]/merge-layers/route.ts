import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { executeEditImage } from '@/lib/chat-hub-agent'

// POST /api/chat-hub/chats/[id]/merge-layers — { messageId, width, height, operations }
// The layer editor's MERGE: rasterizes 2+ drawing ops onto a TRANSPARENT
// canvas and returns the baked PNG as a single overlay source. The URL is
// appended to the message's imageUrls so edit-rerun accepts it afterwards.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = parseInt((await params).id)
  if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const messageId = typeof body.messageId === 'number' ? body.messageId : NaN
  const width = Math.min(4096, Math.max(64, Math.round(Number(body.width) || 0)))
  const height = Math.min(4096, Math.max(64, Math.round(Number(body.height) || 0)))
  const operations = Array.isArray(body.operations) ? body.operations : null
  if (isNaN(messageId) || !width || !height || !operations || operations.length < 2 || operations.length > 6) {
    return NextResponse.json({ error: 'messageId, width, height and 2-6 operations are required' }, { status: 400 })
  }

  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId: user.id }, select: { id: true } })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const row = await prisma.chatMessage.findFirst({ where: { id: messageId, chatId, role: 'assistant' } })
  if (!row) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  // Overlay sources: conversation images + mid-run authorized URLs
  // (dataset buckets / search_refs) persisted on recent assistant rows
  const rows = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { id: 'desc' },
    take: 60,
    select: { imageUrls: true, metadata: true },
  })
  const allowedImages = new Set<string>()
  for (const r of rows) {
    for (const u of r.imageUrls) allowedImages.add(u)
    const extra = (r.metadata as Record<string, unknown> | null)?.allowedExtra
    if (Array.isArray(extra)) for (const u of extra) if (typeof u === 'string') allowedImages.add(u)
  }

  const out = await executeEditImage(
    { canvas: { width, height, color: 'transparent' }, operations: operations as any },
    { user: { id: user.id, email: user.email }, allowedImages },
  )
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: 400 })

  // Make the baked layer a legal source for the upcoming Save (edit-rerun
  // builds its allow-list from message imageUrls)
  if (!row.imageUrls.includes(out.imageUrl)) {
    await prisma.chatMessage.update({
      where: { id: row.id },
      data: { imageUrls: [...row.imageUrls, out.imageUrl] },
    })
  }

  return NextResponse.json({ imageUrl: out.imageUrl, width: out.width, height: out.height })
}
