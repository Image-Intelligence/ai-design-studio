import { LAYERIZE_MODELS, saveLayerizeResult } from '@/lib/layerize-save'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import prisma from '@/lib/prisma'
import { promoteNextQueuedJob, releaseHeldSlots } from '@/lib/fal-queue'
import { chargeModeOf, returnJobTickets } from '@/lib/queue-settle'
import { getTrainerFamily } from '@/lib/trainer-families'
import { falDetailMessage } from '@/lib/fal-error'
import { ensureThumbnail, prepareImageVariants, attachImageVariants } from '@/lib/thumbnail'

/**
 * Give back the slots a settled job held - only those, floored at 0
 * (lib/fal-queue heldSlots) - then let the next queued job in. The old code
 * decremented BOTH counters unfloored for every job, though SeeDream 5 /
 * Recraft bump only the global one and legacy canvas rows bumped none
 * (2026-10-23 billing sweep). Winner of the row's status flip only.
 */
async function releaseHeldSlotsAndPromote(row: { modelId: string; parameters: unknown; status: string }): Promise<void> {
  await releaseHeldSlots(row)
  await promoteNextQueuedJob()
}

/** The statuses a fal job can still be settled from. Anything else (completed, failed, cancelled) is final. */
const OPEN_STATUSES = ['queued', 'processing']

/** The parts of a fal webhook body this handler reads. */
export type FalWebhookBody = {
  request_id?: string
  status?: string
  payload?: any
  error?: any
}

/**
 * What handleFalWebhook did - for the cron's lost-webhook settler, which calls
 * it in-process (app/api/cron/drain-queue) with a body built from fal's queue
 * API, so the claim, the save and the charge are the same code either way.
 */
export type FalWebhookOutcome = 'completed' | 'failed' | 'skipped' | 'lora' | 'not-found' | 'bad-request' | 'unknown-status'

// FAL.ai calls this endpoint when an async job completes or fails.
// We must return 200 quickly — FAL.ai will retry on non-200 responses.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('=== FAL.AI WEBHOOK RECEIVED ===')
    console.log('request_id:', body.request_id)
    console.log('status:', body.status)
    const outcome = await handleFalWebhook(body)
    if (outcome === 'bad-request') return NextResponse.json({ error: 'Missing request_id' }, { status: 400 })
    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('FAL.ai webhook error:', err)
    // Return 200 to prevent FAL.ai from retrying endlessly on our internal errors
    return NextResponse.json({ received: true })
  }
}

/**
 * The webhook's whole job, minus the HTTP. Exported (2026-10-23 billing
 * sweep) so the cron can settle a job whose webhook never arrived through the
 * very same claim / save / charge path instead of a second copy of it.
 */
export async function handleFalWebhook(body: FalWebhookBody): Promise<FalWebhookOutcome> {
  {
    const { request_id, status, payload, error } = body

    if (!request_id) {
      console.error('Webhook missing request_id')
      return 'bad-request'
    }

    // Look up the queue entry by falRequestId
    const queueItem = await prisma.generationQueue.findFirst({
      where: { falRequestId: request_id }
    })

    if (!queueItem) {
      // Check if this is a LoRA training job
      const loraJob = await prisma.loraTrainingJob.findFirst({
        where: { requestId: request_id },
      })

      if (loraJob) {
        console.log(`Found LoRA training job #${loraJob.id} for request_id: ${request_id}`)

        /*
         * fal's cancel is a request, not an immediate stop, so a run cancelled
         * near the end can still finish and call this. Re-hosting it would
         * file a result the user explicitly said they did not want.
         */
        if (loraJob.status === 'cancelled') {
          console.log(`LoRA job #${loraJob.id} was cancelled — ignoring this callback`)
          return 'lora'
        }

        if (status === 'ERROR' || status === 'FAILED' || error) {
          /*
           * Prefer the body over the client's summary. A dataset refusal
           * arrives here as `error: "Unexpected status code: 422"` with the
           * whole diagnosis sitting in `payload.detail` - and because this
           * write marks the job failed, the status poller's reader never runs
           * and that summary is what the user is left with.
           */
          const errorMsg = falDetailMessage(payload)
            ?? falDetailMessage(error)
            ?? (error?.message || error || 'FAL training failed')
          await prisma.loraTrainingJob.update({
            where: { id: loraJob.id },
            data: { status: 'failed', errorMsg },
          })
          console.log(`LoRA job #${loraJob.id} marked failed: ${errorMsg}`)
        } else if (status === 'OK' || status === 'COMPLETED') {
          const data = payload as Record<string, { url?: string } | null> | null
          console.log('[lora-webhook] payload keys:', data ? Object.keys(data) : 'null')
          console.log('[lora-webhook] payload sample:', JSON.stringify(data).substring(0, 500))
          // Try multiple field names — different trainers use different keys
          const loraUrl   = data?.diffusers_lora_file?.url
            ?? data?.lora_file?.url
            ?? data?.safetensors_lora_file?.url
            ?? data?.output_lora_file?.url
            ?? null
          const configUrl = data?.config_file?.url ?? null
          // Trainer families (wan22/ltx2): capture EVERY output file url so
          // finalize can re-host multi-file outputs (e.g. high_noise_lora)
          const family = getTrainerFamily(loraJob.modelId)
          const jobConfig = (loraJob.config ?? {}) as Record<string, unknown>
          const resultUrls: Record<string, string> = {}
          if (family && data) {
            for (const f of family.outputFiles) {
              const u = data[f.key]?.url
              if (u) resultUrls[f.key] = u
            }
          }
          /*
           * No weights in an OK callback means the run produced nothing; the
           * reason, if there is one, is in the same payload. Recording that as
           * "completed" leaves a job that looks finished and has no LoRA.
           */
          if (!loraUrl) {
            const why = falDetailMessage(data) ?? 'the trainer returned no weights'
            await prisma.loraTrainingJob.update({
              where: { id: loraJob.id },
              data: { status: 'failed', errorMsg: why },
            })
            console.log(`LoRA job #${loraJob.id} finished with no weights: ${why}`)
            return 'lora'
          }
          await prisma.loraTrainingJob.update({
            where: { id: loraJob.id },
            data: {
              status: 'completed', loraUrl, configUrl,
              ...(family ? { config: { ...jobConfig, _result: resultUrls } as object } : {}),
            },
          })
          console.log(`LoRA job #${loraJob.id} completed — loraUrl: ${loraUrl}`)
          // Kick artifact re-hosting to R2 (idempotent; status poller also kicks)
          if (family) {
            after(async () => {
              const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://prompt-protocol.vercel.app'
              await fetch(`${base}/api/admin/lora-training/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD ?? '' },
                body: JSON.stringify({ jobId: loraJob.id }),
                signal: AbortSignal.timeout(10_000),
              }).catch(() => {})
            })
          }
        }

        return 'lora'
      }

      console.error(`No queue item or LoRA job found for request_id: ${request_id}`)
      // Return 200 anyway — if we return non-200 FAL.ai retries indefinitely
      return 'not-found'
    }

    // Idempotency: ONE delivery handles a job.
    //
    // fal re-sends a webhook it thinks went unanswered - and saving a big
    // picture (download, R2 upload, thumbnails) can outlast its wait. The old
    // guard only skipped a SETTLED row ('processing' -> 'processing' matched
    // every delivery still in flight), so a re-send that arrived mid-save
    // saved the picture again: 2026-10-23, three NanoBanana 2.1 Edit jobs on
    // dirtysecretai@ became six tiles, byte-identical copies 10-70 s apart.
    // Now the first delivery stamps the row (webhookClaimAt) in one atomic
    // UPDATE and every other one skips; a claim older than five minutes is
    // taken as dead (the function timed out mid-save) and may be retaken.
    // 'cancelled' is final too (2026-10-23 billing sweep): an admin cancel has
    // already given the tickets back, so a late result must not be saved or
    // charged.
    const claimNow = Date.now()
    const claimed = await prisma.$executeRaw`
      UPDATE "GenerationQueue"
      SET parameters = jsonb_set(COALESCE(parameters::jsonb, '{}'::jsonb), '{webhookClaimAt}', to_jsonb(${claimNow}::bigint))
      WHERE id = ${queueItem.id}
        AND status NOT IN ('completed', 'failed', 'cancelled')
        AND (parameters->>'webhookClaimAt' IS NULL OR (parameters->>'webhookClaimAt')::bigint < ${claimNow - 5 * 60_000}::bigint)`
    if (claimed === 0) {
      console.log(`Queue item #${queueItem.id} already settled or being handled by another delivery — skipping`)
      return 'skipped'
    }
    // A retaken claim whose first delivery saved before dying: settle the job
    // with those rows instead of saving the pictures again (success path below)
    const alreadySaved = await prisma.generatedImage.findMany({
      where: { falRequestId: request_id }, select: { id: true, imageUrl: true }, orderBy: { id: 'asc' },
    })

    console.log(`Found queue item #${queueItem.id} for user ${queueItem.userId}`)

    const params = queueItem.parameters as any
    console.log(`[webhook] loraUrl=${params?.loraUrl ?? 'none'} loraName=${params?.loraName ?? 'none'} endpoint stored=${params?.falEndpoint ?? 'immediate-path'}`)

    /**
     * Every way this job can fail, settled once (2026-10-23 billing sweep).
     * The status flip comes FIRST and is guarded, so of any racing settlers
     * (a re-sent webhook past its claim, the cron, the jobs poll's sweep)
     * exactly one gets it - and only that one returns the tickets (released
     * for a reservation, refunded for a charge: lib/queue-settle) and gives
     * back the slots the job actually held. The old code released first and
     * flipped after, unguarded, and decremented both counters regardless.
     */
    const failJob = async (errorMessage: string, extraParams?: Record<string, unknown>): Promise<FalWebhookOutcome> => {
      const flipped = await prisma.generationQueue.updateMany({
        where: { id: queueItem.id, status: { in: OPEN_STATUSES } },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          ...(extraParams ? { parameters: { ...(params ?? {}), ...extraParams } } : {}),
        },
      })
      if (flipped.count === 0) {
        console.log(`Queue item #${queueItem.id} was settled elsewhere — not failing it again`)
        return 'skipped'
      }
      try { await returnJobTickets(queueItem) }
      catch (e) { console.error(`[webhook] tickets for failed job #${queueItem.id} could not be returned:`, e) }
      await releaseHeldSlotsAndPromote(queueItem)
      return 'failed'
    }

    // ─── FAILURE PATH ───────────────────────────────────────────────
    if (status === 'ERROR' || status === 'FAILED' || error) {
      // fal hands back anything from a string to a validation array. Keep the
      // raw text for the record and show the user something they can act on —
      // a stored "Unexpected status code: 422" tells nobody what to change.
      const rawDetail = Array.isArray(error?.detail)
        ? error.detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
        : (typeof error === 'string' ? error : error?.message || error?.detail || 'FAL.ai generation failed')
      const { friendlyFalError } = await import('@/lib/fal-friendly-errors')
      const errorMsg = friendlyFalError(String(rawDetail), params?.model)
      console.error(`FAL.ai job failed for queue #${queueItem.id}:`, rawDetail)
      console.error(`FAL.ai full error object:`, JSON.stringify(error))
      console.error(`FAL.ai full body:`, JSON.stringify(body))

      // Dev-server logs scroll away; the provider's own words belong on
      // the row so a failure can be diagnosed after the fact.
      const outcome = await failJob(errorMsg, { falError: String(rawDetail).slice(0, 600) })
      if (outcome === 'failed') console.log(`Queue item #${queueItem.id} marked as failed, tickets returned`)
      return outcome
    }

    // ─── SUCCESS PATH ────────────────────────────────────────────────
    if (status === 'OK' || status === 'COMPLETED') {
      console.log(`FAL.ai job completed for queue #${queueItem.id}`)

      // Extract images from FAL.ai payload
      // FAL.ai wraps the model output in payload.images[] for image models
      // Clarity upscaler returns payload.image (singular); all other models return payload.images[]
      const images: { url: string }[] = payload?.images || (payload?.image?.url ? [payload.image] : [])
      // SeeDream Layerize: its layers are kept together as ONE card (lib/layerize-save)
      const isLayerize = LAYERIZE_MODELS.has(queueItem.modelId) && Array.isArray(payload?.layers) && payload.layers.length > 0

      if (images.length === 0) {
        console.error('Webhook payload has no images:', JSON.stringify(payload).substring(0, 300))
        return failJob('No images in FAL.ai response')
      }

      // Upload each image to Vercel Blob and create DB records
      const uploadedImages: { url: string; id: number }[] = []
      const isAdminMode = params?.adminMode === true

      const expiresAt = new Date()
      expiresAt.setFullYear(expiresAt.getFullYear() + 100)

      for (const r of alreadySaved) uploadedImages.push({ url: r.imageUrl, id: r.id })
      if (isLayerize && !alreadySaved.length) {
        const saved = await saveLayerizeResult({
          userId: queueItem.userId, prompt: params?.savePrompt || queueItem.prompt, modelId: queueItem.modelId,
          falRequestId: queueItem.falRequestId, createdAt: queueItem.createdAt,
          ticketCost: isAdminMode ? 0 : queueItem.ticketCost,
          referenceImageUrls: (params?.referenceImageUrls as string[]) || [],
          layers: payload.layers,
        }).catch(e => { console.error('Layerize save failed:', e); return null })
        if (saved) {
          uploadedImages.push(saved)
          after(() => { void ensureThumbnail(saved.id) })
        }
      }
      for (let i = 0; i < (isLayerize || alreadySaved.length ? 0 : images.length); i++) {
        const falImageUrl = images[i].url
        console.log(`Downloading image ${i + 1}/${images.length} from FAL.ai: ${falImageUrl}`)

        try {
          const imageResponse = await fetch(falImageUrl)
          if (!imageResponse.ok) {
            console.error(`Failed to download image ${i + 1}: ${imageResponse.status}`)
            continue
          }

          const imgBuffer = Buffer.from(await imageResponse.arrayBuffer())
          console.log(`Downloaded image ${i + 1}: ${(imgBuffer.length / 1024 / 1024).toFixed(2)} MB`)

          // Keep the real file type. Recraft's vector models return SVG, and
          // storing that as .png/image-png leaves a file nothing can render.
          const falType = (imageResponse.headers.get('content-type') || '').split(';')[0].trim()
          const looksSvg = falType === 'image/svg+xml'
            || /\.svg(\?|#|$)/i.test(falImageUrl)
            || imgBuffer.slice(0, 400).toString('utf8').trimStart().startsWith('<svg')
          const ext = looksSvg ? 'svg'
            : falType === 'image/webp' ? 'webp'
            : falType === 'image/jpeg' ? 'jpg'
            : 'png'
          const mime = looksSvg ? 'image/svg+xml'
            : falType.startsWith('image/') ? falType
            : 'image/png'
          // The random part matters: two of a user's jobs finishing in the same
          // millisecond got the SAME key, and the second upload overwrote the
          // first image (seen 2026-10-02: two feed rows, one picture)
          const filename = `universe-scan-${queueItem.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}.${ext}`
          // Thumbnail + display copy from these bytes, while the original uploads
          const variants = looksSvg ? Promise.resolve(null) : prepareImageVariants(imgBuffer)
          const url = await uploadToR2(filename, imgBuffer, mime)
          console.log(`Uploaded image ${i + 1} to blob: ${url}`)

          // Save to GeneratedImage table
          const ticketCostForThisImage = i === 0 && !isAdminMode ? queueItem.ticketCost : 0

          const savedImage = await prisma.generatedImage.create({
            data: {
              // QUEUE time, not completion time. The feed orders on createdAt,
              // so defaulting to now() reshuffled every tile on refresh: jobs
              // finish out of order (different models, retries, queue waits)
              // and a batch of 100 landed in a different order than it ran.
              // The queue row's own timestamp is when the user asked for it.
              createdAt: queueItem.createdAt,
              userId: queueItem.userId,
              prompt: params?.savePrompt || queueItem.prompt,
              imageUrl: url,
              model: queueItem.modelId,
              // Which fal job produced this. Without it the client had no way
              // to tell its own result from anyone else's and fell back to
              // "whatever is newest", which is how two jobs finishing together
              // both claimed the same image.
              falRequestId: queueItem.falRequestId,
              ticketCost: isAdminMode ? 0 : ticketCostForThisImage,
              referenceImageUrls: (params?.referenceImageUrls as string[]) || [],
              quality: (params?.quality as string) || null,
              aspectRatio: (params?.aspectRatio as string) || null,
              videoMetadata: params?.loraUrl
                ? {
                    loraUrl: params.loraUrl,
                    loraName: params.loraName ?? undefined,
                    loraScale: params.loraScale ?? undefined,
                    refStrength: params.refStrength ?? undefined,
                    renderSpeed: params.renderSpeed ?? undefined,
                    promptExpansion: params.promptExpansion ?? undefined,
                    extraLoras: params.extraLoras ?? undefined,
                  }
                : queueItem.modelId === 'gpt-image-2.5'
                  ? {
                      // Derived from the endpoint that ran, not from what the
                      // client asked for — those can differ, and the panel
                      // should show what happened.
                      gptVariant: String(params?.falEndpoint ?? '').includes('/flare/') ? 'flare' : 'sunburst',
                      gptQuality: params?.falQuality ?? undefined,
                      gptImageSize: params?.falImageSize ?? undefined,
                    }
                : queueItem.modelId === 'nano-banana-2.1'
                  ? {
                      // The settings panel's thinking / web search / safety chips
                      nb21Thinking: params?.nb21Thinking ?? undefined,
                      nb21WebSearch: typeof params?.nb21WebSearch === 'boolean' ? params.nb21WebSearch : undefined,
                      nb21Safety: params?.nb21Safety ?? undefined,
                    }
                : queueItem.modelId === 'clarity-upscaler'
                  ? {
                      upscaleFactor: params?.upscaleFactor,
                      upscaleCreativity: params?.upscaleCreativity,
                      upscaleResemblance: params?.upscaleResemblance,
                      upscaleGuidance: params?.upscaleGuidance,
                      upscaleSteps: params?.upscaleSteps,
                    }
                  : queueItem.modelId === 'aura-sr'
                    ? {
                        upscaleFactor: params?.upscaleFactor,
                        auraSrCheckpoint: params?.auraSrCheckpoint,
                        auraSrOverlappingTiles: params?.auraSrOverlappingTiles,
                      }
                    : queueItem.modelId === 'esrgan'
                      ? {
                          upscaleFactor: params?.upscaleFactor,
                          esrganModel: params?.esrganModel,
                          esrganFace: params?.esrganFace,
                          esrganOutputFormat: params?.esrganOutputFormat,
                        }
                      : queueItem.modelId === 'drct'
                        ? {
                            upscaleFactor: params?.upscaleFactor,
                            drctTicketCost: params?.drctTicketCost,
                          }
                        : undefined,
              expiresAt,
            }
          })

          uploadedImages.push({ url, id: savedImage.id })
          // Thumbnail, display copy and real dimensions on the row BEFORE the
          // job is marked done (lib/thumbnail), so the feed's first look at
          // it has something small to draw; the background pass is the fallback.
          if (!(await attachImageVariants(savedImage.id, await variants))) after(() => { void ensureThumbnail(savedImage.id) })
          console.log(`Saved GeneratedImage #${savedImage.id}`)
        } catch (imgError) {
          console.error(`Error processing image ${i + 1}:`, imgError)
        }
      }

      if (uploadedImages.length === 0) {
        // All image downloads/uploads failed
        return failJob('Failed to process all images from FAL.ai')
      }

      /*
       * Flip to completed AND settle the tickets in ONE transaction, the flip
       * first and guarded (2026-10-23 billing sweep). It used to charge, THEN
       * mark the row completed: a function that died between the two left a
       * row that was charged but still open, the five-minute claim retake
       * above took it again - and charged again. Now the charge exists only if
       * the flip committed with it, and of any racing settlers only the one
       * whose flip matched a row (count 1) charges at all.
       *
       * What "settle" means depends on how the tickets were taken
       * (lib/queue-settle chargeModeOf):
       *   reserve (every webhook job today): the reservation becomes spend -
       *     the FIRST and ONLY balance deduction, never below 0 (2026-10-19:
       *     a reservation skipped for an admin email was charged here
       *     unreserved). Admin mode: just clear the reservation.
       *   deduct: already paid at submit - nothing more to take.
       */
      const cost = Math.max(0, Math.round(queueItem.ticketCost || 0))
      const reserveMode = chargeModeOf(queueItem) === 'reserve'
      const won = await prisma.$transaction(async tx => {
        const flipped = await tx.generationQueue.updateMany({
          where: { id: queueItem.id, status: { in: OPEN_STATUSES } },
          data: {
            status: 'completed',
            completedAt: new Date(),
            resultUrl: uploadedImages[0].url,
            resultImageId: uploadedImages[0].id,
            // Store all image URLs in parameters for multi-image models (NanoBanana)
            parameters: {
              ...(params || {}),
              completedImageUrls: uploadedImages.map(img => img.url),
              completedImageIds: uploadedImages.map(img => img.id),
            },
          },
        })
        if (flipped.count === 0) return false
        if (cost > 0 && reserveMode) {
          if (!isAdminMode) {
            await tx.$executeRaw`
              UPDATE "Ticket"
              SET
                balance     = GREATEST(0, balance - ${cost}),
                reserved    = GREATEST(0, reserved - ${cost}),
                "totalUsed" = "totalUsed" + ${cost}
              WHERE "userId" = ${queueItem.userId}
            `
          } else {
            await tx.$executeRaw`UPDATE "Ticket" SET reserved = GREATEST(0, reserved - ${cost}) WHERE "userId" = ${queueItem.userId}`
          }
        }
        return true
      })
      if (!won) {
        // Someone else settled the row while we saved (a stale sweep that
        // failed it and gave the tickets back, an admin cancel). Charging now
        // would take tickets the user was already handed back; the pictures
        // stay in their feed uncharged - the cheaper mistake.
        console.warn(`Queue item #${queueItem.id} was settled elsewhere during the save — not charging; ${uploadedImages.length} image(s) kept`)
        return 'skipped'
      }

      // Give back the slots this job held (only those), then promote the next queued job
      await releaseHeldSlotsAndPromote(queueItem)

      console.log(`=== WEBHOOK COMPLETE: Queue #${queueItem.id} done, ${uploadedImages.length} image(s) saved ===`)
      return 'completed'
    }

    // Unknown status — just acknowledge
    console.warn(`Unknown FAL.ai webhook status: ${status}`)
    return 'unknown-status'
  }
}
