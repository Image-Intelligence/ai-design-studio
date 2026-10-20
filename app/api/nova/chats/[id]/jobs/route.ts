import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireNovaUser } from '@/lib/nova/auth'
import { settleChatJobs } from '@/lib/nova/runner'

/**
 * GET /api/nova/chats/[id]/jobs - finish this chat's background renders.
 *
 * The studio polls this while any step is 'pending'; the cron does the same
 * for chats with background runs on (lib/nova/runner settleChatJobs - one
 * implementation for both). Returns the changed steps, how many are still
 * rendering, and whether the last reply is ready to carry on.
 */
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const chatId = Number((await ctx.params).id)
  const chat = Number.isInteger(chatId) ? await prisma.chat.findFirst({ where: { id: chatId, userId: a.user.id, source: 'nova' }, select: { id: true } }) : null
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  return jsonPrivate(await settleChatJobs(a.user, chat.id))
}
