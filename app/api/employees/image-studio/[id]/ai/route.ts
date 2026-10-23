import { startStudioJob, finishStudioJob, failStudioJob } from '@/lib/studio-activity'
import { fitRefsForModel, fitImageForFal } from '@/lib/fal-image-fit'
import { getFalImageModelSpec, buildFalImageInput } from '@/lib/fal-image-models'
import { LAYERIZE_MODELS, saveLayerizeResult, type FalLayer, type SavedLayer } from '@/lib/layerize-save'
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
import { mediaKeeper } from '@/lib/media-ownership'
import { HIGGSFIELD_IMAGE_MODELS } from '@/lib/higgsfield-models'
import { submitHiggsfieldImage, waitHiggsfieldImage } from '@/lib/storyboard-stills'
import {
  type StudioGenOp, FILL_MAX_PIXELS, EXPAND_MAX_PIXELS, UPSCALE_MAX_SIDE, ERASE_TICKETS, EXPAND_TICKETS,
  fillTickets, isUpscaler, upscaleFactor, upscaleTickets, UPSCALERS, STUDIO_IMAGE_MODELS, genTickets, canEdit, isAdminOnlyModel, validAspect,
  pictureTool, pictureToolTickets, PICTURE_TOOL_OPTIONS, PICTURE_FRAMES, nearestAspect,
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
 *             (expandModel 'bria-fibo-expand': Bria Fibo Edit 1.5 Expand, the
 *             same frame - public 2026-10-16)
 *   upscale   image + upscaler + factor (+ maxSide: the long edge it may reach)
 *   edit      image + prompt (the instruction) + model / quality / aspect
 *   generate  prompt + model / quality / aspect (+ image as a reference)
 *   tool      image + tool (a PICTURE_TOOLS id) (+ prompt, aspect - Reframe's
 *             new frame, quality - Ideogram Vectorize's 'simple', options -
 *             PICTURE_TOOL_OPTIONS, refs - the second picture of a two-picture
 *             tool). Built by the model's lib/fal-image-models spec, as
 *             /api/generate builds it. An SVG comes back rasterised (the SVG
 *             itself is what My Generations keeps); Layerize adds `layers`.
 *
 * Returns: { url, width, height, tickets, balance, imageId, svg?, layers? }
 *
 * Priced by lib/image-studio-ai - the same functions that price the page's
 * buttons - from the inputs as measured HERE, never from what the page says.
 * Charged before the model runs, refunded if it fails. Every result is
 * re-hosted on R2 and saved to My Generations > Image Studio > <canvas title>.
 * A studio canvas (numeric id) is ADMIN ONLY, like the Studios section. The id
 * "edit" is the Edit Image popup - any signed-in account, results filed under
 * Image Studio > Edits. Admins are not charged (lib/ticket-gate).
 *
 * Higgsfield's Soul 2 / Soul / Marketing Studio generate too (not edit - see
 * lib/image-studio-ai NOT_EDITORS): not fal calls - generateHiggsfield below.
 */
export const maxDuration = 300
/** How long a Higgsfield generate is waited for (inside maxDuration, with room for the steps around it). */
const HF_WAIT_MS = 240_000
/** How long a fal run is waited for - the rest of maxDuration is for saving it, or refunding a timeout. */
const FAL_WAIT_MS = 200_000

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
  fill: 'Generative fill', erase: 'Remove object', expand: 'Generative expand', upscale: 'Upscale', edit: 'AI edit', generate: 'Generate', tool: 'Picture tool',
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
  if (body.op !== 'generate' || body.image || body.mask || (Array.isArray(body.refs) && body.refs.length)) {
    const gated = await requireIdVerified(user)
    if (gated) return gated
  }
  const op = body.op as StudioGenOp
  if (!(op in LABEL)) return jsonPrivate({ error: 'Unknown AI tool' }, { status: 400 })
  const bad = (error: string) => jsonPrivate({ error }, { status: 400 })
  // What the run is called in the feed and My Generations (a picture tool by its own name)
  const what = op === 'tool' ? pictureTool(body.tool)?.label ?? LABEL.tool : LABEL[op]

  // Inputs: only files this account uploaded for the studio
  const own = (v: unknown) => {
    const u = typeof v === 'string' ? canonicalMediaUrl(v) : ''
    return u.includes(`/u/${user.id}/image-studio/`) ? u : ''
  }
  const image = own(body.image), mask = own(body.mask)
  /*
   * References the user added in the panel (2026-10-09): from their Refs, My
   * Generations or My Assets - the account's own pictures only (an admin's
   * pass). They go AFTER the picture the tool sends itself (the canvas, the
   * layer, the selection), up to what the model takes.
   */
  const sentRefs = (Array.isArray(body.refs) ? body.refs : []).filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 16).map((u: string) => canonicalMediaUrl(u))
  const keepRef = sentRefs.length && !(await checkIsAdmin(user.email)) ? await mediaKeeper(user.id, sentRefs) : () => true
  const extraRefs: string[] = [...new Set<string>(sentRefs.filter((u: string) => keepRef(u)))]
  if (sentRefs.length && !extraRefs.length) return jsonPrivate({ error: 'References must be your own pictures' }, { status: 400 })
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
  // A Higgsfield generate (Soul 2 / Soul / Marketing Studio): its frame and references
  let hf: { aspect: string; refs: string[] } | null = null
  // The source's long side (an SVG result is rasterised to it)
  let srcLong = 0
  try {
    const src = image ? await readImage(image) : null
    srcLong = src ? Math.max(src.w, src.h) : 0
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
      const fibo = body.expandModel === 'bria-fibo-expand'
      // Both $0.04 a run; Fibo keeps the original's own pixels at full resolution
      cost = EXPAND_TICKETS; model = fibo ? 'bria-fibo-expand' : 'bria-expand'; endpoint = fibo ? 'bria/fibo-edit-1.5/expand' : 'fal-ai/bria/expand'
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
        case 'topaz-img-upscale-creative':
        case 'topaz-img-upscale-generative':
        case 'topaz-img-upscale-transparent': {
          // Built by the model's own spec (its default model, PNG out), as /api/generate builds it
          const built = buildFalImageInput(getFalImageModelSpec(body.upscaler)!, { prompt: '', aspectRatio: '', quality: '', imageUrls: [srcUrl], options: { topazUpscaleFactor: f } })
          endpoint = built.endpoint; input = built.input
          break
        }
        default:
          endpoint = 'topaz/upscale/image/precision'
          input = { image_url: image, upscale_factor: f, output_format: 'png' }
      }
    } else if (op === 'tool') {
      const tool = pictureTool(body.tool)
      const spec = tool ? getFalImageModelSpec(tool.id) : undefined
      if (!tool || !spec) return bad('Unknown picture tool')
      // The popup is open to everyone: an admin-only model stays admin-only (as in /api/generate)
      if (isAdminOnlyModel(tool.id) && !(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'This tool is not available' }, { status: 403 })
      if (tool.prompt?.need && !prompt) return bad(`${tool.label} needs a prompt`)
      // A two-picture tool's second picture (and more): the account's own, after the source
      const more = tool.extra ? extraRefs.filter(u => u !== image).slice(0, tool.extra.max) : []
      if (tool.extra && more.length < tool.extra.need) return bad(`${tool.label}: add ${tool.extra.label.toLowerCase()} first`)
      // The source at the size /api/generate sends this model (Marigold and the
      // vectorizers 2048, Ideogram also under 4 MB, Multi-Angle 1536)
      const lead = tool.maxSide ? await fitImageForFal(image, tool.maxSide, tool.id.startsWith('ideogram') ? 4 * 1024 * 1024 : Infinity) : image
      // Only the knobs a tool has (each spec clamps its own values); Pixelcut's
      // background is transparent or a colour - never a URL from the page
      const sent = body.options && typeof body.options === 'object' ? body.options as Record<string, unknown> : {}
      const options: Record<string, unknown> = Object.fromEntries(PICTURE_TOOL_OPTIONS.filter(k => k in sent).map(k => [k, sent[k]]))
      if (tool.models) options.topazModel = typeof sent.topazModel === 'string' && tool.models.includes(sent.topazModel) ? sent.topazModel : tool.models[0]
      if (tool.id === 'pixelcut-product-photo') options.pixelcutBackgroundMode = sent.pixelcutBackgroundMode === 'Color' ? 'Color' : 'Transparent'
      // Embed Product places the product in the scene's own pixels
      options.refDims = { width: src!.w, height: src!.h }
      // Reframe: the new frame picked (one of the model's); the rest size their
      // output (Recraft, Pixelcut Product Photo) from the frame nearest the source
      let aspectRatio = nearestAspect(src!.w, src!.h, PICTURE_FRAMES)
      if (tool.place === 'reframe') {
        if (typeof body.aspect !== 'string' || !spec.aspectRatios?.includes(body.aspect)) return bad('Pick the new frame')
        aspectRatio = body.aspect
      }
      const built = buildFalImageInput(spec, {
        prompt: tool.prompt ? prompt : '', aspectRatio, imageUrls: [lead, ...more], options,
        // Ideogram Vectorize reads its mode from the quality; the image-size models take 2K
        quality: tool.id === 'ideogram-vectorize' ? (body.quality === 'simple' ? 'simple' : 'default') : '2k',
      })
      endpoint = built.endpoint; input = built.input
      cost = pictureToolTickets(tool.id, src!.w, src!.h, { topazModel: options.topazModel as string | undefined }); model = tool.id
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
      // The tool's own picture first (the layer / canvas / selection), then the added ones
      const refs = spec.refs ? [...(image ? [image] : []), ...extraRefs.filter(u => u !== image)].slice(0, Math.max(image ? 1 : 0, knobs.maxRefs)) : []
      // Sized for the model where it limits uploads (Ideogram)
      // The model's own settings from the panel (Thinking, Web search...), kept to
      // the values it offers; an admin-only one (Safety) only from an admin
      if (HIGGSFIELD_IMAGE_MODELS.has(spec.id)) {
        // Higgsfield's: no fal call - their own route charges and runs it (below),
        // at this price (higgsfieldImageTicketCost, as the portal charges)
        cost = genTickets(spec.id, quality, aspect, refs.length); model = spec.id
        hf = { aspect, refs }
      } else {
        const asAdmin = await checkIsAdmin(user.email)
        const sent = body.options && typeof body.options === 'object' ? body.options as Record<string, unknown> : {}
        const allowed = Object.fromEntries(Object.entries(sent).filter(([k]) => asAdmin || !knobs.settings.find(s => s.key === k)?.admin))
        const call = buildFalCall(spec.id, prompt, await fitRefsForModel(spec.id, refs), { aspect: spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[aspect] ?? '1024x1024') : aspect, quality }, stillBuildOptions(spec.id, allowed))
        if ('error' in call) return bad(call.error)
        // Priced with the same settings the run uses (High thinking / web search cost more)
        const priced = Object.fromEntries(Object.entries(stillBuildOptions(spec.id, allowed)).map(([k, v]) => [k, String(v)]))
        cost = genTickets(spec.id, quality, aspect, refs.length, priced); model = spec.id
        endpoint = call.endpoint; input = call.input
        // The popup is open to everyone: a public model runs at the moderation
        // /api/generate gives non-admins (lib/public-moderation)
        enforcePublicModeration(spec.id, input, await checkIsAdmin(user.email))
      }
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
  if (hf) return generateHiggsfield({ userId: user.id, title: canvas.title, what, model, prompt, quality: quality ?? '1k', cost, ...hf })
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  if (!paid.ok) return jsonPrivate({ error: `This needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })

  // The feed's generating tile for it (lib/studio-activity)
  const track = await startStudioJob({ userId: user.id, modelType: 'image', modelId: model, prompt: `${what}${prompt ? `: ${prompt}` : ''} (Image Studio)`, studio: 'image-studio', quality: quality || undefined })
  /*
   * Bounded (2026-10-23 billing sweep): charged above, then waited on inside
   * a 300s function - a model still running at maxDuration got the function
   * killed and the catch below (the refund) never ran. Now the wait is given
   * up at FAL_WAIT_MS, which leaves time to refund; fetching the result is
   * bounded too. The fal request id is logged when the wait is given up, so
   * a result that still finishes can be found in fal's request history.
   */
  let falRequestId: string | null = null
  try {
    const out: any = await fal.subscribe(endpoint, {
      input, abortSignal: AbortSignal.timeout(FAL_WAIT_MS),
      onEnqueue: (id: string) => { falRequestId = id },
    }).catch((e: any) => {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        console.warn(`[image-studio ai] ${model} gave up waiting (fal request ${falRequestId ?? 'unknown'}) - refunded`)
        throw new Error('The model took too long - your tickets were refunded')
      }
      throw e
    })
    /*
     * Layerize: the background and each object, saved together as ONE card the
     * way the fal webhook saves it (lib/layerize-save); the page gets every
     * layer and its box in the background's pixels, to place as layers.
     */
    if (LAYERIZE_MODELS.has(model) && Array.isArray(out?.data?.layers) && out.data.layers.length) {
      const saved = await saveLayerizeResult({
        userId: user.id, prompt: `${what}${prompt ? `: ${prompt}` : ''} (Image Studio)`, modelId: model,
        falRequestId: typeof out?.requestId === 'string' ? out.requestId : null, createdAt: new Date(), ticketCost: cost,
        referenceImageUrls: [image], layers: out.data.layers as FalLayer[],
      })
      if (!saved) throw new Error('The model returned no layers')
      const row = await prisma.generatedImage.update({ where: { id: saved.id }, data: { folderId: await studioFolder(user.id, canvas.title) }, select: { videoMetadata: true } })
      const lz = (row.videoMetadata as { layerize?: { width: number; height: number; layers: SavedLayer[] } } | null)?.layerize
      if (!lz?.layers?.length) throw new Error('The model returned no layers')
      await ensureThumbnail(saved.id).catch(() => {})
      await finishStudioJob(track, [saved.id], saved.url)
      return jsonPrivate({ url: saved.url, width: lz.width, height: lz.height, tickets: cost, balance: paid.newBalance, imageId: saved.id, layers: lz.layers.map(l => ({ url: l.url, name: l.name, box: l.box })) })
    }
    const falUrl: string | undefined = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
    if (!falUrl) throw new Error('The model returned no image')
    const res = await fetch(falUrl, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error('Could not fetch the result')
    let buf: Buffer = Buffer.from(await res.arrayBuffer())
    /*
     * An SVG (the vectorizers, Recraft's vector models - detected as the fal
     * webhook does): the SVG itself is what My Generations keeps; the layer
     * gets it rasterised by sharp, its long side at the source's (1024-4096px).
     */
    const falType = (res.headers.get('content-type') || '').split(';')[0].trim()
    const head = buf.subarray(0, 400).toString('utf8').trimStart()
    let svgUrl = ''
    if (falType === 'image/svg+xml' || /\.svg(\?|#|$)/i.test(falUrl) || head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
      svgUrl = await uploadToR2(userKey(user.id, `image-studio/ai-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`), buf, 'image/svg+xml')
      const at72 = await sharp(buf).metadata()
      const want = Math.min(4096, Math.max(1024, srcLong || 2048))
      const density = Math.max(1, Math.min(2400, 72 * want / Math.max(at72.width ?? 1024, at72.height ?? 1024, 1)))
      buf = await sharp(buf, { density }).png().toBuffer()
    }
    const meta = await sharp(buf).metadata()
    const ct = meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg'
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg'
    const url = await uploadToR2(userKey(user.id, `image-studio/ai-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`), buf, ct)
    const w = meta.width ?? 0, h = meta.height ?? 0, g = w && h ? gcd(w, h) : 1
    const row = await prisma.generatedImage.create({
      data: {
        userId: user.id, prompt: `${what}${prompt ? `: ${prompt}` : ''} (Image Studio)`, imageUrl: svgUrl || url, model, ticketCost: cost,
        referenceImageUrls: [image, mask].filter(Boolean), folderId: await studioFolder(user.id, canvas.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        ...(quality ? { quality } : {}), ...(w && h ? { aspectRatio: `${w / g}:${h / g}` } : {}),
      },
    })
    await ensureThumbnail(row.id).catch(() => {})
    await finishStudioJob(track, [row.id], svgUrl || url)
    return jsonPrivate({ url, width: w, height: h, tickets: cost, balance: paid.newBalance, imageId: row.id, ...(svgUrl ? { svg: svgUrl } : {}) })
  } catch (e) {
    await refundGenerationTickets(user.id, user.email, cost)
    await failStudioJob(track, failText(e))
    return jsonPrivate({ error: `${what} failed: ${failText(e).slice(0, 240)}`, balance: paid.newBalance >= 0 ? paid.newBalance + cost : paid.newBalance }, { status: 502 })
  }
}

/**
 * Generate a layer with Higgsfield (Soul 2 / Soul / Marketing Studio,
 * 2026-10-22). Charged by Higgsfield's own route at the portal's price -
 * `cost`, the number on the button - admins free; queued on Higgsfield's
 * queue and WAITED FOR here, as fal.subscribe is for the rest (an image is
 * back in well under a minute unless their 20 slots are full; HF_WAIT_MS keeps
 * the wait inside maxDuration). A failure is refunded by lib/higgsfield. Its
 * queue row is the feed's tile and its GeneratedImage the layer's row - filed
 * under Image Studio > <canvas>, no second row. Still running at the deadline:
 * the job goes on and lands in My Generations, the layer is not placed (504).
 */
async function generateHiggsfield(o: {
  userId: number; title: string; what: string; model: string; prompt: string; quality: string; cost: number; aspect: string; refs: string[]
}): Promise<Response> {
  const balance = async () => (await prisma.ticket.findUnique({ where: { userId: o.userId }, select: { balance: true } }).catch(() => null))?.balance
  const sub = await submitHiggsfieldImage({ model: o.model, prompt: o.prompt, aspect: o.aspect, quality: o.quality, refs: o.refs })
  if (!sub.ok) return jsonPrivate({ error: sub.error, ...(sub.status === 402 ? { needTickets: true } : {}) }, { status: sub.status >= 400 ? sub.status : 502 })
  const done = await waitHiggsfieldImage(sub.queueId, Date.now() + HF_WAIT_MS)
  if (done.status === 'waiting') return jsonPrivate({ error: `${o.what} is taking longer than usual - Higgsfield will still finish it, and it lands in My Generations`, pending: true, balance: await balance() }, { status: 504 })
  if (done.status === 'failed') return jsonPrivate({ error: `${o.what} failed: ${done.error.slice(0, 240)}`, balance: await balance() }, { status: 502 })
  try {
    const { w, h } = await readImage(done.url)
    await prisma.generatedImage.update({ where: { id: done.imageId }, data: { folderId: await studioFolder(o.userId, o.title) } })
    return jsonPrivate({ url: done.url, width: w, height: h, tickets: o.cost, balance: await balance(), imageId: done.imageId })
  } catch (e) {
    // Made and paid for, only not readable here: it is in My Generations
    return jsonPrivate({ error: `${o.what} finished but could not be placed (${failText(e).slice(0, 160)}) - it is in My Generations` }, { status: 502 })
  }
}
