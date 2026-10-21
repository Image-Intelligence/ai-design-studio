import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { uploadToR2, userKey } from '@/lib/r2'
import { prepareImageVariants, attachImageVariants, ensureThumbnail, type ImageVariants } from '@/lib/thumbnail'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { HIGGSFIELD_VIDEO_MODELS, HIGGSFIELD_MODEL_IDS } from '@/lib/higgsfield-models'
import { signPayload } from '@/lib/media-url'

/**
 * The Higgsfield API, server side (2026-10-13 - admin-only exclusive models;
 * the catalogue and prices are lib/higgsfield-models).
 *
 * Credentials: HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET (.env.local and
 * Vercel), sent as `Authorization: Key <id>:<secret>`. Never to the browser.
 *
 * A job is a GenerationQueue row like any other - status 'processing', the
 * Higgsfield request id in falRequestId (the column every poller keys on),
 * and parameters.provider = 'higgsfield' with the endpoint (hfEndpoint).
 * There is deliberately NO `falEndpoint` / `usePolling` on it: everything that
 * asks fal about a row (the image harvester, the cron's stale check and video
 * settle, the jobs route's dead-job check) needs those, so it leaves these
 * alone - and settleHiggsfieldRow below finishes them instead, from the page's
 * jobs poll, the portal's video poller and the cron. Outputs are kept on R2
 * (Higgsfield keeps them only 7 days) and saved as GeneratedImage rows.
 *
 * ITS OWN QUEUE (2026-10-13): Higgsfield allows HIGGSFIELD_MAX_CONCURRENT
 * jobs at once (20 on the current plan; fal's 40 is separate). A job that
 * finds them all busy waits as 'queued' and is sent, oldest first, the moment
 * one finishes (settle -> promoteHiggsfieldQueue), or by the jobs poll / the
 * cron. Slots are counted from the rows themselves under an advisory lock, so
 * two submits can never both take the last one - no counter to drift.
 */

const API = 'https://api.higgsfield.ai'

export const higgsfieldConfigured = () => !!(process.env.HIGGSFIELD_KEY_ID && process.env.HIGGSFIELD_KEY_SECRET)
/** Jobs Higgsfield runs at once on this account's plan (env HIGGSFIELD_MAX_CONCURRENT, default 20). */
export const higgsfieldMaxConcurrent = () => Math.max(1, parseInt(process.env.HIGGSFIELD_MAX_CONCURRENT || '20') || 20)
// Higgsfield fetches our references from signed links: long enough for a queue wait too
const HF_LINK_TTL = 6 * 3600
const SLOT_LOCK = 'higgsfield-slots'
// The console's copy button gives the whole "<key id>:<secret>" pair - pasted
// into the SECRET it is the credential already; a bare secret is joined to the id
const auth = () => {
  const sec = process.env.HIGGSFIELD_KEY_SECRET || ''
  return `Key ${sec.includes(':') ? sec : `${process.env.HIGGSFIELD_KEY_ID}:${sec}`}`
}

export type HfStatus = {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled' | 'unknown'
  images?: { url: string }[]
  videoUrl?: string
  error?: string
}

/** Submit a job. Throws with Higgsfield's own message on refusal. */
export async function hfSubmit(endpoint: string, input: Record<string, unknown>): Promise<{ requestId: string }> {
  if (!higgsfieldConfigured()) throw new Error('Higgsfield is not set up yet - add HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET')
  const res = await fetch(`${API}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  })
  const j = await res.json().catch(() => ({})) as { request_id?: string; detail?: unknown; message?: string }
  if (!res.ok || !j.request_id) {
    const d = j.detail
    const msg = typeof d === 'string' ? d
      : Array.isArray(d) ? d.map((x: any) => x?.msg || x?.message || JSON.stringify(x)).join('; ')
      : j.message || `HTTP ${res.status}`
    throw new Error(res.status === 401 ? 'Higgsfield refused the API key' : res.status === 402 ? 'Higgsfield account is out of credits' : `Higgsfield: ${msg}`)
  }
  return { requestId: j.request_id }
}

/** A job's state, normalised. Network trouble reads as 'unknown' (ask again later). */
export async function hfStatus(requestId: string): Promise<HfStatus> {
  try {
    const res = await fetch(`${API}/requests/${encodeURIComponent(requestId)}/status`, {
      headers: { Authorization: auth() }, signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return { status: 'failed', error: 'Higgsfield no longer knows this job' }
    if (!res.ok) return { status: 'unknown' }
    const j = await res.json() as { status?: string; images?: { url?: string }[]; video?: { url?: string } | { url?: string }[]; error?: unknown }
    const st = (j.status || '') as HfStatus['status']
    const video = Array.isArray(j.video) ? j.video[0]?.url : j.video?.url
    return {
      status: (['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'] as const).includes(st as any) ? st : 'unknown',
      images: Array.isArray(j.images) ? j.images.filter(i => typeof i?.url === 'string').map(i => ({ url: i.url! })) : undefined,
      videoUrl: typeof video === 'string' ? video : undefined,
      error: typeof j.error === 'string' ? j.error : undefined,
    }
  } catch {
    return { status: 'unknown' }
  }
}

type Row = { id: number; userId: number; modelId: string; modelType: string; prompt: string; ticketCost: number; createdAt: Date; falRequestId: string | null; parameters: unknown }
type HfParams = { provider?: string; hfEndpoint?: string; aspectRatio?: string; quality?: string; resolution?: string; duration?: string; referenceImageUrls?: string[]; generateAudio?: boolean; [k: string]: unknown }

export type SettleResult =
  | { status: 'completed'; imageIds: number[]; urls: string[] }
  | { status: 'failed'; error: string }
  | { status: 'in_progress' }

/**
 * Queue a job: take a slot and send it now, or wait in line. The row is the
 * record either way; `input` is stored canonical (links are signed when sent).
 */
export async function queueHiggsfieldJob(o: {
  userId: number; modelId: string; modelType: 'image' | 'video'; prompt: string; endpoint: string
  input: Record<string, unknown>; parameters: Record<string, unknown>; ticketCost?: number
}): Promise<{ queueId: number; requestId: string | null; queued: boolean }> {
  const max = higgsfieldMaxConcurrent()
  const row = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SLOT_LOCK}))`
    const running = await tx.generationQueue.count({ where: { status: 'processing', modelId: { in: HIGGSFIELD_MODEL_IDS } } })
    const waiting = await tx.generationQueue.count({ where: { status: 'queued', modelId: { in: HIGGSFIELD_MODEL_IDS } } })
    // First come, first served: nobody jumps a line that already exists
    const now = running < max && waiting === 0
    return tx.generationQueue.create({
      data: {
        userId: o.userId, modelId: o.modelId, modelType: o.modelType, prompt: o.prompt,
        parameters: { ...o.parameters, provider: 'higgsfield', hfEndpoint: o.endpoint, hfInput: o.input } as object,
        status: now ? 'processing' : 'queued',
        ticketCost: o.ticketCost ?? 0,
        ...(now ? { startedAt: new Date() } : {}),
      },
      select: { id: true, status: true },
    })
  })
  if (row.status === 'queued') return { queueId: row.id, requestId: null, queued: true }
  const requestId = await sendRow(row.id, o.endpoint, o.input)
  if (!requestId) {
    const failed = await prisma.generationQueue.findUnique({ where: { id: row.id }, select: { errorMessage: true } })
    throw new Error(failed?.errorMessage || 'Submission to Higgsfield failed')
  }
  return { queueId: row.id, requestId, queued: false }
}

/** Send a row that holds a slot; on refusal the row fails (refunded) and the slot frees. */
async function sendRow(rowId: number, endpoint: string, input: Record<string, unknown>): Promise<string | null> {
  try {
    const { requestId } = await hfSubmit(endpoint, signPayload(input, HF_LINK_TTL))
    await prisma.generationQueue.update({ where: { id: rowId }, data: { falRequestId: requestId } })
    return requestId
  } catch (e: any) {
    const row = await prisma.generationQueue.findUnique({
      where: { id: rowId },
      select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, falRequestId: true, parameters: true },
    })
    if (row) await failRow(row, e?.message || 'Submission to Higgsfield failed')
    return null
  }
}

/**
 * Fill free slots from the line, oldest first. Called whenever a job settles,
 * and by the jobs poll and the cron (so a line never waits on a page).
 */
export async function promoteHiggsfieldQueue(): Promise<number> {
  if (!higgsfieldConfigured()) return 0
  const max = higgsfieldMaxConcurrent()
  // A send that crashed half way (a slot taken, never sent) frees after 3 minutes
  await prisma.generationQueue.updateMany({
    where: { status: 'processing', modelId: { in: HIGGSFIELD_MODEL_IDS }, falRequestId: null, startedAt: { lt: new Date(Date.now() - 3 * 60_000) } },
    data: { status: 'failed', completedAt: new Date(), errorMessage: 'The job could not be sent to Higgsfield - try again' },
  }).catch(() => {})
  const picked = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SLOT_LOCK}))`
    const running = await tx.generationQueue.count({ where: { status: 'processing', modelId: { in: HIGGSFIELD_MODEL_IDS } } })
    const free = max - running
    if (free <= 0) return []
    const next = await tx.generationQueue.findMany({
      where: { status: 'queued', modelId: { in: HIGGSFIELD_MODEL_IDS } },
      orderBy: { createdAt: 'asc' }, take: free,
      select: { id: true, parameters: true },
    })
    if (!next.length) return []
    await tx.generationQueue.updateMany({ where: { id: { in: next.map(n => n.id) }, status: 'queued' }, data: { status: 'processing', startedAt: new Date() } })
    return next
  })
  let sent = 0
  await Promise.all(picked.map(async p => {
    const params = (p.parameters ?? {}) as { hfEndpoint?: string; hfInput?: Record<string, unknown> }
    if (!params.hfEndpoint || !params.hfInput) {
      await prisma.generationQueue.update({ where: { id: p.id }, data: { status: 'failed', completedAt: new Date(), errorMessage: 'This job lost its settings - try again' } }).catch(() => {})
      return
    }
    if (await sendRow(p.id, params.hfEndpoint, params.hfInput)) sent++
  }))
  if (sent) console.log(`[higgsfield] sent ${sent} queued job(s)`)
  return sent
}

/** Settle a row as failed (once) and refund what it charged. */
async function failRow(row: Row, error: string): Promise<SettleResult> {
  const flipped = await prisma.generationQueue.updateMany({
    where: { id: row.id, status: 'processing' },
    data: { status: 'failed', completedAt: new Date(), errorMessage: error },
  })
  if (flipped.count > 0 && row.ticketCost > 0) {
    const u = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } })
    if (u?.email) await refundGenerationTickets(row.userId, u.email, row.ticketCost).catch(() => {})
  }
  // A slot just freed
  if (flipped.count > 0) void promoteHiggsfieldQueue().catch(() => {})
  return { status: 'failed', error }
}

/**
 * Finish one Higgsfield job if it is done: download, keep on R2, save the
 * rows (images with their thumbnails; a video with its metadata) and settle
 * the queue row - or fail it with a refund. Safe to call from several places
 * at once: the save runs under an advisory lock and re-checks for rows.
 */
export async function settleHiggsfieldRow(row: Row): Promise<SettleResult> {
  const rid = row.falRequestId
  if (!rid) return failRow(row, 'This job never reached Higgsfield')
  const params = (row.parameters ?? {}) as HfParams
  const isVideo = row.modelType === 'video' || HIGGSFIELD_VIDEO_MODELS.has(row.modelId)

  // Saved already (another poller got there first)
  const existing = await prisma.generatedImage.findMany({ where: { falRequestId: rid }, select: { id: true, imageUrl: true }, orderBy: { id: 'asc' } })
  if (existing.length > 0) {
    await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'processing' }, data: { status: 'completed', completedAt: new Date() } })
    return { status: 'completed', imageIds: existing.map(e => e.id), urls: existing.map(e => e.imageUrl) }
  }

  const st = await hfStatus(rid)
  if (st.status === 'queued' || st.status === 'in_progress' || st.status === 'unknown') return { status: 'in_progress' }
  if (st.status === 'nsfw') return failRow(row, 'Higgsfield\'s moderation refused this one (nothing was charged)')
  if (st.status === 'canceled') return failRow(row, 'The job was canceled')
  if (st.status === 'failed') return failRow(row, st.error ? `Higgsfield: ${st.error}` : 'Generation failed at Higgsfield')

  // completed: download and keep (slow, no lock held)
  const sources = isVideo ? (st.videoUrl ? [st.videoUrl] : []) : (st.images ?? []).map(i => i.url)
  if (!sources.length) return failRow(row, 'Higgsfield finished without a result')
  const hosted: { url: string; variants: ImageVariants | null }[] = []
  for (let i = 0; i < sources.length; i++) {
    try {
      const r = await fetch(sources[i], { signal: AbortSignal.timeout(isVideo ? 120_000 : 45_000) })
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      const type = r.headers.get('content-type') || (isVideo ? 'video/mp4' : 'image/png')
      const ext = isVideo ? (type.includes('webm') ? 'webm' : 'mp4') : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'
      const [url, variants] = await Promise.all([
        uploadToR2(userKey(row.userId, `higgsfield/${row.modelId}-${Date.now()}-${i}.${ext}`), buf, type),
        isVideo ? Promise.resolve(null) : prepareImageVariants(buf),
      ])
      hosted.push({ url, variants })
    } catch (e) {
      console.error(`[higgsfield] output ${i} of ${rid} could not be kept:`, e)
    }
  }
  // A download hiccup: try again on the next poll (outputs stay up 7 days)
  if (!hosted.length) return { status: 'in_progress' }

  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'hf-save-' + rid}))`
    const already = await tx.generatedImage.findMany({ where: { falRequestId: rid }, select: { id: true, imageUrl: true } })
    if (already.length) return { ids: already.map(r => r.id), urls: already.map(r => r.imageUrl), fresh: false }
    const made = await Promise.all(hosted.map(h => tx.generatedImage.create({
      data: {
        userId: row.userId,
        prompt: row.prompt || '',
        imageUrl: h.url,
        model: row.modelId,
        ticketCost: row.ticketCost,
        quality: params.resolution || params.quality || 'auto',
        aspectRatio: params.aspectRatio || 'auto',
        referenceImageUrls: Array.isArray(params.referenceImageUrls) ? params.referenceImageUrls : [],
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        falRequestId: rid,
        createdAt: row.createdAt, // queue time - the feed's ordering key
        ...(isVideo ? {
          videoMetadata: {
            isVideo: true,
            duration: params.duration || '5',
            resolution: params.resolution || '720p',
            aspectRatio: params.aspectRatio || '16:9',
            audioEnabled: !!params.generateAudio,
            provider: 'higgsfield',
            // What it was given (lib/gen-inputs), as the submit route kept it
            ...(params.inputs && typeof params.inputs === 'object' ? { inputs: params.inputs } : {}),
          },
        } : {}),
      },
      select: { id: true, imageUrl: true },
    })))
    return { ids: made.map(m => m.id), urls: made.map(m => m.imageUrl), fresh: true }
  })
  if (saved.fresh && !isVideo) await Promise.all(saved.ids.map(async (id, k) => {
    if (!(await attachImageVariants(id, hosted[k]?.variants ?? null))) await ensureThumbnail(id).catch(() => {})
  }))
  // The ids ride on the row: the page's queue poller claims its pictures by them
  await prisma.generationQueue.updateMany({
    where: { id: row.id, status: 'processing' },
    data: {
      status: 'completed', completedAt: new Date(), resultUrl: saved.urls[0], resultImageId: saved.ids[0],
      parameters: { ...params, completedImageIds: saved.ids } as object,
    },
  })
  // A slot just freed
  void promoteHiggsfieldQueue().catch(() => {})
  return { status: 'completed', imageIds: saved.ids, urls: saved.urls }
}

/**
 * Finish the Higgsfield jobs that are in flight - one account's (the page's
 * jobs poll) or everyone's (the cron).
 */
export async function harvestHiggsfieldJobs(opts: { userId?: number; limit?: number; budgetMs?: number } = {}): Promise<number> {
  if (!higgsfieldConfigured()) return 0
  const { userId, limit = 6, budgetMs = 25_000 } = opts
  const t0 = Date.now()
  const rows = await prisma.generationQueue.findMany({
    where: {
      status: 'processing',
      falRequestId: { not: null },
      parameters: { path: ['provider'], equals: 'higgsfield' },
      ...(userId ? { userId } : {}),
    },
    select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, falRequestId: true, parameters: true },
    orderBy: { startedAt: 'asc' },
    take: limit,
  })
  let settled = 0
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs) break
    try {
      const out = await settleHiggsfieldRow(r)
      if (out.status !== 'in_progress') settled++
    } catch (e) {
      console.error(`[higgsfield] settling job #${r.id} failed:`, e)
    }
  }
  // And the line: whatever slots are free
  await promoteHiggsfieldQueue().catch(e => console.error('[higgsfield] promote failed:', e))
  return settled
}
