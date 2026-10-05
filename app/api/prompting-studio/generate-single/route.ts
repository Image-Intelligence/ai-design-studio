// app/api/prompting-studio/generate-single/route.ts
// The older pages' prompt generator (legacy scanner, canvas, classic portal).
// Same engine, allowance and model policy as /api/prompt/enhance - it used to
// run unmetered on any Gemini model the browser named, for anyone signed in.
// Request/response shapes are unchanged: { subject, baseStyle, existing,
// model, promptModel } -> { success, prompt }.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { enforceContentFilter } from '@/lib/content-filter'
import { ENHANCE_LIMITS, ENHANCE_PLAN_LABEL, enhancePlanFor, consumeEnhance, refundEnhance, runEnhance } from '@/lib/prompt-enhance'

export async function POST(req: NextRequest) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    // `subject` is the field; `celebrity` accepted as a legacy alias from old clients
    const subject: string = String(body.subject ?? body.celebrity ?? '').trim()
    const baseStyle: string = String(body.baseStyle ?? '').trim()
    const existing: string = String(body.existing ?? '').trim()
    if (!subject && !existing) {
      return NextResponse.json({ error: 'Subject or character name required' }, { status: 400 })
    }

    // Real people's names are rejected here (fictional characters pass)
    const cf = await enforceContentFilter(subject, user.email)
    if (!cf.ok) return NextResponse.json({ error: cf.reason }, { status: 400 })

    const plan = await enhancePlanFor(user)
    const limit = ENHANCE_LIMITS[plan]
    if (await consumeEnhance(user.id, limit) === null) {
      return NextResponse.json({ error: `You've used today's ${limit} prompt enhancements (${ENHANCE_PLAN_LABEL[plan]} plan).` }, { status: 429 })
    }
    try {
      const { prompt } = await runEnhance(
        { idea: [subject, baseStyle].filter(Boolean).join(' - '), existing, target: 'image', modelName: typeof body.model === 'string' ? body.model : undefined },
        plan === 'admin' && typeof body.promptModel === 'string' ? body.promptModel : null,
      )
      const outCf = await enforceContentFilter(prompt, user.email)
      if (!outCf.ok) { await refundEnhance(user.id); return NextResponse.json({ error: outCf.reason }, { status: 400 }) }
      return NextResponse.json({ success: true, prompt })
    } catch (e) {
      await refundEnhance(user.id)
      throw e
    }
  } catch (error) {
    console.error('Prompt generation error:', error)
    return NextResponse.json({ error: 'Failed to generate prompt' }, { status: 500 })
  }
}
