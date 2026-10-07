import prisma from '@/lib/prisma'
import { uploadToR2 } from '@/lib/r2'
import { releaseQueueSlot } from '@/lib/admin-queue-helpers'
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

      const rowsSaved = await prisma.$transaction(async tx => {
        // The same lock /api/admin/nb2-status takes: one writer per request id
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'nb2-save-' + rid}))`
        const already = await tx.generatedImage.findMany({ where: { falRequestId: rid }, select: { id: true } })
        if (already.length) return { ids: already.map(r => r.id), fresh: false }
        const made = await Promise.all(hosted.map(url => tx.generatedImage.create({
          data: {
            userId: j.userId,
            prompt: j.prompt || '',
            imageUrl: url,
            model: j.modelId,
            ticketCost: j.ticketCost,
            quality: params.falInput?.resolution || 'auto',
            aspectRatio: params.falInput?.aspect_ratio || 'auto',
            referenceImageUrls: Array.isArray(params.permanentReferenceUrls) ? params.permanentReferenceUrls : [],
            expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
            falRequestId: rid,
            createdAt: j.createdAt, // queue time - the feed's ordering key
          },
          select: { id: true },
        })))
        return { ids: made.map(r => r.id), fresh: true }
      })
      // Thumbnail + display copy on the rows before the job reads as done (lib/thumbnail)
      if (rowsSaved.fresh) await Promise.all(rowsSaved.ids.map(async (id, k) => {
        if (!(await attachImageVariants(id, variants[k] ?? null))) await ensureThumbnail(id).catch(() => {})
      }))
      await prisma.generationQueue.update({ where: { id: j.id }, data: { resultUrl: hosted[0], resultImageId: rowsSaved.ids[0] } }).catch(() => {})
      await releaseQueueSlot(rid, false)
      out.harvested++
      console.log(`[harvest] saved ${hosted.length} image(s) for ${j.modelId} job #${j.id} (no page was collecting it)`)
    } catch (e) {
      console.error(`[harvest] job #${j.id} (${rid}) failed:`, e)
    }
  }
  return out
}
