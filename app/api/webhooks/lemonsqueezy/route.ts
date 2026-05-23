// POST /api/webhooks/lemonsqueezy
// LemonSqueezy account is suspended — silently accept all events to prevent
// retry storms. This handler is intentionally a no-op until a new payment
// processor is configured.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({ received: true })
}
