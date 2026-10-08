import { NextRequest, after } from 'next/server'
import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { EMPLOYEE_ADMIN_ONLY } from '@/lib/employees'
import { enforceContentFilter } from '@/lib/content-filter'
import { canonicalisePayload } from '@/lib/media-url'
import { mediaKeeper } from '@/lib/media-ownership'
import { getTool } from '@/lib/threed/catalog'
import { settleThreeD, submitThreeD, TAG } from '@/lib/threed/pipeline'
import { assetOut } from '@/lib/threed/assets'

/**
 * The 3D Production Studio's jobs and library.
 *
 *   GET  ?before=<assetId>  running jobs, recent failures, and a page of the
 *        account's 3D assets (newest first, 48 a page). Settles this account's
 *        finished jobs after replying (the cron does it too, page or not).
 *   POST { toolId, prompt?, images?: string[], mesh?: string, options?, parentId? }
 *        -> { job } - a tool run, charged in tickets (lib/threed/catalog prices),
 *        refunded if it fails. The pictures and mesh must be the account's own.
 *
 * ADMIN ONLY while the studio is being finished (lib/employees "3d-studio");
 * written for everyone: charging, the CCBill prompt filter, ownership checks.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

async function who() {
  const user = await requireStudioUser()
  if (!user) return null
  const isAdmin = await checkIsAdmin(user.email)
  if (EMPLOYEE_ADMIN_ONLY['3d-studio'] && !isAdmin) return null
  return { ...user, isAdmin }
}

export async function GET(req: NextRequest) {
  const user = await who()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  // Settled AFTER the reply: saving a finished model (copying its files,
  // building the viewer copy) takes seconds to a minute, and the page's poll
  // must not wait for it - the next poll shows what landed
  after(() => settleThreeD({ userId: user.id, budgetMs: 200_000, limit: 20 }).then(() => {}, e => console.error('[studio3d] settle', String(e?.message || e).slice(0, 160))))
  const before = parseInt(req.nextUrl.searchParams.get('before') ?? '')
  const [jobs, failed, rows] = await Promise.all([
    prisma.generationQueue.findMany({
      where: { userId: user.id, modelType: TAG, status: { in: ['processing', 'queued', 'saving'] } },
      orderBy: { id: 'desc' }, take: 20,
      select: { id: true, prompt: true, modelId: true, createdAt: true, ticketCost: true, parameters: true },
    }),
    prisma.generationQueue.findMany({
      where: { userId: user.id, modelType: TAG, status: 'failed', completedAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { id: 'desc' }, take: 8,
      select: { id: true, prompt: true, modelId: true, errorMessage: true, completedAt: true },
    }),
    prisma.generatedImage.findMany({
      where: { userId: user.id, isDeleted: false, model: { startsWith: '3d:' }, ...(Number.isFinite(before) ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' }, take: 48,
      select: { id: true, prompt: true, model: true, imageUrl: true, createdAt: true, videoMetadata: true, ticketCost: true },
    }),
  ])
  return jsonPrivate({
    jobs: jobs.map(j => ({ id: j.id, prompt: j.prompt, toolId: j.modelId, queuedAt: j.createdAt, tickets: j.ticketCost, parentId: (j.parameters as any)?.parentId ?? null })),
    failed: failed.map(f => ({ id: f.id, prompt: f.prompt, toolId: f.modelId, error: f.errorMessage ?? 'Failed', at: f.completedAt })),
    assets: rows.map(assetOut),
    more: rows.length === 48,
  })
}

export async function POST(req: NextRequest) {
  const user = await who()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
  const tool = getTool(String(body.toolId ?? ''))
  if (!tool) return jsonPrivate({ error: 'Unknown 3D tool' }, { status: 400 })
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  const images = (Array.isArray(body.images) ? body.images : []).filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 8)
  const mesh = typeof body.mesh === 'string' && /^https:\/\//.test(body.mesh) ? body.mesh : undefined
  const options = body.options && typeof body.options === 'object' ? body.options as Record<string, unknown> : {}

  // The CCBill prompt filter on every word that reaches a model
  const words = [prompt, ...tool.controls.filter(c => c.kind === 'text').map(c => String(options[c.key] ?? ''))].filter(Boolean).join('\n')
  if (words) {
    const cf = await enforceContentFilter(words, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }
  // Only the account's own pictures and models (a model can copy what it is shown)
  if (!user.isAdmin) {
    const media = [...images, ...(mesh ? [mesh] : [])]
    const keep = await mediaKeeper(user.id, media)
    if (!media.every(u => keep(u))) return jsonPrivate({ error: 'Use your own pictures and models' }, { status: 400 })
  }
  const parentId = Number.isInteger(body.parentId) ? body.parentId : null
  const r = await submitThreeD({
    userId: user.id, email: user.email, isAdmin: user.isAdmin, toolId: tool.id, parentId,
    input: { prompt: prompt || undefined, images, mesh, options },
    title: prompt || tool.label,
  })
  if (!r.ok) return jsonPrivate({ error: r.error, ...(r.needTickets ? { needTickets: true } : {}) }, { status: r.status })
  return jsonPrivate({ job: r.job })
}
