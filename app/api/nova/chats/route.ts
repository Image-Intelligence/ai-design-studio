import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireNovaUser } from '@/lib/nova/auth'
import { loadNovaBudget, novaBalance } from '@/lib/nova/ledger'
import { emptyChatState } from '@/lib/nova/agent-tools'
import { chatSummary } from '@/lib/nova/summary'
import { DEFAULT_NOVA_MODEL } from '@/lib/nova/config'

/**
 * GET  /api/nova/chats - the user's Nova chats, their limits, spend and balance.
 * POST /api/nova/chats { title? } - a new chat.
 *
 * Nova chats are Chat rows with source 'nova' (the admin Chat Hub lists only
 * its own); Chat.skills holds Nova's per-chat state (lib/nova/agent-tools
 * NovaChatState: folder, spend, approved plan) instead of hub skills.
 */
export const runtime = 'nodejs'

export async function GET() {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const [chats, { budget, spend }, u] = await Promise.all([
    prisma.chat.findMany({ where: { userId: a.user.id, source: 'nova' }, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, title: true, model: true, updatedAt: true, skills: true } }),
    loadNovaBudget(a.user.id),
    a.isAdmin ? Promise.resolve(null) : novaBalance(a.user.id),
  ])
  return jsonPrivate({ chats: chats.map(chatSummary), isAdmin: a.isAdmin, budget, spend, balance: u })
}

export async function POST(req: Request) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const body = await req.json().catch(() => ({})) as { title?: unknown }
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'New chat'
  const chat = await prisma.chat.create({
    data: { userId: a.user.id, title, model: DEFAULT_NOVA_MODEL, source: 'nova', agentMode: 'approved', skills: emptyChatState() as object },
    select: { id: true, title: true, model: true, updatedAt: true, skills: true },
  })
  return jsonPrivate({ chat: chatSummary(chat) })
}
