/**
 * The AI Design Studio connector's tools (2026-10-20) - what ChatGPT and
 * Claude can do on a signed-in user's account (app/api/mcp). Server only.
 *
 * Every tool runs the SITE's own code with the user's connection key (the
 * OAuth access token, an ApiKey - lib/mcp/oauth): generations go through
 * /api/generate and /api/video/generate exactly as on the site (Nova's
 * submit helpers), so pricing, charging, refunds, the queue, the content
 * rules and the feed are the site's. Results are the user's My Generations
 * rows, returned as links (signed, private) plus a preview the model can see.
 *
 * SAFETY (lib/mcp/safety): ChatGPT and Claude get GENERAL-AUDIENCE rules,
 * stricter than the site's own - every request is screened, every picture
 * used as a reference is checked before anything is spent, and every picture
 * or clip poster is checked before it is shown in the chat (whatever an
 * admin's Filter switch says). What fails stays in My Generations, unshown.
 */
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { checkRequest, pictureIsShowable } from '@/lib/mcp/safety'
import { isUploadAllowed } from '@/lib/id-verification'
import { signMediaUrl, isOurMedia } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { submitChatImage } from '@/lib/chat-image-submit'
import { submitChatVideo } from '@/lib/chat-video-submit'
import { describeModels, estimateCreate, needsPicture, novaImageModels, novaVideoModels } from '@/lib/nova/catalog'
import { rowForRequest, settleQueueJob, ensureChatFolder, fileGeneration } from '@/lib/nova/jobs'
import { kindOf, ownedRows } from '@/lib/nova/agent-tools'
import type { ApiKeyAuth } from '@/lib/api-key-auth'

export type ToolCtx = {
  auth: ApiKeyAuth
  /** The Authorization header to send on the site's routes (the user's own key). */
  headers: Record<string, string>
  origin: string
  /** Which app is calling (for the folder name). */
  app: string
}

export type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

type Item = { id: number | null; jobId: number | null; kind: string; status: 'done' | 'rendering' | 'failed'; url: string | null; thumb: string | null; model: string; prompt: string; tickets: number; error?: string; hidden?: boolean }

export const DEFAULT_IMAGE_MODEL = 'nano-banana-2.1'
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast'
const MAX_IMAGES = 4
/** How long an image tool waits in the call before handing back a job to check (the apps time a call out). */
const IMAGE_WAIT_MS = 50_000

/** Prompt text from the library is screened like a request before the AI sees it. */
const ADULT_TEXT = /\b(nsfw|nude|nudes|nudity|naked|topless|porn\w*|xxx|hentai|erotic\w*|sexy|sex|explicit|lingerie|nipples?|breasts?|boobs?|fetish\w*|bikini|thong|panties)\b/i
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const signed = (u: string | null | undefined) => (u ? signMediaUrl(u) : null)
/** Some clips store the clip ITSELF as their "thumbnail" - never use a video file as a poster picture. */
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i
const posterOnly = (u: string | null | undefined) => (u && !VIDEO_FILE.test(u) ? u : null)
const err = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

// ── the tool list ────────────────────────────────────────────────────────────

/*
 * The results card: ONE resource, the MCP Apps one (text/html;profile=mcp-app).
 * ChatGPT reads _meta.ui.resourceUri and takes openai/outputTemplate as an
 * alias - the first build pointed the alias at a second, older-style
 * (skybridge) resource, and ChatGPT showed "Couldn't open ... Retry" in place
 * of every card (2026-10-20).
 */
const WIDGET_META = {
  'openai/outputTemplate': 'ui://aids/studio-results.html',
  ui: { resourceUri: 'ui://aids/studio-results.html' },
}
const AUTH = [{ type: 'oauth2', scopes: ['studio'] }]
const ids = { type: 'array', items: { type: 'integer' } }
const urls = { type: 'array', items: { type: 'string' }, description: 'https links to pictures (e.g. ones the user shared) - uploading pictures needs an ID-verified account on the site' }

export const TOOLS = [
  {
    name: 'get_account',
    title: 'Check your account',
    description: "The user's AI Design Studio ticket balance and plan. Call before a big job, or when the user asks what they can afford.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { securitySchemes: AUTH, 'openai/toolInvocation/invoking': 'Checking your tickets…', 'openai/toolInvocation/invoked': 'Checked your tickets' },
  },
  {
    name: 'list_models',
    title: 'Browse models',
    description: 'The image or video models the user can use, with their ticket price at default settings and what references they take. Pass search=<model id> to get one model\'s exact settings.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['image', 'video'] }, search: { type: 'string', description: 'A model id or name to get its full settings' } },
      required: ['kind'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { securitySchemes: AUTH, 'openai/toolInvocation/invoking': 'Looking at the models…', 'openai/toolInvocation/invoked': 'Found the models' },
  },
  {
    name: 'generate_image',
    title: 'Make images',
    description: `Make 1-${MAX_IMAGES} images on the user's AI Design Studio account (spends their tickets - the price is the model's, shown by list_models). Default model ${DEFAULT_IMAGE_MODEL} (great all-round, follows long prompts, takes up to 14 reference pictures). The images are saved to the user's My Generations and shown in the chat. Write a full, descriptive prompt.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to make: subject, setting, composition, lighting, style' },
        model: { type: 'string', description: `An image model id from list_models (default ${DEFAULT_IMAGE_MODEL})` },
        aspect_ratio: { type: 'string', description: 'e.g. 1:1, 4:5, 9:16, 16:9 (default 1:1)' },
        quality: { type: 'string', enum: ['1k', '2k', '4k'], description: 'Default 2k; 4k costs more' },
        count: { type: 'integer', minimum: 1, maximum: MAX_IMAGES, description: 'How many variations (default 1)' },
        reference_ids: { ...ids, description: "The user's own pictures (My Generations ids from search_library or an earlier result) to use as references: a character, product or style" },
        reference_urls: urls,
      },
      required: ['prompt'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { securitySchemes: AUTH, ...WIDGET_META, 'openai/toolInvocation/invoking': 'Making your image…', 'openai/toolInvocation/invoked': 'Made your image' },
  },
  {
    name: 'edit_image',
    title: 'Edit an image',
    description: `Change an existing picture with words ("make the sky stormy", "put the product on a marble table", "remove the text") - spends tickets like a generation. The source is one of the user's pictures (image_id) or a link. Uses ${DEFAULT_IMAGE_MODEL} unless another image model that takes references is named. The edit is saved as a new picture; the original is kept.`,
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'What to change, and what to keep the same' },
        image_id: { type: 'integer', description: "The picture to edit (a My Generations id)" },
        image_url: { type: 'string', description: 'Or an https link to the picture (needs an ID-verified account)' },
        extra_reference_ids: { ...ids, description: 'More of the user\'s pictures to use (e.g. a product to place in the scene)' },
        aspect_ratio: { type: 'string', description: 'Keep empty to keep the shape' },
        model: { type: 'string' },
      },
      required: ['instruction'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { securitySchemes: AUTH, ...WIDGET_META, 'openai/toolInvocation/invoking': 'Editing your image…', 'openai/toolInvocation/invoked': 'Edited your image' },
  },
  {
    name: 'generate_video',
    title: 'Make a video',
    description: `Start a video clip on the user's account (spends tickets - video costs more than images; check list_models). It renders in the background for 1-5 minutes: you get a job id now - call get_generations with it to fetch the finished clip. Default model ${DEFAULT_VIDEO_MODEL}. To animate one of the user's pictures pass start_image_id.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The action, camera move, pacing and sound of the clip' },
        model: { type: 'string', description: `A video model id from list_models (default ${DEFAULT_VIDEO_MODEL})` },
        start_image_id: { type: 'integer', description: 'Animate this picture (a My Generations id)' },
        start_image_url: { type: 'string', description: 'Or an https link to the start picture (needs an ID-verified account)' },
        end_image_id: { type: 'integer', description: 'End frame, for models that take one (the same id as the start makes a loop)' },
        duration: { type: 'string', description: 'Seconds, e.g. "5" or "10" (model dependent)' },
        aspect_ratio: { type: 'string', description: 'e.g. 16:9, 9:16, 1:1' },
        resolution: { type: 'string', description: 'e.g. 720p, 1080p' },
        audio: { type: 'boolean', description: 'Generate sound, on models that can' },
      },
      required: ['prompt'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { securitySchemes: AUTH, ...WIDGET_META, 'openai/toolInvocation/invoking': 'Starting your video…', 'openai/toolInvocation/invoked': 'Your video is rendering' },
  },
  {
    name: 'get_generations',
    title: 'Check on generations',
    description: 'Fetch generations by job id (from generate_video, or an image that was still rendering) or by My Generations id: their status, and the finished picture or clip. Call it when the user asks whether a video is ready (a clip takes 1-5 minutes).',
    inputSchema: {
      type: 'object',
      properties: { job_ids: { ...ids, description: 'Job ids from generate_video / generate_image' }, ids: { ...ids, description: 'My Generations ids' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { securitySchemes: AUTH, ...WIDGET_META, 'openai/toolInvocation/invoking': 'Checking…', 'openai/toolInvocation/invoked': 'Checked' },
  },
  {
    name: 'search_library',
    title: 'Search your library',
    description: "Find the user's own generations in My Generations - newest first, optionally matching words in their prompts or a kind. Use the ids as reference_ids, image_id or start_image_id.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words from the prompt, e.g. "red car" (empty = newest)' },
        kind: { type: 'string', enum: ['image', 'video', 'any'] },
        limit: { type: 'integer', minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { securitySchemes: AUTH, ...WIDGET_META, 'openai/toolInvocation/invoking': 'Looking through your library…', 'openai/toolInvocation/invoked': 'Searched your library' },
  },
] as const

export type ToolName = typeof TOOLS[number]['name']

// ── results ──────────────────────────────────────────────────────────────────

/** A small JPEG of a picture, so the AI can see what it made (and so it can be checked). */
async function preview(url: string): Promise<{ type: 'image'; data: string; mimeType: string } | null> {
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 75 }).toBuffer()
    return { type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' }
  } catch { return null }
}

/**
 * Check what is about to be shown: each finished item's picture (an image, or
 * a clip's poster) gets a preview and the general-audience check. One that
 * fails - or cannot be checked - is kept off the chat: no link, no picture.
 */
async function screen(items: Item[]): Promise<Map<Item, { type: 'image'; data: string; mimeType: string }>> {
  const previews = new Map<Item, { type: 'image'; data: string; mimeType: string }>()
  await Promise.all(items.map(async it => {
    if (it.status !== 'done') return
    if (it.kind === 'video') it.thumb = posterOnly(it.thumb)
    let src = it.kind === 'image' ? it.url : it.thumb
    // A saved clip with no poster yet: make one from its first frame (as the feed does) so it can be checked
    if (!src && it.kind === 'video' && it.id && it.url) src = await posterFor(it.id, it.url)
    if (src && it.kind === 'video') it.thumb = src
    const pic = src ? await preview(src) : null
    if (!pic) {
      // A clip started through the connector (its request was checked) may show before it has a poster; anything else unchecked is not shown
      if (it.kind === 'video' && !src && it.jobId != null) return
      it.hidden = true
    } else if (!(await pictureIsShowable(pic.data))) it.hidden = true
    else previews.set(it, pic)
    if (it.hidden) { it.url = null; it.thumb = null }
  }))
  return previews
}

/** A clip's first frame, stored as its feed thumbnail (the same recipe as /api/images/[id]); a signed link, or null. */
async function posterFor(id: number, signedVideoUrl: string): Promise<string | null> {
  try {
    const { makeVideoPoster } = await import('@/lib/video-poster')
    const poster = await makeVideoPoster(signedVideoUrl)
    if (poster === 'busy') return null
    const { uploadToR2 } = await import('@/lib/r2')
    const thumbUrl = await uploadToR2(`thumb/${id}-${Date.now()}.webp`, poster, 'image/webp')
    await prisma.generatedImage.updateMany({ where: { id, thumbnailUrl: null }, data: { thumbnailUrl: thumbUrl } })
    return signMediaUrl(thumbUrl)
  } catch { return null }
}

async function results(ctx: ToolCtx, items: Item[], headline: string, extra: Record<string, unknown> = {}): Promise<ToolResult> {
  const previews = await screen(items)
  const lines = [headline]
  for (const it of items) {
    if (it.hidden) lines.push(`- ${it.kind} #${it.id ?? '?'} was made but can't be shown in ${ctx.app} (AI Design Studio keeps this chat suitable for all ages) - it is in the user's My Generations on the site.`)
    else if (it.status === 'done') lines.push(`- ${it.kind} #${it.id ?? '?'} (${it.model}${it.tickets ? `, ${it.tickets} tickets` : ''}): ${it.url}`)
    else if (it.status === 'rendering') lines.push(`- ${it.kind} still rendering (job ${it.jobId}, ${it.model}${it.tickets ? `, ${it.tickets} tickets` : ''}) - check with get_generations`)
    else lines.push(`- ${it.kind} failed (${it.model}): ${it.error ?? 'unknown error'} - any tickets were refunded`)
  }
  if (items.some(i => i.status === 'done')) lines.push(`Everything is saved in the user's My Generations: ${ctx.origin}/my-generations (links expire after 12 hours; the files stay in the library).`)
  const pics = items.filter(i => i.kind === 'image' && previews.has(i)).slice(0, 4).map(i => previews.get(i)!)
  return {
    content: [{ type: 'text', text: lines.join('\n') }, ...pics],
    structuredContent: { items, ...extra },
  }
}

async function filing(ctx: ToolCtx): Promise<number> {
  // Everything the connector makes is filed together, like Prism's and Nova's
  return ensureChatFolder(ctx.auth.user.id, ctx.app, null)
}

async function guardPrompt(ctx: ToolCtx, prompt: string): Promise<string | null> {
  if (!prompt.trim()) return 'A prompt is required.'
  return checkRequest(prompt, ctx.app)
}

/** Pictures used as references or start frames pass the same check before anything is spent. */
async function guardPictures(ctx: ToolCtx, urls: string[]): Promise<string | null> {
  const verdicts = await Promise.all(urls.slice(0, 6).map(async u => { const p = await preview(signMediaUrl(u)); return !!p && (await pictureIsShowable(p.data)) }))
  return verdicts.every(Boolean) ? null : `One of those pictures can't be used through ${ctx.app}: AI Design Studio keeps everything made here suitable for all ages. Pick another picture.`
}

async function guardLinks(ctx: ToolCtx, links: string[]): Promise<string | null> {
  const outside = links.filter(u => !isOurMedia(u))
  if (outside.some(u => !/^https:\/\//.test(u))) return 'Picture links must be https.'
  if (outside.length && !(await isUploadAllowed(ctx.auth.user as any))) {
    return `Using pictures from outside AI Design Studio needs a one-time ID check on the site. Ask the user to verify at ${ctx.origin} (any upload button starts it), or use one of their own pictures from search_library.`
  }
  return null
}

const rowItem = (r: { id: number; imageUrl: string; model: string; prompt: string; videoMetadata: unknown; ticketCost?: number | null; thumbnailUrl?: string | null }): Item => {
  const meta = (r.videoMetadata ?? {}) as Record<string, any>
  const kind = kindOf(r as any)
  return {
    id: r.id, jobId: null, kind: kind === 'cut' ? 'video' : kind, status: 'done',
    url: signed(r.imageUrl), thumb: signed(r.thumbnailUrl ?? meta.thumbnailUrl ?? (kind === 'image' ? r.imageUrl : null)),
    model: r.model, prompt: clip(r.prompt, 200), tickets: Number(r.ticketCost ?? 0),
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

export async function callTool(ctx: ToolCtx, name: string, args: Record<string, any>): Promise<ToolResult> {
  const uid = ctx.auth.user.id
  const isAdmin = false // the connector is the public product: public models only, filter always on

  switch (name as ToolName) {
    case 'get_account': {
      const t = await prisma.ticket.findUnique({ where: { userId: uid }, select: { balance: true, reserved: true } })
      const balance = Math.max(0, (t?.balance ?? 0) - Math.max(0, t?.reserved ?? 0))
      const { enhancePlanFor, ENHANCE_PLAN_LABEL } = await import('@/lib/prompt-enhance')
      const plan = ENHANCE_PLAN_LABEL[await enhancePlanFor(ctx.auth.user)]
      return {
        content: [{ type: 'text', text: `The user has ${balance} tickets (plan: ${plan}). Images cost about 1-15 tickets each, video clips about 3-75 (see list_models). More tickets: ${ctx.origin}/buy-tickets (bought on the site, not here).` }],
        structuredContent: { tickets: balance, plan },
      }
    }

    case 'list_models': {
      const kind = args.kind === 'video' ? 'video' : 'image'
      const text = describeModels(kind, isAdmin, typeof args.search === 'string' ? args.search : undefined)
      return { content: [{ type: 'text', text: `${kind === 'image' ? 'Image' : 'Video'} models (id · tickets at default settings · references · strengths):\n${text.replace(/browse_models/g, 'list_models')}` }] }
    }

    case 'generate_image':
    case 'edit_image': {
      const editing = name === 'edit_image'
      const prompt = clip(editing ? args.instruction : args.prompt, 4000)
      const stop = await guardPrompt(ctx, prompt)
      if (stop) return err(stop)
      const spec = novaImageModels(isAdmin).find(m => m.id === (args.model || DEFAULT_IMAGE_MODEL))
      if (!spec) return err(`Unknown or unavailable image model "${args.model}". Call list_models with kind "image".`)
      // References: the user's own rows (any account may use those) and links (ID-verified accounts)
      const refIds = editing ? [args.image_id, ...(args.extra_reference_ids ?? [])] : (args.reference_ids ?? [])
      const owned = (await ownedRows(uid, refIds.filter((v: unknown) => v != null))).filter(r => kindOf(r) === 'image')
      const ordered = refIds.map((id: unknown) => owned.find(r => r.id === Number(id))).filter(Boolean).map((r: any) => r.imageUrl as string)
      const links: string[] = editing ? (args.image_url ? [String(args.image_url)] : []) : (Array.isArray(args.reference_urls) ? args.reference_urls.map(String) : [])
      const linkStop = await guardLinks(ctx, links)
      if (linkStop) return err(linkStop)
      const refs = [...(editing && links.length ? links : []), ...ordered, ...(!editing ? links : [])].slice(0, Math.max(0, spec.maxRefs))
      if (editing && !refs.length) return err('Pass the picture to edit: image_id (from search_library or an earlier result) or image_url.')
      // A picture tool (cut-out, upscale, vectorize, try-on...) makes nothing from a prompt alone
      if (!refs.length && needsPicture(spec.id)) return err(`${spec.label} is a tool that works on a picture - use edit_image with image_id (or image_url) and model "${spec.id}".`)
      if (editing && !spec.maxRefs) return err(`${spec.label} cannot edit pictures - leave model empty to use ${DEFAULT_IMAGE_MODEL}.`)
      const picStop = refs.length ? await guardPictures(ctx, refs) : null
      if (picStop) return err(picStop)
      const settings = { ...(args.aspect_ratio ? { aspect: String(args.aspect_ratio) } : editing ? { aspect: 'auto' } : { aspect: '1:1' }), ...(args.quality ? { quality: String(args.quality) } : {}) }
      const { settings: s } = estimateCreate(spec, settings)
      const count = editing ? 1 : Math.min(MAX_IMAGES, Math.max(1, Number(args.count) || 1))
      const folderId = await filing(ctx)
      const deadline = Date.now() + IMAGE_WAIT_MS
      const runs = await Promise.all(Array.from({ length: count }, () => submitChatImage(spec, prompt, refs, s, uid, { headers: ctx.headers, waitUntil: deadline })))
      const items: Item[] = []
      for (const res of runs) {
        if (!res.ok) { items.push({ id: null, jobId: null, kind: 'image', status: 'failed', url: null, thumb: null, model: spec.label, prompt: clip(prompt, 200), tickets: 0, error: res.error }); continue }
        if ('pending' in res) { items.push({ id: null, jobId: res.queueId, kind: 'image', status: 'rendering', url: null, thumb: null, model: spec.label, prompt: clip(prompt, 200), tickets: res.ticketCost }); continue }
        const q = res.queueId ? await prisma.generationQueue.findUnique({ where: { id: res.queueId }, select: { falRequestId: true } }) : null
        const row = await rowForRequest(uid, q?.falRequestId)
        await fileGeneration(uid, row?.id, folderId)
        const url = row?.imageUrl ?? res.url
        items.push({ id: row?.id ?? null, jobId: res.queueId, kind: 'image', status: 'done', url: signed(url), thumb: signed(url), model: spec.label, prompt: clip(prompt, 200), tickets: res.ticketCost })
      }
      const made = items.filter(i => i.status !== 'failed').length
      const spent = items.reduce((a, i) => a + i.tickets, 0)
      if (!made) return { ...(await results(ctx, items, `The ${editing ? 'edit' : 'image'} failed.`)), isError: true }
      return results(ctx, items, `${editing ? 'Edited' : 'Made'} ${made} image${made === 1 ? '' : 's'} with ${spec.label} (${spent} tickets).`)
    }

    case 'generate_video': {
      const prompt = clip(args.prompt, 4000)
      const stop = await guardPrompt(ctx, prompt)
      if (stop) return err(stop)
      const spec = novaVideoModels(isAdmin).find(m => m.id === (args.model || DEFAULT_VIDEO_MODEL))
      if (!spec) return err(`Unknown or unavailable video model "${args.model}". Call list_models with kind "video".`)
      const wantIds = [args.start_image_id, ...(spec.endFrame && args.end_image_id ? [args.end_image_id] : [])].filter(v => v != null).map(Number)
      const owned = await ownedRows(uid, wantIds)
      const frameUrls = wantIds.map(id => owned.find(r => r.id === id)).filter(r => r && kindOf(r) === 'image').map(r => r!.imageUrl)
      const links = args.start_image_url ? [String(args.start_image_url)] : []
      const linkStop = await guardLinks(ctx, links)
      if (linkStop) return err(linkStop)
      const refs = [...links, ...frameUrls].slice(0, Math.max(1, spec.maxRefs, spec.endFrame ? 2 : 1))
      if (spec.needsRef && !refs.length) return err(`${spec.label} animates a picture: pass start_image_id (one of the user's pictures) or start_image_url.`)
      const picStop = refs.length ? await guardPictures(ctx, refs) : null
      if (picStop) return err(picStop)
      const settings: Record<string, string> = {}
      if (args.duration) settings.duration = String(args.duration)
      if (args.aspect_ratio) settings.aspect = String(args.aspect_ratio)
      if (args.resolution) settings.resolution = String(args.resolution)
      if (args.audio !== undefined) settings.audio = args.audio ? 'on' : 'off'
      const { settings: s } = estimateCreate(spec, settings)
      const startEnd = !!(spec.endFrame && refs.length >= 2 && !spec.needsRef)
      const frames = startEnd ? { imageUrl: refs[0], endImageUrl: refs[1], sd20Mode: 'i2v', referenceImageUrls: [] } : undefined
      const res = await submitChatVideo(spec, prompt, refs, s, frames, { headers: ctx.headers })
      if (!res.ok) return err(`The video could not start: ${res.error}`)
      const item: Item = { id: null, jobId: res.queueId, kind: 'video', status: 'rendering', url: null, thumb: signed(refs[0] ?? null), model: spec.label, prompt: clip(prompt, 200), tickets: res.ticketCost }
      return results(ctx, [item], `Started a ${s.duration ?? '5'}s video with ${spec.label} (${res.ticketCost} tickets). It takes 1-5 minutes - call get_generations with job ${res.queueId} to get it (tell the user it is rendering).`)
    }

    case 'get_generations': {
      const jobIds = (Array.isArray(args.job_ids) ? args.job_ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 12)
      const rowIds = (Array.isArray(args.ids) ? args.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 24)
      if (!jobIds.length && !rowIds.length) return err('Pass job_ids (from generate_video / generate_image) or ids (My Generations ids).')
      const folderId = await filing(ctx)
      const items: Item[] = []
      for (const jobId of jobIds) {
        const job = await prisma.generationQueue.findFirst({ where: { id: jobId, userId: uid }, select: { modelId: true, prompt: true, ticketCost: true, modelType: true } })
        if (!job) { items.push({ id: null, jobId, kind: 'unknown', status: 'failed', url: null, thumb: null, model: '?', prompt: '', tickets: 0, error: 'No such job on this account' }); continue }
        const kind = job.modelType === 'video' ? 'video' : job.modelType === 'audio' ? 'audio' : 'image'
        const r = await settleQueueJob({ id: uid, email: ctx.auth.user.email }, jobId, ctx.headers)
        if (r.status === 'done') {
          await fileGeneration(uid, r.generationId, folderId)
          items.push({ id: r.generationId ?? null, jobId, kind, status: 'done', url: signed(r.url), thumb: signed(r.posterUrl ?? (kind === 'image' ? r.url : null)), model: job.modelId, prompt: clip(job.prompt, 200), tickets: job.ticketCost ?? 0 })
        } else if (r.status === 'error') {
          items.push({ id: null, jobId, kind, status: 'failed', url: null, thumb: null, model: job.modelId, prompt: clip(job.prompt, 200), tickets: 0, error: r.error })
        } else {
          items.push({ id: null, jobId, kind, status: 'rendering', url: null, thumb: null, model: job.modelId, prompt: clip(job.prompt, 200), tickets: job.ticketCost ?? 0 })
        }
      }
      if (rowIds.length) {
        const rows = await prisma.generatedImage.findMany({ where: { id: { in: rowIds }, userId: uid, isDeleted: false }, select: { id: true, imageUrl: true, model: true, prompt: true, videoMetadata: true, ticketCost: true, thumbnailUrl: true } })
        for (const r of rows) items.push(rowItem(r))
      }
      const rendering = items.filter(i => i.status === 'rendering').length
      return results(ctx, items, rendering ? `${rendering} still rendering - check again in a minute.` : 'Here they are.')
    }

    case 'search_library': {
      const limit = Math.min(24, Math.max(1, Number(args.limit) || 12))
      const q = clip(args.query, 100)
      const kind = args.kind === 'image' || args.kind === 'video' ? args.kind : 'any'
      const rows = await prisma.generatedImage.findMany({
        where: {
          userId: uid, isDeleted: false, isHidden: false,
          ...(q ? { prompt: { contains: q, mode: 'insensitive' as const } } : {}),
          ...(kind === 'video' ? { videoMetadata: { path: ['isVideo'], equals: true } } : {}),
          NOT: [{ model: { startsWith: 'audio:' } }, { model: { startsWith: '3d:' } }],
        },
        orderBy: { id: 'desc' }, take: kind === 'image' ? limit * 2 : limit,
        select: { id: true, imageUrl: true, model: true, prompt: true, videoMetadata: true, ticketCost: true, thumbnailUrl: true },
      })
      const found = rows.map(rowItem).filter(i => kind === 'any' || i.kind === kind).slice(0, limit)
      // Only what may be shown in the chat (the library can hold adult work - fine on the site, not here)
      await screen(found)
      const items = found.filter(i => !i.hidden && !ADULT_TEXT.test(i.prompt))
      const left = found.length - items.length
      return {
        content: [{ type: 'text', text: items.length ? `${items.length} from the user's library (newest first)${left ? ` (${left} more not shown in ${ctx.app})` : ''}:\n${items.map(i => `- #${i.id} ${i.kind} · ${i.model} · "${i.prompt}"`).join('\n')}` : `Nothing in the library matches${left ? ` that can be shown in ${ctx.app}` : ''}.` }],
        structuredContent: { items, library: true },
      }
    }
  }
  return err(`Unknown tool: ${name}`)
}
