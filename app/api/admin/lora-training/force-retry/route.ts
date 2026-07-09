import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'

function authOk(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false
  return req.headers.get('x-admin-password') === pass
}

// Resets a stuck queued/in_progress/failed job back to 'preparing'
// and re-kicks off the prepare pipeline.
export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await req.json() as { jobId: number }
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = await prisma.loraTrainingJob.findUnique({ where: { id: jobId } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  await prisma.loraTrainingJob.update({
    where: { id: jobId },
    data: { status: 'preparing', requestId: null, errorMsg: 'Retrying...' },
  })

  after(async () => {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://prompt-protocol.vercel.app'
    try {
      await fetch(`${base}/api/admin/lora-training/prepare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': process.env.ADMIN_PASSWORD ?? '',
        },
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch { /* prepare runs independently */ }
  })

  return NextResponse.json({ ok: true })
}
