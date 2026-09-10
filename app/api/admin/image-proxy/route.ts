import { NextResponse } from 'next/server'

// Host allowlist prevents SSRF — this proxy previously fetched ANY https:// URL,
// letting a caller drive the server to reach internal/cloud endpoints. Only our
// own storage/CDN hosts are permitted. Mirrors app/api/proxy-image/route.ts.
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')
  if (!url || !url.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  const allowed = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))
  if (!allowed) {
    return NextResponse.json({ error: 'URL host not allowed' }, { status: 403 })
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return NextResponse.json({ error: 'Fetch failed' }, { status: res.status })
    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 })
  }
}
