/**
 * Nova Studio - the production tools (server only, 2026-10-18, owner's list):
 *  1. SEE AND HEAR: inspect_media - video frames, length, loudness, silences
 *     (lib/nova/media-inspect); every finished cut is inspected automatically.
 *  2. TIMELINE: assemble_cut - per-clip trims and transitions, image cards,
 *     music cues with in/out points, voice and sound effects placed in time,
 *     burned-in captions, a loudness pass to -14 LUFS.
 *  3. PIXEL FIXES: edit_image (crop, reframe, text, logo overlay, colour -
 *     lib/nova/image-edit, free), expand_image and cutout (Bria, billed by
 *     the site's own route).
 *  6. MEMORY: remember / forget - the user's preferences, kept across chats.
 *  7. CRITIC: critique - a stronger Gemini model reviews against the brief.
 *  8. ROUTING: recommend_models - the scorecard (curated + learned).
 * 10. REFERENCES: caption_asset, update_asset_notes, find_similar.
 * 11. ARTIFACTS: save_storyboard (opens in Storyboard Studio), export_formats.
 *
 * Same rules as lib/nova/agent-tools: media by id and ownership-checked,
 * spending through guard(), results filed in the chat's folder.
 */
import { NextRequest } from 'next/server'
import { tool, jsonSchema, type ToolSet } from 'ai'
import prisma from '@/lib/prisma'
import { submitChatImage } from '@/lib/chat-image-submit'
import { uploadToR2 } from '@/lib/r2'
import { getCreateModel } from '@/lib/chat-hub-models'
import { assetCaptionTickets } from '@/lib/ai-text-pricing'
import { findAsset, updateAsset, storedRefs, assetNotes } from '@/lib/user-assets'
import { newShot, sanitizeShots, STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, DURATIONS } from '@/lib/storyboard'
import { inspectMedia, type MediaReport } from '@/lib/nova/media-inspect'
import { watchableVideo } from '@/lib/nova/video-ops'
import { editImage, type EditOp } from '@/lib/nova/image-edit'
import { critique, recordCritique } from '@/lib/nova/critic'
import { addLesson, loadLessons, lessonsFor } from '@/lib/nova/lessons'
import { recommend, NOVA_TASKS } from '@/lib/nova/scorecard'
import { addNovaNote, removeNovaNote } from '@/lib/nova/memory'
import { rowForRequest, fileGeneration } from '@/lib/nova/jobs'
import { NOVA_CRITIC_MODEL, novaCutTickets } from '@/lib/nova/config'
import {
  guard, settleSpend, prepayTool, refundPrepaid, commitPrepaid, prepaidAbandoned, newStep, update, ownedRows, kindOf, withPictures, assemble, clip, brief, posterOf, secondsOf, imagePart,
  type NovaTurnCtx, type Row,
  agentModel, agentName,
} from '@/lib/nova/agent-tools'

const ids = { type: 'array', items: { type: 'integer' }, description: 'My Generations ids (the numbers after #)' } as const
const FOREVER = () => new Date(Date.now() + 100 * 365 * 864e5)
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9']

/** The facts worth telling the model (and the critic) about one inspected file. */
function facts(r: MediaReport): string[] {
  const f: string[] = []
  if (r.durationSec) f.push(`${r.durationSec.toFixed(1)}s`)
  if (r.width && r.height) f.push(`${r.width}x${r.height}`)
  if (r.loudness?.integratedLufs != null) f.push(`${r.loudness.integratedLufs.toFixed(1)} LUFS`)
  if (r.loudness?.truePeakDb != null) f.push(`peak ${r.loudness.truePeakDb.toFixed(1)} dB`)
  return [...f, ...r.notes]
}
const framesToParts = (r: MediaReport) => (r.frames ?? []).map(fr => ({ type: 'file' as const, data: { type: 'data' as const, data: fr.jpeg }, mediaType: 'image/jpeg' }))

/** Save an edited picture as the user's generation, in the chat's folder. */
async function saveEdit(ctx: NovaTurnCtx, png: Buffer, prompt: string, source: Row, aspect?: string, model = agentModel(ctx, 'edit')): Promise<{ id: number; url: string }> {
  const url = await uploadToR2(`nova-edit-${ctx.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`, png, 'image/png')
  const row = await prisma.generatedImage.create({
    data: { userId: ctx.user.id, prompt: clip(prompt, 900), imageUrl: url, model, ticketCost: 0, referenceImageUrls: [source.imageUrl], expiresAt: FOREVER(), folderId: ctx.state.folderId, ...(aspect ? { aspectRatio: aspect } : {}) },
    select: { id: true },
  })
  ctx.seenIds.add(row.id)
  return { id: row.id, url }
}

/** Run one of the site's image models on a picture (billed and gated by /api/generate), wait for it, file it. */
async function runImageTool(ctx: NovaTurnCtx, modelId: string, prompt: string, src: Row, settings: Record<string, string>, label: string) {
  const spec = getCreateModel(modelId)
  if (!spec) return { error: `${modelId} is not available` }
  const est = spec.ticketCost
  const refused = guard(ctx, est)
  if (refused) return { error: refused }
  const step = newStep(ctx, { tool: modelId, kind: 'image' as const, label, status: 'running', model: spec.label, prompt: clip(prompt, 300), tickets: est, posterUrl: src.imageUrl })
  const res = await submitChatImage(spec, prompt, [src.imageUrl], settings, ctx.user.id, { ...(ctx.authHeaders ? { headers: ctx.authHeaders } : {}), waitUntil: ctx.deadline })
  if (!res.ok) { await settleSpend(ctx, est, 0); update(ctx, step, { status: 'error', error: res.error, tickets: 0 }); return { error: res.error } }
  await settleSpend(ctx, est, res.ticketCost)
  if ('pending' in res) { update(ctx, step, { status: 'pending', queueId: res.queueId, tickets: res.ticketCost }); ctx.waitForRenders = true; return { status: 'still rendering', ticketsCharged: res.ticketCost } }
  const q = res.queueId ? await prisma.generationQueue.findUnique({ where: { id: res.queueId }, select: { falRequestId: true } }) : null
  const row = await rowForRequest(ctx.user.id, q?.falRequestId)
  await fileGeneration(ctx.user.id, row?.id, ctx.state.folderId)
  if (row) ctx.seenIds.add(row.id)
  update(ctx, step, { status: 'done', mediaUrl: row?.imageUrl ?? res.url, generationId: row?.id, tickets: res.ticketCost })
  const pic = await imagePart(row?.imageUrl ?? res.url)
  return { id: row?.id ?? null, ticketsCharged: res.ticketCost, _pictures: pic ? [pic] : [] }
}

export function makeProTools(ctx: NovaTurnCtx): ToolSet {
  const uid = ctx.user.id

  // ── 1. see and hear ──
  const inspect_media = tool({
    description: 'Inspect up to 3 of the user\'s videos, audio files or images: length, size, loudness (LUFS), clipping, silent stretches - and for video you SEE frames (first, middle, last; up to 6). Use it to check clips before cutting and to check sound levels.',
    inputSchema: jsonSchema<{ ids: number[]; frames?: number }>({ type: 'object', properties: { ids, frames: { type: 'integer', description: 'Frames per video, 2-6 (default 3)' } }, required: ['ids'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const rows = (await ownedRows(uid, input.ids)).slice(0, 3)
      const reports: Record<string, unknown>[] = []
      const pictures: any[] = []
      for (const r of rows) {
        const k = kindOf(r)
        const rep = await inspectMedia(r.imageUrl, k === 'video' || k === 'cut' ? 'video' : k === 'audio' ? 'audio' : 'image', { frames: Math.min(6, Math.max(2, Number(input.frames) || 3)), maxFrameSide: 384 })
        reports.push({ id: r.id, kind: k, facts: facts(rep) })
        pictures.push(...framesToParts(rep))
        if (k === 'image') { const p = await imagePart(r.imageUrl); if (p) pictures.push(p) }
      }
      newStep(ctx, { tool: 'inspect_media', label: `Checked ${rows.map(r => `#${r.id}`).join(', ') || 'nothing'}`, status: 'done', note: reports.map(r => (r.facts as string[]).slice(0, 2).join(' · ')).join(' | ').slice(0, 120) })
      return { reports, _pictures: pictures.slice(0, 12) }
    },
  })

  // ── 2. the timeline: assemble_cut / recut live in lib/nova/agent-tools-post (they keep the cut's edit list) ──

  // ── 3. pixel fixes ──
  const edit_image = tool({
    description: 'Pixel-level fixes on one of the user\'s images, free and instant: crop, reframe to another aspect (pad with a blurred copy or a colour, or crop around a focus point), resize, add TEXT (headline, caption - exact words, position and size in % of the canvas, colour, weight, box, outline), place another image on it (a logo or cut-out, by id), adjust brightness/saturation/contrast, vignette, blur a region (behind text). Positions are % of the canvas (x,y = 0-100). Up to 12 ops, applied in order. Saves a new image and shows it to you. TYPE LIKE A DESIGNER (the critic marks meme-style text down): no outline/stroke on headlines; a soft shadow, or a clean colour band in the brand colour with generous padding, only when the background is busy; display or serif for headlines, sans for small text; headline 6-9% tall, at most 2 lines; keep 6%+ margins and line things up with the subject; when the words should be PART of the picture (a sign, a poster, styled lettering), generate them with a lettering model (Ideogram, MOSS Image) instead.',
    inputSchema: jsonSchema<{ id: number; ops: Record<string, unknown>[]; note?: string }>({
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'The image to edit' },
        ops: { type: 'array', items: { type: 'object' }, description: 'e.g. [{"op":"reframe","aspect":"1:1","fill":"blur"},{"op":"text","text":"MORNING EMBER","x":50,"y":12,"size":7,"weight":"black","align":"center","color":"#ffffff","shadow":true},{"op":"overlay","overlay_id":123,"x":86,"y":88,"width":18}]. Ops: crop{x,y,w,h} reframe{aspect,fill:blur|color,color?,mode:pad|crop,focusX?,focusY?} resize{width?,height?} text{text,x,y,size,color?,weight:regular|bold|black,align?,anchor:top|middle|bottom,maxWidth?,stroke?,shadow?,box:{color,opacity?,padding?},font:sans|serif|display} overlay{overlay_id,x,y,width,opacity?,anchor:center|top-left} adjust{brightness?,saturation?,contrast?,hue?} vignette{strength?} blurRegion{x,y,w,h,amount?}' },
        note: { type: 'string', description: 'What this edit is for (saved as its prompt)' },
      },
      required: ['id', 'ops'],
    }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      if (!src || kindOf(src) !== 'image') return { error: 'That is not one of the user\'s images' }
      // An overlay names the user's own image by id; it is turned into its URL here
      const ops: EditOp[] = []
      for (const raw of (input.ops ?? []).slice(0, 12)) {
        const o = { ...(raw as Record<string, any>) }
        if (o.op === 'overlay') {
          const [ov] = await ownedRows(uid, [o.overlay_id ?? o.id])
          if (!ov || kindOf(ov) !== 'image') continue
          o.imageUrl = ov.imageUrl
          delete o.overlay_id; delete o.id
        }
        ops.push(o as EditOp)
      }
      const step = newStep(ctx, { tool: 'edit_image', kind: 'image', label: `Edited #${src.id}: ${ops.map(o => o.op).join(', ')}`, status: 'running', model: `${agentName(ctx)} edit`, tickets: 0, posterUrl: src.imageUrl })
      try {
        const out = await editImage(src.imageUrl, ops)
        const saved = await saveEdit(ctx, out.png, input.note || `Edit of #${src.id}: ${out.applied.join(', ')}`, src)
        update(ctx, step, { status: 'done', mediaUrl: saved.url, generationId: saved.id, tickets: 0, note: out.applied.filter(a => a.startsWith('skipped')).join('; ') || undefined })
        const pic = await imagePart(saved.url)
        return { id: saved.id, size: `${out.width}x${out.height}`, applied: out.applied, ticketsCharged: 0, _pictures: pic ? [pic] : [] }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  const expand_image = tool({
    description: 'Extend an image to a new aspect by painting real scenery around it (Bria Fibo Expand, ~1 ticket) - better than padding when the subject needs room (e.g. a portrait still made 9:16 for a story).',
    inputSchema: jsonSchema<{ id: number; aspect: string; prompt?: string }>({ type: 'object', properties: { id: { type: 'integer' }, aspect: { type: 'string', enum: ASPECTS }, prompt: { type: 'string', description: 'Optional: what the new area should show' } }, required: ['id', 'aspect'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      if (!src || kindOf(src) !== 'image') return { error: 'That is not one of the user\'s images' }
      return runImageTool(ctx, 'bria-fibo-expand', clip(input.prompt, 800) || 'continue the scene naturally', src, { aspect: input.aspect }, `Expanded #${src.id} to ${input.aspect}`)
    },
  })

  const cutout = tool({
    description: 'Cut the subject out of an image onto a transparent background (Bria guided cut-out, ~1 ticket) - for logos, products and characters to place on other pictures with edit_image.',
    inputSchema: jsonSchema<{ id: number; keep?: string }>({ type: 'object', properties: { id: { type: 'integer' }, keep: { type: 'string', description: 'What to keep, e.g. "the cup and its steam"' } }, required: ['id'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      if (!src || kindOf(src) !== 'image') return { error: 'That is not one of the user\'s images' }
      return runImageTool(ctx, 'bria-guided-remove-bg', clip(input.keep, 400) || 'the main subject', src, {}, `Cut out #${src.id}`)
    },
  })

  // ── 6. memory ──
  const remember = tool({
    description: 'Remember something lasting about this user for all future chats: a preference ("likes warm, film-grain looks"), a brand rule ("logo always bottom-right", "never show prices"), a fact ("their product is a ceramic mug called Ember"). One short sentence. Only things they would want remembered - not one-off details.',
    inputSchema: jsonSchema<{ note: string }>({ type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }),
    execute: async (input) => {
      const notes = await addNovaNote(uid, input.note)
      newStep(ctx, { tool: 'remember', label: `Remembered: ${clip(input.note, 80)}`, status: 'done' })
      return { saved: true, notes: notes.length }
    },
  })
  const forget = tool({
    description: 'Forget a remembered note (by its id from the memory list in your instructions) when the user says it is wrong or out of date.',
    inputSchema: jsonSchema<{ note_id: string }>({ type: 'object', properties: { note_id: { type: 'string' } }, required: ['note_id'] }),
    execute: async (input) => {
      await removeNovaNote(uid, input.note_id)
      newStep(ctx, { tool: 'forget', label: 'Forgot a note', status: 'done' })
      return { forgotten: true }
    },
  })

  // ── 7. the critic ──
  const critique_work = tool({
    description: `Have the critic (${NOVA_CRITIC_MODEL}, a stronger model) review finished work against the brief before you hand it over: it sees the images / video frames and the measured sound, and returns pass or revise with concrete fixes. Use it once per production (final cut or a set of deliverables), then act on the fixes if it says revise. Costs about 1-2 tickets.`,
    inputSchema: jsonSchema<{ ids: number[]; brief?: string }>({ type: 'object', properties: { ids: { ...ids, description: 'The deliverables to review (max 6)' }, brief: { type: 'string', description: 'What was asked, if more than the user\'s message (format, brand rules, plan)' } }, required: ['ids'] }),
    execute: async (input) => {
      if (ctx.criticRuns >= 2) return { error: 'The critic already reviewed this turn twice - hand the work over and say what is left to improve.' }
      // One revise round: a second review only follows a "revise" (never re-check work that passed)
      if (ctx.criticRuns >= 1 && ctx.lastCriticVerdict === 'pass') return { error: 'The critic already passed this work - hand it over (mention its polish notes if useful).' }
      const rows = (await ownedRows(uid, input.ids)).slice(0, 6)
      if (!rows.length) return { error: 'None of those ids are the user\'s' }
      const step = newStep(ctx, { tool: 'critique_work', label: `Critic reviewing ${rows.map(r => `#${r.id}`).join(', ')}`, status: 'running' })
      try {
        const items = []
        for (const r of rows) {
          const k = kindOf(r)
          const rep = await inspectMedia(r.imageUrl, k === 'video' || k === 'cut' ? 'video' : k === 'audio' ? 'audio' : 'image', { frames: 4, maxFrameSide: 640 })
          let pictures = (rep.frames ?? []).map(f => ({ mime: 'image/jpeg', data: Buffer.from(f.jpeg).toString('base64') }))
          if (k === 'image') { const p = await imagePart(r.imageUrl); if (p) pictures = [{ mime: p.mediaType, data: Buffer.from(p.data.data).toString('base64') }] }
          // Pictures reach the critic flattened on white: say so, or a transparent cut-out reads as "a white background"
          if (k === 'image' && /\.png(\?|$)/i.test(r.imageUrl)) { try { const { default: sharp } = await import('sharp'); const { fetchMedia } = await import('@/lib/media-fetch'); const m = await sharp(Buffer.from(await (await fetchMedia(r.imageUrl)).arrayBuffer())).stats(); if (m.channels.length === 4 && m.channels[3].min < 250) rep.notes.push('Has a transparent background (shown here on white)') } catch { /* fine */ } }
          if (k === '3d') { const poster = posterOf(r); const p = poster ? await imagePart(poster) : null; if (p) pictures = [{ mime: p.mediaType, data: Buffer.from(p.data.data).toString('base64') }] }
          // Clips are WATCHED (motion and sound), the frames stay as a fallback
          // 90s: a cut's outro (and its last spoken words) is exactly what must not be missed
          const video = k === 'video' || k === 'cut' ? await watchableVideo(r.imageUrl, 90) : null
          items.push({ id: r.id, kind: k, model: r.model, prompt: r.prompt, pictures, facts: facts(rep), video })
        }
        const out = await critique({ model: NOVA_CRITIC_MODEL, brief: [ctx.brief, input.brief].filter(Boolean).join('\n'), items })
        ctx.extraUsd += out.usd
        ctx.criticRuns++
        ctx.lastCriticVerdict = out.critique.verdict
        await recordCritique(uid, rows.map(r => r.id), out.critique, NOVA_CRITIC_MODEL)
        // A model's habit the critic named becomes a lesson for that model (lib/nova/lessons)
        for (const i of out.critique.issues) { const r = rows.find(x => x.id === i.id); if (r && i.lesson) await addLesson(uid, r.model, i.lesson, 'critic').catch(() => {}) }
        update(ctx, step, { status: 'done', label: `Critic: ${out.critique.verdict === 'pass' ? 'pass' : 'revise'} · ${out.critique.score}/10`, note: clip(out.critique.summary, 140) })
        return {
          ...out.critique,
          next: out.critique.verdict === 'pass'
            ? 'PASSED - hand the work over now. Do not revise for the polish notes unless they are free and quick; mention them as optional next steps.'
            : `Fix ONLY the blocker issues, with the cheapest precise tool (edit_image / trim_media / recut before regenerating), in ONE round. ${ctx.criticRuns < 2 ? 'You may run the critic once more after regenerating a deliverable;' : 'No more critic runs this turn;'} skip it when the fixes were exact edits.`,
        }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  // ── 8. routing: which model for the job ──
  const recommend_models = tool({
    description: `The best models for a kind of job, ranked by the studio's scorecard (curated, then adjusted by real ratings, the user's own ratings and critic scores), with prices. Tasks: ${NOVA_TASKS.map(t => t.id).join(', ')}. Use it before choosing a model for anything that matters.`,
    inputSchema: jsonSchema<{ task: string; max_tickets?: number }>({ type: 'object', properties: { task: { type: 'string' }, max_tickets: { type: 'integer', description: 'Only models at or under this price' } }, required: ['task'] }),
    execute: async (input) => {
      const ranking = await recommend({ task: input.task, userId: uid, isAdmin: ctx.isAdmin, maxTickets: input.max_tickets })
      // The top picks' lessons from this account's past work
      const top = [...ranking.matchAll(/^\d+\. ([\w.:-]+)/gm)].map(m => m[1]).slice(0, 3)
      const learned = top.length ? lessonsFor(await loadLessons(uid), top) : ''
      return { ranking, ...(learned ? { learned } : {}) }
    },
  })

  // ── 10. references ──
  const caption_asset = tool({
    description: 'Look at every picture of an asset and caption it (angle, framing, outfit, expression...) and sort them, so you and Storyboard can pick the right reference per shot. About 1 ticket per 12 pictures.',
    inputSchema: jsonSchema<{ asset_id: number }>({ type: 'object', properties: { asset_id: { type: 'integer' } }, required: ['asset_id'] }),
    execute: async (input) => {
      const a = await findAsset(uid, input.asset_id)
      if (!a) return { error: 'No such asset' }
      const n = storedRefs(a.refs).length
      if (!n) return { error: 'The asset has no pictures yet' }
      const est = assetCaptionTickets(n)
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'caption_asset', label: `Captioned asset "${a.name}"`, status: 'running' })
      try {
        const { POST } = await import('@/app/api/user/assets/caption/route')
        const res = await POST(new NextRequest('http://internal/api/user/assets/caption', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: a.id }) }))
        const data = await res.json() as Record<string, any>
        if (!res.ok) throw new Error(String(data?.error || `Captioning failed (${res.status})`))
        /*
         * Billing sweep 2026-10-23: book what the route REALLY charged. It takes
         * today's free AI-text allowance first (lib/prompt-enhance chargeAiText)
         * and answers `tickets: 0` then - booking the estimate anyway counted
         * free captions against the user's plan and limits as if paid. Admins
         * still book the would-be price, like every other tool.
         */
        const charged = Math.max(0, Math.round(Number(data.tickets) || 0))
        const booked = ctx.isAdmin ? est : charged
        await settleSpend(ctx, est, booked)
        const refs = (data.asset?.refs ?? []) as { caption?: string }[]
        update(ctx, step, { status: 'done', note: `${refs.length} pictures captioned${!ctx.isAdmin && !charged ? ' (free allowance)' : ''}`, tickets: booked })
        return { captions: refs.map(r => r.caption).filter(Boolean).slice(0, 24) }
      } catch (e: any) {
        await settleSpend(ctx, est, 0)
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg })
        return { error: msg }
      }
    },
  })

  const update_asset_notes = tool({
    description: 'Write down who/what an asset is - appearance, materials, colours, personality, the rules that keep it on-model - so every later generation stays consistent. Replaces the notes.',
    inputSchema: jsonSchema<{ asset_id: number; notes: string }>({ type: 'object', properties: { asset_id: { type: 'integer' }, notes: { type: 'string' } }, required: ['asset_id', 'notes'] }),
    execute: async (input) => {
      const a = await findAsset(uid, input.asset_id)
      if (!a) return { error: 'No such asset' }
      await updateAsset(uid, a.id, { kind: a.kind, name: a.name, notes: assetNotes(input.notes), refs: storedRefs(a.refs) })
      newStep(ctx, { tool: 'update_asset_notes', label: `Updated notes for "${a.name}"`, status: 'done' })
      return { saved: true }
    },
  })

  const find_similar = tool({
    description: 'Find generations in the user\'s library similar to one of theirs (same subject, style or character) - by its prompt\'s key words and model. Look at the results with view_media before using them.',
    inputSchema: jsonSchema<{ id: number; limit?: number }>({ type: 'object', properties: { id: { type: 'integer' }, limit: { type: 'integer' } }, required: ['id'] }),
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      if (!src) return { error: 'That is not one of the user\'s generations' }
      const STOP = new Set('a an the and or of with in on at to for from by is are be this that it its as into over under very soft warm light lighting style shot image photo picture high quality detailed cinematic render background'.split(' '))
      const words = [...new Set(src.prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))].slice(0, 8)
      if (!words.length) return { items: [] }
      const rows = await prisma.generatedImage.findMany({
        where: { userId: uid, isDeleted: false, id: { not: src.id }, OR: words.map(w => ({ prompt: { contains: w, mode: 'insensitive' as const } })) },
        orderBy: { id: 'desc' }, take: 200,
        select: { id: true, imageUrl: true, model: true, prompt: true, videoMetadata: true, folderId: true, createdAt: true },
      })
      // Rank by how many key words match, then same model, then newest
      const ranked = rows.map(r => ({ r, s: words.filter(w => r.prompt.toLowerCase().includes(w)).length + (r.model === src.model ? 0.5 : 0) + (kindOf(r) === kindOf(src) ? 0.5 : 0) }))
        .sort((a, b) => b.s - a.s).slice(0, Math.min(20, Math.max(1, Number(input.limit) || 10)))
      ranked.forEach(x => ctx.seenIds.add(x.r.id))
      newStep(ctx, { tool: 'find_similar', label: `Looked for work like #${src.id}`, status: 'done', note: `${ranked.length} found` })
      return { matchedOn: words, items: ranked.map(x => ({ ...brief(x.r), match: Math.round(x.s * 10) / 10 })) }
    },
  })

  // ── 11. reusable artifacts ──
  const save_storyboard = tool({
    description: 'Save a shot list as a Storyboard the user can open, edit and shoot in Storyboard Studio: shots in order, each with what we see, the still prompt, the video prompt, models and seconds; an existing still (by id) can be attached to a shot.',
    inputSchema: jsonSchema<{ title: string; story?: string; look?: string; aspect?: string; shots: { title: string; description: string; image_prompt: string; video_prompt?: string; image_model?: string; video_model?: string; seconds?: number; still_id?: number }[] }>({
      type: 'object',
      properties: {
        title: { type: 'string' }, story: { type: 'string' }, look: { type: 'string', description: 'Style notes for every still' }, aspect: { type: 'string', enum: ASPECTS },
        shots: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, image_prompt: { type: 'string' }, video_prompt: { type: 'string' }, image_model: { type: 'string', description: `One of: ${STORYBOARD_IMAGE_MODELS.map(m => m.id).slice(0, 30).join(', ')}` }, video_model: { type: 'string', description: `One of: ${STORYBOARD_VIDEO_MODELS.slice(0, 30).join(', ')}` }, seconds: { type: 'number' }, still_id: { type: 'integer' } }, required: ['title', 'description', 'image_prompt'] } },
      },
      required: ['title', 'shots'],
    }),
    execute: async (input) => {
      const stills = new Map((await ownedRows(uid, (input.shots ?? []).map(s => s.still_id).filter((v): v is number => !!v))).filter(r => kindOf(r) === 'image').map(r => [r.id, r.imageUrl]))
      const shots = sanitizeShots((input.shots ?? []).slice(0, 60).map(s => newShot({
        title: clip(s.title, 120), description: clip(s.description, 1200), imagePrompt: clip(s.image_prompt, 4000), videoPrompt: clip(s.video_prompt, 2000),
        ...(s.image_model && STORYBOARD_IMAGE_MODELS.some(m => m.id === s.image_model) ? { imageModel: s.image_model } : {}),
        ...(s.video_model && (STORYBOARD_VIDEO_MODELS as readonly string[]).includes(s.video_model) ? { videoModel: s.video_model } : {}),
        duration: (DURATIONS as readonly number[]).reduce((a, b) => Math.abs(b - (Number(s.seconds) || 5)) < Math.abs(a - (Number(s.seconds) || 5)) ? b : a),
        stillUrl: s.still_id ? stills.get(s.still_id) ?? null : null,
      })))
      if (!shots.length) return { error: 'A storyboard needs at least one shot' }
      const board = await prisma.storyboard.create({
        data: { userId: uid, title: clip(input.title, 120) || 'Nova storyboard', story: clip(input.story, 4000), look: clip(input.look, 2000), aspect: ASPECTS.includes(String(input.aspect)) ? String(input.aspect) : '16:9', shots: shots as object[] },
        select: { id: true },
      })
      newStep(ctx, { tool: 'save_storyboard', label: `Saved storyboard "${clip(input.title, 60)}" (${shots.length} shots)`, status: 'done', note: 'Open it in Storyboard Studio' })
      return { storyboardId: board.id, shots: shots.length, note: 'The user can open it in Studios -> Storyboard Studio.' }
    },
  })

  const export_formats = tool({
    description: 'Make social-format versions of an image or video: e.g. 9:16 (Stories/Reels/TikTok), 1:1, 4:5 (feed), 16:9 (YouTube). Images are reframed with a blurred fill (free) or extended with real scenery (mode "expand", ~1 ticket each); videos are re-framed (cropped when little is lost, else fitted over a blurred fill; 1 ticket + 1 per 30s each). Saved to the chat folder.',
    inputSchema: jsonSchema<{ id: number; aspects: string[]; mode?: 'blur' | 'crop' | 'expand' }>({ type: 'object', properties: { id: { type: 'integer' }, aspects: { type: 'array', items: { type: 'string', enum: ASPECTS } }, mode: { type: 'string', enum: ['blur', 'crop', 'expand'], description: 'Images only (default blur)' } }, required: ['id', 'aspects'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const [src] = await ownedRows(uid, [input.id])
      if (!src) return { error: 'That is not one of the user\'s generations' }
      const k = kindOf(src)
      const aspects = [...new Set((input.aspects ?? []).filter(a => ASPECTS.includes(a)))].slice(0, 5)
      const made: { aspect: string; id?: number; error?: string }[] = []
      const pictures: any[] = []
      for (const aspect of aspects) {
        if (k === 'image') {
          if (input.mode === 'expand') {
            const r = await runImageTool(ctx, 'bria-fibo-expand', 'continue the scene naturally', src, { aspect }, `#${src.id} as ${aspect}`) as any
            made.push({ aspect, id: r.id ?? undefined, error: r.error }); if (r._pictures) pictures.push(...r._pictures)
            continue
          }
          const out = await editImage(src.imageUrl, [{ op: 'reframe', aspect, fill: 'blur', mode: input.mode === 'crop' ? 'crop' : 'pad' } as EditOp])
          const saved = await saveEdit(ctx, out.png, `#${src.id} as ${aspect}`, src, aspect)
          newStep(ctx, { tool: 'export_formats', kind: 'image', label: `#${src.id} as ${aspect}`, status: 'done', mediaUrl: saved.url, generationId: saved.id, tickets: 0, model: `${agentName(ctx)} reframe` })
          made.push({ aspect, id: saved.id })
          const p = await imagePart(saved.url); if (p) pictures.push(p)
        } else if (k === 'video' || k === 'cut') {
          const est = novaCutTickets(secondsOf(src))
          const refused = guard(ctx, est)
          if (refused) { made.push({ aspect, error: refused }); continue }
          // Billing sweep 2026-10-23: each format is paid BEFORE it renders (lib/nova/agent-tools prepayTool);
          // it used to render, fail to charge, and be saved anyway
          const unpaid = await prepayTool(ctx, est)
          if (unpaid) { await settleSpend(ctx, est, 0); made.push({ aspect, error: unpaid }); continue }
          const charged = ctx.isAdmin ? 0 : est
          let delivered = false
          // `prepaid` is saved with the step: a turn killed mid-render is refunded by sweepStaleTurns
          const step = newStep(ctx, { tool: 'export_formats', kind: 'cut', label: `#${src.id} as ${aspect}`, status: 'running', tickets: est, prepaid: charged })
          try {
            const out = await assemble({ op: 'conform', videoUrl: src.imageUrl, aspect })
            // The turn may have ended (Stop / time limit) and refunded this step already: then nothing is delivered
            if (!commitPrepaid(step)) throw new Error('Cut off before it finished - its tickets were refunded')
            const row = await prisma.generatedImage.create({
              data: { userId: uid, prompt: `#${src.id} as ${aspect}`, imageUrl: out.url, model: agentModel(ctx, 'final-cut'), ticketCost: charged, referenceImageUrls: [], expiresAt: FOREVER(), aspectRatio: aspect, folderId: ctx.state.folderId, videoMetadata: { isVideo: true, duration: String(Math.round(secondsOf(src))), width: out.width, height: out.height, aspectW: out.width, aspectH: out.height, novaExportOf: src.id } },
              select: { id: true },
            })
            delivered = true
            await settleSpend(ctx, est, est)
            ctx.seenIds.add(row.id)
            update(ctx, step, { status: 'done', mediaUrl: out.url, generationId: row.id, tickets: ctx.isAdmin ? est : charged, prepaid: 0, note: out.mode })
            made.push({ aspect, id: row.id })
          } catch (e: any) {
            // Never delivered: the prepaid estimate goes back, once (a failure after saving keeps its charge)
            if (!delivered) { if (!prepaidAbandoned(step)) await refundPrepaid(ctx, charged); await settleSpend(ctx, est, 0) }
            update(ctx, step, { status: 'error', error: String(e?.message || e).slice(0, 200), ...(delivered ? {} : { prepaid: 0 }) })
            made.push({ aspect, error: String(e?.message || e).slice(0, 200) })
          }
        } else made.push({ aspect, error: `${k} files cannot be reformatted` })
      }
      return { made, _pictures: pictures.slice(0, 5) }
    },
  })

  return {
    inspect_media, edit_image, expand_image, cutout,
    remember, forget, critique_work, recommend_models,
    caption_asset, update_asset_notes, find_similar, save_storyboard, export_formats,
  }
}
