import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME!
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<string> {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
  return `${PUBLIC_URL}/${key}`
}

export async function presignPutUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn })
  return { uploadUrl, publicUrl: `${PUBLIC_URL}/${key}` }
}

export async function presignGetUrl(key: string, expiresIn = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(r2, cmd, { expiresIn })
}

export async function deleteFromR2(urlOrKey: string | string[]): Promise<void> {
  const keys = Array.isArray(urlOrKey) ? urlOrKey : [urlOrKey]
  for (const item of keys) {
    const key = item.startsWith('http') ? item.replace(`${PUBLIC_URL}/`, '') : item
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  }
}
