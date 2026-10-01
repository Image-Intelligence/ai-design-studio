import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { submitShots, settleShots } from '@/lib/storyboard-shoot'

/**
 * Shoot a storyboard's shots (the per-shot Shoot buttons and Shoot all).
 *
 *   POST { shotIds, resolution? }  animate each shot's still with its planned
 *        video prompt and model. Returns { videos: { [shotId]: ShotVideo | { error } } }
 *   GET  settle the board's renders - the page polls this while any shot is
 *        rendering. Returns { videos: { [shotId]: ShotVideo } }
 *
 * The work lives in lib/storyboard-shoot, shared with the Final Cut.
 *
 * ADMIN ONLY.
 */
export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

async function load(ctx: Ctx) {
  const user = await requireChatHubAdmin()
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
  const ids = Array.isArray(body.shotIds) ? (body.shotIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40) : []
  return jsonPrivate({ videos: await submitShots(r.user, r.board, ids, String(body.resolution ?? '')) })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx)
  if ('error' in r) return r.error
  return jsonPrivate({ videos: await settleShots(r.user, r.board) })
}
