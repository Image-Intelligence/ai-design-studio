import { NextResponse } from 'next/server'

const RUNPOD_API = 'https://api.runpod.ai/v2'
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

// POST — called by startNb2SlotPolling with { requestId, ... }
// Returns { status: 'processing' | 'completed' | 'failed', images?: [{url, dbId}], error? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { requestId?: string }
  const jobId = body.requestId
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'Missing requestId' })

  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  const apiKey     = process.env.RUNPOD_API_KEY
  if (!endpointId || !apiKey) return NextResponse.json({ status: 'failed', error: 'RunPod not configured' })

  const res = await fetch(`${RUNPOD_API}/${endpointId}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    // 404 means RunPod doesn't have this job yet (brief registration delay after /run submit)
    // or has already purged a completed job — treat as still processing rather than a hard fail.
    if (res.status === 404) return NextResponse.json({ status: 'processing' })
    return NextResponse.json({ status: 'failed', error: `RunPod HTTP ${res.status}` })
  }

  const data = await res.json() as { status: string; output?: { success?: boolean; output_r2_key?: string; error?: string }; error?: string }

  const statusMap: Record<string, string> = {
    IN_QUEUE:    'processing',
    IN_PROGRESS: 'processing',
    COMPLETED:   'completed',
    FAILED:      'failed',
    CANCELLED:   'failed',
    TIMED_OUT:   'failed',
  }
  const status = statusMap[data.status] ?? 'processing'

  if (status === 'failed') {
    return NextResponse.json({ status: 'failed', error: data.output?.error ?? data.error ?? 'RunPod job failed' })
  }

  if (status === 'completed') {
    const r2Key = data.output?.output_r2_key
    if (!r2Key) return NextResponse.json({ status: 'failed', error: 'Job completed but no output image key' })

    const imageUrl = PUBLIC_URL
      ? `${PUBLIC_URL}/${r2Key}`
      : `https://${process.env.R2_BUCKET_NAME}.${new URL(process.env.R2_ENDPOINT!).hostname}/${r2Key}`

    return NextResponse.json({ status: 'completed', images: [{ url: imageUrl, dbId: null, r2Key }] })
  }

  return NextResponse.json({ status: 'processing' })
}
