import { jsonPrivate } from '@/lib/api-json'
import { requireAgentUser } from '@/lib/nova/auth'
import { loadNovaBudget, saveNovaBudget, novaBalance } from '@/lib/nova/ledger'
import { sanitizeNovaBudget } from '@/lib/nova/config'
import { addNovaNote, loadNovaMemory, removeNovaNote, updateNovaNote } from '@/lib/nova/memory'
import { enforceContentFilter } from '@/lib/content-filter'
import { backgroundStatus, enableBackground, disableBackground } from '@/lib/nova/background'

/**
 * GET /api/nova/settings - the user's Nova limits, what Nova spent today and
 * this month, and their balance (null = admin, free).
 * PUT /api/nova/settings { budget?, background? } - save the limits (0 = no limit);
 *   background true/false turns background runs on/off (lib/nova/background:
 *   a revocable API key of the user's own, kept encrypted).
 * PUT { note } adds a note to what Nova remembers; PUT { editNote: { id, text } }
 *   rewrites one (2026-10-21, owner: the "What Nova remembers" panel had nowhere
 *   to make entries). Notes go into every chat's instructions, so they pass the
 *   same content filter as a chat message.
 * DELETE /api/nova/settings?note=<id> - forget one of the notes Nova remembers.
 * Every answer also carries `memory`: what Nova remembers about this user (lib/nova/memory).
 */
export const runtime = 'nodejs'

async function out(userId: number, isAdmin: boolean) {
  const [{ budget, spend }, u, memory, background] = await Promise.all([loadNovaBudget(userId), isAdmin ? Promise.resolve(null) : novaBalance(userId), loadNovaMemory(userId), backgroundStatus(userId)])
  return { budget, spend, balance: u, memory, background }
}

export async function GET() {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}

export async function PUT(req: Request) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const body = await req.json().catch(() => ({})) as { budget?: unknown; background?: unknown; note?: unknown; editNote?: { id?: unknown; text?: unknown } }
  if (body.budget !== undefined) await saveNovaBudget(a.user.id, sanitizeNovaBudget(body.budget))
  const noteText = typeof body.note === 'string' ? body.note : typeof body.editNote?.text === 'string' ? body.editNote.text : ''
  if (noteText.trim()) {
    const cf = await enforceContentFilter(noteText, a.user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
    if (typeof body.note === 'string') await addNovaNote(a.user.id, body.note)
    else if (typeof body.editNote?.id === 'string') await updateNovaNote(a.user.id, body.editNote.id, noteText)
  }
  if (body.background === true) {
    try { await enableBackground(a.user.id) } catch (e: any) { return jsonPrivate({ error: String(e?.message || e) }, { status: 500 }) }
  } else if (body.background === false) await disableBackground(a.user.id)
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}

export async function DELETE(req: Request) {
  const a = await requireAgentUser()
  if (!a.ok) return a.res
  const id = new URL(req.url).searchParams.get('note')
  if (id) await removeNovaNote(a.user.id, id)
  return jsonPrivate(await out(a.user.id, a.isAdmin))
}
