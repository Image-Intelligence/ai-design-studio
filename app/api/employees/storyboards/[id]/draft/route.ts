import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { STORYBOARD_VIDEO_MODELS, STORYBOARD_IMAGE_MODELS, storyboardModelMenu, DURATIONS, MAX_SHOTS, MAX_DRAFT_SHOTS, fitDurations, runtimeRange, lengthLabel, sanitizeShots, sanitizeAssets, newShot, boardMode, isBoardMode, ASSET_KINDS, type StoryboardShot } from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/draft - plan the board with AI.
 *
 * Body: { mode, boardMode?, premise?, shots?, targetSeconds?, shotIds?, extendCount?, refs?: string[] }
 *   boardMode   what kind of video (lib/storyboard BOARD_MODES: story, trailer,
 *               ad, product, character...) - its brief shapes every action;
 *               defaults to the board's saved mode
 *   replace     a whole new board from the premise (`shots` = how many, 1-20;
 *               `targetSeconds` = the runtime to aim for, 0/absent = Auto)
 *   polish      improve the WRITING of the chosen shots - each keeps what it
 *               shows, its still and its model ('rewrite' is the old name)
 *   regenerate  re-imagine the chosen shots so they fit between their
 *               neighbours (and follow the direction); their old still stays
 *               in the slot's takes, the slot shows none until it is remade
 *   extend      `extendCount` new shots after the last chosen one (or at the
 *               end), continuing the story
 * `shotIds` picks the shots (empty = all of them); `premise` is the direction
 * ("make it tenser", "the chase ends at the pier"), optional for all but replace.
 *
 * Returns: { title, story, look, shots, changed } - `shots` is the WHOLE board
 * with the changes merged in (untouched slots come back exactly as stored) and
 * `changed` the ids written. NOT saved: the workspace shows it and autosaves.
 *
 * One direct Gemini call in JSON mode, the same small-and-cheap approach as
 * the Movie Studio's brief autofill.
 *
 * ADMIN ONLY.
 */
export const runtime = 'nodejs'
// Gemini slows badly under load (2026-10-01: 55-70s for a four-line prompt),
// so a draft gets most of a function's time before it gives up
export const maxDuration = 180

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3.7-flash'
const TIMEOUT_MS = 170_000

async function inlineRef(url: string) {
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const small = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } }
  } catch { return null }
}

type Ctx = { params: Promise<{ id: string }> }
type Mode = 'replace' | 'polish' | 'regenerate' | 'extend'

const listShots = (shots: StoryboardShot[]) =>
  shots.map((s, i) => `${i + 1}. ${s.title} | ${s.description} | still (${s.imageModel}): ${s.imagePrompt} | video: ${s.videoPrompt} | ${s.videoModel} | ${s.duration}s | -> ${s.transition}`).join('\n')

const SHOT_RULES = [
  '- Each shot\'s "imagePrompt" describes ONE frozen frame in full (subject, action pose just before the motion, setting, camera angle and shot size, lighting) - self-contained, no references to other shots, no on-screen text (except a title/text card, which spells out the exact words in quotes).',
  '- Each shot\'s "videoPrompt" describes only the MOTION from that still: what moves, how the camera moves, and the sound (ambience, effects, any spoken line in quotes).',
  '- "description" is one plain sentence a person reads on the board ("What we see").',
  '- "transition" is how this shot hands over to the next one (e.g. "Hard cut on the slam", "Match cut on the circular shape", "Dissolve - time passes"); the last shot\'s is how the film ends.',
  `- "duration" is whole seconds, one of: ${DURATIONS.join(', ')}.`,
  // The whole roster, each with what it is for - the plan casts a model per shot
  '- "imageModel" is the id of the image model that makes the still - pick the best tool for THAT frame from this list:',
  storyboardModelMenu().images,
  '  Keep one model for shots that share a character or product (consistency beats variety); switch only where a shot needs a specialist (a title card -> ideogram-4.5; a logo or graphic -> recraft-v4.1; complex text or diagrams -> gpt-image-2.5).',
  '- "videoModel" is the video model that animates the still - one of these labels, chosen for the motion the shot needs:',
  storyboardModelMenu().videos,
  '  SeeDance 2.5 suits most shots; close-ups of realistic faces need Kling 3.0 or Veo 3.1 (SeeDance refuses them); a title card needs only a gentle move (LTX 2.5 Fast or Kling V3 Turbo).',
]
const SHOT_SHAPE = '{"title": string, "description": string, "imagePrompt": string, "imageModel": string, "videoPrompt": string, "videoModel": string, "duration": number, "transition": string}'
/** The planner's pick, when it named a model the board can use (else keep what the slot had). */
const plannedImageModel = (raw: any): string | null =>
  STORYBOARD_IMAGE_MODELS.find(m => m.id === raw?.imageModel || m.label === raw?.imageModel)?.id ?? null

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!GEMINI_API_KEY) return jsonPrivate({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const premise = typeof body.premise === 'string' ? body.premise.trim().slice(0, 4000) : ''
  const mode: Mode = body.mode === 'rewrite' ? 'polish'
    : (['replace', 'polish', 'regenerate', 'extend'] as const).includes(body.mode as Mode) ? body.mode as Mode : 'replace'
  const current = sanitizeShots(board.shots)
  const wantIds = Array.isArray(body.shotIds) ? (body.shotIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  // The chosen slots, by position; none chosen = all of them
  let picked = current.map((s, i) => (wantIds.includes(s.id) ? i : -1)).filter(i => i >= 0)
  if (!picked.length) picked = current.map((_, i) => i)
  const extendCount = Math.min(MAX_DRAFT_SHOTS, Math.max(1, Math.round(Number(body.extendCount) || 2)))
  const count = mode === 'replace' ? Math.min(MAX_DRAFT_SHOTS, Math.max(1, Math.round(Number(body.shots) || 8))) : 0
  // The runtime to aim for (0 = Auto), kept to what this many shots can run
  const askedSeconds = Math.round(Number(body.targetSeconds) || 0)
  const range = runtimeRange(count)
  const targetSeconds = mode === 'replace' && askedSeconds > 0 ? Math.min(range.max, Math.max(range.min, askedSeconds)) : 0

  if (mode === 'replace' && !premise) return jsonPrivate({ error: 'Describe the video you want first' }, { status: 400 })
  if (mode !== 'replace' && current.length === 0) return jsonPrivate({ error: 'There are no shots yet - draft a board first' }, { status: 400 })
  if (mode === 'extend' && current.length + extendCount > MAX_SHOTS) return jsonPrivate({ error: `A board holds up to ${MAX_SHOTS} shots - there is room for ${Math.max(0, MAX_SHOTS - current.length)} more` }, { status: 400 })

  const refs = Array.isArray(body.refs) ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 4) : []
  const images = (await Promise.all(refs.map(inlineRef))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[]
  const nums = picked.map(i => i + 1)
  // What kind of video this is, and what it is made of
  const kind = boardMode(isBoardMode(body.boardMode) ? body.boardMode : board.mode)
  const assets = sanitizeAssets(board.assets)
  const assetLines = assets.map(a => `- ${ASSET_KINDS.find(k => k.id === a.kind)?.label ?? a.kind}: ${a.name}${a.notes ? ` (${a.notes})` : ''}`)
  const anchor = mode === 'extend' ? Math.max(...picked) : -1 // new shots go after this slot

  const head = [
    'You are a film director and storyboard artist planning a short AI-generated video, shot by shot, BEFORE any motion is shot.',
    'Every shot will first be made as a still image by an image model, then animated by a video model from that still (image-to-video).',
    `Frame: ${board.aspect}.`,
    board.look ? `The look the board already has: ${board.look}` : '',
    images.length ? `${images.length} reference image(s) of the cast / look are attached - describe characters so they match them.` : '',
    `KIND OF VIDEO: ${kind.label}. ${kind.brief}`,
    assetLines.length ? `THE BOARD'S ASSETS (use these names and keep each one looking the same wherever it appears):\n${assetLines.join('\n')}` : '',
  ]
  let task: string[]
  if (mode === 'replace') {
    task = [
      `THE VIDEO: ${premise}`, '',
      `Plan exactly ${count} shot${count === 1 ? '' : 's'} for this ${kind.label.toLowerCase()}, following the brief for this kind of video, that CUT TOGETHER into one piece.`,
      targetSeconds
        ? `TARGET LENGTH: the whole piece runs ${lengthLabel(targetSeconds)} (${targetSeconds} seconds) - the shots' "duration" values must ADD UP to ${targetSeconds}. Pace it: give the moments that matter more time and keep the rest brisk.`
        : '',
      count === 1 ? 'With a single shot, the one shot IS the whole piece - make it complete on its own.' : '',
      'Rules:',
      '- "story": 3-6 sentences - what the piece shows from start to finish and how the shots connect (for a story: what happens; for an ad: the hook, the product and the payoff; for a character board: who they are and how the poses build).',
      '- "look": one line of shared style notes (lens, grade, lighting, era) that every still will use.',
      ...SHOT_RULES, '',
      `Reply with JSON only: {"title": string, "story": string, "look": string, "shots": [${SHOT_SHAPE}]}`,
    ]
  } else {
    const board_ = [`STORY: ${board.story}`, 'THE BOARD (numbered):', listShots(current)].join('\n')
    const direction = premise ? `DIRECTION FROM THE DIRECTOR: ${premise}` : ''
    if (mode === 'extend') {
      task = [
        board_, direction, '',
        `Write ${extendCount} NEW shots that go right after shot ${anchor + 1}${anchor + 1 < current.length ? ` and before shot ${anchor + 2}` : ' at the end of the film'}, continuing the story${premise ? ' as directed' : ''}. They must cut together with the shots around them (continuity of characters, place, light and time).`,
        'Also rewrite "story" so it covers the film with the new shots in it.',
        'Rules:', ...SHOT_RULES, '',
        `Reply with JSON only: {"story": string, "shots": [${SHOT_SHAPE}]}`,
      ]
    } else {
      const polish = mode === 'polish'
      task = [
        board_, direction, '',
        polish
          ? `Improve the WRITING of shots ${nums.join(', ')}: keep what each one shows (same subject, action and place) - sharpen the image prompt, the motion, the description and the transition${premise ? ', following the direction' : ''}.`
          : `RE-IMAGINE shots ${nums.join(', ')}: write them fresh${premise ? ' following the direction' : ''}, so each one still fits between the shots before and after it and the film reads as one.`,
        'Leave every other shot exactly as it is - do not return them.',
        polish && picked.length === current.length ? 'Also return an improved "story" and "look".' : '',
        'Rules:', ...SHOT_RULES, '',
        `Reply with JSON only: {${polish && picked.length === current.length ? '"story": string, "look": string, ' : ''}"shots": [{"n": shot number, ...${SHOT_SHAPE.slice(1)}]}`,
      ]
    }
  }
  const instruction = [...head, ...task].filter(Boolean).join('\n')

  const call = async (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }, ...images] }],
      generationConfig: { temperature: mode === 'polish' ? 0.6 : 0.9, maxOutputTokens: 16384, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
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
    const story = typeof plan?.story === 'string' && plan.story.trim() ? plan.story.slice(0, 8000) : board.story
    const look = typeof plan?.look === 'string' && plan.look.trim() ? plan.look.slice(0, 2000) : board.look

    if (mode === 'replace') {
      // Exactly the count asked for, and lengths that add up to the target
      const shots = fitDurations(sanitizeShots(Array.isArray(plan?.shots) ? plan.shots.slice(0, count) : []), targetSeconds)
      if (!shots.length) return jsonPrivate({ error: 'The model returned no shots - try again' }, { status: 502 })
      return jsonPrivate({ title: typeof plan?.title === 'string' ? plan.title.slice(0, 120) : board.title, story, look, shots, changed: shots.map(s => s.id) })
    }

    if (mode === 'extend') {
      const base = current[anchor]
      // New slots carry on the anchor's still model and quality
      const rawNew = Array.isArray(plan?.shots) ? plan.shots.slice(0, extendCount) : []
      const fresh = sanitizeShots(rawNew).map((s, k) => {
        // The planner's still model where it named one; else carry on the anchor's
        const picked = plannedImageModel(rawNew[k])
        return newShot({ ...s, id: undefined, imageModel: picked ?? base.imageModel, imageQuality: picked && picked !== base.imageModel ? '' : base.imageQuality, imageOptions: picked && picked !== base.imageModel ? undefined : base.imageOptions, stillUrl: null, video: null, stills: [] })
      })
      if (!fresh.length) return jsonPrivate({ error: 'The model returned no new shots - try again' }, { status: 502 })
      const shots = [...current.slice(0, anchor + 1), ...fresh, ...current.slice(anchor + 1)]
      return jsonPrivate({ title: board.title, story, look: board.look, shots, changed: fresh.map(s => s.id) })
    }

    // polish / regenerate: merge the returned slots back by number
    const rows = Array.isArray(plan?.shots) ? plan.shots : []
    const byNum = new Map<number, unknown>()
    rows.forEach((r: any, k: number) => {
      const n = Number(r?.n) || nums[k]
      if (nums.includes(n)) byNum.set(n, r)
    })
    const changed: string[] = []
    const shots = current.map((s, i) => {
      const raw = byNum.get(i + 1)
      if (!raw) return s
      const w = sanitizeShots([raw])[0]
      if (!w) return s
      changed.push(s.id)
      return {
        ...s,
        title: w.title || s.title, description: w.description || s.description,
        imagePrompt: w.imagePrompt || s.imagePrompt, videoPrompt: w.videoPrompt || s.videoPrompt,
        videoModel: w.videoModel || s.videoModel, duration: w.duration || s.duration, transition: w.transition || s.transition,
        imageModel: plannedImageModel(raw) ?? s.imageModel,
        // A re-imagined slot shows something new: its old still stays a take
        // (the slot's versions) but is no longer the one shown
        ...(mode === 'regenerate' ? { stillUrl: null } : {}),
      }
    })
    if (!changed.length) return jsonPrivate({ error: 'The model returned nothing usable - try again' }, { status: 502 })
    return jsonPrivate({ title: board.title, story: mode === 'polish' && picked.length === current.length ? story : board.story, look: mode === 'polish' && picked.length === current.length ? look : board.look, shots, changed })
  } catch (err: any) {
    const msg = String(err?.message || err)
    return jsonPrivate({ error: msg.includes('timeout') || msg.includes('aborted') ? 'Drafting timed out - try fewer shots' : `Drafting failed: ${msg.slice(0, 200)}` }, { status: 502 })
  }
}
