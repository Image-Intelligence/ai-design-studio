import { after } from 'next/server'
import { ensureThumbnail, prepareImageVariants, attachImageVariants, type ImageVariants } from '@/lib/thumbnail'
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

// POST /api/admin/nb2-status
// Polls a FAL queue NanoBanana 2 job. On completion, re-hosts images on Vercel Blob and saves to DB.
export async function POST(req: Request) {
  let requestId: string | undefined
  let job: PolledJobRow | null = null
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null

    const body = await req.json()
    requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    const { outputFormat, aspectRatio, quality, referenceImageUrls, ticketCost, queuedAt, videoMetadata } = body
    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    if (!requestId) {
      return jsonPrivate({ error: 'Missing requestId' }, { status: 400 })
    }

    /*
     * OWNER AND ENDPOINT FROM THE QUEUE ROW (2026-10-23 billing sweep).
     *
     * This route used to need no session at all and to ask fal at whatever
     * falEndpoint the body named, saving the result as the caller. Now the
     * caller must be signed in, the job must be theirs (admins: any), and fal
     * is asked at the endpoint the submit route stored (lib/harvest-polling-jobs).
     */
    const access = await authorizePolledJob(requestId, sessionUser, body.falEndpoint)
    if (!access.ok) return jsonPrivate({ error: access.error }, { status: access.status })
    job = access.row
    const falEndpoint = access.falEndpoint

    /*
     * IDEMPOTENCY FIRST — before asking fal, before fetching the result,
     * before re-hosting.
     *
     * This check used to sit AFTER the download-and-upload loop, so every
     * repeat poll of an already-finished job re-fetched each image from fal,
     * re-uploaded it to R2, and only then discovered the rows already
     * existed and threw all of it away. That is the whole reason a poll of a
     * completed job measured 12-16 seconds. Repeat polls are not rare: a
     * page reload re-arms a poller for every job it restores.
     *
     * One indexed lookup answers the same question for nothing.
     */
    const existing = await existingPolledImages(requestId).catch(() => [])
    if (existing.length > 0) {
      // The slot may still be held if an earlier poll died mid-flight.
      await releaseQueueSlot(requestId, false)
      return jsonPrivate({
        status: 'completed',
        images: existing.map(img => ({ url: img.imageUrl, dbId: img.id })),
      })
    }
    // Already failed (and so refunded) by another poll, the harvester or the
    // cron: say so - delivering it now would be a free generation.
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

      const format = outputFormat || 'png'
      // In parallel: a multi-image result was paying for each download and
      // upload end to end, and the poll is already the slow part of the loop.
      type Hosted = { url: string; width?: number; height?: number; variants?: ImageVariants | null }
      const hosted: (Hosted | null)[] = await Promise.all(falImages.map(async (falImg, i): Promise<Hosted | null> => {
        try {
          const res = await fetch(falImg.url)
          if (!res.ok) return null
          const buffer = Buffer.from(await res.arrayBuffer())
          const ext = format === 'jpeg' ? 'jpg' : format
          const filename = `nb2-${Date.now()}-${i}.${ext}`
          const [url, variants] = await Promise.all([
            uploadToR2(filename, buffer, `image/${format === 'jpeg' ? 'jpeg' : format}`),
            prepareImageVariants(buffer),
          ])
          return { url, width: falImg.width, height: falImg.height, variants }
        } catch (e) {
          console.error(`nb2-status: failed to re-host image ${i}:`, e)
          return null
        }
      }))
      const hostedImages = hosted.filter((h): h is Hosted => h !== null)

      if (hostedImages.length === 0) {
        // A download / R2 hiccup is not the job failing: refunding here while
        // another poll saved the picture was the "refunded AND delivered" bug
        // (2026-10-23 billing sweep). Keep polling - like the harvester, give
        // up only once fal will have purged the result.
        if (polledJobIsStale(job)) return jsonPrivate(await failPolledJob(requestId, 'Failed to download generated images'))
        return jsonPrivate({ status: 'in_progress', error: 'Could not fetch the result yet - retrying' })
      }

      // QUEUE TIME, EVEN WHEN THE CLIENT FORGETS IT.
      //
      // createdAt is the feed's ordering key, so a row saved at COMPLETION
      // time sorts by how fast the model happened to be rather than by the
      // order the user asked for. The client sends queuedAt from its slot,
      // but a slot restored after a reload often no longer carries one —
      // which is why tiles rearranged themselves on refresh. The queue row
      // knows.
      let queuedMs = typeof queuedAt === 'number' ? queuedAt : 0
      if (!queuedMs && job?.createdAt) queuedMs = job.createdAt.getTime()

      // ONE WRITER PER REQUEST ID, and never for a refunded job: the lock,
      // the re-check and the status flip all live in savePolledImagesOnce
      // (lib/harvest-polling-jobs), shared with the other status routes and
      // the harvester. Saved to the job's OWNER - an admin polling someone
      // else's job must not take their picture.
      let saved: Awaited<ReturnType<typeof savePolledImagesOnce>>
      try {
        saved = await savePolledImagesOnce(requestId, hostedImages.map(img => ({
          userId:             job?.userId ?? sessionUser!.id,
          prompt,
          imageUrl:           img.url,
          model:              'nano-banana-pro-2',
          ticketCost:         typeof ticketCost === 'number' ? ticketCost : 0,
          quality:            quality || 'auto',
          aspectRatio:        aspectRatio || 'auto',
          referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls : [],
          expiresAt:          new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
          // createdAt = when the user QUEUED the generation (the feed's
          // ordering key), not when it completed — keeps queue order
          // stable across refresh. Sanity-capped to the last 24h.
          ...(queuedMs > Date.now() - 24 * 3600 * 1000 && queuedMs <= Date.now() + 60_000
            ? { createdAt: new Date(queuedMs) } : {}),
          // Full generation settings for the info panel
          ...(videoMetadata && typeof videoMetadata === 'object'
            ? { videoMetadata: videoMetadata as object } : {}),
        })))
      } catch (dbErr) {
        // Nothing was written (the transaction rolled back) and the job is
        // still processing: the next poll, or the harvester, saves it.
        console.error('nb2-status: DB save failed, will retry:', dbErr)
        return jsonPrivate({ status: 'in_progress', error: 'Saving the result - retrying' })
      }
      if (!saved.saved) {
        return jsonPrivate({ status: 'failed', error: saved.error })
      }
      if (!saved.fresh) {
        // Another poller got there first - hand back ITS rows
        return jsonPrivate({
          status: 'completed',
          images: saved.images.map(img => ({ url: img.imageUrl, dbId: img.id })),
        })
      }

      // Thumbnail, display copy and dimensions BEFORE "completed" goes back
      // (lib/thumbnail); the background pass only as the fallback.
      await Promise.all(saved.images.map(async (img, k) => {
        if (!(await attachImageVariants(img.id, hostedImages[k]?.variants ?? null))) after(() => { void ensureThumbnail(img.id) })
      }))

      console.log(`✓ NanoBanana 2 completed [${requestId}] ${hostedImages.length} image(s)`)
      return jsonPrivate({
        status: 'completed',
        images: hostedImages.map((img, i) => ({ url: img.url, width: img.width, height: img.height, dbId: saved.images[i]?.id ?? null })),
      })

    } else if ((status as any).status === 'ERROR' || (status as any).status === 'FAILED') {
      return jsonPrivate(await failPolledJob(requestId, 'Generation failed on FAL servers'))
    } else {
      return jsonPrivate({ status: 'in_progress', falStatus: status.status })
    }

  } catch (error: any) {
    console.error('nb2-status error:', error)
    if (error.status === 422 || error.constructor?.name === 'ValidationError') {
      const detail = Array.isArray(error.body?.detail)
        ? error.body.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ')
        : error.body?.message || error.message || 'Unprocessable content'
      if (requestId) return jsonPrivate(await failPolledJob(requestId, `Generation failed: ${detail}`))
      return jsonPrivate({ status: 'failed', error: `Generation failed: ${detail}` })
    }
    // fal says the job is gone (its own 404 / 410, not just a message that
    // mentions "not found") - permanent failure
    if (requestId && pollErrorIsGone(error, job)) {
      return jsonPrivate(await failPolledJob(requestId, 'Generation request expired or not found'))
    }
    // Transient error — keep polling
    return jsonPrivate({ status: 'in_progress', error: error.message })
  }
}
