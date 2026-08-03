import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateApiKey, invalidKeyResponse, requireScopes } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'

export const dynamic = 'force-dynamic'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i

// GET /api/v1/dataset/folders — dataset folder tree for the desktop app.
// Double-gated: dataset:read scope AND live admin status.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()
  const denied = requireScopes(auth, 'dataset:read')
  if (denied) return denied
  if (!(await checkIsAdmin(auth.user.email))) {
    return NextResponse.json({ error: 'Admin only', code: 'ADMIN_ONLY' }, { status: 403 })
  }

  const folders = await prisma.datasetBucketFolder.findMany({ orderBy: { createdAt: 'asc' } })

  // Bounded per-folder preview query — an unbounded findMany across all foldered
  // buckets exceeds Prisma Accelerate's 5MB cap (P6009) once the dataset grows.
  const previewMap = new Map<number, string[]>()
  if (folders.length > 0) {
    await Promise.all(folders.map(async f => {
      const rows = await prisma.datasetBucketImage.findMany({
        where: { bucket: { folderId: f.id } },
        select: { image: { select: { imageUrl: true } } },
        orderBy: { imageId: 'asc' },
        take: 40,
      })
      previewMap.set(f.id, rows.map(r => r.image.imageUrl).filter(u => !VIDEO_RE.test(u)).slice(0, 4))
    }))
  }

  return NextResponse.json(
    { folders: folders.map(f => ({ ...f, previewUrls: previewMap.get(f.id) ?? [] })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
