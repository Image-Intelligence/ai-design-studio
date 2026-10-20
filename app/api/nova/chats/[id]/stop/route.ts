import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireAgentUser } from '@/lib/nova/auth'

/**
 * POST /api/nova/chats/[id]/stop - stop the reply Nova is working on.
 *
 * Marks the running reply `cancel`; the turn checks it every few seconds and
 * stops (lib/nova/agent). This is what Stop does now that a turn keeps
 * running when the tab closes (background runs) - the connection is no longer
 * how a turn is stopped. Anything already made is kept.
 */
export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const chatId = Number((await ctx.params).id)
  const chat = Number.isInteger(chatId) ? await prisma.chat.findFirst({ where: { id: chatId, userId: a.user.id, source: { in: a.sources } }, select: { id: true } }) : null
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  const n = await prisma.$executeRaw`
    UPDATE "ChatMessage" SET metadata = metadata::jsonb || '{"cancel":true}'::jsonb
    WHERE "chatId" = ${chat.id} AND role = 'assistant' AND metadata->>'running' = 'true'`
  return jsonPrivate({ stopped: n })
}
