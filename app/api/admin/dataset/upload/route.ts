// POST /api/admin/dataset/upload
// Accepts multipart form data, uploads images/videos to R2, creates GeneratedImage records,
// and adds them to the specified uploads bucket.
// Per-file metadata is passed as a JSON array in `metadataJson`.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { v4 as uuidv4 } from 'uuid'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg':      'jpg',
  'image/jpg':       'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'image/gif':       'gif',
  'image/avif':      'avif',
  'video/mp4':       'mp4',
  'video/webm':      'webm',
  'video/quicktime': 'mov',
  'video/avi':       'avi',
  'video/x-msvideo': 'avi',
  'video/x-matroska':'mkv',
  'video/mov':       'mov',
}

interface FileMeta {
  description?: string
  tags?:        string[]
  caption?:     string | null
  marked?:      boolean
}

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-admin-password')
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const form = await req.formData()

    const bucketId     = parseInt(form.get('bucketId') as string)
    const widths       = JSON.parse((form.get('widths')        as string | null) ?? '[]') as number[]
    const heights      = JSON.parse((form.get('heights')       as string | null) ?? '[]') as number[]
    const metadataRaw  = (form.get('metadataJson') as string | null) ?? '[]'
    const perFileMeta  = JSON.parse(metadataRaw) as FileMeta[]

    const files = form.getAll('files') as File[]
    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const adminUser = await prisma.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
    if (!adminUser) return NextResponse.json({ error: 'No users in DB' }, { status: 500 })

    const createdIds: number[] = []
    const now       = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    for (let i = 0; i < files.length; i++) {
      const file     = files[i]
      const mimeType = file.type || 'image/jpeg'
      const ext      = ALLOWED_TYPES[mimeType]
      if (!ext) continue

      const meta        = perFileMeta[i] ?? {}
      const description = meta.description?.trim() || file.name.replace(/\.[^.]+$/, '')
      const adminTags   = (meta.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)
      const caption     = meta.caption?.trim() || null
      const marked      = meta.marked ?? false

      const buffer      = Buffer.from(await file.arrayBuffer())
      const uuid        = uuidv4()
      const key         = `uploads/${yearMonth}/${uuid}.${ext}`
      const imageUrl    = await uploadToR2(key, buffer, mimeType)

      const width       = widths[i]  || null
      const height      = heights[i] || null
      const aspectRatio = (width && height) ? deriveAspectRatio(width, height) : null
      const isVideo     = mimeType.startsWith('video/')

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
            originalFilename: file.name,
            fileSize:         file.size,
            mimeType,
            width:            width ?? undefined,
            height:           height ?? undefined,
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
    console.error('[dataset/upload] error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
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
