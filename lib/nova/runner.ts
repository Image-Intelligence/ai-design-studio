/**
 * Nova Studio - the background runner (server only, 2026-10-19).
 *
 * A production waits at two points: renders still cooking (wait_for_renders)
 * and a turn that ran out of steps mid-plan (keepGoing). With the tab open,
 * the studio carries on by itself. With background runs on (lib/nova/
 * background - the user's own API key), the cron does it too, so a closed tab
 * no longer stalls a production:
 *   cron (every minute) -> novaSweep: settle the renders of waiting chats ->
 *   a chat that is ready -> POST /api/nova/runner (its own function, its own
 *   300s) -> runBackgroundTurn: one continue turn, signed with the key.
 * The `continued` claim on the message is atomic (lib/nova/agent), so an open
 * tab and the cron can never both carry on the same production.
 */
import prisma from '@/lib/prisma'
import { readChatState } from '@/lib/nova/agent-tools'
import { settleQueueJob, fileGeneration } from '@/lib/nova/jobs'
import { backgroundHeaders } from '@/lib/nova/background'
import type { NovaStep } from '@/lib/nova/config'

/** Settle every pending step of a chat's recent replies; say whether the last one is ready to carry on. */
export async function settleChatJobs(user: { id: number; email: string }, chatId: number, headers?: Record<string, string>): Promise<{ updates: { messageId: number; step: NovaStep }[]; pending: number; readyToContinue: boolean }> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId: user.id, source: { in: ['nova', 'prism'] } }, select: { skills: true } })
  const folderId = readChatState(chat?.skills).folderId
  const rows = await prisma.chatMessage.findMany({ where: { chatId, role: 'assistant' }, orderBy: { id: 'desc' }, take: 8, select: { id: true, metadata: true } })
  const updates: { messageId: number; step: NovaStep }[] = []
  let pending = 0
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, any>
    const steps = (Array.isArray(meta.steps) ? meta.steps : []) as NovaStep[]
    let changed = false
    for (const step of steps) {
      if (step.status !== 'pending' || !step.queueId) continue
      const r = await settleQueueJob(user, step.queueId, headers)
      if (r.status === 'pending') { pending++; continue }
      if (r.status === 'done') {
        Object.assign(step, { status: 'done', mediaUrl: r.url, ...(r.posterUrl ? { posterUrl: r.posterUrl } : {}), ...(r.generationId ? { generationId: r.generationId } : {}) })
        await fileGeneration(user.id, r.generationId, folderId)
      } else {
        // The site's settler already refunded a failed render
        Object.assign(step, { status: 'error', error: r.error, tickets: 0 })
      }
      changed = true
      updates.push({ messageId: row.id, step })
    }
    // Only `steps` is written (a jsonb merge), so a `continued` claim made meanwhile is never overwritten
    if (changed) {
      await prisma.$executeRaw`UPDATE "ChatMessage" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || jsonb_build_object('steps', ${JSON.stringify(steps)}::jsonb), "imageUrls" = ${steps.map(s => s.mediaUrl).filter((u): u is string => !!u)} WHERE id = ${row.id}`
    }
  }
  const last = rows[0]?.metadata as Record<string, any> | undefined
  const lastSteps = (Array.isArray(last?.steps) ? last!.steps : []) as NovaStep[]
  const readyToContinue = !!(last?.continueAfterRenders || last?.keepGoing) && !last?.continued && !lastSteps.some(s => s.status === 'pending')
  return { updates, pending, readyToContinue }
}

/**
 * The cron's pass: chats whose last reply is waiting, from users with
 * background runs on. Renders are settled here; a chat that is ready is handed
 * to the runner route (each turn gets its own function and time limit).
 */
export async function novaSweep(baseUrl: string): Promise<{ checked: number; started: number }> {
  const rows = await prisma.$queryRaw<{ id: number; chatId: number; userId: number; metadata: any }[]>`
    SELECT DISTINCT ON (m."chatId") m.id, m."chatId", c."userId", m.metadata
    FROM "ChatMessage" m JOIN "Chat" c ON c.id = m."chatId"
    WHERE c.source IN ('nova', 'prism') AND m.role = 'assistant' AND m."createdAt" > now() - interval '24 hours'
    ORDER BY m."chatId", m.id DESC`
  const waiting = rows.filter(r => (r.metadata?.continueAfterRenders || r.metadata?.keepGoing) && !r.metadata?.continued && !r.metadata?.running).slice(0, 20)
  let started = 0
  for (const w of waiting) {
    const headers = await backgroundHeaders(w.userId)
    if (!headers) continue // background runs off (or the key was revoked): the chat waits for the user
    const user = await prisma.user.findUnique({ where: { id: w.userId }, select: { id: true, email: true } })
    if (!user?.email) continue
    const s = await settleChatJobs({ id: user.id, email: user.email }, w.chatId, headers)
    if (!s.readyToContinue) continue
    try {
      // Hand off; the runner route answers at once and works in after()
      await fetch(`${baseUrl}/api/nova/runner`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        body: JSON.stringify({ chatId: w.chatId }),
        signal: AbortSignal.timeout(15_000),
      })
      started++
    } catch (e) { console.error('[nova sweep] runner hand-off', w.chatId, String((e as Error)?.message).slice(0, 120)) }
  }
  return { checked: waiting.length, started }
}

/** One carry-on turn for a chat, with nobody watching: run it and read its stream to the end. */
export async function runBackgroundTurn(chatId: number): Promise<string> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, source: { in: ['nova', 'prism'] } }, select: { id: true, userId: true } })
  if (!chat) return 'no chat'
  const user = await prisma.user.findUnique({ where: { id: chat.userId }, select: { id: true, email: true } })
  if (!user?.email) return 'no user'
  const headers = await backgroundHeaders(user.id)
  if (!headers) return 'background runs are off'
  const { checkIsAdmin } = await import('@/lib/admin-check')
  const { runNovaTurn } = await import('@/lib/nova/agent')
  const out = await runNovaTurn({
    user: { id: user.id, email: user.email }, isAdmin: await checkIsAdmin(user.email), sources: ['nova', 'prism'], chatId: chat.id,
    text: '', attachmentIds: [], attachmentUrls: [], continueRenders: true, background: { headers },
  })
  if ('json' in out) return `not started: ${String(out.json.error ?? out.status)}`
  const reader = out.stream.getReader()
  for (;;) { const { done } = await reader.read(); if (done) break }
  return 'done'
}
