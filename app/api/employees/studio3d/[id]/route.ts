import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { EMPLOYEE_ADMIN_ONLY } from '@/lib/employees'
import { uploadPublicAsset } from '@/lib/r2'
import { assetOut } from '@/lib/threed/assets'
import { harvestFiles, rehost, prepareViewer, type ThreeDMeta } from '@/lib/threed/pipeline'

/**
 * One 3D asset.
 *
 *   PATCH  { poster: dataUrl }   the studio's own render of a model with no
 *          picture (most old ones), drawn once in the viewer and kept
 *   PATCH  { title }             rename
 *   POST   { op: 'prepare' }     an old-suite asset (fal links, no viewer
 *          copy): copied to our storage and given a viewer copy, once; a new
 *          one missing its viewer copy gets it
 *   DELETE                       out of the library (soft: the row stays)
 */
export const runtime = 'nodejs'
export const maxDuration = 300
type Ctx = { params: Promise<{ id: string }> }

async function own(ctx: Ctx) {
  const user = await requireStudioUser()
  if (!user) return null
  if (EMPLOYEE_ADMIN_ONLY['3d-studio'] && !(await checkIsAdmin(user.email))) return null
  const id = parseInt((await ctx.params).id)
  const row = Number.isFinite(id) ? await prisma.generatedImage.findFirst({
    where: { id, userId: user.id, isDeleted: false, model: { startsWith: '3d:' } },
    select: { id: true, prompt: true, model: true, imageUrl: true, createdAt: true, videoMetadata: true, ticketCost: true },
  }) : null
  return row ? { user, row } : null
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if (!r) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const meta = { ...((r.row.videoMetadata as any) ?? {}) }
  const t = { ...(meta.threed ?? {}) }
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.prompt = body.title.trim().slice(0, 500)
  if (typeof body.poster === 'string') {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.poster)
    if (!m) return jsonPrivate({ error: 'Send a picture' }, { status: 400 })
    const raw = Buffer.from(m[2], 'base64')
    if (raw.length > 6 * 1024 * 1024) return jsonPrivate({ error: 'Too large' }, { status: 413 })
    const webp = await sharp(raw).resize(640, 640, { fit: 'inside' }).webp({ quality: 82 }).toBuffer()
    const url = await uploadPublicAsset(`thumbnails/3d-${r.user.id}-a${r.row.id}-${Date.now()}.webp`, webp, 'image/webp')
    if (t.v === 2) t.poster = url; else t.preview = url
    meta.threed = t
    data.videoMetadata = meta
    data.imageUrl = url
  }
  if (!Object.keys(data).length) return jsonPrivate({ error: 'Nothing to change' }, { status: 400 })
  const row = await prisma.generatedImage.update({ where: { id: r.row.id }, data, select: { id: true, prompt: true, model: true, imageUrl: true, createdAt: true, videoMetadata: true, ticketCost: true } })
  return jsonPrivate({ asset: assetOut(row) })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if (!r) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (body.op !== 'prepare') return jsonPrivate({ error: 'Unknown action' }, { status: 400 })
  const meta = (r.row.videoMetadata as any) ?? {}
  const t = meta.threed ?? {}
  if (t.v === 2) {
    // A new-format asset without its viewer copy (the build failed once): build it now
    if (t.viewer) return jsonPrivate({ asset: assetOut(r.row) })
    const viewer = await prepareViewer(r.user.id, `asset-${r.row.id}`, t.files ?? [])
    if (!viewer) return jsonPrivate({ asset: assetOut(r.row) })
    const row = await prisma.generatedImage.update({
      where: { id: r.row.id }, data: { videoMetadata: { ...meta, threed: { ...t, viewer } } as object },
      select: { id: true, prompt: true, model: true, imageUrl: true, createdAt: true, videoMetadata: true, ticketCost: true },
    })
    return jsonPrivate({ asset: assetOut(row) })
  }
  // The old row's links, re-read as files, then copied over like a fresh result
  const old = harvestFiles({ files: (t.files ?? []).map((f: any) => ({ url: f.url })), preview: t.preview ?? undefined })
  const named = old.map((f, k) => ({ ...f, name: String(t.files?.[k]?.kind ?? f.name).replace(/^files\.\d+$/, `file${k}`) }))
  const { files, viewer, poster } = await rehost(r.user.id, `asset-${r.row.id}`, named)
  const next: ThreeDMeta = {
    v: 2, tool: r.row.model.replace(/^3d:/, ''), endpoint: t.endpoint ?? '', files, viewer,
    poster: poster ?? t.preview ?? null, usd: t.usd ?? null, tickets: r.row.ticketCost, parentId: null, options: {},
    archive: t.archive ?? null, layers: t.layers ?? null,
  }
  const row = await prisma.generatedImage.update({
    where: { id: r.row.id },
    data: { videoMetadata: { ...meta, threed: next } as object, ...(next.poster ? { imageUrl: next.poster } : {}) },
    select: { id: true, prompt: true, model: true, imageUrl: true, createdAt: true, videoMetadata: true, ticketCost: true },
  })
  return jsonPrivate({ asset: assetOut(row) })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if (!r) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  await prisma.generatedImage.update({ where: { id: r.row.id }, data: { isDeleted: true } })
  return jsonPrivate({ ok: true })
}
