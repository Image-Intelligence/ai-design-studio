import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { decryptKey } from '@/lib/chat-key-crypto'
import { parseRunpodConfig, extractRunpodPodId } from '@/lib/runpod-config'

// Start/stop the linked RunPod pod straight from Chat Settings, so the GPU
// isn't billed while idle. Uses the RunPod account key (RUNPOD_API_KEY) + the
// pod id derived from the linked proxy URL.
const RUNPOD_REST = 'https://rest.runpod.io/v1'

async function resolvePodId(userId: number): Promise<string | null> {
  const row = await prisma.chatProviderKey.findUnique({
    where: { userId_provider: { userId, provider: 'runpod' } },
    select: { encrypted: true },
  }).catch(() => null)
  const cfg = row ? parseRunpodConfig(decryptKey(row.encrypted)) : null
  return extractRunpodPodId(cfg?.baseUrl)
}

// GET — current pod power state (RUNNING / EXITED / etc.)
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = process.env.RUNPOD_API_KEY
  if (!key) return NextResponse.json({ controllable: false, reason: 'RUNPOD_API_KEY not set on the server' })
  const podId = await resolvePodId(user.id)
  if (!podId) return NextResponse.json({ controllable: false, reason: 'Linked endpoint is not a RunPod pod' })

  try {
    const res = await fetch(`${RUNPOD_REST}/pods/${podId}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return NextResponse.json({ controllable: true, podId, status: 'unknown', error: `RunPod responded ${res.status}` }, { status: 200 })
    const p = await res.json().catch(() => ({}))
    return NextResponse.json(
      { controllable: true, podId, status: p?.desiredStatus ?? 'unknown', name: p?.name ?? null, costPerHr: p?.costPerHr ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ controllable: true, podId, status: 'unknown', error: 'Could not reach RunPod' }, { status: 200 })
  }
}

// POST — { action: 'start' | 'stop' }
export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = process.env.RUNPOD_API_KEY
  if (!key) return NextResponse.json({ error: 'RUNPOD_API_KEY not set on the server' }, { status: 500 })
  const podId = await resolvePodId(user.id)
  if (!podId) return NextResponse.json({ error: 'Linked endpoint is not a RunPod pod' }, { status: 400 })

  let body: any
  try { body = await req.json() } catch { body = {} }
  const action = body?.action === 'start' ? 'start' : body?.action === 'stop' ? 'stop' : null
  if (!action) return NextResponse.json({ error: 'action must be "start" or "stop"' }, { status: 400 })

  try {
    const res = await fetch(`${RUNPOD_REST}/pods/${podId}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Resuming a stopped pod can fail if that host has no free GPU right now
      return NextResponse.json({ error: data?.error || `RunPod ${action} failed (${res.status})` }, { status: 502 })
    }
    return NextResponse.json({ ok: true, status: data?.desiredStatus ?? (action === 'start' ? 'RUNNING' : 'EXITED') })
  } catch {
    return NextResponse.json({ error: `Could not reach RunPod to ${action} the pod` }, { status: 502 })
  }
}
