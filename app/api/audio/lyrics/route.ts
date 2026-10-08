import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { enforceContentFilter } from '@/lib/content-filter'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { fal } from '@/lib/fal-client'
import { jsonPrivate } from '@/lib/api-json'

/**
 * POST /api/audio/lyrics - "Write lyrics" under Mureka 9.5 Song's lyrics box
 * (2026-10-07, admin while Mureka is under test).
 *
 * Body: { prompt }   a topic, theme or title
 * Returns: { title, lyrics, ticketCost }
 *
 * Mureka Lyrics writes a full song (sections tagged [Verse], [Chorus]...) in a
 * few seconds, so it runs inline rather than through the queue. fal bills
 * $0.0135 a request: 1 ticket. Text, not media, so there is no feed row - the
 * lyrics go straight into the box, and the song sung from them is what lands
 * in the feed. Pairing it with the song model is the cheap path to a sung
 * song: lyrics ($0.0135) + lyrics-to-song ($0.225) against $0.75 for a song
 * from a description.
 */
export const maxDuration = 60
const ENDPOINT = 'mureka/api/generate/lyrics'
const TICKETS = 1

export async function POST(req: Request) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user?.email) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { prompt?: unknown }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 500) : ''
  if (!prompt) return jsonPrivate({ error: 'Say what the song is about' }, { status: 400 })
  const filter = await enforceContentFilter(prompt, user.email)
  if (!filter.ok) return jsonPrivate({ error: filter.reason }, { status: 400 })

  const charge = await deductGenerationTickets(user.id, user.email, TICKETS)
  if (!charge.ok) return jsonPrivate({ error: `Insufficient tickets. Need ${charge.need}, you have ${charge.have}.` }, { status: 402 })
  try {
    const r: any = await fal.subscribe(ENDPOINT, { input: { prompt } })
    const lyrics = typeof r?.data?.lyrics === 'string' ? r.data.lyrics.trim() : ''
    if (!lyrics) throw new Error('No lyrics came back')
    return jsonPrivate({ title: typeof r.data.title === 'string' ? r.data.title : '', lyrics: lyrics.slice(0, 5000), ticketCost: TICKETS })
  } catch (e: any) {
    await refundGenerationTickets(user.id, user.email, TICKETS)
    const detail = e?.body?.detail
    const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
    return jsonPrivate({ error: msg ? `Could not write lyrics: ${msg}` : 'Could not write lyrics' }, { status: 502 })
  }
}
