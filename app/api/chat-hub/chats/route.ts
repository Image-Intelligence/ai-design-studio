import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { DEFAULT_CHAT_MODEL, getChatModelForUser } from '@/lib/chat-hub-models'
import { loadChatPrefs } from '@/lib/chat-hub-agent'
import { sanitizeSkillIds } from '@/lib/chat-hub-skills'

// POST /api/chat-hub/chats — create a chat { projectId?, model? }
// projectId null/absent = standalone chat outside any project
export async function POST(req: Request) {
  try {
    const user = await requireChatHubAdmin()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const projectId = typeof body.projectId === 'number' ? body.projectId : null

    const prefs = await loadChatPrefs(user.id)
    const model = typeof body.model === 'string' && getChatModelForUser(body.model, prefs.customModels)
      ? body.model
      : DEFAULT_CHAT_MODEL
    const systemPrompt = typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
      ? body.systemPrompt.trim().slice(0, 4000)
      : null
    const agentMode = ['plan', 'accept', 'approved'].includes(body.agentMode) ? body.agentMode : 'accept'
    const skills = sanitizeSkillIds(body.skills) // null = all skills

    // Verify project ownership before creating the chat under it
    if (projectId !== null) {
      const project = await prisma.chatProject.findFirst({
        where: { id: projectId, userId: user.id },
        select: { id: true },
      })
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const chat = await prisma.chat.create({
      data: { userId: user.id, projectId, model, systemPrompt, agentMode, ...(skills ? { skills } : {}) },
    })
    return NextResponse.json({ chat })
  } catch (error) {
    console.error('chat-hub chats POST error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
