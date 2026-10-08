import prisma from '@/lib/prisma'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { uploadToR2 } from '@/lib/r2'
import { fal } from '@/lib/fal-client'
import { getAudioStudioModel } from '@/lib/audio-studio'

/**
 * Settle one Audio Studio run - shared by /api/audio/status (the page polling
 * its own run) and the drain-queue cron (runs whose page was closed, which
 * would otherwise sit in 'audio-processing' forever with the user's tickets
 * spent and nothing to show for them).
 *
 * Everything that matters is read from the run's GenerationQueue row (made by
 * /api/audio/generate) - the caller only says WHICH row, never the prompt,
 * model or price.
 *
 * Settling and refunding each happen once, whoever calls: the row is flipped
 * out of 'audio-processing' with a guarded updateMany, and only the caller
 * whose flip matched does the work. A finished run's files are copied from
 * fal to our R2 bucket (fal's URLs expire) and saved as GeneratedImage rows -
 * one per output, so a stem split lands as six playable tracks.
 */

export const AUDIO_STALE_MS = 30 * 60 * 1000
const TYPES: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4' }
const extOf = (url: string, type: string | null) => {
  const fromUrl = url.split('?')[0].match(/\.(mp3|wav|flac|m4a|aac|ogg|opus|mp4)$/i)?.[1]?.toLowerCase()
  if (fromUrl) return fromUrl
  return Object.entries(TYPES).find(([, t]) => type?.startsWith(t))?.[0] ?? 'mp3'
}

export type AudioSettleResult =
  | { status: 'pending'; queue?: string }
  | { status: 'completed'; items: Awaited<ReturnType<typeof audioItemsFor>> }
  | { status: 'failed'; error: string }

export async function audioItemsFor(userId: number, requestId: string) {
  return prisma.generatedImage.findMany({
    where: { userId, OR: [{ falRequestId: requestId }, { falRequestId: { startsWith: `${requestId}#` } }] },
    orderBy: { id: 'asc' },
    select: { id: true, imageUrl: true, prompt: true, model: true, createdAt: true, videoMetadata: true },
  })
}

type QueueRow = NonNullable<Awaited<ReturnType<typeof prisma.generationQueue.findFirst>>>

async function fail(row: QueueRow, email: string, reason: string): Promise<AudioSettleResult> {
  const flip = await prisma.generationQueue.updateMany({
    where: { id: row.id, status: 'audio-processing' },
    data: { status: 'failed', completedAt: new Date(), errorMessage: reason.slice(0, 500) },
  })
  if (flip.count) await refundGenerationTickets(row.userId, email, row.ticketCost)
  return { status: 'failed', error: reason }
}

/** Settle `row` (an audio GenerationQueue row) for the user it belongs to. */
export async function settleAudioRun(row: QueueRow, email: string): Promise<AudioSettleResult> {
  const requestId = row.falRequestId ?? ''
  if (row.status === 'completed') return { status: 'completed', items: await audioItemsFor(row.userId, requestId) }
  if (row.status === 'failed') return { status: 'failed', error: row.errorMessage || 'Generation failed' }
  if (row.status !== 'audio-processing') return { status: 'pending' }

  const params = (row.parameters ?? {}) as Record<string, any>
  const endpoint = String(params.falEndpoint ?? '')
  const spec = getAudioStudioModel(row.modelId)
  if (!spec || !endpoint || !requestId) return fail(row, email, 'Unknown audio model')
  const age = Date.now() - new Date(row.startedAt ?? row.queuedAt).getTime()

  let state: string
  try {
    const s: any = await fal.queue.status(endpoint, { requestId, logs: false })
    state = s?.status
  } catch {
    if (age > AUDIO_STALE_MS) return fail(row, email, 'The generation timed out')
    return { status: 'pending' }
  }
  if (state !== 'COMPLETED') {
    if (age > AUDIO_STALE_MS) return fail(row, email, 'The generation timed out')
    return { status: 'pending', queue: state }
  }

  let data: any
  try {
    data = (await fal.queue.result(endpoint, { requestId }))?.data
  } catch (e: any) {
    const detail = e?.body?.detail
    const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
    return fail(row, email, msg ? `The model could not complete this: ${msg}` : 'Generation failed')
  }
  const outputs = spec.outputs(data)
  if (!outputs.length) return fail(row, email, 'The model returned no audio')

  // One settler: whoever flips the row does the copy and the writes
  const claim = await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'audio-processing' }, data: { status: 'audio-settling' } })
  if (!claim.count) return { status: 'pending' }

  try {
    const created: number[] = []
    for (const [i, out] of outputs.entries()) {
      let url = out.url
      try {
        const res = await fetch(out.url)
        if (!res.ok) throw new Error(`fetch ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        const ext = extOf(out.url, res.headers.get('content-type'))
        // A video output (Mureka Lyrics Video) is named like the site's other videos
        url = await uploadToR2(`${spec.outputVideo ? 'video' : 'audio'}-${row.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}.${spec.outputVideo ? 'mp4' : ext}`, buf, spec.outputVideo ? 'video/mp4' : TYPES[ext] ?? 'audio/mpeg')
      } catch (e) {
        console.error('audio re-host failed, keeping the fal URL:', e)
      }
      const g = await prisma.generatedImage.create({
        data: {
          userId: row.userId,
          prompt: row.prompt,
          imageUrl: url,
          // A video output is saved under its video model id, so it joins the video feed
          model: spec.outputVideo?.storeAs ?? row.modelId,
          ticketCost: i === 0 ? row.ticketCost : 0,
          referenceImageUrls: params.audioUrl ? [String(params.audioUrl)] : [],
          createdAt: row.queuedAt,
          expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
          falRequestId: i === 0 ? requestId : `${requestId}#${i}`,
          videoMetadata: {
            isAudio: !spec.outputVideo,
            ...(spec.outputVideo ? { sourceSongAssetId: params.sourceSongAssetId ?? null, options: params.options ?? null } : {}),
            // What the model returned beyond the file (Mureka's song id: a lyrics video is made from it)
            ...(out.meta ?? {}),
            label: out.label ?? null,
            modelName: spec.name,
            provider: spec.provider,
            voice: params.voice ?? null,
            voice2: params.voice2 ?? null,
            durationSec: params.duration ?? null,
          },
        },
      })
      created.push(g.id)
    }
    await prisma.generationQueue.update({
      where: { id: row.id },
      data: { status: 'completed', completedAt: new Date(), resultImageId: created[0] },
    })
  } catch (e) {
    // Put it back so the next poll (or the cron) can try again
    await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'audio-settling' }, data: { status: 'audio-processing' } })
    throw e
  }
  return { status: 'completed', items: await audioItemsFor(row.userId, requestId) }
}

/**
 * The cron's half: settle audio runs no page is polling any more. Only rows a
 * few minutes old (a live page settles its own first), oldest first, a few
 * per minute so one cron tick stays short.
 */
export async function settleAbandonedAudioRuns(limit = 8): Promise<number> {
  const rows = await prisma.generationQueue.findMany({
    where: { modelType: 'audio', status: 'audio-processing', startedAt: { lt: new Date(Date.now() - 3 * 60 * 1000) } },
    orderBy: { startedAt: 'asc' },
    take: limit,
  })
  let settled = 0
  for (const row of rows) {
    try {
      const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } })
      const r = await settleAudioRun(row, user?.email ?? '')
      if (r.status !== 'pending') settled++
    } catch (e) {
      console.error(`[audio-settle] row ${row.id}:`, e)
    }
  }
  return settled
}
