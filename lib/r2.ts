import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const MULTIPART_CHUNK_SIZE = 50 * 1024 * 1024  // 50 MB

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

export async function initMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
  const res = await r2.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }))
  if (!res.UploadId) throw new Error('R2 did not return an UploadId')
  return { uploadId: res.UploadId }
}

export async function presignUploadPart(key: string, uploadId: string, partNumber: number, expiresIn = 3600): Promise<string> {
  return getSignedUrl(r2, new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn })
}

export async function completeMultipartUpload(key: string, uploadId: string): Promise<void> {
  const parts: { PartNumber: number; ETag: string }[] = []
  let marker: number | undefined
  do {
    const res = await r2.send(new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker }))
    for (const p of res.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag })
    }
    marker = res.IsTruncated ? (res.NextPartNumberMarker ?? undefined) : undefined
  } while (marker)
  parts.sort((a, b) => a.PartNumber - b.PartNumber)
  await r2.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  }))
}

export async function deleteFromR2(urlOrKey: string | string[]): Promise<void> {
  const keys = Array.isArray(urlOrKey) ? urlOrKey : [urlOrKey]
  for (const item of keys) {
    const key = item.startsWith('http') ? item.replace(`${PUBLIC_URL}/`, '') : item
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  }
}
