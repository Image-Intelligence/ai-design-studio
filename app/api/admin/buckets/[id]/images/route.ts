import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


// POST — add images to bucket
// Body: { imageIds: number[] }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: rawId } = await params
  const bucketId = parseInt(rawId)
  if (isNaN(bucketId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { imageIds } = await req.json() as { imageIds: number[] }
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return NextResponse.json({ error: 'imageIds required' }, { status: 400 })
  }

  await prisma.datasetBucketImage.createMany({
    data: imageIds.map(imageId => ({ bucketId, imageId })),
    skipDuplicates: true,
  })

  const count = await prisma.datasetBucketImage.count({ where: { bucketId } })
  return NextResponse.json({ added: imageIds.length, total: count })
}

// DELETE — remove images from bucket
// Body: { imageIds: number[] }
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: rawId } = await params
  const bucketId = parseInt(rawId)
  if (isNaN(bucketId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { imageIds } = await req.json() as { imageIds: number[] }
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return NextResponse.json({ error: 'imageIds required' }, { status: 400 })
  }

  const result = await prisma.datasetBucketImage.deleteMany({
    where: { bucketId, imageId: { in: imageIds } },
  })

  return NextResponse.json({ removed: result.count })
}
