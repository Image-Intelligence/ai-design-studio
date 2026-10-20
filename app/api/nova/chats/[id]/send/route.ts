import { jsonPrivate } from '@/lib/api-json'
import { requireNovaUser } from '@/lib/nova/auth'
import { runNovaTurn } from '@/lib/nova/agent'
import { enforceContentFilter } from '@/lib/content-filter'
import { canonicalisePayload } from '@/lib/media-url'
import { cleanRunBudget } from '@/lib/nova/config'

/**
 * POST /api/nova/chats/[id]/send - one turn with Nova, streamed as NDJSON
 * (lib/nova/config NovaStreamEvent).
 *
 * Body: { text, attachmentIds?, assetIds?, attachmentUrls?, model?, approvePlan?, declinePlan?, continue?, runBudget? }
 * Errors before the stream starts (402 not enough tickets / a limit reached,
 * 400, 404) come back as plain JSON. The user's message goes through the same
 * content filter as every generation prompt (the generation routes filter
 * each prompt Nova writes again).
 */
export const runtime = 'nodejs'
// Images are waited for inside the turn (up to ~150s each); video, audio and
// 3D are started and finished later by the jobs route
export const maxDuration = 300

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const chatId = Number((await ctx.params).id)
  if (!Number.isInteger(chatId)) return jsonPrivate({ error: 'Bad chat id' }, { status: 400 })
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>

  const text = typeof body.text === 'string' ? body.text : ''
  if (text.trim()) {
    const cf = await enforceContentFilter(text, a.user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }
  const num = (v: unknown) => Number.isInteger(Number(v)) ? Number(v) : NaN
  const out = await runNovaTurn({
    user: a.user, isAdmin: a.isAdmin, chatId, text,
    attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(num).filter((n: number) => n > 0).slice(0, 8) : [],
    assetIds: Array.isArray(body.assetIds) ? body.assetIds.map(num).filter((n: number) => n > 0).slice(0, 6) : [],
    attachmentUrls: Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 4) : [],
    model: typeof body.model === 'string' ? body.model : undefined,
    approvePlan: body.approvePlan && num(body.approvePlan.messageId) > 0 ? { messageId: num(body.approvePlan.messageId), tickets: Number(body.approvePlan.tickets) } : undefined,
    declinePlan: body.declinePlan && num(body.declinePlan.messageId) > 0 ? { messageId: num(body.declinePlan.messageId) } : undefined,
    continueRenders: body.continue === true,
    runBudget: cleanRunBudget(body.runBudget),
    signal: req.signal,
  })
  if ('json' in out) return jsonPrivate(out.json, { status: out.status })
  return new Response(out.stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Accel-Buffering': 'no' } })
}
