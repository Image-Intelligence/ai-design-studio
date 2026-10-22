/**
 * Prompt enhancement - one short idea in, a full, model-ready prompt out.
 *
 * Used by /api/prompt/enhance (the Text panel and the composers' Enhance
 * buttons) and by /api/prompting-studio/generate-single (the older pages), so
 * every way in shares one daily allowance and one model policy.
 *
 * COST: a Flash-Lite rewrite is ~1k tokens, about $0.0003 - a thousand
 * enhancements cost ~30 cents. It runs on the PAID Gemini key on purpose: the
 * free API tier lets Google train on the prompts, and the shop promises users
 * their prompts are never used for training.
 *
 * CAPACITY (measured 2026-10-04): the key is on a paid usage tier - 150
 * simultaneous Flash-Lite requests all answered in 1.3s, no 429s (the free
 * tier allows ~15 a minute). Quotas are per model, and the content filter
 * runs on a different model (gemini-3.1-flash-lite-preview), so the two never
 * compete. If a model does hit a limit, the next in ENHANCE_MODEL_CHAIN takes
 * the request - each has its own quota.
 */
import prisma from '@/lib/prisma'
import { resolvePromptModel, DEFAULT_PROMPT_MODEL } from '@/lib/prompt-models'
import { geminiGenerate, geminiText } from '@/lib/gemini-generate'

// ── Daily allowance per plan ────────────────────────────────────────────────

export type EnhancePlan = 'free' | 'creator' | 'pro' | 'studio' | 'max' | 'admin'

/**
 * FREE AI text actions per UTC day (2026-10-13 - was Enhance's own cap). One
 * allowance for every Gemini text feature: Prompt Enhance, Storyboard's Draft
 * with AI and Edit with AI, asset captions. Past it each action costs its
 * tickets (lib/ai-text-pricing) - chargeAiText below. Admins are unmetered.
 * ('studio' is the retired plan, kept so an old subscription still resolves.)
 */
export const ENHANCE_LIMITS: Record<EnhancePlan, number> = {
  free: 5,
  creator: 25,
  pro: 75,
  studio: 75,
  max: 200,
  admin: Infinity,
}
export const ENHANCE_PLAN_LABEL: Record<EnhancePlan, string> = {
  free: 'Free', creator: 'Creator', pro: 'Pro', studio: 'Studio', max: 'Max', admin: 'Admin',
}

/**
 * The user's plan, from their Dev Tier subscription (same "active, or
 * cancelled but still in the paid period" rule as /api/user/subscription).
 * New CCBill subscriptions record metadata.planId; older ones (the retired
 * biweekly $20 / monthly $40, and manual grants) map to Creator / Pro.
 */
export async function enhancePlanFor(user: { id: number; email: string | null }): Promise<EnhancePlan> {
  const { checkIsAdmin } = await import('@/lib/admin-check')
  if (user.email && await checkIsAdmin(user.email)) return 'admin'
  if ((user.email ?? '').endsWith('@audit.pp')) return 'pro'
  const now = new Date()
  const sub = await prisma.subscription.findFirst({
    where: {
      userId: user.id,
      tier: 'prompt-studio-dev',
      OR: [
        { status: 'active' },
        { status: 'cancelled', OR: [{ endDate: { gt: now } }, { lsCurrentPeriodEnd: { gt: now } }] },
      ],
    },
    select: { billingCycle: true, metadata: true },
  })
  if (!sub) return 'free'
  const planId = (sub.metadata as { planId?: string } | null)?.planId
  if (planId === 'creator' || planId === 'pro' || planId === 'studio' || planId === 'max') return planId === 'studio' ? 'pro' : planId
  return sub.billingCycle === 'biweekly' ? 'creator' : 'pro'
}

// ── Metering ────────────────────────────────────────────────────────────────
// Kept on User.portalPreferences under the reserved key `_enhance`
// ({ day: 'YYYY-MM-DD', n }) - no schema change. /api/user/preferences refuses
// to write that key, so the browser cannot reset its own count.

const today = () => new Date().toISOString().slice(0, 10)

export async function enhanceUsedToday(userId: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ day: string | null; n: number | null }[]>`
    SELECT "portalPreferences"->'_enhance'->>'day' AS day,
           ("portalPreferences"->'_enhance'->>'n')::int AS n
    FROM "User" WHERE id = ${userId}`
  const r = rows[0]
  return r && r.day === today() ? r.n ?? 0 : 0
}

/**
 * Take one enhancement from today's allowance - checked and counted in ONE
 * statement, so two clicks at once cannot both squeeze under the limit.
 * Returns the new count, or null when the allowance is used up.
 */
export async function consumeEnhance(userId: number, limit: number): Promise<number | null> {
  if (!Number.isFinite(limit)) return 0
  const day = today()
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    UPDATE "User"
    SET "portalPreferences" = jsonb_set(
      COALESCE("portalPreferences"::jsonb, '{}'::jsonb), '{_enhance}',
      jsonb_build_object('day', ${day}::text, 'n',
        (CASE WHEN "portalPreferences"->'_enhance'->>'day' = ${day}
              THEN COALESCE(("portalPreferences"->'_enhance'->>'n')::int, 0) ELSE 0 END) + 1))
    WHERE id = ${userId}
      AND (COALESCE("portalPreferences"->'_enhance'->>'day', '') <> ${day}
           OR COALESCE(("portalPreferences"->'_enhance'->>'n')::int, 0) < ${limit})
    RETURNING ("portalPreferences"->'_enhance'->>'n')::int AS n`
  return rows.length ? rows[0].n : null
}

/**
 * Pay for one AI text action: from today's free allowance while it lasts
 * (counted on the same `_enhance` counter), then in tickets. Same answer shape
 * as deductGenerationTickets, plus `free`; a free action reports newBalance -1
 * so the routes neither show a charge nor refund tickets for it.
 */
export async function chargeAiText(user: { id: number; email: string | null }, tickets: number): Promise<
  { ok: true; newBalance: number; free: boolean } | { ok: false; have: number; need: number }
> {
  const plan = await enhancePlanFor(user)
  if (plan === 'admin') return { ok: true, newBalance: -1, free: true }
  if ((await consumeEnhance(user.id, ENHANCE_LIMITS[plan])) !== null) return { ok: true, newBalance: -1, free: true }
  const { deductGenerationTickets } = await import('@/lib/ticket-gate')
  const paid = await deductGenerationTickets(user.id, user.email ?? '', tickets)
  return paid.ok ? { ...paid, free: false } : paid
}

/** Give one back - the enhancement failed, so it should not count. */
export async function refundEnhance(userId: number): Promise<void> {
  const day = today()
  await prisma.$executeRaw`
    UPDATE "User"
    SET "portalPreferences" = jsonb_set("portalPreferences"::jsonb, '{_enhance,n}',
      to_jsonb(GREATEST(0, COALESCE(("portalPreferences"->'_enhance'->>'n')::int, 0) - 1)))
    WHERE id = ${userId} AND "portalPreferences"->'_enhance'->>'day' = ${day}`.catch(() => {})
}

// ── The rewrite itself ──────────────────────────────────────────────────────

/** Tried in order: a limit or outage on one model falls through to the next. */
// 2.5 Flash Lite left the chain 2026-10-18: Google now answers 404 "no longer available to new users"
export const ENHANCE_MODEL_CHAIN = [DEFAULT_PROMPT_MODEL, 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest']

/** One-tap style directions offered as chips. */
export const ENHANCE_STYLES = ['Cinematic', 'Photoreal', 'Anime', 'Illustration', 'Product shot', 'Logo', 'Fantasy', 'Moody'] as const

export type EnhanceInput = {
  /** The short idea (compose), or the user's direction for a rewrite. */
  idea?: string
  /** A prompt to improve instead of composing from scratch. */
  existing?: string
  styles?: string[]
  target: 'image' | 'video'
  /** The model the prompt is for (its display name), so it is written for it. */
  modelName?: string
}

/** What a good prompt looks like for this kind of model. */
function modelGuidance(target: 'image' | 'video', modelName = ''): string {
  const m = modelName.toLowerCase()
  if (target === 'video') {
    const base = 'Write it as a SHOT for a video model: the subject, what MOVES and how (action, pace), the camera (e.g. slow push in, orbit, tracking, handheld, static), lighting and mood. Describe one continuous moment, present tense - no lists of separate scenes.'
    if (/lip sync|avatar|heygen/.test(m) && !/heygen video/.test(m)) return 'This is for a talking-head model: write ONLY the words to be spoken, natural and conversational, no stage directions.'
    if (/music video/.test(m)) return 'This is for a music-video model: write lyrics-style lines to show as subtitles, short and singable.'
    if (/sfx|mirelo/.test(m)) return 'This is for a sound-effects model: describe only the sounds - sources, texture, distance, rhythm.'
    return base
  }
  if (/ideogram|recraft/.test(m)) return 'This model renders text well: put any words that must appear in the image in "double quotes", and describe layout and typography.'
  if (/logo|vector/.test(m)) return 'Aim for clean, flat, scalable design: bold shapes, few colours, plain background.'
  return 'Write it for an image model: subject, setting, composition and framing, lighting, colour, lens or medium, mood, and a few quality terms.'
}

function buildPrompt(input: EnhanceInput): string {
  const idea = (input.idea ?? '').trim()
  const existing = (input.existing ?? '').trim()
  const styles = (input.styles ?? []).filter(Boolean)
  const kind = input.target === 'video' ? 'video' : 'image'
  const forModel = input.modelName ? ` for ${input.modelName}` : ''
  const rules = `RULES:
1. ${modelGuidance(input.target, input.modelName)}
2. Treat any named person as a FICTIONAL character or original creation - never a real person, actor or celebrity.
3. No explicit content.
4. ${kind === 'video' ? 'Under 90 words.' : 'Under 110 words.'}
5. Respond with ONLY the prompt text - no preamble, no quotes around it, no notes.`
  if (existing) {
    return `You are an expert AI ${kind} prompt writer. Improve this ${kind} prompt${forModel}, keeping what it already establishes.

PROMPT:
${existing}
${idea || styles.length ? `\nDIRECTION:\n${[idea, styles.length ? `Style: ${styles.join(', ')}` : ''].filter(Boolean).join('\n')}\n` : '\nMake it sharper and more specific.\n'}
${rules}`
  }
  return `You are an expert AI ${kind} prompt writer. Turn this idea into ONE rich, ready-to-use ${kind} prompt${forModel}.

IDEA: ${idea}${styles.length ? `\nSTYLE: ${styles.join(', ')}` : ''}

${rules}`
}

/**
 * Run the rewrite. Admins may pick the Gemini model; everyone else gets the
 * chain. Returns the model that answered, for logging.
 */
export async function runEnhance(input: EnhanceInput, adminModel?: string | null): Promise<{ prompt: string; model: string }> {
  const chain = adminModel ? [resolvePromptModel(adminModel), ...ENHANCE_MODEL_CHAIN] : ENHANCE_MODEL_CHAIN
  const text = buildPrompt(input)
  let lastErr: unknown = null
  for (const model of [...new Set(chain)]) {
    try {
      /*
       * Thinking tokens count against maxOutputTokens: with the old cap of 400,
       * every model that thinks (all of Flash and Pro) spent ~380 of it
       * thinking and was cut off mid-sentence (measured 2026-10-18). Low
       * thinking and room to finish; the prompt itself still asks for one
       * prompt, so the answer stays short. Flash-Lite is left alone: it does
       * not think by default, and asking for "low" switches thinking ON for
       * 3.1 Flash Lite (+130 tokens, +0.5s).
       */
      const res = await geminiGenerate(model, {
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048, ...(model.includes('flash-lite') ? {} : { thinkingConfig: { thinkingLevel: 'low' } }) },
      }, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) {
        lastErr = Object.assign(new Error(`Gemini ${res.status} on ${model}`), { status: res.status })
        // A bad request will fail on every model alike - stop; a limit or an
        // outage on this one may not affect the next
        if (res.status < 500 && res.status !== 429 && res.status !== 404) break
        continue
      }
      const out = geminiText(await res.json()).trim().replace(/^["'`]+|["'`]+$/g, '').trim()
      if (out) return { prompt: out, model }
      lastErr = new Error('empty response')
    } catch (e) {
      // A timeout or network failure - try the next model
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Enhancement failed')
}
