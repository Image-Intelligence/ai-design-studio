/**
 * Nova Studio - the agent's tools (server only, 2026-10-18).
 *
 * THE RULES EVERY TOOL KEEPS
 *  - Media is referred to by its My Generations id ("#112450"), never by URL:
 *    every id is looked up as a row of THIS user's (ownedRows), so Nova can
 *    only ever touch the user's own media.
 *  - Generations go through the site's own routes (/api/generate,
 *    /api/video/generate, /api/audio/generate, submitThreeD), which gate the
 *    models and charge the tickets exactly as everywhere else on the site.
 *  - Before anything is spent, `guard` checks the user's limits and the plan:
 *    with an approved plan, the plan's budget is the limit; without one, a
 *    turn may spend up to the user's "ask above" amount and anything bigger
 *    is refused with an instruction to propose a plan. The estimate is
 *    RESERVED while the call runs, so parallel calls cannot overshoot together.
 *  - Results are filed into the chat's own folder (My Generations / Nova
 *    Studio / <chat>) unless the user already filed them.
 */
import { NextRequest } from 'next/server'
import { tool, jsonSchema, type ToolSet } from 'ai'
import prisma from '@/lib/prisma'
import { submitChatImage } from '@/lib/chat-image-submit'
import { loadLessons, lessonsFor } from '@/lib/nova/lessons'
import { submitChatVideo } from '@/lib/chat-video-submit'
import { VIDEO_MODEL_IDS, VIDEO_FILE_EXTS } from '@/lib/fal-video-endpoints'
import { getAudioStudioModel, audioTicketCost, spokenCharCount } from '@/lib/audio-studio'
import { toolTickets } from '@/lib/threed/catalog'
import { listAssets, findAsset, insertAsset, updateAsset, countAssets, withRefs, storedRefs, assetKind, assetName, assetNotes, MAX_USER_ASSETS } from '@/lib/user-assets'
import { addLinks } from '@/lib/generation-folder-links'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { describeModels, novaImageModels, novaVideoModels, novaAudioModels, novaThreeDTools, estimateCreate, type NovaKind } from '@/lib/nova/catalog'
import { rowForRequest, fileGeneration } from '@/lib/nova/jobs'
import { addNovaSpend, roomLeft } from '@/lib/nova/ledger'
import { cleanRunBudget, novaCutTickets, type NovaContextMark, type NovaBudget, type NovaSpend, type NovaStep, type NovaPlan, type NovaMediaKind } from '@/lib/nova/config'
import sharp from 'sharp'
import { fetchMedia } from '@/lib/media-fetch'

// ── The turn's context ───────────────────────────────────────────────────────

export type NovaChatState = {
  v: 1
  folderId: number | null
  /** Tickets this chat has spent, all time (chat tokens + generations). */
  spent: number
  /** The approved plan, while it has budget left. */
  plan: { messageId: number; total: number; spent: number } | null
  /** Turns the current production has chained by itself since the user last wrote. */
  autoTurns?: number
  /**
   * Tickets spent outside a plan by the current request, across the turns it
   * carried on by itself (renders landing, or out of steps / time). Each turn
   * may spend up to budget.askAbove without asking; the whole chain up to
   * NOVA_CHAIN_ASK_MULTIPLE x that - so a production that keeps going on its
   * own cannot spend the allowance again and again, but a small finishing step
   * (a 2-ticket seam repair after a 9-ticket clip) never stops it (2026-10-19
   * test: a whole-request cap turned that repair into a plan to approve).
   * Starts at 0 when the user writes.
   */
  chainUnplanned?: number
  /**
   * The run budget the user set in the prompt box for the current request
   * (lib/nova/config cleanRunBudget): the most it may spend outside a plan, in
   * all, across the turns it carries on by itself. Replaced each time the user
   * writes; absent = the older askAbove rule (see NovaAllowance).
   */
  runBudget?: number
  /** Where the user compacted / cleared the context (lib/nova/agent resetChatContext). */
  marks?: NovaContextMark[]
  /** A background turn finished while the user was away: shown as new until the chat is opened. */
  unread?: boolean
  /**
   * The chat's references (2026-10-19, owner): assets and My Generations
   * pictures the user switched on in the studio panel. Every turn tells Nova
   * about them; their pictures are shown again whenever the set changes
   * (`refsShown` = the set Nova last saw).
   */
  refs?: { assets: number[]; generations: number[] }
  refsShown?: string
  /**
   * The look bible (2026-10-19): the pictures that define this chat's
   * characters and places, and its style - set by Nova (set_look_bible) once a
   * production's look is decided. Every later generation passes the relevant
   * ones as references, and check_shots compares new shots against them.
   */
  bible?: NovaBible | null
}
export type NovaBible = {
  characters: { name: string; ids: number[] }[]
  places: { name: string; ids: number[] }[]
  style: string
}
const MAX_BIBLE_ENTRIES = 6
export function cleanBible(v: unknown): NovaBible | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const entries = (x: unknown) => (Array.isArray(x) ? x : []).slice(0, MAX_BIBLE_ENTRIES).map((e: any) => ({
    name: String(e?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Unnamed',
    ids: [...new Set((Array.isArray(e?.ids) ? e.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 4) as number[],
  })).filter(e => e.ids.length)
  const b: NovaBible = { characters: entries(o.characters), places: entries(o.places), style: String(o.style ?? '').slice(0, 1200) }
  return b.characters.length || b.places.length || b.style ? b : null
}
/** Every picture id in the bible (characters first). */
export const bibleIds = (b?: NovaBible | null) => b ? [...new Set([...b.characters.flatMap(c => c.ids), ...b.places.flatMap(p => p.ids)])] : []
/** How many ask-first allowances a request may spend in all over the turns it carries on by itself. */
export const NOVA_CHAIN_ASK_MULTIPLE = 3
export const NOVA_MAX_REF_ASSETS = 8
export const NOVA_MAX_REF_GENERATIONS = 12
const idList = (v: unknown, max: number) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, max)
export const cleanChatRefs = (v: unknown): { assets: number[]; generations: number[] } => {
  const o = (v && typeof v === 'object' ? v : {}) as { assets?: unknown; generations?: unknown }
  return { assets: idList(o.assets, NOVA_MAX_REF_ASSETS), generations: idList(o.generations, NOVA_MAX_REF_GENERATIONS) }
}
export const refsKey = (r?: { assets: number[]; generations: number[] }) => r ? `a${[...r.assets].sort((x, y) => x - y).join(',')}|g${[...r.generations].sort((x, y) => x - y).join(',')}` : ''

export const emptyChatState = (): NovaChatState => ({ v: 1, folderId: null, spent: 0, plan: null })

export function readChatState(raw: unknown): NovaChatState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<NovaChatState>
  return {
    v: 1,
    folderId: typeof o.folderId === 'number' ? o.folderId : null,
    spent: Math.max(0, Number(o.spent) || 0),
    plan: o.plan && typeof o.plan === 'object' && Number(o.plan.total) > 0
      ? { messageId: Number(o.plan.messageId) || 0, total: Number(o.plan.total), spent: Math.max(0, Number(o.plan.spent) || 0) }
      : null,
    autoTurns: Math.max(0, Number(o.autoTurns) || 0),
    chainUnplanned: Math.max(0, Number(o.chainUnplanned) || 0),
    runBudget: cleanRunBudget(o.runBudget),
    marks: Array.isArray(o.marks) ? o.marks.filter(m => m && Number.isInteger(m.afterId) && (m.kind === 'compact' || m.kind === 'clear')).slice(-30) : undefined,
    unread: o.unread === true,
    refs: cleanChatRefs(o.refs),
    refsShown: typeof o.refsShown === 'string' ? o.refsShown.slice(0, 400) : undefined,
    bible: cleanBible(o.bible),
  }
}

/**
 * What a request may spend outside a plan without asking. With a run budget
 * (the prompt box) it is one number for the whole request; without one, the
 * older rule: askAbove a turn and NOVA_CHAIN_ASK_MULTIPLE x that in all.
 */
export type NovaAllowance = { turn: number; request: number; run: boolean }
export const novaAllowance = (budget: NovaBudget, state: NovaChatState): NovaAllowance => state.runBudget
  ? { turn: state.runBudget, request: state.runBudget, run: true }
  : { turn: budget.askAbove, request: budget.askAbove * NOVA_CHAIN_ASK_MULTIPLE, run: false }

/**
 * The model name a Nova / Prism-made file is saved under (2026-10-20, owner:
 * Prism's edits showed in the feed as "nova-edit"): "prism-edit" from Prism's
 * chat, "nova-edit" from Nova Studio. The feed shows them as "Prism edit" /
 * "Nova edit" (portal getModelDisplayName).
 */
export const agentModel = (ctx: { persona?: 'nova' | 'prism' }, what: string) => `${ctx.persona === 'prism' ? 'prism' : 'nova'}-${what}`
export const agentName = (ctx: { persona?: 'nova' | 'prism' }) => (ctx.persona === 'prism' ? 'Prism' : 'Nova')

export type NovaTurnCtx = {
  /** Whose turn this is: Prism's chat or Nova Studio's (names the files it saves). */
  persona?: 'nova' | 'prism'
  user: { id: number; email: string }
  isAdmin: boolean
  chatId: number
  state: NovaChatState
  budget: NovaBudget
  spend: NovaSpend
  /** Every step of this turn, in order; `emit` streams one to the browser. */
  steps: NovaStep[]
  emit: (step: NovaStep) => void
  /** How long the reply's text is so far - stamped on each new step (NovaStep.textAt). */
  textLength?: () => number
  /** Generation tickets spent this turn (real charges, as the routes report them). */
  mediaTickets: number
  /** Of those, spent outside a plan - limited by the allowance. */
  unplanned: number
  /** What this request may spend outside a plan without asking. */
  allowance: NovaAllowance
  /** Spent outside a plan by the earlier turns of this request (a turn that carried on by itself). */
  chainBefore?: number
  /** Estimates of calls still running. */
  reserved: number
  /** Set by the turn-ending tools. */
  proposedPlan: NovaPlan | null
  /** A plan that fitted inside the allowance: approved by the studio, shown on the reply, and the turn carried on. */
  autoPlan?: NovaPlan | null
  waitForRenders: boolean
  /** Ids the model has seen this turn or that the user attached (a hint for later turns; access is always checked). */
  seenIds: Set<number>
  /** Model cost of this turn beyond the orchestrator's own tokens (critic, captions...), in USD - billed with the chat. */
  extraUsd: number
  /** What the user asked for (the critic reviews against it). */
  brief: string
  criticRuns: number
  /** generate_image failures per model this turn (switching models is suggested after 3). */
  modelFailures: Record<string, number>
  /** The last critic verdict this turn: a second review only follows a "revise". */
  lastCriticVerdict?: 'pass' | 'revise'
  /**
   * Set on a BACKGROUND turn (no browser session): the user's own Nova API key
   * header (lib/nova/background), sent on the site's generation routes.
   */
  authHeaders?: Record<string, string>
  /**
   * When this turn stops waiting for pictures (epoch ms). An image still
   * rendering then comes back as 'pending' and is settled by the jobs route,
   * like a video - instead of the turn running into its hard time limit.
   */
  deadline?: number
}

let stepSeq = 0
export const newStep = (ctx: NovaTurnCtx, s: Omit<NovaStep, 'id'>): NovaStep => {
  const now = Date.now()
  const step: NovaStep = { id: `s${now.toString(36)}${(stepSeq++).toString(36)}`, startedAt: now, textAt: ctx.textLength?.() ?? 0, ...s }
  ctx.steps.push(step)
  ctx.emit(step)
  return step
}
export const update = (ctx: NovaTurnCtx, step: NovaStep, patch: Partial<NovaStep>) => { Object.assign(step, patch); ctx.emit(step) }

// ── Spending ─────────────────────────────────────────────────────────────────

/** null = go ahead (and the estimate is now reserved); a string = refused, and why (for the model). */
export function guard(ctx: NovaTurnCtx, estimate: number): string | null {
  const est = Math.max(0, Math.ceil(estimate))
  const live = ctx.mediaTickets + ctx.reserved
  const { room, which } = roomLeft(ctx.budget, { today: ctx.spend.today + live, month: ctx.spend.month + live }, ctx.state.spent + live)
  if (est > room) return `Refused: this costs about ${est} tickets but only ${room} remain under ${which}. Tell the user, and suggest raising the limit in Budget or a cheaper option.`
  const plan = ctx.state.plan
  if (plan) {
    const left = plan.total - plan.spent - ctx.reserved
    if (est > left) return `Refused: this costs about ${est} tickets but the approved plan has ${Math.max(0, left)} left (${plan.spent}/${plan.total} spent). Call propose_plan with the extra tickets needed and why.`
  } else if (ctx.allowance.run && (ctx.chainBefore ?? 0) + ctx.unplanned + ctx.reserved + est > ctx.allowance.request) {
    return `Refused: the user set this request's budget at ${ctx.allowance.request} tickets and ${(ctx.chainBefore ?? 0) + ctx.unplanned} are already spent - this costs about ${est}. Call propose_plan with what is left and its cost, then stop and wait for approval.`
  } else if (ctx.unplanned + ctx.reserved + est > ctx.allowance.turn) {
    return `Refused: the user approves anything over ${ctx.allowance.turn} tickets in advance. Call propose_plan with the steps and their ticket costs, then stop and wait for approval.`
  } else if ((ctx.chainBefore ?? 0) + ctx.unplanned + ctx.reserved + est > ctx.allowance.request) {
    return `Refused: this request has already spent ${(ctx.chainBefore ?? 0) + ctx.unplanned} tickets over the turns it carried on by itself - more needs the user's approval. Call propose_plan with what is left and its cost, then stop.`
  }
  ctx.reserved += est
  return null
}

/** The call finished: release its reservation and book what it really cost. */
export async function settleSpend(ctx: NovaTurnCtx, estimate: number, actual: number) {
  ctx.reserved = Math.max(0, ctx.reserved - Math.max(0, Math.ceil(estimate)))
  const t = Math.max(0, Math.round(actual))
  if (!t) return
  ctx.mediaTickets += t
  if (ctx.state.plan) ctx.state.plan.spent += t
  else ctx.unplanned += t
  ctx.state.spent += t
  await addNovaSpend(ctx.user.id, t).catch(() => {})
}

// ── The user's media ─────────────────────────────────────────────────────────

const VIDEO_MODELS = new Set(VIDEO_MODEL_IDS)
export type Row = { id: number; imageUrl: string; model: string; prompt: string; videoMetadata: unknown; folderId: number | null; createdAt: Date }

export function kindOf(r: { imageUrl: string; model: string; videoMetadata?: unknown }): NovaMediaKind {
  const m = (r.videoMetadata ?? {}) as Record<string, any>
  if (r.model.startsWith('3d:') || m.threed) return '3d'
  if (r.model.startsWith('audio:') || m.isAudio) return 'audio'
  // Edited films of any studio: Nova's, Storyboard's Final Cut, the ad cuts filed as storyboard-final-cut
  if (r.model.endsWith('final-cut')) return 'cut'
  const url = r.imageUrl.split('?')[0].toLowerCase()
  if (VIDEO_MODELS.has(r.model) || m.isVideo || VIDEO_FILE_EXTS.some(e => url.endsWith(e))) return 'video'
  return 'image'
}

/** Rows of THIS user's, by id - anything else is silently left out. */
export async function ownedRows(userId: number, ids: unknown[]): Promise<Row[]> {
  const want = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 40)
  if (!want.length) return []
  const rows = await prisma.generatedImage.findMany({
    where: { id: { in: want }, userId, isDeleted: false },
    select: { id: true, imageUrl: true, model: true, prompt: true, videoMetadata: true, folderId: true, createdAt: true },
  })
  return want.map(id => rows.find(r => r.id === id)).filter(Boolean) as Row[]
}

export const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
export const brief = (r: Row) => ({ id: r.id, kind: kindOf(r), model: r.model, prompt: clip(r.prompt, 140), created: r.createdAt.toISOString().slice(0, 10), folderId: r.folderId })
export const posterOf = (r: { videoMetadata?: unknown }) => {
  const m = (r.videoMetadata ?? {}) as Record<string, any>
  const p = m.thumbnailUrl ?? m.threed?.poster
  return typeof p === 'string' ? p : undefined
}
export const secondsOf = (r: Row) => {
  const d = Number(((r.videoMetadata ?? {}) as Record<string, any>).duration)
  return Number.isFinite(d) && d > 0 ? d : 5
}

/**
 * A picture for the model to look at, inlined as bytes (Gemini will not fetch
 * arbitrary URLs) and shrunk to 768px - an image costs input tokens by size,
 * and judging a frame does not need the full render.
 */
export async function imagePart(url: string) {
  try {
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer()
    return { type: 'file' as const, data: { type: 'data' as const, data: new Uint8Array(jpg) }, mediaType: 'image/jpeg' }
  } catch { return null }
}

/** Tool results that carry pictures: the JSON first, then each picture inlined. */
export const withPictures = ({ output }: { output: any }) => {
  const pics = Array.isArray(output?._pictures) ? output._pictures : []
  const { _pictures, ...rest } = output ?? {}
  if (!pics.length) return { type: 'json' as const, value: rest }
  return { type: 'content' as const, value: [{ type: 'text' as const, text: JSON.stringify(rest) }, ...pics] }
}

// ── The assembly route, server to server ─────────────────────────────────────

export async function assemble(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { POST } = await import('@/app/api/video/assemble/route')
  const res = await POST(new NextRequest('http://internal/api/video/assemble', {
    method: 'POST',
    // The route is admin-only for browsers; Nova calls it only with media it
    // has already checked belongs to this user (same as Storyboard's Final Cut)
    headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD ?? '' },
    body: JSON.stringify(body),
  }))
  const data = await res.json() as Record<string, any>
  if (!res.ok) throw new Error(String(data?.error || `Assembly failed (${res.status})`).slice(0, 300))
  return data
}

// ── The tools ────────────────────────────────────────────────────────────────

/** Failures worth retrying as they are (generate_image retries these itself). */
const TRANSIENT_ERROR = /couldn.?t be loaded|could not be (loaded|read|fetched)|time(d)? ?out|timeout|try again|busy|temporar|unavailable|overloaded|rate.?limit|\b(429|500|502|503|504)\b|network|ECONN|fetch failed|socket/i
/** A provider's content checker refusing the prompt or a picture: rephrase, same model. */
const REFUSAL_ERROR = /content|safety|flagged|refus|policy|moderat|nsfw|bare 422|sensitive/i

const ids = { type: 'array', items: { type: 'integer' }, description: 'My Generations ids (the numbers after #)' } as const

/**
 * With a look bible set, a generation without references is the classic way a
 * character drifts - so it is refused with what to pass instead, unless the
 * shot genuinely has none of the bible in it (no_bible: true - a logo card, a
 * product-only insert, an abstract background).
 */
export function bibleGate(ctx: NovaTurnCtx, refIds: unknown[], noBible?: boolean): string | null {
  const b = ctx.state.bible
  if (!b || noBible || refIds.some(v => Number(v) > 0)) return null
  const list = [...b.characters.map(c => `character "${c.name}": ${c.ids.map(i => `#${i}`).join(', ')}`), ...b.places.map(p => `place "${p.name}": ${p.ids.map(i => `#${i}`).join(', ')}`)].join('; ')
  return `Not sent: this chat has a look bible (${list}). Pass the references for whoever / wherever is in this shot (character first) - or no_bible: true if the shot shows none of them.`
}

export function makeNovaTools(ctx: NovaTurnCtx): ToolSet {
  const uid = ctx.user.id

  const search_library = tool({
    description: 'Search the user\'s My Generations (their images, videos, audio, 3D models and cuts - kind "cut" = edited final videos). Returns ids, kind, model, prompt and the folder\'s full path. Use before making something new when the user refers to existing work; with folder_id + include_subfolders it lists everything in a folder tree.',
    inputSchema: jsonSchema<{ query?: string; kind?: NovaMediaKind; folder_id?: number; include_subfolders?: boolean; limit?: number }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find in the prompt or model name. Empty = newest first.' },
        kind: { type: 'string', enum: ['image', 'video', 'audio', '3d', 'cut'] },
        folder_id: { type: 'integer', description: 'Only this folder' },
        include_subfolders: { type: 'boolean', description: 'With folder_id: search everything inside it, at any depth' },
        limit: { type: 'integer', description: '1-60, default 12' },
      },
    }),
    execute: async (input) => {
      const take = Math.min(60, Math.max(1, Math.round(Number(input.limit) || 12)))
      const q = clip(input.query, 80)
      const where: any = { userId: uid, isDeleted: false }
      if (typeof input.folder_id === 'number') {
        if (input.include_subfolders) {
          const all = await prisma.userGenerationFolder.findMany({ where: { userId: uid }, select: { id: true, parentId: true }, take: 2000 })
          const inside = new Set([input.folder_id])
          for (let grew = true; grew;) { grew = false; for (const f of all) if (f.parentId && inside.has(f.parentId) && !inside.has(f.id)) { inside.add(f.id); grew = true } }
          where.folderId = { in: [...inside] }
        } else where.folderId = input.folder_id
      }
      if (q) where.OR = [{ prompt: { contains: q, mode: 'insensitive' } }, { model: { contains: q, mode: 'insensitive' } }]
      // Over-fetch so a kind filter (decided per row) still fills the page
      const rows = await prisma.generatedImage.findMany({
        where, orderBy: { id: 'desc' }, take: input.kind ? take * 4 : take,
        select: { id: true, imageUrl: true, model: true, prompt: true, videoMetadata: true, folderId: true, createdAt: true },
      })
      const hits = rows.filter(r => !input.kind || kindOf(r) === input.kind).slice(0, take)
      // Each result says WHERE it lives (the folder's full path), so organising needs no tree-walking
      const folders = await prisma.userGenerationFolder.findMany({ where: { userId: uid }, select: { id: true, name: true, parentId: true }, take: 2000 })
      const fById = new Map(folders.map(f => [f.id, f]))
      const pathOf = (id: number | null) => { const parts: string[] = []; let f = id ? fById.get(id) : undefined; for (let i = 0; f && i < 12; i++) { parts.unshift(f.name); f = f.parentId ? fById.get(f.parentId) : undefined } return parts.join(' / ') || null }
      const items = hits.map(r => ({ ...brief(r), folder: pathOf(r.folderId) }))
      items.forEach(i => ctx.seenIds.add(i.id))
      newStep(ctx, { tool: 'search_library', label: q ? `Searched your library for "${q}"` : 'Looked through your library', status: 'done', note: `${items.length} found` })
      return { items }
    },
  })

  const view_media = tool({
    description: 'Look at up to 4 of the user\'s images (or a video\'s / 3D model\'s poster) to judge them, describe them or pick references. Costs a little context, so only look when it matters.',
    inputSchema: jsonSchema<{ ids: number[] }>({ type: 'object', properties: { ids }, required: ['ids'] }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const rows = (await ownedRows(uid, input.ids)).slice(0, 4)
      const pictures = []
      for (const r of rows) {
        const k = kindOf(r)
        const url = k === 'image' ? r.imageUrl : posterOf(r)
        const part = url ? await imagePart(url) : null
        if (part) pictures.push(part)
      }
      newStep(ctx, { tool: 'view_media', label: `Looked at ${rows.map(r => `#${r.id}`).join(', ') || 'nothing'}`, status: 'done' })
      return { looked_at: rows.map(brief), _pictures: pictures }
    },
  })

  // Folders by name (a busy account has hundreds - never the whole tree)
  const list_folders = tool({
    description: 'Find the user\'s My Generations folders: id, full path ("Advertisements / Mascot Ads / ..."), items and subfolders. Pass `name` to search any part of the path; without it you get the folders at one level (top level, or inside parent_id). Returns at most 40.',
    inputSchema: jsonSchema<{ name?: string; parent_id?: number }>({
      type: 'object',
      properties: { name: { type: 'string', description: 'Part of a folder name' }, parent_id: { type: 'integer', description: 'List the folders inside this one' } },
    }),
    execute: async (input) => {
      // A busy account has hundreds of folders: never send the whole tree into the context
      const q = clip(input.name, 60)
      // The whole tree is read once (names only) so every result carries its full path -
      // "Advertisements / Mascot Ads / Prism and Nova Ads" - and how many subfolders it has;
      // without paths, models wandered the tree one level at a time and ran out of steps
      const all = await prisma.userGenerationFolder.findMany({ where: { userId: uid }, select: { id: true, name: true, parentId: true }, take: 2000 })
      const byId = new Map(all.map(f => [f.id, f]))
      const path = (id: number) => { const parts: string[] = []; let f = byId.get(id); for (let i = 0; f && i < 12; i++) { parts.unshift(f.name); f = f.parentId ? byId.get(f.parentId) : undefined } return parts.join(' / ') }
      const kids = new Map<number, number>()
      for (const f of all) if (f.parentId) kids.set(f.parentId, (kids.get(f.parentId) ?? 0) + 1)
      const folders = (q ? all.filter(f => path(f.id).toLowerCase().includes(q.toLowerCase())) : all.filter(f => f.parentId === (typeof input.parent_id === 'number' ? input.parent_id : null)))
        .sort((a, b) => path(a.id).localeCompare(path(b.id))).slice(0, 40)
      const counts = await prisma.generatedImage.groupBy({ by: ['folderId'], where: { userId: uid, isDeleted: false, folderId: { in: folders.map(f => f.id) } }, _count: true })
      const n = new Map(counts.map(c => [c.folderId, c._count]))
      newStep(ctx, { tool: 'list_folders', label: q ? `Looked for folders named "${q}"` : 'Read your folders', status: 'done', note: `${folders.length} folders` })
      return { folders: folders.map(f => ({ id: f.id, path: path(f.id), items: n.get(f.id) ?? 0, subfolders: kids.get(f.id) ?? 0 })), chatFolderId: ctx.state.folderId }
    },
  })

  const create_folder = tool({
    description: 'Create a folder in My Generations (optionally inside another folder). Returns its id.',
    inputSchema: jsonSchema<{ name: string; parent_id?: number }>({ type: 'object', properties: { name: { type: 'string' }, parent_id: { type: 'integer' } }, required: ['name'] }),
    execute: async (input) => {
      const name = clip(input.name, 80)
      if (!name) return { error: 'A folder needs a name' }
      let parentId: number | null = null
      if (typeof input.parent_id === 'number') {
        const p = await prisma.userGenerationFolder.findFirst({ where: { id: input.parent_id, userId: uid }, select: { id: true } })
        if (!p) return { error: 'That parent folder is not one of the user\'s' }
        parentId = p.id
      }
      const existing = await prisma.userGenerationFolder.findFirst({ where: { userId: uid, name, parentId }, select: { id: true } })
      const f = existing ?? await prisma.userGenerationFolder.create({ data: { userId: uid, name, parentId }, select: { id: true } })
      newStep(ctx, { tool: 'create_folder', label: `${existing ? 'Found' : 'Created'} folder "${name}"`, status: 'done' })
      return { folderId: f.id, existed: !!existing }
    },
  })

  const file_items = tool({
    description: 'Organise generations: "move" puts them in a folder (out of where they were); "add" also shows them in a folder without moving them.',
    inputSchema: jsonSchema<{ ids: number[]; folder_id: number; mode?: 'move' | 'add' }>({
      type: 'object', properties: { ids, folder_id: { type: 'integer' }, mode: { type: 'string', enum: ['move', 'add'] } }, required: ['ids', 'folder_id'],
    }),
    execute: async (input) => {
      const f = await prisma.userGenerationFolder.findFirst({ where: { id: input.folder_id, userId: uid }, select: { id: true, name: true } })
      if (!f) return { error: 'That folder is not one of the user\'s' }
      const rows = await ownedRows(uid, input.ids)
      if (!rows.length) return { error: 'None of those ids are the user\'s' }
      let n = 0
      if (input.mode === 'add') n = await addLinks(uid, rows.map(r => r.id), [f.id])
      else n = (await prisma.generatedImage.updateMany({ where: { id: { in: rows.map(r => r.id) }, userId: uid }, data: { folderId: f.id } })).count
      newStep(ctx, { tool: 'file_items', label: `${input.mode === 'add' ? 'Added' : 'Moved'} ${rows.length} to "${f.name}"`, status: 'done' })
      return { done: n, folder: f.name }
    },
  })

  const list_assets = tool({
    description: 'List the user\'s Assets (saved characters, products, places, styles... each a named set of reference pictures). Returns id, kind, name, notes and picture count.',
    inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
    execute: async () => {
      const rows = await listAssets(uid)
      newStep(ctx, { tool: 'list_assets', label: 'Read your assets', status: 'done', note: `${rows.length} assets` })
      return { assets: rows.map(a => ({ id: a.id, kind: a.kind, name: a.name, notes: clip(a.notes, 200), pictures: storedRefs(a.refs).length })) }
    },
  })

  const asset_pictures = tool({
    description: 'Get an asset\'s pictures as My Generations ids, to use as references for a generation (a character\'s face, a product).',
    inputSchema: jsonSchema<{ asset_id: number }>({ type: 'object', properties: { asset_id: { type: 'integer' } }, required: ['asset_id'] }),
    execute: async (input) => {
      const a = await findAsset(uid, input.asset_id)
      if (!a) return { error: 'No such asset' }
      const urls = storedRefs(a.refs).map(r => r.url)
      // Map the pictures back to the user's rows (only rows can be references)
      const rows = urls.length ? await prisma.generatedImage.findMany({ where: { userId: uid, isDeleted: false, imageUrl: { in: urls } }, select: { id: true, imageUrl: true, prompt: true } }) : []
      rows.forEach(r => ctx.seenIds.add(r.id))
      newStep(ctx, { tool: 'asset_pictures', label: `Opened asset "${a.name}"`, status: 'done', note: `${rows.length} pictures` })
      return { asset: { id: a.id, name: a.name, kind: a.kind, notes: clip(a.notes, 400) }, pictures: rows.map(r => ({ id: r.id, prompt: clip(r.prompt, 100) })) }
    },
  })

  const save_asset = tool({
    description: 'Create an Asset from generations (e.g. the character sheet you just made) or add pictures to an existing one. Assets keep characters and products consistent across later work.',
    inputSchema: jsonSchema<{ ids: number[]; name?: string; kind?: string; notes?: string; asset_id?: number }>({
      type: 'object',
      properties: {
        ids, name: { type: 'string' },
        kind: { type: 'string', enum: ['character', 'creature', 'vehicle', 'object', 'wardrobe', 'location', 'landmark', 'scenery', 'style', 'other'] },
        notes: { type: 'string', description: 'What it is - appearance, materials, rules to keep it consistent' },
        asset_id: { type: 'integer', description: 'Add to this existing asset instead of creating one' },
      },
      required: ['ids'],
    }),
    execute: async (input) => {
      const rows = (await ownedRows(uid, input.ids)).filter(r => kindOf(r) === 'image')
      if (!rows.length) return { error: 'An asset needs at least one of the user\'s images' }
      const urls = rows.map(r => r.imageUrl)
      if (typeof input.asset_id === 'number') {
        const a = await findAsset(uid, input.asset_id)
        if (!a) return { error: 'No such asset' }
        const saved = await updateAsset(uid, a.id, { kind: a.kind, name: a.name, notes: input.notes ? assetNotes(input.notes) : a.notes, refs: withRefs(storedRefs(a.refs), urls) })
        newStep(ctx, { tool: 'save_asset', label: `Added ${rows.length} to asset "${a.name}"`, status: 'done' })
        return { assetId: saved.id }
      }
      if ((await countAssets(uid)) >= MAX_USER_ASSETS) return { error: `The user has the maximum of ${MAX_USER_ASSETS} assets` }
      const name = assetName(input.name)
      const saved = await insertAsset(uid, { kind: assetKind(input.kind), name, notes: assetNotes(input.notes), refs: withRefs([], urls) })
      newStep(ctx, { tool: 'save_asset', label: `Created asset "${name}"`, status: 'done', note: `${rows.length} pictures` })
      return { assetId: saved.id }
    },
  })

  const browse_models = tool({
    description: "The models you can generate with, for one kind: a compact list (id, ticket price, refs, what it is best at). Pass `search` (an id or name) to get that model's exact settings before using it.",
    inputSchema: jsonSchema<{ kind: NovaKind; search?: string }>({
      type: 'object',
      properties: { kind: { type: 'string', enum: ['image', 'video', 'audio', '3d'] }, search: { type: 'string', description: 'A model id or name, for its full settings' } },
      required: ['kind'],
    }),
    execute: async (input) => {
      const models = describeModels(input.kind, ctx.isAdmin, input.search) || 'none matched'
      // A model looked up by name: what this account's past work taught about it too (lib/nova/lessons)
      if (!input.search) return { models }
      const ids = [...models.matchAll(/^- ([\w.:-]+)/gm)].map(m => m[1])
      const learned = ids.length ? lessonsFor(await loadLessons(uid), ids) : ''
      return { models, ...(learned ? { learned } : {}) }
    },
  })

  // ── generations ──

  const generate_image = tool({
    description: 'Make ONE image (call it several times in one step for variations - they run in parallel). Returns the new My Generations id and shows you the picture so you can judge it.',
    inputSchema: jsonSchema<{ model: string; prompt: string; settings?: Record<string, string>; reference_ids?: number[]; no_bible?: boolean }>({
      type: 'object',
      properties: {
        model: { type: 'string', description: 'An image model id from browse_models' },
        prompt: { type: 'string', description: 'The full prompt, written the way that model is best prompted' },
        settings: { type: 'object', description: 'e.g. {"aspect":"16:9","quality":"2k"} - only keys the model lists' },
        reference_ids: { ...ids, description: 'Reference images (characters, products, style) by id, most important first' },
        no_bible: { type: 'boolean', description: 'Only when the chat has a look bible and this image shows none of its characters or places' },
      },
      required: ['model', 'prompt'],
    }),
    toModelOutput: withPictures,
    execute: async (input) => {
      const spec = novaImageModels(ctx.isAdmin).find(m => m.id === input.model)
      if (!spec) return { error: `Unknown or unavailable image model "${input.model}" - call browse_models` }
      const offBible = bibleGate(ctx, input.reference_ids ?? [], input.no_bible)
      if (offBible) return { error: offBible }
      const refsRows = (await ownedRows(uid, input.reference_ids ?? [])).filter(r => kindOf(r) === 'image').slice(0, Math.max(0, spec.maxRefs))
      const { settings, tickets: est } = estimateCreate(spec, input.settings)
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'generate_image', kind: 'image', label: `${spec.label}${settings.aspect ? ` · ${settings.aspect}` : ''}`, status: 'running', model: spec.label, prompt: clip(input.prompt, 400), tickets: est })
      /*
       * STAY WITH THE CHOSEN MODEL (2026-10-20, owner: NanoBanana 2.1 failed once,
       * SeeDream once, and the shoot moved to Kling). A technical failure - a
       * reference that did not load, a timeout, a busy server - is retried here
       * with the same model, up to twice, before Nova hears of it (a failed job
       * is refunded by the site). A content refusal goes back to Nova with the
       * instruction to rephrase for the SAME model; only after 3 failures of a
       * model in this turn is switching suggested.
       */
      const send = () => submitChatImage(spec, clip(input.prompt, 4000), refsRows.map(r => r.imageUrl), settings, uid, { ...(ctx.authHeaders ? { headers: ctx.authHeaders } : {}), waitUntil: ctx.deadline })
      let res = await send()
      for (let retry = 0; !res.ok && retry < 2 && TRANSIENT_ERROR.test(res.error) && Date.now() < (ctx.deadline ?? Infinity) - 30_000; retry++) {
        update(ctx, step, { note: `retrying ${spec.label} (${retry + 1}/2) - ${clip(res.error, 80)}` })
        await new Promise(r => setTimeout(r, 2500 * (retry + 1)))
        res = await send()
      }
      if (!res.ok) {
        await settleSpend(ctx, est, 0)
        update(ctx, step, { status: 'error', error: res.error, tickets: 0 })
        const fails = (ctx.modelFailures[spec.id] = (ctx.modelFailures[spec.id] ?? 0) + 1)
        const refusal = REFUSAL_ERROR.test(res.error)
        return {
          error: res.error,
          failuresWithThisModelThisTurn: fails,
          next: fails >= 3
            ? `${spec.label} has failed ${fails} times this turn - now switch to another suitable model (say why).`
            : refusal
              ? `Its content checker refused it. Rephrase for ${spec.label} - remove or soften what could read as sensitive (body, age, violence, brands, real names), keep the brief - and call generate_image again with the SAME model (try ${fails + 1} of 3). Do not switch models yet.`
              : `Call generate_image again with the SAME model and settings (try ${fails + 1} of 3)${refsRows.length ? '; if a reference keeps failing, drop or swap that one reference' : ''}. Do not switch models yet.`,
        }
      }
      await settleSpend(ctx, est, res.ticketCost)
      if ('pending' in res) {
        update(ctx, step, { status: 'pending', queueId: res.queueId, tickets: res.ticketCost })
        ctx.waitForRenders = true
        return { status: 'still rendering - it will appear in the chat when done', ticketsCharged: res.ticketCost }
      }
      const q = res.queueId ? await prisma.generationQueue.findUnique({ where: { id: res.queueId }, select: { falRequestId: true } }) : null
      const row = await rowForRequest(uid, q?.falRequestId)
      await fileGeneration(uid, row?.id, ctx.state.folderId)
      if (row) ctx.seenIds.add(row.id)
      update(ctx, step, { status: 'done', mediaUrl: row?.imageUrl ?? res.url, generationId: row?.id, queueId: res.queueId ?? undefined, tickets: res.ticketCost })
      const pic = await imagePart(row?.imageUrl ?? res.url)
      return { id: row?.id ?? null, model: spec.id, settings, ticketsCharged: res.ticketCost, _pictures: pic ? [pic] : [] }
    },
  })

  const generate_video = tool({
    description: 'Start ONE video clip. It renders in the background (1-5 minutes): you get its job back now, and the clip appears in the chat when done. Image-to-video: pass start_image_id (and end_image_id for start/end-frame models).',
    inputSchema: jsonSchema<{ model: string; prompt: string; settings?: Record<string, string>; start_image_id?: number; end_image_id?: number; reference_ids?: number[]; no_bible?: boolean }>({
      type: 'object',
      properties: {
        model: { type: 'string', description: 'A video model id from browse_models' },
        prompt: { type: 'string', description: 'Motion, camera, action and sound for the clip' },
        settings: { type: 'object', description: 'e.g. {"duration":"5","resolution":"1080p","aspect":"9:16","audio":"on"}' },
        start_image_id: { type: 'integer' },
        end_image_id: { type: 'integer', description: 'End frame (start/end-frame models). The SAME id as start_image_id makes a loop.' },
        reference_ids: { ...ids, description: 'Reference images for reference-to-video models' },
        no_bible: { type: 'boolean', description: 'Only when the chat has a look bible and this clip shows none of its characters or places' },
      },
      required: ['model', 'prompt'],
    }),
    execute: async (input) => {
      const spec = novaVideoModels(ctx.isAdmin).find(m => m.id === input.model)
      if (!spec) return { error: `Unknown or unavailable video model "${input.model}" - call browse_models` }
      const offBible = bibleGate(ctx, [input.start_image_id, ...(input.reference_ids ?? [])].filter(v => v != null), input.no_bible)
      if (offBible) return { error: offBible }
      const want = [input.start_image_id, ...(spec.endFrame && input.end_image_id ? [input.end_image_id] : []), ...(input.reference_ids ?? [])].filter(v => v != null).map(Number)
      // Mapped back in order WITH repeats: the same still as start and end frame is how a loop is
      // made, and ownedRows returns each id once - the end frame used to be silently dropped
      const owned = await ownedRows(uid, want)
      const startEnd = !!(spec.endFrame && input.start_image_id && input.end_image_id)
      const refs = want.map(id => owned.find(r => r.id === id)).filter((r): r is Row => !!r && kindOf(r) === 'image').slice(0, Math.max(1, spec.maxRefs, startEnd ? 2 : 1))
      if (spec.needsRef && !refs.length) return { error: `${spec.label} animates a picture: pass start_image_id (one of the user's images)` }
      const { settings, tickets: est } = estimateCreate(spec, input.settings)
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'generate_video', kind: 'video', label: `${spec.label} · ${settings.duration ?? '5'}s${settings.resolution ? ` · ${settings.resolution}` : ''}`, status: 'running', model: spec.label, prompt: clip(input.prompt, 400), tickets: est, posterUrl: refs[0]?.imageUrl })
      // A start + end frame on a model that does not REQUIRE a start image (SeeDance 1.5, Wan, LTX...):
      // the shared builder would send the pair as two references; sent as the frames they are
      const frames = startEnd && !spec.needsRef && refs.length >= 2 && !(input.reference_ids ?? []).length
        ? { imageUrl: refs[0].imageUrl, endImageUrl: refs[1].imageUrl, sd20Mode: 'i2v', referenceImageUrls: [] }
        : undefined
      const res = await submitChatVideo(spec, clip(input.prompt, 4000), refs.map(r => r.imageUrl), settings, frames, ctx.authHeaders ? { headers: ctx.authHeaders } : undefined)
      if (!res.ok) {
        await settleSpend(ctx, est, 0)
        update(ctx, step, { status: 'error', error: res.error, tickets: 0 })
        return { error: res.error }
      }
      await settleSpend(ctx, est, res.ticketCost)
      update(ctx, step, { status: 'pending', queueId: res.queueId, requestId: res.requestId ?? undefined, tickets: res.ticketCost })
      return { status: 'rendering', ticketsCharged: res.ticketCost, note: 'Call wait_for_renders when everything that needs these clips has been started.' }
    },
  })

  const generate_audio = tool({
    description: 'Make audio: a voiceover (text to speech), music (a song or instrumental from a style), or sound effects - or WORK ON A RECORDING: models that take one (voice changer, voice cloning TTS, stem splitter, noise / voice isolation, restyle or extend a track, a score or sound effects for a video) need input_id: the user\'s audio file, or a video for the video-to-music / video-to-sound models. Renders in the background like video.',
    inputSchema: jsonSchema<{ model: string; text?: string; lyrics?: string; style?: string; voice?: string; duration?: number; instrumental?: boolean; input_id?: number; voice_consent?: boolean }>({
      type: 'object',
      properties: {
        model: { type: 'string', description: 'An audio model id from browse_models' },
        text: { type: 'string', description: 'The words to say, or the prompt for music / effects' },
        lyrics: { type: 'string' }, style: { type: 'string' }, voice: { type: 'string' },
        duration: { type: 'number', description: 'Seconds, where the model has a length' }, instrumental: { type: 'boolean' },
        input_id: { type: 'integer', description: 'The recording (or video) the model works on - one of the user\'s, by id' },
        voice_consent: { type: 'boolean', description: 'Voice-cloning models only: true ONLY when the user has said they have the right to use that voice' },
      },
      required: ['model'],
    }),
    execute: async (input) => {
      const spec = novaAudioModels(ctx.isAdmin).find(m => m.id === input.model)
      if (!spec) return { error: `Unknown or unavailable audio model "${input.model}" - call browse_models` }
      // The recording (or video) a model works on: the user's own, checked
      let inputRow: Row | undefined
      if (spec.audioIn) {
        inputRow = input.input_id ? (await ownedRows(uid, [input.input_id])).find(r => ['audio', 'video', 'cut'].includes(kindOf(r))) : undefined
        if (spec.audioIn.required && !inputRow) return { error: `${spec.name} works on ${spec.audioIn.label.toLowerCase()}: pass input_id (one of the user's ${/video/i.test(spec.audioIn.label) ? 'videos' : 'audio files'})` }
        if (spec.audioIn.clonesVoice && inputRow && input.voice_consent !== true) return { error: `${spec.name} clones the voice in that recording - ask the user to confirm they have the right to use it, then pass voice_consent: true` }
      }
      const text = clip(input.text, spec.text?.max ?? 4000), lyrics = clip(input.lyrics, spec.lyrics?.max ?? 4000)
      const seconds = spec.duration ? Math.min(spec.duration.max, Math.max(spec.duration.min, Number(input.duration) || spec.duration.default)) : undefined
      const est = audioTicketCost(spec, { chars: text.length + lyrics.length, spokenChars: spokenCharCount(text), seconds: seconds ?? (inputRow ? secondsOf(inputRow) || undefined : undefined) })
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'generate_audio', kind: 'audio', label: spec.name, status: 'running', model: spec.name, prompt: clip(text || input.style || lyrics, 300), tickets: est })
      try {
        const { POST } = await import('@/app/api/audio/generate/route')
        const res = await POST(new Request('http://internal/api/audio/generate', {
          method: 'POST', headers: { 'content-type': 'application/json', ...(ctx.authHeaders ?? {}) },
          body: JSON.stringify({ model: spec.id, text, lyrics: lyrics || undefined, style: input.style, voice: input.voice, duration: seconds, instrumental: input.instrumental === true, ...(inputRow ? { audioUrl: inputRow.imageUrl, voiceConsent: input.voice_consent === true } : {}) }),
        }))
        const data = await res.json() as Record<string, any>
        if (!res.ok || !data?.requestId) throw new Error(String(data?.error || `Audio failed (${res.status})`))
        const charged = Number(data.ticketCost) || 0
        await settleSpend(ctx, est, charged)
        const q = await prisma.generationQueue.findFirst({ where: { userId: uid, falRequestId: data.requestId }, select: { id: true } })
        update(ctx, step, { status: 'pending', queueId: q?.id, requestId: data.requestId, tickets: charged })
        return { status: 'rendering', ticketsCharged: charged }
      } catch (e: any) {
        await settleSpend(ctx, est, 0)
        const msg = String(e?.message || e).slice(0, 300)
        update(ctx, step, { status: 'error', error: msg, tickets: 0 })
        return { error: msg }
      }
    },
  })

  const generate_3d = tool({
    description: 'Make a 3D model from a description and/or images (takes several minutes, renders in the background).',
    inputSchema: jsonSchema<{ tool: string; prompt?: string; image_ids?: number[]; options?: Record<string, unknown> }>({
      type: 'object',
      properties: { tool: { type: 'string', description: 'A 3D tool id from browse_models' }, prompt: { type: 'string' }, image_ids: ids, options: { type: 'object' } },
      required: ['tool'],
    }),
    execute: async (input) => {
      const t = novaThreeDTools(ctx.isAdmin).find(x => x.id === input.tool)
      if (!t) return { error: `Unknown or unavailable 3D tool "${input.tool}" - call browse_models` }
      const imgs = (await ownedRows(uid, input.image_ids ?? [])).filter(r => kindOf(r) === 'image').map(r => r.imageUrl)
      const est = toolTickets(t, input.options ?? {}, imgs.length)
      const refused = guard(ctx, est)
      if (refused) return { error: refused }
      const step = newStep(ctx, { tool: 'generate_3d', kind: '3d', label: t.label, status: 'running', model: t.label, prompt: clip(input.prompt, 300), tickets: est, posterUrl: imgs[0] })
      const { submitThreeD } = await import('@/lib/threed/pipeline')
      const r = await submitThreeD({ userId: uid, email: ctx.user.email, isAdmin: ctx.isAdmin, toolId: t.id, input: { prompt: input.prompt, images: imgs, options: (input.options ?? {}) as Record<string, unknown> }, title: clip(input.prompt || t.label, 200) })
      if (!r.ok) {
        await settleSpend(ctx, est, 0)
        update(ctx, step, { status: 'error', error: r.error, tickets: 0 })
        return { error: r.error }
      }
      const charged = ctx.isAdmin ? 0 : r.job.tickets
      await settleSpend(ctx, est, charged)
      update(ctx, step, { status: 'pending', queueId: r.job.id, tickets: charged })
      return { status: 'rendering', ticketsCharged: charged, minutes: t.minutes }
    },
  })

  // assemble_cut lives in lib/nova/agent-tools-pro (the timeline editor)

  // ── turn-ending tools ──

  const propose_plan = tool({
    description: 'Propose a plan with ticket costs for the user to approve BEFORE spending more than they allow without asking. After calling this, stop and wait - the user approves or changes the budget.',
    inputSchema: jsonSchema<{ summary: string; steps: { title: string; tickets: number }[] }>({
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two sentences: what you will make' },
        steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, tickets: { type: 'integer' } }, required: ['title', 'tickets'] }, description: 'Each generation or edit with its ticket cost (from browse_models)' },
      },
      required: ['summary', 'steps'],
    }),
    execute: async (input) => {
      const steps = (input.steps ?? []).slice(0, 30).map(s => ({ title: clip(s.title, 160), tickets: Math.max(0, Math.round(Number(s.tickets) || 0)) }))
      const total = steps.reduce((a, s) => a + s.tickets, 0)
      const summary = clip(input.summary, 600)
      // A plan that fits inside what the request may still spend without asking
      // (and the user's own limits) needs no approval - the user already gave
      // it by setting the budget (2026-10-19, owner: a 9-ticket plan under a
      // 250 budget waited for a click). It is not a plan budget: the spend
      // still counts against the allowance, so plan after plan cannot stretch it.
      if (!ctx.state.plan) {
        const live = ctx.mediaTickets + ctx.reserved
        const { room } = roomLeft(ctx.budget, { today: ctx.spend.today + live, month: ctx.spend.month + live }, ctx.state.spent + live)
        const left = Math.min(
          ctx.allowance.turn - ctx.unplanned - ctx.reserved,
          ctx.allowance.request - (ctx.chainBefore ?? 0) - ctx.unplanned - ctx.reserved,
          room,
        )
        if (total <= left) {
          ctx.autoPlan = { summary, steps, totalTickets: total, status: 'approved', approvedTickets: total, auto: true }
          return { status: `approved automatically - it fits inside the ${ctx.allowance.request} tickets the user lets this request spend without asking. Go ahead now and do the work in this turn; do not wait.`, totalTickets: total }
        }
      }
      ctx.proposedPlan = { summary, steps, totalTickets: total, status: 'proposed' }
      return { status: 'shown to the user - stop now and wait for their approval', totalTickets: total }
    },
  })

  const wait_for_renders = tool({
    description: 'Call when you have started clips/audio/3D that later steps need (e.g. the final cut). The turn ends; you are woken automatically when they finish, with their ids.',
    inputSchema: jsonSchema<{ next: string }>({ type: 'object', properties: { next: { type: 'string', description: 'What you will do when they are ready' } }, required: ['next'] }),
    execute: async (input) => {
      ctx.waitForRenders = true
      return { status: 'waiting', next: clip(input.next, 300) }
    },
  })

  return {
    search_library, view_media, list_folders, create_folder, file_items,
    list_assets, asset_pictures, save_asset, browse_models,
    generate_image, generate_video, generate_audio, generate_3d,
    propose_plan, wait_for_renders,
  }
}
