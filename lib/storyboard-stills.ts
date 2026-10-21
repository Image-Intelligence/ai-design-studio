import prisma from '@/lib/prisma'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { ensureThumbnail } from '@/lib/thumbnail'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { conformToFrame } from '@/lib/storyboard-image'
import { patchShot } from '@/lib/storyboard-store'
import { finishStudioJob, failStudioJob } from '@/lib/studio-activity'
import { STILL_FAL_STALE_MS, type StillFalJob } from '@/lib/storyboard'

/*
 * Storyboard stills in the background (2026-10-21, owner: "I ran a bunch of
 * storyboard still generations and then went on a run. When I came back the
 * first three had failed and the rest of them said 'load failed' ... It
 * shouldn't matter if a user refreshes the page at all or goes away").
 *
 * A still used to be one long request from the page (fal.subscribe, up to
 * 300s), and a batch was run by the page three at a time - so a locked iPad
 * dropped the requests in flight and never started the rest. Now the still
 * and still-edit routes charge, submit to fal's queue and answer at once,
 * writing the fal job on the slot (shot.stillJob.fal). Whoever looks next
 * settles it here:
 *   - the board's GET (the page polls it every 5s while a still is out)
 *   - the feed's job poll (/api/admin/my-active-jobs, every 10s)
 *   - the per-minute cron (/api/cron/drain-queue) - no page needed at all
 * A finished job is claimed first (stillJob.savingAt, one statement), so two
 * settlers never save it twice; a failed one is refunded and written on the
 * slot; one still waiting after STILL_FAL_STALE_MS is given up and refunded.
 */

const SAVE_CLAIM_MS = 5 * 60_000

export async function storyboardFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Storyboards', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Storyboards', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled storyboard'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

const falError = (e: any): string => {
  const d = e?.body?.detail
  const msg = Array.isArray(d) ? d.map((x: any) => x?.msg).filter(Boolean).join('; ') : typeof d === 'string' ? d : e?.message
  return String(msg || 'The model failed').slice(0, 300)
}

/** Send one still to fal's queue and put the job on its slot. Throws with fal's reason. */
export async function submitStillJob(boardId: number, shotId: string, endpoint: string, input: Record<string, unknown>, job: Omit<StillFalJob, 'requestId' | 'endpoint'>): Promise<string> {
  const sub = await fal.queue.submit(endpoint, { input })
  const fj: StillFalJob = { ...job, requestId: sub.request_id, endpoint }
  await patchShot(boardId, shotId, { stillJob: { status: 'making', at: Date.now(), model: job.model, fal: fj } })
  return sub.request_id
}

/** Take a finished job for saving - false if another settler has it. */
async function claimSave(boardId: number, shotId: string, requestId: string): Promise<boolean> {
  const now = Date.now()
  const n = await prisma.$executeRaw`
    UPDATE "Storyboard" SET shots = (
      SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${shotId}
        THEN jsonb_set(t.s, '{stillJob,savingAt}', to_jsonb(${now}::bigint)) ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
    WHERE id = ${boardId} AND jsonb_typeof(shots) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(shots) x
        WHERE x->>'id' = ${shotId} AND x->'stillJob'->>'status' = 'making'
          AND x->'stillJob'->'fal'->>'requestId' = ${requestId}
          AND COALESCE((x->'stillJob'->>'savingAt')::bigint, 0) < ${String(now - SAVE_CLAIM_MS)}::bigint)`
  return n > 0
}

type Pending = { boardId: number; userId: number; title: string; shotId: string; at: number; job: StillFalJob }

/** The fal stills out on these boards (raw rows - nothing is rewritten). */
function pendingOf(rows: { id: number; userId: number; title: string; shots: unknown }[]): Pending[] {
  const out: Pending[] = []
  for (const r of rows) for (const s of (Array.isArray(r.shots) ? r.shots as any[] : [])) {
    const j = s?.stillJob
    if (j?.status === 'making' && j.fal?.requestId && j.fal?.endpoint) out.push({ boardId: r.id, userId: r.userId, title: r.title, shotId: String(s.id), at: Number(j.at) || 0, job: j.fal })
  }
  return out
}

async function failStill(p: Pending, error: string) {
  try {
    if (p.job.cost > 0) {
      const u = await prisma.user.findUnique({ where: { id: p.userId }, select: { email: true } })
      if (u) await refundGenerationTickets(p.userId, u.email, p.job.cost)
    }
  } catch (e) { console.error('[storyboard-stills] refund failed:', e) }
  await failStudioJob(p.job.track, error)
  await patchShot(p.boardId, p.shotId, { stillJob: { status: 'failed', at: Date.now(), model: p.job.model, error: error.slice(0, 400) } }).catch(() => {})
}

/** One still: still at fal (nothing), finished (saved onto its slot), failed or given up (refunded). */
async function settleOne(p: Pending): Promise<'waiting' | 'saved' | 'failed' | 'busy'> {
  let status: string
  try {
    status = (await fal.queue.status(p.job.endpoint, { requestId: p.job.requestId, logs: false })).status
  } catch (e: any) {
    // fal does not know it (or will not say): given up once it is old enough
    if (Date.now() - p.at > STILL_FAL_STALE_MS) { await failStill(p, 'The model never answered - nothing was charged'); return 'failed' }
    return 'waiting'
  }
  if (status !== 'COMPLETED') {
    if (Date.now() - p.at > STILL_FAL_STALE_MS) { await failStill(p, 'The model took too long - nothing was charged'); return 'failed' }
    return 'waiting'
  }
  if (!(await claimSave(p.boardId, p.shotId, p.job.requestId))) return 'busy'
  try {
    let out: any
    try {
      out = await fal.queue.result(p.job.endpoint, { requestId: p.job.requestId })
    } catch (e: any) {
      // A finished job that answers with an error (refused, invalid) is final
      await failStill(p, `${p.job.model} refused: ${falError(e)}`)
      return 'failed'
    }
    const falUrl: string | undefined = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
    if (!falUrl) { await failStill(p, 'The model returned no image'); return 'failed' }
    const res = await fetch(falUrl, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`Could not fetch the result (${res.status})`)
    let buf = Buffer.from(await res.arrayBuffer())
    let ct = res.headers.get('content-type') ?? 'image/png'
    // Not in the board's frame (the model followed a reference's shape): fit it
    if (p.job.conform) {
      const fitted = await conformToFrame(buf, p.job.conform).catch(() => null)
      if (fitted) { buf = Buffer.from(fitted.buf); ct = 'image/png' }
    }
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadToR2(`${p.job.name}-${Date.now()}.${ext}`, buf, ct)
    const row = await prisma.generatedImage.create({
      data: {
        userId: p.userId, prompt: p.job.prompt, imageUrl: url, model: p.job.model, ticketCost: p.job.cost, referenceImageUrls: p.job.refs,
        folderId: await storyboardFolder(p.userId, p.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        ...(p.job.quality ? { quality: p.job.quality } : {}), aspectRatio: p.job.aspect,
        falRequestId: p.job.requestId,
      },
    })
    await ensureThumbnail(row.id).catch(() => {})
    await finishStudioJob(p.job.track, [row.id], url)
    await patchShot(p.boardId, p.shotId, { stillUrl: url, stillJob: null, ...(p.job.patch ?? {}) },
      { url, prompt: p.job.takePrompt, model: p.job.model, at: Date.now() })
    return 'saved'
  } catch (e) {
    // Fetching or storing it failed: let go of the claim, the next settler tries again
    console.error('[storyboard-stills] save failed (will retry):', e)
    await prisma.$executeRaw`
      UPDATE "Storyboard" SET shots = (
        SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${p.shotId} THEN t.s #- '{stillJob,savingAt}' ELSE t.s END ORDER BY t.i)
        FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
      WHERE id = ${p.boardId} AND jsonb_typeof(shots) = 'array'`.catch(() => {})
    return 'busy'
  }
}

/** Settle what is out on these stills, a few at a time, within `budgetMs`. */
async function settle(pending: Pending[], budgetMs: number): Promise<number> {
  const t0 = Date.now()
  let saved = 0, i = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < pending.length && Date.now() - t0 < budgetMs) {
      const r = await settleOne(pending[i++]).catch(e => { console.error('[storyboard-stills] settle error:', e); return 'busy' as const })
      if (r === 'saved' || r === 'failed') saved++
    }
  }))
  return saved
}

/** One board's stills (its GET). Returns how many changed. */
export async function settleBoardStills(boardId: number, budgetMs = 20_000): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: number; userId: number; title: string; shots: unknown }[]>`
    SELECT id, "userId", title, shots FROM "Storyboard" WHERE id = ${boardId} AND shots::text LIKE '%"requestId"%'`
  const p = pendingOf(rows)
  return p.length ? settle(p, budgetMs) : 0
}

/** Every board with a still out at fal (the cron), or one account's (the feed's poll). */
export async function settlePendingStills(o: { userId?: number; limit?: number; budgetMs?: number } = {}): Promise<number> {
  const rows = o.userId
    ? await prisma.$queryRaw<{ id: number; userId: number; title: string; shots: unknown }[]>`
        SELECT id, "userId", title, shots FROM "Storyboard" WHERE "userId" = ${o.userId} AND shots::text LIKE '%"requestId"%' ORDER BY "updatedAt" DESC LIMIT ${o.limit ?? 10}`
    : await prisma.$queryRaw<{ id: number; userId: number; title: string; shots: unknown }[]>`
        SELECT id, "userId", title, shots FROM "Storyboard" WHERE shots::text LIKE '%"requestId"%' ORDER BY "updatedAt" DESC LIMIT ${o.limit ?? 20}`
  const p = pendingOf(rows)
  return p.length ? settle(p, o.budgetMs ?? 30_000) : 0
}
