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

// POST /api/admin/wan-22-t2i-lora-status
// Polls a Wan 2.2 A14B text-to-image LoRA job. Output shape differs from most
// image endpoints: a SINGLE `image` object (not an images array) — normalized
// here. On completion re-hosts to R2 and saves the GeneratedImage record.
//
// 2026-10-23 billing sweep: the same shape as nb2-status now (lib/harvest-polling-jobs) -
// the job must be the caller's (admins: any) and fal is asked at the endpoint stored on the
// queue row; saved rows are looked for BEFORE any download; the save takes the shared lock
// and refuses a job already failed and refunded; a download hiccup keeps polling instead of
// refunding; and "not found" is final only when fal itself 404s an older job (it used to be
// any error whose message mentioned "not found" or "expired").
export async function POST(req: Request) {
  let requestId: string | undefined
  let job: PolledJobRow | null = null
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null

    const body = await req.json()
    requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    const { aspectRatio, loraName, queuedAt } = body
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
      const falImages: { url: string; width?: number; height?: number }[] =
        result.data?.images || (result.data?.image?.url ? [result.data.image] : [])

      if (falImages.length === 0) {
        return jsonPrivate(await failPolledJob(requestId, 'No images returned from model'))
      }

      const hostedImages: { url: string; width?: number; height?: number }[] = []
      for (let i = 0; i < falImages.length; i++) {
        try {
          const res = await fetch(falImages[i].url)
          if (!res.ok) continue
          const buffer = Buffer.from(await res.arrayBuffer())
          const url = await uploadToR2(`wan22lora-${Date.now()}-${i}.png`, buffer, 'image/png')
          hostedImages.push({ url, width: falImages[i].width, height: falImages[i].height })
        } catch (e) {
          console.error(`wan-22-t2i-lora-status: failed to re-host image ${i}:`, e)
        }
      }

      if (hostedImages.length === 0) {
        // A download / R2 hiccup is not the job failing - keep polling until fal has purged it
        if (polledJobIsStale(job)) return jsonPrivate(await failPolledJob(requestId, 'Failed to download generated images'))
        return jsonPrivate({ status: 'in_progress', error: 'Could not fetch the result yet - retrying' })
      }

      const queuedMs = typeof queuedAt === 'number' ? queuedAt : (job?.createdAt.getTime() ?? 0)

      let saved: Awaited<ReturnType<typeof savePolledImagesOnce>>
      try {
        saved = await savePolledImagesOnce(requestId, hostedImages.map(img => ({
          userId:      job?.userId ?? sessionUser!.id, // the job's owner, even when an admin polls it
          prompt,
          imageUrl:    img.url,
          model:       'wan-2.2-t2i-lora',
          ticketCost:  0,
          quality:     'auto',
          aspectRatio: aspectRatio || '1:1',
          expiresAt:   new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
          ...(queuedMs > Date.now() - 24 * 3600 * 1000 && queuedMs <= Date.now() + 60_000
            ? { createdAt: new Date(queuedMs) } : {}),
          ...(loraName ? { videoMetadata: { loraName: String(loraName).slice(0, 120) } } : {}),
        })))
      } catch (dbErr) {
        // Rolled back, job still processing: the next poll or the harvester saves it
        console.error('wan-22-t2i-lora-status: DB save failed, will retry:', dbErr)
        return jsonPrivate({ status: 'in_progress', error: 'Saving the result - retrying' })
      }
      if (!saved.saved) return jsonPrivate({ status: 'failed', error: saved.error })
      if (!saved.fresh) {
        return jsonPrivate({
          status: 'completed',
          images: saved.images.map(img => ({ url: img.imageUrl, dbId: img.id })),
        })
      }

      console.log(`✓ Wan 2.2 T2I LoRA completed [${requestId}] ${hostedImages.length} image(s)`)
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
    console.error('wan-22-t2i-lora-status error:', error)
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
