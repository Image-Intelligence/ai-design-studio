import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'

// GET /api/chat-hub/projects — one-call sidebar: projects with their chats
export async function GET() {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [projects, looseChats] = await Promise.all([
      prisma.chatProject.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        include: {
          chats: {
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, model: true, updatedAt: true },
          },
        },
      }),
      // Standalone chats living outside any project
      prisma.chat.findMany({
        where: { userId: user.id, projectId: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, model: true, updatedAt: true },
      }),
    ])
    return NextResponse.json({ projects, looseChats }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('chat-hub projects GET error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST /api/chat-hub/projects — create a project { name }
export async function POST(req: Request) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'Name must be 1-80 characters' }, { status: 400 })
    }

    const project = await prisma.chatProject.create({ data: { userId: user.id, name } })
    return NextResponse.json({ project })
  } catch (error) {
    console.error('chat-hub projects POST error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
