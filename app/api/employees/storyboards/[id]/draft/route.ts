import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { STORYBOARD_IMAGE_MODELS, storyboardModelMenu, DURATIONS, MAX_SHOTS, MAX_DRAFT_SHOTS, MAX_SCENES, fitDurations, runtimeRange, lengthLabel, sanitizeShots, sanitizeAssets, sanitizeScenes, orderByScenes, ensureScenes, sceneShots, newShot, newScene, boardMode, isBoardMode, isFraming, framingRule, ASSET_KINDS, refsFromAssets, type StoryboardShot, type StoryScene, type StoryAsset } from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/draft - plan the board with AI.
 *
 * Body: { mode, boardMode?, framing?, premise?, shots?, targetSeconds?, shotIds?, extendCount?, refs?: string[], scenes?, sceneId? }
 *   framing     'waist' | 'full' | 'mix' (default) - how characters are framed, for
 *               the kinds of video with people in them (BOARD_MODES `framing`)
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
 *               end), continuing the story - in that shot's scene
 *   refs        "Match references": pick each chosen shot's references from the
 *               board's assets (what the frame shows) - nothing else is rewritten
 *   scene       `extendCount` new shots at the end of scene `sceneId`, drafted
 *               from its summary, cast and neighbours (a scene with no title or
 *               summary yet gets one from the direction)
 * A new board can be planned in scenes: `scenes` 2+ splits the `shots` across
 * that many scenes. An OUTFIT PACK always is: one scene per Wardrobe asset (or
 * per outfit the premise names), `shots` per outfit, each scene carrying its
 * outfit's asset so its stills use that outfit's photos only.
 * `shotIds` picks the shots (empty = all of them); `premise` is the direction
 * ("make it tenser", "the chase ends at the pier"), optional for all but replace.
 *
 * Returns: { title, story, look, shots, scenes, changed } - `shots` is the WHOLE board
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
type Mode = 'replace' | 'polish' | 'regenerate' | 'extend' | 'scene' | 'refs'

const shotLine = (s: StoryboardShot, n: number) =>
  `${n}. ${s.title} | ${s.description} | still (${s.imageModel}): ${s.imagePrompt} | video: ${s.videoPrompt} | ${s.videoModel} | ${s.duration}s | -> ${s.transition}`
/** The board, numbered from 1 - with a heading wherever a scene starts. */
const listShots = (shots: StoryboardShot[], scenes: StoryScene[] = []) => {
  const out: string[] = []
  let at = ''
  shots.forEach((s, i) => {
    if (scenes.length && s.sceneId !== at) {
      at = s.sceneId ?? ''
      const k = scenes.findIndex(c => c.id === at)
      if (k >= 0) out.push(sceneHeading(scenes[k], k))
    }
    out.push(shotLine(s, i + 1))
  })
  return out.join('\n')
}
const sceneHeading = (c: StoryScene, k: number) =>
  `SCENE ${k + 1}${c.title ? `: ${c.title}` : ''}${c.setting ? ` (${c.setting})` : ''}${c.summary ? ` - ${c.summary}` : ''}`
/** The assets in a scene, by name. */
const sceneAssetNames = (c: StoryScene, assets: StoryAsset[]) => c.assetIds.map(id => assets.find(a => a.id === id)?.name).filter(Boolean) as string[]

const SHOT_RULES = [
  '- Each shot\'s "imagePrompt" describes ONE frozen frame in full (subject, action pose just before the motion, setting, camera angle and shot size, lighting) - self-contained, no references to other shots, no on-screen text (except a title/text card, which spells out the exact words in quotes).',
  '- Each shot\'s "videoPrompt" describes only the MOTION from that still: what moves, how the camera moves, and the sound (ambience, effects, any spoken line in quotes).',
  '- "description" is one plain sentence a person reads on the board ("What we see").',
  '- "transition" is how this shot hands over to the next one (e.g. "Hard cut on the slam", "Match cut on the circular shape", "Dissolve - time passes"); the last shot\'s is how the film ends.',
  `- "duration" is whole seconds, one of: ${DURATIONS.join(', ')}.`,
  // Which reference photos go with each still - the page no longer needs them switched on by hand
  '- "assets" lists the names of the board\'s assets (listed above, exactly as written) that appear in or style THIS frame - a character who is in it, the place it is set in, a prop, vehicle or outfit that is visible, a style or look asset. Their reference photos are sent with this still, so list only what the frame really shows (a wide landscape with nobody in it lists no character). An empty list when none apply, or when the board has no assets.',
  // The whole roster, each with what it is for - the plan casts a model per shot
  '- "imageModel" is the id of the image model that makes the still - pick the best tool for THAT frame from this list:',
  storyboardModelMenu().images,
  '  Keep one model for shots that share a character or product (consistency beats variety); switch only where a shot needs a specialist (a title card -> ideogram-4.5; a logo or graphic -> recraft-v4.1; complex text or diagrams -> gpt-image-2.5).',
  '- "videoModel" is the video model that animates the still - one of these labels, chosen for the motion the shot needs:',
  storyboardModelMenu().videos,
  '  SeeDance 2.5 suits most shots; close-ups of realistic faces need Kling 3.0 or Veo 3.1 (SeeDance refuses them); a title card needs only a gentle move (LTX 2.5 Fast or Kling V3 Turbo).',
]
const SHOT_SHAPE = '{"title": string, "description": string, "imagePrompt": string, "imageModel": string, "assets": [string], "videoPrompt": string, "videoModel": string, "duration": number, "transition": string}'
/** A scene as the planner writes one: `assets` names the board assets in it. */
const SCENE_SHAPE = `{"title": string, "setting": string, "summary": string, "assets": [string], "shots": [${SHOT_SHAPE}]}`
const SCENE_RULES = [
  '- Each scene is one continuous place and time. "title" is a short name ("The Chase"), "setting" a screenplay slug line ("EXT. HARBOUR - NIGHT"), "summary" 1-3 sentences of what happens in it.',
  '- "assets" lists the names of the board\'s assets that appear in that scene (characters, the location, props), exactly as written above - an empty list if there are none.',
  '- Shots cut together within a scene; the last shot of a scene hands over to the next scene (its "transition" says how).',
]
/** Outfit packs: shots per outfit, and the most the whole pack may hold. */
const MAX_OUTFIT_SHOTS = 12
const MAX_OUTFIT_TOTAL = 36
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
    : (['replace', 'polish', 'regenerate', 'extend', 'scene', 'refs'] as const).includes(body.mode as Mode) ? body.mode as Mode : 'replace'
  const boardScenes = sanitizeScenes(board.scenes)
  const current = orderByScenes(sanitizeShots(board.shots), boardScenes)
  const wantIds = Array.isArray(body.shotIds) ? (body.shotIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  // The chosen slots, by position; none chosen = all of them
  let picked = current.map((s, i) => (wantIds.includes(s.id) ? i : -1)).filter(i => i >= 0)
  if (!picked.length) picked = current.map((_, i) => i)
  const extendCount = Math.min(MAX_DRAFT_SHOTS, Math.max(1, Math.round(Number(body.extendCount) || 2)))
  // What kind of video this is, and what it is made of
  const kind = boardMode(isBoardMode(body.boardMode) ? body.boardMode : board.mode)
  const assets = sanitizeAssets(board.assets)
  const outfitPack = kind.id === 'outfit'
  // An outfit pack: one scene per Wardrobe asset (none = the outfits the premise names)
  const outfits = outfitPack ? assets.filter(a => a.kind === 'wardrobe').slice(0, 8) : []
  const perOutfit = Math.min(MAX_OUTFIT_SHOTS, Math.max(1, Math.round(Number(body.shots) || kind.shots)))
  const count = mode !== 'replace' ? 0
    : outfitPack ? Math.min(MAX_OUTFIT_TOTAL, perOutfit * Math.max(1, outfits.length))
    : Math.min(MAX_DRAFT_SHOTS, Math.max(1, Math.round(Number(body.shots) || 8)))
  // A new board planned in scenes (an outfit pack always is)
  const sceneCount = mode !== 'replace' ? 0 : outfitPack ? Math.max(1, outfits.length)
    : Math.min(MAX_SCENES, Math.max(0, Math.round(Number(body.scenes) || 0)), count)
  const inScenes = mode === 'replace' && (outfitPack || sceneCount >= 2)
  // The scene being drafted into
  const target = mode === 'scene' ? boardScenes.find(c => c.id === body.sceneId) ?? null : null
  // The runtime to aim for (0 = Auto), kept to what this many shots can run
  const askedSeconds = Math.round(Number(body.targetSeconds) || 0)
  const range = runtimeRange(count)
  const targetSeconds = mode === 'replace' && askedSeconds > 0 ? Math.min(range.max, Math.max(range.min, askedSeconds)) : 0

  if (mode === 'replace' && !premise && !(outfitPack && outfits.length)) return jsonPrivate({ error: outfitPack ? 'Add the outfits as Wardrobe assets, or describe them' : 'Describe the video you want first' }, { status: 400 })
  if (mode === 'scene' && !target) return jsonPrivate({ error: 'That scene is gone - reload the board' }, { status: 400 })
  if (mode !== 'replace' && mode !== 'scene' && current.length === 0) return jsonPrivate({ error: 'There are no shots yet - draft a board first' }, { status: 400 })
  if (mode === 'refs' && !sanitizeAssets(board.assets).some(a => a.refs.length)) return jsonPrivate({ error: 'Add assets with reference photos first' }, { status: 400 })
  if ((mode === 'extend' || mode === 'scene') && current.length + extendCount > MAX_SHOTS) return jsonPrivate({ error: `A board holds up to ${MAX_SHOTS} shots - there is room for ${Math.max(0, MAX_SHOTS - current.length)} more` }, { status: 400 })

  /*
   * What the planner sees. An outfit pack shows every outfit's own photos,
   * each under its name, so each scene's garments are described from the
   * right pictures; anything else gets the few refs the page sent.
   */
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = []
  if (outfitPack && mode === 'replace' && outfits.length) {
    const per = Math.max(1, Math.min(3, Math.floor(12 / outfits.length)))
    for (const [k, o] of outfits.entries()) {
      const pics = [...o.refs.filter(r => r.active), ...o.refs.filter(r => !r.active)].slice(0, per)
      const got = (await Promise.all(pics.map(r => inlineRef(r.url)))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[]
      parts.push({ text: `OUTFIT ${k + 1} - "${o.name}"${o.notes ? ` (${o.notes})` : ''}: ${got.length ? `${got.length} reference photo(s) follow.` : 'no photos - go by its name and notes.'}` }, ...got)
    }
  } else if (assets.some(a => a.refs.length)) {
    // Every asset's first photo, under its name: the planner describes the
    // cast from them and knows what each asset is when it picks a shot's refs
    for (const a of assets.filter(x => x.refs.length).slice(0, 12)) {
      const got = await inlineRef(a.refs[0].url)
      if (got) parts.push({ text: `ASSET "${a.name}" (${ASSET_KINDS.find(k => k.id === a.kind)?.label ?? a.kind}):` }, got)
    }
  } else {
    const refs = Array.isArray(body.refs) ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 4) : []
    parts.push(...(await Promise.all(refs.map(inlineRef))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[])
  }
  const imageCount = parts.filter(p => 'inlineData' in p).length
  const nums = picked.map(i => i + 1)
  const assetLines = assets.map(a => `- ${ASSET_KINDS.find(k => k.id === a.kind)?.label ?? a.kind}: ${a.name}${a.notes ? ` (${a.notes})` : ''}${a.refs.length ? ` [${a.refs.length} reference photo${a.refs.length === 1 ? '' : 's'}]` : ' [no photos]'}`)
  /*
   * The shot's own references, from the assets the planner says it shows:
   * every photo of each (the still route sends what its model takes, a turn
   * from each asset at a time). null = the planner gave no list - the shot
   * keeps what it had (automatic). Names match loosely ("Mira" = "Mira the pilot").
   */
  const assetIdsFor = (raw: any): string[] | null => {
    if (!assets.length || !Array.isArray(raw?.assets)) return null
    const names = (raw.assets as unknown[]).map(n => String(n).trim().toLowerCase()).filter(Boolean)
    return assets.filter(a => {
      const an = a.name.trim().toLowerCase()
      return a.refs.length > 0 && names.some(n => n === an || n.includes(an) || an.includes(n))
    }).map(a => a.id)
  }
  const withRefs = <T extends StoryboardShot>(shot: T, raw: any): T => {
    const ids = assetIdsFor(raw)
    return ids === null ? shot : { ...shot, refs: refsFromAssets(assets, ids) }
  }
  const anchor = mode === 'extend' ? Math.max(...picked) : -1 // new shots go after this slot

  const head = [
    'You are a film director and storyboard artist planning a short AI-generated video, shot by shot, BEFORE any motion is shot.',
    'Every shot will first be made as a still image by an image model, then animated by a video model from that still (image-to-video).',
    `Frame: ${board.aspect}.`,
    board.look ? `The look the board already has: ${board.look}` : '',
    imageCount && !(outfitPack && mode === 'replace' && outfits.length)
      ? (assets.some(a => a.refs.length) ? 'A photo of each asset is attached under its name - describe the characters, places and things so they match them.' : `${imageCount} reference image(s) of the cast / look are attached - describe characters so they match them.`)
      : '',
    `KIND OF VIDEO: ${kind.label}. ${kind.brief}`,
    // Waist up / full body, for a kind with people in it (mix adds nothing)
    kind.framing && isFraming(body.framing) ? framingRule(body.framing) : '',
    assetLines.length ? `THE BOARD'S ASSETS (use these names and keep each one looking the same wherever it appears):\n${assetLines.join('\n')}` : '',
  ]
  let task: string[]
  if (mode === 'replace' && inScenes) {
    task = outfitPack ? [
      premise ? `THE BRIEF: ${premise}` : '',
      outfits.length
        ? `THE OUTFITS (their photos are attached above, each under its name): ${outfits.map((o, k) => `${k + 1}. ${o.name}`).join('; ')}.`
        : 'Find each separate outfit in the brief.', '',
      `Plan ONE SCENE PER OUTFIT${outfits.length ? `, in the order above (scene 1 = outfit 1)` : ''}, each with exactly ${perOutfit} shot${perOutfit === 1 ? '' : 's'} of that outfit alone - different views, angles and details, NO PEOPLE.`,
      'In each scene, describe the outfit garment by garment from ITS photos, identically in every one of its shots. Use one backdrop and lighting across the whole pack.',
      'Rules:',
      '- "story": 2-4 sentences on what the pack covers.',
      '- "look": one line of shared product-photography notes (backdrop, light, lens) that every still will use.',
      '- Each scene\'s "title" is the outfit\'s name, "setting" the backdrop, "summary" the outfit described garment by garment, and "assets" the outfit\'s name (or an empty list).',
      ...SHOT_RULES, '',
      `Reply with JSON only: {"title": string, "story": string, "look": string, "scenes": [${SCENE_SHAPE}]}`,
    ] : [
      `THE VIDEO: ${premise}`, '',
      `Plan it in exactly ${sceneCount} SCENES with ${count} shots in all, split across the scenes as the story needs, following the brief for this kind of video. The scenes and their shots CUT TOGETHER into one piece.`,
      targetSeconds
        ? `TARGET LENGTH: the whole piece runs ${lengthLabel(targetSeconds)} (${targetSeconds} seconds) - the shots' "duration" values must ADD UP to ${targetSeconds}.`
        : '',
      'Rules:',
      '- "story": 3-6 sentences - what the piece shows from start to finish, scene by scene.',
      '- "look": one line of shared style notes (lens, grade, lighting, era) that every still will use.',
      ...SCENE_RULES, ...SHOT_RULES, '',
      `Reply with JSON only: {"title": string, "story": string, "look": string, "scenes": [${SCENE_SHAPE}]}`,
    ]
  } else if (mode === 'replace') {
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
    const board_ = [`STORY: ${board.story}`, 'THE BOARD (numbered):', listShots(current, boardScenes)].join('\n')
    const direction = premise ? `DIRECTION FROM THE DIRECTOR: ${premise}` : ''
    if (mode === 'scene' && target) {
      const k = boardScenes.indexOf(target)
      const own = sceneShots(current, target.id)
      const names = sceneAssetNames(target, assets)
      const blank = !target.title && !target.summary
      task = [
        `STORY: ${board.story}`,
        'THE SCENES:', ...boardScenes.map((c, i) => `${sceneHeading(c, i)} [${sceneShots(current, c.id).length} shots]`), '',
        // The shots on either side, for continuity - the whole board can run to a hundred
        'THE BOARD AROUND IT (numbered):',
        listShots(current.filter(s => {
          const i = current.indexOf(s)
          const first = current.findIndex(x => x.sceneId === target.id)
          const last = first + own.length - 1
          return own.includes(s) || (first >= 0 ? i >= first - 3 && i <= last + 2 : boardScenes.findIndex(c => c.id === s.sceneId) === k - 1)
        }), boardScenes),
        direction, '',
        `Write ${extendCount} NEW shot${extendCount === 1 ? '' : 's'} for SCENE ${k + 1}${target.title ? ` ("${target.title}")` : ''}${own.length ? `, continuing after its last shot` : ' - it has no shots yet'}, following the brief for this kind of video${premise ? ' and the direction' : ''}.`,
        target.setting ? `The scene takes place: ${target.setting}.` : '',
        target.summary ? `What happens in it: ${target.summary}` : '',
        names.length ? `In this scene: ${names.join(', ')} - keep each looking the same as everywhere else.` : '',
        'They must cut together with the shots around them (continuity of characters, place, light and time).',
        blank ? 'The scene has no name or summary yet: also return "scene": {"title": string, "setting": string, "summary": string} for it.' : '',
        'Rules:', ...SHOT_RULES, '',
        `Reply with JSON only: {${blank ? '"scene": {"title": string, "setting": string, "summary": string}, ' : ''}"shots": [${SHOT_SHAPE}]}`,
      ]
    } else if (mode === 'refs') {
      task = [
        board_, '',
        `For shots ${nums.join(', ')}, decide which of the board's assets each frame shows or is styled by - a character who is in it, the place it is set in, a visible prop, vehicle or outfit, a style asset - judging by its image prompt and description. Their reference photos will be sent with that still. List only what the frame really shows; an empty list when none apply. Do not change anything else.`,
        `Reply with JSON only: {"shots": [{"n": shot number, "assets": [string]}]}`,
      ]
    } else if (mode === 'extend') {
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
      // The outfit photos come first, each under its name; the instruction after
      contents: [{ role: 'user', parts: outfitPack && mode === 'replace' && outfits.length ? [...parts, { text: instruction }] : [{ text: instruction }, ...parts] }],
      // A pack or a board in scenes can run to 30+ shots: room for all of them
      generationConfig: { temperature: mode === 'polish' ? 0.6 : 0.9, maxOutputTokens: count > 16 ? 32768 : 16384, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
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

    if (mode === 'replace' && inScenes) {
      const raw = Array.isArray(plan?.scenes) ? plan.scenes.slice(0, outfitPack ? Math.max(1, outfits.length || MAX_SCENES) : sceneCount) : []
      const scenes: StoryScene[] = []
      let shots: StoryboardShot[] = []
      raw.forEach((rc: any, k: number) => {
        // An outfit's scene carries that outfit's asset; others name theirs
        const named = (Array.isArray(rc?.assets) ? rc.assets : []).map((n: unknown) => String(n).trim().toLowerCase())
        const assetIds = outfitPack && outfits[k] ? [outfits[k].id]
          : assets.filter(a => named.includes(a.name.trim().toLowerCase())).map(a => a.id)
        const c = newScene({
          title: String(rc?.title ?? '').slice(0, 120) || (outfitPack ? outfits[k]?.name ?? `Outfit ${k + 1}` : `Scene ${k + 1}`),
          setting: String(rc?.setting ?? '').slice(0, 160),
          summary: String(rc?.summary ?? '').slice(0, 2000),
          assetIds,
        })
        const rawOwn = Array.isArray(rc?.shots) ? rc.shots.slice(0, outfitPack ? perOutfit : count) : []
        // An outfit's shots stay on their scene's outfit (automatic refs) - never an empty list
        const own = sanitizeShots(rawOwn).map((s, j) => (outfitPack ? { ...s, sceneId: c.id } : withRefs({ ...s, sceneId: c.id }, rawOwn[j])))
        if (!own.length) return
        scenes.push(c)
        shots.push(...own)
      })
      shots = fitDurations(shots.slice(0, Math.min(MAX_SHOTS, outfitPack ? MAX_OUTFIT_TOTAL : count)), targetSeconds)
      if (!shots.length) return jsonPrivate({ error: 'The model returned no shots - try again' }, { status: 502 })
      return jsonPrivate({ title: typeof plan?.title === 'string' ? plan.title.slice(0, 120) : board.title, story, look, shots, scenes, changed: shots.map(s => s.id) })
    }

    if (mode === 'scene' && target) {
      const own = sceneShots(current, target.id)
      const base = own.at(-1) ?? current.at(-1)
      const rawNew = Array.isArray(plan?.shots) ? plan.shots.slice(0, extendCount) : []
      const fresh = sanitizeShots(rawNew).map((s, k) => {
        const pickedModel = plannedImageModel(rawNew[k])
        return withRefs(newShot({ ...s, id: undefined, sceneId: target.id, imageModel: pickedModel ?? base?.imageModel ?? s.imageModel, stillUrl: null, video: null, stills: [] }), rawNew[k])
      })
      if (!fresh.length) return jsonPrivate({ error: 'The model returned no new shots - try again' }, { status: 502 })
      // A scene that had no name yet takes the one the planner gave it
      const sc = plan?.scene && !target.title && !target.summary ? {
        ...target,
        title: String(plan.scene.title ?? '').slice(0, 120),
        setting: String(plan.scene.setting ?? '').slice(0, 160),
        summary: String(plan.scene.summary ?? '').slice(0, 2000),
      } : target
      const scenes = boardScenes.map(c => (c.id === target.id ? sc : c))
      return jsonPrivate({ title: board.title, story: board.story, look: board.look, shots: orderByScenes([...current, ...fresh], scenes), scenes, changed: fresh.map(s => s.id) })
    }

    if (mode === 'replace') {
      // Exactly the count asked for, and lengths that add up to the target
      const rawShots = Array.isArray(plan?.shots) ? plan.shots.slice(0, count) : []
      const shots = fitDurations(sanitizeShots(rawShots).map((s, k) => withRefs(s, rawShots[k])), targetSeconds)
      if (!shots.length) return jsonPrivate({ error: 'The model returned no shots - try again' }, { status: 502 })
      // A new board planned as one run: its shots are Scene 1 (the old scenes go with the old shots)
      const doc = ensureScenes({ shots, scenes: [] })
      return jsonPrivate({ title: typeof plan?.title === 'string' ? plan.title.slice(0, 120) : board.title, story, look, shots: doc.shots, scenes: doc.scenes, changed: doc.shots.map(s => s.id) })
    }

    if (mode === 'extend') {
      const base = current[anchor]
      // New slots carry on the anchor's still model and quality
      const rawNew = Array.isArray(plan?.shots) ? plan.shots.slice(0, extendCount) : []
      const fresh = sanitizeShots(rawNew).map((s, k) => {
        // The planner's still model where it named one; else carry on the anchor's
        const picked = plannedImageModel(rawNew[k])
        // New shots join the anchor's scene
        return withRefs(newShot({ ...s, id: undefined, sceneId: base.sceneId, imageModel: picked ?? base.imageModel, imageQuality: picked && picked !== base.imageModel ? '' : base.imageQuality, imageOptions: picked && picked !== base.imageModel ? undefined : base.imageOptions, stillUrl: null, video: null, stills: [] }), rawNew[k])
      })
      if (!fresh.length) return jsonPrivate({ error: 'The model returned no new shots - try again' }, { status: 502 })
      const shots = [...current.slice(0, anchor + 1), ...fresh, ...current.slice(anchor + 1)]
      return jsonPrivate({ title: board.title, story, look: board.look, shots, scenes: boardScenes, changed: fresh.map(s => s.id) })
    }

    // Match references: only each picked shot's list changes
    if (mode === 'refs') {
      const got = new Map<number, unknown>()
      ;(Array.isArray(plan?.shots) ? plan.shots : []).forEach((r: any, k: number) => {
        const n = Number(r?.n) || nums[k]
        if (nums.includes(n)) got.set(n, r)
      })
      const changed: string[] = []
      const shots = current.map((s, i) => {
        const raw = got.get(i + 1)
        if (raw === undefined || assetIdsFor(raw) === null) return s
        changed.push(s.id)
        return withRefs(s, raw)
      })
      if (!changed.length) return jsonPrivate({ error: 'The model returned nothing usable - try again' }, { status: 502 })
      return jsonPrivate({ title: board.title, story: board.story, look: board.look, shots, scenes: boardScenes, changed })
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
        // A re-imagined shot takes the planner's references; a polished one
        // keeps its own (it shows the same thing), unless it had none yet
        ...((mode === 'regenerate' || !s.refs) && assetIdsFor(raw) !== null ? { refs: refsFromAssets(assets, assetIdsFor(raw)!) } : {}),
        // A re-imagined slot shows something new: its old still stays a take
        // (the slot's versions) but is no longer the one shown
        ...(mode === 'regenerate' ? { stillUrl: null } : {}),
      }
    })
    if (!changed.length) return jsonPrivate({ error: 'The model returned nothing usable - try again' }, { status: 502 })
    return jsonPrivate({ title: board.title, story: mode === 'polish' && picked.length === current.length ? story : board.story, look: mode === 'polish' && picked.length === current.length ? look : board.look, shots, scenes: boardScenes, changed })
  } catch (err: any) {
    const msg = String(err?.message || err)
    return jsonPrivate({ error: msg.includes('timeout') || msg.includes('aborted') ? 'Drafting timed out - try fewer shots' : `Drafting failed: ${msg.slice(0, 200)}` }, { status: 502 })
  }
}
