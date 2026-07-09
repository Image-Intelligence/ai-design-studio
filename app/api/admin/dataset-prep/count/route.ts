import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/admin-auth'


export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const bucketId = Number(searchParams.get('bucketId'))
  if (!bucketId) return NextResponse.json({ error: 'bucketId required' }, { status: 400 })

  const rows = await prisma.datasetBucketImage.findMany({
    where: { bucketId },
    select: {
      image: {
        select: {
          markedForTraining: true,
          adminCaption: true,
          referenceImageUrls: true,
          isDeleted: true,
        }
      }
    }
  })

  const images = rows.map(r => r.image).filter(img => !img.isDeleted)

  return NextResponse.json({
    total: images.length,
    markedForTraining: images.filter(img => img.markedForTraining).length,
    hasCaption: images.filter(img => !!img.adminCaption).length,
    hasRefs: images.filter(img => img.referenceImageUrls.length > 0).length,
    blobRefs: images.filter(img =>
      img.referenceImageUrls.some(url => url.includes('blob.vercel-storage.com'))
    ).length,
  })
}
