import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i


export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const folders = await prisma.datasetBucketFolder.findMany({ orderBy: { createdAt: 'asc' } })

  // Collect up to 4 direct preview URLs per folder from its direct buckets.
  // BOUNDED per-folder query (take: 40) — a single unbounded findMany across all
  // foldered buckets returned ~57k rows / 7.24MB and blew Prisma Accelerate's 5MB
  // cap (P6009), which 500'd this route and made every folder vanish from the UI.
  // Mirrors the per-bucket pattern in app/api/admin/buckets/route.ts.
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
    folders.map(f => ({ ...f, previewUrls: previewMap.get(f.id) ?? [] })),
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, parentId } = await req.json() as { name: string; parentId?: number | null }
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const folder = await prisma.datasetBucketFolder.create({ data: { name: name.trim(), parentId: parentId ?? null } })
  return NextResponse.json(folder, { status: 201 })
}
