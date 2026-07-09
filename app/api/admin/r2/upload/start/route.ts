import { NextResponse } from 'next/server'
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3'
import { checkAuth } from '@/lib/admin-auth'


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

  const { key, contentType } = await req.json() as { key: string; contentType?: string }
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  try {
    const res = await r2().send(new CreateMultipartUploadCommand({
      Bucket:      process.env.R2_BUCKET_NAME!,
      Key:         key,
      ContentType: contentType ?? 'application/octet-stream',
    }))
    return NextResponse.json({ uploadId: res.UploadId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
