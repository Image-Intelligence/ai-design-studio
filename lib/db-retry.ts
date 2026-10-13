import prisma from '@/lib/prisma'

/*
 * Momentary database drops (2026-10-12).
 *
 * Under a burst - six portal tiles at once, a Refs grid asking for sixty
 * thumbnails - Prisma Accelerate now and then answers "Can't reach database
 * server" for a moment. A second try a few hundred ms later goes through.
 * Only connection-level failures are retried; a real error (a constraint, a
 * bad query) is thrown at once.
 */
export const isTransientDbError = (e: any) =>
  /Can't reach database server|P1001|P1002|P1017|P5000|P6000|P6004|ECONNRESET|ETIMEDOUT|socket hang up/i
    .test(`${e?.code ?? ''} ${e?.message ?? ''}`)

export async function withDbRetry<T>(fn: () => Promise<T>, tries = 3, label = 'db'): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= tries || !isTransientDbError(e)) throw e
      console.warn(`[${label}] transient DB error, retry ${i}/${tries - 1}:`, (e as any)?.message?.split('\n').filter(Boolean).pop())
      await new Promise(r => setTimeout(r, 400 * i))
    }
  }
}

/**
 * +1 on a model's and the global fal slot counters, after fal has ACCEPTED the
 * job - never fails the request (a missed increment is re-synced from the
 * processing rows by syncAndClaimFalSlot).
 */
export async function bumpActiveCounters(model: string, globalId: string) {
  await Promise.all([model, globalId].map(id =>
    withDbRetry(() => prisma.modelConcurrencyLimit.updateMany({ where: { modelId: id }, data: { currentActive: { increment: 1 } } }), 3, 'generate')
      .catch(e => console.error(`[generate] concurrency counter +1 skipped for ${id} (job already submitted):`, e?.message ?? e)),
  ))
}
