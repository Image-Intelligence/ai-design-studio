import { NextResponse } from 'next/server'
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3'
import { checkAuth } from '@/lib/admin-auth'

export const runtime = 'nodejs'


function r2() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key        = searchParams.get('key')
  const uploadId   = searchParams.get('uploadId')
  const partNumber = parseInt(searchParams.get('partNumber') ?? '1')

  if (!key || !uploadId || isNaN(partNumber)) {
    return NextResponse.json({ error: 'Missing params: key, uploadId, partNumber' }, { status: 400 })
  }

  try {
    const body = await req.arrayBuffer()
    const res = await r2().send(new UploadPartCommand({
      Bucket:        process.env.R2_BUCKET_NAME!,
      Key:           key,
      UploadId:      uploadId,
      PartNumber:    partNumber,
      Body:          Buffer.from(body),
      ContentLength: body.byteLength,
    }))
    return NextResponse.json({ etag: res.ETag })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
