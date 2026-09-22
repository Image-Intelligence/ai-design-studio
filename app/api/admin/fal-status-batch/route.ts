import { fal } from '@/lib/fal-client'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jsonPrivate } from '@/lib/api-json'

fal.config({ credentials: process.env.FAL_KEY! })

/**
 * Where do these jobs stand — all of them, in one request.
 *
 * The per-job status routes do real work on completion: download the result,
 * re-host it, write the row. That is the right place for that work, and the
 * wrong thing to call every few seconds for a hundred and sixty-five jobs
 * that are still running. So the client asks THIS first. It answers only the
 * cheap question, for every request id at once, and the client calls the
 * heavy route only for the ones that have actually finished.
 *
 * Nothing here writes anything, so it is safe to call as often as the
 * client likes; the cost is one fal status call per job, ten at a time.
 */
export const maxDuration = 30

type Status = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'ERROR' | 'NOT_FOUND' | 'UNKNOWN'

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const items: { requestId: string; falEndpoint: string }[] = Array.isArray(body?.items)
      ? body.items.filter((it: any) => typeof it?.requestId === 'string' && typeof it?.falEndpoint === 'string').slice(0, 300)
      : []
    if (items.length === 0) return jsonPrivate({ statuses: {} })

    const statuses: Record<string, Status> = {}
    const CONCURRENCY = 10
    let next = 0
    const worker = async () => {
      while (next < items.length) {
        const it = items[next++]
        try {
          const s = await fal.queue.status(it.falEndpoint, { requestId: it.requestId, logs: false })
          const raw = String((s as any)?.status ?? 'UNKNOWN')
          statuses[it.requestId] = (['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(raw) ? raw : 'ERROR') as Status
        } catch (e: any) {
          // A job fal no longer knows is terminal too - the per-job route
          // turns that into a failed tile with the right message.
          statuses[it.requestId] = (e?.status === 404 || /not.found|expired/i.test(e?.message ?? '')) ? 'NOT_FOUND' : 'UNKNOWN'
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
    return jsonPrivate({ statuses }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return jsonPrivate({ error: e?.message ?? 'batch status failed' }, { status: 500 })
  }
}
