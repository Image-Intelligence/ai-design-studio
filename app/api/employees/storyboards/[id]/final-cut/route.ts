import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { fal } from '@/lib/fal-client'
import { getAudioStudioModel } from '@/lib/audio-studio'
import { submitShots, settleShots, boardFolder } from '@/lib/storyboard-shoot'
import { uploadToR2 } from '@/lib/r2'
import { inspectMedia } from '@/lib/nova/media-inspect'
import { editImage, type EditOp } from '@/lib/nova/image-edit'
import { critique } from '@/lib/nova/critic'
import { NOVA_CRITIC_MODEL } from '@/lib/nova/config'
import { chargeAiText, refundEnhance } from '@/lib/prompt-enhance'
import { SHOT_EDIT_TICKETS } from '@/lib/ai-text-pricing'
import {
  sanitizeShots, sanitizeScenes, orderByScenes, totalSeconds, DEFAULT_FINAL_CUT_OPTIONS, NARRATOR_VOICES, SHOOT_RESOLUTIONS,
  FINAL_CUT_MAX_SHOTS, FINAL_CUT_MAX_SECONDS, FINAL_CUT_FORMATS,
  boardMode,
  MAX_REVISE_EDITS,
  type FinalCutOptions, type FinalCutPhase, type FinalCutState, type FinalCutVersion, type StoryboardShot, type VoiceLine, type ReviseEdit, finalCutExtraTickets,
} from '@/lib/storyboard'

/**
 * The Final Cut: from a storyboard to a finished, scored film.
 *
 *   GET                              the board's Final Cut state
 *   POST { action: 'start', options, sceneId? }  begin (shoots whatever is missing first);
 *                                    with a sceneId, cut that scene alone
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
 *   mix     the clips' own sound + music + narration, levelled to -14 LUFS;
 *           narration burned in as captions when asked
 *   review  (2026-10-19) the critic - Gemini 4 Argon, the same as Nova Studio's -
 *           watches frames of the finished film and reads its measured sound
 *           against the story; on "revise" ONE automatic revision runs: the
 *           plan is redone with its notes, then cut, voice re-placed, mix
 *           (the score and designed cards are reused), and it reviews again
 *   save    the film lands in My Generations > Storyboards > <title>, and on
 *           the board as a numbered version (with the critic's verdict)
 *   formats the same film in other shapes (9:16 / 1:1 / 4:5 / 16:9), if asked
 *
 * THE AUDIO LANE (2026-10-19): the board's own voice lines are laid where
 * they belong (each shot is kept long enough to hold its lines; a line
 * lip-synced into a clip is already in it), and its music cues replace the
 * AI score (options.score 'board'), each running from its shot to the next cue.
 *
 * REVISE (2026-10-19): { action: 'revise-plan', from, notes } has the edit AI
 * turn the user's notes on version `from` into an edit list (stored as
 * finalCut.revision); { action: 'start', revise: { from, edits, notes,
 * rescore } } re-runs the cut from that version's plan with the edits made -
 * reusing its cards when their words did not change, and its score unless
 * the edits need a new one. { action: 'revise-update', revision } keeps the
 * page's changes to the list.
 *
 * The plan now also gets MEASURED facts for every clip (lib/nova/media-inspect):
 * its real length, whether it opens or ends dark, dead air - so trims follow
 * the footage, not a guess. A designed card that fails is replaced by an
 * exact-text card (the words set on a darkened still of the film) instead of
 * leaving the film without it.
 *
 * Why a step machine: a cut takes minutes and a function gets 300s. Each
 * advance does ONE bounded step and records it on the board (Storyboard.
 * finalCut), so a closed tab, a refresh or a failure resumes where it was. A
 * lock stops two overlapping advances from doing the same step twice.
 *
 * Any signed-in account. Shots are charged as shots (by /api/video/generate);
 * the cut's own work - plan, cards, score, mix, narration - is charged at the
 * start (lib/storyboard finalCutExtraTickets, the number the page shows) and
 * refunded if the job is cancelled or started over. Admins are not charged.
 * A non-admin's title cards run with the safety checker on.
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
  /** dB added to the music's usual level (-12..+6; 0 = as usual) - "quieter music" from a revision. */
  musicLevel?: number
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
  /** The narration takes, kept so a revision can re-place them without recording again. */
  takes?: { url: string; shot: number; seconds: number }[]
  /** The critic's last verdict, and whether the one revision has been used. */
  review?: { verdict: 'pass' | 'revise'; score: number; summary: string; issues: string[] }
  revised?: boolean
  /** Phases a revision does not redo (the score; designed cards). */
  reviseSkip?: FinalCutPhase[]
  /** The "Final Cut n is ready" line, carried to the formats step. */
  ready?: string
  /** The audio lane's voice lines, placed on the cut. */
  lane?: { url: string; atSec: number; text: string; seconds: number }[]
  /** The audio lane's music cues, placed on the cut (instead of the AI score). */
  cues?: { url: string; startSec: number; endSec: number; gainDb: number; fadeInSec: number; fadeOutSec: number }[]
}
type Stored = FinalCutState & { work?: Work }
type Ctx = { params: Promise<{ id: string }> }

const now = () => Date.now()
// The step order (lib/storyboard FINAL_CUT_PHASES) - review and formats added 2026-10-19
const ORDER: FinalCutPhase[] = ['shoot', 'plan', 'cards', 'cut', 'voice', 'score', 'mix', 'review', 'save', 'formats']

async function load(ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return { error: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return { error: jsonPrivate({ error: 'Not found' }, { status: 404 }) }
  return { user, board }
}
const stateOf = (raw: unknown): Stored => {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Stored
  return { job: s.job ?? null, versions: Array.isArray(s.versions) ? s.versions : [], work: s.work ?? {}, revision: s.revision ?? null }
}
/** What the page sees: no internal work state. */
const publicState = (s: Stored): FinalCutState => ({ job: s.job, versions: s.versions, revision: s.revision ?? null })
/** A revision's edit list as the page may send it back (toggled, reworded). */
function cleanEdits(raw: unknown): ReviseEdit[] {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_REVISE_EDITS).map((e: any, i) => ({
    id: typeof e?.id === 'string' && e.id ? e.id.slice(0, 40) : `e${i}`,
    kind: e?.kind === 'board' ? 'board' as const : 'cut' as const,
    shot: Number.isInteger(e?.shot) && e.shot > 0 ? e.shot : null,
    text: String(e?.text ?? '').trim().slice(0, 400),
    on: e?.on !== false,
  })).filter(e => e.text)
}
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

/**
 * A shot's voice lines the cut lays: recorded, and not already in its clip
 * (a lip-synced line is part of the picture's own sound).
 */
function laneLines(s: StoryboardShot, opts: FinalCutOptions): VoiceLine[] {
  if (opts.lines === false) return []
  return (s.lines ?? []).filter(l => l.status === 'done' && !!l.url && l.seconds > 0 && l.id !== s.video?.edit?.lineId)
}
/** Seconds a shot must stay on screen to hold its lines. */
const laneNeed = (s: StoryboardShot, opts: FinalCutOptions) => laneLines(s, opts).reduce((m, l) => Math.max(m, l.offset + l.seconds + 0.3), 0)

// ── the steps ────────────────────────────────────────────────────────────────

type ReviseBrief = { from: number; base?: unknown; edits: string[]; notes: string }
async function stepPlan(board: { title: string; story: string; look: string; aspect: string; mode: string }, shots: StoryboardShot[], opts: FinalCutOptions, notes?: string, revise?: ReviseBrief): Promise<Plan> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured')
  // Three frames of every clip, so the plan can choose the best seconds to keep
  // The frames only inform the edit: a clip whose frames can't be read is
  // planned from its notes and recorded length rather than stopping the film
  // Measured, not guessed (lib/nova/media-inspect): the real length, the
  // frames, whether the clip opens or ends dark, dead air
  const looks = await mapLimit(shots, 4, async s => {
    try {
      const rep = await inspectMedia(s.video!.url!, 'video', { frames: 3, maxFrameSide: 384 })
      const frames = (rep.frames ?? []).map(f => ({ inlineData: { mimeType: 'image/jpeg', data: Buffer.from(f.jpeg).toString('base64') } }))
      const facts: string[] = []
      const bright = async (jpeg?: Uint8Array) => (jpeg ? ((await sharp(Buffer.from(jpeg)).greyscale().stats()).channels[0].mean) : 128)
      const [b0, b2] = await Promise.all([bright(rep.frames?.[0]?.jpeg), bright(rep.frames?.at(-1)?.jpeg)])
      if (b0 < 28) facts.push('OPENS DARK (near-black first frame) - start the keep a little later')
      if (b2 < 28) facts.push('ENDS DARK (near-black last frame) - end the keep a little earlier')
      if (rep.hasAudio === false) facts.push('no sound of its own')
      for (const n of rep.notes) if (/silent from/i.test(n)) facts.push(n)
      return { seconds: rep.durationSec || s.video!.seconds, frames, facts }
    } catch {
      return { seconds: s.video!.seconds, frames: [] as any[], facts: [] as string[] }
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
    // The audio lane: recorded lines play at their offset into the kept shot, so it must hold them
    const lines = laneLines(s, opts)
    const voice = lines.length ? `\nvoice lines over this shot (already recorded - they play at their offset into the kept shot): ${lines.map(l => `${l.speaker}: "${l.text}" (${l.seconds.toFixed(1)}s from +${l.offset}s)`).join('; ')} - keep this shot at least ${laneNeed(s, opts).toFixed(1)}s` : ''
    const inClip = s.video?.edit?.lineId ? '\nthe clip already has a lip-synced line in its own sound' : ''
    const cue = s.music?.status === 'done' && opts.score === 'board' ? `\nmusic cue starts on this shot: ${s.music.prompt}` : ''
    parts.push({ text: `\nSHOT ${i + 1}: ${s.title} - ${s.description}\nmotion: ${s.videoPrompt}\nplanned ${s.duration}s, clip is ${looks[i].seconds.toFixed(1)}s (measured)${looks[i].facts.length ? `\nmeasured: ${looks[i].facts.join('; ')}` : ''}${s.keepWhole ? ' - KEEP THE WHOLE CLIP (the owner marked it; do not trim it)' : ''}${voice}${inClip}${cue}\ncut to next: ${s.transition}` })
    parts.push(...looks[i].frames)
  })
  if (revise) parts.push({ text: [
    `\nTHIS IS A REVISION OF FINAL CUT ${revise.from}.`,
    revise.base ? `Its edit was: ${JSON.stringify(revise.base).slice(0, 6000)}` : '',
    revise.notes ? `The director said: "${revise.notes}"` : '',
    `Make EVERY one of these edits, and otherwise keep the edit as it was (same keeps and transitions where nothing asks for a change):\n${revise.edits.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
  ].filter(Boolean).join('\n') })
  if (notes) parts.push({ text: `\nTHIS IS A REVISION. A critic watched the last cut and asked for these fixes - make every one that the edit itself can make (trims, timing, transitions, card text, narration lines and where they fall):\n${notes}` })
  parts.push({ text: [
    '',
    'Write the edit as JSON:',
    '- "shots": one entry per shot, in order: "keepStart" (seconds into the clip) and "keepSeconds" - close to the planned length, inside the clip, choosing the strongest part of the action (skip a slow start or a broken ending you can see in the frames); "transitionIn": how this shot is entered, one of cut, dissolve, fadeblack, fadewhite, smoothleft, smoothright, circleopen, zoomin - follow the previous shot\'s "cut to next" note; mostly "cut", "dissolve" for time passing, "fadeblack" for big shifts; "transitionSeconds" 0.3-1.0 (ignored for cut). The first shot is entered from the title card.',
    '- "title": {"text": the film\'s title, "subtitle": a short line or ""}; "end": {"text": a closing line such as "The End" or a tagline, "subtitle": ""}.',
    '- "musicLevel": 0, or a change in dB to the usual music level (-12 to +6) when asked for quieter or louder music.',
    '- "musicPrompt": one or two sentences briefing a composer: genre, instruments, mood arc across the film, where it builds and where it lands. No vocals.',
    shots.some(s => laneLines(s, opts).length) ? '- Shots with voice lines must stay on screen long enough for them (the "keep at least" above).' : '',
    opts.narration
      ? '- "narration": short voice-over lines, at most one per shot and only where it helps (not every shot), each {"shot": shot number, "text": a line short enough to speak inside that shot - about 2.5 words per second of the kept length of the shot, so a 4-second shot takes 10 words at most}. A line must END inside its shot: the next line waits for it. Evocative, not a description of the picture. No narration on shots that have voice lines.'
      : '- "narration": [] (no narrator).',
    'Reply with JSON only: {"title":{"text":"","subtitle":""},"end":{"text":"","subtitle":""},"musicPrompt":"","musicLevel":0,"shots":[{"keepStart":0,"keepSeconds":0,"transitionIn":"cut","transitionSeconds":0}],"narration":[]}',
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
    musicLevel: Math.max(-12, Math.min(6, Math.round(Number(raw?.musicLevel) || 0))),
    shots: shots.map((s, i) => {
      const r = raw?.shots?.[i] ?? {}
      const clip = looks[i].seconds || s.duration
      // A shot marked "keep the whole clip" plays in full, whatever the plan said;
      // a shot with voice lines is kept long enough to hold them (as far as the clip goes)
      const keepSeconds = s.keepWhole ? clip : Math.max(1, Math.min(clip, Math.max(Number(r.keepSeconds) || s.duration, laneNeed(s, opts))))
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

async function makeCard(kind: 'title' | 'end', text: { text: string; subtitle: string }, look: string, aspect: string, resolution: string, seconds: number, safe: boolean): Promise<string> {
  const prompt = kind === 'title'
    ? `Cinematic film title card. A dark, atmospheric, mostly empty background in this film's style: ${look || 'moody, cinematic'}. Large elegant title lettering in the centre: "${text.text}".${text.subtitle ? ` Smaller text beneath it: "${text.subtitle}".` : ''} Perfectly legible lettering, no other text.`
    : `Cinematic film end card. A near-black background with a subtle texture in this film's style: ${look || 'moody, cinematic'}. Elegant centred lettering: "${text.text}".${text.subtitle ? ` Smaller text beneath it: "${text.subtitle}".` : ''} Perfectly legible lettering, no other text.`
  // Lettering by Recraft v4.1; Ideogram v4 as the fallback. Ideogram's filter
  // blocks harmless title cards at random ("The Lost Beacon" on black was
  // refused), so it cannot be the only lettering model behind a button.
  let img: string | undefined
  try {
    const out: any = await fal.subscribe('fal-ai/recraft/v4.1/text-to-image', { input: { prompt, image_size: RECRAFT_SIZE[aspect] ?? 'landscape_16_9', enable_safety_checker: safe } })
    img = out?.data?.images?.[0]?.url
  } catch { /* fall through to Ideogram */ }
  if (!img) {
    const out: any = await fal.subscribe('ideogram/v4', { input: { prompt, image_size: IDEOGRAM_SIZE[aspect] ?? IDEOGRAM_SIZE['16:9'], num_images: 1, output_format: 'png', enable_safety_checker: safe, expansion_model: 'None', rendering_speed: 'QUALITY' } })
    img = out?.data?.images?.[0]?.url
  }
  if (!img) throw new Error(`The ${kind} card failed`)
  const { width, height } = frameSize(aspect, resolution)
  const card = await assemble({ op: 'card', imageUrl: img, seconds, width, height })
  return card.url as string
}

/**
 * An exact-text card: the words set in type on a darkened still of the film
 * (lib/nova/image-edit) - free, never misspelled. The designed card's
 * fallback, or the chosen style.
 */
async function makeExactCard(kind: 'title' | 'end', text: { text: string; subtitle: string }, stillUrl: string, userId: number, aspect: string, resolution: string, seconds: number): Promise<string> {
  const ops: EditOp[] = [
    { op: 'reframe', aspect: aspect === '21:9' ? '16:9' : aspect, mode: 'crop' } as EditOp,
    { op: 'adjust', brightness: kind === 'title' ? 0.45 : 0.3, saturation: 0.8 } as EditOp,
    { op: 'vignette', strength: 0.8 } as EditOp,
    { op: 'text', text: text.text, x: 50, y: text.subtitle ? 46 : 50, size: kind === 'title' ? 8 : 6.5, weight: 'bold', align: 'center', anchor: 'middle', font: 'serif', color: '#ffffff', shadow: true, maxWidth: 84 } as EditOp,
    ...(text.subtitle ? [{ op: 'text', text: text.subtitle, x: 50, y: 58, size: 3.4, weight: 'regular', align: 'center', anchor: 'middle', font: 'sans', color: '#e5e7eb', shadow: true, maxWidth: 80 } as EditOp] : []),
  ]
  const out = await editImage(stillUrl, ops, { maxSide: 2048 })
  const url = await uploadToR2(`storyboard-card-${userId}-${kind}-${Date.now()}.png`, out.png, 'image/png')
  const { width, height } = frameSize(aspect, resolution)
  const card = await assemble({ op: 'card', imageUrl: url, seconds, width, height })
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
  /*
   * The shots this cut is of: the whole board, or one scene - named by the
   * request when a cut starts, then carried on the job for every later step.
   */
  const scenes = sanitizeScenes(board.scenes)
  const sceneId = body.action === 'start' ? (typeof body.sceneId === 'string' ? body.sceneId : null) : st.job?.sceneId ?? null
  const scene = sceneId ? scenes.find(c => c.id === sceneId) ?? null : null
  if (sceneId && !scene && body.action === 'start') return jsonPrivate({ error: 'That scene is gone - reload the board' }, { status: 400 })
  const allShots = orderByScenes(sanitizeShots(board.shots), scenes)
  const shots = scene ? allShots.filter(s => s.sceneId === scene.id) : allShots
  const sceneLabel = scene ? `Scene ${scenes.indexOf(scene) + 1}${scene.title ? ` · ${scene.title}` : ''}` : null
  // What the edit plan and cards are told: the scene's own title and story when it is one
  const cutBoard = scene ? { ...board, title: `${board.title} - ${sceneLabel}`, story: [scene.setting, scene.summary || board.story].filter(Boolean).join('. ') } : board
  // The music cue playing over cut shot i: the nearest at or before it on the WHOLE board (a scene inherits the cue it starts under)
  const activeCueAt = (i: number) => {
    const k = allShots.findIndex(x => x.id === shots[i]?.id)
    for (let j = k; j >= 0; j--) if (allShots[j].music) return allShots[j].music!
    return null
  }
  const baseOf = (j: { revise?: { from: number } | null } | null) => (j?.revise ? st.versions.find(x => x.n === j.revise!.from) : undefined) as FinalCutVersion | undefined

  /*
   * The Revise phase: the user's notes on a version -> an edit list (stored on
   * the board so a reload keeps it). One small AI job, charged like Edit with
   * AI (today's free AI actions first) and refunded if it fails.
   */
  if (body.action === 'revise-plan') {
    const v = st.versions.find(x => x.n === Number(body.from))
    const notes = String(body.notes ?? '').trim().slice(0, 2000)
    if (!v) return jsonPrivate({ error: 'That version is gone - reload the board' }, { status: 400 })
    if (!notes) return jsonPrivate({ error: 'Say what to change' }, { status: 400 })
    if (st.job?.status === 'running') return jsonPrivate({ error: 'A cut is running - wait for it to finish' }, { status: 409 })
    if (!GEMINI_API_KEY) return jsonPrivate({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })
    const paid = await chargeAiText(user, SHOT_EDIT_TICKETS)
    if (!paid.ok) return jsonPrivate({ error: `Writing the edits needs ${paid.need} ticket - you have ${paid.have}`, needTickets: true }, { status: 402 })
    const refund = () => (paid.free ? refundEnhance(user.id) : refundGenerationTickets(user.id, user.email, SHOT_EDIT_TICKETS))
    try {
      // The shots that version is of: its scene ("Scene 2 · The Chase"), or the whole board
      const vScene = /^Scene (\d+)/.exec(v.scene ?? '')
      const vShots = vScene ? allShots.filter(x => x.sceneId === scenes[Number(vScene[1]) - 1]?.id) : allShots
      const lines = vShots.map((s, i) => [
        `SHOT ${i + 1}: ${s.title} - ${s.description} (planned ${s.duration}s${s.keepWhole ? ', kept whole' : ''}; cut to next: ${s.transition})`,
        ...(s.lines ?? []).filter(l => l.text).map(l => `   voice line - ${l.speaker}: "${l.text}" at +${l.offset}s${l.status === 'done' ? ` (${l.seconds.toFixed(1)}s, recorded)` : ' (not recorded yet)'}`),
        ...(s.music ? [`   music cue starts here: ${s.music.prompt}${s.music.status === 'done' ? '' : ' (not composed yet)'}`] : []),
      ].join('\n')).join('\n')
      const prompt = [
        'You are the editor of a short AI-generated film. The director watched a cut and says what to change. Turn it into a short, concrete EDIT LIST.',
        `TITLE: ${cutBoard.title}`, `STORY: ${cutBoard.story}`, `FRAME: ${board.aspect}. KIND: ${boardMode(board.mode).label}.`,
        `THE BOARD:\n${lines}`,
        `FINAL CUT ${v.n} (${v.durationSec}s, ${v.note}).${v.parts?.plan ? ` Its edit: ${JSON.stringify(v.parts.plan).slice(0, 6000)}` : ''}`,
        v.review ? `The critic said (${v.review.score}/10): ${v.review.summary}${v.review.issues?.length ? ` - ${v.review.issues.join('; ')}` : ''}` : '',
        `THE DIRECTOR SAYS: "${notes}"`,
        '',
        'Each edit is one of two kinds:',
        '- "cut": something the editing pass can do itself - trim or lengthen a shot (inside its clip), change a transition, emphasis or pacing, reword the title / end card, add, move or cut narration lines, the overall music level (quieter / louder), captions. Be specific: name the shot number and the seconds or words.',
        '- "board": something that needs the BOARD changed first - a new or redone still, a reshoot, a new clip edit, a new or re-recorded voice line, a new music cue. Say exactly what to change on which shot; the director does these before re-running the cut.',
        'Only list what the director asked for (and what it directly needs). 1-8 items.',
        '"rescore": true only if the music has to be composed again (the director asked for different music, or the cut\'s timing changes a lot).',
        'Reply with JSON only: {"summary":"one sentence","rescore":false,"edits":[{"kind":"cut","shot":2,"text":"..."}]}  ("shot" null when it is about the whole film).',
      ].filter(Boolean).join('\n')
      const call = (thinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PLAN_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json', ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } }),
      })
      let res = await call(true)
      if (res.status === 400) res = await call(false)
      if (!res.ok) throw new Error(`The edit AI failed (${res.status})`)
      const data = await res.json() as any
      const text = String((data.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
      const raw = JSON.parse(text)
      const edits = cleanEdits((Array.isArray(raw?.edits) ? raw.edits : []).map((e: any, i: number) => ({ ...e, id: `e${Date.now().toString(36)}${i}`, on: true })))
      if (!edits.length) throw new Error('The edit AI found nothing to change - try saying it differently')
      st.revision = { from: v.n, notes, summary: String(raw?.summary ?? '').slice(0, 300), edits, rescore: raw?.rescore === true, at: now() }
      await save(board.id, st)
      return jsonPrivate({ finalCut: publicState(st), tickets: paid.free ? 0 : SHOT_EDIT_TICKETS, ...(paid.newBalance >= 0 ? { balance: paid.newBalance } : {}) })
    } catch (e: any) {
      await refund()
      return jsonPrivate({ error: String(e?.message || e).slice(0, 300) }, { status: 502 })
    }
  }
  if (body.action === 'revise-update') {
    const r = body.revision
    if (r === null) st.revision = null
    else if (st.revision && r && typeof r === 'object') st.revision = { ...st.revision, edits: cleanEdits(r.edits), rescore: r.rescore === true, notes: typeof r.notes === 'string' ? r.notes.slice(0, 2000) : st.revision.notes }
    await save(board.id, st)
    return jsonPrivate({ finalCut: publicState(st) })
  }

  if (body.action === 'cancel') {
    // The cut's own charge comes back - nothing of it is delivered
    if (st.job && st.job.status !== 'done' && st.job.charged) {
      await refundGenerationTickets(user.id, user.email, st.job.charged)
      st.job = { ...st.job, charged: 0 }
    }
    if (st.job?.status === 'running') st.job = { ...st.job, status: 'cancelled', message: 'Cancelled', error: null }
    st.work = {}
    await save(board.id, st)
    return jsonPrivate({ finalCut: publicState(st) })
  }

  if (body.action === 'start') {
    if (st.job?.status === 'running') return jsonPrivate({ finalCut: publicState(st) })
    if (shots.length === 0) return jsonPrivate({ error: scene ? 'This scene has no shots yet' : 'Add shots first' }, { status: 400 })
    if (shots.length > FINAL_CUT_MAX_SHOTS) return jsonPrivate({ error: `The Final Cut takes up to ${FINAL_CUT_MAX_SHOTS} shots for now - ${scene ? 'split the scene' : scenes.length ? 'cut it a scene at a time' : 'split the board into scenes'}` }, { status: 400 })
    if (totalSeconds(shots) > FINAL_CUT_MAX_SECONDS) return jsonPrivate({ error: `The Final Cut takes up to ${FINAL_CUT_MAX_SECONDS}s for now - ${scenes.length && !scene ? 'cut it a scene at a time' : 'trim the plan'}` }, { status: 400 })
    const missingStill = shots.findIndex(s => !s.stillUrl)
    if (missingStill >= 0) return jsonPrivate({ error: `Shot ${missingStill + 1} has no still yet - generate the stills first` }, { status: 400 })
    const o = (body.options ?? {}) as Partial<FinalCutOptions>
    const options: FinalCutOptions = {
      cards: o.cards !== false,
      cardStyle: o.cardStyle === 'exact' ? 'exact' : 'designed',
      narration: o.narration === true,
      // Captions burn in whatever is spoken - narration and the lane's lines
      captions: o.captions === true,
      review: o.review !== false,
      formats: Array.isArray(o.formats) ? [...new Set(o.formats.filter(f => (FINAL_CUT_FORMATS as readonly string[]).includes(f) && f !== board.aspect))].slice(0, 3) : [],
      voice: (NARRATOR_VOICES as readonly string[]).includes(String(o.voice)) ? String(o.voice) : DEFAULT_FINAL_CUT_OPTIONS.voice,
      resolution: (SHOOT_RESOLUTIONS as readonly string[]).includes(String(o.resolution)) ? String(o.resolution) : '720p',
      score: o.score === 'board' || o.score === 'none' ? o.score : 'ai',
      lines: o.lines !== false,
    }
    // A revision: from one of the versions, with the edits switched on
    const rv = body.revise && typeof body.revise === 'object' ? body.revise as Record<string, unknown> : null
    const baseV = rv ? st.versions.find(x => x.n === Number(rv.from)) : undefined
    if (rv && !baseV) return jsonPrivate({ error: 'The version to revise is gone - reload the board' }, { status: 400 })
    const edits = rv ? (Array.isArray(rv.edits) ? rv.edits : []).map(x => String(x ?? '').trim().slice(0, 400)).filter(Boolean).slice(0, MAX_REVISE_EDITS) : []
    if (rv && !edits.length) return jsonPrivate({ error: 'Switch on at least one edit' }, { status: 400 })
    const revise = baseV ? { from: baseV.n, edits, notes: String(rv!.notes ?? '').slice(0, 2000), rescore: rv!.rescore === true } : null
    const hasLines = options.lines !== false && shots.some(s => laneLines(s, options).length)
    const skip: FinalCutPhase[] = [...(options.cards ? [] : ['cards' as const]), ...(options.narration || hasLines ? [] : ['voice' as const]), ...(options.score === 'none' ? ['score' as const] : []), ...(options.review ? [] : ['review' as const]), ...(options.formats?.length ? [] : ['formats' as const])]
    // The board's cues are already paid for; a revision may keep the last score
    const boardMusic = options.score === 'board' && shots.some((s, i) => activeCueAt(i)?.status === 'done')
    const keepScore = !!revise && !revise.rescore && !!baseV?.parts?.musicUrl && options.score !== 'board'
    // Starting over a failed cut: its charge comes back first
    if (st.job && st.job.status !== 'done' && st.job.charged) await refundGenerationTickets(user.id, user.email, st.job.charged)
    // The cut's own work, paid up front (the shots are charged as they are shot)
    const charged = finalCutExtraTickets(boardMusic ? options : { ...options, score: options.score === 'board' ? 'ai' : options.score }, totalSeconds(shots), { score: keepScore })
    const paid = await deductGenerationTickets(user.id, user.email, charged)
    if (!paid.ok) return jsonPrivate({ error: `The Final Cut needs ${paid.need} tickets for the edit, cards, music${options.review ? ', the critic' : ''}${options.formats?.length ? ' and the extra formats' : ''} (plus any shots it shoots) - you have ${paid.have}`, needTickets: true }, { status: 402 })
    st.job = { status: 'running', phase: 'shoot', message: revise ? `Revising Final Cut ${revise.from}` : scene ? `Starting ${sceneLabel}` : 'Starting', error: null, startedAt: now(), options, skip, sceneId: scene?.id ?? null, charged: user.isAdmin ? 0 : charged, revise }
    st.work = {}
    await save(board.id, st)
    return jsonPrivate({ finalCut: publicState(st) })
  }

  if (body.action === 'resume') {
    if (st.job && (st.job.status === 'failed' || st.job.status === 'cancelled')) {
      /*
       * A cancel refunds the cut's charge (charged -> 0), so resuming a
       * cancelled - or a failed, then cancelled - cut pays for it again.
       * Before 2026-10-17 cancel-then-resume finished the whole cut free.
       * A failed cut that was never cancelled still holds its charge and
       * resumes without paying twice.
       */
      let charged = st.job.charged ?? 0
      if (!user.isAdmin && !charged) {
        const price = finalCutExtraTickets(st.job.options, totalSeconds(shots))
        const paid = await deductGenerationTickets(user.id, user.email, price)
        if (!paid.ok) return jsonPrivate({ error: `Resuming the Final Cut needs ${paid.need} tickets for the edit, cards and music - you have ${paid.have}`, needTickets: true }, { status: 402 })
        charged = price
      }
      st.job = { ...st.job, charged, status: 'running', error: null, message: 'Resuming' }
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

  // A revision reuses the score (and designed cards): those phases are skipped the second time round
  const skipNow: FinalCutPhase[] = [...(job.skip ?? []), ...(work.revised ? work.reviseSkip ?? [] : [])]
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
        const ours = new Set(shots.map(s => s.id))
        const after = sanitizeShots((await prisma.storyboard.findUnique({ where: { id: board.id }, select: { shots: true } }))?.shots).filter(s => ours.has(s.id))
        const failed = after.map((s, i) => [s, i] as const).filter(([s]) => s.video?.status === 'failed')
        if (failed.length) throw new Error(`Shot ${failed.map(([, i]) => i + 1).join(', ')} failed to shoot (${failed[0][0].video?.error}) - reshoot it, then resume`)
        const left = after.filter(s => !(s.video?.status === 'done' && s.video.url)).length
        if (left) job.message = `Shooting - ${after.length - left}/${after.length} shots ready`
        else setPhase('plan', 'Planning the edit')
        break
      }
      case 'plan': {
        if (shots.some(s => !s.video?.url)) { setPhase('shoot', 'A shot is missing its clip'); work.submitted = false; break }
        const notes = work.revised && work.review ? work.review.issues.map((x, i) => `${i + 1}. ${x}`).join('\n') : undefined
        const base = baseOf(job)
        work.plan = await stepPlan(cutBoard, shots, job.options, notes, job.revise ? { from: job.revise.from, base: base?.parts?.plan, edits: job.revise.edits, notes: job.revise.notes } : undefined)
        setPhase(nextPhase('plan', skipNow), skipNow.includes('cards') ? 'Cutting the picture' : 'Lettering the title and end cards')
        break
      }
      case 'cards': {
        const p = work.plan!
        // A card that cannot be made is not worth losing the film over: the
        // cut goes ahead without it, and the result says so
        // Exact-text cards are set on the first / last still; a designed card that fails falls back to one
        const firstStill = shots[0]?.stillUrl, lastStill = shots.at(-1)?.stillUrl
        const exact = (kind: 'title' | 'end', txt: { text: string; subtitle: string }, still: string | null | undefined, secs: number) =>
          still ? makeExactCard(kind, txt, still, user.id, board.aspect, job.options.resolution, secs).catch(() => undefined) : Promise.resolve(undefined)
        const designedOr = (kind: 'title' | 'end', txt: { text: string; subtitle: string }, still: string | null | undefined, secs: number) =>
          job.options.cardStyle === 'exact' ? exact(kind, txt, still, secs)
            : makeCard(kind, txt, board.look, board.aspect, job.options.resolution, secs, !user.isAdmin).catch(() => exact(kind, txt, still, secs))
        const bp = baseOf(job)?.parts
        const was = bp?.plan as Plan | undefined
        const same = (a?: { text: string; subtitle: string }, b?: { text: string; subtitle: string }) => !!a && !!b && a.text === b.text && a.subtitle === b.subtitle
        const [t, e] = await Promise.all([
          bp?.titleCard && same(was?.title, p.title) ? Promise.resolve(bp.titleCard) : designedOr('title', p.title, firstStill, 3.5),
          bp?.endCard && same(was?.end, p.end) ? Promise.resolve(bp.endCard) : designedOr('end', p.end, lastStill, 3),
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
        setPhase(nextPhase('cut', skipNow), skipNow.includes('voice') ? (skipNow.includes('score') ? 'Mixing' : 'Scoring the music') : 'Recording the voices')
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
        const lines = job.options.narration ? [...work.plan!.narration].sort((a, b) => a.shot - b.shot) : []
        // The audio lane's own lines, where they belong in the cut
        work.lane = shots.flatMap((s, i) => laneLines(s, job.options).map(l => ({ url: l.url!, atSec: (work.starts?.[i] ?? 0) + l.offset, text: l.text, seconds: l.seconds })))
        // A revision re-places the takes it already has (same lines) instead of recording again
        const reuse = work.revised && work.takes?.length ? work.takes : null
        const takes = reuse ?? (await mapLimit(lines, 4, async n => {
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
        work.takes = takes.filter((t): t is NonNullable<typeof t> => !!t)
        const BREATH = 0.35
        let free = 0
        work.voice = []
        // ...and never over one of the lane's lines
        const busy = work.lane.map(l => [l.atSec - BREATH, l.atSec + l.seconds + BREATH] as const)
        for (const t of takes) {
          if (!t) continue
          let atSec = Math.max((work.starts?.[t.shot - 1] ?? 0) + 0.4, free)
          for (let k = 0; k < 4; k++) {
            const hit = busy.find(([a, b]) => atSec < b && atSec + t.seconds > a)
            if (!hit) break
            atSec = hit[1]
          }
          work.voice.push({ url: t.url, atSec })
          free = atSec + t.seconds + BREATH
        }
        setPhase(nextPhase('voice', skipNow), skipNow.includes('score') ? 'Mixing' : 'Scoring the music')
        break
      }
      case 'score': {
        // The board's own music: each recorded cue from its shot to the next cue
        if (!work.musicRequestId && job.options.score === 'board') {
          const segs: { cue: NonNullable<StoryboardShot['music']>; from: number; to: number }[] = []
          shots.forEach((_, i) => {
            const c = activeCueAt(i)
            if (!c || c.status !== 'done' || !c.url) return
            const last = segs.at(-1)
            if (last && last.cue.id === c.id && last.to === i - 1) last.to = i
            else segs.push({ cue: c, from: i, to: i })
          })
          if (segs.length) {
            const speech = (work.voice?.length ?? 0) + (work.lane?.length ?? 0) > 0
            const end = work.cutSeconds ?? 0
            work.cues = segs.map((g, k) => {
              const startSec = g.from === 0 ? 0 : (work.starts?.[g.from] ?? 0)
              const endSec = g.to === shots.length - 1 ? end : Math.min(end, (work.starts?.[g.to + 1] ?? end) + 0.6)
              return { url: g.cue.url!, startSec, endSec, gainDb: g.cue.gainDb ?? (speech ? -15 : -10), fadeInSec: k === 0 ? 1 : 0.6, fadeOutSec: k === segs.length - 1 ? 2.5 : 1 }
            })
            work.musicUrl = null
            setPhase('mix', 'Mixing and mastering')
            break
          }
          work.musicNote = [work.musicNote, 'no music cues were recorded on the board - the AI scored it'].filter(Boolean).join('; ')
        }
        // A revision keeps the last version's score unless its edits need a new one
        const keep = baseOf(job)?.parts?.musicUrl
        if (!work.musicRequestId && job.revise && !job.revise.rescore && keep) {
          work.musicUrl = keep
          setPhase('mix', 'Mixing and mastering')
          break
        }
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
        const narrated = (work.voice?.length ?? 0) + (work.lane?.length ?? 0) > 0
        const lvl = work.plan?.musicLevel ?? 0
        const music = (work.cues?.length ? work.cues : work.musicUrl ? [{ url: work.musicUrl, gainDb: narrated ? -15 : -10, fadeInSec: 0.5, fadeOutSec: 2.5 }] : [])
          .map(m => ({ ...m, gainDb: Math.max(-36, Math.min(0, m.gainDb + lvl)) }))
        const voice = [...(work.voice ?? []), ...(work.lane ?? [])].map(v => ({ url: v.url, atSec: v.atSec, gainDb: 2 })).slice(0, 8)
        if (music.length || voice.length) {
          const mixed = await assemble({ op: 'mux', videoUrl: work.cutUrl, music, voice, normalize: true })
          work.mixUrl = canonicalMediaUrl(String(mixed.url))
        } else work.mixUrl = work.cutUrl
        // Narration as burned-in captions, timed to where each take was placed
        if (job.options.captions && ((work.voice?.length && work.takes?.length) || work.lane?.length)) {
          const lines = [...work.plan!.narration].sort((a, b) => a.shot - b.shot)
          const caps = [...(work.voice ?? []).map((v, i) => {
            const take = work.takes?.[i]
            const line = lines.find(l => l.shot === take?.shot)
            return line && take ? { text: line.text, startSec: v.atSec, endSec: v.atSec + Math.max(1.2, take.seconds) } : null
          }), ...(work.lane ?? []).map(l => ({ text: l.text, startSec: l.atSec, endSec: l.atSec + Math.max(1.2, l.seconds) }))]
            .filter((c): c is NonNullable<typeof c> => !!c).sort((a, b) => a.startSec - b.startSec)
          if (caps.length) {
            const c = await assemble({ op: 'captions', videoUrl: work.mixUrl, captions: caps, position: 'bottom' }).catch(() => null)
            if (c?.url) work.mixUrl = canonicalMediaUrl(String(c.url))
          }
        }
        setPhase(nextPhase('mix', skipNow), skipNow.includes('review') ? 'Saving the cut' : work.revised ? 'The critic is checking the revision' : 'The critic is watching the cut')
        break
      }
      case 'review': {
        // The critic watches labelled frames - the middle of the title card, of every
        // shot and of the end card (evenly spaced frames landed on the fades and
        // made it report a "missing" end card) - and reads the measured sound
        const labelled: { at: number; label: string }[] = []
        if (work.titleCard) labelled.push({ at: 1.8, label: 'title card' })
        ;(work.starts ?? []).forEach((st0, i) => labelled.push({ at: st0 + (work.plan!.shots[i]?.keepSeconds ?? 2) / 2, label: `shot ${i + 1}` }))
        if (work.endCard && work.cutSeconds) labelled.push({ at: work.cutSeconds - 1.5, label: 'end card' })
        const picks = labelled.length > 9 ? labelled.filter((_, i) => i % Math.ceil(labelled.length / 9) === 0) : labelled
        const rep = await inspectMedia(work.mixUrl!, 'video', { at: picks.map(p => p.at), maxFrameSide: 640 })
        const facts = [
          rep.durationSec ? `${rep.durationSec.toFixed(1)}s` : '',
          rep.loudness?.integratedLufs != null ? `${rep.loudness.integratedLufs.toFixed(1)} LUFS` : '',
          `frames, in order: ${picks.map(p => `${p.label} (${p.at.toFixed(1)}s)`).join(', ')}`,
          ...rep.notes,
        ].filter(Boolean)
        const brief = [
          `A ${boardMode(board.mode).label.toLowerCase()} titled "${cutBoard.title}". Story: ${cutBoard.story}`,
          board.look ? `Look: ${board.look}` : '',
          `Frame ${board.aspect}. ${job.options.cards ? `It opens on a title card${work.endCard ? ' and ends on an end card' : ''} - each fades in from / out to black on purpose; do not count those fades as faults.` : 'No title or end cards.'} ${job.options.narration ? 'It has a narrator.' : 'No narration.'}${work.lane?.length ? ` It has ${work.lane.length} recorded voice line(s) placed on their shots.` : ''}${job.options.captions ? ' Speech is captioned.' : ''} ${work.cues?.length ? `It is scored with ${work.cues.length} music cue(s) from the board.` : work.musicUrl ? 'It has a music score.' : 'No score.'}`,
          `The film is cut from the ${shots.length} shot(s) on this board only. The story text may describe more than these shots show - judge the edit of THESE shots, never ask for scenes that were not filmed.`,
          'Judge it as a finished film: story clarity, pacing and trims (dead or dark moments, a shot that runs too long), transitions, card text, narration timing and the sound mix.',
          'Only ask for fixes an EDIT can make (trims, timing, order of emphasis, transitions, card wording, narration lines) - not reshoots.',
        ].filter(Boolean).join('\n')
        const out = await critique({
          model: NOVA_CRITIC_MODEL, brief,
          items: [{ id: 0, kind: 'cut', model: 'storyboard-final-cut', prompt: cutBoard.title, pictures: (rep.frames ?? []).map(f => ({ mime: 'image/jpeg', data: Buffer.from(f.jpeg).toString('base64') })), facts }],
        })
        work.review = { verdict: out.critique.verdict, score: out.critique.score, summary: out.critique.summary, issues: out.critique.issues.map(i => `${i.problem} -> ${i.fix}`).slice(0, 6) }
        if (out.critique.verdict === 'revise' && !work.revised && work.review.issues.length) {
          // ONE revision: re-plan with the notes, re-cut, re-mix - reusing the score and designed cards
          work.revised = true
          // (board music is only re-placed - free - so it follows the new timing)
          work.reviseSkip = [...(job.options.score === 'board' ? [] : ['score' as const]), ...(job.options.cardStyle === 'exact' ? [] : ['cards' as const])]
          setPhase('plan', `Revising the edit (the critic: ${out.critique.score}/10)`)
        } else setPhase('save', 'Saving the cut')
        break
      }
      case 'formats': {
        // The same film in other shapes, each its own feed row in the board's folder
        const v = st.versions.at(-1)
        if (!v) { setPhase(null, 'Done'); break }
        const folderId = await boardFolder(user.id, board.title)
        const made: NonNullable<typeof v.formats> = []
        for (const aspect of job.options.formats ?? []) {
          try {
            const out = await assemble({ op: 'conform', videoUrl: v.url, aspect })
            const row = await prisma.generatedImage.create({ data: {
              userId: user.id, prompt: `${cutBoard.title} - Final Cut ${v.n} (${aspect})`, imageUrl: canonicalMediaUrl(String(out.url)), model: 'storyboard-final-cut', ticketCost: 0, referenceImageUrls: [],
              folderId, expiresAt: new Date(now() + 100 * 365 * 24 * 3600 * 1000), quality: job.options.resolution, aspectRatio: aspect,
              videoMetadata: { isVideo: true, duration: String(Math.round(v.durationSec)), thumbnailUrl: v.posterUrl ?? null, width: out.width, height: out.height },
            } })
            made.push({ aspect, url: canonicalMediaUrl(String(out.url)), imageId: row.id })
          } catch { /* one shape failing does not undo the others */ }
        }
        st.versions = st.versions.map(x => (x.n === v.n ? { ...x, formats: made } : x))
        setPhase(null, `${work.ready ?? `Final Cut ${v.n} is ready`}${made.length ? ` - also in ${made.map(m => m.aspect).join(', ')}` : ''}`)
        st.work = {}
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
          userId: user.id, prompt: `${cutBoard.title} - Final Cut ${n} (Storyboard Studio). ${cutBoard.story}`.slice(0, 5000),
          imageUrl: work.mixUrl!, model: 'storyboard-final-cut', ticketCost: 0, referenceImageUrls: [],
          folderId: await boardFolder(user.id, board.title),
          expiresAt: new Date(now() + 100 * 365 * 24 * 3600 * 1000), quality: job.options.resolution, aspectRatio: board.aspect,
          videoMetadata: { isVideo: true, duration: String(Math.round(work.cutSeconds ?? 0)), thumbnailUrl: poster },
        } })
        st.versions = [...st.versions, {
          n, url: work.mixUrl!, durationSec: Math.round((work.cutSeconds ?? 0) * 10) / 10, at: now(), imageId: row.id, posterUrl: poster, scene: sceneLabel,
          note: [
            job.revise ? `revision of ${job.revise.from}` : '',
            job.options.cards ? (job.options.cardStyle === 'exact' ? 'exact-text cards' : 'cards') : 'no cards',
            job.options.narration ? `narrated (${job.options.voice})` : '',
            work.lane?.length ? `${work.lane.length} voice line${work.lane.length === 1 ? '' : 's'}` : '',
            !job.options.narration && !work.lane?.length ? 'no voices' : '',
            job.options.captions ? 'captioned' : '',
            work.cues?.length ? 'board music' : work.musicUrl ? 'scored' : 'no score',
          ].filter(Boolean).join(' · '),
          review: work.review ? { ...work.review, revised: !!work.revised } : null,
          options: job.options,
          parts: { plan: work.plan, musicUrl: work.musicUrl ?? null, titleCard: work.titleCard ?? null, endCard: work.endCard ?? null },
          revisedFrom: job.revise?.from ?? null,
          ...(job.revise ? { edits: job.revise.edits } : {}),
        }]
        // The edit list it made is done with
        if (job.revise) st.revision = null
        const ready = `${sceneLabel ? `${sceneLabel}: ` : ''}${work.musicNote ? `Final Cut ${n} is ready - ${work.musicNote}` : `Final Cut ${n} is ready`}${work.review ? ` · critic ${work.review.score}/10${work.revised ? ' after one revision' : ''}` : ''}`
        const next = nextPhase('save', skipNow)
        if (next) { work.ready = ready; setPhase(next, `${ready} - making the other formats`) }
        else { setPhase(null, ready); st.work = {} }
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
