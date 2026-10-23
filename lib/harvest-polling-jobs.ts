import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { releaseQueueSlot, holdsFalSlot } from '@/lib/admin-queue-helpers'
import { FAL_GLOBAL_ID, releaseFalSlot, promoteNextQueuedJob } from '@/lib/fal-queue'
import { checkIsAdmin } from '@/lib/admin-check'
import { ensureThumbnail, prepareImageVariants, attachImageVariants, type ImageVariants } from '@/lib/thumbnail'
import { LAYERIZE_MODELS, saveLayerizeResult, type FalLayer } from '@/lib/layerize-save'

/**
 * Finish image generations whose PAGE is gone - on the server.
 *
 * NanoBanana Pro 2, GPT Image 2, Kling V3 / O3, Wan 2.7 Pro and the Wan 2.2
 * LoRA run as fal queue jobs the page polls: when fal finishes, the page's
 * poller calls the model's status route, which downloads the picture,
 * re-hosts it on R2 and saves it. Refresh, close the tab, or let an iPad
 * sleep, and nothing asked - the cron rescued such a job only after TWELVE
 * minutes, and on localhost (no cron) never. The owner hit exactly that
 * (2026-10-06): finished jobs sitting on "generating…" for 500+ seconds.
 *
 * Now the server finishes them itself, two ways:
 *   - the cron, every minute (all accounts)
 *   - the page's own jobs poll, on load and every few seconds (that account)
 * so a generation completes whether or not any page is open, and is in the
 * feed when its owner comes back.
 *
 * Never racing a live page: a job seen finished at fal is only MARKED the
 * first time (parameters.harvestSeenAt) and collected on a later pass,
 * `graceMs` on - a page that is still polling collects it within seconds, so
 * by then it is done and the row settled. And the save itself takes the same
 * transaction lock as /api/admin/nb2-status and re-checks for rows inside it,
 * so two writers can never save one job twice.
 */

type PollParams = {
  usePolling?: boolean
  falEndpoint?: string
  falInput?: { aspect_ratio?: string; resolution?: string; output_format?: string }
  permanentReferenceUrls?: string[]
  harvestSeenAt?: number
  [k: string]: unknown
}

export type HarvestResult = { harvested: number; failed: number; marked: number }

/* ──────────────────────────────────────────────────────────────────────────
 * SHARED WITH THE PAGE'S STATUS ROUTES (2026-10-23 billing sweep).
 *
 * The six polled-image status routes (/api/admin/nb2-status, kling-image-,
 * kling-o3-, gpt-image-2-, wan-27-pro-, wan-22-t2i-lora-status) and the
 * harvester below are all writers of the same job. Before this sweep only
 * nb2-status and the harvester took the save lock; the other five did
 * "look for rows, download for seconds, insert" with nothing in between, so
 * two tabs, a restored poller or the harvester each inserted - duplicate
 * tiles. And none of them looked at what releaseQueueSlot said: a poll whose
 * download failed flipped the row to failed and REFUNDED it while another
 * poll went on to save the picture - delivered and refunded.
 *
 * Now every writer goes through savePolledImagesOnce: one advisory lock per
 * request id, a re-check for rows under it, and the queue row's status as the
 * single arbiter - the save flips processing -> completed in the SAME
 * transaction as the inserts, so a racing refund (releaseQueueSlot(true),
 * the cron's stale pass, the jobs poll's sweep - all status-guarded) either
 * lands first, and the save refuses, or finds the row completed and does
 * nothing. Never both.
 * ────────────────────────────────────────────────────────────────────────── */

/** The advisory-lock key every writer of a polled job's pictures takes (unchanged since nb2-status introduced it) */
export function polledSaveLockKey(requestId: string): string {
  return 'nb2-save-' + requestId
}

export type PolledJobRow = {
  id: number
  userId: number
  modelId: string
  status: string
  ticketCost: number
  createdAt: Date
  startedAt: Date | null
  errorMessage: string | null
  parameters: unknown
}

export type PolledJobAccess =
  | { ok: true; falEndpoint: string; row: PolledJobRow | null }
  | { ok: false; status: number; error: string }

/**
 * Who may poll a job, and at which fal endpoint.
 *
 * The status routes used to trust the request body entirely - nb2-status did
 * not even need a session - so anyone holding a request id could have it
 * fetched and saved, against whatever endpoint they named. The queue row is
 * the truth: it must belong to the signed-in account (admins may poll any),
 * and its stored parameters.falEndpoint is the one fal is asked. The client's
 * endpoint is only a fallback for an admin's job that has no queue row at all
 * (out-of-band runs) or an old row that never stored one.
 */
export async function authorizePolledJob(
  requestId: string,
  user: { id: number; email: string } | null | undefined,
  clientEndpoint?: unknown,
): Promise<PolledJobAccess> {
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' }
  const row = await prisma.generationQueue.findFirst({
    where: { falRequestId: requestId },
    orderBy: { id: 'desc' },
    select: { id: true, userId: true, modelId: true, status: true, ticketCost: true, createdAt: true, startedAt: true, errorMessage: true, parameters: true },
  })
  const mine = !!row && row.userId === user.id
  if (!mine && !(await checkIsAdmin(user.email))) {
    // Same answer for "someone else's" and "no such job": request ids are not an oracle
    return { ok: false, status: 404, error: 'Generation not found' }
  }
  const stored = ((row?.parameters ?? {}) as PollParams).falEndpoint
  const fallback = typeof clientEndpoint === 'string' ? clientEndpoint : ''
  const falEndpoint = typeof stored === 'string' && stored ? stored : fallback
  if (!falEndpoint) return { ok: false, status: 400, error: 'Unknown fal endpoint for this generation' }
  return { ok: true, falEndpoint, row }
}

/** Rows already saved for a request id, in save order */
export async function existingPolledImages(requestId: string): Promise<{ id: number; imageUrl: string }[]> {
  return prisma.generatedImage.findMany({
    where: { falRequestId: requestId },
    select: { id: true, imageUrl: true },
    orderBy: { id: 'asc' },
  })
}

export type PolledSaveResult =
  | { saved: true; fresh: boolean; images: { id: number; imageUrl: string }[] }
  | { saved: false; error: string }

/**
 * Save a polled job's pictures exactly once, and never for a job that was
 * already failed (and so refunded).
 *
 *   - lock on polledSaveLockKey(requestId) - the key nb2-status always used
 *   - rows already there: return them (fresh: false) - the caller's own
 *     re-hosted copies are simply not used
 *   - queue row failed / cancelled: save nothing (saved: false) - its tickets
 *     went back, so delivering now would be free
 *   - queue row processing: flip it to completed inside this transaction,
 *     then insert; the slot half of releaseQueueSlot (counter + promotion)
 *     runs after the commit
 *
 * A job with no queue row at all (an admin's out-of-band run) still saves.
 */
export async function savePolledImagesOnce(
  requestId: string,
  rows: Omit<Prisma.GeneratedImageUncheckedCreateInput, 'falRequestId'>[],
): Promise<PolledSaveResult> {
  type TxOut =
    | { saved: true; fresh: boolean; images: { id: number; imageUrl: string }[]; settledHere: boolean; heldSlot?: boolean }
    | { saved: false; error: string }
  const out: TxOut = await prisma.$transaction(async (tx): Promise<TxOut> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${polledSaveLockKey(requestId)}))`
    const already = await tx.generatedImage.findMany({
      where: { falRequestId: requestId },
      select: { id: true, imageUrl: true },
      orderBy: { id: 'asc' },
    })
    if (already.length > 0) return { saved: true, fresh: false, images: already, settledHere: false }

    const job = await tx.generationQueue.findFirst({
      where: { falRequestId: requestId },
      orderBy: { id: 'desc' },
      select: { id: true, status: true, errorMessage: true, modelId: true, parameters: true },
    })
    let settledHere = false
    if (job) {
      let status = job.status
      let errorMessage = job.errorMessage
      if (status === 'processing') {
        const flip = await tx.generationQueue.updateMany({
          where: { id: job.id, status: 'processing' },
          data: { status: 'completed', completedAt: new Date() },
        })
        settledHere = flip.count > 0
        if (!settledHere) {
          // Someone settled it between the read and the flip - see how
          const now = await tx.generationQueue.findUnique({ where: { id: job.id }, select: { status: true, errorMessage: true } })
          status = now?.status ?? status
          errorMessage = now?.errorMessage ?? errorMessage
        }
      }
      if (status === 'failed' || status === 'cancelled') {
        return { saved: false, error: errorMessage || (status === 'cancelled' ? 'Generation was cancelled' : 'Generation failed') }
      }
    }

    // One at a time so images[k] lines up with rows[k] (the caller's variants)
    const images: { id: number; imageUrl: string }[] = []
    for (const data of rows) {
      images.push(await tx.generatedImage.create({ data: { ...data, falRequestId: requestId }, select: { id: true, imageUrl: true } }))
    }
    if (job && images.length > 0) {
      await tx.generationQueue.update({ where: { id: job.id }, data: { resultUrl: images[0].imageUrl, resultImageId: images[0].id } })
    }
    // Only a row that took a fal slot gives one back (the GPT Image 2 stream never took one)
    return { saved: true, fresh: true, images, settledHere, heldSlot: !!job && holdsFalSlot(job) }
  // Accelerate refuses interactive transactions over 15s (P6005) - every save failed at 20s
  }, { timeout: 14_000, maxWait: 5_000 })

  if (!out.saved) return out
  if (out.settledHere) {
    // The status half of releaseQueueSlot ran inside the transaction; this is
    // its slot half - give the concurrency slot back and start the next job.
    try {
      if (out.heldSlot) await releaseFalSlot(FAL_GLOBAL_ID)
      await promoteNextQueuedJob()
    } catch (e) {
      console.error(`[polled-save] slot release after ${requestId} failed:`, e)
    }
  } else {
    // Rows existed already, or there was no processing row: the slot may still
    // be held if an earlier writer died mid-flight (status-guarded, so a no-op otherwise)
    await releaseQueueSlot(requestId, false)
  }
  return { saved: true, fresh: out.fresh, images: out.images }
}

export type PolledFailResult =
  | { status: 'failed'; error: string }
  | { status: 'completed'; images: { url: string; dbId: number }[] }

/**
 * Fail a polled job (refunding it), unless another writer already finished
 * it. releaseQueueSlot is status-guarded, so its false means someone settled
 * the row first - if that someone saved the pictures, the honest answer to
 * this poll is "completed", not "failed".
 */
export async function failPolledJob(requestId: string, error: string): Promise<PolledFailResult> {
  const flipped = await releaseQueueSlot(requestId, true, error)
  if (!flipped) {
    const saved = await existingPolledImages(requestId).catch(() => [])
    if (saved.length > 0) return { status: 'completed', images: saved.map(img => ({ url: img.imageUrl, dbId: img.id })) }
  }
  return { status: 'failed', error }
}

/**
 * Is this error fal saying the job is GONE (404 / 410 from its queue API)?
 *
 * The routes used to also match /not.found|expired/ in ANY error's message -
 * which a Prisma "record not found" or a network error satisfies - and fail +
 * refund on it. Only fal's own status code counts now, and not in the first
 * two minutes of a job, when its queue can briefly not know a fresh request.
 */
export function pollErrorIsGone(error: unknown, row: PolledJobRow | null): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (status !== 404 && status !== 410) return false
  const since = row?.startedAt ?? row?.createdAt
  return !since || Date.now() - since.getTime() > 2 * 60_000
}

/** A job this old whose pictures still cannot be re-hosted is given up (fal purges results after about an hour) */
export function polledJobIsStale(row: PolledJobRow | null): boolean {
  const since = row?.startedAt ?? row?.createdAt
  return !!since && Date.now() - since.getTime() > 2 * 3600_000
}

export async function harvestPollingJobs(opts: {
  /** only this account's jobs (the page's poll); all accounts when absent (the cron) */
  userId?: number
  /** a job must have been running at least this long before fal is even asked */
  minAgeMs?: number
  /** after being SEEN finished, wait this long for a live page to collect it */
  graceMs?: number
  /** at most this many collected per call (each is a download + upload) */
  limit?: number
  /** stop starting new work after this long */
  budgetMs?: number
} = {}): Promise<HarvestResult> {
  const { userId, minAgeMs = 30_000, graceMs = 45_000, limit = 6, budgetMs = 40_000 } = opts
  const t0 = Date.now()
  const out: HarvestResult = { harvested: 0, failed: 0, marked: 0 }
  if (!process.env.FAL_KEY) return out

  const rows = await prisma.generationQueue.findMany({
    where: {
      status: 'processing',
      modelType: 'image',
      falRequestId: { not: null },
      startedAt: { lt: new Date(Date.now() - minAgeMs) },
      ...(userId ? { userId } : {}),
    },
    select: { id: true, userId: true, modelId: true, prompt: true, ticketCost: true, createdAt: true, startedAt: true, falRequestId: true, parameters: true },
    // Newest first: fresh results are the ones fal still has
    orderBy: { startedAt: 'desc' },
    take: 30,
  })

  for (const j of rows) {
    if (out.harvested + out.failed >= limit || Date.now() - t0 > budgetMs) break
    const params = (j.parameters ?? {}) as PollParams
    const rid = j.falRequestId!
    if (!params.usePolling || !params.falEndpoint) continue
    try {
      // Saved already (a page got there first) - just settle the row
      if (await prisma.generatedImage.count({ where: { falRequestId: rid } }) > 0) {
        await releaseQueueSlot(rid, false)
        out.harvested++
        continue
      }
      // fal's queue lives under owner/app - sub-paths like /edit 405
      const baseApp = params.falEndpoint.split('/').slice(0, 2).join('/')
      const st = await fetch(`https://queue.fal.run/${baseApp}/requests/${rid}/status`, {
        headers: { Authorization: `Key ${process.env.FAL_KEY}` }, signal: AbortSignal.timeout(8000),
      })
      if (!st.ok) continue // still unknown: the cron's stale pass decides about dead jobs
      const status = ((await st.json()) as { status?: string }).status
      if (status !== 'COMPLETED') continue

      // First sighting: mark, and give a live page the grace period to collect it
      const seen = typeof params.harvestSeenAt === 'number' ? params.harvestSeenAt : 0
      if (!seen) {
        await prisma.generationQueue.update({ where: { id: j.id }, data: { parameters: { ...params, harvestSeenAt: Date.now() } as object } }).catch(() => {})
        out.marked++
        continue
      }
      if (Date.now() - seen < graceMs) continue

      const res = await fetch(`https://queue.fal.run/${baseApp}/requests/${rid}`, {
        headers: { Authorization: `Key ${process.env.FAL_KEY}` }, signal: AbortSignal.timeout(15000),
      })
      if (res.status === 422) {
        // Finished WITHOUT usable output (content filter / refusal) - permanent: fail + refund
        await releaseQueueSlot(rid, true, 'The model did not generate the expected output — content may have been filtered')
        out.failed++
        continue
      }
      if (res.status === 404 || res.status === 410) {
        await releaseQueueSlot(rid, true, 'Generation result expired before it could be saved')
        out.failed++
        continue
      }
      if (!res.ok) {
        // 5xx is usually transient - but fal purges results after about an hour, after
        // which this 500/504s for good. Settle a row that old instead of retrying forever.
        if (Date.now() - (j.startedAt?.getTime() ?? j.createdAt.getTime()) > 2 * 3600_000) {
          await releaseQueueSlot(rid, true, 'Generation result expired before it could be saved')
          out.failed++
        }
        continue
      }
      const data = await res.json() as { images?: { url: string }[]; layers?: FalLayer[] }

      // SeeDream Layerize: one card holding every layer (lib/layerize-save)
      if (LAYERIZE_MODELS.has(j.modelId) && Array.isArray(data?.layers) && data.layers.length > 0) {
        const saved = await saveLayerizeResult({
          userId: j.userId, prompt: j.prompt || '', modelId: j.modelId, falRequestId: rid,
          createdAt: j.createdAt, ticketCost: j.ticketCost,
          referenceImageUrls: Array.isArray(params.permanentReferenceUrls) ? params.permanentReferenceUrls : [],
          layers: data.layers,
        }).catch(() => null)
        if (saved) {
          await prisma.generationQueue.update({ where: { id: j.id }, data: { resultUrl: saved.url, resultImageId: saved.id } }).catch(() => {})
          await releaseQueueSlot(rid, false)
          out.harvested++
        }
        continue
      }

      const falImages = Array.isArray(data?.images) ? data.images : []
      if (falImages.length === 0) {
        await releaseQueueSlot(rid, true, 'The model did not generate the expected output — content may have been filtered')
        out.failed++
        continue
      }
      // Download and re-host first (slow, no lock held), then save under the lock
      const format = params.falInput?.output_format || 'png'
      const ext = format === 'jpeg' ? 'jpg' : format
      const hosted: string[] = []
      const variants: (ImageVariants | null)[] = []
      for (let i = 0; i < falImages.length; i++) {
        try {
          const imgRes = await fetch(falImages[i].url, { signal: AbortSignal.timeout(45000) })
          if (!imgRes.ok) continue
          const buffer = Buffer.from(await imgRes.arrayBuffer())
          const [url, v] = await Promise.all([
            uploadToR2(`nb2-${Date.now()}-${i}.${ext}`, buffer, `image/${format === 'jpeg' ? 'jpeg' : format}`),
            prepareImageVariants(buffer),
          ])
          hosted.push(url); variants.push(v)
        } catch (e) {
          console.error(`[harvest] image ${i} of ${rid} failed:`, e)
        }
      }
      if (!hosted.length) continue // R2 / network hiccup: the next pass retries

      // The pages' status routes save through the same helper: one lock, one
      // writer, and nothing saved for a job already failed and refunded
      // (2026-10-23 billing sweep - see savePolledImagesOnce above). It also
      // settles the queue row and sets resultUrl / resultImageId.
      const rowsSaved = await savePolledImagesOnce(rid, hosted.map(url => ({
        userId: j.userId,
        prompt: j.prompt || '',
        imageUrl: url,
        model: j.modelId,
        ticketCost: j.ticketCost,
        quality: params.falInput?.resolution || 'auto',
        aspectRatio: params.falInput?.aspect_ratio || 'auto',
        referenceImageUrls: Array.isArray(params.permanentReferenceUrls) ? params.permanentReferenceUrls : [],
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        createdAt: j.createdAt, // queue time - the feed's ordering key
      })))
      if (!rowsSaved.saved) {
        console.log(`[harvest] job #${j.id} (${rid}) was failed and refunded meanwhile - not saving`)
        continue
      }
      // Thumbnail + display copy on the rows before the job reads as done (lib/thumbnail)
      if (rowsSaved.fresh) await Promise.all(rowsSaved.images.map(async (img, k) => {
        if (!(await attachImageVariants(img.id, variants[k] ?? null))) await ensureThumbnail(img.id).catch(() => {})
      }))
      out.harvested++
      console.log(`[harvest] saved ${hosted.length} image(s) for ${j.modelId} job #${j.id} (no page was collecting it)`)
    } catch (e) {
      console.error(`[harvest] job #${j.id} (${rid}) failed:`, e)
    }
  }
  return out
}
