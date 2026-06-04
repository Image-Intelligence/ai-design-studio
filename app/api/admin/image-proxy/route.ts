import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')
  if (!url || !url.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  try {
    const res = await fetch(url)
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
