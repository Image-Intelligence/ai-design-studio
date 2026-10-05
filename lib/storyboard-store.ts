/**
 * Storyboard Studio - writing a board's shots without losing anyone's work.
 *
 * A board's shots are one JSON array, written by several hands at once: the
 * page's autosave, the still route (a still landing), the shoot route (a clip
 * landing). A plain read-then-write by one of them could put back the array
 * it read a moment earlier and drop what another wrote in between - a still
 * that just finished, a clip, a "making" marker.
 *
 * So: the read-modify-write paths take the row lock (withShotsLock), and the
 * still route's small changes are single UPDATE statements that change one
 * shot inside the array (patchShot / claimStill / queueStills) - Postgres
 * runs each atomically, queued behind any lock.
 *
 * SERVER ONLY.
 */
import prisma from '@/lib/prisma'
import { sanitizeShots, STILL_JOB_STALE_MS, type StoryboardShot, type StillVersion, type StillJob } from '@/lib/storyboard'

/**
 * Read the shots under the row's lock, let `fn` work out the new array (and
 * any other columns), and write it - nobody else writes the row meanwhile.
 * `fn` returning null writes nothing.
 */
export async function withShotsLock(
  boardId: number,
  fn: (shots: StoryboardShot[]) => { shots: StoryboardShot[]; data?: Record<string, unknown> } | null,
): Promise<StoryboardShot[] | null> {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ shots: unknown }[]>`SELECT shots FROM "Storyboard" WHERE id = ${boardId} FOR UPDATE`
    if (!rows.length) return null
    const next = fn(sanitizeShots(rows[0].shots))
    if (!next) return null
    await tx.storyboard.update({ where: { id: boardId }, data: { ...(next.data ?? {}), shots: next.shots as object[] } })
    return next.shots
  })
}

/**
 * Merge `patch` into one shot (top-level keys), and optionally add a still
 * take to its list - one statement, so it cannot undo anything else.
 */
export async function patchShot(boardId: number, shotId: string, patch: Record<string, unknown>, take?: StillVersion): Promise<void> {
  const p = JSON.stringify(patch)
  if (take) {
    await prisma.$executeRaw`
      UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = COALESCE((
        SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${shotId}
          THEN t.s || ${p}::jsonb || jsonb_build_object('stills', COALESCE(t.s->'stills', '[]'::jsonb) || ${JSON.stringify([take])}::jsonb)
          ELSE t.s END ORDER BY t.i)
        FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i)), '[]'::jsonb)
      WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'`
    return
  }
  await prisma.$executeRaw`
    UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = COALESCE((
      SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${shotId} THEN t.s || ${p}::jsonb ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i)), '[]'::jsonb)
    WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'`
}

/**
 * Mark a shot's still as being made - only if no live "making" is on it
 * already. False = another request (this tab, another tab, another device)
 * is making it right now, so this one must not (it would be paid twice).
 */
export async function claimStill(boardId: number, shotId: string, model: string): Promise<boolean> {
  const now = Date.now()
  const job: StillJob = { status: 'making', at: now, model }
  const n = await prisma.$executeRaw`
    UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = (
      SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${shotId} THEN t.s || ${JSON.stringify({ stillJob: job })}::jsonb ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
    WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(shots) x
        WHERE x->>'id' = ${shotId} AND x->'stillJob'->>'status' = 'making'
          AND COALESCE((x->'stillJob'->>'at')::bigint, 0) > ${String(now - STILL_JOB_STALE_MS)}::bigint)`
  return n > 0
}

/** Mark shots as queued for a batch (any already being made are left alone). */
export async function queueStills(boardId: number, shotIds: string[], model?: string): Promise<void> {
  if (!shotIds.length) return
  const job = JSON.stringify({ stillJob: { status: 'queued', at: Date.now(), ...(model ? { model } : {}) } })
  const live = String(Date.now() - STILL_JOB_STALE_MS)
  await prisma.$executeRaw`
    UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = (
      SELECT jsonb_agg(CASE
        WHEN t.s->>'id' = ANY(${shotIds}::text[])
          AND NOT (t.s->'stillJob'->>'status' = 'making' AND COALESCE((t.s->'stillJob'->>'at')::bigint, 0) > ${live}::bigint)
        THEN t.s || ${job}::jsonb ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
    WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'`
}
