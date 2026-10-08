import { enforcePublicModeration } from '@/lib/public-moderation'
import { enforceContentFilter } from '@/lib/content-filter'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl, signMediaUrl } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { uploadToR2, userKey } from '@/lib/r2'
import { ensureThumbnail } from '@/lib/thumbnail'
import { buildFalCall } from '@/lib/chat-hub-create'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { stillModelSpec, stillBuildOptions, GPT_SIZE_FOR_ASPECT } from '@/lib/storyboard'
import { requireIdVerified } from '@/lib/id-verification'
import {
  type StudioGenOp, FILL_MAX_PIXELS, EXPAND_MAX_PIXELS, UPSCALE_MAX_SIDE, ERASE_TICKETS, EXPAND_TICKETS,
  fillTickets, isUpscaler, upscaleFactor, upscaleTickets, UPSCALERS, STUDIO_IMAGE_MODELS, genTickets, canEdit, isAdminOnlyModel, validAspect,
} from '@/lib/image-studio-ai'

/**
 * POST /api/employees/image-studio/[id]/ai - the studio's generative tools.
 *
 * Body: { op, image?, mask?, prompt?, model?, quality?, aspect?, upscaler?, factor?, maxSide?, expand? }
 *   image / mask are files the page put in R2 first (../../upload, kind 'ai'):
 *   a layer can be far bigger than a request body may be.
 *
 *   fill      image + mask (white = fill) + prompt -> FLUX.1 Pro Fill
 *   erase     image + mask (white = remove)        -> Bria Eraser
 *   expand    image + expand { canvas: [W, H], at: [x, y] } (+ prompt) -> Bria Expand:
 *             the picture placed at `at` in a W x H frame, the rest painted in
 *   upscale   image + upscaler + factor (+ maxSide: the long edge it may reach)
 *   edit      image + prompt (the instruction) + model / quality / aspect
 *   generate  prompt + model / quality / aspect (+ image as a reference)
 *
 * Returns: { url, width, height, tickets, balance, imageId }
 *
 * Priced by lib/image-studio-ai - the same functions that price the page's
 * buttons - from the inputs as measured HERE, never from what the page says.
 * Charged before the model runs, refunded if it fails. Every result is
 * re-hosted on R2 and saved to My Generations > Image Studio > <canvas title>.
 * A studio canvas (numeric id) is ADMIN ONLY, like the Studios section. The id
 * "edit" is the Edit Image popup - any signed-in account, results filed under
 * Image Studio > Edits. Admins are not charged (lib/ticket-gate).
 */
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

const failText = (e: any) => {
  const detail = e?.body?.detail
  return Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : String(e?.message || e)
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

async function readImage(url: string): Promise<{ buf: Buffer; w: number; h: number }> {
  const r = await fetch(url.startsWith('data:') ? url : signMediaUrl(url, 600))
  if (!r.ok) throw new Error(`Could not read the uploaded image (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  const m = await sharp(buf).metadata()
  if (!m.width || !m.height) throw new Error('The uploaded file is not an image')
  return { buf, w: m.width, h: m.height }
}

async function studioFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Image Studio', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Image Studio', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled canvas'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

const LABEL: Record<StudioGenOp, string> = {
  fill: 'Generative fill', erase: 'Remove object', expand: 'Generative expand', upscale: 'Upscale', edit: 'AI edit', generate: 'Generate',
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const raw = (await ctx.params).id
  const popup = raw === 'edit'
  // Any signed-in account - the popup since 2026-10-06, the Studio's canvases since 2026-10-07
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(raw)
  const canvas = popup
    ? { id: 0, title: 'Edits' }
    : Number.isFinite(id) ? await prisma.imageCanvas.findFirst({ where: { id, userId: user.id }, select: { id: true, title: true } }) : null
  if (!canvas) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  // Every tool that works on a picture (fill, erase, expand, upscale, edit,
  // generate from a reference) reads pixels the browser uploaded - verified
  // accounts only. Generating from words alone stays open.
  if (body.op !== 'generate' || body.image || body.mask) {
    const gated = await requireIdVerified(user)
    if (gated) return gated
  }
  const op = body.op as StudioGenOp
  if (!(op in LABEL)) return jsonPrivate({ error: 'Unknown AI tool' }, { status: 400 })
  const bad = (error: string) => jsonPrivate({ error }, { status: 400 })

  // Inputs: only files this account uploaded for the studio
  const own = (v: unknown) => {
    const u = typeof v === 'string' ? canonicalMediaUrl(v) : ''
    return u.includes(`/u/${user.id}/image-studio/`) ? u : ''
  }
  const image = own(body.image), mask = own(body.mask)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  if (op !== 'generate' && !image) return bad('Upload the picture first')
  if ((op === 'fill' || op === 'erase') && !mask) return bad('Make a selection first')
  if ((op === 'fill' || op === 'edit' || op === 'generate') && !prompt) return bad(op === 'edit' ? 'Say what to change' : 'Describe what to make')

  // ── what the run is, and what it costs ──
  let cost = 0
  let endpoint = ''
  let input: Record<string, unknown> = {}
  let model = ''
  let quality: string | undefined
  try {
    const src = image ? await readImage(image) : null
    if (op === 'fill' || op === 'erase') {
      if (src!.w * src!.h > FILL_MAX_PIXELS * 1.05) return bad('The region is too large - the page sends at most 2 megapixels')
      // The mask must match the picture pixel for pixel
      let maskUrl: string = mask
      const m = await readImage(mask)
      if (m.w !== src!.w || m.h !== src!.h) {
        const fitted = await sharp(m.buf).resize(src!.w, src!.h, { fit: 'fill' }).png().toBuffer()
        maskUrl = `data:image/png;base64,${fitted.toString('base64')}`
      }
      if (op === 'fill') {
        cost = fillTickets(src!.w, src!.h); model = 'flux-pro-fill'; endpoint = 'fal-ai/flux-pro/v1/fill'
        input = { prompt, image_url: image, mask_url: maskUrl, num_images: 1, safety_tolerance: '6', output_format: 'png' }
      } else {
        cost = ERASE_TICKETS; model = 'bria-eraser'; endpoint = 'fal-ai/bria/eraser'
        input = { image_url: image, mask_url: maskUrl, mask_type: 'manual' }
      }
    } else if (op === 'expand') {
      const e = body.expand ?? {}
      const W = Math.round(Number(e.canvas?.[0])), H = Math.round(Number(e.canvas?.[1]))
      const x = Math.round(Number(e.at?.[0])), y = Math.round(Number(e.at?.[1]))
      if (![W, H, x, y].every(Number.isFinite) || W < 16 || H < 16 || W >= 5000 || H >= 5000 || W * H > EXPAND_MAX_PIXELS) return bad('The new canvas must stay under 5000 x 5000')
      // The picture's own size is measured, never taken from the page
      if (x < 0 || y < 0 || x + src!.w > W + 1 || y + src!.h > H + 1) return bad('The picture must sit inside the new canvas')
      if (src!.w >= W - 1 && src!.h >= H - 1) return bad('Drag the crop frame past the edge of the canvas first')
      cost = EXPAND_TICKETS; model = 'bria-expand'; endpoint = 'fal-ai/bria/expand'
      input = {
        image_url: image, canvas_size: [W, H], original_image_size: [src!.w, src!.h],
        original_image_location: [Math.min(x, W - src!.w), Math.min(y, H - src!.h)],
        ...(prompt ? { prompt } : {}),
      }
    } else if (op === 'upscale') {
      if (!isUpscaler(body.upscaler)) return bad('Pick an upscaler')
      const maxSide = Math.min(UPSCALE_MAX_SIDE, Math.max(64, Number(body.maxSide) || UPSCALE_MAX_SIDE))
      const f = upscaleFactor(body.upscaler, Number(body.factor), src!.w, src!.h, maxSide)
      if (!f) return bad('This is already as large as it can go')
      cost = upscaleTickets(body.upscaler, f, src!.w, src!.h); model = body.upscaler
      const up = UPSCALERS.find(u => u.id === body.upscaler)!
      // A 4x-only model (AuraSR, DRCT) asked for less: shrink the source so its
      // 4x lands exactly on the size asked for (and priced)
      let srcUrl: string = image
      if (up.fixed && f < up.fixed - 0.01) {
        const small = await sharp(src!.buf).resize(Math.max(16, Math.round(src!.w * f / up.fixed)), Math.max(16, Math.round(src!.h * f / up.fixed)), { fit: 'fill' }).png().toBuffer()
        srcUrl = `data:image/png;base64,${small.toString('base64')}`
      }
      switch (body.upscaler) {
        case 'seedvr2-upscale':
          endpoint = 'fal-ai/seedvr/upscale/image'
          input = { image_url: image, upscale_mode: 'factor', upscale_factor: f, output_format: 'png' }
          break
        case 'clarity-upscaler':
          // The portal's settings (lib upscale defaults); f already holds the output to 4096px
          endpoint = 'fal-ai/clarity-upscaler'
          input = { image_url: image, upscale_factor: f, prompt: prompt || 'masterpiece, best quality, highres', creativity: 0.35, resemblance: 0.6, enable_safety_checker: false }
          break
        case 'esrgan':
          endpoint = 'fal-ai/esrgan'
          input = { image_url: image, scale: f, model: 'RealESRGAN_x4plus', output_format: 'png' }
          break
        case 'aura-sr':
          endpoint = 'fal-ai/aura-sr'
          input = { image_url: srcUrl, upscale_factor: 4, checkpoint: 'v2', overlapping_tiles: true }
          break
        case 'drct':
          endpoint = 'fal-ai/drct-super-resolution'
          input = { image_url: srcUrl, upscale_factor: 4 }
          break
        default:
          endpoint = 'topaz/upscale/image/precision'
          input = { image_url: image, upscale_factor: f, output_format: 'png' }
      }
    } else {
      const spec = STUDIO_IMAGE_MODELS.find(m => m.id === body.model)
      if (!spec) return bad('Unknown image model')
      // The popup is open to everyone: admin-only models stay admin-only (as in /api/generate)
      if (isAdminOnlyModel(spec.id) && !(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'This model is not available' }, { status: 403 })
      if (op === 'edit' && !canEdit(spec.id)) return bad(`${spec.label} cannot edit a picture - pick another model`)
      const knobs = stillModelSpec(spec.id)
      quality = typeof body.quality === 'string' && knobs.qualities.includes(body.quality) ? body.quality : (knobs.defQuality || '2k')
      // One of the model's own frames ("auto" where it has it, as on the portal)
      const aspect = validAspect(spec.id, body.aspect, src?.w ?? 1, src?.h ?? 1)
      const refs = image && spec.refs ? [image] : []
      const call = buildFalCall(spec.id, prompt, refs, { aspect: spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[aspect] ?? '1024x1024') : aspect, quality }, stillBuildOptions(spec.id, {}))
      if ('error' in call) return bad(call.error)
      cost = genTickets(spec.id, quality, aspect, refs.length); model = spec.id
      endpoint = call.endpoint; input = call.input
      // The popup is open to everyone: a public model runs at the moderation
      // /api/generate gives non-admins (lib/public-moderation)
      enforcePublicModeration(spec.id, input, await checkIsAdmin(user.email))
    }
  } catch (e) {
    return jsonPrivate({ error: failText(e).slice(0, 240) }, { status: 400 })
  }

  // Every tool's run at the moderation a non-admin gets (FLUX Fill's tolerance included)
  enforcePublicModeration(model, input, await checkIsAdmin(user.email))
  // The CCBill prompt filter, as every generation route runs it - before any
  // charge (the popup is open to everyone and never ran it)
  if (prompt) {
    const cf = await enforceContentFilter(prompt, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  if (!paid.ok) return jsonPrivate({ error: `This needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })

  try {
    const out: any = await fal.subscribe(endpoint, { input })
    const falUrl: string | undefined = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
    if (!falUrl) throw new Error('The model returned no image')
    const res = await fetch(falUrl)
    if (!res.ok) throw new Error('Could not fetch the result')
    const buf = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buf).metadata()
    const ct = meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg'
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg'
    const url = await uploadToR2(userKey(user.id, `image-studio/ai-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`), buf, ct)
    const w = meta.width ?? 0, h = meta.height ?? 0, g = w && h ? gcd(w, h) : 1
    const row = await prisma.generatedImage.create({
      data: {
        userId: user.id, prompt: `${LABEL[op]}${prompt ? `: ${prompt}` : ''} (Image Studio)`, imageUrl: url, model, ticketCost: cost,
        referenceImageUrls: [image, mask].filter(Boolean), folderId: await studioFolder(user.id, canvas.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        ...(quality ? { quality } : {}), ...(w && h ? { aspectRatio: `${w / g}:${h / g}` } : {}),
      },
    })
    await ensureThumbnail(row.id).catch(() => {})
    return jsonPrivate({ url, width: w, height: h, tickets: cost, balance: paid.newBalance, imageId: row.id })
  } catch (e) {
    await refundGenerationTickets(user.id, user.email, cost)
    return jsonPrivate({ error: `${LABEL[op]} failed: ${failText(e).slice(0, 240)}`, balance: paid.newBalance >= 0 ? paid.newBalance + cost : paid.newBalance }, { status: 502 })
  }
}
