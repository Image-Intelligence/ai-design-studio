import { NextResponse } from 'next/server'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { cookies } from 'next/headers'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { savePolledImagesOnce, failPolledJob } from '@/lib/harvest-polling-jobs'
import { enforceContentFilter } from '@/lib/content-filter'
import { canonicalisePayload } from '@/lib/media-url'

fal.config({ credentials: process.env.FAL_KEY! })

const TEXT_ENDPOINT = 'fal-ai/gpt-image-2'
const EDIT_ENDPOINT = 'openai/gpt-image-2/edit'

function parseSize(size: string): { width: number; height: number } {
  const [w, h] = size.split('x').map(Number)
  return (w && h) ? { width: w, height: h } : { width: 1024, height: 1024 }
}

/*
 * Priced on what is really sent: a quality fal does not know is sent as
 * 'high' (below), so it is priced as high - it used to cost 1 ticket - and a
 * size outside the page's six is priced as the 4K one (the dearest), since
 * the run renders whatever WxH was asked. References are billed as input
 * tokens by the edit endpoint (~$0.01 each): one ticket per four.
 */
const GPT2_SIZES = new Set(['1024x1024', '1024x768', '1024x1536', '1920x1080', '2560x1440', '3840x2160'])
function computeGptTicketCost(rawQuality: string, rawSize: string, refs = 0): number {
  const quality = ['low', 'medium', 'high'].includes(rawQuality) ? rawQuality : 'high'
  const size = GPT2_SIZES.has(rawSize) ? rawSize : '3840x2160'
  return gptBaseTicketCost(quality, size) + Math.ceil(Math.max(0, Math.min(8, refs)) / 4)
}
function gptBaseTicketCost(quality: string, size: string): number {
  if (quality === 'low') return 1
  if (quality === 'medium') {
    if (size === '1024x1024' || size === '2560x1440') return 3
    if (size === '3840x2160') return 4
    return 2
  }
  if (quality === 'high') {
    if (size === '1024x1024') return 8
    if (size === '2560x1440') return 9
    if (size === '3840x2160') return 15
    return 6
  }
  return 1
}

// POST /api/admin/gpt-image-2-stream
//
// SSE flow:
//   1. { type: 'submitted', requestId, falEndpoint }  — sent immediately after fal.queue.submit()
//   2. { type: 'complete', images, permanentReferenceUrls } — final R2-hosted images + DB IDs
//      OR { type: 'error', error }
//
// Uses queue submit (not fal.stream) so requestId is always available immediately for slot persistence.
export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  const sessionUser = token ? await getUserFromSession(token) : null

  if (!sessionUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (await isGenerationBlocked(sessionUser.email)) {
    return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
  }

  const body = canonicalisePayload(await req.json())
  const {
    prompt,
    quality = 'high',
    size = '1024x1024',
    outputFormat = 'png',
    referenceImages = [],
    referenceImageUrls = [],
  } = body

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const userId = sessionUser.id

  // Server-side concurrency check FIRST — the old order deducted tickets and
  // then rejected on concurrency WITHOUT refunding (charged for nothing)
  const { allowed, activeCount, limit } = await checkUserConcurrency(userId)
  if (!allowed) {
    return NextResponse.json(
      { error: `Queue full (${activeCount}/${limit} active). Wait for a generation to finish.` },
      { status: 429 }
    )
  }

  // Server-side ticket check — compute cost from quality + size, do not trust client value
  const refCount = (Array.isArray(referenceImages) ? referenceImages.length : 0) + (Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0)
  const ticketCost = computeGptTicketCost(String(quality), String(size), refCount)
  // CCBill content filter — must pass BEFORE any charge or provider submit
  {
    const _cf = await enforceContentFilter(prompt, sessionUser.email)
    if (!_cf.ok) return NextResponse.json({ error: _cf.reason }, { status: 400 })
  }
  const ticketResult = await deductGenerationTickets(userId, sessionUser.email, ticketCost)
  if (!ticketResult.ok) {
    return NextResponse.json(
      { error: `Insufficient tickets — need ${ticketResult.need}, have ${ticketResult.have}` },
      { status: 402 },
    )
  }
  /*
   * What was actually taken (2026-10-23 billing sweep): owner emails are not
   * charged (newBalance -1), and the row's ticketCost is what a failure gives
   * back - storing the price for them minted tickets on every failed run.
   */
  const charged = ticketResult.newBalance >= 0 ? ticketCost : 0
  const encoder = new TextEncoder()
  const safeFormat = ['jpeg', 'png', 'webp'].includes(outputFormat) ? outputFormat : 'png'
  // FAL only accepts low/medium/high
  const VALID_QUALITIES = ['low', 'medium', 'high']
  const safeQuality = VALID_QUALITIES.includes(quality) ? quality : 'high'

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
      }
      let submittedEventSent = false
      // Tickets this stream itself must give back (set once fal has the job and no row could be made)
      let refundOwed = 0
      const giveBackOnce = async () => {
        if (refundOwed > 0) { const n = refundOwed; refundOwed = 0; await refundGenerationTickets(userId, sessionUser.email, n) }
      }

      try {
        console.log(`GPT Image 2 stream: quality=${quality}→${safeQuality} size=${size} format=${safeFormat} refs=${referenceImages.length}`)
        const { width, height } = parseSize(size)
        const hasRefImages = Array.isArray(referenceImages) && referenceImages.length > 0
        const permanentReferenceUrls: string[] = [...referenceImageUrls]

        let endpoint: string
        let input: Record<string, unknown>

        if (hasRefImages) {
          const falUrls: string[] = []
          for (let i = 0; i < referenceImages.slice(0, 8).length; i++) {
            const img = referenceImages[i] as string
            try {
              // Library refs arrive as permanent https URLs — pass them straight
              // to fal (it fetches URLs natively). Base64-decoding a URL string
              // would upload garbage bytes the model can't read.
              if (img.startsWith('http')) {
                falUrls.push(img)
                if (!permanentReferenceUrls.includes(img)) permanentReferenceUrls.push(img)
                continue
              }
              const base64 = img.startsWith('data:') ? img.split(',')[1] : img
              const mimeType = img.startsWith('data:') ? img.split(';')[0].replace('data:', '') : 'image/jpeg'
              const buffer = Buffer.from(base64, 'base64')
              const blob = new Blob([buffer], { type: mimeType })
              const falUrl = await fal.storage.upload(blob)
              falUrls.push(falUrl)
              if (!permanentReferenceUrls[i]) {
                const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
                const r2Url = await uploadToR2(`ref-gpt2-${Date.now()}-${i}.${ext}`, buffer, mimeType)
                permanentReferenceUrls.push(r2Url)
              }
            } catch (e) {
              console.error(`gpt-image-2-stream: failed to upload ref image ${i}:`, e)
            }
          }
          // If every ref failed to upload, the edit endpoint would 422 on an empty
          // image_urls — fail fast with an actionable message (and refund) instead.
          if (falUrls.length === 0) {
            if (charged > 0) await refundGenerationTickets(userId, sessionUser.email, charged)
            send({ type: 'error', error: 'Your reference image(s) couldn\'t be uploaded to the model. Remove and re-add them, then try again.' })
            return
          }
          endpoint = EDIT_ENDPOINT
          input = {
            prompt: prompt.trim(),
            image_urls: falUrls,
            quality: safeQuality,
            output_format: safeFormat,
          }
        } else {
          endpoint = TEXT_ENDPOINT
          // Text endpoint does not support output_format
          input = {
            prompt: prompt.trim(),
            quality: safeQuality,
            width,
            height,
            n: 1,
          }
        }

        // Submit to FAL queue — gives us a real requestId immediately (same as submit route)
        const submitted = await fal.queue.submit(endpoint, { input })
        const requestId = submitted.request_id

        console.log(`GPT Image 2 queued requestId=${requestId} endpoint=${endpoint}`)

        // Create a GenerationQueue entry so the active count is visible cross-device
        let queueEntryId: number | null = null
        try {
          const queueEntry = await prisma.generationQueue.create({
            data: {
              userId,
              modelId:     'gpt-image-2',
              modelType:   'image',
              prompt:      prompt.trim(),
              /*
               * chargeMode 'deduct': charged above, at submit - so a failure REFUNDS
               * it, and the cron's lost-webhook pass (reserve-model jobs only) never
               * finalizes it a second time. usePolling: if this stream dies, the
               * page's gpt-image-2-status poll and the cron harvest finish the job.
               * slotClaimed false: the stream never takes a fal slot, so settling
               * it gives none back (lib/admin-queue-helpers holdsFalSlot).
               */
              parameters:  { falEndpoint: endpoint, falInput: input, size, quality: safeQuality, ticketCost: charged, chargeMode: 'deduct', usePolling: true, slotClaimed: false } as any,
              status:      'processing',
              ticketCost:  charged,
              falRequestId: requestId,
              startedAt:   new Date(),
            },
            select: { id: true },
          })
          queueEntryId = queueEntry.id
        } catch (dbErr) {
          console.error('gpt-image-2-stream: queue entry creation failed (non-fatal):', dbErr)
        }
        // Without a row nobody else can settle this job: its tickets are this stream's to give back
        refundOwed = queueEntryId ? 0 : charged
        /** A failure: through the status-guarded refund when there is a row, else this stream refunds once. */
        const failJob = async (error: string) => {
          if (queueEntryId) {
            const r = await failPolledJob(requestId, error)
            // Another writer finished it after all - deliver what it saved
            if (r.status === 'completed') return r
          } else {
            await giveBackOnce()
          }
          return null
        }

        // Send 'submitted' immediately — client writes slot to sessionStorage
        submittedEventSent = true
        send({ type: 'submitted', requestId, falEndpoint: endpoint, permanentReferenceUrls })

        // Poll until FAL job completes (max ~4 minutes, 5s intervals = 48 polls)
        let result: any = null
        for (let i = 0; i < 48; i++) {
          await new Promise(r => setTimeout(r, 5000))
          const status = await fal.queue.status(endpoint, { requestId, logs: false })
          if ((status as any).status === 'COMPLETED') {
            result = await fal.queue.result<any>(endpoint, { requestId })
            break
          } else if ((status as any).status === 'ERROR' || (status as any).status === 'FAILED') {
            const done = await failJob('Generation failed on FAL servers')
            if (done?.status === 'completed') { send({ type: 'complete', requestId, images: done.images, permanentReferenceUrls }); return }
            send({ type: 'error', error: 'Generation failed on FAL servers' })
            return
          }
        }

        if (!result) {
          /*
           * Still rendering after 4 minutes: NOT a failure (2026-10-23 review).
           * Failing it here refunded nothing and made the status route refuse to
           * save it, so a paid image that finished at minute 5 was lost. The row
           * stays 'processing' (usePolling): the page's poll or the cron harvest
           * saves it, or refunds it if fal really fails. No row: refund now.
           */
          if (!queueEntryId) { await giveBackOnce(); send({ type: 'error', error: 'Generation timed out - your tickets are back' }); return }
          send({ type: 'error', error: 'Still rendering - it will appear in your feed when it is done' })
          return
        }

        const falImages: { url?: string; content_type?: string }[] =
          result?.images || result?.data?.images || []

        if (falImages.length === 0) {
          const done = await failJob('No images returned from model')
          if (done?.status === 'completed') { send({ type: 'complete', requestId, images: done.images, permanentReferenceUrls }); return }
          send({ type: 'error', error: 'No images returned from model' })
          return
        }

        // Send a partial event immediately with the temporary FAL URL so the image
        // appears in the UI right away with the scan-reveal animation, while R2 upload runs.
        const firstFalUrl = falImages[0]?.url
        if (firstFalUrl && !firstFalUrl.startsWith('data:')) {
          send({ type: 'partial', url: firstFalUrl })
        }

        const hostedImages: { url: string }[] = []
        for (let i = 0; i < falImages.length; i++) {
          const falImg = falImages[i]
          try {
            let buffer: Buffer
            let mimeType = falImg.content_type || `image/${safeFormat}`
            if (falImg.url?.startsWith('data:')) {
              const base64 = falImg.url.split(',')[1]
              buffer = Buffer.from(base64, 'base64')
              mimeType = falImg.url.split(';')[0].replace('data:', '') || `image/${safeFormat}`
            } else if (falImg.url) {
              const res = await fetch(falImg.url)
              if (!res.ok) continue
              buffer = Buffer.from(await res.arrayBuffer())
              mimeType = res.headers.get('content-type') || mimeType
            } else {
              continue
            }
            const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('jpeg') ? 'jpg' : 'png'
            const url = await uploadToR2(`gpt-image-2-${Date.now()}-${i}.${ext}`, buffer, mimeType)
            hostedImages.push({ url })
          } catch (e) {
            console.error(`gpt-image-2-stream: failed to re-host image ${i}:`, e)
          }
        }

        if (hostedImages.length === 0) {
          // Re-hosting failed: the page's poll / the cron harvest retries the save (the row stays processing)
          if (!queueEntryId) await giveBackOnce()
          send({ type: 'error', error: queueEntryId ? 'Saving the image is taking longer - it will appear in your feed' : 'Failed to download generated images - your tickets are back' })
          return
        }

        /*
         * One save per job (2026-10-23 billing sweep): through the same lock and
         * status flip as the gpt-image-2-status poll and the cron harvest, so
         * racing savers make one set of rows, and a job already failed (refunded)
         * is not delivered for free.
         */
        const rows = hostedImages.map(img => ({
          userId,
          prompt:             prompt.trim(),
          imageUrl:           img.url,
          model:              'gpt-image-2',
          ticketCost:         charged,
          quality:            safeQuality,
          aspectRatio:        size || '1024x1024',
          referenceImageUrls: Array.isArray(permanentReferenceUrls) ? permanentReferenceUrls : [],
          expiresAt:          new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        }))
        const saved = await savePolledImagesOnce(requestId, rows).catch(e => {
          console.error('gpt-image-2-stream: DB save failed - the poll / harvest retries it:', e)
          return null
        })
        if (!saved) {
          send({ type: 'error', error: 'Saving the image is taking longer - it will appear in your feed' })
          return
        }
        if (!saved.saved) {
          send({ type: 'error', error: saved.error })
          return
        }
        console.log(`✓ GPT Image 2 completed [${requestId}] ${saved.images.length} image(s)`)
        send({
          type: 'complete',
          requestId,
          images: saved.images.map(img => ({ url: img.imageUrl, dbId: img.id })),
          permanentReferenceUrls,
        })
      } catch (err: any) {
        console.error('gpt-image-2-stream error:', err, 'body:', JSON.stringify(err?.body))
        const { friendlyFalError, extractFalErrorDetail } = await import('@/lib/fal-friendly-errors')
        send({ type: 'error', error: friendlyFalError(extractFalErrorDetail(err)) })
        // Before fal took it: refund here. After: the row's poll / harvest settles it
        // (status-guarded), and a job with no row was refunded by giveBackOnce paths.
        if (!submittedEventSent && charged > 0) {
          await refundGenerationTickets(userId, sessionUser.email, charged)
        } else {
          await giveBackOnce()
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
