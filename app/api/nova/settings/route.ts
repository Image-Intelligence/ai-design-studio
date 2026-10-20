import { jsonPrivate } from '@/lib/api-json'
import { requireNovaUser } from '@/lib/nova/auth'
import { loadNovaBudget, saveNovaBudget, novaBalance } from '@/lib/nova/ledger'
import { sanitizeNovaBudget } from '@/lib/nova/config'
import { loadNovaMemory, removeNovaNote } from '@/lib/nova/memory'
import { backgroundStatus, enableBackground, disableBackground } from '@/lib/nova/background'

/**
 * GET /api/nova/settings - the user's Nova limits, what Nova spent today and
 * this month, and their balance (null = admin, free).
 * PUT /api/nova/settings { budget?, background? } - save the limits (0 = no limit);
 *   background true/false turns background runs on/off (lib/nova/background:
 *   a revocable API key of the user's own, kept encrypted).
 * DELETE /api/nova/settings?note=<id> - forget one of the notes Nova remembers.
 * Every answer also carries `memory`: what Nova remembers about this user (lib/nova/memory).
 */
export const runtime = 'nodejs'

async function out(userId: number, isAdmin: boolean) {
  const [{ budget, spend }, u, memory, background] = await Promise.all([loadNovaBudget(userId), isAdmin ? Promise.resolve(null) : novaBalance(userId), loadNovaMemory(userId), backgroundStatus(userId)])
  return { budget, spend, balance: u, memory, background }
}

export async function GET() {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}

export async function PUT(req: Request) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const body = await req.json().catch(() => ({})) as { budget?: unknown; background?: unknown }
  if (body.budget !== undefined) await saveNovaBudget(a.user.id, sanitizeNovaBudget(body.budget))
  if (body.background === true) {
    try { await enableBackground(a.user.id) } catch (e: any) { return jsonPrivate({ error: String(e?.message || e) }, { status: 500 }) }
  } else if (body.background === false) await disableBackground(a.user.id)
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}

export async function DELETE(req: Request) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const id = new URL(req.url).searchParams.get('note')
  if (id) await removeNovaNote(a.user.id, id)
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}
