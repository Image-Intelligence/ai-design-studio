import { NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
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

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const prefix = searchParams.get('prefix') ?? ''

  try {
    const res = await r2().send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
    }))

    const files = (res.Contents ?? [])
      .filter(obj => obj.Key && obj.Key !== prefix)
      .map(obj => ({
        key:           obj.Key!,
        name:          obj.Key!.split('/').pop()!,
        size_gb:       (obj.Size ?? 0) / 1e9,
        size_bytes:    obj.Size ?? 0,
        last_modified: obj.LastModified?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''))

    return NextResponse.json(files)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await req.json() as { key: string }
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  try {
    await r2().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }))
    return NextResponse.json({ deleted: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
