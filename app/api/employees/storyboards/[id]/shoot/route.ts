import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { jsonPrivate } from '@/lib/api-json'
import { submitShots, settleShots, boardTakes, pickTake } from '@/lib/storyboard-shoot'

/**
 * Shoot a storyboard's shots (the per-shot Shoot buttons and Shoot all).
 *
 *   POST { shotIds, resolution? }  animate each shot's still with its planned
 *        video prompt and model. Returns { videos: { [shotId]: ShotVideo | { error } }, takes }
 *   POST { pick: { shotId, url } }  play one of a shot's earlier takes instead.
 *        Returns { video, takes } (the autosave never moves `video`, so a stale
 *        tab cannot undo a render that just landed)
 *   GET  settle the board's renders - the page polls this while any shot is
 *        rendering. Returns { videos: { [shotId]: ShotVideo }, takes }
 *
 * `takes` is every shot's finished clips ({ [shotId]: ShotVideo[] }), oldest
 * first - kept by the server, so a reshoot never loses the clip it replaced.
 *
 * The work lives in lib/storyboard-shoot, shared with the Final Cut.
 *
 * Any signed-in account: shooting goes through /api/video/generate, which
 * charges the tickets and keeps admin-only video models admin-only.
 */
export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

async function load(ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return { error: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return { error: jsonPrivate({ error: 'Not found' }, { status: 404 }) }
  return { user, board }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx)
  if ('error' in r) return r.error
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const pick = body.pick as { shotId?: unknown; url?: unknown } | undefined
  if (pick && typeof pick.shotId === 'string' && typeof pick.url === 'string') {
    const out = await pickTake(r.board.id, pick.shotId, pick.url)
    if ('error' in out) return jsonPrivate(out, { status: 400 })
    return jsonPrivate({ video: out.video, takes: await boardTakes(r.board.id) })
  }
  const ids = Array.isArray(body.shotIds) ? (body.shotIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40) : []
  const videos = await submitShots(r.user, r.board, ids, String(body.resolution ?? ''))
  return jsonPrivate({ videos, takes: await boardTakes(r.board.id) })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx)
  if ('error' in r) return r.error
  const videos = await settleShots(r.user, r.board)
  return jsonPrivate({ videos, takes: await boardTakes(r.board.id) })
}
