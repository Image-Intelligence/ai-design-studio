import { NextResponse } from 'next/server'
import {
  presignPutUrl,
  initMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  MULTIPART_CHUNK_SIZE,
} from '@/lib/r2'
import { checkAuth } from '@/lib/admin-auth'


const PREFIX: Record<string, string> = {
  checkpoint: 'training/checkpoints',
  dataset:    'training/datasets',
  model:      'training/models',
  lora:       'training/loras',
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    action?: 'init' | 'complete'
    type?: string
    filename?: string
    contentType?: string
    fileSize?: number
    key?: string
    uploadId?: string
  }
  const { action, type, filename, contentType, fileSize, key: bodyKey, uploadId } = body

  // ── Multipart init ────────────────────────────────────────────────────────
  if (action === 'init') {
    if (!type || !filename || !fileSize) {
      return NextResponse.json({ error: 'Missing type, filename or fileSize' }, { status: 400 })
    }
    const key = `${PREFIX[type] ?? 'training/misc'}/${filename}`
    const ct = contentType ?? 'application/octet-stream'
    const { uploadId: uid } = await initMultipartUpload(key, ct)
    const partCount = Math.ceil(fileSize / MULTIPART_CHUNK_SIZE)
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) => presignUploadPart(key, uid, i + 1))
    )
    return NextResponse.json({ uploadId: uid, key, partUrls })
  }

  // ── Multipart complete ────────────────────────────────────────────────────
  if (action === 'complete') {
    if (!bodyKey || !uploadId) {
      return NextResponse.json({ error: 'Missing key or uploadId' }, { status: 400 })
    }
    await completeMultipartUpload(bodyKey, uploadId)
    return NextResponse.json({ success: true, key: bodyKey })
  }

  // ── Single-part presigned PUT (small files / checkpoints) ─────────────────
  if (!type || !filename) {
    return NextResponse.json({ error: 'Missing type or filename' }, { status: 400 })
  }
  const key = `${PREFIX[type] ?? 'training/misc'}/${filename}`
  const { uploadUrl, publicUrl } = await presignPutUrl(key, contentType ?? 'application/octet-stream', 3600)
  return NextResponse.json({ uploadUrl, publicUrl, key })
}
