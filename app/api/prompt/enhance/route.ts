// /api/prompt/enhance - turn a short idea (or a rough prompt) into a full,
// model-ready one. Free within the daily AI allowance (lib/prompt-enhance:
// Free 5, Creator 25, Pro 75, Max 200 - shared with every AI text feature),
// then 1 ticket each. Admins unmetered.
//
// GET  -> { used, limit, plan, planLabel, isAdmin }   today's allowance
// POST { idea?, existing?, styles?, target: 'image'|'video', modelName?, promptModel? }
//      -> { prompt, used, limit }
//      promptModel (a specific Gemini model) is honoured for admins only.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { enforceContentFilter } from '@/lib/content-filter'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { ENHANCE_TICKETS } from '@/lib/ai-text-pricing'
import {
  ENHANCE_LIMITS, ENHANCE_PLAN_LABEL, enhancePlanFor, enhanceUsedToday,
  refundEnhance, runEnhance, chargeAiText,
} from '@/lib/prompt-enhance'

export const dynamic = 'force-dynamic'

async function sessionUser() {
  const token = (await cookies()).get('session')?.value
  return token ? await getUserFromSession(token) : null
}

const allowance = (plan: keyof typeof ENHANCE_LIMITS, used: number) => ({
  used,
  // JSON has no Infinity: admins come back as null = unlimited
  limit: Number.isFinite(ENHANCE_LIMITS[plan]) ? ENHANCE_LIMITS[plan] : null,
  plan,
  planLabel: ENHANCE_PLAN_LABEL[plan],
  isAdmin: plan === 'admin',
})

export async function GET() {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const plan = await enhancePlanFor(user)
  return NextResponse.json(allowance(plan, await enhanceUsedToday(user.id)))
}

export async function POST(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to enhance prompts.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const idea = String(body.idea ?? '').trim().slice(0, 1000)
  const existing = String(body.existing ?? '').trim().slice(0, 4000)
  const styles = Array.isArray(body.styles) ? body.styles.map((s: unknown) => String(s).slice(0, 40)).slice(0, 6) : []
  const target: 'image' | 'video' = body.target === 'video' ? 'video' : 'image'
  const modelName = typeof body.modelName === 'string' ? body.modelName.slice(0, 80) : undefined
  if (!idea && !existing) {
    return NextResponse.json({ error: 'Type an idea first.' }, { status: 400 })
  }

  // Same policy as every generation route: real people are refused up front
  const cf = await enforceContentFilter(`${idea}\n${existing}`, user.email)
  if (!cf.ok) return NextResponse.json({ error: cf.reason }, { status: 400 })

  const plan = await enhancePlanFor(user)
  const limit = ENHANCE_LIMITS[plan]
  // Today's free AI actions first, then 1 ticket (lib/prompt-enhance)
  const paid = await chargeAiText(user, ENHANCE_TICKETS)
  if (!paid.ok) {
    return NextResponse.json({
      error: `You've used today's ${limit} free AI actions - Enhance needs ${paid.need} ticket and you have ${paid.have}.`,
      needTickets: true,
    }, { status: 402 })
  }
  const charged = !paid.free && paid.newBalance >= 0 ? ENHANCE_TICKETS : 0
  // A failure gives back what it took: the free action, or the ticket
  const refundTickets = () => (charged ? refundGenerationTickets(user.id, user.email ?? '', charged) : paid.free ? refundEnhance(user.id) : Promise.resolve())
  const used = await enhanceUsedToday(user.id)

  try {
    const { prompt, model } = await runEnhance(
      { idea, existing, styles, target, modelName },
      plan === 'admin' && typeof body.promptModel === 'string' ? body.promptModel : null,
    )
    // The result must pass the filter too before it is handed back
    const outCf = await enforceContentFilter(prompt, user.email)
    if (!outCf.ok) {
      await refundTickets()
      return NextResponse.json({ error: outCf.reason }, { status: 400 })
    }
    console.log(`[enhance] user ${user.id} (${plan}) ${target} via ${model}`)
    return NextResponse.json({ prompt, tickets: charged, ...(charged ? { balance: paid.newBalance } : {}), ...allowance(plan, Number.isFinite(limit) ? used : 0) })
  } catch (e) {
    await refundTickets()
    console.error('[enhance] failed:', e)
    return NextResponse.json({ error: 'Enhancement failed - try again in a moment.' }, { status: 502 })
  }
}
