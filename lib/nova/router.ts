/**
 * Nova Studio - which Gemini model runs a turn (server only, 2026-10-18).
 *
 * Most turns are small - a question, "put these in a folder", "make it
 * warmer" - and do not need the model a 20-shot production planning does. A
 * Flash-Lite call (fractions of a cent) reads the message and the state of the
 * chat and picks a tier; each tier runs on the model the evaluation found best
 * value for it (NOVA_ROUTES in lib/nova/config). If the classifier fails, a
 * keyword rule decides, so routing never blocks a turn.
 *
 * An admin who picks a specific model in the studio skips the router.
 *
 * 2026-10-19 (owner: Nova's loops and multi-shot work were not as clean as
 * Claude's): ANY new video - one clip, a loop, an animation, a talking
 * character - and anything that has to stay consistent across images now
 * counts as production, so the strong model plans it (which recipe, which
 * end-frame model, the look bible). Execution turns stay on Flash for speed
 * (Argon takes 30-170s a step - a 16-step turn would never fit the turn's
 * clock); the visual JUDGING in them goes to the strong model through
 * check_shots and critique_work.
 */
import { geminiGenerate, geminiText } from '@/lib/gemini-generate'
import { NOVA_ROUTES, type NovaTier, type NovaUsage } from '@/lib/nova/config'

const ROUTER_MODEL = 'gemini-3.5-flash-lite'

function heuristic(text: string, o: { planActive: boolean; continuing: boolean; attachments: number }): NovaTier {
  const t = text.toLowerCase()
  if (o.continuing || o.planActive) return 'run'
  if (/\b(advert|ad|commercial|trailer|film|movie|campaign|storyboard|series|episodes?|scene|video|clip|loop(ing)?|animat\w*|gif|cinemagraph|talking|lip-?sync|consistent|same (character|person|product))\b/.test(t)
    || /\b([2-9]|two|three|four|five|six)\s+(shots?|scenes?|clips?|poses?|images?|pictures?|angles?|versions?)\b/.test(t)) return 'production'
  if (/\b(make|create|generate|design|draw|animate|render|video|image|picture|logo|song|music|voice|3d)\b/.test(t) || o.attachments) return 'create'
  return 'light'
}

export async function routeTurn(text: string, o: { planActive: boolean; continuing: boolean; attachments: number; lastReply: string }): Promise<{ tier: NovaTier; model: string; usage: NovaUsage; why: string }> {
  const usage = { inputTokens: 0, outputTokens: 0 }
  const fallback = heuristic(text, o)
  // Carrying out an approved plan or waking after renders: execution, not planning - no need to ask
  if (o.planActive || o.continuing) return { tier: 'run', model: NOVA_ROUTES.run, usage, why: o.continuing ? 'continuing a production' : 'running the approved plan' }
  try {
    const prompt = [
      'Classify the user\'s message to an AI creative studio assistant into ONE tier. Reply with JSON {"tier":"light"|"create"|"production","why":"few words"}.',
      'light: questions, chat, organising or finding things in their library, renaming, small talk - no new media.',
      'create: one or two new images, a picture edit or fix, one sound / voice line / song, a simple cut of EXISTING clips - no new video and nothing that has to match other images.',
      'production: ANY new video (even one clip, a loop, an animation, a talking character), anything that must keep a character, product or place consistent across 2+ images or shots, ads, scenes, films, campaigns, series, or a stated budget above about 15 tickets.',
      `Assistant's last reply (context): "${o.lastReply.slice(0, 300)}"`,
      `User: "${text.slice(0, 1200)}"${o.attachments ? ` [attached ${o.attachments} item(s)]` : ''}`,
    ].join('\n')
    const res = await geminiGenerate(ROUTER_MODEL, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 120, responseMimeType: 'application/json' } }, { signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const data = await res.json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
      usage.inputTokens = data.usageMetadata?.promptTokenCount ?? 0
      usage.outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0
      const j = JSON.parse(geminiText(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
      const tier: NovaTier = j.tier === 'light' || j.tier === 'create' || j.tier === 'production' ? j.tier : fallback
      return { tier, model: NOVA_ROUTES[tier], usage, why: String(j.why ?? '').slice(0, 80) }
    }
  } catch { /* fall back */ }
  return { tier: fallback, model: NOVA_ROUTES[fallback], usage, why: 'rule' }
}
