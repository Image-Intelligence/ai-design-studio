import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'
import { jsonPrivate } from '@/lib/api-json'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i


// GET — list all buckets with image counts and direct preview URLs (no proxy).
// ?fast=1 skips the per-bucket preview queries (one findMany total) so the
// catalog renders instantly; callers hydrate previews with a follow-up full GET.
export async function GET(req: Request) {
  if (!checkAuth(req)) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const fast = new URL(req.url).searchParams.get('fast') === '1'

  const buckets = await prisma.datasetBucket.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { images: true } } },
  })

  /*
   * Every bucket's first few images in ONE statement.
   *
   * This used to be a query per bucket, fired concurrently - which is still
   * 405 round trips through Accelerate, and measured at 1.63s against 0.33s
   * for the statement below. Every mutation on the page waits for this list,
   * so that 1.3s was being paid to add images to a bucket, to rename one, and
   * to create one.
   *
   * Eight rows are ranked per bucket rather than four because videos are
   * dropped afterwards and four survivors are still wanted.
   */
  const previewMap = new Map<number, string[]>()
  if (!fast && buckets.length > 0) {
    const rows = await prisma.$queryRaw<{ bucketId: number; imageId: number; imageUrl: string }[]>`
      SELECT x."bucketId", x."imageId", i."imageUrl"
      FROM (
        SELECT bi."bucketId", bi."imageId",
               ROW_NUMBER() OVER (PARTITION BY bi."bucketId" ORDER BY bi."imageId" ASC) AS rn
        FROM "DatasetBucketImage" bi
      ) x
      JOIN "GeneratedImage" i ON i.id = x."imageId"
      WHERE x.rn <= 8
      ORDER BY x."bucketId", x."imageId"`
    for (const r of rows) {
      if (VIDEO_RE.test(r.imageUrl)) continue
      const urls = previewMap.get(r.bucketId) ?? []
      // Serve the 400px thumb endpoint, NOT the full originals - 4 full-size
      // decodes per card across a screen of cards blew iPad Safari's memory
      // and force-restarted the tab.
      if (urls.length < 4) { urls.push(`/api/admin/dataset/thumb/${r.imageId}`); previewMap.set(r.bucketId, urls) }
    }
  }

  return jsonPrivate(
    buckets.map(b => ({
      id: b.id, name: b.name, description: b.description, color: b.color,
      folderId: b.folderId ?? null, count: b._count.images, createdAt: b.createdAt,
      previewUrls: previewMap.get(b.id) ?? [],
    })),
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// POST — create a new bucket
// Body: { name, description?, color?, folderId? }
export async function POST(req: Request) {
  if (!checkAuth(req)) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, color, folderId } = await req.json() as { name: string; description?: string; color?: string; folderId?: number }
  if (!name?.trim()) return jsonPrivate({ error: 'name required' }, { status: 400 })

  const bucket = await prisma.datasetBucket.create({ data: { name: name.trim(), description, color, folderId: folderId ?? null } })
  return jsonPrivate(bucket, { status: 201 })
}
