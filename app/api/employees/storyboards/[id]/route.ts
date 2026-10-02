import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { STORYBOARD_ASPECTS, sanitizeShots, mergeStills, sanitizeAssets, isBoardMode } from '@/lib/storyboard'

/**
 * One storyboard.
 *
 *   GET     the whole board
 *   PATCH   { title?, story?, look?, aspect?, shots?, assets?, mode? } - the workspace autosaves
 *           here; shots replace the stored array wholesale (it is one document)
 *   DELETE  remove it (the stills stay in the account's library)
 *
 * Still URLs arrive signed (that is how the page received them) and are stored
 * canonical, so a saved board never holds a link that expires.
 */
type Ctx = { params: Promise<{ id: string }> }

async function own(ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return { error: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const id = parseInt((await ctx.params).id)
  if (!Number.isFinite(id)) return { error: jsonPrivate({ error: 'Invalid id' }, { status: 400 }) }
  const row = await prisma.storyboard.findFirst({ where: { id, userId: user.id } })
  if (!row) return { error: jsonPrivate({ error: 'Not found' }, { status: 404 }) }
  return { user, row }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  // Cleaned on the way out too: every shot is guaranteed its own id
  return jsonPrivate({ storyboard: { ...r.row, shots: sanitizeShots(r.row.shots), assets: sanitizeAssets(r.row.assets) } })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120) || 'Untitled storyboard'
  if (typeof body.story === 'string') data.story = body.story.slice(0, 8000)
  if (typeof body.look === 'string') data.look = body.look.slice(0, 2000)
  if ((STORYBOARD_ASPECTS as readonly string[]).includes(String(body.aspect))) data.aspect = String(body.aspect)
  // Assets are the page's to edit wholesale (refs arrive signed and are stored canonical)
  if ('assets' in body) data.assets = sanitizeAssets(body.assets) as object[]
  if (isBoardMode(body.mode)) data.mode = body.mode
  if ('shots' in body) {
    // A shot's video is written only by the shoot route: the page autosaves on
    // a debounce, and a stale copy must never overwrite a render that just
    // finished (or resurrect one that was cleared)
    // Still takes are only ever added the same way: the stored list plus the
    // page's, so a stale autosave cannot drop a take made meanwhile
    const stored = new Map(sanitizeShots(r.row.shots).map(s => [s.id, s]))
    data.shots = sanitizeShots(body.shots).map(s => {
      const old = stored.get(s.id)
      // Video takes are the server's too (kept by the shoot route): never the page's copy
      return { ...s, video: old?.video ?? null, videos: old?.videos, stills: mergeStills(old?.stills, s.stills) }
    }) as object[]
  }
  const row = await prisma.storyboard.update({ where: { id: r.row.id }, data })
  return jsonPrivate({ ok: true, updatedAt: row.updatedAt })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const r = await own(ctx)
  if ('error' in r) return r.error
  await prisma.storyboard.delete({ where: { id: r.row.id } })
  return jsonPrivate({ ok: true })
}
