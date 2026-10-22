import { NextResponse } from 'next/server'
import { fal } from '@/lib/fal-client'
import prisma from '@/lib/prisma'
import { releaseQueueSlot } from '@/lib/admin-queue-helpers'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { uploadToR2 } from '@/lib/r2'
import { jsonPrivate } from '@/lib/api-json'
import { fetchMedia } from '@/lib/media-fetch'
import { isHiggsfieldEndpoint } from '@/lib/higgsfield-models'
import { isRunpodEndpoint } from '@/lib/runpod-video-models'

fal.config({ credentials: process.env.FAL_KEY! })

// POST /api/admin/video-status
// Polls a FAL queue video job and saves to DB on completion.
// Requires a valid session — previously anyone with a requestId+falEndpoint could
// drive fal.queue.result + an R2 upload here.
export async function POST(req: Request) {
  let requestId: string | undefined
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null
    if (!sessionUser) {
      return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json()
    requestId = body.requestId
    const { falEndpoint, prompt, model, duration, resolution, ticketCost, aspectRatio, audioEnabled, startFrameUrl, endFrameUrl, motionVideoUrl, keepOriginalSound, characterOrientation } = body
    if (!requestId || !falEndpoint) {
      return jsonPrivate({ error: 'Missing requestId or falEndpoint' }, { status: 400 })
    }

    // A Higgsfield job (admin exclusives, 2026-10-13): lib/higgsfield settles it
    if (isHiggsfieldEndpoint(falEndpoint)) {
      const row = await prisma.generationQueue.findFirst({
        where: { falRequestId: requestId },
        select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, falRequestId: true, parameters: true, status: true, errorMessage: true },
        orderBy: { id: 'desc' },
      })
      if (!row || row.userId !== sessionUser.id) return jsonPrivate({ status: 'failed', error: 'Unknown job' })
      if (row.status === 'failed') return jsonPrivate({ status: 'failed', error: row.errorMessage || 'Generation failed' })
      const { settleHiggsfieldRow } = await import('@/lib/higgsfield')
      const out = await settleHiggsfieldRow(row)
      if (out.status === 'completed') return jsonPrivate({ status: 'completed', videoUrl: out.urls[0], videoId: out.imageIds[0] ?? null })
      if (out.status === 'failed') return jsonPrivate({ status: 'failed', error: out.error })
      return jsonPrivate({ status: 'in_progress' })
    }

    // A job on our own RunPod workers (MoCha, 2026-10-22): lib/runpod-video settles it
    if (isRunpodEndpoint(falEndpoint)) {
      const row = await prisma.generationQueue.findFirst({
        where: { falRequestId: requestId },
        select: { id: true, userId: true, modelId: true, modelType: true, prompt: true, ticketCost: true, createdAt: true, startedAt: true, falRequestId: true, parameters: true, status: true, errorMessage: true },
        orderBy: { id: 'desc' },
      })
      if (!row || row.userId !== sessionUser.id) return jsonPrivate({ status: 'failed', error: 'Unknown job' })
      if (row.status === 'failed') return jsonPrivate({ status: 'failed', error: row.errorMessage || 'Generation failed' })
      const { settleRunpodRow } = await import('@/lib/runpod-video')
      const out = await settleRunpodRow(row)
      if (out.status === 'completed') return jsonPrivate({ status: 'completed', videoUrl: out.urls[0], videoId: out.imageIds[0] ?? null })
      if (out.status === 'failed') return jsonPrivate({ status: 'failed', error: out.error })
      return jsonPrivate({ status: 'in_progress' })
    }

    const status = await fal.queue.status(falEndpoint, { requestId, logs: false })

    if (status.status === 'COMPLETED') {
      // A finished job whose result IS an error is final (2026-10-22: Wan VACE
      // Edit runs that crashed at fal answer COMPLETED, then 500 "Internal Server
      // Error" for the result - read as a network blip, the tile polled on for
      // ever beside the error tile the cron had already made). Only a reply
      // without a status (the network itself) is worth asking again.
      let result: any
      try {
        result = await fal.queue.result<any>(falEndpoint, { requestId })
      } catch (e: any) {
        if (typeof e?.status !== 'number') throw e
        const raw = typeof e.body?.detail === 'string' ? e.body.detail
          : Array.isArray(e.body?.detail) ? e.body.detail.map((d: any) => d?.msg || d?.message).filter(Boolean).join('; ')
          : e.message || `HTTP ${e.status}`
        const { friendlyFalVideoError } = await import('@/lib/fal-friendly-errors')
        const detail = friendlyFalVideoError(raw)
        await releaseQueueSlot(requestId, true, `Generation failed: ${detail}`)
        return jsonPrivate({ status: 'failed', error: `Generation failed: ${detail}` })
      }
      // Some endpoints return the video as a one-item list
      const falVideoUrl: string | undefined = result.data?.video?.url ?? result.data?.video?.[0]?.url ?? result.data?.videos?.[0]?.url
      // A SeeDance 2.5 draft: its id is what "Complete in 1080p" re-renders
      const draftId: string | null = result.data?.draft_id ? String(result.data.draft_id) : null
      if (!falVideoUrl) {
        return jsonPrivate({ status: 'failed', error: 'No video URL in FAL result' })
      }

      // Saved exactly once (lib/video-save-guard): fal's file has to answer,
      // then one call claims the job and only that call downloads and saves
      const claim = await (await import('@/lib/video-save-guard')).claimVideoSave(requestId, falVideoUrl)
      if (claim.kind === 'saved') {
        console.log(`⚡ Video already saved [${requestId}] — returning cached result`)
        return jsonPrivate({ status: 'completed', videoUrl: claim.imageUrl, videoId: claim.id, draft: !!draftId })
      }
      if (claim.kind === 'wait') return jsonPrivate({ status: 'in_progress' })
      if (claim.kind === 'failed') return jsonPrivate({ status: 'failed', error: claim.error })

      console.log(`✓ Video generation completed [${requestId}] model=${model} duration=${duration} url=${falVideoUrl}`)

      // Its real length, measured: clip tools (Wan Animate, Recast...) have no
      // length picker, so the page's number was the composer's leftover "5"
      // and a 14s swap was recorded - and shown in its popup - as 5s
      const measuredSec = (await (await import('@/lib/video-probe')).probeRemoteVideo(falVideoUrl).catch(() => null))?.seconds
      const savedDuration = measuredSec && measuredSec > 0 ? String(Math.max(1, Math.round(measuredSec))) : (duration || '5')

      // Upload video to Vercel Blob for permanent storage (FAL URLs expire after ~24–48h)
      let permanentVideoUrl = falVideoUrl
      try {
        // Bounded: a hung download used to hold every poll at once
        const videoRes = await fetchMedia(falVideoUrl, { signal: AbortSignal.timeout(240_000) })
        if (videoRes.ok) {
          const contentType = videoRes.headers.get('content-type') || 'video/mp4'
          const ext = contentType.includes('webm') ? 'webm' : 'mp4'
          let videoBuffer = Buffer.from(await videoRes.arrayBuffer())
          /*
           * VOID writes its result at 12 fps but reads the source at the
           * source's own rate, so it plays at half speed for a 24 fps clip.
           * Re-time it back (timestamps only - no re-encode) from the frame
           * rate the generate route measured and stored on the job. (Same as
           * /api/video/status - this is the route the portal polls.)
           */
          if (model === 'void-video-removal') {
            try {
              const job = await prisma.generationQueue.findFirst({ where: { falRequestId: requestId }, select: { parameters: true } })
              const srcFps = Number((job?.parameters as { sourceFps?: number } | null)?.sourceFps) || 24
              const { VOID_OUTPUT_FPS } = await import('@/lib/batch-1003-video')
              if (Math.abs(srcFps - VOID_OUTPUT_FPS) > 0.5) {
                const { retimeVideo } = await import('@/lib/video-probe')
                videoBuffer = Buffer.from(await retimeVideo(videoBuffer, VOID_OUTPUT_FPS / srcFps))
              }
            } catch (e) {
              console.error('[admin/video-status] VOID re-time failed (keeping the timing fal returned):', e)
            }
          }
          const filename = `video-admin-${Date.now()}.${ext}`
          // Index first, so it plays as soon as it starts downloading (several
          // models put it at the end - lib/video-probe faststart; a remux, not a re-encode)
          if (ext === 'mp4') {
            const { faststart } = await import('@/lib/video-probe')
            videoBuffer = Buffer.from(await faststart(videoBuffer))
          }
          permanentVideoUrl = await uploadToR2(filename, videoBuffer, contentType)
          console.log(`[admin/video-status] Uploaded video to blob: ${permanentVideoUrl}`)
        }
      } catch (uploadErr) {
        console.error('[admin/video-status] Failed to upload video to blob (using FAL URL as fallback):', uploadErr)
      }

      // Its Frames ZIP, when the run asked for one (Wan Animate - lib/frames-zip)
      const framesZip = await (await import('@/lib/frames-zip')).keepFramesZip(result.data)

      // Save to DB under the session user
      let savedVideoId: number | null = null
      try {
        if (!sessionUser) {
          console.error('Admin video-status: no session user — skipping DB save')
        } else {
          // Queue time for the feed's ordering key: completion order is not
          // the order things were asked for.
          const queueRow = await prisma.generationQueue.findFirst({
            where: { falRequestId: requestId },
            select: { createdAt: true, parameters: true },
            orderBy: { id: 'desc' },
          })
          const created = await prisma.generatedImage.create({
            data: {
              ...(queueRow ? { createdAt: queueRow.createdAt } : {}),
              userId:      sessionUser.id,
              prompt:      prompt || '',
              imageUrl:    permanentVideoUrl,
              model:       model || 'wan-2.5',
              quality:     draftId ? 'draft' : (resolution || '1080p'),
              aspectRatio: aspectRatio || '16:9',
              ticketCost:  ticketCost || 0,
              expiresAt:   new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
              falRequestId: requestId,
              videoMetadata: {
                duration:             savedDuration,
                resolution:           draftId ? 'draft' : (resolution || '1080p'),
                aspectRatio:          aspectRatio || '16:9',
                isVideo:              true,
                ...(draftId ? { seedanceDraftId: draftId } : {}),
                audioEnabled:         audioEnabled ?? false,
                startFrameUrl:        startFrameUrl || null,
                endFrameUrl:          endFrameUrl || null,
                motionVideoUrl:       motionVideoUrl || null,
                keepOriginalSound:    keepOriginalSound ?? true,
                characterOrientation: characterOrientation || null,
                ...(framesZip ? { framesZip } : {}),
                // What it was given (lib/gen-inputs), as the route kept it on the queue row
                ...(() => { const i = (queueRow?.parameters as { inputs?: unknown } | null)?.inputs; return i && typeof i === 'object' ? { inputs: i } : {} })(),
              } as any,
            },
            select: { id: true },
          })
          savedVideoId = created.id
          /*
           * Two overlapping polls (a second tab, a restored session) can both
           * get past the "already completed" probe and both save - VOID came
           * back twice on 2026-10-04. The lowest id wins; a later twin removes
           * itself and answers with the survivor.
           */
          const first = await prisma.generatedImage.findFirst({
            where: { falRequestId: requestId, isDeleted: false },
            orderBy: { id: 'asc' },
            select: { id: true, imageUrl: true },
          })
          if (first && first.id !== created.id) {
            await prisma.generatedImage.delete({ where: { id: created.id } }).catch(() => {})
            savedVideoId = first.id
            permanentVideoUrl = first.imageUrl
          }
        }
      } catch (dbErr) {
        console.error('Admin video-status: failed to save to DB (non-fatal):', dbErr)
      }

      // (The job was settled by the claim above)
      // draft: the session tile marks itself a draft so its viewer offers "Complete in 1080p"
      return jsonPrivate({ status: 'completed', videoUrl: permanentVideoUrl, videoId: savedVideoId, draft: !!draftId, duration: savedDuration, ...(framesZip ? { framesZipUrl: framesZip.url } : {}) })

    } else if ((status as any).status === 'ERROR' || (status as any).status === 'FAILED') {
      await releaseQueueSlot(requestId, true, 'Video generation failed on FAL servers')
      return jsonPrivate({ status: 'failed', error: 'Video generation failed on FAL servers' })
    } else {
      // IN_QUEUE or IN_PROGRESS — keep polling
      return jsonPrivate({ status: 'in_progress', falStatus: status.status })
    }

  } catch (error: any) {
    console.error('Admin video status error:', error, 'body:', JSON.stringify(error.body))
    // 422 ValidationError = FAL rejected the job (bad input, unsupported format, content policy)
    // Treat these as permanent failures so the UI stops polling and shows the error.
    // A 400 / 403 on a finished job is final too (2026-10-21: Kling 4.0 answered
    // 403 "You are not on early access" - the tile span until its timeout)
    if (error.status === 422 || error.status === 400 || error.status === 403 || error.constructor?.name === 'ValidationError') {
      const rawDetail = Array.isArray(error.body?.detail)
        ? error.body.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ')
        : (typeof error.body?.detail === 'string' ? error.body.detail : '') || error.body?.message || error.message || 'Unprocessable content'
      const { friendlyFalVideoError } = await import('@/lib/fal-friendly-errors')
      const detail = friendlyFalVideoError(rawDetail)
      if (requestId) await releaseQueueSlot(requestId, true, `Generation failed: ${detail}`)
      return jsonPrivate({ status: 'failed', error: `Generation failed: ${detail}` })
    }
    // A job another poller (the cron) has already settled as failed is over -
    // say so, or this tile keeps "generating" beside its own error tile
    if (requestId) {
      const row = await prisma.generationQueue.findFirst({ where: { falRequestId: requestId }, select: { status: true, errorMessage: true }, orderBy: { id: 'desc' } }).catch(() => null)
      if (row?.status === 'failed') return jsonPrivate({ status: 'failed', error: row.errorMessage || 'Generation failed' })
    }
    // Return in_progress on transient network/server errors so the client keeps polling
    return jsonPrivate({ status: 'in_progress', error: error.message })
  }
}
