import { NextResponse } from 'next/server'
import { S3Client, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3'
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

  const { key, uploadId, parts } = await req.json() as {
    key:      string
    uploadId: string
    parts:    { partNumber: number; etag: string }[]
  }

  if (!key || !uploadId || !parts?.length) {
    return NextResponse.json({ error: 'Missing key, uploadId, or parts' }, { status: 400 })
  }

  try {
    await r2().send(new CompleteMultipartUploadCommand({
      Bucket:           process.env.R2_BUCKET_NAME!,
      Key:              key,
      UploadId:         uploadId,
      MultipartUpload:  {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map(p => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }))
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
