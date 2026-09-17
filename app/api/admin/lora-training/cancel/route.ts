import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminRequest } from '@/lib/admin-check'

export const runtime = 'nodejs'

/**
 * Stop a training run.
 *
 * Two quite different states hide behind one button:
 *
 *  - Still preparing here. Nothing has been submitted and nothing has been
 *    charged; marking the job cancelled is the whole job, and the prepare loop
 *    checks for it between batches and stops.
 *
 *  - Already running at fal. Their queue takes a cancel, and that is the part
 *    that actually saves money — training is billed per step, so a run stopped
 *    early stops accruing.
 *
 * The status lives under owner/app, not the full endpoint path: cancelling
 * ideogram/v4/trainer means calling ideogram/v4/requests/<id>/cancel. A
 * sub-path 405s, which is the same trap the status pollers document.
 *
 * Cancelling something fal has already finished is not an error — it answers
 * that it cannot, and the right response is to say so rather than to report a
 * failure the user cannot act on.
 */
export async function POST(req: NextRequest) {
  if (!await checkAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { jobId?: number } | null
  const jobId = Number(body?.jobId)
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = await prisma.loraTrainingJob.findUnique({ where: { id: jobId } })
  if (!job) return NextResponse.json({ error: 'No such job' }, { status: 404 })

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ ok: true, alreadyFinished: true, status: job.status })
  }

  let falSaid: string | null = null
  if (job.requestId && process.env.FAL_KEY) {
    const baseApp = job.modelId.split('/').slice(0, 2).join('/')
    try {
      const res = await fetch(`https://queue.fal.run/${baseApp}/requests/${job.requestId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Key ${process.env.FAL_KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
      // 202 CANCELLATION_REQUESTED, measured: fal accepts it and the run can
      // report IN_PROGRESS for another half minute before it actually stops.
      falSaid = res.ok
        ? 'cancellation requested at fal — it stops shortly, and billing stops with it'
        : `fal answered ${res.status}`
    } catch {
      // Unreachable: the local row still gets marked, so the run stops being
      // treated as live here even if fal keeps going.
      falSaid = 'could not reach fal'
    }
  }

  await prisma.loraTrainingJob.update({
    where: { id: jobId },
    data: {
      status: 'cancelled',
      errorMsg: `Cancelled${falSaid ? ` — ${falSaid}` : ' before it was submitted'}`,
    },
  })

  return NextResponse.json({ ok: true, falSaid })
}
