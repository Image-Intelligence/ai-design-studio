import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)$/i


export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const folders = await prisma.datasetBucketFolder.findMany({ orderBy: { createdAt: 'asc' } })

  // Collect up to 4 direct preview URLs per folder from its direct buckets
  const previewMap = new Map<number, string[]>()
  if (folders.length > 0) {
    const folderIds = folders.map(f => f.id)
    const rows = await prisma.datasetBucketImage.findMany({
      where: { bucket: { folderId: { in: folderIds } } },
      select: {
        image:  { select: { imageUrl: true } },
        bucket: { select: { folderId: true } },
      },
      orderBy: { imageId: 'asc' },
    })
    for (const row of rows) {
      if (VIDEO_RE.test(row.image.imageUrl)) continue
      const fid = row.bucket.folderId!
      const existing = previewMap.get(fid) ?? []
      if (existing.length < 4) { existing.push(row.image.imageUrl); previewMap.set(fid, existing) }
    }
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
