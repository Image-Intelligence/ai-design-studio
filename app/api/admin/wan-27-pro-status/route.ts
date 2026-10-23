import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { releaseQueueSlot } from '@/lib/admin-queue-helpers'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jsonPrivate } from '@/lib/api-json'
import {
  authorizePolledJob, existingPolledImages, savePolledImagesOnce, failPolledJob,
  pollErrorIsGone, polledJobIsStale, type PolledJobRow,
} from '@/lib/harvest-polling-jobs'

fal.config({ credentials: process.env.FAL_KEY! })

// POST /api/admin/wan-27-pro-status
// Polls a FAL queue Wan 2.7 Pro job. On completion, re-hosts images on Vercel Blob and saves to DB.
//
// 2026-10-23 billing sweep: the same shape as nb2-status now (lib/harvest-polling-jobs) -
// the job must be the caller's (admins: any) and fal is asked at the endpoint stored on the
// queue row; saved rows are looked for BEFORE any download; the save takes the shared lock
// and refuses a job already failed and refunded; a download hiccup keeps polling instead of
// refunding. Before, this route looked for rows only after a slow download and then inserted
// unlocked, so two pollers (or a poller and the harvester) both saved - duplicate tiles.
export async function POST(req: Request) {
  let requestId: string | undefined
  let job: PolledJobRow | null = null
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null

    const body = await req.json()
    requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    const { aspectRatio, referenceImageUrls, queuedAt } = body
    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    if (!requestId) {
      return jsonPrivate({ error: 'Missing requestId' }, { status: 400 })
    }

    // Owner and fal endpoint from the queue row, not the body
    const access = await authorizePolledJob(requestId, sessionUser, body.falEndpoint)
    if (!access.ok) return jsonPrivate({ error: access.error }, { status: access.status })
    job = access.row
    const falEndpoint = access.falEndpoint

    // Idempotency FIRST: a repeat poll of a saved job gets its rows back without touching fal or R2
    const existing = await existingPolledImages(requestId).catch(() => [])
    if (existing.length > 0) {
      console.log(`↩ Wan 2.7 Pro already saved [${requestId}] returning ${existing.length} existing record(s)`)
      await releaseQueueSlot(requestId, false)
      return jsonPrivate({
        status: 'completed',
        images: existing.map(img => ({ url: img.imageUrl, dbId: img.id })),
      })
    }
    // Failed (and refunded) already - never deliver it for free
    if (job && (job.status === 'failed' || job.status === 'cancelled')) {
      return jsonPrivate({ status: 'failed', error: job.errorMessage || 'Generation failed' })
    }

    const status = await fal.queue.status(falEndpoint, { requestId, logs: false })

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result<any>(falEndpoint, { requestId })
      const falImages: { url: string; width?: number; height?: number }[] = result.data?.images || []

      if (falImages.length === 0) {
        return jsonPrivate(await failPolledJob(requestId, 'No images returned from model'))
      }

      const hostedImages: { url: string; width?: number; height?: number }[] = []
      for (let i = 0; i < falImages.length; i++) {
        const falImg = falImages[i]
        try {
          const res = await fetch(falImg.url)
          if (!res.ok) continue
          const buffer = Buffer.from(await res.arrayBuffer())
          const filename = `wan27-${Date.now()}-${i}.png`
          const url = await uploadToR2(filename, buffer, 'image/png')
          hostedImages.push({ url, width: falImg.width, height: falImg.height })
        } catch (e) {
          console.error(`wan-27-pro-status: failed to re-host image ${i}:`, e)
        }
      }

      if (hostedImages.length === 0) {
        // A download / R2 hiccup is not the job failing - keep polling until fal has purged it
        if (polledJobIsStale(job)) return jsonPrivate(await failPolledJob(requestId, 'Failed to download generated images'))
        return jsonPrivate({ status: 'in_progress', error: 'Could not fetch the result yet - retrying' })
      }

      // createdAt = when the user QUEUED this generation, not when it finished. The feed
      // orders on createdAt, so completion time reshuffled tiles on every refresh.
      // Sanity-capped to the last 24h; the queue row knows when the client forgot.
      const queuedMs = typeof queuedAt === 'number' ? queuedAt : (job?.createdAt.getTime() ?? 0)

      let saved: Awaited<ReturnType<typeof savePolledImagesOnce>>
      try {
        saved = await savePolledImagesOnce(requestId, hostedImages.map(img => ({
          ...(queuedMs > Date.now() - 24 * 3600 * 1000 && queuedMs <= Date.now() + 60_000
            ? { createdAt: new Date(queuedMs) } : {}),
          userId:             job?.userId ?? sessionUser!.id, // the job's owner, even when an admin polls it
          prompt,
          imageUrl:           img.url,
          model:              'wan-2.7-pro',
          ticketCost:         4,
          quality:            'auto',
          aspectRatio:        aspectRatio || '16:9',
          referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls : [],
          expiresAt:          new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        })))
      } catch (dbErr) {
        // Rolled back, job still processing: the next poll or the harvester saves it
        console.error('wan-27-pro-status: DB save failed, will retry:', dbErr)
        return jsonPrivate({ status: 'in_progress', error: 'Saving the result - retrying' })
      }
      if (!saved.saved) return jsonPrivate({ status: 'failed', error: saved.error })
      if (!saved.fresh) {
        return jsonPrivate({
          status: 'completed',
          images: saved.images.map(img => ({ url: img.imageUrl, dbId: img.id })),
        })
      }

      console.log(`✓ Wan 2.7 Pro completed [${requestId}] ${hostedImages.length} image(s)`)
      return jsonPrivate({
        status: 'completed',
        images: hostedImages.map((img, i) => ({ ...img, dbId: saved.images[i]?.id ?? null })),
      })

    } else if ((status as any).status === 'ERROR' || (status as any).status === 'FAILED') {
      return jsonPrivate(await failPolledJob(requestId, 'Generation failed on FAL servers'))
    } else {
      return jsonPrivate({ status: 'in_progress', falStatus: status.status })
    }

  } catch (error: any) {
    console.error('wan-27-pro-status error:', error)
    if (error.status === 422 || error.constructor?.name === 'ValidationError') {
      const detail = Array.isArray(error.body?.detail)
        ? error.body.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ')
        : error.body?.message || error.message || 'Unprocessable content'
      if (requestId) return jsonPrivate(await failPolledJob(requestId, `Generation failed: ${detail}`))
      return jsonPrivate({ status: 'failed', error: `Generation failed: ${detail}` })
    }
    // fal's own 404 / 410 for an older job: the result is gone for good
    if (requestId && pollErrorIsGone(error, job)) {
      return jsonPrivate(await failPolledJob(requestId, 'Generation request expired or not found'))
    }
    return jsonPrivate({ status: 'in_progress', error: error.message })
  }
}
