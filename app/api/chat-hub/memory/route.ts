import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'

// Account-global agent memory (ChatMemory) — the Memory panel's backend.
// GET list / POST add. Per-entry edit/delete in [id]/route.ts.

const MAX_ENTRIES = 60

export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entries = await prisma.chatMemory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true, category: true, source: true, createdAt: true },
  })
  return NextResponse.json({ entries, limit: MAX_ENTRIES })
}

export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, 500) : ''
  const category = typeof body.category === 'string' ? body.category.trim().slice(0, 30) || null : null
  if (!content) return NextResponse.json({ error: 'Memory content is required' }, { status: 400 })

  const count = await prisma.chatMemory.count({ where: { userId: user.id } })
  if (count >= MAX_ENTRIES) {
    return NextResponse.json({ error: `Memory is full (${MAX_ENTRIES} entries) — delete or consolidate entries first` }, { status: 400 })
  }

  const entry = await prisma.chatMemory.create({
    data: { userId: user.id, content, category, source: 'user' },
    select: { id: true, content: true, category: true, source: true, createdAt: true },
  })
  return NextResponse.json({ entry })
}
