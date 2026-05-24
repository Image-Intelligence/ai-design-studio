import { NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const prefix   = searchParams.get('prefix') ?? 'training/checkpoints/'
  const allFiles = searchParams.get('allFiles') === 'true'

  const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

  try {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
    }))

    const files = (res.Contents ?? [])
      .filter(obj => obj.Key && (allFiles || /\.(safetensors|ckpt|pt)$/i.test(obj.Key)))
      .map(obj => ({
        key:           obj.Key!,
        name:          obj.Key!.split('/').pop()!,
        size_gb:       Math.round((obj.Size ?? 0) / 1e9 * 10) / 10,
        last_modified: obj.LastModified?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''))

    return NextResponse.json(files)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
