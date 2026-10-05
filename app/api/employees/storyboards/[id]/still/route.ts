import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { buildFalCall } from '@/lib/chat-hub-create'
import { ensureThumbnail } from '@/lib/thumbnail'
import { STORYBOARD_IMAGE_MODELS, stillModelSpec, stillBuildOptions, GPT_SIZE_FOR_ASPECT, sanitizeShots } from '@/lib/storyboard'
import { claimStill, patchShot, queueStills } from '@/lib/storyboard-store'

/**
 * POST /api/employees/storyboards/[id]/still - make one slot's still.
 *
 * Body: { prompt, model, shotId?, quality?, options?: Record<string, string>, refs?: string[] }
 * Returns: { url, imageId }   409 { busy: true } = that slot's still is being made already
 *    or:   { queue: string[] } marks those slots "queued" for a batch -> { ok: true }
 *
 * With a `shotId` the slot is tracked ON THE SERVER (shot.stillJob): marked
 * "making" before the model runs - refused if it already is, so no slot is
 * made (and paid for) twice from two tabs or devices - and when the still
 * lands it is put on the slot here, with its take, not left to the page. A
 * refresh mid-still, or another session, sees the same state and the result.
 *
 * The board's look notes are appended to the prompt and its aspect ratio is
 * used, so every slot of a board shares one look and one frame. The call is
 * built by lib/chat-hub-create's buildFalCall (the same shapes the hub uses),
 * run synchronously, re-hosted on R2 and saved to the account's library under
 * My Generations > Storyboards > <board title>, so a still is never lost if
 * the slot is regenerated.
 *
 * ADMIN ONLY. No tickets: the Studios section is admin-only for now.
 */
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Put a still into the board's frame when the model ignored it - Luma Uni-1's
 * edit has no size setting at all and returns the reference's shape, and any
 * model can drift. A small difference (up to 30% of the picture) is cropped,
 * keeping the most interesting part (sharp's attention strategy); a big one -
 * a portrait reference on a 16:9 board - is fitted whole over a blurred,
 * darkened copy of itself, so no face or product is cut off.
 */
async function conformToFrame(buf: Buffer, aspect: string): Promise<{ buf: Buffer; how: 'crop' | 'fit' } | null> {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  if (!m) return null
  const target = Number(m[1]) / Number(m[2])
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 0, h = meta.height ?? 0
  if (!w || !h) return null
  const r = w / h
  if (Math.abs(Math.log(r / target)) < 0.02) return null
  const lost = 1 - Math.min(r / target, target / r)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  // A crop stays inside the still (never upscaled); a fit pads out around it
  const tall = r < target
  if (lost <= 0.3) {
    const size = tall ? { width: w, height: even(w / target) } : { width: even(h * target), height: h }
    return { buf: await sharp(buf).resize({ ...size, fit: 'cover', position: sharp.strategy.attention }).png().toBuffer(), how: 'crop' }
  }
  const size = tall ? { width: even(h * target), height: h } : { width: w, height: even(w / target) }
  const bg = await sharp(buf).resize({ ...size, fit: 'cover' }).blur(40).modulate({ brightness: 0.55 }).toBuffer()
  const fg = await sharp(buf).resize({ ...size, fit: 'inside' }).toBuffer()
  return { buf: await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).png().toBuffer(), how: 'fit' }
}

async function boardFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Storyboards', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Storyboards', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled storyboard'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  // A batch: its slots show as queued everywhere until each one's turn
  if (Array.isArray(body.queue)) {
    const ids = (body.queue as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 200)
    await queueStills(board.id, ids)
    return jsonPrivate({ ok: true })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
  if (!prompt) return jsonPrivate({ error: 'Write an image prompt first' }, { status: 400 })
  const spec = STORYBOARD_IMAGE_MODELS.find(m => m.id === body.model)
  if (!spec) return jsonPrivate({ error: 'Unknown image model' }, { status: 400 })
  // The model's own limits: how many refs it takes (Recraft none, Kling V3
  // one, NanoBanana Pro 2 fourteen...) and which qualities it offers
  const knobs = stillModelSpec(spec.id)
  const refs = spec.refs && Array.isArray(body.refs)
    ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, knobs.maxRefs)
    : []
  const quality = typeof body.quality === 'string' && knobs.qualities.includes(body.quality) ? body.quality : (knobs.defQuality || '2k')

  const fullPrompt = [prompt, board.look.trim() && `Look: ${board.look.trim()}`].filter(Boolean).join('\n\n')
  // GPT Image takes a pixel size rather than a ratio
  const aspect = spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[board.aspect] ?? '1024x1024') : board.aspect
  // The model's other settings, kept to the values it offers (stillSettings)
  const call = buildFalCall(spec.id, fullPrompt, refs, { aspect, quality }, stillBuildOptions(spec.id, body.options))
  if ('error' in call) return jsonPrivate({ error: call.error }, { status: 400 })

  // The slot, when the board has it saved: claimed for this request, or refused
  const shotId = typeof body.shotId === 'string' ? body.shotId : ''
  const shot = shotId ? sanitizeShots(board.shots).find(s => s.id === shotId) : undefined
  if (shot && !(await claimStill(board.id, shot.id, spec.id))) {
    return jsonPrivate({ error: 'This still is already being made', busy: true }, { status: 409 })
  }
  // A failure is written on the slot too, so every session sees why
  const fail = async (error: string, status: number) => {
    if (shot) await patchShot(board.id, shot.id, { stillJob: { status: 'failed', at: Date.now(), model: spec.id, error: error.slice(0, 400) } }).catch(() => {})
    return jsonPrivate({ error }, { status })
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
  const fitted = await conformToFrame(buf, board.aspect).catch(() => null)
  if (fitted) { buf = Buffer.from(fitted.buf); ct = 'image/png'; console.log(`[storyboard still] ${spec.id} came back off-frame - ${fitted.how} to ${board.aspect}`) }
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
  const url = await uploadToR2(`storyboard-${user.id}-${board.id}-${Date.now()}.${ext}`, buf, ct)
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id, prompt: fullPrompt, imageUrl: url, model: spec.id, ticketCost: 0, referenceImageUrls: refs,
      folderId: await boardFolder(user.id, board.title),
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      quality, aspectRatio: board.aspect,
    },
  })
  await ensureThumbnail(row.id).catch(() => {})
  // The still goes on the slot here - the page may be gone (refreshed, closed)
  if (shot) {
    await patchShot(board.id, shot.id, { stillUrl: url, stillJob: null, ...(shot.imagePrompt ? {} : { imagePrompt: prompt }) }, { url, prompt, model: spec.id, at: Date.now() })
      .catch(() => {})
  }
  return jsonPrivate({ url, imageId: row.id })
}
