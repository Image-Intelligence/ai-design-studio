import { fitRefsForModel } from '@/lib/fal-image-fit'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { publicStillSafety, ownRefs } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { isAdminOnlyModel, modelAspects, nearestAspect } from '@/lib/image-studio-ai'
import { HIGGSFIELD_IMAGE_MODELS } from '@/lib/higgsfield-models'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { buildFalCall } from '@/lib/chat-hub-create'
import { ensureThumbnail } from '@/lib/thumbnail'
import { STORYBOARD_IMAGE_MODELS, stillModelSpec, stillBuildOptions, stillTickets, GPT_SIZE_FOR_ASPECT, sanitizeShots, shotAspect } from '@/lib/storyboard'
import { claimStill, patchShot, queueStills } from '@/lib/storyboard-store'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'
import { conformToFrame } from '@/lib/storyboard-image'
import { startStudioJob, finishStudioJob, failStudioJob } from '@/lib/studio-activity'
import { storyboardFolder as boardFolder, submitStillJob, submitHiggsfieldStill, submitHiggsfieldImage, waitHiggsfieldImage, adoptHiggsfieldStill } from '@/lib/storyboard-stills'

/**
 * POST /api/employees/storyboards/[id]/still - make one slot's still.
 *
 * Body: { prompt, model, shotId?, quality?, options?: Record<string, string>, refs?: string[] }
 * Returns: with a shotId { queued: true, requestId } - the still is made in the
 *          BACKGROUND (2026-10-21): charged, sent to fal's queue, and saved onto
 *          the slot by lib/storyboard-stills whether or not a page is open.
 *          Without one { url, imageId } (made while you wait, as before).
 *          409 { busy: true } = that slot's still is being made already
 *    or:   { batch: [{ shotId, prompt, model, quality?, options?, refs? }] } every
 *          still of a batch submitted HERE, by the server - the page no longer
 *          runs a batch three at a time (a locked phone stopped it) ->
 *          { results: { [shotId]: { queued } | { error } } }
 *    or:   { queue: string[] } marks those slots "queued" (kept for old pages) -> { ok: true }
 *    or:   { adopt: dataUrl, shotId } - a picture edited in the Image Studio
 *          popup becomes the slot's still (a new take; the old one stays)
 *          -> { url, imageId }
 *
 * With a `shotId` the slot is tracked ON THE SERVER (shot.stillJob): marked
 * "making" before the model runs - refused if it already is, so no slot is
 * made (and paid for) twice from two tabs or devices - and when the still
 * lands it is put on the slot here, with its take, not left to the page. A
 * refresh mid-still, or another session, sees the same state and the result.
 *
 * The board's look notes are appended to the prompt and its aspect ratio is
 * used, so every slot of a board shares one look and one frame - unless the
 * shot has a frame of its own (shot.aspect: a panorama, a poster). The call is
 * built by lib/chat-hub-create's buildFalCall (the same shapes the hub uses),
 * run synchronously, re-hosted on R2 and saved to the account's library under
 * My Generations > Storyboards > <board title>, so a still is never lost if
 * the slot is regenerated.
 *
 * Any signed-in account (public 2026-10-07). A still costs what it costs in
 * the portal (stillTickets - the model, quality, frame, settings and refs),
 * charged before the model runs and refunded if it fails; admins are not
 * charged. Non-admins: admin-only models refused, the CCBill prompt filter,
 * and the public moderation (lib/storyboard-gate publicStillSafety).
 *
 * Higgsfield's Soul 2 / Soul / Marketing Studio (2026-10-22) are not fal
 * models: makeHiggsfieldStill sends them through Higgsfield's own route
 * (lib/storyboard-stills submitHiggsfieldImage), which charges them as the
 * portal does and whose failures lib/higgsfield refunds; a slot's still is
 * settled onto it by lib/storyboard-stills like a fal one.
 */
export const maxDuration = 300
/** A still without a slot waits this long for Higgsfield (the route stops at maxDuration). */
const HF_WAIT_MS = 240_000

type Ctx = { params: Promise<{ id: string }> }



export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  // Not ID-verified: references only from the account's OWN generations
  // (CCBill: uploads need a verified account; admins exempt - lib/id-verification)
  const idGate = await requireOwnMediaUnlessVerified(user, [
    body.refs, ...(Array.isArray(body.queue) ? (body.queue as { refs?: unknown }[]).map(q => q?.refs) : []),
    ...(Array.isArray(body.batch) ? (body.batch as { refs?: unknown }[]).map(q => q?.refs) : []),
  ])
  if (idGate) return idGate
  // A batch: its slots show as queued everywhere until each one's turn
  if (Array.isArray(body.queue)) {
    const ids = (body.queue as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 200)
    await queueStills(board.id, ids)
    return jsonPrivate({ ok: true })
  }
  /*
   * An Image Studio edit coming back: a JPEG/PNG data URL (the popup flattens
   * the edit). It becomes a new take of the slot and a picture in the board's
   * folder, like any still - so it can be edited from, shot and cut.
   */
  if (typeof body.adopt === 'string') {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(body.adopt)
    const shot = typeof body.shotId === 'string' ? sanitizeShots(board.shots).find(s => s.id === body.shotId) : undefined
    if (!m || !shot) return jsonPrivate({ error: 'Send the edited picture and its shot' }, { status: 400 })
    const raw = Buffer.from(m[2], 'base64')
    if (raw.length > 25 * 1024 * 1024) return jsonPrivate({ error: 'The edit is too large' }, { status: 413 })
    const meta = await sharp(raw).metadata().catch(() => null)
    if (!meta?.width) return jsonPrivate({ error: 'That is not a picture' }, { status: 400 })
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    const url = await uploadToR2(`storyboard-${user.id}-${board.id}-edit-${Date.now()}.${ext}`, raw, `image/${m[1]}`)
    const note = `Edited in the Image Studio${shot.imagePrompt ? ` - from: ${shot.imagePrompt}` : ''}`.slice(0, 4000)
    const row = await prisma.generatedImage.create({
      data: {
        userId: user.id, prompt: note, imageUrl: url, model: 'image-studio-edit', ticketCost: 0, referenceImageUrls: shot.stillUrl ? [shot.stillUrl] : [],
        folderId: await boardFolder(user.id, board.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        aspectRatio: shotAspect(shot, board.aspect),
      },
    })
    await ensureThumbnail(row.id).catch(() => {})
    await patchShot(board.id, shot.id, { stillUrl: url, stillJob: null }, { url, prompt: note, model: 'image-studio-edit', at: Date.now() })
    return jsonPrivate({ url, imageId: row.id })
  }

  // A batch: every still sent from here, a few at a time - nothing waits on the page
  if (Array.isArray(body.batch)) {
    const items = (body.batch as Record<string, unknown>[]).filter(x => x && typeof x.shotId === 'string').slice(0, 60)
    const results: Record<string, unknown> = {}
    let i = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < items.length) {
        const it = items[i++]
        const r = await makeStill(user, board, it)
        results[String(it.shotId)] = r.body
      }
    }))
    return jsonPrivate({ results })
  }
  const r = await makeStill(user, board, body)
  return jsonPrivate(r.body, { status: r.status })
}

type StoryboardUser = NonNullable<Awaited<ReturnType<typeof requireStoryboardUser>>>
type BoardRow = NonNullable<Awaited<ReturnType<typeof prisma.storyboard.findFirst>>>

/** One still: checked, charged, then sent to fal's queue for a slot (or made at once without one). */
async function makeStill(user: StoryboardUser, board: BoardRow, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = (b: Record<string, unknown>, init?: { status?: number }) => ({ status: init?.status ?? 200, body: b })
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
  if (!prompt) return out({ error: 'Write an image prompt first' }, { status: 400 })
  const spec = STORYBOARD_IMAGE_MODELS.find(m => m.id === body.model)
  if (!spec) return out({ error: 'Unknown image model' }, { status: 400 })
  // Admin-only models stay admin-only here too (as in /api/generate)
  if (!user.isAdmin && isAdminOnlyModel(spec.id)) return out({ error: 'This model is not available' }, { status: 403 })
  // The CCBill prompt filter - before any charge or provider call
  {
    const cf = await enforceContentFilter(prompt, user.email)
    if (!cf.ok) return out({ error: cf.reason }, { status: 400 })
  }
  // The model's own limits: how many refs it takes (Recraft none, Kling V3
  // one, NanoBanana Pro 2 fourteen...) and which qualities it offers
  const knobs = stillModelSpec(spec.id)
  // A non-admin's references are their own pictures only - a model can copy
  // whatever it is shown (lib/media-ownership)
  const refs = await ownRefs(user, spec.refs && Array.isArray(body.refs)
    ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, knobs.maxRefs)
    : [])
  const quality = typeof body.quality === 'string' && knobs.qualities.includes(body.quality) ? body.quality : (knobs.defQuality || '2k')

  const fullPrompt = [prompt, board.look.trim() && `Look: ${board.look.trim()}`].filter(Boolean).join('\n\n')
  // The slot, when the board has it saved
  const shotId = typeof body.shotId === 'string' ? body.shotId : ''
  const shot = shotId ? sanitizeShots(board.shots).find(s => s.id === shotId) : undefined
  // The shot's own frame (a panorama, a poster) or the board's
  const frame = shot ? shotAspect(shot, board.aspect) : board.aspect
  // Higgsfield's: their own route and queue, not fal
  if (HIGGSFIELD_IMAGE_MODELS.has(spec.id)) return makeHiggsfieldStill(user, board, spec, { prompt, fullPrompt, refs, quality, frame, shot })
  // GPT Image takes a pixel size rather than a ratio
  const aspect = spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[frame] ?? '1024x1024') : frame
  // The model's other settings, kept to the values it offers (stillSettings)
  // Sized for the model where it limits uploads (Ideogram); the record keeps the originals
  const callRefs = await fitRefsForModel(spec.id, refs)
  const call = buildFalCall(spec.id, fullPrompt, callRefs, { aspect, quality }, stillBuildOptions(spec.id, body.options))
  if ('error' in call) return out({ error: call.error }, { status: 400 })
  // A non-admin's still runs at the site's public moderation
  publicStillSafety(spec.id, call.input as Record<string, unknown>, user.isAdmin)

  // Claimed for this request, or refused
  if (shot && !(await claimStill(board.id, shot.id, spec.id))) {
    return out({ error: 'This still is already being made', busy: true }, { status: 409 })
  }
  // Paid for before the model runs (admins are skipped by the gate)
  const cost = stillTickets(spec.id, quality, frame, body.options as Record<string, string> | undefined, refs.length)
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  if (!paid.ok) {
    if (shot) await patchShot(board.id, shot.id, { stillJob: null }).catch(() => {})
    return out({ error: `This still needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })
  }
  // The feed's generating tile for it (lib/studio-activity)
  const track = await startStudioJob({ userId: user.id, modelType: 'image', modelId: spec.id, prompt: fullPrompt, studio: 'storyboard-still', aspectRatio: frame, quality })
  // A failure is written on the slot too, so every session sees why - and refunded
  const fail = async (error: string, status: number) => {
    await refundGenerationTickets(user.id, user.email, cost)
    await failStudioJob(track, error)
    if (shot) await patchShot(board.id, shot.id, { stillJob: { status: 'failed', at: Date.now(), model: spec.id, error: error.slice(0, 400) } }).catch(() => {})
    return out({ error }, { status })
  }

  // A slot's still is made in the BACKGROUND: sent to fal's queue now, saved
  // onto the slot by lib/storyboard-stills - no page has to stay open for it
  if (shot) {
    try {
      const requestId = await submitStillJob(board.id, shot.id, call.endpoint, call.input as Record<string, unknown>, {
        cost: paid.newBalance >= 0 ? cost : 0, track, prompt: fullPrompt, takePrompt: prompt, model: spec.id, quality, aspect: frame, refs,
        conform: frame, name: `storyboard-${user.id}-${board.id}`, ...(shot.imagePrompt ? {} : { patch: { imagePrompt: prompt } }),
      })
      return out({ queued: true, requestId })
    } catch (e: any) {
      const detail = e?.body?.detail
      const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
      return fail(msg ? `${spec.label} refused: ${String(msg).slice(0, 240)}` : 'The model could not be reached', 502)
    }
  }

  let falUrl: string | undefined
  try {
    const out: any = await fal.subscribe(call.endpoint, { input: call.input })
    falUrl = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
  } catch (e: any) {
    const detail = e?.body?.detail
    const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
    return fail(msg ? `${spec.label} refused: ${String(msg).slice(0, 240)}` : 'The model failed', 502)
  }
  if (!falUrl) return fail('The model returned no image', 502)

  const res = await fetch(falUrl).catch(() => null)
  if (!res?.ok) return fail('Could not fetch the result', 502)
  let buf = Buffer.from(await res.arrayBuffer())
  let ct = res.headers.get('content-type') ?? 'image/png'
  // Not in the board's frame (the model followed a reference's shape): fit it
  const fitted = await conformToFrame(buf, frame).catch(() => null)
  if (fitted) { buf = Buffer.from(fitted.buf); ct = 'image/png'; console.log(`[storyboard still] ${spec.id} came back off-frame - ${fitted.how} to ${frame}`) }
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
  const url = await uploadToR2(`storyboard-${user.id}-${board.id}-${Date.now()}.${ext}`, buf, ct)
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id, prompt: fullPrompt, imageUrl: url, model: spec.id, ticketCost: user.isAdmin ? 0 : cost, referenceImageUrls: refs,
      folderId: await boardFolder(user.id, board.title),
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      quality, aspectRatio: frame,
    },
  })
  await ensureThumbnail(row.id).catch(() => {})
  await finishStudioJob(track, [row.id], url)
  // (no slot: nothing to put it on - a slot's still is saved by lib/storyboard-stills)
  return out({ url, imageId: row.id })
}

/**
 * A Higgsfield still (Soul 2 / Soul / Marketing Studio). Charged by
 * Higgsfield's route at the portal's price (higgsfieldImageTicketCost - the
 * same number stillTickets shows), admins free; a failure is refunded by
 * lib/higgsfield, never here. The route's queue row is the feed's tile and its
 * GeneratedImage the still's row, so no studio tile or second row is made.
 * Sent at the model's nearest frame (Soul has no 21:9) and fitted to the
 * shot's when it lands, as a fal still is.
 */
async function makeHiggsfieldStill(
  user: StoryboardUser, board: BoardRow, spec: { id: string; label: string },
  o: { prompt: string; fullPrompt: string; refs: string[]; quality: string; frame: string; shot?: ReturnType<typeof sanitizeShots>[number] },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = (b: Record<string, unknown>, status = 200) => ({ status, body: b })
  const frames = modelAspects(spec.id).filter(a => a !== 'auto')
  const [fw, fh] = o.frame.split(':').map(Number)
  const aspect = frames.includes(o.frame) ? o.frame : nearestAspect(fw || 16, fh || 9, frames)
  const req = { model: spec.id, prompt: o.fullPrompt, aspect, quality: o.quality, refs: o.refs }
  const name = `storyboard-${user.id}-${board.id}`
  // The route's own refusals are user-facing; 402 = not enough tickets
  const refused = (r: { status: number; error: string }) => out({ error: r.error, ...(r.status === 402 ? { needTickets: true } : {}) }, r.status >= 400 ? r.status : 502)

  // A slot's still: claimed, queued, and settled onto the slot by lib/storyboard-stills
  if (o.shot) {
    const shot = o.shot
    if (!(await claimStill(board.id, shot.id, spec.id))) return out({ error: 'This still is already being made', busy: true }, 409)
    const r = await submitHiggsfieldStill(board.id, shot.id, req, {
      prompt: o.fullPrompt, takePrompt: o.prompt, model: spec.id, quality: o.quality, aspect: o.frame, refs: o.refs,
      conform: o.frame, name, ...(shot.imagePrompt ? {} : { patch: { imagePrompt: o.prompt } }),
    })
    if (r.ok) return out({ queued: true, requestId: r.requestId })
    // Nothing was charged, or lib/higgsfield refunded it: only the slot to free (or mark)
    await patchShot(board.id, shot.id, {
      stillJob: r.status === 402 ? null : { status: 'failed', at: Date.now(), model: spec.id, error: r.error.slice(0, 400) },
    }).catch(() => {})
    return refused(r)
  }

  // No slot: made while you wait, as the fal path does
  const sub = await submitHiggsfieldImage(req)
  if (!sub.ok) return refused(sub)
  const done = await waitHiggsfieldImage(sub.queueId, Date.now() + HF_WAIT_MS)
  if (done.status === 'failed') return out({ error: `${spec.label} failed: ${done.error.slice(0, 240)}` }, 502)
  if (done.status === 'waiting') return out({ error: `${spec.label} is still making it - it will land in My Generations when it finishes`, pending: true }, 504)
  const url = await adoptHiggsfieldStill(done, { userId: user.id, title: board.title, conform: o.frame, name })
  return out({ url, imageId: done.imageId })
}
