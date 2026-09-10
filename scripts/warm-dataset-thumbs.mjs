/**
 * Generate the dataset thumbnails that do not exist yet, a few at a time.
 *
 * A grid tile asks /api/admin/dataset/thumb/<id> for its picture. When the
 * image already has a stored thumbnail that is a redirect to R2 and costs
 * nothing. When it does not — and for VIDEO it never does until someone looks
 * at it — the route has to fetch the source and run ffmpeg, which measured at
 * 2.6 to 7.1 seconds each.
 *
 * Opening a bucket asks for fifty of those at once. They contend for CPU and
 * for the browser's six connections per host, a good number of them time out,
 * and a tile that timed out never got as far as saving its thumbnail — so
 * reopening the bucket fails in exactly the same way. That is why the "Videos"
 * bucket never loaded.
 *
 * This walks the same route at a sane concurrency, so the cost is paid once,
 * offline, and every later view is a redirect.
 *
 *   node scripts/warm-dataset-thumbs.mjs --bucket 285
 *   node scripts/warm-dataset-thumbs.mjs --all
 *   node scripts/warm-dataset-thumbs.mjs --all --concurrency 4
 */
import fs from 'fs'
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const bucketId = arg('--bucket') ? Number(arg('--bucket')) : null
const all = argv.includes('--all')
// Three at a time: enough to keep the machine busy, few enough that no single
// ffmpeg run is starved into the route's own timeout.
const CONCURRENCY = Number(arg('--concurrency', '3'))
const BASE = arg('--base', 'http://localhost:3000')

if (!bucketId && !all) {
  console.error('Pass --bucket <id> or --all.')
  process.exit(1)
}
if (!process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set; the dataset route would refuse us.')
  process.exit(1)
}

const where = {
  isDeleted: false,
  thumbnailUrl: null,
  ...(bucketId ? { bucketImages: { some: { bucketId } } } : {}),
}
const rows = await prisma.generatedImage.findMany({
  where, select: { id: true, imageUrl: true }, orderBy: { id: 'desc' },
})
const isVideo = u => /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(u)
console.log(`${rows.length} image(s) without a stored thumbnail (${rows.filter(r => isVideo(r.imageUrl)).length} video)\n`)
if (rows.length === 0) { await prisma.$disconnect(); process.exit(0) }

let done = 0, made = 0, failed = 0
const started = Date.now()
const queue = [...rows]

async function worker() {
  while (queue.length) {
    const row = queue.shift()
    try {
      // Videos need ffmpeg and can genuinely take several seconds; give the
      // route room rather than adding another timeout on top of its own.
      const res = await fetch(`${BASE}/api/admin/dataset/thumb/${row.id}`, {
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        signal: AbortSignal.timeout(120_000),
      })
      if (res.ok) { made++ } else { failed++; if (failed <= 5) console.log(`  ${row.id} → HTTP ${res.status}`) }
      // Drain the body so the connection is released for the next one.
      await res.arrayBuffer().catch(() => {})
    } catch (e) {
      failed++
      if (failed <= 5) console.log(`  ${row.id} → ${String(e.message).slice(0, 60)}`)
    }
    if (++done % 20 === 0 || done === rows.length) {
      const rate = done / ((Date.now() - started) / 1000)
      const left = Math.round((rows.length - done) / Math.max(rate, 0.01))
      console.log(`  ${done}/${rows.length} — made ${made}, failed ${failed}, ~${left}s left`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// The route saves the thumbnail AFTER responding, so give those writes a
// moment to land before reporting what is left.
await new Promise(r => setTimeout(r, 3000))
const remaining = await prisma.generatedImage.count({ where })
console.log(`\nmade ${made}, failed ${failed}; ${remaining} still without a thumbnail`)
await prisma.$disconnect()
