import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/admin-auth'

const RUNPOD_API = 'https://api.runpod.ai/v2'


export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const endpointId = process.env.RUNPOD_ENDPOINT_ID
  const apiKey = process.env.RUNPOD_API_KEY
  if (!endpointId || !apiKey) {
    return NextResponse.json({ error: 'RunPod not configured' }, { status: 500 })
  }

  const { job_id } = await req.json() as { job_id: string }
  if (!job_id) return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })

  const res = await fetch(`${RUNPOD_API}/${endpointId}/cancel/${job_id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  const data = await res.json()
  return NextResponse.json({ cancelled: res.ok, data })
}
