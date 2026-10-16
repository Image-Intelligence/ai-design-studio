import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import prisma from '@/lib/prisma'
import { isAdminEmail } from '@/lib/ticket-gate'
import { wmaModelForApp, wmaBlockTickets } from '@/lib/realtime-wma'
import {
  WMA_SESS_COOKIE, WMA_PAID_COOKIE, WMA_WARMUP_GRACE_MS, WMA_PAID_GRACE_MS, PASS_COOKIE_OPTS,
  WMA_SESS_KEEP, encodePass, decodePass, findSession, type WmaSessList, type WmaPaidPass,
} from '@/lib/realtime-wma-pass'

export const dynamic = 'force-dynamic'
// fal's bridge may hold a session start until a runner is free
export const maxDuration = 60

/**
 * POST /api/realtime/wma - the proxy for fal's live-video sessions
 * (lib/realtime-wma: the worlds and H3 Max Director, 2026-10-16).
 *
 * fal's client (the alpha build, installed as `fal-realtime-alpha`) opens a
 * WebRTC session in three calls, each sent here with the real address in
 * x-fal-target-url:
 *   wma.fal.run/ice                 connection details (TURN credentials)
 *   wma.fal.run/session             the offer -> the answer and a session id
 *   wma.fal.run/session/heartbeat   every 5 seconds while the session lives
 * The video and the control messages then go straight between the browser
 * and fal. This route is NOT a general fal proxy: those three addresses only,
 * only for the apps in lib/realtime-wma, and the key never leaves the server.
 *
 * Billing is enforced here (lib/realtime-wma-pass): a session may start only
 * with a block's worth of tickets, and its heartbeat is forwarded only while
 * the session is warming up or paid for. A refused heartbeat ends it.
 *
 * ADMIN ONLY while under test.
 */
const WMA = 'https://wma.fal.run'
const ALLOWED = new Set([`${WMA}/ice`, `${WMA}/session`, `${WMA}/session/heartbeat`])

const deny = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(req: NextRequest) {
  const jar = await cookies()
  const token = jar.get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return deny('Not signed in', 401)
  if (!(await checkIsAdmin(user.email))) return deny('Live video models are not available', 403)

  const target = (req.headers.get('x-fal-target-url') ?? '').replace(/\/+$/, '')
  if (!ALLOWED.has(target)) return deny('Only live-session calls are passed on here', 400)
  const key = process.env.FAL_KEY
  if (!key) return deny('fal is not set up', 500)

  const raw = await req.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(raw || '{}') } catch { return deny('Send JSON', 400) }

  let sessModel = null as ReturnType<typeof wmaModelForApp>
  if (target === `${WMA}/session/heartbeat`) {
    // The session must be this account's, and warming up or paid for
    const sess = findSession(decodePass<WmaSessList>(jar.get(WMA_SESS_COOKIE)?.value), user.id, body.session_id)
    if (!sess) return deny('Unknown live session', 403)
    const paid = decodePass<WmaPaidPass>(jar.get(WMA_PAID_COOKIE)?.value)
    const now = Date.now()
    const warming = now < sess.start + WMA_WARMUP_GRACE_MS
    const paidFor = !!paid && paid.u === user.id && paid.m === sess.m && now < paid.until + WMA_PAID_GRACE_MS
    if (!warming && !paidFor) return deny('The live session is not paid for', 402)
  } else {
    // /ice and /session name the app: only ours
    sessModel = wmaModelForApp(body.app_id)
    if (!sessModel) return deny('That model is not opened here', 400)
    if (target === `${WMA}/session`) {
      // Starting needs the first block's tickets (charged once the first frame arrives)
      if (!isAdminEmail(user.email)) {
        const need = wmaBlockTickets(sessModel.id)
        const t = await prisma.ticket.findUnique({ where: { userId: user.id }, select: { balance: true, reserved: true } })
        const have = Math.max(0, (t?.balance ?? 0) - Math.max(0, t?.reserved ?? 0))
        if (have < need) return deny(`Going live needs ${need} tickets - you have ${have}`, 402)
      }
    }
  }

  const r = await fetch(target, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: raw || '{}',
    signal: req.signal,
  }).catch(() => null)
  if (!r) return deny('Could not reach fal', 502)
  const text = await r.text()
  const res = new NextResponse(text, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'private, no-store' } })

  // A session that started: remember whose it is and when it began
  if (target === `${WMA}/session` && r.ok && sessModel) {
    let sid = ''
    try { sid = String(JSON.parse(text)?.session_id ?? '') } catch {}
    if (sid) {
      // Newest first, the last few kept (an earlier session's recording can still be upgraded)
      const prev = decodePass<WmaSessList>(jar.get(WMA_SESS_COOKIE)?.value)
      const kept = prev && prev.u === user.id && Array.isArray(prev.s) ? prev.s : []
      const list: WmaSessList = { u: user.id, s: [{ m: sessModel.id, sid, start: Date.now() }, ...kept.filter(x => x.sid !== sid)].slice(0, WMA_SESS_KEEP) }
      res.cookies.set(WMA_SESS_COOKIE, encodePass(list), PASS_COOKIE_OPTS)
    }
  }
  return res
}
