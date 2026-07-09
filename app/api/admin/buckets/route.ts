import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i


// GET — list all buckets with image counts and direct preview URLs (no proxy)
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const buckets = await prisma.datasetBucket.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { images: true } } },
  })

  // Fetch up to 4 preview URLs per bucket concurrently (avoids slow N+1 serial queries)
  const previewMap = new Map<number, string[]>()
  if (buckets.length > 0) {
    await Promise.all(buckets.map(async b => {
      const rows = await prisma.datasetBucketImage.findMany({
        where: { bucketId: b.id },
        select: { image: { select: { imageUrl: true } } },
        orderBy: { imageId: 'asc' },
        take: 8,
      })
      const urls = rows
        .map(r => r.image.imageUrl)
        .filter(url => !VIDEO_RE.test(url))
        .slice(0, 4)
      previewMap.set(b.id, urls)
    }))
  }

  return NextResponse.json(
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
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, color, folderId } = await req.json() as { name: string; description?: string; color?: string; folderId?: number }
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const bucket = await prisma.datasetBucket.create({ data: { name: name.trim(), description, color, folderId: folderId ?? null } })
  return NextResponse.json(bucket, { status: 201 })
}
