import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { isWmaModelId, wmaBlockTickets, WMA_BLOCK_SEC, WMA_MODELS } from '@/lib/realtime-wma'
import { WMA_PAID_COOKIE, PASS_COOKIE_OPTS, encodePass, decodePass, type WmaPaidPass } from '@/lib/realtime-wma-pass'

export const dynamic = 'force-dynamic'

/**
 * POST /api/realtime/wma/meter - pays for the next 30 seconds of a live-video
 * session (lib/realtime-wma). Body: { model, resolution? }
 *
 * The page calls this when the session's first frame arrives (warming up is
 * free) and again before each block runs out. Each paid block extends the
 * signed wma_paid pass the proxy checks on every heartbeat - so a page that
 * stops paying loses its session within seconds, whatever it does.
 *
 * Returns { ok, tickets, seconds, paidUntil, balance }. Admins are not
 * charged (lib/ticket-gate) but get the pass all the same. ADMIN ONLY while
 * under test.
 */
export async function POST(req: NextRequest) {
  const jar = await cookies()
  const token = jar.get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Live video models are not available' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { model?: unknown; resolution?: unknown }
  if (!isWmaModelId(body.model)) return jsonPrivate({ error: 'Unknown live model' }, { status: 400 })
  const model = body.model
  const resolution = typeof body.resolution === 'string' ? body.resolution : undefined
  const tickets = wmaBlockTickets(model, resolution)

  const paid = await deductGenerationTickets(user.id, user.email, tickets)
  if (!paid.ok) {
    return jsonPrivate({ error: `The next ${WMA_BLOCK_SEC} seconds of ${WMA_MODELS[model].name} need ${paid.need} tickets - you have ${paid.have}`, needTickets: true }, { status: 402 })
  }

  // Paid time stacks onto what is left of this model's current pass
  const prev = decodePass<WmaPaidPass>(jar.get(WMA_PAID_COOKIE)?.value)
  const now = Date.now()
  const from = prev && prev.u === user.id && prev.m === model && prev.until > now ? prev.until : now
  const until = from + WMA_BLOCK_SEC * 1000
  // An admin's block is free (newBalance -1): the page's counter shows what was actually taken
  const res = jsonPrivate({ ok: true, tickets: paid.newBalance < 0 ? 0 : tickets, seconds: WMA_BLOCK_SEC, paidUntil: until, balance: paid.newBalance })
  res.cookies.set(WMA_PAID_COOKIE, encodePass({ u: user.id, m: model, until }), PASS_COOKIE_OPTS)
  return res
}
