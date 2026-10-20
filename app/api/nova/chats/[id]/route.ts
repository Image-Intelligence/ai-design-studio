import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireAgentUser } from '@/lib/nova/auth'
import { readChatState, cleanChatRefs } from '@/lib/nova/agent-tools'
import { resolveChatRefs, resolveBible } from '@/lib/nova/chat-refs'
import { chatSummary } from '@/lib/nova/summary'
import { toNovaMessage, sweepStaleTurns } from '@/lib/nova/agent'
import { resolveNovaModel } from '@/lib/nova/config'
import { VIDEO_URL_RE } from '@/lib/video-poster'

/**
 * GET    /api/nova/chats/[id] - the chat and its messages (newest 200).
 * PATCH  /api/nova/chats/[id] { title?, model?, refs? } - rename (the chat's folder
 *        is renamed with it) / pick the model (admins only; others keep the default) /
 *        set the chat's references { assets: assetIds, generations: generationIds }
 *        (the studio panel's switches - only the account's own are kept).
 * GET and PATCH answer with `refs`: the references resolved for showing.
 * GET also answers with `bible`: the look bible Nova set (lib/nova/agent-tools
 *   NovaBible) with thumbnails; PATCH { bible: null } clears it.
 * DELETE /api/nova/chats/[id] - the chat goes; what it made stays in My
 *        Generations and its folder.
 */
export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

async function own(userId: number, ctx: Ctx, sources: string[]) {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id)) return null
  return prisma.chat.findFirst({ where: { id, userId, source: { in: sources } }, select: { id: true, title: true, model: true, updatedAt: true, skills: true, source: true, memorySummary: true, summaryUpToId: true } })
}

export async function GET(req: Request, ctx: Ctx) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const chat = await own(a.user.id, ctx, a.sources)
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  await sweepStaleTurns(chat.id, a.user, a.isAdmin)
  // Opened: a background turn's "new" mark goes (only that key, so a turn finishing now is not overwritten)
  if (readChatState(chat.skills).unread) await prisma.$executeRaw`UPDATE "Chat" SET skills = COALESCE(skills::jsonb, '{}'::jsonb) || '{"unread":false}'::jsonb WHERE id = ${chat.id}`
  /*
   * A page of messages: the newest `take` (default 200), or with ?before=<id>
   * the ones before it - Prism's chat goes on for months, so its panel loads
   * the latest and fetches older pages as the user scrolls up.
   */
  const q = new URL(req.url).searchParams
  const take = Math.min(200, Math.max(1, Number(q.get('take')) || 200))
  const before = Number(q.get('before')) || 0
  const page = await prisma.chatMessage.findMany({
    where: { chatId: chat.id, ...(before > 0 ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: take + 1,
    select: { id: true, role: true, content: true, model: true, metadata: true, createdAt: true },
  })
  const rows = page.slice(0, take).reverse()
  const s = readChatState(chat.skills)
  const messages = rows.map(toNovaMessage)
  /*
   * Video steps saved with the clip itself as their "poster" (before
   * 2026-10-20) - or none - get the row's real thumbnail, so the chat shows a
   * still with a play button (an unplayed <video> is a blank tile on iPhones).
   */
  const noStill = messages.flatMap(m => m.steps ?? []).filter(st => (st.kind === 'video' || st.kind === 'cut') && st.generationId && (!st.posterUrl || VIDEO_URL_RE.test(st.posterUrl)))
  if (noStill.length) {
    const thumbs = await prisma.generatedImage.findMany({ where: { userId: a.user.id, id: { in: [...new Set(noStill.map(st => st.generationId!))] }, thumbnailUrl: { not: null } }, select: { id: true, thumbnailUrl: true } })
    const byId = new Map(thumbs.filter(t => t.thumbnailUrl && !VIDEO_URL_RE.test(t.thumbnailUrl)).map(t => [t.id, t.thumbnailUrl!]))
    for (const st of noStill) { const t = byId.get(st.generationId!); if (t) st.posterUrl = t }
  }
  return jsonPrivate({
    chat: { ...chatSummary(chat), plan: s.plan ? { total: s.plan.total, spent: s.plan.spent } : null },
    messages, hasMore: page.length > take, marks: s.marks ?? [],
    refs: await resolveChatRefs(a.user.id, s.refs), bible: await resolveBible(a.user.id, s.bible),
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const chat = await own(a.user.id, ctx, a.sources)
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { title?: unknown; model?: unknown; refs?: unknown; bible?: unknown }
  const data: { title?: string; titleLocked?: boolean; model?: string } = {}
  if (typeof body.title === 'string' && body.title.trim()) { data.title = body.title.trim().slice(0, 80); data.titleLocked = true }
  if (typeof body.model === 'string') data.model = resolveNovaModel(body.model, a.isAdmin)
  /*
   * References: kept to what resolves for THIS account, and written as one
   * key of the chat's state (a turn running now writes the rest of it).
   */
  let refs = undefined as Awaited<ReturnType<typeof resolveChatRefs>> | undefined
  if (body.refs !== undefined) {
    refs = await resolveChatRefs(a.user.id, cleanChatRefs(body.refs))
    const ids = JSON.stringify({ refs: { assets: refs.assets.map(x => x.id), generations: refs.generations.map(x => x.id) } })
    await prisma.$executeRaw`UPDATE "Chat" SET skills = COALESCE(skills::jsonb, '{}'::jsonb) || ${ids}::jsonb WHERE id = ${chat.id}`
  }
  // The look bible is Nova's to set; the user can clear it (one key, like refs)
  if (body.bible === null) await prisma.$executeRaw`UPDATE "Chat" SET skills = COALESCE(skills::jsonb, '{}'::jsonb) || '{"bible":null}'::jsonb WHERE id = ${chat.id}`
  const saved = Object.keys(data).length
    ? await prisma.chat.update({ where: { id: chat.id }, data, select: { id: true, title: true, model: true, updatedAt: true, skills: true } })
    : chat
  // The chat's folder follows its name
  const folderId = readChatState(chat.skills).folderId
  if (data.title && folderId) await prisma.userGenerationFolder.updateMany({ where: { id: folderId, userId: a.user.id }, data: { name: data.title } }).catch(() => {})
  return jsonPrivate({ chat: chatSummary(saved), ...(refs ? { refs } : {}) })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const chat = await own(a.user.id, ctx, a.sources)
  if (!chat) return jsonPrivate({ error: 'Chat not found' }, { status: 404 })
  // Prism's one chat is not deleted - Clear context (POST /api/prism) is its fresh start
  if (chat.source === 'prism') return jsonPrivate({ error: "Prism's chat cannot be deleted - use Clear context instead" }, { status: 400 })
  await prisma.chat.delete({ where: { id: chat.id } })
  return jsonPrivate({ ok: true })
}
