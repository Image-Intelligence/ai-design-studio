import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireStoryboardUser, ownRefs, publicStillSafety } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { buildFalCall } from '@/lib/chat-hub-create'
import { fitRefsForModel } from '@/lib/fal-image-fit'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'
import { canEdit, isAdminOnlyModel, upscaleTickets, EXPAND_TICKETS, EXPAND_MAX_PIXELS } from '@/lib/image-studio-ai'
import { STORYBOARD_IMAGE_MODELS, SHOT_ASPECTS, sanitizeShots, shotAspect, stillModelSpec, stillBuildOptions, stillTickets, GPT_SIZE_FOR_ASPECT } from '@/lib/storyboard'
import { STILL_TOOLS, STILL_EDIT_DEFAULT_MODEL, STILL_EDIT_MAX_SIDE, CUTOUT_TICKETS, type StillToolId } from '@/lib/storyboard-tools'
import { claimStill, patchShot } from '@/lib/storyboard-store'
import { startStudioJob, failStudioJob } from '@/lib/studio-activity'
import { submitStillJob } from '@/lib/storyboard-stills'

/**
 * POST /api/employees/storyboards/[id]/still-edit - the Still edits phase.
 *
 * Body: { shotId, op, prompt?, model?, quality?, refs?: string[], aspect?, zoom? }
 *   edit        an AI edit of the shot's still from words (any picture model
 *               that edits), the board's cast pictures as extra references
 *   background  the same, told to keep the subject and replace the setting
 *   cutout      BiRefNet v2: the subject on transparency
 *   expand      Bria Fibo Expand: zoom out (`zoom` 0.5-1 of the new frame)
 *               and / or reach another frame (`aspect`, one of SHOT_ASPECTS)
 *   upscale     SeedVR2 2x, to 4096px on the long side at most
 * Returns: { queued: true, requestId, tickets, balance? } - made in the background
 * (2026-10-21): charged, sent to fal's queue, and saved onto the slot by
 * lib/storyboard-stills whether or not a page is open.
 *
 * Like the still route: the slot is claimed on the SERVER (stillJob "making",
 * refused if it already is), the result lands on the slot as a new
 * TAKE (the still it edited stays one), it is saved in My Generations >
 * Storyboards > <title>, and a failure is written on the slot and refunded.
 * Priced as lib/storyboard-tools stillToolTickets shows it, measured here.
 * Non-admins: admin-only models refused, the CCBill prompt filter, the
 * public moderation, and references from their own pictures only.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

const failText = (e: any) => {
  const detail = e?.body?.detail
  return Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : String(e?.message || e)
}
const ratio = (a: string) => { const [w, h] = a.split(':').map(Number); return w / h }

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const op = String(body.op ?? '') as StillToolId
  const tool = STILL_TOOLS.find(t => t.id === op)
  if (!tool) return jsonPrivate({ error: 'Unknown tool' }, { status: 400 })
  const shot = typeof body.shotId === 'string' ? sanitizeShots(board.shots).find(s => s.id === body.shotId) : undefined
  if (!shot) return jsonPrivate({ error: 'That shot is not on the board (save first?)' }, { status: 404 })
  if (!shot.stillUrl) return jsonPrivate({ error: 'Make this shot\'s still first' }, { status: 400 })
  const idGate = await requireOwnMediaUnlessVerified(user, [body.refs])
  if (idGate) return idGate

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  if (tool.prompt === 'required' && !prompt) return jsonPrivate({ error: op === 'background' ? 'Describe the new background' : 'Say what to change' }, { status: 400 })
  if (prompt) {
    const cf = await enforceContentFilter(prompt, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }
  const frame = shotAspect(shot, board.aspect)

  // The still, measured here
  let src: { buf: Buffer; w: number; h: number }
  try {
    const r = await fetchMedia(shot.stillUrl, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`(${r.status})`)
    const buf = Buffer.from(await r.arrayBuffer())
    const m = await sharp(buf).metadata()
    if (!m.width || !m.height) throw new Error('not a picture')
    src = { buf, w: m.width, h: m.height }
  } catch (e) {
    return jsonPrivate({ error: `Could not read the still ${failText(e)}`.slice(0, 200) }, { status: 502 })
  }

  // ── what the run is, and what it costs ──
  let cost = 0
  let endpoint = ''
  let input: Record<string, unknown> = {}
  let model = ''
  let note = ''
  let newAspect: string | null | undefined
  let quality: string | undefined
  let refs: string[] = []
  if (op === 'edit' || op === 'background') {
    const spec = STORYBOARD_IMAGE_MODELS.find(m => m.id === (body.model || STILL_EDIT_DEFAULT_MODEL))
    if (!spec || !canEdit(spec.id)) return jsonPrivate({ error: `${spec?.label ?? 'That model'} cannot edit a picture - pick another` }, { status: 400 })
    if (!user.isAdmin && isAdminOnlyModel(spec.id)) return jsonPrivate({ error: 'This model is not available' }, { status: 403 })
    const knobs = stillModelSpec(spec.id)
    quality = typeof body.quality === 'string' && knobs.qualities.includes(body.quality) ? body.quality : (knobs.defQuality || '2k')
    // The still first, then the cast pictures the user picked (their own only)
    const cast = await ownRefs(user, (Array.isArray(body.refs) ? body.refs : []).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u) && u !== shot.stillUrl).slice(0, 13))
    refs = [shot.stillUrl, ...cast].slice(0, Math.max(1, knobs.maxRefs))
    const castNote = refs.length > 1 ? ` The first image is the picture to edit; the other ${refs.length - 1} are reference pictures of the cast and props - match faces, hair, costumes and products to them exactly.` : ''
    const full = op === 'background'
      ? `Keep the subject exactly as it is - the same pose, face, clothes and framing, lit to match - and replace the background with: ${prompt}.${castNote}`
      : `${prompt}. Keep everything else in the picture the same - the same people, faces, clothes, setting, framing and lighting.${castNote}`
    const call = buildFalCall(spec.id, full, await fitRefsForModel(spec.id, refs), { aspect: spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[frame] ?? '1024x1024') : frame, quality }, stillBuildOptions(spec.id, body.options))
    if ('error' in call) return jsonPrivate({ error: call.error }, { status: 400 })
    publicStillSafety(spec.id, call.input as Record<string, unknown>, user.isAdmin)
    endpoint = call.endpoint; input = call.input as Record<string, unknown>; model = spec.id
    cost = stillTickets(spec.id, quality, frame, body.options as Record<string, string> | undefined, refs.length)
    note = `${op === 'background' ? 'New background' : 'Edit'}: ${prompt}`
  } else if (op === 'cutout') {
    endpoint = 'fal-ai/birefnet/v2'; model = 'birefnet-v2'; cost = CUTOUT_TICKETS
    input = { image_url: shot.stillUrl, operating_resolution: '2048x2048', output_format: 'png' }
    note = 'Background removed'
  } else if (op === 'expand') {
    const target = (SHOT_ASPECTS as readonly string[]).includes(String(body.aspect)) ? String(body.aspect) : frame
    const zoom = Math.max(0.5, Math.min(1, Number(body.zoom) || 1))
    // The new frame: the still at `zoom` of it, then widened or heightened to the target shape
    let W = src.w / zoom, H = src.h / zoom
    if (W / H < ratio(target)) W = H * ratio(target); else H = W / ratio(target)
    if (W <= src.w * 1.02 && H <= src.h * 1.02) return jsonPrivate({ error: 'Nothing to expand - zoom out, or pick a wider or taller frame' }, { status: 400 })
    // Kept under Bria's limits by shrinking the still first
    const k = Math.min(1, Math.sqrt(EXPAND_MAX_PIXELS * 0.9 / (W * H)), 4800 / W, 4800 / H)
    let img: string = shot.stillUrl
    let w = src.w, h = src.h
    if (k < 1) {
      w = Math.max(16, Math.round(src.w * k)); h = Math.max(16, Math.round(src.h * k))
      img = `data:image/png;base64,${(await sharp(src.buf).resize(w, h, { fit: 'fill' }).png().toBuffer()).toString('base64')}`
      W *= k; H *= k
    }
    W = Math.round(W); H = Math.round(H)
    endpoint = 'bria/fibo-edit-1.5/expand'; model = 'bria-fibo-expand'; cost = EXPAND_TICKETS
    input = { image_url: img, canvas_size: [W, H], original_image_size: [w, h], original_image_location: [Math.round((W - w) / 2), Math.round((H - h) / 2)], ...(prompt ? { prompt } : {}) }
    newAspect = target === board.aspect ? null : target
    note = `Expanded${zoom < 1 ? ' (zoomed out)' : ''} to ${target}${prompt ? `: ${prompt}` : ''}`
  } else {
    const f = Math.min(2, STILL_EDIT_MAX_SIDE / Math.max(src.w, src.h))
    if (f < 1.05) return jsonPrivate({ error: 'This still is already as large as it can go' }, { status: 400 })
    const factor = Math.round(f * 100) / 100
    endpoint = 'fal-ai/seedvr/upscale/image'; model = 'seedvr2-upscale'; cost = upscaleTickets('seedvr2-upscale', factor, src.w, src.h)
    input = { image_url: shot.stillUrl, upscale_mode: 'factor', upscale_factor: factor, output_format: 'png' }
    note = `Upscaled ${factor}x (SeedVR2) to ${Math.round(src.w * factor)}x${Math.round(src.h * factor)}`
  }

  // Claimed for this request, or refused - then paid for (admins are skipped by the gate)
  if (!(await claimStill(board.id, shot.id, model))) return jsonPrivate({ error: 'This still is already being made', busy: true }, { status: 409 })
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  if (!paid.ok) {
    await patchShot(board.id, shot.id, { stillJob: null }).catch(() => {})
    return jsonPrivate({ error: `${tool.label} needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })
  }
  // The feed's generating tile for it (lib/studio-activity)
  const track = await startStudioJob({ userId: user.id, modelType: 'image', modelId: model, prompt: `${note} (Storyboard still edit)`, studio: 'storyboard-still-edit', aspectRatio: frame, quality: quality || undefined })
  const fail = async (error: string, status: number) => {
    await refundGenerationTickets(user.id, user.email, cost)
    await failStudioJob(track, error)
    await patchShot(board.id, shot.id, { stillJob: { status: 'failed', at: Date.now(), model, error: error.slice(0, 400) } }).catch(() => {})
    return jsonPrivate({ error }, { status })
  }

  // Made in the BACKGROUND (2026-10-21): sent to fal's queue now, saved onto
  // the slot by lib/storyboard-stills - no page has to stay open for it
  try {
    const requestId = await submitStillJob(board.id, shot.id, endpoint, input, {
      cost: paid.newBalance >= 0 ? cost : 0, track, prompt: `${note} (Storyboard still edit)`.slice(0, 4000), takePrompt: note, model,
      ...(quality ? { quality } : {}), aspect: newAspect === undefined ? frame : (newAspect ?? board.aspect),
      refs: refs.length ? refs : [shot.stillUrl], conform: op === 'edit' || op === 'background' ? frame : null,
      name: `storyboard-${user.id}-${board.id}-${op}`, ...(newAspect !== undefined ? { patch: { aspect: newAspect } } : {}),
    })
    return jsonPrivate({ queued: true, requestId, tickets: user.isAdmin ? 0 : cost, ...(paid.newBalance >= 0 ? { balance: paid.newBalance } : {}) })
  } catch (e) {
    return fail(`${tool.label} failed: ${failText(e).slice(0, 240)}`, 502)
  }
}
