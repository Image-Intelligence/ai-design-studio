import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt((await params).id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const data: { content?: string; category?: string | null } = {}
  if (typeof body.content === 'string') {
    const content = body.content.trim().slice(0, 500)
    if (!content) return NextResponse.json({ error: 'Memory content cannot be empty' }, { status: 400 })
    data.content = content
  }
  if (body.category !== undefined) {
    data.category = typeof body.category === 'string' ? body.category.trim().slice(0, 30) || null : null
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.chatMemory.updateMany({
    where: { id, userId: user.id },
    data,
  })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt((await params).id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const deleted = await prisma.chatMemory.deleteMany({ where: { id, userId: user.id } })
  if (deleted.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
