// CCBill subscription checkout.
// GET  → { configured } — the subscribe page uses this to enable the button.
// POST → { checkoutUrl } — signed FlexForm URL for the requested plan.
//
// Security: session-cookie auth; the client sends ONLY a plan id — prices,
// periods and the form digest are produced server-side in lib/ccbill.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { ccbillConfigured, getCcbillPlan, buildFlexFormUrl } from '@/lib/ccbill'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ configured: ccbillConfigured() })
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user) {
      return NextResponse.json({ error: 'Please log in to subscribe' }, { status: 401 })
    }

    if (!ccbillConfigured()) {
      return NextResponse.json(
        { error: 'Subscriptions are not available yet. Check back soon.' },
        { status: 503 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const plan = getCcbillPlan(body.planId)
    if (!plan) {
      return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
    }

    // One active subscription per account
    const now = new Date()
    const existing = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        tier: 'prompt-studio-dev',
        OR: [
          { status: 'active' },
          { status: 'cancelled', endDate: { gt: now } },
          { status: 'cancelled', lsCurrentPeriodEnd: { gt: now } },
        ],
      },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'You already have an active subscription' },
        { status: 400 }
      )
    }

    const checkoutUrl = buildFlexFormUrl({ plan, userId: user.id })
    if (!checkoutUrl) {
      return NextResponse.json(
        { error: 'Subscriptions are not available yet. Check back soon.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ checkoutUrl })
  } catch (error) {
    console.error('CCBill checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
