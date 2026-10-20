import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireAgentUser } from '@/lib/nova/auth'
import { loadNovaBudget, novaBalance } from '@/lib/nova/ledger'
import { emptyChatState, readChatState } from '@/lib/nova/agent-tools'
import { chatSummary } from '@/lib/nova/summary'
import { DEFAULT_NOVA_MODEL } from '@/lib/nova/config'
import { resetChatContext, sweepStaleTurns } from '@/lib/nova/agent'
import { enhancePlanFor, enhanceUsedToday, ENHANCE_LIMITS } from '@/lib/prompt-enhance'

/**
 * Prism, the site guide (2026-10-20) - replaces the old AI Guide (/api/chat).
 *
 * Every account has ONE Prism chat (Chat.source 'prism', made on first open),
 * run by the same engine as Nova Studio (lib/nova/agent) and the same chat
 * routes (/api/nova/chats/[id]/..., which open 'prism' chats for any
 * signed-in user). This route is the panel's entry point:
 *
 * GET  /api/prism - the chat (made if missing), the user's budget, spend and
 *      balance (null = admin), and how many free quick questions are left
 *      today (the shared daily AI-text allowance; null = unmetered).
 * POST /api/prism { action: 'compact' | 'clear' } - take the context back to
 *      its cheapest point (lib/nova/agent resetChatContext). Refused while a
 *      turn is running.
 */
export const runtime = 'nodejs'

async function prismChat(userId: number) {
  const select = { id: true, title: true, model: true, updatedAt: true, skills: true, memorySummary: true, summaryUpToId: true } as const
  // The oldest one, should two first opens ever race
  const found = await prisma.chat.findFirst({ where: { userId, source: 'prism' }, orderBy: { id: 'asc' }, select })
  return found ?? prisma.chat.create({
    data: { userId, title: 'Prism', model: DEFAULT_NOVA_MODEL, source: 'prism', agentMode: 'approved', titleLocked: true, skills: emptyChatState() as object },
    select,
  })
}

async function context(chat: { id: number; memorySummary: string | null; summaryUpToId: number | null; skills: unknown }) {
  // How much the next reply re-reads: messages since the last compact / clear (capped by the replay window) and the summary
  const since = await prisma.chatMessage.count({ where: { chatId: chat.id, ...(chat.summaryUpToId ? { id: { gt: chat.summaryUpToId } } : {}) } })
  return { messages: since, summary: !!chat.memorySummary, marks: readChatState(chat.skills).marks ?? [] }
}

export async function GET() {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const chat = await prismChat(a.user.id)
  const [{ budget, spend }, balance, plan] = await Promise.all([
    loadNovaBudget(a.user.id),
    a.isAdmin ? Promise.resolve(null) : novaBalance(a.user.id),
    enhancePlanFor(a.user),
  ])
  const limit = ENHANCE_LIMITS[plan]
  const freeLeft = Number.isFinite(limit) ? Math.max(0, limit - await enhanceUsedToday(a.user.id)) : null
  return jsonPrivate({ chat: chatSummary(chat), isAdmin: a.isAdmin, budget, spend, balance, freeLeft, freeLimit: Number.isFinite(limit) ? limit : null, context: await context(chat) })
}

export async function POST(req: Request) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const body = await req.json().catch(() => ({})) as { action?: unknown }
  if (body.action !== 'compact' && body.action !== 'clear') return jsonPrivate({ error: 'action must be compact or clear' }, { status: 400 })
  const chat = await prismChat(a.user.id)
  if (await sweepStaleTurns(chat.id, a.user, a.isAdmin)) return jsonPrivate({ error: 'Prism is still working - wait for the reply, or press Stop.' }, { status: 409 })
  await resetChatContext(chat.id, body.action)
  const fresh = await prisma.chat.findUnique({ where: { id: chat.id }, select: { id: true, memorySummary: true, summaryUpToId: true, skills: true } })
  return jsonPrivate({ ok: true, context: await context(fresh!) })
}
