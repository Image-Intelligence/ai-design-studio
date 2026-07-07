import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin123'

interface RecordInput {
  imageUrl: string
  mimeType: string
  filename: string
  width:    number
  height:   number
  meta: {
    description?: string
    tags?:        string[]
    caption?:     string | null
    marked?:      boolean
  }
}

function deriveAspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const d   = gcd(w, h)
  const rw  = w / d, rh = h / d
  const known: Record<string, string> = {
    '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4',
    '1:1': '1:1',   '3:2': '3:2',   '2:3': '2:3', '21:9': '21:9',
  }
  return known[`${rw}:${rh}`] ?? `${rw}:${rh}`
}

// POST /api/admin/dataset/record
// { bucketId, records: RecordInput[] }
// Creates GeneratedImage DB records for files already uploaded to R2.
export async function POST(req: Request) {
  if (req.headers.get('x-admin-password') !== ADMIN_PW) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const { bucketId, records } = await req.json() as { bucketId: number; records: RecordInput[] }
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'No records' }, { status: 400 })
    }

    const adminUser = await prisma.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
    if (!adminUser) return NextResponse.json({ error: 'No users in DB' }, { status: 500 })

    const now        = new Date()
    const createdIds: number[] = []

    for (const rec of records) {
      const { imageUrl, mimeType, filename, width, height, meta } = rec
      const description = meta.description?.trim() || filename.replace(/\.[^.]+$/, '')
      const adminTags   = (meta.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)
      const caption     = meta.caption?.trim() || null
      const marked      = meta.marked ?? false
      const isVideo     = mimeType.startsWith('video/')
      const aspectRatio = (width && height) ? deriveAspectRatio(width, height) : null

      const record = await prisma.generatedImage.create({
        data: {
          userId:             adminUser.id,
          prompt:             description,
          imageUrl,
          model:              '__upload__',
          ticketCost:         0,
          referenceImageUrls: [],
          adminTags,
          adminCaption:       caption,
          markedForTraining:  marked,
          aspectRatio,
          quality:            null,
          falRequestId:       null,
          expiresAt:          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 100),
          videoMetadata: {
            isUpload:         true,
            isVideo,
            originalFilename: filename,
            mimeType,
            width:            width  || undefined,
            height:           height || undefined,
            uploadedAt:       now.toISOString(),
          },
        },
      })
      createdIds.push(record.id)
    }

    if (!isNaN(bucketId) && createdIds.length > 0) {
      await prisma.datasetBucketImage.createMany({
        data: createdIds.map(imageId => ({ bucketId, imageId })),
        skipDuplicates: true,
      })
    }

    return NextResponse.json({ success: true, count: createdIds.length, ids: createdIds })
  } catch (error: any) {
    console.error('[dataset/record] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
