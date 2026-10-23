import { generationCaller } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { keepVideoInputs, videoInputLinks, videoInputsFromBody } from '@/lib/gen-inputs'
import { mediaKeeper } from '@/lib/media-ownership'
import { cleanVideoAdvanced } from '@/lib/video-advanced'
import { viggleRepaintTickets } from '@/lib/ticket-pricing'
import { submitRunpodVideoJob, runpodVideoConfigured, runpodEndpointEnvName, runpodMedia } from '@/lib/runpod-video'
import { RUNPOD_VIDEO_MODELS, RUNPOD_MAX_SOURCE_SEC, RP_ENDPOINT_PREFIX, RUNPOD_RENDER_CAP_S, formatRenderTime, runpodRenderSec, runpodRenderedSeconds, runpodVideoTicketCost, type RunpodVideoModelId } from '@/lib/runpod-video-models'
import { ADMIN_ONLY_VIDEO_MODELS } from '@/lib/fal-video-endpoints'

/**
 * POST /api/admin/runpod/video-submit - one job on our own RunPod video
 * workers (2026-10-22: MoCha character replacement, admin only while under
 * test). Takes the body the portal sends /api/video/generate and answers the
 * same way ({ success, requestId, falEndpoint, ... }) - its falEndpoint is
 * "runpod:<model>", which /api/admin/video-status hands to lib/runpod-video.
 * Charged in tickets up front (admins free); a failed job refunds itself.
 */

export async function POST(req: Request) {
  try {
    const user = await generationCaller(req, 'video')
    if (!user) return jsonPrivate({ success: false, error: 'Not authenticated' }, { status: 401 })
    const isAdmin = await checkIsAdmin(user.email)
    if (await isGenerationBlocked(user.email)) return jsonPrivate({ success: false, error: 'Generation is temporarily disabled for maintenance.' }, { status: 503 })

    const b = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
    const model = String(b.model || '') as RunpodVideoModelId
    if (!RUNPOD_VIDEO_MODELS.has(model)) return jsonPrivate({ success: false, error: 'Unknown model' }, { status: 400 })
    if (ADMIN_ONLY_VIDEO_MODELS.has(model) && !isAdmin) return jsonPrivate({ success: false, error: 'That model is not available on this account' }, { status: 403 })
    if (!runpodVideoConfigured(model)) {
      return jsonPrivate({ success: false, error: `This model's RunPod endpoint is not set up yet - add RUNPOD_API_KEY and ${runpodEndpointEnvName(model)} to the environment.` }, { status: 503 })
    }
    // Your own pictures and clips need a verified ID (CCBill; admins exempt)
    {
      const idGate = await requireOwnMediaUnlessVerified(user, [b.imageUrl, b.editVideoUrl, b.referenceImageUrls, b.referenceVideoUrls])
      if (idGate) return idGate
    }
    if (!isAdmin) {
      const c = await checkUserConcurrency(user.id)
      if (!c.allowed) return jsonPrivate({ success: false, error: `Queue full (${c.activeCount}/${c.limit} active). Wait for a generation to finish.` }, { status: 429 })
    }
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
    if (prompt) {
      const cf = await enforceContentFilter(prompt, user.email)
      if (!cf.ok) return jsonPrivate({ success: false, error: cf.reason }, { status: 400 })
    }

    // The clip, and 1-2 pictures of the character
    const clip: string | null = typeof b.editVideoUrl === 'string' && b.editVideoUrl ? b.editVideoUrl
      : Array.isArray(b.referenceVideoUrls) && typeof b.referenceVideoUrls[0] === 'string' ? b.referenceVideoUrls[0] : null
    const images: string[] = [
      ...(Array.isArray(b.referenceImageUrls) ? b.referenceImageUrls.filter((u: unknown): u is string => typeof u === 'string' && !!u) : []),
      ...(typeof b.imageUrl === 'string' && b.imageUrl ? [b.imageUrl] : []),
    ].slice(0, 2)
    if (!clip) return jsonPrivate({ success: false, error: 'Add the source clip - the person in it is who gets replaced.' }, { status: 400 })
    if (!images.length) return jsonPrivate({ success: false, error: 'Add a picture of the character to put in.' }, { status: 400 })
    // Measured here, not taken from the browser
    const probed = await (await import('@/lib/video-probe')).probeRemoteVideo(clip).catch(() => null)
    if (!probed) return jsonPrivate({ success: false, error: "Couldn't read the source clip - try uploading it again." }, { status: 400 })
    if (probed.seconds < 1) return jsonPrivate({ success: false, error: 'The clip is too short - it needs at least a second.' }, { status: 400 })
    if (probed.seconds > RUNPOD_MAX_SOURCE_SEC[model] + 0.5) {
      return jsonPrivate({ success: false, error: `Trim the clip to ${RUNPOD_MAX_SOURCE_SEC[model]} seconds or less first.` }, { status: 400 })
    }

    const settings = cleanVideoAdvanced(model, b.videoAdvanced, { isAdmin })
    let resolution: string
    let input: Record<string, unknown>
    let duration: string
    let repaint: { frameUrl: string; repaintUrl: string } | null = null
    if (model === 'runpod-mocha') {
      resolution = b.resolution === '720p' ? '720p' : '480p'
      /*
       * Who gets replaced, found here by SAM 3.1 (2026-10-22): the worker's
       * own YOLO "person" pass misses figures that aren't people - a wooden
       * mannequin failed the first test run - so "figure" is the fallback.
       * Cropped the way the worker crops the clip (832x480 / 1280x720 cover).
       * About $0.01; when SAM finds neither, the worker's YOLO still tries.
       */
      const mask = await (await import('@/lib/vace-mask')).subjectMask(clip, ['person', 'figure'], {
        coverAspect: resolution === '720p' ? 1280 / 720 : 832 / 480,
      }).catch((e: any) => { console.warn('MoCha mask (SAM 3.1) failed - the worker finds the person itself:', e?.message || e); return null })
      input = {
        action: 'mocha',
        video: runpodMedia(clip),
        refs: images.map(runpodMedia),
        ...(mask ? { mask: { url: mask } } : {}),
        resolution, mode: b.videoChoice === 'full' ? 'full' : 'fast',
        ...(prompt ? { prompt } : {}),
        max_frames: Number(settings.max_frames ?? 81),
        fps: Number(settings.fps ?? 24),
        keep_audio: settings.keep_audio !== false,
        ...(typeof settings.seed === 'number' ? { seed: settings.seed } : {}),
      }
      // The run's real length: what the worker renders of the clip (4n+1 frames at the chosen rate)
      const outFrames = Math.max(17, Math.min(Number(input.max_frames), Math.floor(probed.seconds * Number(input.fps))))
      duration = String(Math.max(1, Math.round((Math.floor((outFrames - 1) / 4) * 4 + 1) / Number(input.fps))))
    } else {
      // The MiniMax H3 pair (AI/h3-worker): Viggle renders up to 15s of the
      // clip, H3 Character Swap up to 30s, in 124-frame windows. The seconds
      // rendered come from the one function the page prices with
      // (runpodRenderedSeconds - 2026-10-23 billing sweep); the worker is
      // sent the same cap (max_seconds), so it renders what was charged
      const renderedSec = runpodRenderedSeconds(model, { sourceSec: probed.seconds, advanced: settings })
      const maxSeconds = runpodRenderedSeconds(model, { advanced: settings })
      duration = String(renderedSec)
      if (model === 'runpod-viggle') {
        resolution = '480p'
        if (b.videoChoice === 'mine') {
          // "My own frame": the picture IS the repainted first frame
          input = { action: 'viggle', video: runpodMedia(clip), ref: runpodMedia(images[0]), max_seconds: maxSeconds }
        } else {
          // Viggle animates a REPAINTED frame of the clip: made here, before any charge
          try {
            repaint = await (await import('@/lib/viggle-repaint')).viggleRepaint(clip, images[0])
          } catch (e: any) {
            return jsonPrivate({ success: false, error: `Couldn't repaint the clip's first frame with the character: ${e?.body?.detail?.[0]?.msg || e?.message || 'NanoBanana refused it'}` }, { status: 400 })
          }
          input = { action: 'viggle', video: runpodMedia(clip), ref: { url: repaint.repaintUrl }, max_seconds: maxSeconds }
        }
      } else {
        resolution = b.resolution === '480p' ? '480p' : '768p'
        // SAM's word for who gets swapped (the worker's Relay graph asks for
        // "person" - see firstMatchingSubject); left to the worker if this fails
        const vm = await import('@/lib/vace-mask')
        // H3 builds the new person FROM this picture: a frame of the clip itself
        // (a Viggle-style repainted frame) makes it reproduce the clip unchanged
        // - refused here, before any charge, instead of after a half-hour render
        const diff = await vm.differenceFromFirstFrame(clip, images[0]).catch(() => null)
        if (diff !== null && diff < 20) {
          return jsonPrivate({ success: false, error: "That picture looks like a frame of the clip itself. H3 Character Swap needs a picture of the character on their own (full body, plain background) - it builds the new person from it. For a repainted first frame, use Viggle Animate's My own frame." }, { status: 400 })
        }
        const subject = await vm.firstMatchingSubject(clip, ['person', 'figure']).catch(() => null)
        // The prompt (optional): who to replace and what the character looks like - the worker adds it to its structured swap prompt
        input = { action: 'h3-swap', video: runpodMedia(clip), ref: runpodMedia(images[0]), resolution: resolution === '480p' ? '480' : '768', max_seconds: maxSeconds, ...(subject ? { subject } : {}), ...(prompt ? { prompt } : {}) }
      }
      input.keep_audio = settings.keep_audio !== false
      if (typeof settings.seed === 'number') input.seed = settings.seed
    }

    // By GPU time (lib/runpod-video-models): MoCha's quality, the seconds the H3 pair renders
    const runOpts = { resolution, choice: typeof b.videoChoice === 'string' ? b.videoChoice : undefined, advanced: settings,
      // The clip's own length, as the page passes it: MoCha works out its
      // frames from it, the H3 pair its rendered seconds (runpodRenderedSeconds,
      // inside runpodRenderSec) - so page and charge agree (2026-10-23 billing sweep)
      sourceSec: probed.seconds }
    // A render the worker would stop part way (it was charged, then failed hours later)
    const renderSec = runpodRenderSec(model, runOpts)
    if (renderSec > RUNPOD_RENDER_CAP_S) {
      return jsonPrivate({ success: false, error: `These settings would render for about ${formatRenderTime(renderSec)} - past the ${formatRenderTime(RUNPOD_RENDER_CAP_S)} limit. Use Fast, a lower resolution or fewer frames.` }, { status: 400 })
    }
    const listTickets = runpodVideoTicketCost(model, runOpts)
      // Viggle's automatic repaint, at NanoBanana 2.1 Edit's own price
      + (model === 'runpod-viggle' ? viggleRepaintTickets(typeof b.videoChoice === 'string' ? b.videoChoice : undefined) : 0)
    // What it was given, for its generating tile (lib/gen-inputs) - the
    // account's own links only. Worked out BEFORE the charge (2026-10-23
    // billing sweep): a throw between the charge and the row left the user
    // charged with no job. (submitRunpodVideoJob refunds a row it can't make.)
    const keptInputs = await (async () => { const i = videoInputsFromBody(b); return keepVideoInputs(i, await mediaKeeper(user.id, videoInputLinks(i))) })()
    const charge = isAdmin ? 0 : listTickets
    if (charge > 0) {
      const paid = await deductGenerationTickets(user.id, user.email, charge)
      if (!paid.ok) return jsonPrivate({ success: false, error: `Insufficient tickets - need ${paid.need}, have ${paid.have}` }, { status: 402 })
    }
    const job = await submitRunpodVideoJob({
      userId: user.id, modelId: model, prompt,
      input,
      parameters: {
        resolution, duration, aspectRatio: probed.width >= probed.height ? '16:9' : '9:16',
        referenceImageUrls: images, listTickets, keepAudio: input.keep_audio,
        // Viggle: the frame it animates, for the run's record
        ...(repaint ? { viggleRepaint: repaint.repaintUrl } : {}),
        ...(typeof b.clientSlotId === 'string' ? { clientSlotId: b.clientSlotId.slice(0, 80) } : {}),
        // What it was given, for its generating tile (lib/gen-inputs) - worked out above
        inputs: keptInputs,
      },
      ticketCost: charge,
    })
    return jsonPrivate({
      success: true, queued: false, queueId: job.queueId, requestId: job.requestId,
      falEndpoint: `${RP_ENDPOINT_PREFIX}${model}`,
      ticketCost: charge, model, resolution, duration,
    })
  } catch (e: any) {
    console.error('runpod video-submit error:', e)
    return jsonPrivate({ success: false, error: e?.message || 'Submission failed' }, { status: 500 })
  }
}
