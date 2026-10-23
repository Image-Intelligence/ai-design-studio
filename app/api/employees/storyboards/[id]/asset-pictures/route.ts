import { startStudioJob, finishStudioJob, failStudioJob } from '@/lib/studio-activity'
import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser, publicStillSafety } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { signMediaUrl } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { buildFalCall } from '@/lib/chat-hub-create'
import { fitRefsForModel } from '@/lib/fal-image-fit'
import { ensureThumbnail } from '@/lib/thumbnail'
import {
  ASSET_PICTURE_MODEL, ASSET_PICTURE_QUALITY, MAX_ASSET_REFS, assetViewPlan, assetViewPrompt, stillTickets, stillBuildOptions,
  sanitizeAssets, newAssetRef, cleanCaption, type AssetView,
} from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/asset-pictures - Cast & sets (2026-10-11):
 * make an asset's reference pictures from its description.
 *
 * Body: { assetId, outfitViews?: 1-3, another?: true }
 * Returns: { refs: [{ url, caption, tags }], tickets, balance? } - also written
 * onto the board's asset (the page applies them too, as its autosave may race).
 *
 * The views (lib/storyboard assetViewPlan): a character / creature front,
 * three-quarter and back; a place one wide view; an outfit 1-3; a prop one.
 * The first is made from the description; the rest are EDITS of it (and
 * "another angle" an edit of the asset's first picture), so the set keeps the
 * same face, outfit or place. NanoBanana 2.1 at 2K, priced like a still, paid
 * up front and refunded per view that fails. Each picture lands in the feed
 * (the board's Storyboards folder) like any still.
 */
export const runtime = 'nodejs'
export const maxDuration = 300
/**
 * The whole run's model time (2026-10-23 billing sweep): the views are paid
 * up front, then made in two rounds inside a 300s function - a run still
 * going at maxDuration was killed before any refund. Every fal call and
 * fetch now stops by this deadline, so what failed is refunded in time.
 * (The page no longer calls this route - Scene 0 replaced it - but it stays
 * safe for anything that does.)
 */
const RUN_BUDGET_MS = 240_000

type Ctx = { params: Promise<{ id: string }> }

async function boardFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Storyboards', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Storyboards', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled storyboard'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { assetId?: string; outfitViews?: number; another?: boolean; asset?: unknown }
  /*
   * The board's saved asset - or, for one just suggested by the draft and not
   * autosaved yet, the asset the page sends (only for a fresh set made from
   * words: "another angle" reads an existing picture, so it must be saved)
   */
  const saved = sanitizeAssets(board.assets).find(a => a.id === body.assetId)
  const sent = !saved && body.another !== true ? sanitizeAssets([body.asset]).find(a => a.id === body.assetId) : undefined
  const asset = saved ?? (sent ? { ...sent, refs: [] } : undefined)
  if (!asset) return jsonPrivate({ error: 'That asset is gone - reload the board' }, { status: 404 })
  if (!(asset.notes || '').trim()) return jsonPrivate({ error: 'Describe it first - its pictures are made from the description' }, { status: 400 })
  const another = body.another === true
  if (another && !asset.refs.length) return jsonPrivate({ error: 'Make its first picture first' }, { status: 400 })
  const plan = assetViewPlan(asset.kind, { outfitViews: Number(body.outfitViews) || 1, another, boardAspect: board.aspect })
  if (asset.refs.length + plan.length > MAX_ASSET_REFS) return jsonPrivate({ error: `An asset holds ${MAX_ASSET_REFS} pictures` }, { status: 400 })
  {
    const cf = await enforceContentFilter(`${asset.name}. ${asset.notes}`, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }

  // Priced per view, as stills are; paid now, refunded per view that fails
  const price = (v: AssetView, i: number) => stillTickets(ASSET_PICTURE_MODEL, ASSET_PICTURE_QUALITY, v.aspect, undefined, another || i > 0 ? 1 : 0)
  const tickets = plan.reduce((n, v, i) => n + price(v, i), 0)
  const paid = await deductGenerationTickets(user.id, user.email, tickets)
  if (!paid.ok) return jsonPrivate({ error: `These pictures need ${paid.need} tickets - you have ${paid.have}`, needTickets: true }, { status: 402 })
  const charged = paid.newBalance >= 0
  let refunded = 0
  const deadline = Date.now() + RUN_BUDGET_MS
  const left = () => AbortSignal.timeout(Math.max(1_000, deadline - Date.now()))
  const folderId = await boardFolder(user.id, board.title)
  const look = (board.look || '').trim().slice(0, 300)

  const run = async (v: AssetView, i: number, base: string | null): Promise<{ url: string; v: AssetView } | null> => {
    const prompt = assetViewPrompt(asset, v, look, !!base)
    const refs = base ? [base] : []
    // The feed's generating tile for this view (lib/studio-activity)
    const track = await startStudioJob({ userId: user.id, modelType: 'image', modelId: ASSET_PICTURE_MODEL, prompt: `${asset.name} (${v.label}) - ${prompt}`, studio: 'storyboard-asset', aspectRatio: v.aspect, quality: ASSET_PICTURE_QUALITY })
    try {
      const call = buildFalCall(ASSET_PICTURE_MODEL, prompt, await fitRefsForModel(ASSET_PICTURE_MODEL, refs), { aspect: v.aspect, quality: ASSET_PICTURE_QUALITY }, stillBuildOptions(ASSET_PICTURE_MODEL, {}))
      if ('error' in call) throw new Error(call.error)
      publicStillSafety(ASSET_PICTURE_MODEL, call.input as Record<string, unknown>, user.isAdmin)
      const out: any = await fal.subscribe(call.endpoint, { input: call.input, abortSignal: left() })
      const falUrl: string | undefined = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
      if (!falUrl) throw new Error('The model returned no image')
      const res = await fetch(falUrl, { signal: left() })
      if (!res.ok) throw new Error('Could not fetch the result')
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = res.headers.get('content-type') ?? 'image/png'
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
      const url = await uploadToR2(`storyboard-${user.id}-${board.id}-asset-${Date.now()}-${i}.${ext}`, buf, ct)
      const row = await prisma.generatedImage.create({
        data: {
          userId: user.id, prompt: `${asset.name} (${v.label}) - ${prompt}`.slice(0, 4000), imageUrl: url, model: ASSET_PICTURE_MODEL,
          ticketCost: user.isAdmin ? 0 : price(v, i), referenceImageUrls: refs, folderId,
          expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
          quality: ASSET_PICTURE_QUALITY, aspectRatio: v.aspect,
        },
      })
      await ensureThumbnail(row.id).catch(() => {})
      await finishStudioJob(track, [row.id], url)
      return { url, v }
    } catch (e) {
      console.error(`[asset-pictures] ${asset.name} ${v.id} failed:`, (e as Error)?.message)
      await failStudioJob(track, (e as Error)?.message || 'The picture could not be made')
      if (charged) { await refundGenerationTickets(user.id, user.email, price(v, i)); refunded += price(v, i) }
      return null
    }
  }

  // The first view from words (unless adding an angle to existing pictures), then the rest as edits of it
  const made: { url: string; v: AssetView }[] = []
  let base = another ? asset.refs[0].url : null
  let rest = plan.map((v, i) => ({ v, i }))
  if (!another) {
    const first = await run(plan[0], 0, null)
    if (!first) {
      for (const { v, i } of rest.slice(1)) if (charged) { await refundGenerationTickets(user.id, user.email, price(v, i)); refunded += price(v, i) }
      return jsonPrivate({ error: 'The first picture could not be made - nothing was charged' }, { status: 502 })
    }
    made.push(first)
    base = first.url
    rest = rest.slice(1)
  }
  const others = await Promise.all(rest.map(({ v, i }) => run(v, i, base)))
  made.push(...others.filter((x): x is { url: string; v: AssetView } => !!x))
  if (!made.length) return jsonPrivate({ error: 'The pictures could not be made - nothing was charged' }, { status: 502 })

  // Captions from the view and the description, so the AI draft can pick them at once
  const short = (asset.notes.split(/(?<=[.!?])\s/)[0] || '').slice(0, 160)
  const refs = made.map(m => ({ ...newAssetRef(m.url, false), caption: cleanCaption(`${asset.name} - ${m.v.label} view${short ? `: ${short}` : ''}`), tags: [m.v.id, asset.kind] }))

  // Onto the board's asset now (the page applies them too - its autosave may race this)
  const fresh = await prisma.storyboard.findFirst({ where: { id: board.id, userId: user.id }, select: { assets: true } })
  if (fresh) {
    const list = sanitizeAssets(fresh.assets).map(a => (a.id === asset.id
      ? { ...a, suggested: undefined, refs: [...a.refs, ...refs.filter(r => !a.refs.some(x => x.url === r.url))].slice(0, MAX_ASSET_REFS) }
      : a))
    await prisma.storyboard.update({ where: { id: board.id }, data: { assets: JSON.parse(JSON.stringify(list)) } }).catch(() => {})
  }
  const spent = tickets - refunded
  return jsonPrivate({
    refs: refs.map(r => ({ ...r, url: signMediaUrl(r.url) })),
    made: made.length, asked: plan.length,
    tickets: charged ? spent : 0,
    ...(charged ? { balance: paid.newBalance + refunded } : {}),
  })
}
