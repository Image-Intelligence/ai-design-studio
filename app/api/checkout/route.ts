// POST /api/checkout
// Payment system is temporarily unavailable while migrating away from
// LemonSqueezy. This stub returns 503 so the frontend can show an appropriate
// message. Re-implement with the new payment processor (CCBill / PaymentCloud).

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Payment system is currently unavailable. Check back soon.' },
    { status: 503 }
  )
}
