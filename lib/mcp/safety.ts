/**
 * General-audience rules for the connector (2026-10-20). Server only.
 *
 * The site itself allows adult content for verified adults (CCBill) - its
 * filter (lib/content-filter) blocks what CCBill prohibits, and most models
 * run with their safety checker off. ChatGPT's app directory requires apps
 * suitable for a general audience including teens, and Claude's usage policy
 * is similar, so everything that comes in or goes out through ChatGPT or
 * Claude passes a stricter check:
 *  - the request: the site's filter (no admin bypass), then a keyword screen
 *    for sexual content and nudity, then a Flash-Lite judgement;
 *  - every finished picture (and a clip's poster): a Flash-Lite vision check
 *    before it is shown in the chat. A result that fails stays in the user's
 *    My Generations on the site but is not shown in the app.
 * Each judgement is a fraction of a cent. When the model cannot be reached the
 * request side falls back to the two screens, the picture side to not
 * showing the picture.
 */
import { enforceContentFilter } from '@/lib/content-filter'
import { geminiGenerate, geminiText } from '@/lib/gemini-generate'

const JUDGE_MODEL = 'gemini-3.5-flash-lite'

const ADULT = /\b(nsfw|nude|nudes|nudity|naked|topless|bottomless|porn\w*|xxx|hentai|erotic\w*|sexy|sexual\w*|sex|explicit|lingerie|nipples?|genital\w*|breasts?|boobs?|tits|butt ?naked|undress\w*|strip(per|ping|tease)|fetish\w*|bdsm|onlyfans|seductive|sensual|bikini|thong|panties|underwear)\b/i

const PROMPT_RULES = 'You screen requests to an AI image/video generator used inside ChatGPT and Claude, which must be suitable for a GENERAL AUDIENCE INCLUDING TEENS. Refuse: nudity or partial nudity, sexual or sexually suggestive content, lingerie/underwear/swimwear focus, fetish, graphic gore or extreme violence, self-harm, hate symbols or harassment, illegal acts, and realistic depictions of real, identifiable people (public figures included). Allow everything else (art, products, characters, landscapes, logos, ads, fantasy violence without gore). Answer ONLY with JSON: {"allowed": true|false, "reason": "<short reason if refused>"}'

async function judge(parts: object[], signal: AbortSignal): Promise<{ allowed: boolean; reason?: string } | null> {
  try {
    const res = await geminiGenerate(JUDGE_MODEL, {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 120, responseMimeType: 'application/json' },
    }, { signal })
    if (!res.ok) return null
    const o = JSON.parse(geminiText(await res.json()).trim() || '{}') as { allowed?: unknown; reason?: unknown }
    return typeof o.allowed === 'boolean' ? { allowed: o.allowed, reason: typeof o.reason === 'string' ? o.reason.slice(0, 160) : undefined } : null
  } catch { return null }
}

/** null = go ahead; a string = refused, and what to tell the user. */
export async function checkRequest(text: string, app: string): Promise<string | null> {
  const t = text.trim()
  if (!t) return null
  const site = await enforceContentFilter(t, null)
  const refusal = `This request can't be made through ${app}: AI Design Studio keeps everything made in ${app} suitable for all ages.`
  if (!site.ok) return refusal
  if (ADULT.test(t)) return refusal
  const v = await judge([{ text: `${PROMPT_RULES}\n\nREQUEST:\n${t.slice(0, 4000)}` }], AbortSignal.timeout(8000))
  if (v && !v.allowed) return `${refusal}${v.reason ? ` (${v.reason})` : ''}`
  return null
}

/** Can this picture (a small JPEG, base64) be shown in the chat? */
export async function pictureIsShowable(jpegBase64: string): Promise<boolean> {
  const v = await judge([
    { text: 'Is this AI-generated picture suitable for a general audience including teens (no nudity or partial nudity, nothing sexual or sexually suggestive, no graphic gore)? Answer ONLY with JSON: {"allowed": true|false, "reason": "<short>"}' },
    { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
  ], AbortSignal.timeout(10_000))
  return v?.allowed === true
}
