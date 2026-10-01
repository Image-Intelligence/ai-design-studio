import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { refundGenerationTickets } from '@/lib/ticket-gate'
import { uploadToR2 } from '@/lib/r2'
import { fal } from '@/lib/fal-client'
import { jsonPrivate } from '@/lib/api-json'
import { getAudioStudioModel } from '@/lib/audio-studio'

/**
 * POST /api/audio/status { requestId } - settle an Audio Studio run.
 *
 * Everything that matters is read from the run's GenerationQueue row (made by
 * /api/audio/generate), found by fal request id AND the caller's user id - so
 * a client can only ever settle its own runs, and cannot change the prompt,
 * model or price on the way.
 *
 * Settling and refunding each happen once: the row is flipped out of
 * 'audio-processing' with a guarded updateMany, and only the caller whose flip
 * matched does the work. A finished run's files are copied from fal to our R2
 * bucket (fal's URLs expire) and saved as GeneratedImage rows - one per output,
 * so a stem split lands as six playable tracks.
 *
 * Returns { status: 'pending' | 'completed' | 'failed', items?, error? }.
 */
export const maxDuration = 120

const STALE_MS = 30 * 60 * 1000
const TYPES: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg' }
const extOf = (url: string, type: string | null) => {
  const fromUrl = url.split('?')[0].match(/\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i)?.[1]?.toLowerCase()
  if (fromUrl) return fromUrl
  return Object.entries(TYPES).find(([, t]) => type?.startsWith(t))?.[0] ?? 'mp3'
}

async function itemsFor(userId: number, requestId: string) {
  const rows = await prisma.generatedImage.findMany({
    where: { userId, OR: [{ falRequestId: requestId }, { falRequestId: { startsWith: `${requestId}#` } }] },
    orderBy: { id: 'asc' },
    select: { id: true, imageUrl: true, prompt: true, model: true, createdAt: true, videoMetadata: true },
  })
  return rows
}

async function fail(row: { id: number; userId: number; ticketCost: number }, email: string, reason: string) {
  const flip = await prisma.generationQueue.updateMany({
    where: { id: row.id, status: 'audio-processing' },
    data: { status: 'failed', completedAt: new Date(), errorMessage: reason.slice(0, 500) },
  })
  if (flip.count) await refundGenerationTickets(row.userId, email, row.ticketCost)
  return jsonPrivate({ status: 'failed', error: reason })
}

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user?.email) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const { requestId } = await req.json().catch(() => ({}))
    if (typeof requestId !== 'string' || !requestId) return jsonPrivate({ error: 'requestId required' }, { status: 400 })

    const row = await prisma.generationQueue.findFirst({ where: { falRequestId: requestId, userId: user.id, modelType: 'audio' } })
    if (!row) return jsonPrivate({ error: 'Not found' }, { status: 404 })

    if (row.status === 'completed') return jsonPrivate({ status: 'completed', items: await itemsFor(user.id, requestId) })
    if (row.status === 'failed') return jsonPrivate({ status: 'failed', error: row.errorMessage || 'Generation failed' })
    if (row.status === 'audio-settling') return jsonPrivate({ status: 'pending' })

    const params = (row.parameters ?? {}) as Record<string, any>
    const endpoint = String(params.falEndpoint ?? '')
    const spec = getAudioStudioModel(row.modelId)
    if (!spec || !endpoint) return fail(row, user.email, 'Unknown audio model')

    let state: string
    try {
      const s: any = await fal.queue.status(endpoint, { requestId, logs: false })
      state = s?.status
    } catch (e: any) {
      if (Date.now() - new Date(row.startedAt ?? row.queuedAt).getTime() > STALE_MS) return fail(row, user.email, 'The generation timed out')
      return jsonPrivate({ status: 'pending' })
    }
    if (state !== 'COMPLETED') {
      if (Date.now() - new Date(row.startedAt ?? row.queuedAt).getTime() > STALE_MS) return fail(row, user.email, 'The generation timed out')
      return jsonPrivate({ status: 'pending', queue: state })
    }

    let data: any
    try {
      data = (await fal.queue.result(endpoint, { requestId }))?.data
    } catch (e: any) {
      const detail = e?.body?.detail
      const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
      return fail(row, user.email, msg ? `The model could not complete this: ${msg}` : 'Generation failed')
    }
    const outputs = spec.outputs(data)
    if (!outputs.length) return fail(row, user.email, 'The model returned no audio')

    // One settler: whoever flips the row does the copy and the writes
    const claim = await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'audio-processing' }, data: { status: 'audio-settling' } })
    if (!claim.count) return jsonPrivate({ status: 'pending' })

    try {
      const created: number[] = []
      for (const [i, out] of outputs.entries()) {
        let url = out.url
        try {
          const res = await fetch(out.url)
          if (!res.ok) throw new Error(`fetch ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          const ext = extOf(out.url, res.headers.get('content-type'))
          url = await uploadToR2(`audio-${user.id}-${Date.now()}-${i}.${ext}`, buf, TYPES[ext] ?? 'audio/mpeg')
        } catch (e) {
          console.error('audio re-host failed, keeping the fal URL:', e)
        }
        const g = await prisma.generatedImage.create({
          data: {
            userId: user.id,
            prompt: row.prompt,
            imageUrl: url,
            model: row.modelId,
            ticketCost: i === 0 ? row.ticketCost : 0,
            referenceImageUrls: params.audioUrl ? [String(params.audioUrl)] : [],
            createdAt: row.queuedAt,
            expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
            falRequestId: i === 0 ? requestId : `${requestId}#${i}`,
            videoMetadata: {
              isAudio: true,
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
      // Put it back so the next poll can try again
      await prisma.generationQueue.updateMany({ where: { id: row.id, status: 'audio-settling' }, data: { status: 'audio-processing' } })
      throw e
    }
    return jsonPrivate({ status: 'completed', items: await itemsFor(user.id, requestId) })
  } catch (error) {
    console.error('audio status error:', error)
    return jsonPrivate({ status: 'pending' })
  }
}
