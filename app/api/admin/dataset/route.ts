import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

// GET — paginated dataset browser + optional ?export=true for full JSON download
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const isExport    = searchParams.get('export') === 'true'
  const page        = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const isAll       = searchParams.get('all') === 'true'
  const limit       = isAll ? 10000 : Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30')))
  const skip        = (page - 1) * limit

  // Filters — model, aspectRatio, userId support multi-value (repeated params)
  const modelList       = searchParams.getAll('model').filter(Boolean)
  const aspectRatioList = searchParams.getAll('aspectRatio').filter(Boolean)
  const userIdList      = searchParams.getAll('userId').filter(Boolean).map(Number).filter(n => !isNaN(n))
  const qualityList     = searchParams.getAll('quality').filter(Boolean)
  const hasRefs     = searchParams.get('hasRefs')     || ''   // 'true' | 'false' | '1' | '2' | '3' | '4+'
  const hasRating   = searchParams.get('hasRating')   || ''   // 'true' | 'false'
  const hasCaption  = searchParams.get('hasCaption')  || ''   // 'true' | 'false'
  const hasTag      = searchParams.get('hasTag')      || ''   // 'true' | 'false'
  const tagFilter   = searchParams.get('tagFilter')   || ''   // specific tag value
  const mediaType   = searchParams.get('mediaType')   || ''   // 'image' | 'video' | ''
  const markedOnly  = searchParams.get('markedOnly') === 'true'
  const bucketId    = searchParams.get('bucketId')    || ''
  // Exclusion: hide generations already sorted into any of these buckets
  // (client expands excluded folders into their full bucket subtree)
  const excludeBuckets = searchParams.getAll('excludeBucket').map(Number).filter(n => !isNaN(n) && n > 0)
  const search      = searchParams.get('search')      || ''
  const sort        = searchParams.get('sort')        || 'newest'

  const where: Prisma.GeneratedImageWhereInput = { isDeleted: false }

  if (modelList.length === 1)       where.model       = modelList[0]
  else if (modelList.length > 1)    where.model       = { in: modelList }
  if (aspectRatioList.length === 1) where.aspectRatio = aspectRatioList[0]
  else if (aspectRatioList.length > 1) where.aspectRatio = { in: aspectRatioList }
  if (userIdList.length === 1)      where.userId      = userIdList[0]
  else if (userIdList.length > 1)   where.userId      = { in: userIdList }
  if (qualityList.length === 1)    where.quality = qualityList[0]
  else if (qualityList.length > 1) where.quality = { in: qualityList }
  if (markedOnly)  where.markedForTraining = true
  if (bucketId || excludeBuckets.length > 0) {
    where.bucketImages = {
      ...(bucketId ? { some: { bucketId: parseInt(bucketId) } } : {}),
      ...(excludeBuckets.length > 0 ? { none: { bucketId: { in: excludeBuckets } } } : {}),
    }
  }
  if (mediaType === 'video') where.NOT = { videoMetadata: { equals: Prisma.JsonNull } }
  if (mediaType === 'image') where.videoMetadata = { equals: Prisma.AnyNull }

  if (hasRefs === 'true')        where.referenceImageUrls = { isEmpty: false }
  else if (hasRefs === 'false') where.referenceImageUrls = { isEmpty: true }
  else if (['1', '2', '3', '4+'].includes(hasRefs)) {
    const rows = await prisma.$queryRaw<{ id: number }[]>(
      hasRefs === '4+'
        ? Prisma.sql`SELECT id FROM "GeneratedImage" WHERE cardinality("referenceImageUrls") >= 4 AND "isDeleted" = false`
        : Prisma.sql`SELECT id FROM "GeneratedImage" WHERE cardinality("referenceImageUrls") = ${parseInt(hasRefs)} AND "isDeleted" = false`
    )
    where.id = { in: rows.map(r => r.id) }
  }

  if (hasRating === 'true')  where.imageRating = { isNot: null }
  if (hasRating === 'false') where.imageRating = { is: null }

  if (hasCaption === 'true')  where.adminCaption = { not: null }
  if (hasCaption === 'false') where.adminCaption = null

  if (hasTag === 'true')  where.adminTags = { isEmpty: false }
  if (hasTag === 'false') where.adminTags = { isEmpty: true }

  if (tagFilter) where.adminTags = { has: tagFilter }

  if (search) where.prompt = { contains: search, mode: 'insensitive' }

  const orderBy: Prisma.GeneratedImageOrderByWithRelationInput =
    sort === 'oldest' ? { createdAt: 'asc'  }
    : sort === 'rating' ? { imageRating: { score: 'desc' } }
    : sort === 'cost'   ? { ticketCost: 'desc' }
    : { createdAt: 'desc' }

  // ── Export ──────────────────────────────────────────────────────────────────
  if (isExport) {
    const records = await prisma.generatedImage.findMany({
      where,
      include: {
        imageRating: { select: { score: true, wasAccurate: true, feedbackText: true, tags: true } },
        user:        { select: { id: true, email: true } },
      },
      orderBy,
    })

    const payload = records.map(r => ({
      id:                 r.id,
      prompt:             r.prompt,
      imageUrl:           r.imageUrl,
      referenceImageUrls: r.referenceImageUrls,
      model:              r.model,
      quality:            r.quality,
      aspectRatio:        r.aspectRatio,
      ticketCost:         r.ticketCost,
      markedForTraining:  r.markedForTraining,
      adminTags:          r.adminTags,
      adminCaption:       r.adminCaption,
      rating:             r.imageRating?.score         ?? null,
      ratingAccurate:     r.imageRating?.wasAccurate   ?? null,
      ratingTags:         r.imageRating?.tags          ?? [],
      userId:             r.userId,
      createdAt:          r.createdAt,
    }))

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="dataset-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── Bucket stats-only (separate non-blocking request from client) ──────────
  if (searchParams.get('statsOnly') === 'true' && bucketId) {
    const bid = parseInt(bucketId)
    const bw = { isDeleted: false, bucketImages: { some: { bucketId: bid } } }
    const [marked, tagged, captioned, total] = await Promise.all([
      prisma.generatedImage.count({ where: { ...bw, markedForTraining: true } }),
      prisma.generatedImage.count({ where: { ...bw, adminTags: { isEmpty: false } } }),
      prisma.generatedImage.count({ where: { ...bw, adminCaption: { not: null } } }),
      prisma.generatedImage.count({ where: bw }),
    ])
    return NextResponse.json({ bucketStats: { marked, tagged, captioned, total } }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // ── IDs-only (for select-all across all pages) ─────────────────────────────
  if (searchParams.get('idsOnly') === 'true') {
    const rows = await prisma.generatedImage.findMany({
      where,
      select: { id: true },
      orderBy,
    })
    return NextResponse.json({ ids: rows.map(r => r.id) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // ── Paginated list ──────────────────────────────────────────────────────────
  const [total, images] = await prisma.$transaction([
    prisma.generatedImage.count({ where }),
    prisma.generatedImage.findMany({
      where,
      select: {
        id: true, prompt: true, imageUrl: true, referenceImageUrls: true,
        model: true, quality: true, aspectRatio: true, ticketCost: true,
        markedForTraining: true, adminTags: true, adminCaption: true,
        createdAt: true, expiresAt: true, falRequestId: true, videoMetadata: true,
        isDeleted: true,
        user:        { select: { id: true, email: true, name: true } },
        imageRating: { select: { score: true, wasAccurate: true, tags: true, feedbackText: true, createdAt: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ])

  // Facet dropdowns + overall stats — bucket stats are fetched separately by the client
  const [models, aspects, qualities, overallMarked, overallTagged, overallCaptioned] = await Promise.all([
    prisma.generatedImage.groupBy({ by: ['model'],       where: { isDeleted: false }, _count: true }),
    prisma.generatedImage.groupBy({ by: ['aspectRatio'], where: { isDeleted: false }, _count: true }),
    prisma.generatedImage.groupBy({ by: ['quality'],     where: { isDeleted: false }, _count: true }),
    prisma.generatedImage.count({ where: { isDeleted: false, markedForTraining: true } }),
    prisma.generatedImage.count({ where: { isDeleted: false, adminTags: { isEmpty: false } } }),
    prisma.generatedImage.count({ where: { isDeleted: false, adminCaption: { not: null } } }),
  ])

  // Top tags via raw SQL (unnest the array)
  const topTags = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT unnest("adminTags") AS tag, COUNT(*) AS count
    FROM "GeneratedImage"
    WHERE "isDeleted" = false
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 30
  `

  // Users who have generations, ordered by count desc
  const userFacets = await prisma.generatedImage.groupBy({
    by: ['userId'],
    where: { isDeleted: false },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 100,
  })
  const userIds = userFacets.map(u => u.userId)
  const userDetails = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  })
  const userMap = Object.fromEntries(userDetails.map(u => [u.id, u]))
  const users = userFacets
    .map(u => ({ id: u.userId, email: userMap[u.userId]?.email ?? `#${u.userId}`, name: userMap[u.userId]?.name ?? null, count: u._count.id }))
    .filter(u => u.email)

  return NextResponse.json({
    images,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    facets: {
      models:    models.map(m => ({ value: m.model,       count: m._count })),
      aspects:   aspects.map(a => ({ value: a.aspectRatio, count: a._count })).filter(a => a.value),
      qualities: qualities.map(q => ({ value: q.quality, count: q._count })).filter(q => q.value),
      tags:      topTags.map(t => ({ value: t.tag, count: Number(t.count) })),
      users,
    },
    overallStats: { marked: overallMarked, tagged: overallTagged, captioned: overallCaptioned },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// PATCH — update one or many images
// Body options (all fields optional except ids):
//   { ids, marked }              → set markedForTraining
//   { ids, tags }                → REPLACE adminTags (single-item edit)
//   { ids, addTags }             → MERGE into existing adminTags (batch)
//   { ids, removeTags }          → remove specific tags from existing adminTags (batch)
//   { ids, caption }             → set/clear adminCaption (null to clear)
//   Any combination of the above is applied together.
export async function PATCH(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      ids:        number[]
      marked?:    boolean
      tags?:      string[]
      addTags?:   string[]
      removeTags?: string[]
      caption?:   string | null
    }

    const { ids, marked, tags, addTags, removeTags, caption } = body
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
    }

    // Fields that can be applied via updateMany (no per-row read needed)
    const simpleData: Prisma.GeneratedImageUpdateInput = {}
    if (marked    !== undefined) simpleData.markedForTraining = marked
    if (caption   !== undefined) simpleData.adminCaption      = caption
    if (tags      !== undefined) simpleData.adminTags         = tags

    let updated = 0

    if (addTags?.length || removeTags?.length) {
      // Need per-row tag merge — fetch existing tags first
      const rows = await prisma.generatedImage.findMany({
        where:  { id: { in: ids } },
        select: { id: true, adminTags: true },
      })

      await prisma.$transaction(
        rows.map(row => {
          let merged = [...row.adminTags]
          if (addTags?.length)    merged = [...new Set([...merged, ...addTags])]
          if (removeTags?.length) merged = merged.filter(t => !removeTags.includes(t))

          return prisma.generatedImage.update({
            where: { id: row.id },
            data:  { ...simpleData, adminTags: merged },
          })
        })
      )
      updated = rows.length
    } else if (Object.keys(simpleData).length > 0) {
      const result = await prisma.generatedImage.updateMany({
        where: { id: { in: ids } },
        data:  simpleData as Prisma.GeneratedImageUncheckedUpdateManyInput,
      })
      updated = result.count
    }

    return NextResponse.json({ updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
