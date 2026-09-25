import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { resolveRequestUser, requireScopes } from '@/lib/api-key-auth'
import { jsonPrivate } from '@/lib/api-json'

/**
 * The home page's My Generations card (a masonry wall) and its slideshow.
 *
 * GET /api/user/highlights?n=20&source=mix — a random sample of the caller's
 * own work. The card used to replay the newest twelve generations, so it
 * showed the same handful every visit. This draws from the whole history:
 *
 *   source=mix (default)  half from generations rated 4-5 stars (the rating
 *                         in the feed's info panel, stored in ImageRating),
 *                         half uniformly from everything, interleaved
 *   source=fav            4-5 stars only
 *   source=all            uniformly from everything
 *
 * Every call is a fresh sample, so the wall keeps pulling new work instead of
 * looping a set. ORDER BY random() is fine here: it is scoped to one user
 * through the userId index, and measured at ~26ms for the largest account
 * (28k rows).
 *
 * POST { hide: id } | { unhide: id } | { reset: true } — the per-user "don't
 * show here" list. It only affects this card and the slideshow; the image
 * stays in the feed and the library. Kept in User.portalPreferences
 * (homeHiddenIds) so it needs no schema change.
 */

const HIDDEN_KEY = 'homeHiddenIds'
const HIDDEN_CAP = 5000

async function readPrefs(userId: number) {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { portalPreferences: true } })
  const prefs = (row?.portalPreferences as Record<string, unknown> | null) ?? {}
  const raw = prefs[HIDDEN_KEY]
  const hidden = Array.isArray(raw) ? raw.filter((v): v is number => Number.isInteger(v)) : []
  return { prefs, hidden }
}

export async function GET(request: Request) {
  try {
    const resolved = await resolveRequestUser(request)
    if ('error' in resolved) return resolved.error
    const { user, apiAuth } = resolved
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'feed:read')
      if (denied) return denied
    }

    const { searchParams } = new URL(request.url)
    const n = Math.min(Math.max(parseInt(searchParams.get('n') || '20') || 20, 4), 60)
    const source = searchParams.get('source')
    const favN = source === 'fav' ? n : source === 'all' ? 0 : Math.ceil(n / 2)
    const { hidden } = await readPrefs(user.id)

    // Same exclusions as the feed: dataset uploads are training data, and
    // '3d:' rows are meshes an <img> cannot draw.
    const favs = favN === 0 ? [] : await prisma.$queryRaw<{ id: number }[]>`
      SELECT g.id FROM "ImageRating" r
      JOIN "GeneratedImage" g ON g.id = r."generatedImageId"
      WHERE r."userId" = ${user.id} AND g."userId" = ${user.id} AND r.score >= 4
        AND g."isDeleted" = false AND g."isHidden" = false
        AND g.model <> '__upload__' AND g.model NOT LIKE '3d:%'
        AND g.id <> ALL(${hidden}::int[])
      ORDER BY random() LIMIT ${favN}`
    const favIds = new Set(favs.map(r => r.id))

    // Over-fetch by the favourites' count, since a random pick can land on one.
    const randN = n - favIds.size
    const rand = randN <= 0 || source === 'fav' ? [] : await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "GeneratedImage"
      WHERE "userId" = ${user.id} AND "isDeleted" = false AND "isHidden" = false
        AND model <> '__upload__' AND model NOT LIKE '3d:%'
        AND id <> ALL(${hidden}::int[])
      ORDER BY random() LIMIT ${n}`
    const randIds = rand.map(r => r.id).filter(id => !favIds.has(id)).slice(0, randN)

    // Interleave: favourite, random, favourite, random...
    const order: number[] = []
    const favList = [...favIds]
    for (let i = 0; i < Math.max(favList.length, randIds.length); i++) {
      if (i < favList.length) order.push(favList[i])
      if (i < randIds.length) order.push(randIds[i])
    }
    const headers = { 'Cache-Control': 'no-store' }
    if (order.length === 0) return jsonPrivate({ success: true, items: [], hiddenCount: hidden.length }, { headers })

    const rows = await prisma.generatedImage.findMany({
      where: { id: { in: order }, userId: user.id },
      select: {
        id: true, imageUrl: true, thumbnailUrl: true, videoMetadata: true,
        imageRating: { select: { score: true } },
      },
    })
    const byId = new Map(rows.map(r => [r.id, r]))
    const items = order.map(id => byId.get(id)).filter(r => !!r).map(r => {
      const vm = (r!.videoMetadata ?? {}) as Record<string, unknown>
      return {
        id: r!.id,
        imageUrl: r!.imageUrl,
        thumbnailUrl: r!.thumbnailUrl ?? null,
        // A video is shown on the wall by its poster frame.
        videoThumbnailUrl: typeof vm.thumbnailUrl === 'string' ? vm.thumbnailUrl : null,
        isVideo: vm.isVideo === true || /\.(mp4|webm|mov)(\?|$)/i.test(r!.imageUrl),
        score: r!.imageRating?.score ?? null,
      }
    })
    return jsonPrivate({ success: true, items, hiddenCount: hidden.length }, { headers })
  } catch (e) {
    console.error('highlights failed:', e)
    return jsonPrivate({ success: false, items: [], hiddenCount: 0 }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveRequestUser(request)
    if ('error' in resolved) return resolved.error
    const { user } = resolved
    const body = await request.json().catch(() => ({}))
    const { prefs, hidden } = await readPrefs(user.id)

    let next = hidden
    if (body?.reset === true) next = []
    else if (Number.isInteger(body?.hide)) {
      // Only the caller's own images can be listed.
      const own = await prisma.generatedImage.count({ where: { id: body.hide, userId: user.id } })
      if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // Newest last; the oldest fall off past the cap.
      next = [...hidden.filter(id => id !== body.hide), body.hide].slice(-HIDDEN_CAP)
    } else if (Number.isInteger(body?.unhide)) next = hidden.filter(id => id !== body.unhide)
    else return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })

    await prisma.user.update({
      where: { id: user.id },
      data: { portalPreferences: { ...prefs, [HIDDEN_KEY]: next } },
    })
    return NextResponse.json({ ok: true, hiddenCount: next.length })
  } catch (e) {
    console.error('highlights hide failed:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
