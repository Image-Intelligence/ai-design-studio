import { NextResponse } from 'next/server'
import { S3Client, AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
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

  const { key, uploadId } = await req.json() as { key: string; uploadId: string }
  if (!key || !uploadId) return NextResponse.json({ error: 'Missing key or uploadId' }, { status: 400 })

  try {
    await r2().send(new AbortMultipartUploadCommand({
      Bucket:   process.env.R2_BUCKET_NAME!,
      Key:      key,
      UploadId: uploadId,
    }))
    return NextResponse.json({ aborted: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
