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
 *
 * It also stops the production CARRYING ON (2026-10-20, owner: "I pressed
 * stop but the model just kept going"): between turns nothing is running, but
 * the last reply may be waiting to continue after its renders (or after
 * running out of steps) - the open studio and the background runner would
 * start the next turn. That wait is claimed (`continued`) and marked
 * `stopped`. Renders already submitted still finish and appear in the chat;
 * Nova just does not act on them until the user writes again.
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
  const waiting = await prisma.$executeRaw`
    UPDATE "ChatMessage" SET metadata = (metadata::jsonb - 'continueAfterRenders' - 'keepGoing') || '{"continued":true,"stopped":true}'::jsonb
    WHERE "chatId" = ${chat.id} AND role = 'assistant'
      AND (metadata::jsonb ? 'continueAfterRenders' OR metadata::jsonb ? 'keepGoing')
      AND COALESCE(metadata->>'continued', 'false') <> 'true'`
  return jsonPrivate({ stopped: n + waiting })
}
