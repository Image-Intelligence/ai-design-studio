// Proxy for all OneTrainer server calls: /api/admin/onetrainer/<anything> → http://localhost:8765/<anything>
import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/admin-auth'

const OT = 'http://localhost:8765'


async function proxy(req: Request, segments: string[]) {
  const url  = `${OT}/${segments.join('/')}`
  const init: RequestInit = { method: req.method }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body    = await req.text()
    init.headers = { 'Content-Type': 'application/json' }
  }
  try {
    const res  = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
    const body = await res.text()
    return new Response(body, {
      status:  res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'OneTrainer server unreachable', detail: msg }, { status: 503 })
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return proxy(req, (await params).path)
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return proxy(req, (await params).path)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return proxy(req, (await params).path)
}
