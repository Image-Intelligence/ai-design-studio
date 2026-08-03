import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateApiKey, invalidKeyResponse, requireScopes } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'

export const dynamic = 'force-dynamic'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i

// GET /api/v1/dataset/buckets — dataset bucket list for the desktop app.
// Double-gated: dataset:read scope AND live admin status (a revoked admin's
// old key fails closed even before any non-admin rollout).
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()
  const denied = requireScopes(auth, 'dataset:read')
  if (denied) return denied
  if (!(await checkIsAdmin(auth.user.email))) {
    return NextResponse.json({ error: 'Admin only', code: 'ADMIN_ONLY' }, { status: 403 })
  }

  const buckets = await prisma.datasetBucket.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { images: true } } },
  })

  const previewMap = new Map<number, string[]>()
  if (buckets.length > 0) {
    await Promise.all(buckets.map(async b => {
      const rows = await prisma.datasetBucketImage.findMany({
        where: { bucketId: b.id },
        select: { image: { select: { imageUrl: true } } },
        orderBy: { imageId: 'asc' },
        take: 8,
      })
      previewMap.set(b.id, rows.map(r => r.image.imageUrl).filter(u => !VIDEO_RE.test(u)).slice(0, 4))
    }))
  }

  return NextResponse.json(
    {
      buckets: buckets.map(b => ({
        id: b.id, name: b.name, description: b.description, color: b.color,
        folderId: b.folderId ?? null, count: b._count.images, createdAt: b.createdAt,
        previewUrls: previewMap.get(b.id) ?? [],
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
