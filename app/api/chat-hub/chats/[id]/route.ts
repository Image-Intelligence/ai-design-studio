import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { sanitizeSkillIds } from '@/lib/chat-hub-skills'

// GET /api/chat-hub/chats/[id] — chat + full message history
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const chatId = parseInt((await params).id)
    if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: user.id },
      select: { id: true, projectId: true, title: true, model: true, systemPrompt: true, agentMode: true, skills: true, updatedAt: true },
    })
    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const messages = await prisma.chatMessage.findMany({
      where: { chatId },
      orderBy: { id: 'asc' },
      select: { id: true, role: true, content: true, model: true, imageUrls: true, metadata: true, createdAt: true },
    })
    return NextResponse.json({ chat, messages }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('chat-hub chat GET error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH /api/chat-hub/chats/[id] — rename { title } and/or set { systemPrompt }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const chatId = parseInt((await params).id)
    if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const data: { title?: string; systemPrompt?: string | null; projectId?: number | null } = {}

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title || title.length > 80) {
        return NextResponse.json({ error: 'Title must be 1-80 characters' }, { status: 400 })
      }
      data.title = title
    }
    if (body.systemPrompt !== undefined) {
      const sp = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : ''
      if (sp.length > 4000) {
        return NextResponse.json({ error: 'Instructions must be under 4000 characters' }, { status: 400 })
      }
      data.systemPrompt = sp || null
    }
    if (body.agentMode !== undefined) {
      if (!['plan', 'accept', 'approved'].includes(body.agentMode)) {
        return NextResponse.json({ error: 'Invalid agent mode' }, { status: 400 })
      }
      ;(data as Record<string, unknown>).agentMode = body.agentMode
    }
    if (body.skills !== undefined) {
      // Array of known skill ids, or null to reset to all (legacy behavior)
      if (body.skills === null) {
        ;(data as Record<string, unknown>).skills = Prisma.DbNull
      } else {
        const ids = sanitizeSkillIds(body.skills)
        if (ids === null) return NextResponse.json({ error: 'skills must be an array of skill ids or null' }, { status: 400 })
        ;(data as Record<string, unknown>).skills = ids
      }
    }
    if (body.projectId !== undefined) {
      // Move the chat into a project (number) or out to standalone (null)
      if (body.projectId === null) {
        data.projectId = null
      } else if (typeof body.projectId === 'number') {
        const project = await prisma.chatProject.findFirst({
          where: { id: body.projectId, userId: user.id },
          select: { id: true },
        })
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        data.projectId = body.projectId
      } else {
        return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
      }
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const result = await prisma.chat.updateMany({
      where: { id: chatId, userId: user.id },
      data,
    })
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('chat-hub chat PATCH error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/chat-hub/chats/[id] — delete chat (cascades messages)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const chatId = parseInt((await params).id)
    if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const result = await prisma.chat.deleteMany({
      where: { id: chatId, userId: user.id },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('chat-hub chat DELETE error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
