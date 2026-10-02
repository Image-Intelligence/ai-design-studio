import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { fal } from '@/lib/fal-client'
import { getAudioStudioModel } from '@/lib/audio-studio'
import { submitShots, settleShots, boardFolder } from '@/lib/storyboard-shoot'
import {
  sanitizeShots, totalSeconds, DEFAULT_FINAL_CUT_OPTIONS, NARRATOR_VOICES, SHOOT_RESOLUTIONS,
  FINAL_CUT_MAX_SHOTS, FINAL_CUT_MAX_SECONDS,
  boardMode,
  type FinalCutOptions, type FinalCutPhase, type FinalCutState, type StoryboardShot,
} from '@/lib/storyboard'

/**
 * The Final Cut: from a storyboard to a finished, scored film.
 *
 *   GET                              the board's Final Cut state
 *   POST { action: 'start', options }  begin (shoots whatever is missing first)
 *   POST { action: 'advance' }       do the next step - the page calls this in a loop
 *   POST { action: 'resume' }        retry a failed job from the step it failed on
 *   POST { action: 'cancel' }
 *
 * The pipeline is the one the hand-made ads use, automated:
 *   shoot   any slot without a finished clip is shot (lib/storyboard-shoot)
 *   plan    Gemini 3.7 Flash looks at three frames of every clip with the
 *           story, the shot notes and the transitions, and writes the edit:
 *           which seconds of each clip to keep, the transition into each, the
 *           title and end card text, the music brief and (optionally) the
 *           narration lines
 *   cards   title and end cards lettered by Recraft v4.1 (Ideogram v4 as a
 *           fallback), turned into clips
 *   cut     ffmpeg stitch with trims and transitions (/api/video/assemble)
 *   voice   narration lines voiced by ElevenLabs v4, placed on their shots -
 *           one at a time: a line that runs long pushes the next one back
 *   score   Sonilo composes music to the finished picture (it follows the cuts)
 *   mix     the clips' own sound + music + narration, levelled to -14 LUFS
 *   save    the film lands in My Generations > Storyboards > <title>, and on
 *           the board as a numbered version
 *
 * Why a step machine: a cut takes minutes and a function gets 300s. Each
 * advance does ONE bounded step and records it on the board (Storyboard.
 * finalCut), so a closed tab, a refresh or a failure resumes where it was. A
 * lock stops two overlapping advances from doing the same step twice.
 *
 * ADMIN ONLY. Shots are charged as shots; the rest costs well under $1.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const PLAN_MODEL = 'gemini-3.7-flash'
const SONILO = 'sonilo/v1.1/video-to-video-music'
const LOCK_MS = 290_000
const TRANSITIONS: Record<string, string | null> = {
  cut: null, dissolve: 'fade', fadeblack: 'fadeblack', fadewhite: 'fadewhite',
  smoothleft: 'smoothleft', smoothright: 'smoothright', circleopen: 'circleopen', zoomin: 'zoomin',
}

type Plan = {
  title: { text: string; subtitle: string }
  end: { text: string; subtitle: string }
  musicPrompt: string
  shots: { keepStart: number; keepSeconds: number; transitionIn: string; transitionSeconds: number }[]
  narration: { shot: number; text: string }[]
}
/** Everything a running job carries between steps (stored, never sent raw to the page). */
type Work = {
  plan?: Plan
  titleCard?: string; endCard?: string
  cutUrl?: string; cutSeconds?: number; starts?: number[]
  voice?: { url: string; atSec: number }[]
  musicRequestId?: string; musicUrl?: string | null; musicNote?: string
  mixUrl?: string
  lockUntil?: number
  submitted?: boolean
}
type Stored = FinalCutState & { work?: Work }
type Ctx = { params: Promise<{ id: string }> }

const now = () => Date.now()
const ORDER: FinalCutPhase[] = ['shoot', 'plan', 'cards', 'cut', 'voice', 'score', 'mix', 'save']

async function load(ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return { error: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return { error: jsonPrivate({ error: 'Not found' }, { status: 404 }) }
  return { user, board }
}
const stateOf = (raw: unknown): Stored => {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Stored
  return { job: s.job ?? null, versions: Array.isArray(s.versions) ? s.versions : [], work: s.work ?? {} }
}
/** What the page sees: no internal work state. */
const publicState = (s: Stored): FinalCutState => ({ job: s.job, versions: s.versions })
async function save(boardId: number, s: Stored) {
  await prisma.storyboard.update({ where: { id: boardId }, data: { finalCut: s as object } })
}
const nextPhase = (p: FinalCutPhase, skip: FinalCutPhase[]): FinalCutPhase | null => {
  for (let i = ORDER.indexOf(p) + 1; i < ORDER.length; i++) if (!skip.includes(ORDER[i])) return ORDER[i]
  return null
}

/** /api/video/assemble, called as a function with the admin password (no session needed). */
async function assemble(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { POST } = await import('@/app/api/video/assemble/route')
  const res = await POST(new NextRequest('http://internal/api/video/assemble', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD ?? '' },
    body: JSON.stringify(body),
  }))
  const data = await res.json() as Record<string, any>
  if (!res.ok) throw new Error(String(data?.error || `Assembly failed (${res.status})`).slice(0, 300))
  return data
}

async function inlineFrame(url: string) {
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const small = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 384, height: 384, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer()
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } }
  } catch { return null }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

// ── the steps ────────────────────────────────────────────────────────────────

async function stepPlan(board: { title: string; story: string; look: string; aspect: string; mode: string }, shots: StoryboardShot[], opts: FinalCutOptions): Promise<Plan> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured')
  // Three frames of every clip, so the plan can choose the best seconds to keep
  // The frames only inform the edit: a clip whose frames can't be read is
  // planned from its notes and recorded length rather than stopping the film
  const looks = await mapLimit(shots, 4, async s => {
    try {
      const f = await assemble({ op: 'frames', videoUrl: s.video!.url!, at: ['first', 'mid', 'last'] })
      const frames = (await Promise.all(['first', 'mid', 'last'].map(k => (f.frames?.[k] ? inlineFrame(f.frames[k]) : Promise.resolve(null))))).filter(Boolean)
      return { seconds: Number(f.durationSec) || s.video!.seconds, frames }
    } catch {
      return { seconds: s.video!.seconds, frames: [] }
    }
  })
  const parts: any[] = [{ text: [
    'You are the editor of a short AI-generated film. The shots are already filmed; you decide the edit.',
    `TITLE: ${board.title}`, `STORY: ${board.story}`, board.look ? `LOOK: ${board.look}` : '', `FRAME: ${board.aspect}`,
    // What kind of piece it is changes the edit (an ad cuts tighter than a story)
    `KIND: ${boardMode(board.mode).label}. ${boardMode(board.mode).edit}`,
    'For every shot below you get its notes, the planned length, the real clip length and three frames (first / middle / last).',
  ].filter(Boolean).join('\n') }]
  shots.forEach((s, i) => {
    parts.push({ text: `\nSHOT ${i + 1}: ${s.title} - ${s.description}\nmotion: ${s.videoPrompt}\nplanned ${s.duration}s, clip is ${looks[i].seconds.toFixed(1)}s${s.keepWhole ? ' - KEEP THE WHOLE CLIP (the owner marked it; do not trim it)' : ''}\ncut to next: ${s.transition}` })
    parts.push(...looks[i].frames)
  })
  parts.push({ text: [
    '',
    'Write the edit as JSON:',
    '- "shots": one entry per shot, in order: "keepStart" (seconds into the clip) and "keepSeconds" - close to the planned length, inside the clip, choosing the strongest part of the action (skip a slow start or a broken ending you can see in the frames); "transitionIn": how this shot is entered, one of cut, dissolve, fadeblack, fadewhite, smoothleft, smoothright, circleopen, zoomin - follow the previous shot\'s "cut to next" note; mostly "cut", "dissolve" for time passing, "fadeblack" for big shifts; "transitionSeconds" 0.3-1.0 (ignored for cut). The first shot is entered from the title card.',
    '- "title": {"text": the film\'s title, "subtitle": a short line or ""}; "end": {"text": a closing line such as "The End" or a tagline, "subtitle": ""}.',
    '- "musicPrompt": one or two sentences briefing a composer: genre, instruments, mood arc across the film, where it builds and where it lands. No vocals.',
    opts.narration
      ? '- "narration": short voice-over lines, at most one per shot and only where it helps (not every shot), each {"shot": shot number, "text": a line short enough to speak inside that shot - about 2.5 words per second of the kept length of the shot, so a 4-second shot takes 10 words at most}. A line must END inside its shot: the next line waits for it. Evocative, not a description of the picture.'
      : '- "narration": [] (no narrator).',
    'Reply with JSON only: {"title":{"text":"","subtitle":""},"end":{"text":"","subtitle":""},"musicPrompt":"","shots":[{"keepStart":0,"keepSeconds":0,"transitionIn":"cut","transitionSeconds":0}],"narration":[]}',
  ].join('\n') })

  const call = (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PLAN_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } }),
  })
  let res = await call(true)
  if (res.status === 400) res = await call(false)
  if (!res.ok) throw new Error(`The edit plan failed (${res.status})`)
  const data = await res.json() as any
  const text = String((data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let raw: any
  try { raw = JSON.parse(text) } catch { throw new Error('The edit plan came back unreadable - try again') }

  // Clean it against the real clips: a keep window always fits inside its clip
  const plan: Plan = {
    title: { text: String(raw?.title?.text || board.title).slice(0, 80), subtitle: String(raw?.title?.subtitle || '').slice(0, 100) },
    end: { text: String(raw?.end?.text || 'The End').slice(0, 80), subtitle: String(raw?.end?.subtitle || '').slice(0, 100) },
    musicPrompt: String(raw?.musicPrompt || 'Cinematic orchestral score following the story, building to a climax and landing softly. No vocals.').slice(0, 800),
    shots: shots.map((s, i) => {
      const r = raw?.shots?.[i] ?? {}
      const clip = looks[i].seconds || s.duration
      // A shot marked "keep the whole clip" plays in full, whatever the plan said
      const keepSeconds = s.keepWhole ? clip : Math.max(1, Math.min(clip, Number(r.keepSeconds) || s.duration))
      const keepStart = s.keepWhole ? 0 : Math.max(0, Math.min(clip - keepSeconds, Number(r.keepStart) || 0))
      const t = String(r.transitionIn || 'cut').toLowerCase()
      return { keepStart, keepSeconds, transitionIn: t in TRANSITIONS ? t : 'cut', transitionSeconds: Math.min(1.2, Math.max(0.3, Number(r.transitionSeconds) || 0.6)) }
    }),
    narration: opts.narration && Array.isArray(raw?.narration)
      ? raw.narration.filter((n: any) => Number.isInteger(n?.shot) && n.shot >= 1 && n.shot <= shots.length && typeof n.text === 'string' && n.text.trim())
          .slice(0, shots.length).map((n: any) => ({ shot: n.shot, text: String(n.text).trim().slice(0, 300) }))
      : [],
  }
  return plan
}

/** Recraft's size enum for the board's frame (21:9 cards are made 16:9; stitch pads them). */
const RECRAFT_SIZE: Record<string, string> = {
  '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '21:9': 'landscape_16_9',
}
const IDEOGRAM_SIZE: Record<string, { width: number; height: number }> = {
  '16:9': { width: 2048, height: 1152 }, '9:16': { width: 1152, height: 2048 }, '1:1': { width: 1536, height: 1536 },
  '4:3': { width: 1792, height: 1344 }, '3:4': { width: 1344, height: 1792 }, '21:9': { width: 2048, height: 1152 },
}
/** The cut's frame: what stitch will produce from footage at this resolution. */
function frameSize(aspect: string, resolution: string) {
  const [aw, ah] = (aspect === '21:9' ? '16:9' : aspect).split(':').map(Number)
  const short = resolution === '1080p' ? 1080 : 720
  return aw >= ah ? { width: Math.round((short * aw) / ah / 2) * 2, height: short } : { width: short, height: Math.round((short * ah) / aw / 2) * 2 }
}

async function makeCard(kind: 'title' | 'end', text: { text: string; subtitle: string }, look: string, aspect: string, resolution: string, seconds: number): Promise<string> {
  const prompt = kind === 'title'
    ? `Cinematic film title card. A dark, atmospheric, mostly empty background in this film's style: ${look || 'moody, cinematic'}. Large elegant title lettering in the centre: "${text.text}".${text.subtitle ? ` Smaller text beneath it: "${text.subtitle}".` : ''} Perfectly legible lettering, no other text.`
    : `Cinematic film end card. A near-black background with a subtle texture in this film's style: ${look || 'moody, cinematic'}. Elegant centred lettering: "${text.text}".${text.subtitle ? ` Smaller text beneath it: "${text.subtitle}".` : ''} Perfectly legible lettering, no other text.`
  // Lettering by Recraft v4.1; Ideogram v4 as the fallback. Ideogram's filter
  // blocks harmless title cards at random ("The Lost Beacon" on black was
  // refused), so it cannot be the only lettering model behind a button.
  let img: string | undefined
  try {
    const out: any = await fal.subscribe('fal-ai/recraft/v4.1/text-to-image', { input: { prompt, image_size: RECRAFT_SIZE[aspect] ?? 'landscape_16_9', enable_safety_checker: false } })
    img = out?.data?.images?.[0]?.url
  } catch { /* fall through to Ideogram */ }
  if (!img) {
    const out: any = await fal.subscribe('ideogram/v4', { input: { prompt, image_size: IDEOGRAM_SIZE[aspect] ?? IDEOGRAM_SIZE['16:9'], num_images: 1, output_format: 'png', enable_safety_checker: false, expansion_model: 'None', rendering_speed: 'QUALITY' } })
    img = out?.data?.images?.[0]?.url
  }
  if (!img) throw new Error(`The ${kind} card failed`)
  const { width, height } = frameSize(aspect, resolution)
  const card = await assemble({ op: 'card', imageUrl: img, seconds, width, height })
  return card.url as string
}

// ── the handler ──────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx)
  if ('error' in r) return r.error
  return jsonPrivate({ finalCut: publicState(stateOf(r.board.finalCut)) })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx)
  if ('error' in r) return r.error
  const { user, board } = r
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const st = stateOf(board.finalCut)
  const shots = sanitizeShots(board.shots)

  if (body.action === 'cancel') {
    if (st.job?.status === 'running') st.job = { ...st.job, status: 'cancelled', message: 'Cancelled', error: null }
    st.work = {}
    await save(board.id, st)
    return jsonPrivate({ finalCut: publicState(st) })
  }

  if (body.action === 'start') {
    if (st.job?.status === 'running') return jsonPrivate({ finalCut: publicState(st) })
    if (shots.length === 0) return jsonPrivate({ error: 'Add shots first' }, { status: 400 })
    if (shots.length > FINAL_CUT_MAX_SHOTS) return jsonPrivate({ error: `The Final Cut takes up to ${FINAL_CUT_MAX_SHOTS} shots for now - split the board` }, { status: 400 })
    if (totalSeconds(shots) > FINAL_CUT_MAX_SECONDS) return jsonPrivate({ error: `The Final Cut takes up to ${FINAL_CUT_MAX_SECONDS}s for now - trim the plan` }, { status: 400 })
    const missingStill = shots.findIndex(s => !s.stillUrl)
    if (missingStill >= 0) return jsonPrivate({ error: `Shot ${missingStill + 1} has no still yet - generate the stills first` }, { status: 400 })
    const o = (body.options ?? {}) as Partial<FinalCutOptions>
    const options: FinalCutOptions = {
      cards: o.cards !== false,
      narration: o.narration === true,
      voice: (NARRATOR_VOICES as readonly string[]).includes(String(o.voice)) ? String(o.voice) : DEFAULT_FINAL_CUT_OPTIONS.voice,
      resolution: (SHOOT_RESOLUTIONS as readonly string[]).includes(String(o.resolution)) ? String(o.resolution) : '720p',
    }
    const skip: FinalCutPhase[] = [...(options.cards ? [] : ['cards' as const]), ...(options.narration ? [] : ['voice' as const])]
    st.job = { status: 'running', phase: 'shoot', message: 'Starting', error: null, startedAt: now(), options, skip }
    st.work = {}
    await save(board.id, st)
    return jsonPrivate({ finalCut: publicState(st) })
  }

  if (body.action === 'resume') {
    if (st.job && (st.job.status === 'failed' || st.job.status === 'cancelled')) {
      st.job = { ...st.job, status: 'running', error: null, message: 'Resuming' }
      if (st.job.phase === 'shoot') st.work = { ...st.work, submitted: false }
      await save(board.id, st)
    }
    return jsonPrivate({ finalCut: publicState(st) })
  }

  // ── advance: one step ──
  const job = st.job
  if (!job || job.status !== 'running') return jsonPrivate({ finalCut: publicState(st) })
  const work: Work = st.work ?? {}
  if (work.lockUntil && work.lockUntil > now()) return jsonPrivate({ finalCut: publicState(st), busy: true })
  work.lockUntil = now() + LOCK_MS
  st.work = work
  await save(board.id, st)

  const setPhase = (p: FinalCutPhase | null, message: string) => {
    if (p) { job.phase = p; job.message = message } else { job.status = 'done'; job.message = message }
  }
  let videos: Record<string, unknown> | undefined
  try {
    switch (job.phase) {
      case 'shoot': {
        // Anything not shot (or failed, or out of date with an edited slot) is shot now
        const need = shots.filter(s => s.video?.status !== 'rendering' && (s.video?.status !== 'done' || !s.video.url))
        if (!work.submitted && need.length) {
          const res = await submitShots(user, board, need.map(s => s.id), job.options.resolution)
          const errs = Object.entries(res).filter(([, v]) => 'error' in v && !('queueId' in v))
          if (errs.length) throw new Error(`Couldn't shoot ${errs.map(([id, v]) => `shot ${shots.findIndex(s => s.id === id) + 1} (${(v as { error: string }).error})`).join(', ')}`)
          work.submitted = true
          job.message = `Shooting ${need.length} shot${need.length === 1 ? '' : 's'}`
          break
        }
        const fresh = await prisma.storyboard.findUnique({ where: { id: board.id } })
        videos = await settleShots(user, fresh!)
        const after = sanitizeShots((await prisma.storyboard.findUnique({ where: { id: board.id }, select: { shots: true } }))?.shots)
        const failed = after.map((s, i) => [s, i] as const).filter(([s]) => s.video?.status === 'failed')
        if (failed.length) throw new Error(`Shot ${failed.map(([, i]) => i + 1).join(', ')} failed to shoot (${failed[0][0].video?.error}) - reshoot it, then resume`)
        const left = after.filter(s => !(s.video?.status === 'done' && s.video.url)).length
        if (left) job.message = `Shooting - ${after.length - left}/${after.length} shots ready`
        else setPhase('plan', 'Planning the edit')
        break
      }
      case 'plan': {
        if (shots.some(s => !s.video?.url)) { setPhase('shoot', 'A shot is missing its clip'); work.submitted = false; break }
        work.plan = await stepPlan(board, shots, job.options)
        setPhase(nextPhase('plan', job.skip), job.skip.includes('cards') ? 'Cutting the picture' : 'Lettering the title and end cards')
        break
      }
      case 'cards': {
        const p = work.plan!
        // A card that cannot be made is not worth losing the film over: the
        // cut goes ahead without it, and the result says so
        const [t, e] = await Promise.all([
          makeCard('title', p.title, board.look, board.aspect, job.options.resolution, 3.5).catch(() => undefined),
          makeCard('end', p.end, board.look, board.aspect, job.options.resolution, 3).catch(() => undefined),
        ])
        work.titleCard = t; work.endCard = e
        if (!t || !e) work.musicNote = [work.musicNote, `the ${!t && !e ? 'title and end cards' : !t ? 'title card' : 'end card'} could not be made`].filter(Boolean).join('; ')
        setPhase('cut', 'Cutting the picture')
        break
      }
      case 'cut': {
        const p = work.plan!
        const fps = 30
        const clips: Record<string, unknown>[] = []
        const used: number[] = []
        const trans: (number | null)[] = []
        if (work.titleCard) { clips.push({ url: work.titleCard }); used.push(3.5); trans.push(null) }
        shots.forEach((s, i) => {
          const sp = p.shots[i]
          const type = TRANSITIONS[sp.transitionIn] ?? null
          const into = i === 0 && work.titleCard ? 'fadeblack' : type
          clips.push({
            url: s.video!.url, trimStart: sp.keepStart, trimEnd: sp.keepStart + sp.keepSeconds,
            ...(clips.length && into ? { transition: { type: into, durationSec: i === 0 ? 0.8 : sp.transitionSeconds } } : {}),
          })
          used.push(sp.keepSeconds)
          trans.push(clips.length > 1 && into ? (i === 0 ? 0.8 : sp.transitionSeconds) : null)
        })
        if (work.endCard) { clips.push({ url: work.endCard, transition: { type: 'fadeblack', durationSec: 0.8 } }); used.push(3); trans.push(0.8) }
        const cut = await assemble({ op: 'stitch', clips, fps, aspect: board.aspect })
        // Where each clip starts in the cut - the same arithmetic stitch uses
        // (a transition overlaps its two neighbours by its length, capped at
        // half the shorter one; a straight cut costs one frame)
        const starts: number[] = [0]
        for (let i = 1; i < used.length; i++) {
          const d = trans[i] ? Math.max(1 / fps, Math.min(trans[i]!, Math.min(used[i - 1], used[i]) / 2)) : 1 / fps
          starts.push(starts[i - 1] + used[i - 1] - d)
        }
        work.cutUrl = canonicalMediaUrl(String(cut.url))
        work.cutSeconds = Number(cut.durationSec) || used.reduce((a, b) => a + b, 0)
        // shot n's start, skipping the title card
        work.starts = work.titleCard ? starts.slice(1, 1 + shots.length) : starts.slice(0, shots.length)
        setPhase(nextPhase('cut', job.skip), job.skip.includes('voice') ? 'Scoring the music' : 'Recording the narration')
        break
      }
      case 'voice': {
        /*
         * ElevenLabs v4, not v3: v3 drops the end of a line's last word now and
         * then (The Paper Lantern's "...in search of purpose" came back
         * "purpu-"). As a second guard each take is measured against its
         * text - a line far shorter than it can be spoken is re-recorded once.
         */
        const spec = getAudioStudioModel('eleven-v4')!
        const { probeRemoteMediaSeconds } = await import('@/lib/video-probe')
        const lines = [...work.plan!.narration].sort((a, b) => a.shot - b.shot)
        const takes = (await mapLimit(lines, 4, async n => {
          const words = n.text.trim().split(/\s+/).length
          // ~3.2 words a second is brisk narration; a take under 70% of that was cut
          const minSec = (words / 3.2) * 0.7
          let url: string | undefined
          let spoken = 0
          for (let attempt = 0; attempt < 2 && !url; attempt++) {
            const out: any = await fal.subscribe(spec.endpoint, { input: spec.build({ text: n.text, voice: job.options.voice }) })
            const take = spec.outputs(out.data)[0]?.url
            if (!take) continue
            const secs = await probeRemoteMediaSeconds(take).catch(() => null)
            if (secs == null || secs >= minSec || attempt === 1) { url = take; spoken = secs ?? (words / 2.6) }
          }
          return url ? { url, shot: n.shot, seconds: spoken } : null
        }))
        /*
         * One line at a time. Each line is due 0.4s into its shot, but a line
         * longer than its shot used to run on under the next one, which
         * started on time regardless - The Paper Lantern's "...wanders into
         * the" was talked over by "In the shadows of the alley". Now a line
         * waits until the one before has finished, plus a breath.
         */
        const BREATH = 0.35
        let free = 0
        work.voice = []
        for (const t of takes) {
          if (!t) continue
          const atSec = Math.max((work.starts?.[t.shot - 1] ?? 0) + 0.4, free)
          work.voice.push({ url: t.url, atSec })
          free = atSec + t.seconds + BREATH
        }
        setPhase('score', 'Scoring the music')
        break
      }
      case 'score': {
        if (!work.musicRequestId) {
          try {
            const sub = await fal.queue.submit(SONILO, { input: { video_url: work.cutUrl!, prompt: work.plan!.musicPrompt, num_samples: 1 } })
            work.musicRequestId = sub.request_id
            job.message = 'Composing music to the cut'
          } catch (e: any) {
            // A film without a score is still a film - mix without it and say so
            work.musicUrl = null; work.musicNote = [work.musicNote, 'the music model refused - the cut has no score'].filter(Boolean).join('; ')
            setPhase('mix', 'Mixing (no score)')
          }
          break
        }
        const s: any = await fal.queue.status(SONILO, { requestId: work.musicRequestId, logs: false })
        if (s?.status === 'COMPLETED') {
          const out: any = await fal.queue.result(SONILO, { requestId: work.musicRequestId })
          work.musicUrl = out?.data?.video?.url ?? out?.data?.videos?.[0]?.url ?? out?.data?.audio?.url ?? null
          if (!work.musicUrl) work.musicNote = [work.musicNote, 'the music model returned nothing - the cut has no score'].filter(Boolean).join('; ')
          setPhase('mix', 'Mixing and mastering')
        } else if (s?.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) {
          work.musicUrl = null; work.musicNote = [work.musicNote, 'the music model failed - the cut has no score'].filter(Boolean).join('; ')
          setPhase('mix', 'Mixing (no score)')
        } else job.message = 'Composing music to the cut'
        break
      }
      case 'mix': {
        const narrated = (work.voice?.length ?? 0) > 0
        const music = work.musicUrl ? [{ url: work.musicUrl, gainDb: narrated ? -15 : -10, fadeInSec: 0.5, fadeOutSec: 2.5 }] : []
        const voice = (work.voice ?? []).map(v => ({ url: v.url, atSec: v.atSec, gainDb: 2 }))
        if (music.length || voice.length) {
          const mixed = await assemble({ op: 'mux', videoUrl: work.cutUrl, music, voice, normalize: true })
          work.mixUrl = canonicalMediaUrl(String(mixed.url))
        } else work.mixUrl = work.cutUrl
        setPhase('save', 'Saving the cut')
        break
      }
      case 'save': {
        const n = (st.versions.at(-1)?.n ?? 0) + 1
        // The poster: a frame from the middle of the film (its opening frame is
        // the black of the title card's fade-in). Falls back to the first still.
        const poster = await assemble({ op: 'frames', videoUrl: work.mixUrl!, at: ['mid'] })
          .then(f => (typeof f.frames?.mid === 'string' ? canonicalMediaUrl(f.frames.mid) : null))
          .catch(() => null) ?? shots[0]?.stillUrl ?? null
        const row = await prisma.generatedImage.create({ data: {
          userId: user.id, prompt: `${board.title} - Final Cut ${n} (Storyboard Studio). ${board.story}`.slice(0, 5000),
          imageUrl: work.mixUrl!, model: 'storyboard-final-cut', ticketCost: 0, referenceImageUrls: [],
          folderId: await boardFolder(user.id, board.title),
          expiresAt: new Date(now() + 100 * 365 * 24 * 3600 * 1000), quality: job.options.resolution, aspectRatio: board.aspect,
          videoMetadata: { isVideo: true, duration: String(Math.round(work.cutSeconds ?? 0)), thumbnailUrl: poster },
        } })
        st.versions = [...st.versions, {
          n, url: work.mixUrl!, durationSec: Math.round((work.cutSeconds ?? 0) * 10) / 10, at: now(), imageId: row.id, posterUrl: poster,
          note: [job.options.cards ? 'cards' : 'no cards', job.options.narration ? `narrated (${job.options.voice})` : 'no narration', work.musicUrl ? 'scored' : 'no score'].join(' · '),
        }]
        setPhase(null, work.musicNote ? `Final Cut ${n} is ready - ${work.musicNote}` : `Final Cut ${n} is ready`)
        st.work = {}
        break
      }
    }
  } catch (e: any) {
    job.status = 'failed'
    // fal puts the real reason in body.detail; its message is just the HTTP status
    const detail = e?.body?.detail
    const why = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : ''
    job.error = String(why || e?.message || e).slice(0, 400)
    job.message = 'Stopped'
  }
  if (st.work) st.work.lockUntil = 0
  st.job = job
  await save(board.id, st)
  return jsonPrivate({ finalCut: publicState(st), ...(videos ? { videos } : {}) })
}
