import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { openShotModels } from '@/lib/storyboard-access'
import { jsonPrivate } from '@/lib/api-json'
import { getCreateModel } from '@/lib/chat-hub-models'
import {
  STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, STORYBOARD_VIDEO_IDS, DURATIONS,
  sanitizeShots, boardMode, imageModelLabel, stillModelSpec,
} from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/shot-edit - edit ONE shot's plan with AI.
 *
 * Body: { shotId, instruction, scope: 'image' | 'video' | 'both' }
 *   "use LTX 2.5 Fast instead of SeeDance 2.5", "rewrite the still for
 *   NanoBanana Pro 2", "slower camera, add rain"...
 * Returns: { patch, note } - the fields to change on the shot (only those in
 * scope: imageModel / imagePrompt / imageQuality, videoModel / videoPrompt /
 * duration) and one line on what changed. NOT saved: the workspace applies it
 * (with an undo) and autosaves.
 *
 * Gemini 3.7 Flash in JSON mode, given the shot, its neighbours (continuity),
 * the board's kind and look, the models it may choose from with what each is
 * good at, and the site's own prompting guide for the models in play - so a
 * prompt moved to a new model is rewritten the way THAT model wants it.
 *
 * Any signed-in account (free - one small Gemini call).
 */
export const runtime = 'nodejs'
// Gemini slows badly under load (see the draft route)
export const maxDuration = 120

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3.7-flash'
const TIMEOUT_MS = 110_000
type Ctx = { params: Promise<{ id: string }> }
type Scope = 'image' | 'video' | 'both'

const clip = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const videoSpec = (label: string) => getCreateModel(STORYBOARD_VIDEO_IDS[label] ?? '')

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!GEMINI_API_KEY) return jsonPrivate({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 1500) : ''
  if (!instruction) return jsonPrivate({ error: 'Say what to change' }, { status: 400 })
  const scope: Scope = body.scope === 'image' || body.scope === 'video' ? body.scope : 'both'
  const shots = sanitizeShots(board.shots)
  const i = shots.findIndex(s => s.id === body.shotId)
  if (i < 0) return jsonPrivate({ error: 'That shot is not on the board (save first?)' }, { status: 404 })
  const shot = shots[i]
  const prev = shots[i - 1], next = shots[i + 1]
  const kind = boardMode(board.mode)
  const doImage = scope !== 'video', doVideo = scope !== 'image'

  // The models it may pick, with what each is good at; full prompting guides
  // for the shot's current models and any the instruction names
  const lower = instruction.toLowerCase()
  const named = (label: string) => lower.includes(label.toLowerCase()) || lower.includes(label.toLowerCase().replace(/\s+/g, ''))
  const imageLines = STORYBOARD_IMAGE_MODELS.map(m => `- ${m.label}${m.refs ? '' : ' (no reference images)'}: ${clip(getCreateModel(m.id)?.strengths, 200) || 'general image model'}`)
  const videoLines = STORYBOARD_VIDEO_MODELS.map(l => `- ${l}: ${clip(videoSpec(l)?.strengths, 200) || 'image-to-video model'}`)
  const guides: string[] = []
  if (doImage) for (const m of STORYBOARD_IMAGE_MODELS) if (m.id === shot.imageModel || named(m.label)) {
    const g = getCreateModel(m.id)?.guide
    if (g) guides.push(`${m.label} prompting guide: ${clip(g, 900)}`)
  }
  if (doVideo) for (const l of STORYBOARD_VIDEO_MODELS) if (l === shot.videoModel || named(l)) {
    const g = videoSpec(l)?.guide
    if (g) guides.push(`${l} prompting guide: ${clip(g, 900)}`)
  }

  const instructionText = [
    'You are editing ONE shot of a storyboard for an AI-generated video. Each shot is first made as a still by an image model, then animated FROM that still by a video model (image-to-video).',
    `BOARD: "${board.title}" - a ${kind.label.toLowerCase()}. ${clip(board.story, 900)}`,
    board.look ? `LOOK (added to every still automatically - do not repeat it): ${clip(board.look, 400)}` : '',
    `FRAME: ${board.aspect}.`,
    prev ? `SHOT BEFORE (${i}): ${prev.title} - ${clip(prev.description, 200)} -> ${prev.transition}` : 'This is the FIRST shot.',
    next ? `SHOT AFTER (${i + 2}): ${next.title} - ${clip(next.description, 200)}` : 'This is the LAST shot.',
    '',
    `THE SHOT (${i + 1}): ${shot.title}`,
    `What we see: ${shot.description}`,
    `Image model: ${imageModelLabel(shot.imageModel)}`,
    `Image prompt: ${shot.imagePrompt || shot.description}`,
    `Video model: ${shot.videoModel}`,
    `Video prompt: ${shot.videoPrompt}`,
    `Length: ${shot.duration}s. Hands over to the next shot: ${shot.transition}`,
    '',
    `THE DIRECTOR'S INSTRUCTION: ${instruction}`,
    `CHANGE ONLY: ${scope === 'both' ? 'the image (model + prompt) and the video (model + prompt + length)' : scope === 'image' ? 'the image - its model and prompt. Leave the video alone.' : 'the video - its model, prompt and length. Leave the image alone.'}`,
    '',
    doImage ? `Image models you may use (exact names):\n${imageLines.join('\n')}` : '',
    doVideo ? `Video models you may use (exact names):\n${videoLines.join('\n')}` : '',
    guides.length ? `\n${guides.join('\n\n')}` : '',
    '',
    'Rules:',
    '- If the instruction names a model, switch to that model (use its exact name from the list); otherwise keep the current model unless the instruction implies a change.',
    '- Write each prompt the way ITS model is best prompted (follow its guide when one is given). Keep what the shot shows and how it connects to its neighbours unless the instruction asks to change that.',
    '- The image prompt describes ONE frozen frame in full (subject, pose just before the motion, setting, camera angle and shot size, lighting) - self-contained, no on-screen text.',
    '- The video prompt describes only the MOTION from that still: what moves, how the camera moves, and the sound.',
    `- Length is whole seconds, one of: ${DURATIONS.join(', ')} - change it only if the instruction or the new model needs it.`,
    '',
    'Reply with JSON only: {"imageModel": string or "", "imagePrompt": string or "", "videoModel": string or "", "videoPrompt": string or "", "duration": number or null, "note": "one short sentence saying what changed"}',
    'Leave a field "" (or duration null) when it does not change.',
  ].filter(Boolean).join('\n')

  const call = async (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instructionText }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 4096, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
    }),
  })
  try {
    let res = await call(true)
    if (res.status === 400) res = await call(false)
    if (!res.ok) return jsonPrivate({ error: `The edit failed (${res.status})` }, { status: 502 })
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    let out: any
    try { out = JSON.parse(text) } catch { return jsonPrivate({ error: 'The model did not return a readable edit - try again' }, { status: 502 }) }

    // Only what is in scope, only models that exist, only lengths the board uses
    const patch: Record<string, unknown> = {}
    if (doImage) {
      const want = String(out?.imageModel ?? '').trim().toLowerCase()
      const m = want ? STORYBOARD_IMAGE_MODELS.find(x => x.label.toLowerCase() === want || x.id === want) : undefined
      if (m && m.id !== shot.imageModel) {
        patch.imageModel = m.id
        // A quality the new model does not offer goes back to its default
        if (shot.imageQuality && !stillModelSpec(m.id).qualities.includes(shot.imageQuality)) patch.imageQuality = ''
        // Another model's settings mean nothing to this one
        if (shot.imageOptions) patch.imageOptions = {}
      }
      if (typeof out?.imagePrompt === 'string' && out.imagePrompt.trim()) patch.imagePrompt = out.imagePrompt.trim().slice(0, 4000)
    }
    if (doVideo) {
      const want = String(out?.videoModel ?? '').trim().toLowerCase()
      const l = want ? STORYBOARD_VIDEO_MODELS.find(x => x.toLowerCase() === want) : undefined
      if (l && l !== shot.videoModel) patch.videoModel = l
      if (typeof out?.videoPrompt === 'string' && out.videoPrompt.trim()) patch.videoPrompt = out.videoPrompt.trim().slice(0, 4000)
      const d = Number(out?.duration)
      if ((DURATIONS as readonly number[]).includes(d) && d !== shot.duration) patch.duration = d
    }
    if (!Object.keys(patch).length) return jsonPrivate({ error: 'Nothing changed - try saying it differently' }, { status: 422 })
    // A non-admin is never switched to a model they cannot use
    return jsonPrivate({ patch: openShotModels(patch as { imageModel?: string; videoModel?: string }, user.isAdmin), note: typeof out?.note === 'string' ? out.note.slice(0, 300) : '' })
  } catch (err: any) {
    const msg = String(err?.message || err)
    return jsonPrivate({ error: msg.includes('timeout') || msg.includes('aborted') ? 'The edit timed out - Gemini is slow right now, try again' : `The edit failed: ${msg.slice(0, 200)}` }, { status: 502 })
  }
}
