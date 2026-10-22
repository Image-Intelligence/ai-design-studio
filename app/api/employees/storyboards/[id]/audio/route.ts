import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { withShotsLock } from '@/lib/storyboard-store'
import { boardFolder } from '@/lib/storyboard-shoot'
import { AUDIO_MODEL_PREFIX, getAudioStudioModel, audioTicketCost, spokenCharCount } from '@/lib/audio-studio'
import {
  sanitizeShots, liveAudio, musicSpanSeconds, newVoiceLine, newMusicCue, MAX_LINES_PER_SHOT, lineVoice,
  STORYBOARD_VOICE_MODELS, STORYBOARD_MUSIC_MODELS, type VoiceLine, type MusicCue,
} from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/audio - the board's audio lane.
 *
 *   { kind: 'line', shotId, line: { id?, speaker, text, voice, model, offset } }
 *       voice one line spoken over a shot (dialogue or voice-over) -> { line }
 *   { kind: 'music', shotId, cue: { id?, prompt, model, gainDb? } }
 *       compose the cue - music, or ambience / effects with a sound model
 *       (2026-10-21) - that starts on that shot and runs to the next
 *       cue (lib/storyboard musicSpanSeconds sets its length) -> { cue }
 *
 * The line / cue is written onto the shot here, under the row lock (lib/
 * storyboard-store) - "making" first, so every session shows it and a second
 * press is refused, then the recording. The page owns the words; the
 * recording is the server's (the autosave merge keeps it). Each recording is
 * re-hosted on R2 and saved to My Generations > Storyboards > <title> as an
 * audio row, like the Audio Studio's.
 *
 * Priced as the Audio Studio prices the same model (lib/audio-studio
 * audioTicketCost), charged before it runs and refunded if it fails; admins
 * are not charged. The prompt passes the CCBill filter.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

const failText = (e: any) => {
  const detail = e?.body?.detail
  return Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : String(e?.message || e)
}

/** Write one shot's line / cue under the row lock; `fn` gets the shot and returns its new fields (null = nothing). */
async function writeShot(boardId: number, shotId: string, fn: (s: ReturnType<typeof sanitizeShots>[number]) => Record<string, unknown> | null) {
  let found = false
  await withShotsLock(boardId, shots => {
    const i = shots.findIndex(s => s.id === shotId)
    if (i < 0) return null
    const patch = fn(shots[i])
    if (!patch) return null
    found = true
    const next = [...shots]
    next[i] = { ...shots[i], ...patch }
    return { shots: next }
  })
  return found
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const shots = sanitizeShots(board.shots)
  const shot = shots.find(s => s.id === body.shotId)
  if (!shot) return jsonPrivate({ error: 'That shot is not on the board (save first?)' }, { status: 404 })

  const kind = body.kind === 'music' ? 'music' : 'line'
  // ── what to record ──
  let text = ''
  let spec: ReturnType<typeof getAudioStudioModel>
  let cost = 0
  let input: Record<string, unknown>
  let line: VoiceLine | null = null
  let cue: MusicCue | null = null
  if (kind === 'line') {
    const l = body.line ?? {}
    text = String(l.text ?? '').trim().slice(0, 600)
    if (!text) return jsonPrivate({ error: 'Write the line first' }, { status: 400 })
    const model = STORYBOARD_VOICE_MODELS.some(m => m.id === l.model) ? String(l.model) : 'eleven-v4'
    spec = getAudioStudioModel(model)
    // The model's own length limit (Chatterbox Multilingual takes 300 characters), before anything is charged
    if (spec?.text && text.length > spec.text.max) return jsonPrivate({ error: `${spec.name} takes lines up to ${spec.text.max} characters - shorten it or pick another voice model` }, { status: 400 })
    // One of THIS model's voices (2026-10-22: the lane has models beyond
    // ElevenLabs - an ElevenLabs name sent to Kokoro would be refused by fal)
    const voice = lineVoice(model, String(l.voice ?? ''))
    const prev = (shot.lines ?? []).find(x => x.id === l.id)
    if (prev && liveAudio(prev) === 'making') return jsonPrivate({ error: 'This line is being recorded already', busy: true }, { status: 409 })
    if (!prev && (shot.lines?.length ?? 0) >= MAX_LINES_PER_SHOT) return jsonPrivate({ error: `A shot takes up to ${MAX_LINES_PER_SHOT} lines` }, { status: 400 })
    line = newVoiceLine({
      ...(prev ?? {}), id: typeof l.id === 'string' && l.id ? l.id.slice(0, 64) : undefined,
      speaker: String(l.speaker ?? prev?.speaker ?? 'Narrator').slice(0, 60) || 'Narrator', text, voice, model,
      offset: Number.isFinite(Number(l.offset)) ? Math.max(0, Math.min(30, Number(l.offset))) : prev?.offset ?? 0.3,
    })
    cost = audioTicketCost(spec!, { chars: text.length, spokenChars: spokenCharCount(text) })
    input = spec!.build({ text, voice })
  } else {
    const c = body.cue ?? {}
    text = String(c.prompt ?? '').trim().slice(0, 1500)
    if (!text) return jsonPrivate({ error: 'Describe the music or sound first' }, { status: 400 })
    const model = STORYBOARD_MUSIC_MODELS.some(m => m.id === c.model) ? String(c.model) : 'sonilo-music'
    spec = getAudioStudioModel(model)
    if (shot.music && liveAudio(shot.music) === 'making') return jsonPrivate({ error: 'This cue is being composed already', busy: true }, { status: 409 })
    // As long as the stretch of board it plays under (to the next cue), within the model's range
    const span = musicSpanSeconds(shots, shot.id)
    const range = spec!.duration
    const seconds = range ? Math.max(range.min, Math.min(range.max, span)) : span
    const g = Number(c.gainDb)
    cue = newMusicCue({
      ...(shot.music ?? {}), id: typeof c.id === 'string' && c.id ? c.id.slice(0, 64) : shot.music?.id, prompt: text, model,
      ...(c.gainDb != null && Number.isFinite(g) ? { gainDb: Math.max(-30, Math.min(0, g)) } : {}),
    })
    cost = audioTicketCost(spec!, { chars: text.length, seconds })
    // A film cue: instrumental unless the prompt asks for a voice
    input = spec!.build({ text, duration: seconds, instrumental: !/\b(vocal|sing|singer|lyrics|choir)\b/i.test(text) })
  }
  if (!spec) return jsonPrivate({ error: 'That model is not available' }, { status: 400 })
  if (spec.admin && !user.isAdmin) return jsonPrivate({ error: 'That model is not available' }, { status: 403 })
  {
    const cf = await enforceContentFilter(text, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }

  // Marked "making" on the shot (every session sees it), then paid for
  const startAt = Date.now()
  const making = kind === 'line'
    ? (s: ReturnType<typeof sanitizeShots>[number]) => {
        const list = [...(s.lines ?? [])]
        const k = list.findIndex(x => x.id === line!.id)
        const v = { ...line!, status: 'making' as const, at: startAt, error: null }
        if (k >= 0) list[k] = { ...list[k], ...v, url: list[k].url, seconds: list[k].seconds }; else list.push(v)
        return { lines: list.slice(0, MAX_LINES_PER_SHOT) }
      }
    : () => ({ music: { ...cue!, status: 'making' as const, at: startAt, error: null } })
  if (!(await writeShot(board.id, shot.id, making))) return jsonPrivate({ error: 'That shot is gone' }, { status: 404 })
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  const settle = (fields: Partial<VoiceLine & MusicCue>) => writeShot(board.id, shot.id, s => {
    if (kind === 'line') {
      const list = [...(s.lines ?? [])]
      const k = list.findIndex(x => x.id === line!.id)
      if (k < 0) return null
      list[k] = { ...list[k], ...(fields as Partial<VoiceLine>) }
      return { lines: list }
    }
    if (!s.music || s.music.id !== cue!.id) return null
    return { music: { ...s.music, ...(fields as Partial<MusicCue>) } }
  })
  if (!paid.ok) {
    await settle({ status: 'failed', error: `Needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}` })
    return jsonPrivate({ error: `This needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })
  }

  try {
    const out: any = await fal.subscribe(spec.endpoint, { input })
    const file = spec.outputs(out?.data)[0]
    if (!file?.url) throw new Error('The model returned no audio')
    const res = await fetch(file.url)
    if (!res.ok) throw new Error(`Could not fetch the audio (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') ?? 'audio/mpeg'
    const ext = ct.includes('wav') ? 'wav' : ct.includes('flac') ? 'flac' : 'mp3'
    const url = await uploadToR2(`audio-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, buf, ct.startsWith('audio/') ? ct : 'audio/mpeg')
    // Measured - the lane is drawn, and the Final Cut places it, by its real length
    const { probeRemoteMediaSeconds } = await import('@/lib/video-probe')
    const seconds = Math.round(((await probeRemoteMediaSeconds(url).catch(() => null)) ?? (kind === 'line' ? text.split(/\s+/).length / 2.6 : 30)) * 100) / 100
    await prisma.generatedImage.create({
      data: {
        userId: user.id, prompt: kind === 'line' ? `${line!.speaker}: ${text}` : text, imageUrl: url, model: `${AUDIO_MODEL_PREFIX}${spec.id}`,
        ticketCost: user.isAdmin ? 0 : cost, referenceImageUrls: [], folderId: await boardFolder(user.id, board.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        videoMetadata: { isAudio: true, label: kind === 'line' ? `Voice line - ${line!.speaker}` : 'Music cue', modelName: spec.name, provider: spec.provider, voice: line?.voice ?? null, durationSec: seconds },
      },
    })
    const done = kind === 'line'
      ? { status: 'done' as const, url, seconds, error: null, at: Date.now(), madeText: text, madeVoice: line!.voice }
      : { status: 'done' as const, url, seconds, error: null, at: Date.now(), madePrompt: text }
    await settle(done)
    const fresh = sanitizeShots((await prisma.storyboard.findUnique({ where: { id: board.id }, select: { shots: true } }))?.shots).find(s => s.id === shot.id)
    return jsonPrivate({
      ...(kind === 'line' ? { line: fresh?.lines?.find(x => x.id === line!.id) ?? { ...line, ...done } } : { cue: fresh?.music ?? { ...cue, ...done } }),
      tickets: user.isAdmin ? 0 : cost, ...(paid.newBalance >= 0 ? { balance: paid.newBalance } : {}),
    })
  } catch (e) {
    await refundGenerationTickets(user.id, user.email, cost)
    const error = `${spec.name} failed: ${failText(e).slice(0, 240)}`
    await settle({ status: 'failed', error })
    return jsonPrivate({ error }, { status: 502 })
  }
}
