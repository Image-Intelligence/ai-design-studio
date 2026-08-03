import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'

// PATCH /api/chat-hub/projects/[id] — rename { name }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projectId = parseInt((await params).id)
    if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'Name must be 1-80 characters' }, { status: 400 })
    }

    const result = await prisma.chatProject.updateMany({
      where: { id: projectId, userId: user.id },
      data: { name },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('chat-hub project PATCH error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/chat-hub/projects/[id] — delete project (cascades chats + messages)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projectId = parseInt((await params).id)
    if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const result = await prisma.chatProject.deleteMany({
      where: { id: projectId, userId: user.id },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('chat-hub project DELETE error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
