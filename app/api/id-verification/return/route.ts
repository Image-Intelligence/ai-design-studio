import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { applyDiditDecision, fetchDiditDecision } from '@/lib/id-verification'

/**
 * GET /api/id-verification/return?verificationSessionId=&status=
 *
 * Where Didit sends the person when they finish. The query string is NOT
 * trusted: the decision is fetched from Didit server-side and must belong to
 * the signed-in account (vendor_data = its id). This path works on its own -
 * Didit's webhook can't reach localhost - and the webhook is the backup for
 * later changes (In Review -> Approved, a reviewer's Declined).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const done = (s: string) => NextResponse.redirect(new URL(`/id-verification/done?s=${encodeURIComponent(s)}`, url.origin))
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return done('signin')
  const sessionId = url.searchParams.get('verificationSessionId') ?? ''
  const decision = sessionId ? await fetchDiditDecision(sessionId).catch(() => null) : null
  if (!decision) return done('pending')
  if (String(decision.vendor_data ?? '') !== String(user.id)) return done('mismatch')
  const status = String(decision.status ?? url.searchParams.get('status') ?? 'In Progress')
  const r = await applyDiditDecision(user.id, sessionId, status, decision).catch(() => ({ verified: false, status }))
  return done(r.verified ? 'approved' : r.status === 'In Review' ? 'review' : r.status.startsWith('Declined') ? 'declined' : 'pending')
}
