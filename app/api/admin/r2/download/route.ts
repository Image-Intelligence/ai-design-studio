import { NextResponse } from 'next/server'

const RUNPOD_API = 'https://api.runpod.ai/v2'

// POST { url, r2Key, civitaiToken? }
// Submits a download_to_r2 job to the RunPod worker and returns { job_id }
export async function POST(req: Request) {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  const apiKey     = process.env.RUNPOD_API_KEY
  if (!endpointId || !apiKey)
    return NextResponse.json({ error: 'RunPod not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({})) as { url?: string; r2Key?: string; civitaiToken?: string }
  const { url, r2Key, civitaiToken } = body

  if (!url || !r2Key)
    return NextResponse.json({ error: 'url and r2Key are required' }, { status: 400 })

  const headers: Record<string, string> = {}
  if (civitaiToken) headers['Authorization'] = `Bearer ${civitaiToken}`

  const res = await fetch(`${RUNPOD_API}/${endpointId}/run`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { action: 'download_to_r2', url, r2_key: r2Key, headers },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: `RunPod error: ${err}` }, { status: res.status })
  }

  const data = await res.json() as { id: string }
  return NextResponse.json({ job_id: data.id })
}

// GET ?job_id=xxx — poll RunPod status, return { status, r2Key, sizeMb, error }
export async function GET(req: Request) {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  const apiKey     = process.env.RUNPOD_API_KEY
  if (!endpointId || !apiKey)
    return NextResponse.json({ error: 'RunPod not configured' }, { status: 500 })

  const jobId = new URL(req.url).searchParams.get('job_id')
  if (!jobId) return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })

  const res = await fetch(`${RUNPOD_API}/${endpointId}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return NextResponse.json({ error: `RunPod HTTP ${res.status}` }, { status: res.status })

  const data = await res.json() as {
    status: string
    output?: { success?: boolean; r2_key?: string; size_mb?: number; error?: string }
    error?: string
  }

  const statusMap: Record<string, string> = {
    IN_QUEUE: 'running', IN_PROGRESS: 'running',
    COMPLETED: 'done', FAILED: 'error', CANCELLED: 'error', TIMED_OUT: 'error',
  }

  const mapped = statusMap[data.status] ?? 'running'
  return NextResponse.json({
    status:  mapped,
    r2Key:   data.output?.r2_key  ?? null,
    sizeMb:  data.output?.size_mb ?? null,
    error:   data.output?.error   ?? data.error ?? null,
  })
}
