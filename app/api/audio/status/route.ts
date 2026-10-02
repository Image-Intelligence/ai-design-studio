import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { settleAudioRun } from '@/lib/audio-settle'

/**
 * POST /api/audio/status { requestId } - settle an Audio Studio run.
 *
 * The run's GenerationQueue row is found by fal request id AND the caller's
 * user id - so a client can only ever settle its own runs. The settling itself
 * (exactly-once, refund on failure, re-host to R2, one feed row per output) is
 * lib/audio-settle's, shared with the drain-queue cron that finishes runs
 * whose page was closed.
 *
 * Returns { status: 'pending' | 'completed' | 'failed', items?, error? }.
 */
export const maxDuration = 120

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user?.email) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const { requestId } = await req.json().catch(() => ({}))
    if (typeof requestId !== 'string' || !requestId) return jsonPrivate({ error: 'requestId required' }, { status: 400 })

    const row = await prisma.generationQueue.findFirst({ where: { falRequestId: requestId, userId: user.id, modelType: 'audio' } })
    if (!row) return jsonPrivate({ error: 'Not found' }, { status: 404 })

    return jsonPrivate(await settleAudioRun(row, user.email))
  } catch (error) {
    console.error('audio status error:', error)
    return jsonPrivate({ status: 'pending' })
  }
}
