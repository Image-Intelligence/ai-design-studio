import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { STORYBOARD_VIDEO_MODELS, DURATIONS, sanitizeShots } from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/draft - plan the board with AI.
 *
 * Body: { premise, shots (count), refs?: string[], mode?: 'replace' | 'rewrite' }
 * Returns: { title, story, look, shots } - NOT saved; the workspace shows it
 * and autosaves only what the user keeps.
 *
 * One direct Gemini call in JSON mode, the same small-and-cheap approach as
 * the Movie Studio's brief autofill: it writes the story overview (what
 * happens and how the shots connect), then every slot - what we see, the
 * prompt for its still, the planned video prompt, the duration and how it
 * cuts to the next. 'rewrite' keeps the current board's shot count and stills
 * and rewrites the words around them.
 *
 * ADMIN ONLY.
 */
export const runtime = 'nodejs'
export const maxDuration = 90

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3.7-flash'
const TIMEOUT_MS = 75_000

async function inlineRef(url: string) {
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const small = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } }
  } catch { return null }
}

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!GEMINI_API_KEY) return jsonPrivate({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const premise = typeof body.premise === 'string' ? body.premise.trim().slice(0, 4000) : ''
  const rewrite = body.mode === 'rewrite'
  const current = sanitizeShots(board.shots)
  const count = rewrite ? current.length : Math.min(24, Math.max(2, Math.round(Number(body.shots) || 8)))
  if (!premise && !rewrite) return jsonPrivate({ error: 'Describe the video you want first' }, { status: 400 })
  if (rewrite && count === 0) return jsonPrivate({ error: 'There are no shots to rewrite yet' }, { status: 400 })
  const refs = Array.isArray(body.refs) ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 4) : []
  const images = (await Promise.all(refs.map(inlineRef))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[]

  const instruction = [
    'You are a film director and storyboard artist planning a short AI-generated video, shot by shot, BEFORE any motion is shot.',
    'Every shot will first be made as a still image by an image model, then animated by a video model from that still (image-to-video).',
    `Frame: ${board.aspect}.`,
    board.look ? `The look the board already has: ${board.look}` : '',
    images.length ? `${images.length} reference image(s) of the cast / look are attached - describe characters so they match them.` : '',
    premise ? `THE VIDEO: ${premise}` : '',
    rewrite ? `CURRENT BOARD (keep exactly ${count} shots, in this order, and keep what each one shows; improve the writing):\nSTORY: ${board.story}\n${current.map((s, i) => `${i + 1}. ${s.title} | ${s.description} | still: ${s.imagePrompt} | video: ${s.videoPrompt} | ${s.duration}s | -> ${s.transition}`).join('\n')}` : '',
    '',
    `Plan exactly ${count} shots that tell the story with a clear beginning, middle and end, and that CUT TOGETHER into one film.`,
    'Rules:',
    '- "story": 3-6 sentences - what happens across the film and how the shots connect into one continuous piece (motivated cuts, match cuts, continuity of light, place and time).',
    '- "look": one line of shared style notes (lens, grade, lighting, era) that every still will use.',
    '- Each shot\'s "imagePrompt" describes ONE frozen frame in full (subject, action pose just before the motion, setting, camera angle and shot size, lighting) - self-contained, no references to other shots, no on-screen text.',
    '- Each shot\'s "videoPrompt" describes only the MOTION from that still: what moves, how the camera moves, and the sound (ambience, effects, any spoken line in quotes).',
    '- "description" is one plain sentence a person reads on the board ("What we see").',
    '- "transition" is how this shot hands over to the next one (e.g. "Hard cut on the slam", "Match cut on the circular shape", "Dissolve - time passes"); the last shot\'s is how the film ends.',
    `- "duration" is whole seconds, one of: ${DURATIONS.join(', ')}.`,
    `- "videoModel" is one of: ${STORYBOARD_VIDEO_MODELS.join(', ')} - SeeDance 2.5 for most shots (it refuses close-ups of realistic faces, so pick Kling 3.0 for those).`,
    '',
    'Reply with JSON only: {"title": string, "story": string, "look": string, "shots": [{"title": string, "description": string, "imagePrompt": string, "videoPrompt": string, "videoModel": string, "duration": number, "transition": string}]}',
  ].filter(Boolean).join('\n')

  const call = async (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }, ...images] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 16384, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
    }),
  })
  try {
    let res = await call(true)
    // thinkingConfig is a Gemini 3.x field; fall back to a plain call if it is rejected
    if (res.status === 400) res = await call(false)
    if (!res.ok) return jsonPrivate({ error: `Drafting failed (${res.status})` }, { status: 502 })
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    let plan: any
    try { plan = JSON.parse(text) } catch {
      return jsonPrivate({ error: data.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'The plan was too long - try fewer shots' : 'The model did not return a readable plan - try again' }, { status: 502 })
    }
    let shots = sanitizeShots(plan?.shots)
    if (rewrite) {
      // Same slots, same stills and models - only the words change
      shots = current.map((s, i) => shots[i] ? { ...shots[i], id: s.id, stillUrl: s.stillUrl, imageModel: s.imageModel } : s)
    }
    return jsonPrivate({
      title: typeof plan?.title === 'string' ? plan.title.slice(0, 120) : board.title,
      story: typeof plan?.story === 'string' ? plan.story.slice(0, 8000) : '',
      look: typeof plan?.look === 'string' ? plan.look.slice(0, 2000) : board.look,
      shots,
    })
  } catch (err: any) {
    const msg = String(err?.message || err)
    return jsonPrivate({ error: msg.includes('timeout') || msg.includes('aborted') ? 'Drafting timed out - try fewer shots' : `Drafting failed: ${msg.slice(0, 200)}` }, { status: 502 })
  }
}
