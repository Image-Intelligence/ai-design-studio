import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireAgentUser } from '@/lib/nova/auth'

/**
 * GET /api/nova/chats/[id]/head - what the open chat needs to know whether to
 * reload: its newest message id, and whether a reply is being written.
 *
 * 2026-10-20, owner: "sometimes I have to refresh the page to even see the new
 * chats in the Prism guide". Turns also start on the SERVER - the background
 * runner carries a production on after its renders - and the open panel never
 * heard of them. It now asks this (a couple of tiny reads) every few seconds
 * and when the tab comes back, and reloads the chat only when something moved.
 */
export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id)) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  const chat = await prisma.chat.findFirst({ where: { id, userId: a.user.id, source: { in: a.sources } }, select: { id: true } })
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  const last = await prisma.chatMessage.findFirst({ where: { chatId: id }, orderBy: { id: 'desc' }, select: { id: true, role: true, metadata: true } })
  const meta = (last?.metadata ?? {}) as Record<string, unknown>
  return jsonPrivate({ lastId: last?.id ?? 0, running: last?.role === 'assistant' && meta.running === true })
}
