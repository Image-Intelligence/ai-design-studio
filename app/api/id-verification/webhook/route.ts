import { NextResponse } from 'next/server'
import { applyDiditDecision, fetchDiditDecision, verifyDiditWebhook } from '@/lib/id-verification'

/**
 * POST /api/id-verification/webhook - Didit's status.updated / data.updated.
 *
 * Signature-checked (X-Signature-V2, X-Timestamp within 5 minutes). The
 * account comes from vendor_data (our user id, set when the session was
 * created). Answers 200 quickly - Didit waits 5 seconds - and is idempotent,
 * since Didit retries and sends every destination the same event.
 */
export async function POST(req: Request) {
  const raw = await req.text()
  if (!verifyDiditWebhook(raw, req.headers)) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  let body: Record<string, any>
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (body.webhook_type !== 'status.updated' && body.webhook_type !== 'data.updated') return NextResponse.json({ ok: true, ignored: true })
  const userId = parseInt(String(body.vendor_data ?? ''), 10)
  const sessionId = String(body.session_id ?? '')
  if (!Number.isFinite(userId) || !sessionId) return NextResponse.json({ ok: true, ignored: true })
  try {
    // An approval needs the document's date of birth; fetch the decision when the body lacks it
    const decision = body.decision ?? (body.status === 'Approved' ? await fetchDiditDecision(sessionId) : null)
    await applyDiditDecision(userId, sessionId, String(body.status ?? ''), decision)
  } catch (e) {
    console.error('[id-verification] webhook apply failed:', (e as Error).message)
    // 500 so Didit retries (it does twice: ~1 and ~5 minutes later)
    return NextResponse.json({ error: 'Retry' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
