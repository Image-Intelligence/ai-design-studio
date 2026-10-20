/**
 * Nova Studio - post-production and research tools (server only, 2026-10-19,
 * owner: "everything except 6" from the gaps report).
 *
 *  - assemble_cut (rebuilt here from lib/nova/agent-tools-pro) + recut: every
 *    cut keeps its whole EDIT LIST (clips, trims, transitions, sound, captions,
 *    overlays, colour) on its row, so "make shot 3 shorter" or "lower the
 *    music" changes just that and re-renders - instead of Nova rebuilding the
 *    cut from memory. New in the cut:
 *      match_color   every clip's colour moved toward the first one (or the
 *                    one named), so shots from different renders sit together
 *      look          a finishing grade over the whole cut (warm, filmic...)
 *      overlays      titles, lower thirds and logos on the video, with fades
 *                    (drawn by lib/nova/image-edit on a frame-sized layer)
 *      auto_captions word-timed captions from what is actually said in the
 *                    mix (ElevenLabs Scribe v2 on fal, $0.008 a minute)
 *  - trim_media: trim / speed / mute / fade / level one clip or sound, free.
 *  - watch_video: the strong model WATCHES clips with their sound and answers.
 *  - web_search: Google Search grounding (brands, references, facts).
 *  - learn_about_model: Nova keeps a lesson about a model (lib/nova/lessons).
 *
 * Same rules as the other tool sets: media by id and ownership-checked,
 * spending through guard(), results filed in the chat's folder.
 */
import { tool, jsonSchema, type ToolSet } from 'ai'
import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { fal } from '@/lib/fal-client'
import { geminiGenerate, geminiText, type GeminiRequest } from '@/lib/gemini-generate'
import { inspectMedia, type MediaReport } from '@/lib/nova/media-inspect'
import { editImage, type EditOp } from '@/lib/nova/image-edit'
import { withClip, withMedia, trimMedia, colourStats, matchFilter, filterClip, overlayLayers, watchableVideo, LOOKS } from '@/lib/nova/video-ops'
import { addLesson } from '@/lib/nova/lessons'
import { NOVA_CRITIC_MODEL, NOVA_ROUTES, novaCutTickets, novaChatUsd } from '@/lib/nova/config'
import {
  guard, settleSpend, newStep, update, ownedRows, kindOf, withPictures, assemble, clip, secondsOf,
  type NovaTurnCtx, type Row,
} from '@/lib/nova/agent-tools'

fal.config({ credentials: process.env.FAL_KEY })

const ids = { type: 'array', items: { type: 'integer' }, description: 'My Generations ids (the numbers after #)' } as const
const FOREVER = () => new Date(Date.now() + 100 * 365 * 864e5)
const TMP = (ext: string) => `nova-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

function facts(r: MediaReport): string[] {
  const f: string[] = []
  if (r.durationSec) f.push(`${r.durationSec.toFixed(1)}s`)
  if (r.width && r.height) f.push(`${r.width}x${r.height}`)
  if (r.loudness?.integratedLufs != null) f.push(`${r.loudness.integratedLufs.toFixed(1)} LUFS`)
  if (r.loudness?.truePeakDb != null) f.push(`peak ${r.loudness.truePeakDb.toFixed(1)} dB`)
  return [...f, ...r.notes]
}
const framesToParts = (r: MediaReport) => (r.frames ?? []).map(fr => ({ type: 'file' as const, data: { type: 'data' as const, data: fr.jpeg }, mediaType: 'image/jpeg' }))

// ── The edit list ─────────────────────────────────────────────────────────────

const TRANSITIONS = ['cut', 'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'slideup', 'smoothleft', 'smoothright', 'circleopen', 'zoomin'] as const
export type Overlay = {
  text?: string; logo_id?: number; start_sec?: number; end_sec?: number
  x?: number; y?: number; size?: number; width?: number; color?: string; weight?: 'regular' | 'bold' | 'black'
  align?: 'left' | 'center' | 'right'; box?: boolean; font?: 'sans' | 'serif' | 'display'; fade_sec?: number
}
export type Edl = {
  title: string
  clips: { id: number; trim_start?: number; trim_end?: number; card_seconds?: number; transition?: string; transition_sec?: number }[]
  aspect?: string
  music?: { id: number; start_sec?: number; end_sec?: number; gain_db?: number; fade_in_sec?: number; fade_out_sec?: number }[]
  voice?: { id: number; at_sec: number; gain_db?: number }[]
  sfx?: { id: number; at_sec: number; gain_db?: number }[]
  captions?: { text: string; start_sec: number; end_sec: number }[]
  captions_position?: 'bottom' | 'top'
  auto_captions?: boolean
  normalize?: boolean
  match_color?: boolean | number
  look?: string
  overlays?: Overlay[]
}
const EDL_PROPS = {
  title: { type: 'string' },
  clips: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, trim_start: { type: 'number' }, trim_end: { type: 'number' }, card_seconds: { type: 'number', description: 'IMAGE clips: seconds on screen (1-10)' }, transition: { type: 'string', enum: [...TRANSITIONS], description: 'Into THIS clip (ignored on the first)' }, transition_sec: { type: 'number' } }, required: ['id'] } },
  aspect: { type: 'string', description: '16:9, 9:16, 1:1 or 4:5' },
  music: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, start_sec: { type: 'number' }, end_sec: { type: 'number' }, gain_db: { type: 'number', description: 'Default -14 under voice, -6 alone' }, fade_in_sec: { type: 'number' }, fade_out_sec: { type: 'number' } }, required: ['id'] } },
  voice: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, at_sec: { type: 'number' }, gain_db: { type: 'number' } }, required: ['id', 'at_sec'] } },
  sfx: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, at_sec: { type: 'number' }, gain_db: { type: 'number', description: 'Default -6; keep effects about 3 LU under the voices (around -9)' } }, required: ['id', 'at_sec'] } },
  captions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, start_sec: { type: 'number' }, end_sec: { type: 'number' } }, required: ['text', 'start_sec', 'end_sec'] } },
  captions_position: { type: 'string', enum: ['bottom', 'top'] },
  auto_captions: { type: 'boolean', description: 'Word-timed captions of everything SPOKEN in the finished mix (voiceover, dialogue, talking shots) - replaces hand-written captions' },
  normalize: { type: 'boolean', description: 'Level the mix to -14 LUFS (default true)' },
  match_color: { description: 'true: match every clip\'s colour to the FIRST clip; a number: to that clip id. For shots from different renders that should look like one film' },
  look: { type: 'string', enum: Object.keys(LOOKS), description: 'A finishing grade over the whole cut' },
  overlays: { type: 'array', description: 'Titles, lower thirds, end-card text and logos ON the video', items: { type: 'object', properties: {
    text: { type: 'string', description: 'Exact words (or use logo_id)' }, logo_id: { type: 'integer', description: 'An image of the user\'s (a logo / cut-out) placed on the video' },
    start_sec: { type: 'number' }, end_sec: { type: 'number' }, x: { type: 'number', description: '% across (default 50)' }, y: { type: 'number', description: '% down (default 85 = lower third)' },
    size: { type: 'number', description: 'Text height, % of the frame height (default 6)' }, width: { type: 'number', description: 'Logo width, % of the frame width (default 18)' },
    color: { type: 'string' }, weight: { type: 'string', enum: ['regular', 'bold', 'black'] }, align: { type: 'string', enum: ['left', 'center', 'right'] },
    box: { type: 'boolean', description: 'A dark box behind the text' }, font: { type: 'string', enum: ['sans', 'serif', 'display'] }, fade_sec: { type: 'number', description: 'Default 0.3' },
  } } },
} as const

/** What is said in a finished mix, as word timings (ElevenLabs Scribe v2 on fal). */
async function spokenWords(videoUrl: string): Promise<{ words: { text: string; start: number; end: number }[]; usd: number }> {
  const audio = await withMedia(videoUrl, async (file, dir, p) => {
    const { readFile } = await import('fs/promises')
    const { default: path } = await import('path')
    const { execFile } = await import('node:child_process')
    const ffmpegPath = (await import('ffmpeg-static')).default as unknown as string
    const out = path.join(dir, 'speech.mp3')
    await new Promise<void>((res, rej) => execFile(ffmpegPath, ['-hide_banner', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', out], { timeout: 120_000 }, e => (e ? rej(e) : res())))
    return { buf: await readFile(out), seconds: p.seconds }
  })
  const url = await fal.storage.upload(new Blob([new Uint8Array(audio.buf)], { type: 'audio/mpeg' }))
  const r = await fal.subscribe('fal-ai/elevenlabs/speech-to-text/scribe-v2', { input: { audio_url: url, tag_audio_events: false } }) as { data?: { words?: { text?: string; start?: number; end?: number; type?: string }[] } }
  const words = (r.data?.words ?? []).filter(w => w.type === 'word' && w.text?.trim() && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end))).map(w => ({ text: w.text!.trim(), start: Number(w.start), end: Number(w.end) }))
  return { words, usd: Math.max(0.001, (audio.seconds / 60) * 0.008) }
}

/** Words -> short caption chunks (up to 4 words / 1.8s, breaking at punctuation and pauses). */
function chunkWords(words: { text: string; start: number; end: number }[]): { text: string; startSec: number; endSec: number }[] {
  const out: { text: string; startSec: number; endSec: number }[] = []
  let cur: typeof words = []
  const flush = () => { if (cur.length) out.push({ text: cur.map(w => w.text).join(' '), startSec: cur[0].start, endSec: Math.max(cur[0].start + 0.4, cur[cur.length - 1].end + 0.08) }); cur = [] }
  for (const w of words) {
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0
    if (cur.length && (cur.length >= 4 || w.end - cur[0].start > 1.8 || gap > 0.45)) flush()
    cur.push(w)
    if (/[.!?,;:]$/.test(w.text)) flush()
  }
  flush()
  // A chunk too short to read (under 0.8s) joins the next one when they are close - a caption that
  // flashed for half a second went unseen (2026-10-19 test)
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1]
    if (a.endSec - a.startSec < 0.8 && b.startSec - a.endSec < 0.5 && (a.text + ' ' + b.text).split(' ').length <= 7) {
      out.splice(i, 2, { text: `${a.text} ${b.text}`, startSec: a.startSec, endSec: b.endSec }); i--
    }
  }
  // Every caption stays up long enough to read, but never over the next one
  for (let i = 0; i < out.length; i++) {
    out[i].endSec = Math.max(out[i].endSec, out[i].startSec + 0.9)
    if (i < out.length - 1) out[i].endSec = Math.min(out[i].endSec, out[i + 1].startSec)
  }
  return out.slice(0, 120)
}

/** Render a cut from its edit list: colour, stitch, sound, captions, overlays - saved with the list for recut. */
export async function runCut(ctx: NovaTurnCtx, edl: Edl, opts: { label: string; recutOf?: number }): Promise<Record<string, unknown>> {
  const uid = ctx.user.id
  const clipRows = await ownedRows(uid, (edl.clips ?? []).map(c => c.id))
  if (!clipRows.length) return { error: 'None of those clips are the user\'s' }
  const byId = new Map(clipRows.map(r => [r.id, r]))
  const aspect = ['16:9', '9:16', '1:1', '4:5'].includes(String(edl.aspect)) ? String(edl.aspect) : '16:9'
  const [aw, ah] = aspect.split(':').map(Number)
  const W = aw >= ah ? 1280 : Math.round(1280 * aw / ah / 2) * 2, H = aw >= ah ? Math.round(1280 * ah / aw / 2) * 2 : 1280
  const planned = (edl.clips ?? []).slice(0, 16).map(c => ({ c, r: byId.get(c.id) })).filter((x): x is { c: Edl['clips'][number]; r: Row } => !!x.r && ['video', 'image', 'cut'].includes(kindOf(x.r)))
  if (!planned.length) return { error: 'No usable clips (videos, cuts or images) among those ids' }
  const estSec = planned.reduce((s, { c, r }) => s + (kindOf(r) === 'image' ? Math.min(10, Math.max(1, Number(c.card_seconds) || 3)) : secondsOf(r)), 0)
  // The extra passes (colour, overlays, captions) are our own ffmpeg time too: +1 ticket each
  const extras = (edl.match_color ? 1 : 0) + ((edl.overlays?.length || edl.look) ? 1 : 0) + (edl.auto_captions ? 1 : 0)
  const est = novaCutTickets(estSec) + extras
  const refused = guard(ctx, est)
  if (refused) return { error: refused }
  const step = newStep(ctx, { tool: opts.recutOf ? 'recut' : 'assemble_cut', kind: 'cut', label: opts.label, status: 'running', tickets: est })
  const notes: string[] = []
  try {
    // 1. colour: every video clip toward the reference clip
    const urlOf = new Map<number, string>()
    if (edl.match_color) {
      const vids = planned.filter(p => kindOf(p.r) !== 'image')
      const refRow = typeof edl.match_color === 'number' ? byId.get(edl.match_color) ?? vids[0]?.r : vids[0]?.r
      const ref = refRow ? await colourStats(refRow.imageUrl) : null
      if (ref) {
        let moved = 0
        for (const { r } of vids) {
          if (r.id === refRow!.id || urlOf.has(r.id)) continue
          const st = await colourStats(r.imageUrl)
          const vf = st ? matchFilter(st, ref) : null
          if (!vf) continue
          const buf = await withClip(r.imageUrl, (file, dir, p) => filterClip(file, dir, p, vf))
          urlOf.set(r.id, await uploadToR2(TMP('mp4'), buf, 'video/mp4'))
          moved++
        }
        notes.push(`colour matched ${moved} clip${moved === 1 ? '' : 's'} to #${refRow!.id}`)
      }
    }
    // 2. picture: clips and cards in order, with their transitions
    const clips: Record<string, unknown>[] = []
    for (const [i, { c, r }] of planned.entries()) {
      const t = i > 0 && c.transition && c.transition !== 'cut' ? { transition: { type: c.transition, durationSec: Math.min(2, Math.max(0.2, Number(c.transition_sec) || 0.5)) } } : {}
      if (kindOf(r) === 'image') {
        const card = await assemble({ op: 'card', imageUrl: r.imageUrl, seconds: Math.min(10, Math.max(1, Number(c.card_seconds) || 3)), width: W, height: H })
        clips.push({ url: card.url, ...t })
      } else {
        clips.push({ url: urlOf.get(r.id) ?? r.imageUrl, ...(Number(c.trim_start) > 0 ? { trimStart: Number(c.trim_start) } : {}), ...(Number(c.trim_end) > 0 ? { trimEnd: Number(c.trim_end) } : {}), ...t })
      }
    }
    const stitched = await assemble({ op: 'stitch', clips, aspect, fps: 24, width: W })
    let url: string = stitched.url, seconds = Number(stitched.durationSec) || estSec
    // 3. sound: every cue by id, the user's own audio only
    const audioIds = [...(edl.music ?? []), ...(edl.voice ?? []), ...(edl.sfx ?? [])].map(x => x.id)
    const audio = new Map((await ownedRows(uid, audioIds)).filter(r => kindOf(r) === 'audio').map(r => [r.id, r]))
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
    const voice = (edl.voice ?? []).filter(v => audio.has(v.id)).map(v => ({ url: audio.get(v.id)!.imageUrl, atSec: Math.max(0, num(v.at_sec, 0)), gainDb: num(v.gain_db, 0) }))
    const music = (edl.music ?? []).filter(m => audio.has(m.id)).map(m => ({
      url: audio.get(m.id)!.imageUrl, gainDb: num(m.gain_db, voice.length ? -14 : -6),
      ...(m.start_sec != null ? { startSec: Math.max(0, num(m.start_sec, 0)) } : {}), ...(m.end_sec != null ? { endSec: num(m.end_sec, seconds) } : {}),
      fadeInSec: Math.max(0, num(m.fade_in_sec, 0.5)), fadeOutSec: Math.max(0, num(m.fade_out_sec, 2)),
    }))
    const sfx = (edl.sfx ?? []).filter(x => audio.has(x.id)).map(x => ({ url: audio.get(x.id)!.imageUrl, atSec: Math.max(0, num(x.at_sec, 0)), gainDb: num(x.gain_db, -6) }))
    if (music.length || voice.length || sfx.length) {
      const mixed = await assemble({ op: 'mux', videoUrl: url, normalize: edl.normalize !== false, ...(music.length ? { music } : {}), ...(voice.length ? { voice } : {}), ...(sfx.length ? { sfx } : {}) })
      url = mixed.url; seconds = Number(mixed.durationSec) || seconds
    }
    // 4. captions: hand-written, or word-timed from what is said in the mix
    let caps = (edl.captions ?? []).filter(c => c.text?.trim()).slice(0, 60).map(c => ({ text: clip(c.text, 200), startSec: Math.max(0, num(c.start_sec, 0)), endSec: Math.max(0.2, num(c.end_sec, num(c.start_sec, 0) + 2)) }))
    if (edl.auto_captions) {
      try {
        const heard = await spokenWords(url)
        ctx.extraUsd += heard.usd
        if (heard.words.length) { caps = chunkWords(heard.words); notes.push(`${caps.length} word-timed captions`) }
        else notes.push('auto captions: nothing spoken was found')
      } catch (e: any) { notes.push(`auto captions failed: ${String(e?.message || e).slice(0, 80)}`) }
    }
    /*
     * 5. captions, overlays (titles, lower thirds, logos) and the finishing look,
     * in ONE pass. Captions are drawn like the titles - a text layer each, by
     * lib/nova/image-edit with the machine's real fonts, word-wrapped to the
     * frame - not by ffmpeg's drawtext, which fell back to a typewriter face
     * and could not wrap (a 28-letter line ran off a 9:16 frame).
     */
    const overlays = (edl.overlays ?? []).slice(0, 12)
    const capTop = edl.captions_position === 'top'
    if (caps.length || overlays.length || (edl.look && LOOKS[edl.look])) {
      const logos = new Map((await ownedRows(uid, overlays.map(o => o.logo_id).filter((v): v is number => !!v))).filter(r => kindOf(r) === 'image').map(r => [r.id, r]))
      const buf = await withClip(url, async (file, dir, p) => {
        const layers: { png: Buffer; start: number; end: number; fade: number }[] = []
        for (const c of caps.slice(0, 40)) {
          const layer = await editImage({ blank: { width: p.width, height: p.height } }, [{ op: 'text', text: c.text, x: 50, y: capTop ? 9 : 88, size: p.height > p.width ? 3.6 : 5.2, color: '#ffffff', weight: 'bold', align: 'center', anchor: capTop ? 'top' : 'bottom', maxWidth: 86, box: { color: '#000000', opacity: 0.5, padding: 0.35 }, font: 'sans' } as EditOp])
          layers.push({ png: layer.png, start: c.startSec, end: c.endSec, fade: 0.06 })
        }
        for (const o of overlays) {
          const op: EditOp | null = o.logo_id && logos.has(o.logo_id)
            ? { op: 'overlay', imageUrl: logos.get(o.logo_id)!.imageUrl, x: num(o.x, 88), y: num(o.y, 88), width: num(o.width, 18) }
            : o.text?.trim()
              ? { op: 'text', text: clip(o.text, 200), x: num(o.x, 50), y: num(o.y, 85), size: num(o.size, 6), color: o.color, weight: o.weight ?? 'bold', align: o.align ?? 'center', anchor: 'middle', shadow: !o.box, ...(o.box ? { box: { color: '#000000', opacity: 0.55 } } : {}), font: o.font ?? 'sans' }
              : null
          if (!op) continue
          const layer = await editImage({ blank: { width: p.width, height: p.height } }, [op])
          layers.push({ png: layer.png, start: num(o.start_sec, 0), end: num(o.end_sec, p.seconds), fade: num(o.fade_sec, 0.3) })
        }
        return overlayLayers(file, dir, p, layers, edl.look)
      })
      url = await uploadToR2(`films/film-nova-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`, buf, 'video/mp4')
      if (overlays.length) notes.push(`${overlays.length} overlay${overlays.length === 1 ? '' : 's'}`)
      if (edl.look) notes.push(`${edl.look} look`)
    }
    const actual = novaCutTickets(seconds) + extras
    let charged = 0
    if (!ctx.isAdmin) { const paid = await deductGenerationTickets(uid, ctx.user.email, actual); charged = paid.ok ? actual : 0 }
    // Admins pay nothing but the would-be price still counts against plans and limits
    await settleSpend(ctx, est, ctx.isAdmin ? actual : charged)
    const row = await prisma.generatedImage.create({
      data: {
        userId: uid, prompt: `Nova final cut: ${clip(edl.title, 200)}`, imageUrl: url, model: 'nova-final-cut', ticketCost: charged,
        referenceImageUrls: [], expiresAt: FOREVER(), aspectRatio: aspect, quality: '720p', folderId: ctx.state.folderId,
        videoMetadata: {
          isVideo: true, duration: String(Math.round(seconds)), aspectW: W, aspectH: H, width: W, height: H, audioEnabled: !!(music.length || voice.length || sfx.length),
          // The whole edit list, for recut (and the counts the studio already reads)
          novaCut: { clips: planned.map(p => p.r.id), music: music.length, voice: voice.length, sfx: sfx.length, captions: caps.length, edl, ...(opts.recutOf ? { recutOf: opts.recutOf } : {}) },
        } as object,
      },
      select: { id: true },
    })
    ctx.seenIds.add(row.id)
    update(ctx, step, { status: 'done', mediaUrl: url, generationId: row.id, tickets: ctx.isAdmin ? actual : charged, ...(notes.length ? { note: notes.join(' · ') } : {}) })
    const rep = await inspectMedia(url, 'video', { frames: 3, maxFrameSide: 320 })
    return { id: row.id, seconds: Math.round(seconds), tickets: actual, ticketsCharged: charged, ...(notes.length ? { done: notes } : {}), check: facts(rep), _pictures: framesToParts(rep) }
  } catch (e: any) {
    await settleSpend(ctx, est, 0)
    const msg = String(e?.message || e).slice(0, 300)
    update(ctx, step, { status: 'error', error: msg, tickets: 0 })
    return { error: msg }
  }
}

export function makePostTools(ctx: NovaTurnCtx): ToolSet {
  const uid = ctx.user.id

  const assemble_cut = tool({
    description: 'Edit a finished video on a timeline. Clips play in order: videos (trim with trim_start/trim_end seconds) or IMAGES held as cards (card_seconds). Each clip may set its own transition INTO it. Sound: music cues with start/end/fades, voiceover and sound effects placed at exact seconds; the mix is levelled to -14 LUFS. Captions: hand-written, or auto_captions = word-timed from what is spoken. Finishing: match_color (shots from different renders look like one film), look (a grade), overlays (titles, lower thirds, end-card text, a logo ON the video). Every clip must be finished (not rendering). The cut keeps its edit list - change it later with recut. You see the finished cut\'s frames and loudness - check them.',
    inputSchema: jsonSchema<Edl>({ type: 'object', properties: EDL_PROPS as any, required: ['title', 'clips'] }),
    toModelOutput: withPictures,
    execute: async (input) => runCut(ctx, input, { label: `Final cut "${clip(input.title, 60)}"` }),
  })

  const recut = tool({
    description: 'Change an existing cut without rebuilding it: pass the cut id and ONLY what changes (e.g. clips with a new trim on shot 3, music with a lower gain_db, new overlays, auto_captions:true, a look) - everything else stays as it was. With only cut_id it returns the cut\'s edit list (free) so you can see what to change. Costs like a cut.',
    inputSchema: jsonSchema<Partial<Edl> & { cut_id: number }>({ type: 'object', properties: { cut_id: { type: 'integer' }, ...(EDL_PROPS as any) }, required: ['cut_id'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [row] = await ownedRows(uid, [input.cut_id])
      const edl = ((row?.videoMetadata ?? {}) as Record<string, any>)?.novaCut?.edl as Edl | undefined
      if (!row || !edl) return { error: row ? 'That cut was made before cuts kept their edit list - make it again with assemble_cut' : 'That is not one of the user\'s cuts' }
      const changes: Partial<Edl> = { ...input }
      delete (changes as { cut_id?: number }).cut_id
      const keys = Object.keys(changes).filter(k => (changes as Record<string, unknown>)[k] !== undefined)
      if (!keys.length) return { edl }
      const next: Edl = { ...edl, ...changes, title: changes.title ?? edl.title }
      return runCut(ctx, next, { label: `Recut of #${row.id}: ${keys.join(', ')}`, recutOf: row.id })
    },
  })

  const trim_media = tool({
    description: 'Free, exact fixes to ONE clip or sound file, saved as a new item: trim (start/end seconds), speed (0.25-4), mute (video), fade_in/fade_out (seconds), gain_db or normalize (level). E.g. cut the silence after a lip-synced line, shorten a clip by a beat, make a voice line louder.',
    inputSchema: jsonSchema<{ id: number; start?: number; end?: number; speed?: number; mute?: boolean; fade_in?: number; fade_out?: number; gain_db?: number; normalize?: boolean }>({
      type: 'object',
      properties: { id: { type: 'integer' }, start: { type: 'number' }, end: { type: 'number' }, speed: { type: 'number' }, mute: { type: 'boolean' }, fade_in: { type: 'number' }, fade_out: { type: 'number' }, gain_db: { type: 'number' }, normalize: { type: 'boolean' } },
      required: ['id'],
    }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      const k = src ? kindOf(src) : null
      if (!src || !(k === 'video' || k === 'cut' || k === 'audio')) return { error: 'That is not one of the user\'s videos or sound files' }
      const step = newStep(ctx, { tool: 'trim_media', kind: k === 'audio' ? 'audio' : 'video', label: `Edited #${src.id}`, status: 'running', model: 'Nova trim', tickets: 0 })
      try {
        const out = await withMedia(src.imageUrl, (file, dir, p) => trimMedia(file, dir, p, { start: input.start, end: input.end, speed: input.speed, mute: input.mute, fadeIn: input.fade_in, fadeOut: input.fade_out, gainDb: input.gain_db, normalize: input.normalize }))
        const audio = out.mime.startsWith('audio/')
        const url = await uploadToR2(`nova-trim-${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${audio ? 'mp3' : 'mp4'}`, out.buf, out.mime)
        const m = (src.videoMetadata ?? {}) as Record<string, any>
        const row = await prisma.generatedImage.create({
          data: {
            userId: uid, prompt: clip(`${out.done.join(', ')} - from #${src.id}: ${src.prompt}`, 900), imageUrl: url,
            // Sound stays sound (the audio: prefix is how the library knows it), a clip stays a clip
            model: audio ? (src.model.startsWith('audio:') ? src.model : 'audio:nova-trim') : 'nova-trim', ticketCost: 0,
            referenceImageUrls: [], expiresAt: FOREVER(), folderId: ctx.state.folderId,
            videoMetadata: audio ? { isAudio: true, duration: String(out.seconds), novaTrimOf: src.id } : { isVideo: true, duration: String(Math.round(out.seconds)), width: m.width, height: m.height, aspectW: m.aspectW ?? m.width, aspectH: m.aspectH ?? m.height, novaTrimOf: src.id },
          },
          select: { id: true },
        })
        ctx.seenIds.add(row.id)
        update(ctx, step, { status: 'done', mediaUrl: url, generationId: row.id, note: out.done.join(', ') })
        return { id: row.id, seconds: out.seconds, did: out.done, ticketsCharged: 0 }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  let watched = 0
  const watch_video = tool({
    description: `The strong model (${NOVA_CRITIC_MODEL}) WATCHES up to 3 clips or cuts with their sound and answers your question - motion problems (a face that morphs, flicker, judder, objects that appear), what happens when, whether the lips match the words, whether a loop or a cut feels smooth, sound balance. Use it when frames are not enough. About 1-3 tickets.`,
    inputSchema: jsonSchema<{ ids: number[]; question: string }>({ type: 'object', properties: { ids, question: { type: 'string' } }, required: ['ids', 'question'] }),
    execute: async (input) => {
      if (watched >= 3) return { error: 'Already watched 3 times this turn - use what you have.' }
      const rows = (await ownedRows(uid, input.ids)).filter(r => kindOf(r) === 'video' || kindOf(r) === 'cut').slice(0, 3)
      if (!rows.length) return { error: 'None of those ids are the user\'s videos' }
      const step = newStep(ctx, { tool: 'watch_video', label: `Watched ${rows.map(r => `#${r.id}`).join(', ')}`, status: 'running' })
      try {
        const parts: GeminiRequest['contents'][number]['parts'] = [{ text: `You are a film editor watching AI-generated clips for a colleague. Answer their question precisely, with timestamps (seconds) where it helps. Be honest about problems. QUESTION: ${clip(input.question, 1500)}` } as any]
        for (const r of rows) {
          const v = await watchableVideo(r.imageUrl, 60)
          if (!v) continue
          parts.push({ text: `CLIP #${r.id} (${kindOf(r)}, ${r.model}):` } as any, { inlineData: { mimeType: v.mime, data: v.data } } as any)
        }
        if (parts.length < 2) throw new Error('The clips could not be read')
        const res = await geminiGenerate(NOVA_CRITIC_MODEL, { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } } }, { signal: AbortSignal.timeout(120_000) })
        if (!res.ok) throw new Error(`Watching failed (${res.status})`)
        const data = await res.json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
        ctx.extraUsd += novaChatUsd(NOVA_CRITIC_MODEL, { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0) })
        watched++
        const answer = geminiText(data).trim().slice(0, 4000)
        update(ctx, step, { status: 'done', note: clip(answer, 140) })
        return { answer }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  let searches = 0
  const web_search = tool({
    description: 'Search the web (Google) for facts you need: a brand\'s colours, tagline or products, what something real looks like, a style or era\'s visual references, current events for topical content. Returns an answer with sources. Do not use it to copy someone\'s artwork or a real person\'s likeness. About 1 ticket.',
    inputSchema: jsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }),
    execute: async (input) => {
      if (searches >= 4) return { error: 'Four searches this turn already - work with what you found.' }
      const step = newStep(ctx, { tool: 'web_search', label: `Searched: ${clip(input.query, 70)}`, status: 'running' })
      try {
        const model = NOVA_ROUTES.run
        const body = { contents: [{ role: 'user', parts: [{ text: `Search the web and answer factually and concisely with the key details: ${clip(input.query, 800)}` }] }], tools: [{ google_search: {} }] }
        const res = await geminiGenerate(model, body as GeminiRequest, { signal: AbortSignal.timeout(45_000) })
        if (!res.ok) throw new Error(`Search failed (${res.status})`)
        const data = await res.json() as Record<string, any>
        // Tokens + Google's grounding fee (about $0.035 a search)
        ctx.extraUsd += novaChatUsd(model, { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0) }) + 0.035
        searches++
        const answer = geminiText(data).trim().slice(0, 6000)
        const sources = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c: any) => c?.web?.title || c?.web?.uri).filter((u: unknown) => typeof u === 'string').slice(0, 5)
        if (!answer) throw new Error('No answer came back')
        update(ctx, step, { status: 'done', note: sources.length ? `${sources.length} sources` : undefined })
        return { answer, ...(sources.length ? { sources } : {}) }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  const learn_about_model = tool({
    description: 'Keep a lesson about a MODEL for future work (shown whenever it is looked up): a habit you have now seen ("adds camera bobbing unless told to hold steady", "renders quoted text cleanly", "refuses close-ups of realistic faces"). One general sentence - no story details. Not for user preferences (use remember).',
    inputSchema: jsonSchema<{ model: string; lesson: string }>({ type: 'object', properties: { model: { type: 'string', description: 'The model id' }, lesson: { type: 'string' } }, required: ['model', 'lesson'] }),
    execute: async (input) => {
      await addLesson(uid, input.model, input.lesson, 'nova')
      newStep(ctx, { tool: 'learn_about_model', label: `Learned about ${clip(input.model, 40)}: ${clip(input.lesson, 70)}`, status: 'done' })
      return { saved: true }
    },
  })

  return { assemble_cut, recut, trim_media, watch_video, web_search, learn_about_model }
}
