/**
 * Nova Studio - the critic (server only, 2026-10-18).
 *
 * A second, stronger Gemini model reviews finished work against the brief
 * before it is handed over - the "fresh eyes" a creative director gives a
 * cut. It sees the pictures themselves (images inlined; videos as frames from
 * lib/nova/media-inspect) plus the measured facts (length, loudness, silent
 * stretches), and answers in JSON: pass / revise, a 1-10 score, and concrete
 * fixes per item that Nova can act on with its tools.
 *
 * It runs once per production, not every turn, so a pricier model is
 * affordable: its tokens are added to the turn's chat cost at that model's
 * rate. Scores are stored on each generation (videoMetadata.novaCritic) and
 * feed the model scorecard's learned ranking.
 */
import prisma from '@/lib/prisma'
import { geminiGenerate, geminiText } from '@/lib/gemini-generate'
import { novaChatUsd } from '@/lib/nova/config'

/** The critic's model - decided by the 2026-10-18 Argon vs Flash evaluation (lib/nova/config NOVA_CRITIC_MODEL). */
/** `video`: the clip itself, small (lib/nova/video-ops watchableVideo) - the critic WATCHES it, sound included. */
export type CritiqueItem = { id: number; kind: string; model: string; prompt: string; pictures: { mime: string; data: string }[]; facts: string[]; video?: { mime: string; data: string } | null }
/**
 * `severity`: a BLOCKER fails the brief or is a visible defect a client would
 * reject; POLISH is a nice-to-have. Only blockers make the verdict "revise"
 * (decided here, not by the model - see critique()).
 */
export type Critique = { verdict: 'pass' | 'revise'; score: number; summary: string; issues: { id: number | null; severity: 'blocker' | 'polish'; problem: string; fix: string; lesson?: string }[]; strengths: string[] }

export async function critique(o: { model: string; brief: string; items: CritiqueItem[]; signal?: AbortSignal }): Promise<{ critique: Critique; usd: number; usage: { inputTokens: number; outputTokens: number } }> {
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [{
    text: [
      'You are the creative director reviewing work an AI studio assistant made for a client. Be honest, specific and FAIR - you are the last check before the client sees it, and every revision costs the client time and money.',
      'Judge against the BRIEF: does it deliver what was asked (subject, format, aspect, length, text, brand, mood)? Then craft: composition and framing (nothing important cut off or crowded), legibility and spelling of any text, anatomy and object errors, consistency of characters/products across items, motion quality, and sound (from the facts: loudness near -14 LUFS for social, no clipping, no unintended silence, no word cut off).',
      // Calibration (2026-10-20): the critic scored almost everything 3-5 and asked for revisions on
      // taste, so every production went round two or three times. Anchors + severities fix the scale.
      'SCORE on this scale - judge at normal viewing size, the way the client will watch it, not by pixel-peeping single frames: 9-10 excellent, nothing to change; 7-8 good and ready to ship, at most small polish; 5-6 a defect a client would notice; 3-4 misses part of the brief or has an obvious glitch; 1-2 unusable. Well-made AI work that delivers the brief is a 7 or 8 - do not mark it down for being AI-made or for taste you would have chosen differently.',
      'The video you watch is a compressed review copy (480p): ignore compression softness or blockiness - only flag artefacts that are clearly in the picture itself (morphing, flicker, warped faces or hands, objects popping in).',
      'Each issue has a severity. "blocker": the brief is not delivered (wrong subject, count, format, aspect or length; required text missing or misspelt; brand rule broken), or a defect the client would reject at a glance (broken anatomy, a subject cut off, a visible glitch, clipping, a word cut off, unintended silence). "polish": anything else that could be better. Give at most 3 polish notes.',
      'verdict "pass" when there are no blockers (polish notes may still be listed); "revise" only when there is at least one blocker. Each fix names the item id and the smallest concrete action (e.g. "edit #123: replace the headline with the exact words in quotes", "crop #456 to 9:16 keeping the cup centred", "lower the music under the voice by 4 dB") - prefer a precise edit over a full regeneration.',
      'For an issue that looks like a HABIT of the model that made the item (it would happen again with other prompts - e.g. "adds unrequested camera bobbing", "renders hands with six fingers", "turns quoted text into gibberish"), add "lesson": one general sentence about the model, no story details. Leave "lesson" out for one-off content mistakes.',
      'Reply with JSON only: {"verdict":"pass"|"revise","score":1-10,"summary":"one or two sentences","issues":[{"id":number|null,"severity":"blocker"|"polish","problem":"...","fix":"...","lesson":"optional"}],"strengths":["..."]}',
      `BRIEF:\n${o.brief.slice(0, 3000)}`,
    ].join('\n\n'),
  }]
  for (const it of o.items.slice(0, 8)) {
    parts.push({ text: `ITEM #${it.id} - ${it.kind} made with ${it.model}. Prompt: "${it.prompt.slice(0, 400)}"${it.facts.length ? `\nMeasured: ${it.facts.join('; ')}` : ''}${it.video ? '\n(the video itself follows, with its sound - judge the motion, any morphing or flicker, the pacing and the sound against the picture)' : it.pictures.length > 1 ? `\n(${it.pictures.length} frames, in time order)` : ''}` })
    if (it.video) parts.push({ inlineData: { mimeType: it.video.mime, data: it.video.data } })
    else for (const p of it.pictures.slice(0, 4)) parts.push({ inlineData: { mimeType: p.mime, data: p.data } })
  }
  const res = await geminiGenerate(o.model, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  }, { signal: o.signal ?? AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`The critic could not run (${res.status})`)
  const data = await res.json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
  const usage = { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0) }
  let raw: any = {}
  try { raw = JSON.parse(geminiText(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { raw = {} }
  const issues: Critique['issues'] = (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 10).map((i: any) => ({ id: Number.isInteger(Number(i?.id)) ? Number(i.id) : null, severity: i?.severity === 'polish' ? 'polish' as const : 'blocker' as const, problem: String(i?.problem ?? '').slice(0, 300), fix: String(i?.fix ?? '').slice(0, 300), ...(typeof i?.lesson === 'string' && i.lesson.trim() ? { lesson: i.lesson.trim().slice(0, 200) } : {}) }))
  // The verdict follows the blockers - an "8/10, revise" or a "pass" with a blocker listed is not a verdict
  const blockers = issues.filter(i => i.severity === 'blocker').length
  const c: Critique = {
    verdict: blockers ? 'revise' : 'pass',
    score: Math.min(10, Math.max(1, Math.round(Number(raw.score) || (blockers ? 5 : 7)))),
    summary: String(raw.summary ?? 'No summary').slice(0, 500),
    issues: [...issues.filter(i => i.severity === 'blocker'), ...issues.filter(i => i.severity === 'polish').slice(0, 3)],
    strengths: (Array.isArray(raw.strengths) ? raw.strengths : []).slice(0, 5).map((s: any) => String(s).slice(0, 200)),
  }
  return { critique: c, usd: novaChatUsd(o.model, usage), usage }
}

/** Keep the score on each reviewed generation, for the scorecard's learned ranking. */
export async function recordCritique(userId: number, ids: number[], c: Critique, model: string): Promise<void> {
  const mark = JSON.stringify({ score: c.score, verdict: c.verdict, model, at: new Date().toISOString() })
  for (const id of ids.slice(0, 8)) {
    // Items with a BLOCKER get a lower personal score than the overall one (polish notes do not count)
    const flagged = c.issues.some(i => i.id === id && i.severity === 'blocker')
    const per = JSON.stringify({ ...JSON.parse(mark), score: flagged ? Math.max(1, c.score - 2) : c.score })
    await prisma.$executeRaw`
      UPDATE "GeneratedImage" SET "videoMetadata" = jsonb_set(COALESCE("videoMetadata"::jsonb, '{}'::jsonb), '{novaCritic}', ${per}::jsonb)
      WHERE id = ${id} AND "userId" = ${userId}`.catch(() => {})
  }
  void mark
}

/**
 * Shot-by-shot consistency (2026-10-19, owner: "unless I use an asset, the
 * character / background consistency is off"). The critic above reviews a
 * finished production once; this checks each still or clip AS IT IS MADE
 * against the look bible's pictures, while a redo is still cheap. Same strong
 * model: Argon caught the subtle flaws Flash missed in the critic evaluation.
 */
export type ShotCheck = { id: number; verdict: 'keep' | 'redo'; character: number | null; place: number | null; style: number; drift: string; fix: string; lesson?: string }
export type ShotRef = { label: string; pictures: { mime: string; data: string }[] }
export type ShotItem = { id: number; kind: string; prompt: string; pictures: { mime: string; data: string }[]; video?: { mime: string; data: string } | null }

export async function checkShots(o: { model: string; refs: ShotRef[]; style: string; shots: ShotItem[]; signal?: AbortSignal }): Promise<{ checks: ShotCheck[]; usd: number }> {
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [{
    text: [
      'You are the continuity supervisor on an AI-made production. Compare each SHOT with the REFERENCE pictures (the look bible) and say whether it stays on-model.',
      'Character: same face shape, features, hair, skin, eyes, body, outfit and colours (a different pose, angle or expression is fine). Place: the same location and its key features, light and time of day when the shot is set there. Style: the same medium, palette and rendering as the references and the style note.',
      'For a video shot you WATCH the clip (or see its first, middle and last frames) - also judge whether the character or place CHANGES during the clip (a face that morphs, an outfit that shifts, a background that drifts).',
      'Score 1-10 each (null for character/place when the shot does not show it). verdict "redo" when any score is below 7 or something obvious changed; then give the cause and the smallest concrete fix (e.g. "pass the character sheet as reference 1 and say she wears the green coat", "re-render: the face morphs in the last second", "edit_clip kling-o3-pro-edit with the cast pictures").',
      'When a drift looks like a HABIT of the model that made the shot (it would happen again - e.g. "changes the outfit colour between start and end frame", "adds a second subject when asked for one"), add "lesson": one general sentence about the model, no story details; leave it out for one-off slips.',
      'Reply with JSON only: {"shots":[{"id":number,"verdict":"keep"|"redo","character":1-10|null,"place":1-10|null,"style":1-10,"drift":"what differs, or empty","fix":"what to do, or empty","lesson":"optional"}]}',
      o.style ? `STYLE NOTE: ${o.style.slice(0, 800)}` : '',
    ].filter(Boolean).join('\n\n'),
  }]
  for (const r of o.refs.slice(0, 6)) {
    parts.push({ text: `REFERENCE - ${r.label}` })
    for (const p of r.pictures.slice(0, 2)) parts.push({ inlineData: { mimeType: p.mime, data: p.data } })
  }
  for (const s of o.shots.slice(0, 6)) {
    parts.push({ text: `SHOT #${s.id} (${s.kind}). Prompt: "${s.prompt.slice(0, 300)}"${s.video ? ' - the clip follows' : s.pictures.length > 1 ? ` - ${s.pictures.length} frames in time order` : ''}` })
    if (s.video) parts.push({ inlineData: { mimeType: s.video.mime, data: s.video.data } })
    else for (const p of s.pictures.slice(0, 3)) parts.push({ inlineData: { mimeType: p.mime, data: p.data } })
  }
  const res = await geminiGenerate(o.model, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3072, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  }, { signal: o.signal ?? AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`The consistency check could not run (${res.status})`)
  const data = await res.json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
  const usage = { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0) }
  let raw: any = {}
  try { raw = JSON.parse(geminiText(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { raw = {} }
  const score = (v: unknown) => (v === null || v === undefined || v === 'null' ? null : Math.min(10, Math.max(1, Math.round(Number(v) || 5))))
  const checks: ShotCheck[] = (Array.isArray(raw.shots) ? raw.shots : []).slice(0, 6).map((x: any) => ({
    id: Number(x?.id) || 0,
    verdict: x?.verdict === 'keep' ? 'keep' : 'redo',
    character: score(x?.character), place: score(x?.place), style: score(x?.style) ?? 5,
    drift: String(x?.drift ?? '').slice(0, 300), fix: String(x?.fix ?? '').slice(0, 300),
    ...(typeof x?.lesson === 'string' && x.lesson.trim() ? { lesson: x.lesson.trim().slice(0, 200) } : {}),
  }))
  return { checks, usd: novaChatUsd(o.model, usage) }
}
