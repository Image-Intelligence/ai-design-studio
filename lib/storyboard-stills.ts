import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { ensureThumbnail, prepareImageVariants, attachImageVariants } from '@/lib/thumbnail'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { fetchMedia } from '@/lib/media-fetch'
import { conformToFrame } from '@/lib/storyboard-image'
import { patchShot } from '@/lib/storyboard-store'
import { finishStudioJob, failStudioJob } from '@/lib/studio-activity'
import { settleHiggsfieldRow, promoteHiggsfieldQueue } from '@/lib/higgsfield'
import { HIGGSFIELD_ENDPOINTS, HF_ENDPOINT_PREFIX, type HiggsfieldModelId } from '@/lib/higgsfield-models'
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
 *
 * Higgsfield's stills (2026-10-22) ride the same slot record and the same
 * settlers, but their job is a GenerationQueue row (stillJob.fal.hfQueueId -
 * see the Higgsfield section below), finished by lib/higgsfield.
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

/**
 * Take a finished job for saving - null if another settler has it, else the
 * claim's stamp (stillJob.savingAt), which failStill / releaseSave match so
 * they only ever act on THIS claim (2026-10-23 billing sweep).
 */
async function claimSave(boardId: number, shotId: string, requestId: string): Promise<number | null> {
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
  return n > 0 ? now : null
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

/*
 * A still given up on, refunded ONCE (2026-10-23 billing sweep). Three
 * settlers look at the same job - the board's GET, the feed's poll and the
 * cron - and each used to refund a stale or failed one: up to three refunds
 * of one charge. Now the slot is flipped making -> failed in one statement,
 * only while it is still THIS job (same request id) and nobody is saving it
 * (no live savingAt - or, from the settler holding the save claim, its own
 * stamp), and only the settler whose statement changed the row refunds.
 */
async function failStill(p: Pending, error: string, claimAt?: number) {
  const job = JSON.stringify({ stillJob: { status: 'failed', at: Date.now(), model: p.job.model, error: error.slice(0, 400) } })
  const n = await (claimAt != null
    ? prisma.$executeRaw`
        UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = (
          SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${p.shotId} THEN t.s || ${job}::jsonb ELSE t.s END ORDER BY t.i)
          FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
        WHERE id = ${p.boardId} AND jsonb_typeof(shots) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(shots) x
            WHERE x->>'id' = ${p.shotId} AND x->'stillJob'->>'status' = 'making'
              AND x->'stillJob'->'fal'->>'requestId' = ${p.job.requestId}
              AND (x->'stillJob'->>'savingAt')::bigint = ${String(claimAt)}::bigint)`
    : prisma.$executeRaw`
        UPDATE "Storyboard" SET "updatedAt" = NOW(), shots = (
          SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${p.shotId} THEN t.s || ${job}::jsonb ELSE t.s END ORDER BY t.i)
          FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
        WHERE id = ${p.boardId} AND jsonb_typeof(shots) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(shots) x
            WHERE x->>'id' = ${p.shotId} AND x->'stillJob'->>'status' = 'making'
              AND x->'stillJob'->'fal'->>'requestId' = ${p.job.requestId}
              AND COALESCE((x->'stillJob'->>'savingAt')::bigint, 0) < ${String(Date.now() - SAVE_CLAIM_MS)}::bigint)`
  ).catch(e => { console.error('[storyboard-stills] fail flip failed:', e); return 0 })
  // Another settler failed (and refunded) it, or it is being saved: nothing more to do
  if (n === 0) return
  try {
    if (p.job.cost > 0) {
      const u = await prisma.user.findUnique({ where: { id: p.userId }, select: { email: true } })
      if (u) await refundGenerationTickets(p.userId, u.email, p.job.cost)
    }
  } catch (e) { console.error('[storyboard-stills] refund failed:', e) }
  await failStudioJob(p.job.track, error)
}

/** Let go of THIS save claim (fetching or storing failed): the next settler tries again. */
async function releaseSave(p: Pending, claimAt: number) {
  await prisma.$executeRaw`
    UPDATE "Storyboard" SET shots = (
      SELECT jsonb_agg(CASE WHEN t.s->>'id' = ${p.shotId} AND (t.s->'stillJob'->>'savingAt')::bigint = ${String(claimAt)}::bigint
        THEN t.s #- '{stillJob,savingAt}' ELSE t.s END ORDER BY t.i)
      FROM jsonb_array_elements(shots) WITH ORDINALITY AS t(s, i))
    WHERE id = ${p.boardId} AND jsonb_typeof(shots) = 'array'`.catch(() => {})
}

/** One still: still at fal (nothing), finished (saved onto its slot), failed or given up (refunded). */
async function settleOne(p: Pending): Promise<'waiting' | 'saved' | 'failed' | 'busy'> {
  if (p.job.hfQueueId) return settleHiggsfieldStill(p, p.job.hfQueueId)
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
  const claimAt = await claimSave(p.boardId, p.shotId, p.job.requestId)
  if (claimAt == null) return 'busy'
  try {
    /*
     * Saved already by an earlier settler whose last step (patchShot) threw
     * (2026-10-23 billing sweep): its row carries this request id - reuse it,
     * never a second row (a second feed picture, a second ticketCost).
     */
    const prior = await prisma.generatedImage.findFirst({
      where: { falRequestId: p.job.requestId, userId: p.userId }, orderBy: { id: 'asc' }, select: { id: true, imageUrl: true },
    })
    if (prior) {
      await finishStudioJob(p.job.track, [prior.id], prior.imageUrl)
      await patchShot(p.boardId, p.shotId, { stillUrl: prior.imageUrl, stillJob: null, ...(p.job.patch ?? {}) },
        { url: prior.imageUrl, prompt: p.job.takePrompt, model: p.job.model, at: Date.now() })
      return 'saved'
    }
    let out: any
    try {
      out = await fal.queue.result(p.job.endpoint, { requestId: p.job.requestId })
    } catch (e: any) {
      // A finished job that answers with an error (refused, invalid) is final
      await failStill(p, `${p.job.model} refused: ${falError(e)}`, claimAt)
      return 'failed'
    }
    const falUrl: string | undefined = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
    if (!falUrl) { await failStill(p, 'The model returned no image', claimAt); return 'failed' }
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
    await releaseSave(p, claimAt)
    return 'busy'
  }
}

// ── Higgsfield's images in the studios (2026-10-22) ─────────────────────────
/*
 * Soul 2, Soul and Marketing Studio Image are not fal models:
 * /api/admin/higgsfield/image-submit charges them (admins free), queues them
 * on Higgsfield's own queue (lib/higgsfield, 20 at once) and lib/higgsfield
 * settles the row into its GeneratedImage - refunding a failure (failRow).
 * The Storyboard and the Image Studio call that route in-process, as the
 * agents do (lib/dedicated-image-submit), so a still or a layer costs and runs
 * exactly as it does on the portal; the caller's session cookie is the
 * route's auth. References go as the account's own https links (the route
 * keeps them canonical and signs them when it sends) - not inlined as
 * dedicated-image-submit does: an account without a verified ID may use its
 * own generations as references, but not pasted pictures.
 *
 * Higgsfield makes the feed row itself (and the route's queue row is the
 * feed's generating tile), so nothing here creates a second one: the studio
 * takes that row - fitted into the frame and filed in the studio's folder.
 */

const HF_POLL_MS = 3_000

export type HfImageCheck = { status: 'completed'; imageId: number; url: string } | { status: 'failed'; error: string } | { status: 'waiting' }

/** Charge and queue one Higgsfield image through its own route. `status` is the route's (402 = not enough tickets). */
export async function submitHiggsfieldImage(o: { model: string; prompt: string; aspect: string; quality: string; refs: string[] }):
  Promise<{ ok: true; queueId: number; ticketCost: number } | { ok: false; status: number; error: string }> {
  try {
    const { POST } = await import('@/app/api/admin/higgsfield/image-submit/route')
    const res = await POST(new NextRequest('http://internal/api/admin/higgsfield/image-submit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: o.model, prompt: o.prompt, aspectRatio: o.aspect, quality: o.quality, referenceImages: o.refs }),
    }))
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    const queueId = Number(data.queueId ?? 0)
    if (!res.ok || data.error || !queueId) return { ok: false, status: res.ok ? 502 : res.status, error: String(data.error || `Higgsfield refused it (${res.status})`).slice(0, 300) }
    return { ok: true, queueId, ticketCost: Number(data.ticketCost ?? 0) }
  } catch (e: any) {
    return { ok: false, status: 502, error: String(e?.message || e).slice(0, 300) }
  }
}

/**
 * One look at a Higgsfield image job: settled here when Higgsfield has
 * finished it (settleHiggsfieldRow - safe beside the cron and the jobs poll),
 * or read from its row when one of them got there first.
 */
export async function checkHiggsfieldImage(queueId: number): Promise<HfImageCheck> {
  const row = await prisma.generationQueue.findUnique({
    where: { id: queueId },
    select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, falRequestId: true, parameters: true, status: true, errorMessage: true, resultImageId: true },
  })
  if (!row) return { status: 'failed', error: 'The Higgsfield job is gone' }
  let ids: number[] = []
  if (row.status === 'processing' && row.falRequestId) {
    const r = await settleHiggsfieldRow(row)
    if (r.status === 'failed') return { status: 'failed', error: r.error }
    if (r.status === 'in_progress') return { status: 'waiting' }
    ids = r.imageIds
  } else if (row.status === 'queued' || row.status === 'processing') {
    // Waiting for a Higgsfield slot (or being sent): the line moves when one frees
    if (row.status === 'queued') await promoteHiggsfieldQueue().catch(() => 0)
    return { status: 'waiting' }
  } else if (row.status === 'completed') {
    const done = (row.parameters ?? {}) as { completedImageIds?: unknown }
    ids = Array.isArray(done.completedImageIds) ? done.completedImageIds.filter((n): n is number => Number.isInteger(n)) : row.resultImageId ? [row.resultImageId] : []
  } else {
    // failed (refunded by lib/higgsfield), or cancelled from the feed
    return { status: 'failed', error: row.errorMessage || 'Generation failed at Higgsfield' }
  }
  const img = ids.length
    ? await prisma.generatedImage.findUnique({ where: { id: ids[0] }, select: { id: true, imageUrl: true } })
    // Saved by a settler that found the rows already there: they carry the request id
    : row.falRequestId ? await prisma.generatedImage.findFirst({ where: { falRequestId: row.falRequestId }, orderBy: { id: 'asc' }, select: { id: true, imageUrl: true } }) : null
  if (!img) return { status: 'failed', error: 'Higgsfield finished but no picture was saved' }
  return { status: 'completed', imageId: img.id, url: img.imageUrl }
}

/** Check a Higgsfield image job until it is done or `until` (epoch ms) passes - then 'waiting'. */
export async function waitHiggsfieldImage(queueId: number, until: number): Promise<HfImageCheck> {
  for (;;) {
    const r = await checkHiggsfieldImage(queueId)
    if (r.status !== 'waiting' || Date.now() + HF_POLL_MS > until) return r
    await new Promise(res => setTimeout(res, HF_POLL_MS))
  }
}

/**
 * A finished Higgsfield picture as a still: fitted into the board's frame as a
 * fal still is (conformToFrame - the fitted copy replaces the picture on the
 * SAME feed row, with fresh thumbnails, never a second row) and filed under
 * My Generations > Storyboards > <board>. Returns the still's link.
 */
export async function adoptHiggsfieldStill(img: { imageId: number; url: string }, o: { userId: number; title: string; conform: string | null; name: string }): Promise<string> {
  let url = img.url
  if (o.conform) {
    const res = await fetchMedia(img.url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`Could not fetch the result (${res.status})`)
    const fitted = await conformToFrame(Buffer.from(await res.arrayBuffer()), o.conform).catch(() => null)
    if (fitted) {
      const buf = Buffer.from(fitted.buf)
      url = await uploadToR2(`${o.name}-${Date.now()}.png`, buf, 'image/png')
      await prisma.generatedImage.update({ where: { id: img.imageId }, data: { imageUrl: url, thumbnailUrl: null, aspectRatio: o.conform } })
      if (!(await attachImageVariants(img.imageId, await prepareImageVariants(buf)))) await ensureThumbnail(img.imageId).catch(() => {})
    }
  }
  await prisma.generatedImage.update({ where: { id: img.imageId }, data: { folderId: await storyboardFolder(o.userId, o.title) } })
  return url
}

/**
 * Send a slot's still to Higgsfield and put the job on the slot, as
 * submitStillJob does for fal. The route charged it (cost 0 on the job:
 * lib/higgsfield refunds a failure, so the settler must not refund again).
 */
export async function submitHiggsfieldStill(
  boardId: number, shotId: string,
  o: { model: string; prompt: string; aspect: string; quality: string; refs: string[] },
  job: Omit<StillFalJob, 'requestId' | 'endpoint' | 'cost' | 'track' | 'hfQueueId'>,
): Promise<{ ok: true; requestId: string; ticketCost: number } | { ok: false; status: number; error: string }> {
  const sub = await submitHiggsfieldImage(o)
  if (!sub.ok) return sub
  const fj: StillFalJob = {
    ...job, cost: 0, track: null, hfQueueId: sub.queueId,
    requestId: `hf-${sub.queueId}`, endpoint: `${HF_ENDPOINT_PREFIX}${HIGGSFIELD_ENDPOINTS[o.model as HiggsfieldModelId] ?? o.model}`,
  }
  await patchShot(boardId, shotId, { stillJob: { status: 'making', at: Date.now(), model: job.model, fal: fj } })
  return { ok: true, requestId: fj.requestId, ticketCost: sub.ticketCost }
}

/** A Higgsfield still: still out (nothing), finished (put on its slot), failed (already refunded by lib/higgsfield). */
async function settleHiggsfieldStill(p: Pending, queueId: number): Promise<'waiting' | 'saved' | 'failed' | 'busy'> {
  const r = await checkHiggsfieldImage(queueId)
  if (r.status === 'waiting') {
    // The slot is given up on - the job itself goes on, and lands in My Generations if it finishes
    if (Date.now() - p.at > STILL_FAL_STALE_MS) { await failStill(p, 'Higgsfield took too long - if it still finishes, the picture lands in My Generations'); return 'failed' }
    return 'waiting'
  }
  if (r.status === 'failed') { await failStill(p, r.error); return 'failed' }
  const claimAt = await claimSave(p.boardId, p.shotId, p.job.requestId)
  if (claimAt == null) return 'busy'
  try {
    const url = await adoptHiggsfieldStill(r, { userId: p.userId, title: p.title, conform: p.job.conform, name: p.job.name })
    await patchShot(p.boardId, p.shotId, { stillUrl: url, stillJob: null, ...(p.job.patch ?? {}) },
      { url, prompt: p.job.takePrompt, model: p.job.model, at: Date.now() })
    return 'saved'
  } catch (e) {
    console.error('[storyboard-stills] Higgsfield save failed (will retry):', e)
    await releaseSave(p, claimAt)
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
