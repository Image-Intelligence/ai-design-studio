import { createHmac, timingSafeEqual } from 'crypto'
import type { WmaModelId } from '@/lib/realtime-wma'

/**
 * Signed cookies that let /api/realtime/wma enforce a live session's bill
 * without a table (2026-10-16). Two of them, both HttpOnly:
 *
 *   wma_sess   set when fal answers a session start: who, which model, fal's
 *              session id and when it started
 *   wma_paid   set by /api/realtime/wma/meter each time a 30-second block is
 *              paid: who, which model, paid until when
 *
 * The proxy forwards a session's heartbeat only while the session is inside
 * its warm-up allowance or its paid time - otherwise it answers 402, the
 * client library gives up after three refused beats, and fal ends a session
 * whose heartbeats stop. A page that never pays can't keep a session going.
 *
 * Signed with MEDIA_SIGNING_SECRET under its own prefix, so a media link's
 * signature can never pass as one of these.
 */

const SECRET = process.env.MEDIA_SIGNING_SECRET || ''

export const WMA_SESS_COOKIE = 'wma_sess'
export const WMA_PAID_COOKIE = 'wma_paid'
/** A new session may run this long before its first block is paid (its first frame pays it). */
export const WMA_WARMUP_GRACE_MS = 90_000
/** Paid time is honoured this much longer, to cover a meter call in flight. */
export const WMA_PAID_GRACE_MS = 10_000

export interface WmaSessPass { u: number; m: WmaModelId; sid: string; start: number }
/** wma_sess holds the account's last few sessions (newest first): the proxy checks a
 *  heartbeat against them, and /api/realtime/wma/upgrade proves a session is yours. */
export interface WmaSessList { u: number; s: { m: WmaModelId; sid: string; start: number }[] }
export const WMA_SESS_KEEP = 6

/** This account's session `sid`, if the signed list has it. */
export function findSession(list: WmaSessList | null, userId: number, sid: unknown): WmaSessPass | null {
  if (!list || list.u !== userId || !Array.isArray(list.s) || typeof sid !== 'string') return null
  const hit = list.s.find(x => x.sid === sid)
  return hit ? { u: list.u, ...hit } : null
}
export interface WmaPaidPass { u: number; m: WmaModelId; until: number }

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(`wma-pass\n${body}`).digest('base64url')
}

export function encodePass(p: WmaSessList | WmaPaidPass): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function decodePass<T>(v: string | undefined | null): T | null {
  if (!v || !SECRET) return null
  const [body, sig] = v.split('.')
  if (!body || !sig) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T } catch { return null }
}

/** Cookie options: same-site, script-proof, an hour at most. */
export const PASS_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, path: '/api/realtime/wma', maxAge: 3600, secure: process.env.NODE_ENV === 'production' }
