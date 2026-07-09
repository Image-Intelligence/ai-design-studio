import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/admin-auth'

const RUNPOD_API = 'https://api.runpod.ai/v2'


interface RunPodStatus {
  id: string
  status: string
  output?: { logs?: string[]; output_r2_key?: string; success?: boolean; error?: string; elapsed_min?: number }
  error?: string
  executionTime?: number
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job_id')
  if (!jobId) return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })

  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  const apiKey = process.env.RUNPOD_API_KEY
  if (!endpointId || !apiKey) {
    return NextResponse.json({ error: 'RunPod not configured' }, { status: 500 })
  }

  const res = await fetch(`${RUNPOD_API}/${endpointId}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to get RunPod status' }, { status: res.status })
  }

  const data = await res.json() as RunPodStatus

  const statusMap: Record<string, 'idle' | 'running' | 'done' | 'error' | 'cancelled'> = {
    IN_QUEUE:    'running',
    IN_PROGRESS: 'running',
    COMPLETED:   'done',
    FAILED:      'error',
    CANCELLED:   'cancelled',
    TIMED_OUT:   'error',
  }

  const output = data.output ?? {}

  return NextResponse.json({
    status:           statusMap[data.status] ?? 'idle',
    job_id:           jobId,
    runpod_status:    data.status,
    logs:             output.logs ?? [],
    output_r2_key:    output.output_r2_key ?? null,
    success:          output.success ?? null,
    error:            output.error ?? data.error ?? null,
    elapsed_min:      output.elapsed_min ?? null,
    execution_time_ms: data.executionTime ?? null,
  })
}
