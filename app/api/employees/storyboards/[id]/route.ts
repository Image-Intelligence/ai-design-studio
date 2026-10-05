import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { STORYBOARD_ASPECTS, sanitizeShots, mergeStills, sanitizeAssets, sanitizeScenes, ensureScenes, isBoardMode, stillKey, migrateActiveRefs } from '@/lib/storyboard'
import { withShotsLock } from '@/lib/storyboard-store'

/**
 * One storyboard.
 *
 *   GET     the whole board
 *   PATCH   { title?, story?, look?, aspect?, shots?, assets?, mode?, scenes? } - the workspace
 *           autosaves here; shots and scenes replace the stored lists wholesale (it is
 *           one document), and shots are kept in scene order
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
  // Cleaned on the way out too: every shot is guaranteed its own id and a
  // scene to live in. A board from before scenes gets its Scene 1 here, and
  // keeps it (written back once), so every device sees the same scene. Only
  // the scene is written: a shot with no scene joins the first one on every
  // read, and rewriting the shots here could race a clip the shoot route is
  // saving at that moment
  const stored = sanitizeScenes(r.row.scenes)
  const doc = ensureScenes({ shots: sanitizeShots(r.row.shots), scenes: stored })
  if (!stored.length && doc.scenes.length) {
    await prisma.storyboard.update({ where: { id: r.row.id }, data: { scenes: doc.scenes as object[] } })
  }
  let assets = sanitizeAssets(r.row.assets)
  let shots = doc.shots
  // A board from the days of switched-on refs: its shots keep what they used, as their own lists
  const moved = migrateActiveRefs({ assets, scenes: doc.scenes, shots })
  if (moved) {
    await withShotsLock(r.row.id, current => {
      const m = migrateActiveRefs({ assets, scenes: doc.scenes, shots: ensureScenes({ shots: current, scenes: doc.scenes }).shots })
      return m ? { shots: m.shots, data: { assets: m.assets as object[] } } : null
    })
    assets = moved.assets
    shots = moved.shots
  }
  return jsonPrivate({ storyboard: { ...r.row, shots, assets, scenes: doc.scenes } })
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
  // The scenes the shots are ordered by: the page's when it sends them
  let scenes = 'scenes' in body ? sanitizeScenes(body.scenes) : sanitizeScenes(r.row.scenes)
  if ('scenes' in body) data.scenes = scenes as object[]
  if ('shots' in body) {
    /*
     * Merged into what is stored UNDER THE ROW LOCK: the still and shoot
     * routes write shots too, and a read-then-write here could put back an
     * array from a moment ago over a still or clip that just landed.
     *
     * The server owns: `video` / `videos` (the shoot route), `stillJob` (the
     * still route), and every still take (the stored list plus the page's -
     * a stale autosave never drops a take). And a still the server put on a
     * slot that THIS page has not seen yet (it is not among the page's
     * takes) stays the slot's still: the page cannot have meant to replace a
     * picture it never knew about.
     */
    const incoming = Array.isArray(body.shots) ? (body.shots as any[]) : []
    const seen = new Map(incoming.map(s => [String(s?.id ?? ''), new Set((Array.isArray(s?.stills) ? s.stills : []).map((v: any) => stillKey(String(v?.url ?? ''))))]))
    let saved = false
    await withShotsLock(r.row.id, current => {
      const stored = new Map(current.map(s => [s.id, s]))
      const doc = ensureScenes({ scenes, shots: sanitizeShots(body.shots).map(s => {
        const old = stored.get(s.id)
        if (!old) return s
        const knew = seen.get(s.id)
        const unseen = !!old.stillUrl && old.stillUrl !== s.stillUrl && !knew?.has(stillKey(old.stillUrl))
        return {
          ...s, video: old.video ?? null, videos: old.videos, stillJob: old.stillJob ?? null,
          stills: mergeStills(old.stills, s.stills),
          ...(unseen ? { stillUrl: old.stillUrl } : {}),
        }
      }) })
      // Shots never sit outside a scene: none sent and none stored = a Scene 1 for them
      if (doc.scenes !== scenes) { scenes = doc.scenes; data.scenes = scenes as object[] }
      saved = true
      return { shots: doc.shots, data }
    })
    if (!saved) return jsonPrivate({ error: 'Not found' }, { status: 404 })
    return jsonPrivate({ ok: true })
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
