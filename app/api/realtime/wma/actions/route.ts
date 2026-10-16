import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import sharp from 'sharp'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { chargeAiText } from '@/lib/prompt-enhance'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { WORLD_ACTIONS_TICKETS, geminiUsage } from '@/lib/ai-text-pricing'
import { canonicalMediaUrl, isOurMedia, signMediaUrl } from '@/lib/media-url'

/**
 * POST /api/realtime/wma/actions - Gemini writes a Lingbot World 2 world's
 * number-key actions (the Worlds studio's "Autofill with AI", 2026-10-16).
 *
 * Body: { count: 1-9, idea, world?, picture? }
 *   idea     a few words from the user ("medieval knight - fighting moves",
 *            "jump, crouch, wave")
 *   world    the world description, if one was written
 *   picture  the starting picture (our own media only) - Gemini sees it, so
 *            the actions fit what is actually in the scene
 * Returns: { actions: [{ title, description }], tickets, balance? }
 *
 * Lingbot runs each action WHILE its key is held and combines its description
 * with the world's, so each one is written as a short continuous motion of
 * the character with what it visibly does to the scene.
 *
 * Priced like Storyboard's Draft with AI (Gemini 3.7 Flash, JSON mode):
 * WORLD_ACTIONS_TICKETS, today's free AI actions first (lib/prompt-enhance),
 * refunded when the call fails. ADMIN ONLY while the Worlds studio is.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3.7-flash'

type Bill = { user: { id: number; email: string } | null; tickets: number; balance: number | null }

async function pictureData(url: string): Promise<{ mime_type: string; data: string } | null> {
  if (!isOurMedia(url)) return null
  try {
    const r = await fetch(signMediaUrl(canonicalMediaUrl(url), 600), { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const jpg = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(768, 768, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
    return { mime_type: 'image/jpeg', data: jpg.toString('base64') }
  } catch {
    return null
  }
}

async function handle(req: NextRequest, bill: Bill) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'The Worlds studio is not available' }, { status: 403 })
  if (!GEMINI_API_KEY) return jsonPrivate({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const count = Math.min(9, Math.max(1, Math.round(Number(body.count)) || 3))
  const idea = typeof body.idea === 'string' ? body.idea.trim().slice(0, 1000) : ''
  const world = typeof body.world === 'string' ? body.world.trim().slice(0, 2000) : ''
  const picture = typeof body.picture === 'string' ? await pictureData(body.picture) : null
  if (!idea && !world && !picture) return jsonPrivate({ error: 'Say what kind of actions you want' }, { status: 400 })

  const instruction = [
    'You write the number-key ACTIONS for a live, explorable AI world (Lingbot World 2). The player walks around a third-person world with WASD; holding a number key 1-9 makes the world show that action for as long as the key is held. The model combines the action\'s description with the world description, every frame.',
    world ? `THE WORLD: ${world}` : 'THE WORLD: not described - work from the picture and the idea.',
    picture ? 'The attached picture is where the world starts: fit the actions to the character and the place you see in it.' : '',
    idea ? `WHAT THE PLAYER WANTS: ${idea}` : '',
    '',
    `Write exactly ${count} action${count === 1 ? '' : 's'}.`,
    'Rules:',
    '- title: 1-3 words, a verb first ("Jump", "Draw sword", "Open door"), at most 40 characters.',
    '- description: ONE continuous action, present tense, describing the character doing it and what visibly happens around them - e.g. "The character crouches and leaps high into the air, landing softly on the path as dust puffs up." At most 2 sentences, under 300 characters.',
    '- Actions must be physically readable on camera and possible in this world; vary them (movement, interaction with the scene, a dramatic moment) unless the player asked for something specific.',
    '- If the player listed actions, use exactly those, in that order, and fill any remaining keys with fitting ones.',
    '- No violence against real people, nothing sexual, no text on screen.',
    '',
    'Reply with JSON only: {"actions": [{"title": string, "description": string}]}',
  ].filter(Boolean).join('\n')

  const paid = await chargeAiText(user, WORLD_ACTIONS_TICKETS)
  if (!paid.ok) return jsonPrivate({ error: `Autofill needs ${paid.need} ticket - you have ${paid.have}`, needTickets: true }, { status: 402 })
  if (paid.newBalance >= 0) { bill.user = { id: user.id, email: user.email }; bill.tickets = WORLD_ACTIONS_TICKETS; bill.balance = paid.newBalance }

  const call = (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(50_000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [...(picture ? [{ inline_data: picture }] : []), { text: instruction }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
    }),
  })
  try {
    let res = await call(true)
    if (res.status === 400) res = await call(false)
    if (!res.ok) return jsonPrivate({ error: `Autofill failed (${res.status})` }, { status: 502 })
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    { const u = geminiUsage(data); console.log(`[ai-usage] world-actions in=${u.in} out=${u.out} tickets=${WORLD_ACTIONS_TICKETS}`) }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    let out: any
    try { out = JSON.parse(text) } catch { return jsonPrivate({ error: 'The model did not return readable actions - try again' }, { status: 502 }) }
    const actions = (Array.isArray(out?.actions) ? out.actions : [])
      .map((a: any) => ({ title: String(a?.title ?? '').trim().slice(0, 40), description: String(a?.description ?? '').trim().slice(0, 1000) }))
      .filter((a: { title: string; description: string }) => a.title && a.description)
      .slice(0, count)
    if (!actions.length) return jsonPrivate({ error: 'No actions came back - try a different idea' }, { status: 422 })
    return jsonPrivate({ actions, tickets: bill.tickets, ...(bill.balance !== null && bill.balance >= 0 ? { balance: bill.balance } : {}) })
  } catch (err: any) {
    const msg = String(err?.message || err)
    return jsonPrivate({ error: /timeout|aborted/i.test(msg) ? 'Autofill timed out - Gemini is slow right now, try again' : `Autofill failed: ${msg.slice(0, 200)}` }, { status: 502 })
  }
}

/** The handler, with the refund: a charged autofill that ends in an error gives the ticket back. */
export async function POST(req: NextRequest) {
  const bill: Bill = { user: null, tickets: 0, balance: null }
  try {
    const res = await handle(req, bill)
    if (res.status >= 400 && bill.user && bill.tickets > 0) await refundGenerationTickets(bill.user.id, bill.user.email, bill.tickets)
    return res
  } catch (e) {
    if (bill.user && bill.tickets > 0) await refundGenerationTickets(bill.user.id, bill.user.email, bill.tickets)
    throw e
  }
}
