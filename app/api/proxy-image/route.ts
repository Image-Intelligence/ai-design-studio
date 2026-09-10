import { NextResponse } from 'next/server'

const ALLOWED_HOSTS = [
  'pub-de315f4652054008be5f90bf09919f80.r2.dev',
  // Signed media comes through the Worker, and the public assets
  // moved to their own bucket - see MEDIA-PRIVACY.md.
  'prompt-protocol-media.promptandprotocol.workers.dev',
  'pub-738a6d61c61a473595356856a86615a1.r2.dev',
  'blob.vercel-storage.com',
  'fal.media',
  'storage.googleapis.com',
  'replicate.delivery',
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const parsed = new URL(url)
    const allowed = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))
    if (!allowed) return NextResponse.json({ error: 'URL not allowed' }, { status: 403 })

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status })

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const buf = await res.arrayBuffer()

    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
