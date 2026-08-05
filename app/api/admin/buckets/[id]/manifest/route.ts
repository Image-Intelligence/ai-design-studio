import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


// GET /api/admin/buckets/[id]/manifest?cursor=<int>&limit=<int>
// Paginated JSON manifest of a dataset bucket for the external training-data
// sync tool. Replaces the zip export for large buckets: keyset pagination on
// imageId keeps every page O(limit) instead of building the whole zip in memory.
// The client loops cursor=0 -> nextCursor while hasMore.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const bucketId = parseInt(id)
  if (isNaN(bucketId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const searchParams = new URL(req.url).searchParams
  const cursor = Math.max(0, parseInt(searchParams.get('cursor') ?? '0') || 0)
  // ?all=1 → whole bucket in ONE query (up to 5000 rows). Used by the
  // composer's "Add all" so it doesn't depend on page-by-page browsing —
  // a single Postgres query is far more reliable than N round trips.
  const all = searchParams.get('all') === '1'
  const limit = all ? 5000 : Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200') || 200))

  const bucket = await prisma.datasetBucket.findUnique({
    where: { id: bucketId },
    select: { id: true, name: true },
  })
  if (!bucket) return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })

  const rows = await prisma.datasetBucketImage.findMany({
    where: { bucketId, imageId: { gt: cursor } },
    orderBy: { imageId: 'asc' },
    take: limit,
    include: {
      image: {
        select: { id: true, imageUrl: true, thumbnailUrl: true, adminCaption: true, adminTags: true, prompt: true, model: true, referenceImageUrls: true, aspectRatio: true },
      },
    },
  })

  // Cursor advances over the RAW page, BEFORE the video filter — otherwise a
  // page consisting entirely of videos would return the same cursor forever
  // and stall the client's pagination loop.
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].imageId : null
  const hasMore = rows.length === limit

  const images = rows
    .map(r => r.image)
    .filter(img => img.imageUrl && !/\.(mp4|webm|mov|avi|mkv)$/i.test(img.imageUrl))
    .map(img => ({
      id: img.id,
      url: img.imageUrl,
      // Pre-generated R2 thumb when one exists — tiles load it DIRECTLY from
      // R2 instead of paying the server's fetch-original+resize per image
      thumbnailUrl: img.thumbnailUrl,
      prompt: img.prompt,
      // adminCaption EXACTLY as stored — null when unset, no prompt fallback
      adminCaption: img.adminCaption,
      tags: img.adminTags,
      model: img.model,
      referenceImageUrls: img.referenceImageUrls,
      aspectRatio: img.aspectRatio,
    }))

  return NextResponse.json(
    { bucket: { id: bucket.id, name: bucket.name }, images, nextCursor, hasMore },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
