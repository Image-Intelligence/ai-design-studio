import { generationCaller } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { deductGenerationTickets } from '@/lib/ticket-gate'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { queueHiggsfieldJob, higgsfieldConfigured } from '@/lib/higgsfield'
import {
  HIGGSFIELD_ENDPOINTS, HIGGSFIELD_VIDEO_MODELS, HF_ENDPOINT_PREFIX, GENJUTSU_MODELS, genjutsuMaxSec, genjutsuSeconds,
  higgsfieldVideoTicketCost, isGenjutsuLite, type HiggsfieldModelId,
} from '@/lib/higgsfield-models'
import { ADMIN_ONLY_VIDEO_MODELS } from '@/lib/fal-video-endpoints'

/**
 * POST /api/admin/higgsfield/video-submit - one Higgsfield video job
 * (2026-10-13: Genjutsu motion transfer / object swap, Cinema Studio 4.0 -
 * PUBLIC since the same day; the /admin path is historical). Charged in
 * tickets on the measured clip / chosen length (admins free); a failed job
 * is refunded by lib/higgsfield. Takes the same body the portal sends /api/video/generate, and
 * answers the same way ({ success, requestId, falEndpoint, ... }) - its
 * falEndpoint is "higgsfield:<endpoint>", which /api/admin/video-status
 * hands to lib/higgsfield.
 */

const CINEMA_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']

export async function POST(req: Request) {
  try {
    // A browser session, or an agent's key (Nova / Prism / the ChatGPT connector - 2026-10-20)
    const user = await generationCaller(req, 'video')
    if (!user) return jsonPrivate({ success: false, error: 'Not authenticated' }, { status: 401 })
    const isAdmin = await checkIsAdmin(user.email)
    if (await isGenerationBlocked(user.email)) return jsonPrivate({ success: false, error: 'Generation is temporarily disabled for maintenance.' }, { status: 503 })
    if (!higgsfieldConfigured()) return jsonPrivate({ success: false, error: 'Higgsfield is not set up yet - add HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET to the environment.' }, { status: 503 })

    const b = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, any>
    // Your own pictures and clips need a verified ID (CCBill; admins exempt)
    {
      const idGate = await requireOwnMediaUnlessVerified(user, [
        b.imageUrl, b.editVideoUrl, b.audioUrl, b.referenceImageUrls, b.referenceVideoUrls, b.referenceAudioUrls,
      ])
      if (idGate) return idGate
    }
    if (!isAdmin) {
      const c = await checkUserConcurrency(user.id)
      if (!c.allowed) return jsonPrivate({ success: false, error: `Queue full (${c.activeCount}/${c.limit} active). Wait for a generation to finish.` }, { status: 429 })
    }
    const model = String(b.model || '') as HiggsfieldModelId
    if (!HIGGSFIELD_VIDEO_MODELS.has(model)) return jsonPrivate({ success: false, error: 'Unknown Higgsfield model' }, { status: 400 })
    // Models still under test (Genjutsu Lite, 2026-10-21) - the same list /api/video/generate enforces
    if (ADMIN_ONLY_VIDEO_MODELS.has(model) && !isAdmin) return jsonPrivate({ success: false, error: 'That model is not available on this account' }, { status: 403 })
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
    if (prompt) {
      const cf = await enforceContentFilter(prompt, user.email)
      if (!cf.ok) return jsonPrivate({ success: false, error: cf.reason }, { status: 400 })
    }
    // Stored canonical; lib/higgsfield signs the links when the job is sent
    const sign = (u: string) => u
    const images: string[] = [
      ...(typeof b.imageUrl === 'string' && b.imageUrl ? [b.imageUrl] : []),
      ...(Array.isArray(b.referenceImageUrls) ? b.referenceImageUrls.filter((u: unknown): u is string => typeof u === 'string') : []),
    ]
    const resolution = typeof b.resolution === 'string' ? b.resolution : '720p'
    let input: Record<string, unknown>
    let duration = '5'
    let listTickets: number
    const aspectRatio = typeof b.klingAspectRatio === 'string' && CINEMA_RATIOS.includes(b.klingAspectRatio) ? b.klingAspectRatio : '16:9'

    if (GENJUTSU_MODELS.has(model)) {
      // The clip and 1-8 pictures (the characters / the objects to put in)
      const maxSec = genjutsuMaxSec(model)
      const isSwap = model === 'higgsfield-genjutsu-swap' || model === 'higgsfield-genjutsu-lite-swap'
      const clip = typeof b.editVideoUrl === 'string' ? b.editVideoUrl : (Array.isArray(b.referenceVideoUrls) ? b.referenceVideoUrls[0] : null)
      if (!clip) return jsonPrivate({ success: false, error: `Add the source clip (4-${maxSec} seconds).` }, { status: 400 })
      if (!images.length) return jsonPrivate({ success: false, error: isSwap ? 'Add a picture of what to swap in.' : 'Add a picture of each character.' }, { status: 400 })
      // Billed on the clip's MEASURED length (rounded up). A clip that cannot
      // be read is refused - pricing it on the browser's number let a 30s
      // 1080p clip bill as 4s - and so is one over the 30s Genjutsu takes (Lite:
      // 15s - it would trim a longer one but may still bill its whole length)
      const probed = await (await import('@/lib/video-probe')).probeRemoteVideo(clip).catch(() => null)
      if (!probed) return jsonPrivate({ success: false, error: "Couldn't read the source clip - try uploading it again." }, { status: 400 })
      const sec = probed.seconds
      if (sec < 3.95) return jsonPrivate({ success: false, error: 'Genjutsu needs a clip of at least 4 seconds.' }, { status: 400 })
      if (sec > maxSec + 0.5) return jsonPrivate({ success: false, error: `${isGenjutsuLite(model) ? 'Genjutsu Lite' : 'Genjutsu'} takes clips up to ${maxSec} seconds - trim this one first.` }, { status: 400 })
      if (model === 'higgsfield-genjutsu-swap' && probed && probed.width * probed.height < 409_600) {
        return jsonPrivate({ success: false, error: 'Object swap needs at least ~640x640 worth of pixels per frame - use a larger clip.' }, { status: 400 })
      }
      duration = String(genjutsuSeconds(sec, maxSec))
      input = {
        prompt, video_url: sign(clip), image_urls: images.slice(0, 8).map(sign),
        resolution: ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p',
      }
      listTickets = higgsfieldVideoTicketCost(model, { resolution, sourceSec: sec })
    } else {
      // Cinema Studio 4.0: text to video, or references (images / videos / audio)
      if (!prompt) return jsonPrivate({ success: false, error: 'Describe the shot.' }, { status: 400 })
      const vids = Array.isArray(b.referenceVideoUrls) ? b.referenceVideoUrls.filter((u: unknown): u is string => typeof u === 'string') : []
      const auds = [
        ...(Array.isArray(b.referenceAudioUrls) ? b.referenceAudioUrls : []),
        ...(typeof b.audioUrl === 'string' && b.audioUrl ? [b.audioUrl] : []),
      ].filter((u: unknown): u is string => typeof u === 'string')
      const sec = Math.min(30, Math.max(4, parseInt(String(b.duration)) || 5))
      duration = String(sec)
      input = {
        prompt, duration: sec,
        resolution: resolution === '480p' ? '480p' : '720p',
        aspect_ratio: aspectRatio,
        generate_audio: b.generateAudio !== false,
        ...(images.length ? { image_urls: images.slice(0, 30).map(sign) } : {}),
        ...(vids.length ? { video_urls: vids.slice(0, 10).map(sign) } : {}),
        ...(auds.length ? { audio_urls: auds.slice(0, 10).map(sign) } : {}),
      }
      // Reference clips are billed by Higgsfield too (0.6x a second): measured
      // here, not taken from the browser
      let refVideoSec = 0
      if (vids.length) {
        const vp = await import('@/lib/video-probe')
        const secs = await Promise.all(vids.slice(0, 10).map(u => vp.probeRemoteMediaSeconds(u).catch(() => null)))
        if (secs.some(x => !x)) return jsonPrivate({ success: false, error: "Couldn't read a reference video - try uploading it again." }, { status: 400 })
        refVideoSec = secs.reduce<number>((a, x) => a + (x ?? 0), 0)
      }
      listTickets = higgsfieldVideoTicketCost(model, { resolution, duration, refVideoSec })
    }

    const endpoint = HIGGSFIELD_ENDPOINTS[model]
    // Charged up front (admins free); a failed job refunds it (lib/higgsfield)
    const charge = isAdmin ? 0 : listTickets
    if (charge > 0) {
      const paid = await deductGenerationTickets(user.id, user.email, charge)
      if (!paid.ok) return jsonPrivate({ success: false, error: `Insufficient tickets - need ${paid.need}, have ${paid.have}` }, { status: 402 })
    }
    // Higgsfield's own queue (20 at once): sent now, or waits its turn.
    // A waiting video answers { queued, queueId } - the page watches the row
    // (queue-job-status) until it is sent, exactly as fal's queued videos.
    const job = await queueHiggsfieldJob({
      userId: user.id, modelId: model, modelType: 'video', prompt, endpoint, input,
      parameters: {
        resolution: (input.resolution as string) || resolution, duration, aspectRatio,
        generateAudio: model === 'higgsfield-cinema-4' ? b.generateAudio !== false : true,
        referenceImageUrls: images, listTickets,
      },
      ticketCost: charge,
    })
    return jsonPrivate({
      success: true, queued: job.queued, queueId: job.queueId,
      ...(job.requestId ? { requestId: job.requestId } : {}),
      falEndpoint: `${HF_ENDPOINT_PREFIX}${endpoint}`,
      ticketCost: charge, model, resolution: input.resolution, duration,
    })
  } catch (e: any) {
    console.error('higgsfield video-submit error:', e)
    return jsonPrivate({ success: false, error: e?.message || 'Submission failed' }, { status: 500 })
  }
}
