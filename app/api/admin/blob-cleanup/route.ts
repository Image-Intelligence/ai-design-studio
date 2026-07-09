import { NextResponse } from "next/server"
import { checkAuth } from '@/lib/admin-auth'

const BLOB_TOKEN  = process.env.BLOB_READ_WRITE_TOKEN!
const BLOB_API    = 'https://blob.vercel-storage.com'
const HEADERS     = { authorization: `Bearer ${BLOB_TOKEN}`, 'x-api-version': '7' }
const BATCH_SIZE  = 100   // conservative — matches official Vercel recommendation
const MAX_RETRIES = 3

async function listBlobs(limit: number, cursor?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`${BLOB_API}?${params}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Blob list failed: ${res.status}`)
  return res.json() as Promise<{ blobs: { url: string }[]; cursor?: string; hasMore: boolean }>
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// GET — paginate all blobs for exact total count
// ?quick=1 returns only the first page (fast check) for the initial UI load
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quick = new URL(req.url).searchParams.get('quick') === '1'
  try {
    if (quick) {
      const data = await listBlobs(1000)
      return NextResponse.json(
        { total: data.blobs.length, hasMore: data.hasMore },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }
    // Full count — paginate everything
    let total = 0
    let cursor: string | undefined
    do {
      const data = await listBlobs(1000, cursor)
      total += data.blobs.length
      cursor = data.hasMore ? data.cursor : undefined
    } while (cursor)
    return NextResponse.json({ total }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — list + delete one batch; caller loops until deleted === 0
export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const data = await listBlobs(BATCH_SIZE)
    if (data.blobs.length === 0) return NextResponse.json({ deleted: 0, hasMore: false })

    const urls = data.blobs.map(b => b.url)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(`${BLOB_API}/delete`, {
        method:  'POST',
        headers: { ...HEADERS, 'content-type': 'application/json' },
        body:    JSON.stringify({ urls }),
      })

      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) {
          return NextResponse.json({ error: 'Rate limited — retry in a moment' }, { status: 429 })
        }
        // Honour Retry-After if present, otherwise exponential backoff (2s, 4s, 8s)
        const retryAfter = res.headers.get('retry-after')
        const backoff = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt + 1) * 1000
        await sleep(backoff)
        continue
      }

      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      return NextResponse.json({ deleted: urls.length, hasMore: true })
    }

    throw new Error('Max retries exceeded')
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
