/**
 * Re-attach reference files that reached R2 but never got a database row.
 *
 * The upload is two steps: push the file to R2, then create the library row.
 * Row creation was batched 25 at a time into one interactive transaction that
 * did 25 sequential round trips through Accelerate — comfortably over the 5s
 * default timeout once the machine was busy. A transaction that times out
 * rolls back ENTIRELY, so a whole chunk of 25 vanished while the trailing
 * chunk of 2 survived. The files were already safely uploaded; only the rows
 * were lost.
 *
 * This finds files under u/<id>/ with no row and creates the missing ones.
 * Content-deduplicated by ETag, so a picture uploaded twice across retries
 * comes back once.
 *
 *   node scripts/recover-orphan-refs.mjs --user 1 --dry-run
 *   node scripts/recover-orphan-refs.mjs --user 1
 */
import fs from 'fs'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const at = argv.indexOf('--user')
const userId = at >= 0 && argv[at + 1] ? Number(argv[at + 1]) : null
if (!userId) { console.error('Pass --user <id>.'); process.exit(1) }

const PREFIX = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
const r2 = new S3Client({
  region: 'auto', endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})

// Every object this user has uploaded under their own prefix.
const objects = []
let token
do {
  const res = await r2.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME, Prefix: `u/${userId}/`, ContinuationToken: token,
  }))
  for (const o of res.Contents ?? []) objects.push(o)
  token = res.IsTruncated ? res.NextContinuationToken : undefined
} while (token)

// Only reference images — meshes and avatars live under the same prefix.
const refs = objects.filter(o => /\/reference-[^/]+\.(jpg|jpeg|png|webp)$/i.test(o.Key))
console.log(`${objects.length} objects under u/${userId}/, ${refs.length} of them reference images`)

const rows = await prisma.userReference.findMany({
  where: { userId, url: { contains: `/u/${userId}/` } },
  select: { url: true },
})
const known = new Set(rows.map(r => r.url))
const orphans = refs.filter(o => !known.has(`${PREFIX}/${o.Key}`))
console.log(`${rows.length} already have a row → ${orphans.length} orphaned\n`)
if (orphans.length === 0) { await prisma.$disconnect(); process.exit(0) }

// Dedupe by content. A retried upload puts the same bytes at a new key, and
// re-attaching every copy would fill the library with duplicates.
const byEtag = new Map()
for (const o of orphans.sort((a, b) => a.LastModified - b.LastModified)) {
  const tag = (o.ETag || '').replace(/"/g, '')
  if (!tag) continue
  if (!byEtag.has(tag)) byEtag.set(tag, o)
}
const unique = [...byEtag.values()]
console.log(`${unique.length} distinct images (${orphans.length - unique.length} were duplicate re-uploads)`)

const limit = await prisma.userReference.count({ where: { userId, isCleared: false } })
console.log(`library currently holds ${limit} live references`)
for (const o of unique.slice(0, 10)) {
  console.log(`  + ${(o.Size / 1e6).toFixed(2)}MB  ${o.Key}`)
}
if (unique.length > 10) console.log(`  … and ${unique.length - 10} more`)

if (DRY) {
  console.log('\nDRY RUN — nothing written.')
} else {
  const created = await prisma.userReference.createManyAndReturn({
    data: unique.map(o => ({ userId, url: `${PREFIX}/${o.Key}`, folderId: null })),
    select: { id: true },
  })
  console.log(`\nre-attached ${created.length} reference(s) to the library root`)
}
await prisma.$disconnect()
