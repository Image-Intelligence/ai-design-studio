import prisma from '@/lib/prisma'
import { PUBLIC_URL, objectExists, userKey } from '@/lib/r2'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { isOurMedia, keyFromUrl, signMediaUrl } from '@/lib/media-url'
import { RUNPOD_ENDPOINT_ENV, type RunpodVideoModelId } from '@/lib/runpod-video-models'

/**
 * Our own video models on RunPod serverless, server side (2026-10-22 - the
 * catalogue and prices are lib/runpod-video-models; the workers live under
 * AI/, e.g. AI/mocha-worker).
 *
 * Credentials: RUNPOD_API_KEY (the one the FLUX endpoint uses) plus one
 * endpoint id per model (RUNPOD_MOCHA_ENDPOINT_ID ...). Never to the browser.
 *
 * A job is a GenerationQueue row like a Higgsfield one (lib/higgsfield): status
 * 'processing', the RunPod job id in falRequestId (the column every poller
 * keys on), parameters.provider = 'runpod', and deliberately NO `falEndpoint` /
 * `usePolling`, so nothing that asks fal about a row touches it. RunPod queues
 * jobs per endpoint itself, so there is no slot-keeping here: a job is sent
 * the moment it is made, and waits on RunPod while a worker boots.
 *
 * The worker reads its inputs straight from R2 (our pictures and clips go as
 * object keys, with a signed link as the fallback) and writes the finished
 * video to the key we give it - the owner's own namespace - so nothing is
 * downloaded here: settling a job is reading RunPod's answer and saving the
 * row. RunPod forgets a finished job after a while; the key in R2 is the
 * ground truth then (as /api/admin/flux-inference/nb2-status does).
 */

const API = 'https://api.runpod.ai/v2'
// The worker reads our media by key; the signed link is its fallback, long
// enough for a cold start and a queue
const RP_LINK_TTL = 24 * 3600
// RunPod's per-job ceiling (the endpoint's default is 10 minutes - too short
// for a cold start plus a render)
const EXECUTION_TIMEOUT_MS = 90 * 60 * 1000
// A job still running this long after it was sent has hung - give up on it
const STALE_MS = 3 * 3600 * 1000
// A job RunPod no longer knows and whose output never appeared
const GONE_GRACE_MS = 30 * 60 * 1000

const endpointFor = (model: string) => {
  const env = RUNPOD_ENDPOINT_ENV[model as RunpodVideoModelId]
  return env ? process.env[env] || '' : ''
}
export const runpodVideoConfigured = (model: string) => !!(process.env.RUNPOD_API_KEY && endpointFor(model))
export const runpodEndpointEnvName = (model: string) => RUNPOD_ENDPOINT_ENV[model as RunpodVideoModelId] || 'RUNPOD_<MODEL>_ENDPOINT_ID'

/** One input for the worker: our media by R2 key (with a signed link as backup), anything else by its link. */
export function runpodMedia(url: string): { r2_key?: string; url: string } {
  if (isOurMedia(url)) return { r2_key: keyFromUrl(url), url: signMediaUrl(url, RP_LINK_TTL) }
  return { url }
}

type RpStatus = {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'gone' | 'unknown'
  output?: Record<string, any>
  error?: string
}

async function rpSubmit(endpointId: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API}/${endpointId}/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, policy: { executionTimeout: EXECUTION_TIMEOUT_MS } }),
    signal: AbortSignal.timeout(30_000),
  })
  const j = await res.json().catch(() => ({})) as { id?: string; error?: string }
  if (!res.ok || !j.id) {
    throw new Error(res.status === 401 ? 'RunPod refused the API key' : `RunPod: ${j.error || `HTTP ${res.status}`}`)
  }
  return j.id
}

/** A job's state. Network trouble reads as 'unknown' (ask again later); a 404 as 'gone'. */
async function rpStatus(endpointId: string, jobId: string): Promise<RpStatus> {
  try {
    const res = await fetch(`${API}/${endpointId}/status/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` }, signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return { status: 'gone' }
    if (!res.ok) return { status: 'unknown' }
    const j = await res.json() as { status?: string; output?: unknown; error?: unknown }
    const st = j.status as RpStatus['status']
    return {
      status: (['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const).includes(st as any) ? st : 'unknown',
      output: j.output && typeof j.output === 'object' ? j.output as Record<string, any> : undefined,
      error: typeof j.error === 'string' ? j.error : j.error ? JSON.stringify(j.error).slice(0, 500) : undefined,
    }
  } catch {
    return { status: 'unknown' }
  }
}

type Row = { id: number; userId: number; modelId: string; modelType: string; prompt: string; ticketCost: number; createdAt: Date; startedAt?: Date | null; falRequestId: string | null; parameters: unknown }
type RpParams = {
  provider?: string; rpOutputKey?: string; resolution?: string; aspectRatio?: string; keepAudio?: boolean
  referenceImageUrls?: string[]; inputs?: unknown; [k: string]: unknown
}

export type SettleResult =
  | { status: 'completed'; imageIds: number[]; urls: string[] }
  | { status: 'failed'; error: string }
  | { status: 'in_progress' }

/**
 * Make the row and send the job. `input` is the worker's job input minus the
 * output key (added here, in the owner's namespace); it is stored with the
 * row. Throws - with the row failed and refunded - when RunPod refuses it.
 */
export async function submitRunpodVideoJob(o: {
  userId: number; modelId: string; prompt: string; input: Record<string, unknown>
  parameters: Record<string, unknown>; ticketCost?: number
}): Promise<{ queueId: number; requestId: string }> {
  const endpointId = endpointFor(o.modelId)
  if (!process.env.RUNPOD_API_KEY || !endpointId) throw new Error(`RunPod is not set up for this model yet - add RUNPOD_API_KEY and ${runpodEndpointEnvName(o.modelId)}`)
  const row = await prisma.generationQueue.create({
    data: {
      userId: o.userId, modelId: o.modelId, modelType: 'video', prompt: o.prompt,
      parameters: { ...o.parameters, provider: 'runpod' } as object,
      status: 'processing', startedAt: new Date(), ticketCost: o.ticketCost ?? 0,
    },
    select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, falRequestId: true, parameters: true },
  })
  const outputKey = userKey(o.userId, `runpod/${o.modelId}-${row.id}.mp4`)
  const input = { ...o.input, output_r2_key: outputKey }
  try {
    const requestId = await rpSubmit(endpointId, input)
    await prisma.generationQueue.update({
      where: { id: row.id },
      data: { falRequestId: requestId, parameters: { ...o.parameters, provider: 'runpod', rpOutputKey: outputKey, rpInput: input } as object },
    })
    return { queueId: row.id, requestId }
  } catch (e: any) {
    await failRow(row, e?.message || 'Submission to RunPod failed')
    throw e
  }
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
  return { status: 'failed', error }
}

const ratioOf = (w: number, h: number) => {
  if (!w || !h) return 'auto'
  const r = w / h
  return r > 1.6 ? '16:9' : r > 1.2 ? '4:3' : r > 0.85 ? '1:1' : r > 0.65 ? '3:4' : '9:16'
}

/** Save the finished video (once - several pollers may get here together) and close the row. */
async function saveRow(row: Row, params: RpParams, key: string, out: Record<string, any>): Promise<SettleResult> {
  const rid = row.falRequestId!
  const url = `${PUBLIC_URL}/${key}`
  const w = Number(out.width) || 0, h = Number(out.height) || 0
  const seconds = Number(out.seconds) || 0
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rp-save-' + rid}))`
    const already = await tx.generatedImage.findMany({ where: { falRequestId: rid }, select: { id: true, imageUrl: true } })
    if (already.length) return { ids: already.map(r => r.id), urls: already.map(r => r.imageUrl) }
    const made = await tx.generatedImage.create({
      data: {
        userId: row.userId,
        prompt: row.prompt || '',
        imageUrl: url,
        model: row.modelId,
        ticketCost: row.ticketCost,
        quality: params.resolution || '480p',
        aspectRatio: ratioOf(w, h) !== 'auto' ? ratioOf(w, h) : params.aspectRatio || 'auto',
        referenceImageUrls: Array.isArray(params.referenceImageUrls) ? params.referenceImageUrls : [],
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        falRequestId: rid,
        createdAt: row.createdAt, // queue time - the feed's ordering key
        videoMetadata: {
          isVideo: true,
          duration: String(Math.max(1, Math.round(seconds || 5))),
          resolution: params.resolution || '480p',
          aspectRatio: ratioOf(w, h),
          audioEnabled: params.keepAudio !== false,
          provider: 'runpod',
          // The worker's own record of the run: the mask it used, its settings and timings
          runpod: {
            ...(typeof out.mask_r2_key === 'string' ? { maskUrl: `${PUBLIC_URL}/${out.mask_r2_key}` } : {}),
            ...(w && h ? { width: w, height: h } : {}),
            ...(out.frames ? { frames: out.frames, fps: out.fps } : {}),
            ...(out.seed !== undefined ? { seed: out.seed } : {}),
            ...(out.timings ? { timings: out.timings } : {}),
            ...(out.handler_version ? { worker: out.handler_version } : {}),
          },
          // What it was given (lib/gen-inputs), as the submit route kept it
          ...(params.inputs && typeof params.inputs === 'object' ? { inputs: params.inputs } : {}),
        },
      },
      select: { id: true, imageUrl: true },
    })
    return { ids: [made.id], urls: [made.imageUrl] }
  })
  await prisma.generationQueue.updateMany({
    where: { id: row.id, status: 'processing' },
    data: {
      status: 'completed', completedAt: new Date(), resultUrl: saved.urls[0], resultImageId: saved.ids[0],
      parameters: { ...params, completedImageIds: saved.ids } as object,
    },
  })
  return { status: 'completed', imageIds: saved.ids, urls: saved.urls }
}

/**
 * Finish one RunPod job if it is done: save the video the worker left in R2,
 * or fail the row with a refund. Safe to call from several places at once.
 */
export async function settleRunpodRow(row: Row): Promise<SettleResult> {
  const rid = row.falRequestId
  const sentAt = (row.startedAt ?? row.createdAt).getTime()
  if (!rid) return Date.now() - sentAt > 3 * 60_000 ? failRow(row, 'This job never reached RunPod - try again') : { status: 'in_progress' }
  const params = (row.parameters ?? {}) as RpParams

  // Saved already (another poller got there first)
  const existing = await prisma.generatedImage.findMany({ where: { falRequestId: rid }, select: { id: true, imageUrl: true }, orderBy: { id: 'asc' } })
  if (existing.length > 0) {
    await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'processing' }, data: { status: 'completed', completedAt: new Date() } })
    return { status: 'completed', imageIds: existing.map(e => e.id), urls: existing.map(e => e.imageUrl) }
  }

  const endpointId = endpointFor(row.modelId)
  if (!process.env.RUNPOD_API_KEY || !endpointId) return { status: 'in_progress' } // set up again later; the row waits
  const st = await rpStatus(endpointId, rid)
  if (st.status === 'unknown') return { status: 'in_progress' }
  if (st.status === 'IN_QUEUE' || st.status === 'IN_PROGRESS') {
    return Date.now() - sentAt > STALE_MS ? failRow(row, 'The render ran for over 3 hours and was given up on') : { status: 'in_progress' }
  }
  if (st.status === 'CANCELLED') return failRow(row, 'The job was canceled on RunPod')
  if (st.status === 'TIMED_OUT') return failRow(row, 'The render ran past its time limit on RunPod')
  if (st.status === 'FAILED') return failRow(row, `The worker crashed: ${st.error || 'no detail'}`.slice(0, 600))

  if (st.status === 'COMPLETED') {
    const out = st.output ?? {}
    if (out.success && typeof out.output_r2_key === 'string') return saveRow(row, params, out.output_r2_key, out)
    return failRow(row, typeof out.error === 'string' && out.error ? out.error.slice(0, 600) : 'The worker finished without a video')
  }

  // gone: RunPod forgot the job - the output in R2 says whether it finished
  if (params.rpOutputKey && await objectExists(params.rpOutputKey).catch(() => false)) {
    return saveRow(row, params, params.rpOutputKey, {})
  }
  return Date.now() - sentAt > GONE_GRACE_MS ? failRow(row, 'RunPod lost this job before it finished') : { status: 'in_progress' }
}

/** Finish the RunPod jobs in flight - one account's (the page's jobs poll) or everyone's (the cron). */
export async function harvestRunpodJobs(opts: { userId?: number; limit?: number; budgetMs?: number } = {}): Promise<number> {
  if (!process.env.RUNPOD_API_KEY) return 0
  const { userId, limit = 6, budgetMs = 20_000 } = opts
  const t0 = Date.now()
  const rows = await prisma.generationQueue.findMany({
    where: {
      status: 'processing',
      parameters: { path: ['provider'], equals: 'runpod' },
      ...(userId ? { userId } : {}),
    },
    select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, startedAt: true, falRequestId: true, parameters: true },
    orderBy: { startedAt: 'asc' },
    take: limit,
  })
  let settled = 0
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs) break
    try {
      const out = await settleRunpodRow(r)
      if (out.status !== 'in_progress') settled++
    } catch (e) {
      console.error(`[runpod-video] settling job #${r.id} failed:`, e)
    }
  }
  return settled
}
