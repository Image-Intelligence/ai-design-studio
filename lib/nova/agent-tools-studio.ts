/**
 * Nova Studio - the studio tools (server only, 2026-10-19, owner: "build all
 * of those" - recipes, new tools, the look bible, routing/limits).
 *
 * What Claude Code did by hand on the project's productions that Nova could
 * not:
 *  - load_recipe: the step-by-step know-how for a kind of job (lib/nova/recipes).
 *  - extract_frame: a clip's frame as a still - the last frame of shot N is
 *    the start of shot N+1 (continuity across cuts).
 *  - make_loop: measure a loop's seam and repair it (lib/nova/video-ops).
 *  - edit_clip: the clip tools Storyboard Studio already has (upscale,
 *    edit with words, recast a face, remove an object, extend, lip-sync,
 *    sound effects...) on any of the user's clips.
 *  - talking_head: a still + a voice line -> a talking shot (H3 Max lip-sync
 *    or OmniHuman v2), short lines padded to the model's minimum.
 *  - set_look_bible / check_shots: decide a production's characters, places
 *    and style once, then check every new shot against them while a redo is
 *    still cheap (the strong critic model).
 *
 * Same rules as the other tool sets: media by id and ownership-checked,
 * spending through guard(), results filed in the chat's folder, the site's
 * own routes bill and gate every generation.
 */
import { NextRequest } from 'next/server'
import { tool, jsonSchema, type ToolSet } from 'ai'
import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { videoTicketCost, batch1003TicketCost } from '@/lib/ticket-pricing'
import { OMNIHUMAN_AUDIO_SEC } from '@/lib/batch-1003-video'
import { ADMIN_ONLY_VIDEO_MODELS } from '@/lib/fal-video-endpoints'
import { CLIP_TOOLS, clipTool } from '@/lib/storyboard-tools'
import { NOVA_VIDEO_TOOLS, novaVideoTool, describeVideoTool } from '@/lib/nova/video-tools'
import { NOVA_RECIPES, recipeById } from '@/lib/nova/recipes'
import { withClip, stillAt, measureSeam, makeLoop, seamFrames, padAudio, watchableVideo, type LoopMethod } from '@/lib/nova/video-ops'
import { checkShots, type ShotRef, type ShotItem } from '@/lib/nova/critic'
import { addLesson } from '@/lib/nova/lessons'
import { inspectMedia } from '@/lib/nova/media-inspect'
import { NOVA_CRITIC_MODEL, novaCutTickets } from '@/lib/nova/config'
import {
  guard, settleSpend, newStep, update, ownedRows, kindOf, withPictures, clip, secondsOf, imagePart, cleanBible, bibleIds,
  type NovaTurnCtx, type Row,
} from '@/lib/nova/agent-tools'

const FOREVER = () => new Date(Date.now() + 100 * 365 * 864e5)
const MAX_SHOT_CHECKS = 4
const isClip = (r: Row) => kindOf(r) === 'video' || kindOf(r) === 'cut'
const pngPart = (png: Buffer) => ({ type: 'file' as const, data: { type: 'data' as const, data: new Uint8Array(png) }, mediaType: 'image/png' })
const b64 = (p: { data: { data: Uint8Array }; mediaType: string }) => ({ mime: p.mediaType, data: Buffer.from(p.data.data).toString('base64') })

/** A clip's aspect from its stored size (the clip tools re-render in the same frame). */
function aspectOf(r: Row): string {
  const m = (r.videoMetadata ?? {}) as Record<string, any>
  const w = Number(m.width ?? m.aspectW), h = Number(m.height ?? m.aspectH)
  if (typeof m.aspectRatio === 'string' && /^\d+:\d+$/.test(m.aspectRatio)) return m.aspectRatio
  if (w > 0 && h > 0) { const r2 = w / h; return r2 > 1.5 ? '16:9' : r2 < 0.67 ? '9:16' : r2 > 1.1 ? '4:3' : r2 < 0.9 ? '3:4' : '1:1' }
  return '16:9'
}

/** Submit a body to /api/video/generate (or Higgsfield's route) as the user (or with the background-run key) - the route bills and gates it. */
async function submitVideo(ctx: NovaTurnCtx, body: Record<string, unknown>, route: 'video' | 'higgsfield' = 'video'): Promise<{ ok: true; queueId: number; ticketCost: number } | { ok: false; error: string }> {
  try {
    const { POST } = route === 'higgsfield' ? await import('@/app/api/admin/higgsfield/video-submit/route') : await import('@/app/api/video/generate/route')
    const res = await POST(new NextRequest(route === 'higgsfield' ? 'http://internal/api/admin/higgsfield/video-submit' : 'http://internal/api/video/generate', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(ctx.authHeaders ?? {}) }, body: JSON.stringify({ adminMode: false, ...body }),
    }))
    const data = await res.json().catch(() => ({})) as Record<string, any>
    if (!res.ok || data?.success === false) return { ok: false, error: String(data?.error || `The render failed to start (${res.status})`).slice(0, 400) }
    const queueId = Number(data?.queueJobId ?? data?.queueId ?? 0)
    if (!Number.isInteger(queueId) || queueId <= 0) return { ok: false, error: 'The render was not queued' }
    return { ok: true, queueId, ticketCost: Number(data?.ticketCost ?? 0) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

/** Pictures of a row for a check: an image itself, or a clip's first / middle / last frames. */
async function picturesOf(r: Row): Promise<{ mime: string; data: string }[]> {
  if (isClip(r)) {
    const rep = await inspectMedia(r.imageUrl, 'video', { frames: 3, maxFrameSide: 512 })
    return (rep.frames ?? []).map(f => ({ mime: 'image/jpeg', data: Buffer.from(f.jpeg).toString('base64') }))
  }
  const p = await imagePart(r.imageUrl)
  return p ? [b64(p)] : []
}

export function makeStudioTools(ctx: NovaTurnCtx): ToolSet {
  const uid = ctx.user.id

  // ── recipes ──
  const load_recipe = tool({
    description: `Load a recipe: the studio's proven step-by-step method for a kind of job (models, prompts, checks). Load it BEFORE starting a matching job and follow it. Recipes: ${NOVA_RECIPES.map(r => r.id).join(', ')}.`,
    inputSchema: jsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string', enum: NOVA_RECIPES.map(r => r.id) } }, required: ['id'] }),
    execute: async (input) => {
      const r = recipeById(input.id)
      if (!r) return { error: `No recipe "${input.id}" - there are: ${NOVA_RECIPES.map(x => x.id).join(', ')}` }
      newStep(ctx, { tool: 'load_recipe', label: `Following the "${r.title}" recipe`, status: 'done' })
      return { recipe: r.title, steps: r.body }
    },
  })

  // ── frames ──
  const extract_frame = tool({
    description: 'Save one frame of a video as a still in My Generations (free) and see it. Use the LAST frame of a clip as the start_image_id of the next shot so the scene continues across the cut (same light, position, background), or pull a clean frame as a reference/thumbnail.',
    inputSchema: jsonSchema<{ video_id: number; at?: string }>({ type: 'object', properties: { video_id: { type: 'integer' }, at: { type: 'string', description: '"first", "middle", "last" (default) or a time in seconds, e.g. "2.5"' } }, required: ['video_id'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.video_id])
      if (!src || !isClip(src)) return { error: 'That is not one of the user\'s videos' }
      const at = input.at === 'first' || input.at === 'middle' || input.at === 'last' ? input.at : Number.isFinite(Number(input.at)) && input.at !== undefined ? Number(input.at) : 'last'
      const step = newStep(ctx, { tool: 'extract_frame', kind: 'image', label: `Frame of #${src.id} (${typeof at === 'number' ? `${at}s` : at})`, status: 'running', model: 'Frame', tickets: 0 })
      try {
        const { png, atSec, size } = await withClip(src.imageUrl, async (file, dir, p) => ({ ...(await stillAt(file, dir, p, at)), size: `${p.width}x${p.height}` }))
        const url = await uploadToR2(`nova-frame-${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`, png, 'image/png')
        const row = await prisma.generatedImage.create({
          data: { userId: uid, prompt: clip(`Frame at ${atSec}s of #${src.id}: ${src.prompt}`, 900), imageUrl: url, model: 'nova-frame', ticketCost: 0, referenceImageUrls: [src.imageUrl], expiresAt: FOREVER(), folderId: ctx.state.folderId, aspectRatio: aspectOf(src) },
          select: { id: true },
        })
        ctx.seenIds.add(row.id)
        update(ctx, step, { status: 'done', mediaUrl: url, generationId: row.id })
        const pic = await imagePart(url)
        return { id: row.id, atSec, size, _pictures: pic ? [pic] : [] }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  // ── loops ──
  const make_loop = tool({
    description: 'Seamless loops. method "check" (free): measures the seam - the jump from the last frame back to the first, against the clip\'s normal frame-to-frame change - and shows you the end and start frames. "crossfade": dissolves the tail into the head (any motion; 0.5-1.2s). "best_cut": trims to the two most alike frames + a short blend (repeating motion: waves, flames, spinning). "pingpong": forward then backward (only direction-less motion like breathing or swaying; drops the sound; max 10s). Making a loop costs like a cut (1 ticket + 1 per 30s) and saves a new video.',
    inputSchema: jsonSchema<{ video_id: number; method: string; blend_sec?: number; min_sec?: number }>({ type: 'object', properties: { video_id: { type: 'integer' }, method: { type: 'string', enum: ['check', 'crossfade', 'best_cut', 'pingpong'] }, blend_sec: { type: 'number' }, min_sec: { type: 'number', description: 'best_cut: the shortest loop wanted (e.g. the length the user asked for, minus about 0.5s)' } }, required: ['video_id', 'method'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.video_id])
      if (!src || !isClip(src)) return { error: 'That is not one of the user\'s videos' }
      if (input.method === 'check') {
        try {
          const out = await withClip(src.imageUrl, async (file, dir, p) => ({ seam: await measureSeam(file), frames: await seamFrames(file, dir, p), seconds: p.seconds }))
          newStep(ctx, { tool: 'make_loop', label: `Checked the loop seam of #${src.id}`, status: 'done', note: `${out.seam.verdict} (jump ${out.seam.ratio}x a normal frame step)` })
          return { seam: out.seam, seconds: Math.round(out.seconds * 100) / 100, pictures: 'the END frame, then the START frame', _pictures: out.frames.map(pngPart) }
        } catch (e: any) { return { error: String(e?.message || e).slice(0, 300) } }
      }
      const method = (['crossfade', 'best_cut', 'pingpong'] as const).includes(input.method as LoopMethod) ? input.method as LoopMethod : 'crossfade'
      const est = novaCutTickets(secondsOf(src))
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'make_loop', kind: 'video', label: `Loop of #${src.id} (${method.replace('_', ' ')})`, status: 'running', model: 'Nova loop', tickets: est })
      try {
        const made = await withClip(src.imageUrl, async (file, dir, p) => {
          const r = await makeLoop(file, dir, p, method, Number(input.blend_sec) || undefined, Number(input.min_sec) || undefined)
          return { ...r, width: p.width, height: p.height, fps: p.fps }
        })
        const url = await uploadToR2(`nova-loop-${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`, made.mp4, 'video/mp4')
        const actual = novaCutTickets(made.seconds)
        let charged = 0
        if (!ctx.isAdmin) { const paid = await deductGenerationTickets(uid, ctx.user.email, actual); charged = paid.ok ? actual : 0 }
        // Admins pay nothing but the would-be price still counts against plans and limits
        await settleSpend(ctx, est, ctx.isAdmin ? actual : charged)
        const row = await prisma.generatedImage.create({
          data: {
            userId: uid, prompt: clip(`Seamless loop (${method}) of #${src.id}: ${src.prompt}`, 900), imageUrl: url, model: 'nova-loop', ticketCost: charged,
            referenceImageUrls: [], expiresAt: FOREVER(), aspectRatio: aspectOf(src), folderId: ctx.state.folderId,
            videoMetadata: { isVideo: true, duration: String(Math.round(made.seconds)), width: made.width, height: made.height, aspectW: made.width, aspectH: made.height, novaLoop: { of: src.id, method, seamBefore: made.before.ratio, seamAfter: made.after.ratio } },
          },
          select: { id: true },
        })
        ctx.seenIds.add(row.id)
        update(ctx, step, { status: 'done', mediaUrl: url, generationId: row.id, tickets: ctx.isAdmin ? actual : charged, note: `seam ${made.before.verdict} -> ${made.after.verdict}` })
        const frames = await withClip(url, (file, dir, p) => seamFrames(file, dir, p)).catch(() => [] as Buffer[])
        return { id: row.id, seconds: made.seconds, did: made.note, seamBefore: made.before, seamAfter: made.after, ticketsCharged: charged, pictures: 'the new END frame, then the START frame', _pictures: frames.map(pngPart) }
      } catch (e: any) {
        await settleSpend(ctx, est, 0)
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg, tickets: 0 })
        return { error: msg }
      }
    },
  })

  // ── clip tools (Storyboard's, on any clip) ──
  const tools = CLIP_TOOLS.filter(t => ctx.isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has(t.id))
  const edit_clip = tool({
    description: `Work on one of the user's finished clips with the site's clip tools; it renders in the background like a video (call wait_for_renders). Tools:\n${tools.map(t => `- ${t.id}: ${t.label} - ${t.blurb}${t.prompt === 'required' ? ' [prompt required]' : ''}${t.refs ? ` [cast_ids: ${t.refs.label}, max ${t.refs.max}${t.refs.required ? ', required' : ''}]` : ''}${t.choice ? ` [choice ${t.choice.key}: ${t.choice.options.map(o => o.value).join('|')}]` : ''}${t.adds ? ` [seconds to add ${t.adds.min}-${t.adds.max}]` : ''}${t.minSec || t.maxSec ? ` [clip ${t.minSec ?? 1}-${t.maxSec ?? 60}s]` : ''}${t.usesLine ? ' [audio_id: the voice line]' : ''}`).join('\n')}`,
    inputSchema: jsonSchema<{ video_id: number; tool: string; prompt?: string; cast_ids?: number[]; audio_id?: number; choice?: string; seconds?: number }>({
      type: 'object',
      properties: {
        video_id: { type: 'integer' }, tool: { type: 'string', enum: tools.map(t => t.id) }, prompt: { type: 'string' },
        cast_ids: { type: 'array', items: { type: 'integer' }, description: 'Pictures of the cast / character (by id)' },
        audio_id: { type: 'integer', description: 'lipsync-v3: the voice line (an audio id)' },
        choice: { type: 'string', description: 'The tool\'s one setting, if it has one' },
        seconds: { type: 'number', description: 'Extend tools: seconds to add' },
      },
      required: ['video_id', 'tool'],
    }),
    execute: async (input) => {
      const t = clipTool(input.tool)
      if (!t || !tools.includes(t)) return { error: `Unknown clip tool "${input.tool}"` }
      const [src] = await ownedRows(uid, [input.video_id])
      if (!src || !isClip(src)) return { error: 'That is not one of the user\'s videos' }
      const sec = secondsOf(src)
      if (t.minSec && sec < t.minSec - 0.1) return { error: `${t.label} needs a clip of at least ${t.minSec}s (this one is ${sec}s)` }
      if (t.maxSec && sec > t.maxSec + 0.1) return { error: `${t.label} takes clips up to ${t.maxSec}s (this one is ${sec}s) - trim it in assemble_cut first` }
      const prompt = clip(input.prompt, 2000)
      if (t.prompt === 'required' && !prompt) return { error: `${t.label} needs a prompt: ${t.placeholder ?? 'say what to do'}` }
      const cast = t.refs ? (await ownedRows(uid, input.cast_ids ?? [])).filter(r => kindOf(r) === 'image').slice(0, t.refs.max) : []
      if (t.refs?.required && !cast.length) return { error: `${t.label} needs ${t.refs.label.toLowerCase()} (cast_ids)` }
      let audio: Row | undefined
      if (t.usesLine) {
        audio = (await ownedRows(uid, [input.audio_id])).find(r => kindOf(r) === 'audio')
        if (!audio) return { error: `${t.label} needs the voice line: audio_id (one of the user's audio files)` }
      }
      const choice = t.choice ? (t.choice.options.some(o => o.value === input.choice) ? String(input.choice) : t.choice.def) : undefined
      const adds = t.adds ? Math.min(t.adds.max, Math.max(t.adds.min, Number(input.seconds) || t.adds.def)) : undefined
      const body: Record<string, unknown> = {
        model: t.id, prompt, duration: String(adds ?? 5), resolution: '1080p', klingAspectRatio: aspectOf(src),
        ...(t.choice && choice ? { [t.choice.key]: choice } : {}), ...(t.extra ?? {}),
      }
      if (audio) { body.lipsyncVideoUrl = src.imageUrl; body.lipsyncAudioUrl = audio.imageUrl; body.lipsyncSyncMode = 'cut_off' }
      else { body.editVideoUrl = src.imageUrl; if (cast.length) body.referenceImageUrls = cast.map(r => r.imageUrl) }
      const est = Math.max(1, videoTicketCost({ model: t.id, duration: String(adds ?? 5), resolution: String(body.resolution), editVideoDurationSec: sec, lipsyncVideoDurationSec: sec, referenceImageCount: cast.length }) || Math.ceil(sec * 2))
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'edit_clip', kind: 'video', label: `${t.label} on #${src.id}`, status: 'running', model: t.label, prompt: prompt || undefined, tickets: est, posterUrl: cast[0]?.imageUrl })
      const res = await submitVideo(ctx, body)
      if (!res.ok) { await settleSpend(ctx, est, 0); update(ctx, step, { status: 'error', error: res.error, tickets: 0 }); return { error: res.error } }
      await settleSpend(ctx, est, res.ticketCost)
      update(ctx, step, { status: 'pending', queueId: res.queueId, tickets: res.ticketCost })
      ctx.waitForRenders = true
      return { status: 'rendering', ticketsCharged: res.ticketCost, note: 'Call wait_for_renders when everything that needs it has been started.' }
    },
  })

  // ── every other public video model (lib/nova/video-tools) ──
  const vtools = NOVA_VIDEO_TOOLS.filter(t => ctx.isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has(t.id))
  const use_video_tool = tool({
    description: `The site's other video models - upscale, reframe, restyle, extend, translate / dub, subtitles, relight, camera moves, depth, tracking, background removal, audio-driven video, motion transfer, Higgsfield. Renders in the background (call wait_for_renders). Use the one the user names. Tools:\n${vtools.map(describeVideoTool).join('\n')}`,
    inputSchema: jsonSchema<{ tool: string; video_id?: number; picture_ids?: number[]; audio_id?: number; motion_video_id?: number; prompt?: string; option?: string; seconds?: string; resolution?: string; insert_start?: number; insert_resume?: number }>({
      type: 'object',
      properties: {
        tool: { type: 'string', enum: vtools.map(t => t.id) },
        video_id: { type: 'integer', description: 'The clip it works on' },
        picture_ids: { type: 'array', items: { type: 'integer' } },
        audio_id: { type: 'integer' }, motion_video_id: { type: 'integer' },
        prompt: { type: 'string' }, option: { type: 'string' }, seconds: { type: 'string' }, resolution: { type: 'string' },
        insert_start: { type: 'number' }, insert_resume: { type: 'number' },
      },
      required: ['tool'],
    }),
    execute: async (input) => {
      const t = novaVideoTool(input.tool)
      if (!t || !vtools.includes(t)) return { error: `Unknown video tool "${input.tool}"` }
      const i = t.inputs
      const rows = await ownedRows(uid, [input.video_id, input.audio_id, input.motion_video_id, ...(input.picture_ids ?? [])].filter((x): x is number => Number.isInteger(Number(x))).map(Number))
      const byId = (id?: number) => rows.find(r => r.id === Number(id))
      const src = i.clip ? byId(input.video_id) : undefined
      if (i.clip && (!src || !isClip(src))) return { error: `${t.label} works on a clip: video_id (one of the user's videos)` }
      const sec = src ? secondsOf(src) : 0
      if (src && i.clip?.maxSec && sec > i.clip.maxSec + 0.1) return { error: `${t.label} takes clips up to ${i.clip.maxSec}s (this one is ${sec}s) - trim it first (trim_media)` }
      if (src && i.clip?.minSec && sec < i.clip.minSec - 0.1) return { error: `${t.label} needs a clip of at least ${i.clip.minSec}s (this one is ${sec}s)` }
      const pics = i.pictures ? (input.picture_ids ?? []).map(byId).filter((r): r is Row => !!r && kindOf(r) === 'image').slice(0, i.pictures.max) : []
      if (i.pictures?.required && !pics.length) return { error: `${t.label} needs picture_ids: ${i.pictures.label}` }
      const audio = i.audio ? byId(input.audio_id) : undefined
      if (i.audio && audio && kindOf(audio) !== 'audio') return { error: 'audio_id must be one of the user\'s audio files' }
      if (i.audio?.required && !audio) return { error: `${t.label} needs audio_id: ${i.audio.label}` }
      const motion = i.motionClip ? byId(input.motion_video_id) : undefined
      if (i.motionClip && (!motion || !isClip(motion))) return { error: `${t.label} needs motion_video_id: the clip whose movement to copy` }
      const prompt = clip(input.prompt, 5000)
      if (t.prompt === 'required' && !prompt) return { error: `${t.label} needs a prompt${t.promptIs ? `: ${t.promptIs}` : ''}` }
      if (t.id === 'heygen-avatar4' && !prompt && !audio) return { error: 'HeyGen Avatar 4 needs the script (prompt) or the voice line (audio_id)' }
      const option = t.option ? (t.option.values.includes(String(input.option)) ? String(input.option) : t.option.def) : undefined
      const seconds = t.seconds ? (t.seconds.values.includes(String(input.seconds)) ? String(input.seconds) : t.seconds.def) : '5'
      const resolution = t.resolutions ? (t.resolutions.includes(String(input.resolution)) ? String(input.resolution) : t.resolutions[0]) : '1080p'
      const body: Record<string, unknown> = {
        model: t.id, prompt, duration: seconds, resolution, generateAudio: true,
        klingAspectRatio: src ? aspectOf(src) : '16:9',
        ...(t.option && option ? { [t.option.param]: option } : {}),
      }
      if (src) { body.sd20Mode = 'edit'; body.editVideoUrl = src.imageUrl }
      if (pics.length) {
        if (i.pictures!.as === 'imageUrl') body.imageUrl = pics[0].imageUrl
        else body.referenceImageUrls = pics.map(r => r.imageUrl)
      }
      if (audio) body.audioUrl = audio.imageUrl
      if (motion) { body.motionVideoUrl = motion.imageUrl; body.characterOrientation = 'image'; body.keepOriginalSound = true }
      if (t.insert) {
        const a = Number(input.insert_start), b = Number(input.insert_resume)
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1.65 || b < a || b > sec - 1.4) return { error: `${t.label} needs insert_start (at least 1.65s) and insert_resume (from insert_start to ${Math.max(0, sec - 1.4).toFixed(1)}s) - where the new shot goes` }
        body.insertStartSec = a; body.insertResumeSec = b
      }
      let est = 0
      try { est = videoTicketCost({ model: t.id, duration: seconds, resolution, editVideoDurationSec: sec, motionVideoDurationSec: motion ? secondsOf(motion) : undefined, audioDurationSec: audio ? secondsOf(audio) : undefined, videoChoice: option, referenceImageCount: pics.length, promptWords: prompt.split(/\s+/).filter(Boolean).length } as Parameters<typeof videoTicketCost>[0]) } catch { /* the route prices it */ }
      est = Math.max(1, est || Math.ceil(Math.max(sec, 5) * 3))
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'use_video_tool', kind: 'video', label: `${t.label}${src ? ` on #${src.id}` : ''}`, status: 'running', model: t.label, prompt: prompt || undefined, tickets: est, posterUrl: pics[0]?.imageUrl })
      const res = await submitVideo(ctx, body, t.route === 'higgsfield' ? 'higgsfield' : 'video')
      if (!res.ok) { await settleSpend(ctx, est, 0); update(ctx, step, { status: 'error', error: res.error, tickets: 0 }); return { error: res.error } }
      await settleSpend(ctx, est, res.ticketCost)
      update(ctx, step, { status: 'pending', queueId: res.queueId, tickets: res.ticketCost })
      ctx.waitForRenders = true
      return { status: 'rendering', ticketsCharged: res.ticketCost, note: 'Call wait_for_renders when everything that needs it has been started.' }
    },
  })

  // ── talking shots ──
  const talking_head = tool({
    description: 'Make a still of a character TALK: one image (face to camera, mouth closed and visible) + one voice line (an audio id) -> a talking video as long as the line. model "minimax-h3-max-lipsync" (1080P, sharp, fast, works on stylised and non-human faces; about 4 tickets per second of the line, 5s minimum = about 21 tickets; shorter lines are padded with silence - trim the tail in assemble_cut) or "omnihuman-v2" (more body and hand movement, a prompt can direct gestures; about 2.6 tickets per second, 4-60s lines). Renders in the background (call wait_for_renders).',
    inputSchema: jsonSchema<{ image_id: number; audio_id: number; model?: string; prompt?: string }>({
      type: 'object',
      properties: { image_id: { type: 'integer' }, audio_id: { type: 'integer' }, model: { type: 'string', enum: ['minimax-h3-max-lipsync', 'omnihuman-v2'] }, prompt: { type: 'string', description: 'omnihuman-v2: gestures, movement, camera' } },
      required: ['image_id', 'audio_id'],
    }),
    execute: async (input) => {
      const model = input.model === 'omnihuman-v2' ? 'omnihuman-v2' : 'minimax-h3-max-lipsync'
      if (!ctx.isAdmin && ADMIN_ONLY_VIDEO_MODELS.has(model)) return { error: 'That model is not available on this account' }
      const rows = await ownedRows(uid, [input.image_id, input.audio_id])
      const img = rows.find(r => r.id === Number(input.image_id) && kindOf(r) === 'image')
      const voice = rows.find(r => r.id === Number(input.audio_id) && kindOf(r) === 'audio')
      if (!img) return { error: 'image_id must be one of the user\'s images' }
      if (!voice) return { error: 'audio_id must be one of the user\'s audio files (make the line with generate_audio first)' }
      // The models' minimum line length: pad with silence instead of failing
      const minSec = model === 'omnihuman-v2' ? OMNIHUMAN_AUDIO_SEC.min : 5
      let audioUrl = voice.imageUrl, padded = 0, lineSec = 0
      const pad = await padAudio(voice.imageUrl, minSec + 0.15).catch(() => null)
      if (pad) {
        audioUrl = await uploadToR2(`nova-voicepad-${uid}-${Date.now()}.mp3`, pad.mp3, 'audio/mpeg')
        padded = pad.padded; lineSec = pad.seconds
      }
      const est = Math.max(1, batch1003TicketCost(model, { resolution: '1080p', audioSec: lineSec || 8 }))
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'talking_head', kind: 'video', label: `Talking shot from #${img.id} + #${voice.id}`, status: 'running', model: model === 'omnihuman-v2' ? 'OmniHuman v2' : 'H3 Max Lip Sync', prompt: clip(input.prompt, 300) || undefined, tickets: est, posterUrl: img.imageUrl })
      const res = await submitVideo(ctx, { model, prompt: clip(input.prompt, 2000), imageUrl: img.imageUrl, audioUrl, resolution: '1080p', duration: '5' })
      if (!res.ok) { await settleSpend(ctx, est, 0); update(ctx, step, { status: 'error', error: res.error, tickets: 0 }); return { error: res.error } }
      await settleSpend(ctx, est, res.ticketCost)
      update(ctx, step, { status: 'pending', queueId: res.queueId, tickets: res.ticketCost })
      ctx.waitForRenders = true
      return { status: 'rendering', ticketsCharged: res.ticketCost, ...(padded ? { note: `The line was padded with ${padded}s of silence to the model's minimum - trim that much off the end (trim_end) in assemble_cut.` } : {}) }
    },
  })

  // ── the look bible ──
  const set_look_bible = tool({
    description: 'Lock this chat\'s look: the pictures that define each recurring character/product and each location, and a style note (medium, palette, lens, light, grain). From then on every generation must pass the relevant ones as references (or no_bible:true for a shot showing none), and check_shots compares new shots against them. Call it again to change it; an empty call clears it. Follow the look-bible recipe to build the pictures first.',
    inputSchema: jsonSchema<{ characters?: { name: string; ids: number[] }[]; places?: { name: string; ids: number[] }[]; style?: string }>({
      type: 'object',
      properties: {
        characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ids: { type: 'array', items: { type: 'integer' }, description: 'Best pictures first (a character sheet, a hero shot), max 4' } }, required: ['name', 'ids'] } },
        places: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ids: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'ids'] } },
        style: { type: 'string' },
      },
    }),
    execute: async (input) => {
      const want = cleanBible(input)
      if (!want) {
        ctx.state.bible = null
        newStep(ctx, { tool: 'set_look_bible', label: 'Cleared the look bible', status: 'done' })
        return { cleared: true }
      }
      // Only the user's own IMAGES stay in it
      const owned = new Set((await ownedRows(uid, bibleIds(want))).filter(r => kindOf(r) === 'image').map(r => r.id))
      const keep = (es: { name: string; ids: number[] }[]) => es.map(e => ({ ...e, ids: e.ids.filter(i => owned.has(i)) })).filter(e => e.ids.length)
      const bible = { characters: keep(want.characters), places: keep(want.places), style: want.style }
      if (!bible.characters.length && !bible.places.length) return { error: 'None of those ids are the user\'s images' }
      ctx.state.bible = bible
      bibleIds(bible).forEach(i => ctx.seenIds.add(i))
      newStep(ctx, { tool: 'set_look_bible', label: `Look bible: ${[...bible.characters, ...bible.places].map(e => e.name).join(', ')}`, status: 'done', note: `${bibleIds(bible).length} pictures` })
      return { bible }
    },
  })

  let shotChecks = 0
  const check_shots = tool({
    description: `Continuity check by the strong critic model (${NOVA_CRITIC_MODEL}): compares up to 6 new stills or clips (clips: first, middle and last frames) with the look bible's pictures (or against_ids) and says keep / redo per shot with what drifted and how to fix it. Use it on keyframes and clips AS YOU MAKE THEM, before building on them - redo a shot that drifts (up to 2 tries) before moving on. It WATCHES clips (motion included). About 1-4 tickets.`,
    inputSchema: jsonSchema<{ ids: number[]; against_ids?: number[] }>({ type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, against_ids: { type: 'array', items: { type: 'integer' }, description: 'Reference pictures, when there is no look bible (or to override it)' } }, required: ['ids'] }),
    execute: async (input) => {
      if (shotChecks >= MAX_SHOT_CHECKS) return { error: `The continuity check already ran ${MAX_SHOT_CHECKS} times this turn - batch the shots into one call.` }
      const b = ctx.state.bible
      const refIds = (input.against_ids ?? []).length ? input.against_ids! : bibleIds(b)
      if (!refIds.length) return { error: 'Nothing to compare with: set a look bible (set_look_bible) or pass against_ids' }
      const shots = (await ownedRows(uid, input.ids)).filter(r => kindOf(r) === 'image' || isClip(r)).slice(0, 6)
      if (!shots.length) return { error: 'None of those ids are the user\'s images or clips' }
      const refRows = (await ownedRows(uid, refIds)).filter(r => kindOf(r) === 'image')
      const label = (id: number) => b?.characters.find(c => c.ids.includes(id))?.name ? `character "${b!.characters.find(c => c.ids.includes(id))!.name}"` : b?.places.find(p => p.ids.includes(id))?.name ? `place "${b!.places.find(p => p.ids.includes(id))!.name}"` : `reference #${id}`
      const step = newStep(ctx, { tool: 'check_shots', label: `Continuity check: ${shots.map(s => `#${s.id}`).join(', ')}`, status: 'running' })
      try {
        const refs: ShotRef[] = []
        for (const r of refRows.slice(0, 6)) { const p = await imagePart(r.imageUrl); if (p) refs.push({ label: `${label(r.id)} (#${r.id})`, pictures: [b64(p)] }) }
        const items: ShotItem[] = []
        for (const s of shots) items.push({ id: s.id, kind: kindOf(s), prompt: s.prompt, pictures: await picturesOf(s), video: isClip(s) ? await watchableVideo(s.imageUrl, 20) : null })
        const out = await checkShots({ model: NOVA_CRITIC_MODEL, refs, style: b?.style ?? '', shots: items })
        ctx.extraUsd += out.usd
        shotChecks++
        for (const c of out.checks) { const s = shots.find(x => x.id === c.id); if (s && c.lesson) await addLesson(uid, s.model, c.lesson, 'check').catch(() => {}) }
        const redo = out.checks.filter(c => c.verdict === 'redo')
        update(ctx, step, { status: 'done', label: redo.length ? `Continuity: ${redo.length} of ${out.checks.length} to redo` : `Continuity: all ${out.checks.length} on-model`, note: redo.map(r => `#${r.id}: ${r.drift}`).join(' · ').slice(0, 160) || undefined })
        return { checks: out.checks }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  return { load_recipe, extract_frame, make_loop, edit_clip, use_video_tool, talking_head, set_look_bible, check_shots }
}
