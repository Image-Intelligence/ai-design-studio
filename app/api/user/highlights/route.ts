import prisma from '@/lib/prisma'
import { resolveRequestUser, requireScopes } from '@/lib/api-key-auth'
import { jsonPrivate } from '@/lib/api-json'

/**
 * GET /api/user/highlights?n=20 — a random sample of the caller's own work
 * for the home page's My Generations card.
 *
 * The card used to replay the newest twelve generations, so it showed the
 * same handful of images every visit and never anything older than a day or
 * two. This draws from the whole history instead, weighted toward what the
 * user liked:
 *
 *   - up to half the sample is generations they rated 4 or 5 stars (the
 *     1-5 star rating in the feed's info panel, stored in ImageRating)
 *   - the rest is picked uniformly at random from everything they have made
 *
 * The two are interleaved, so every pass of the carousel mixes a favourite
 * with something rediscovered. Every call is a fresh sample; the card asks
 * again each time it runs out, so it never loops the same set.
 *
 * ORDER BY random() is fine here: it is scoped to one user through the userId
 * index, and measured at ~26ms for the largest account (28k rows).
 */
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
    const n = Math.min(Math.max(parseInt(searchParams.get('n') || '20') || 20, 4), 40)
    const favN = Math.ceil(n / 2)

    // Same exclusions as the feed: dataset uploads are training data, and
    // '3d:' rows are meshes an <img> cannot draw.
    const favs = await prisma.$queryRaw<{ id: number }[]>`
      SELECT g.id FROM "ImageRating" r
      JOIN "GeneratedImage" g ON g.id = r."generatedImageId"
      WHERE r."userId" = ${user.id} AND g."userId" = ${user.id} AND r.score >= 4
        AND g."isDeleted" = false AND g."isHidden" = false
        AND g.model <> '__upload__' AND g.model NOT LIKE '3d:%'
      ORDER BY random() LIMIT ${favN}`
    const favIds = new Set(favs.map(r => r.id))

    // Over-fetch by the favourites' count, since a random pick can land on one.
    const rand = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "GeneratedImage"
      WHERE "userId" = ${user.id} AND "isDeleted" = false AND "isHidden" = false
        AND model <> '__upload__' AND model NOT LIKE '3d:%'
      ORDER BY random() LIMIT ${n}`
    const randIds = rand.map(r => r.id).filter(id => !favIds.has(id)).slice(0, n - favIds.size)

    // Interleave: favourite, random, favourite, random...
    const order: number[] = []
    const favList = [...favIds]
    for (let i = 0; i < Math.max(favList.length, randIds.length); i++) {
      if (i < favList.length) order.push(favList[i])
      if (i < randIds.length) order.push(randIds[i])
    }
    if (order.length === 0) return jsonPrivate({ success: true, items: [] }, { headers: { 'Cache-Control': 'no-store' } })

    const rows = await prisma.generatedImage.findMany({
      where: { id: { in: order }, userId: user.id },
      select: {
        id: true, imageUrl: true, thumbnailUrl: true, videoMetadata: true, aspectRatio: true,
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
        // Only what the card draws: a video is shown by its poster frame.
        videoThumbnailUrl: typeof vm.thumbnailUrl === 'string' ? vm.thumbnailUrl : null,
        isVideo: vm.isVideo === true,
        score: r!.imageRating?.score ?? null,
      }
    })
    return jsonPrivate({ success: true, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('highlights failed:', e)
    return jsonPrivate({ success: false, items: [] }, { status: 500 })
  }
}
