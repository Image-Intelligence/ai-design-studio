/**
 * Find (and optionally soft-delete) image rows that are duplicate saves of a
 * job another mechanism had already saved.
 *
 * The client used to fall back to the nano-banana STATUS route for any model
 * without one of its own. That route does not merely report on a job: it
 * harvests the finished result, re-hosts it to R2 and writes its own
 * GeneratedImage row, labelled nano-banana-pro-2 whatever actually ran. For a
 * webhook-settled model the webhook was saving the real row at the same time,
 * so one generation became two rows, two R2 objects and two feed tiles.
 *
 * A duplicate is identified structurally, never by guesswork: the row carries
 * a falRequestId belonging to a GenerationQueue row for a DIFFERENT model, and
 * that queue row names a different image as the one it produced. The row the
 * queue row claims is the keeper.
 *
 *   node scripts/dedupe-nb2-mislabelled.mjs            # dry run
 *   node scripts/dedupe-nb2-mislabelled.mjs --apply    # soft-delete (reversible)
 */
import fs from 'fs'
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const imgs = await prisma.generatedImage.findMany({
  where: { isDeleted: false, falRequestId: { not: null } },
  select: { id: true, userId: true, model: true, falRequestId: true, imageUrl: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
  take: 2000,
})
const reqIds = imgs.map(i => i.falRequestId)
const rows = await prisma.generationQueue.findMany({
  where: { falRequestId: { in: reqIds } },
  select: { id: true, modelId: true, falRequestId: true, parameters: true },
})
const qByReq = new Map(rows.map(r => [r.falRequestId, r]))

const dupes = []
for (const img of imgs) {
  const q = qByReq.get(img.falRequestId)
  if (!q) continue
  if (q.modelId === img.model) continue          // labels agree - not a duplicate
  const owns = q.parameters?.completedImageIds ?? []
  if (!Array.isArray(owns) || owns.length === 0) continue
  if (owns.includes(img.id)) continue            // this IS the row the job claims
  dupes.push({ img, q, keeps: owns })
}

console.log(`scanned ${imgs.length} rows with a request id`)
console.log(`duplicate saves found: ${dupes.length}\n`)
const byModel = {}
for (const d of dupes) {
  const k = `${d.q.modelId} saved again as ${d.img.model}`
  byModel[k] = (byModel[k] || 0) + 1
}
for (const [k, v] of Object.entries(byModel)) console.log(`  ${v}  ${k}`)
console.log()
for (const d of dupes) {
  console.log(`  drop img${d.img.id} (${d.img.model}) u${d.img.userId} ${d.img.createdAt.toISOString().slice(0,19)}  keep img${d.keeps.join(',')}  q${d.q.id}`)
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to soft-delete these.'); await prisma.$disconnect(); process.exit(0) }
if (dupes.length === 0) { await prisma.$disconnect(); process.exit(0) }

// Soft delete only: the row and its R2 object both survive, so this is
// reversible with a single isDeleted=false update.
const res = await prisma.generatedImage.updateMany({
  where: { id: { in: dupes.map(d => d.img.id) } },
  data: { isDeleted: true },
})
console.log(`\nsoft-deleted ${res.count} rows (reversible: set isDeleted=false)`)
await prisma.$disconnect()
