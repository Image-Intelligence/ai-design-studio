import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { fal } from "@/lib/fal-client";
import { syncAndClaimFalSlot } from '@/lib/admin-queue-helpers';
import { isGenerationBlocked } from '@/lib/generation-guard';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';
import { authenticateApiKey, invalidKeyResponse, requireScopes, canUseModel, modelNotPermittedResponse } from '@/lib/api-key-auth';
import { enforceContentFilter } from '@/lib/content-filter'
import { FAL_ENDPOINTS, ADMIN_ONLY_VIDEO_MODELS, LUMA_VIDEO_GENERATORS, LUMA_VIDEO_TOOLS, BATCH_0928_GENERATORS, BATCH_0928_TOOLS } from '@/lib/fal-video-endpoints'
import { fitImageForFal } from '@/lib/fal-image-fit'
import { videoTicketCost, VIDEO_TOOL_MODELS, INPUT_ROUTED_MODELS, ltxFastSeconds } from '@/lib/ticket-pricing'
import { batch0928Mode, batch0928Resolution, batch0928Input } from '@/lib/batch-0928-video'
import { PIXELCUT_BG_MAX_SECONDS, PIXELCUT_LOOPING, PIXELCUT_VIDEO_ENDPOINTS, pixelcutVideoInput } from '@/lib/pixelcut-video'
import { BATCH_1003_GENERATORS, BATCH_1003_TOOLS, BATCH_1003_PROMPT_REQUIRED, BATCH_1003_AUDIO_DRIVEN, BATCH_1003_NEEDS_IMAGE, LTX_AUDIO_MAX_SEC, batch1003EndpointKey, batch1003Input } from '@/lib/batch-1003-video'
import { BATCH_1007_GENERATORS, BATCH_1007_TOOLS, RELIGHT_MAX_SEC, batch1007EndpointKey, batch1007Input } from '@/lib/batch-1007-video'
import { BATCH_0929_GENERATORS, BATCH_0929_TOOLS, BATCH_0929_TEXT_CAPABLE, BATCH_0929_PROMPT_OPTIONAL, batch0929Mode, batch0929EndpointKey, batch0929Input } from '@/lib/batch-0929-video'
import { canonicalisePayload, signMediaUrl, FAL_TTL } from '@/lib/media-url'


fal.config({
  credentials: process.env.FAL_KEY!
});

// FAL endpoint IDs by model
// FAL endpoint ids live in lib/fal-video-endpoints.ts so the Model Watch page
// can read them without scanning source files at runtime.


// ADMIN_ONLY_VIDEO_MODELS now lives in lib/fal-video-endpoints so the chat
// catalog and the pickers gate on exactly what this route enforces.

// VIDEO_TOOL_MODELS (source-clip tools) and INPUT_ROUTED_MODELS (endpoint
// chosen by the inputs given) are imported from lib/ticket-pricing.ts — the
// ticket cost branches on both, so they live beside the pricing function.
const VIDEO_TOOLS_WITH_PROMPT = new Set(['flux-video-upscale', 'topaz-upscale-creative'])

/**
 * What a HEAD request can tell us about a Flux 3 extend source. Returns a
 * user-facing reason to refuse, or null to let fal decide. Deliberately
 * permissive: an unreachable URL or a host that hides these headers is not
 * grounds to block a job that might well succeed.
 */
async function flux3SourceProblem(url: string): Promise<string | null> {
  const FLUX3_MAX_BYTES = 50 * 1024 * 1024;
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!head.ok) return null;
    const type = (head.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = Number(head.headers.get('content-length') || 0);
    if (type && type.startsWith('video/') && type !== 'video/mp4') {
      return `Flux 3 extend only takes MP4 — this clip is ${type}. Re-encode it as MP4 and upload again.`;
    }
    if (bytes > FLUX3_MAX_BYTES) {
      return `Flux 3 extend needs the clip under 50 MB — this one is ${(bytes / 1048576).toFixed(1)} MB. Trim it or re-encode it smaller.`;
    }
  } catch {
    // Network hiccup or a host that refuses HEAD — not a reason to refuse
  }
  return null;
}

/**
 * Shrink any reference image the model would reject before it is submitted.
 *
 * fal caps an input file at 10MB. A generated plate is routinely well over
 * that (a 2K NanoBanana PNG measured 19.2MB), and fal reports such a job
 * COMPLETED and only fails when the result is fetched — so an oversized
 * start frame did not look like an error, it looked like a render that never
 * finished. Every caller of this route is affected: the portal animating an
 * image from the feed, the video scanners, the public API and the chat hub.
 *
 * Only oversized refs are rewritten, so the normal case costs one HEAD
 * request and nothing else changes.
 */
async function normalizeVideoRefs(body: any): Promise<any> {
  if (!body || typeof body !== 'object') return body
  try {
    const { fitRefForVideo, fitRefsForVideo } = await import('@/lib/video-ref-fit')
    const [imageUrl, endImageUrl, referenceImageUrls] = await Promise.all([
      typeof body.imageUrl === 'string' ? fitRefForVideo(body.imageUrl) : body.imageUrl,
      typeof body.endImageUrl === 'string' ? fitRefForVideo(body.endImageUrl) : body.endImageUrl,
      Array.isArray(body.referenceImageUrls) ? fitRefsForVideo(body.referenceImageUrls) : body.referenceImageUrls,
    ])
    return { ...body, imageUrl, endImageUrl, referenceImageUrls }
  } catch {
    // Never block a generation because the fitter failed — the model's own
    // error is a better outcome than a 500 from here.
    return body
  }
}

export async function POST(request: NextRequest) {
  try {
    // Bearer API key (desktop app) first, session cookie fallback
    const apiAuth0 = await authenticateApiKey(request)
    if (apiAuth0 === 'invalid') return invalidKeyResponse()
    const apiAuth = apiAuth0
    const _ck = await cookies(); const _tok = _ck.get('session')?.value
    const _u = apiAuth ? apiAuth.user : (_tok ? await getUserFromSession(_tok) : null)
    if (await isGenerationBlocked(_u?.email)) {
      return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
    }

    const {
      userId: userIdRaw,
      prompt,
      imageUrl,
      duration = '5',
      resolution = '1080p',
      audioUrl,
      adminMode: adminModeRaw = false,
      model = 'wan-2.5',
      generateAudio = false,
      klingAspectRatio = '16:9',
      endImageUrl,
      hasDevTier = false,
      // Motion Control
      motionVideoUrl,
      motionVideoDurationSec,
      characterOrientation = 'image',
      keepOriginalSound = true,
      // SeeDance 2.0 reference-to-video (also reused for Gemini Omni Flash modes)
      sd20Mode = 't2v',
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      referenceVideoDurationSec = 0,
      // Gemini Omni Flash edit (video-to-video)
      editVideoUrl,
      editVideoDurationSec: clientEditVideoDurationSec = 0,
      // Lipsync v3
      lipsyncVideoUrl,
      lipsyncAudioUrl,
      lipsyncSyncMode = 'cut_off',
      lipsyncVideoDurationSec = 0,
      // WAN 2.5 safety
      wan25SafetyChecker = true,
      // Seedance 1.5 safety
      seedance15SafetyChecker = true,
      // WAN 2.7 safety
      wan27SafetyChecker = true,
      h3MaxSafetyChecker = true,
      flux3SafetyChecker = true,
      wan30SafetyChecker = true,
      ltxFps = '25',
      // Luma modify / Ray 3.2 edit: how far the result may move from the source
      lumaMode = 'flex_1',
      videoChoice,
      videoUpscaleFactor = '2',
      videoToolCreativity = '0.35',
      videoTargetFps = '60',
      // Wan 2.2 LoRA serving: [{ path, scale, transformer }] — validated below
      loras = [],
      // H3 Max Insert Shot: where the new shot goes in the source clip, seconds
      insertStartSec,
      insertResumeSec,
      // SeeDance 2.5 Complete: the draft video (a GeneratedImage id) to re-render at 1080p
      draftVideoId,
    } = await normalizeVideoRefs(canonicalisePayload(await request.json()));

    // Video tools that fal bills by the source's length, size or frame rate:
    // measure the clip instead of trusting the browser (it sends no size or
    // fps, and the length it sends could be anything). A failed probe falls
    // back to the browser's figure.
    const probed = VIDEO_TOOL_MODELS.has(model) && editVideoUrl
      ? await (await import('@/lib/video-probe')).probeRemoteVideo(editVideoUrl).catch(() => null)
      : null
    const editVideoDurationSec: number = probed ? probed.seconds : (Number(clientEditVideoDurationSec) || 0)
    /*
     * SeeDance 2.5 Complete: the draft is a video in the user's own feed. Its
     * fal draft id never leaves the server - the page sends the video's id,
     * and the draft's length (measured) is what the 1080p render is priced on.
     */
    let draftInfo: { draftId: string; seconds: number } | null = null
    if (model === 'seedance-2.5-complete') {
      const row = Number.isInteger(Number(draftVideoId)) ? await prisma.generatedImage.findFirst({
        where: { id: Number(draftVideoId), ...(_u ? { userId: _u.id } : {}) },
        select: { imageUrl: true, createdAt: true, videoMetadata: true },
      }).catch(() => null) : null
      const meta = (row?.videoMetadata ?? null) as { seedanceDraftId?: string } | null
      if (!row || !meta?.seedanceDraftId) {
        return NextResponse.json({ success: false, error: 'That video is not a SeeDance 2.5 draft.' }, { status: 400 });
      }
      if (Date.now() - row.createdAt.getTime() > 7 * 24 * 3600 * 1000 - 5 * 60 * 1000) {
        return NextResponse.json({ success: false, error: 'This draft is more than 7 days old - fal keeps drafts for a week. Make a new one.' }, { status: 400 });
      }
      const secs = await (await import('@/lib/video-probe')).probeRemoteMediaSeconds(row.imageUrl).catch(() => null)
      draftInfo = { draftId: meta.seedanceDraftId, seconds: secs && secs > 0 ? secs : 10 }
    }
    // Audio-driven models (lip sync, music video) bill by the audio's length:
    // measured here, never taken from the browser
    const audioDurationSec: number = BATCH_1003_AUDIO_DRIVEN.has(model) && audioUrl
      ? await (await import('@/lib/video-probe')).probeRemoteMediaSeconds(audioUrl).catch(() => 0) ?? 0
      : 0

    // CCBill compliance: fal content-safety flags from the client are only honored
    // for verified admins — regular users ALWAYS run with the checker ON, no matter
    // what the request body claims.
    const { checkIsAdmin: _checkIsAdmin } = await import('@/lib/admin-check')
    const isAdminUser = _u ? await _checkIsAdmin(_u.email) : false

    // Bearer calls: enforce scopes + per-model permission; the authenticated
    // user's id ALWAYS overrides the legacy body userId (never trust the body
    // for ticket deduction on the key path), and adminMode is a portal concept.
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'generate:video', 'tickets:spend')
      if (denied) return denied
      if (!canUseModel(apiAuth, 'video', model)) return modelNotPermittedResponse(model)
    }
    // WHO PAYS comes from the login, never the request body: the body's userId
    // used to decide whose tickets were spent, so a request naming another
    // account billed them (found 2026-10-04). Every legitimate caller - the
    // portal, the scanners, the chat hub calling this handler in-process - is
    // that same signed-in user anyway.
    if (!apiAuth && userIdRaw && _u && Number(userIdRaw) !== _u.id) {
      console.warn(`Video submit: body userId ${userIdRaw} ignored for session user ${_u.id}`)
    }
    const userId: number | undefined = apiAuth ? apiAuth.user.id : _u?.id
    const adminMode = apiAuth ? false : adminModeRaw

    // Admin-only models: hard server gate, regardless of what the client sent
    if (ADMIN_ONLY_VIDEO_MODELS.has(model) && !isAdminUser) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const isSD20Family = model === 'seedance-2.0' || model === 'seedance-2.0-fast'
    const isOmni = model === 'gemini-omni-flash'
    const isLipsync = model === 'lipsync-v3'
    // For SD20 family: auto-detect mode from imageUrl; explicit r2v overrides
    const effectiveSd20Mode = isSD20Family
      ? (sd20Mode === 'r2v' ? 'r2v' : imageUrl ? 'i2v' : 't2v')
      : (isOmni || model === 'flux-3' || INPUT_ROUTED_MODELS.has(model))
        // Same resolution rule: honour an explicit references/extend choice,
        // otherwise let the presence of a start image decide
        ? (sd20Mode === 'r2v' || sd20Mode === 'edit' ? sd20Mode : imageUrl ? 'i2v' : 't2v')
        : sd20Mode
    // One line per video submit — model, resolved mode and which inputs arrived.
    // Without it a rejected submit is a guessing game.
    console.log('Video submit:', JSON.stringify({
      model, sd20Mode, mode: effectiveSd20Mode,
      promptLen: (prompt || '').length,
      hasImage: !!imageUrl, hasEndImage: !!endImageUrl, hasEditVideo: !!editVideoUrl,
      refImages: Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0,
      refVideos: Array.isArray(referenceVideoUrls) ? referenceVideoUrls.length : 0,
    }))
    const isWanLora = model === 'wan-2.2-lora'
    const isTextToVideo = model === 'seedance-1.5'
      ? !imageUrl
      : isSD20Family
        ? (effectiveSd20Mode !== 'i2v') // t2v/r2v need no start frame
        : isOmni
          ? (effectiveSd20Mode !== 'i2v') // t2v/r2v/edit need no start frame
          : isWanLora
            ? !imageUrl // t2v when no start frame
            : false

    // Wan 2.2 LoRA: validate the loras array — only OUR trained artifacts may
    // be loaded (R2 video-loras namespace), never arbitrary URLs
    let wanLoras: { path: string; scale: number; transformer: 'high' | 'low' | 'both' }[] = []
    if (isWanLora) {
      const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
      const raw = Array.isArray(loras) ? loras.slice(0, 2) : []
      for (const l of raw) {
        const p = typeof l?.path === 'string' ? l.path : ''
        if (!publicBase || !p.startsWith(`${publicBase}/training/video-loras/`)) {
          return NextResponse.json({ success: false, error: 'Invalid LoRA path' }, { status: 400 });
        }
        const scale = Math.min(4, Math.max(0, Number(l?.scale) || 1))
        const transformer = l?.transformer === 'low' || l?.transformer === 'both' ? l.transformer : 'high'
        // Checked against the canonical prefix above, signed here: the bucket
        // is private now, so fal cannot read these weights without a signature
        // — and the failure looks like a broken model, not a 401.
        wanLoras.push({ path: signMediaUrl(p, FAL_TTL), scale, transformer })
      }
      if (wanLoras.length === 0) {
        return NextResponse.json({ success: false, error: 'Select a trained LoRA first' }, { status: 400 });
      }
    }
    // A start image is only mandatory for models that CANNOT start any other
    // way. This used to be hard-coded to SeeDance 1.5, so every other
    // text-capable model (H3 Max text-to-video, Flux 3 extend/keyframes, Omni)
    // was rejected here before it ever reached its endpoint.
    const TEXT_CAPABLE_MODELS = new Set([
      'seedance-1.5', 'seedance-2.0', 'seedance-2.0-fast', 'wan-2.7',
      'wan-2.2-lora', 'gemini-omni-flash', 'minimax-h3-max', 'flux-3',
      'luma-ray-2', 'luma-ray-2-flash', 'luma-ray-3.2',
      // Input-routed models with a text-to-video endpoint. Missing from this
      // list, they were refused a text-only run (LTX 2.5 Pro was public and
      // could not do text-to-video). SeeDance 2.5 has no text endpoint.
      'wan-3.0', 'wan-3.0-prime', 'gemini-omni-1.1', 'ltx-2.5-pro', 'ltx-2.5-fast',
      ...BATCH_0928_GENERATORS,
      ...BATCH_0929_TEXT_CAPABLE,
      // starts from its song (the photo is an optional character reference)
      'pixverse-music-video',
      // audio-driven (the photo is optional) and the draft completion (no inputs but the draft)
      'ltx-2.5-audio-pro', 'ltx-2.5-audio-fast', 'seedance-2.5-complete',
    ])
    const hasNonImageInput = !!editVideoUrl || !!motionVideoUrl
      || (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0)
      || (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0)
    if (!imageUrl && !isLipsync && !hasNonImageInput && !TEXT_CAPABLE_MODELS.has(model)) {
      return NextResponse.json({ success: false, error: 'This model needs a starting image.' }, { status: 400 });
    }
    if (isOmni && effectiveSd20Mode === 'edit' && !editVideoUrl) {
      return NextResponse.json({ success: false, error: 'Edit mode requires a source video' }, { status: 400 });
    }
    // Omni Flash 1.1's edit endpoint refuses every prompt (2026-10-01: "Add
    // falling snow." on two different clips, called straight on fal, came back
    // content_policy_violation). Refuse before the charge and point at the
    // base model, whose edit works; lift this when fal's endpoint recovers.
    if (model === 'gemini-omni-1.1' && effectiveSd20Mode === 'edit') {
      return NextResponse.json({ success: false, error: 'Omni Flash 1.1 can\'t edit videos right now - use Gemini Omni Flash for video edits.' }, { status: 400 });
    }
    if (isOmni && effectiveSd20Mode === 'r2v' && !(Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0)) {
      return NextResponse.json({ success: false, error: 'Reference mode requires at least one reference image' }, { status: 400 });
    }
    // fal SD20 r2v: input videos must total 2-15s (the 15s cap is enforced client-side)
    if (isSD20Family && effectiveSd20Mode === 'r2v' && Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0 && (referenceVideoDurationSec || 0) < 2) {
      return NextResponse.json({ success: false, error: 'Reference videos must total at least 2 seconds' }, { status: 400 });
    }
    // Wan 2.7 i2v: prompt is optional when a start image is provided (fal schema)
    if (VIDEO_TOOL_MODELS.has(model)) {
      if (!editVideoUrl) {
        return NextResponse.json({ success: false, error: 'Add the source video to upscale or process.' }, { status: 400 });
      }
      // Veo's extend schema: the clip "should be 720p or 1080p resolution in
      // 16:9 or 9:16" - refuse other clips before the charge
      if ((model === 'veo-3.1-extend' || model === 'veo-3.1-fast-extend') && probed) {
        const short = Math.min(probed.width, probed.height)
        const ratio = Math.max(probed.width, probed.height) / short
        if (short < 700 || Math.abs(ratio - 16 / 9) > 0.06) {
          return NextResponse.json({ success: false, error: `Veo extend needs a 720p or 1080p clip in 16:9 or 9:16 (this one is ${probed.width}x${probed.height}).` }, { status: 400 });
        }
      }
      // Veo only extends videos VEO made (Google's rule; tested 2026-10-02: a
      // 1280x720 24fps 4s clip from another model came back no_media_generated
      // on both tiers, while a Veo clip of the same spec extended fine). The
      // source must be a Veo generation in the feed - matched by its file name,
      // since the browser may send a signed link.
      if (model === 'veo-3.1-extend' || model === 'veo-3.1-fast-extend') {
        const key = String(editVideoUrl).split('?')[0].split('/').pop() || ''
        const src = key ? await prisma.generatedImage.findFirst({
          where: { imageUrl: { endsWith: '/' + key } },
          select: { model: true },
        }).catch(() => null) : null
        if (!src?.model?.startsWith('veo-')) {
          return NextResponse.json({ success: false, error: 'Veo extend only works on videos made with Veo 3.1 - pick a Veo clip from your generations.' }, { status: 400 });
        }
      }
      // Ray 3.2's edit and reframe schemas REQUIRE a prompt (Ray 2's modify
      // and reframe take it as optional)
      // Every tool in the 2026-09-28 batch needs a prompt (their schemas require it)
      if (BATCH_1003_PROMPT_REQUIRED.has(model) && !prompt?.trim()) {
        return NextResponse.json({ success: false, error: 'Say what to remove - e.g. "the red car" or "the man on the left".' }, { status: 400 });
      }
      // VOID's widest window is 197 frames of the source: ~8s at 24 fps, ~6.5s at 30
      if (model === 'void-video-removal' && editVideoDurationSec * (probed?.fps || 24) > 197.5) {
        return NextResponse.json({ success: false, error: `VOID removes objects from up to 197 frames - about ${Math.floor(197 / (probed?.fps || 24) * 10) / 10}s of this clip. Trim it first.` }, { status: 400 });
      }
      if (model === 'minimax-h3-max-insert') {
        // fal's limits (seen 2026-10-04): the shot starts >= 1.625s in, and
        // the clip must keep ~1.375s AFTER the resume point ("resume_time
        // must be at most 3.667 seconds" on a 5.06s clip) - 1.4s held here
        const start = Number(insertStartSec), resume = Number(insertResumeSec)
        const maxResume = editVideoDurationSec > 0 ? Math.floor((editVideoDurationSec - 1.4) * 10) / 10 : 60
        if (maxResume < 1.75) {
          return NextResponse.json({ success: false, error: 'This clip is too short to insert a shot into - use one at least 3.2 seconds long.' }, { status: 400 });
        }
        if (!Number.isFinite(start) || start < 1.65) {
          return NextResponse.json({ success: false, error: 'Set where the new shot starts - at least 1.7 seconds into the clip.' }, { status: 400 });
        }
        if (!Number.isFinite(resume) || resume < start) {
          return NextResponse.json({ success: false, error: 'Set where the clip resumes - after the start.' }, { status: 400 });
        }
        if (resume > maxResume + 0.001) {
          return NextResponse.json({ success: false, error: maxResume >= start
            ? `The clip has to keep going after the new shot - resume by ${maxResume}s at the latest for this clip.`
            : 'This clip is too short to insert a shot into - use one at least 3.1 seconds long.' }, { status: 400 });
        }
        if (editVideoDurationSec > 60.5) {
          return NextResponse.json({ success: false, error: 'Insert Shot takes clips up to 60 seconds.' }, { status: 400 });
        }
      }
      // H3 Max Relight (2026-10-07): the lighting comes from a picture of a lit sphere
      if (model === 'minimax-h3-max-relight') {
        if (!(Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) && !imageUrl) {
          return NextResponse.json({ success: false, error: 'Add the lighting picture (a lit sphere) as a reference image next to the clip.' }, { status: 400 });
        }
        if (editVideoDurationSec > RELIGHT_MAX_SEC + 0.5) {
          return NextResponse.json({ success: false, error: `Relight takes clips up to ${RELIGHT_MAX_SEC} seconds - trim it first.` }, { status: 400 });
        }
      }
      if ((model === 'mirelo-sfx-video') && editVideoDurationSec > 60.5) {
        return NextResponse.json({ success: false, error: 'Mirelo SFX takes clips up to 60 seconds.' }, { status: 400 });
      }
      if ((model === 'heygen-translate' || model === 'heygen-translate-fast') && editVideoDurationSec > 480.5) {
        return NextResponse.json({ success: false, error: 'HeyGen translates clips up to 8 minutes.' }, { status: 400 });
      }
      if ((BATCH_0928_TOOLS.has(model) || BATCH_0929_TOOLS.has(model)) && !BATCH_0929_PROMPT_OPTIONAL.has(model) && !prompt?.trim()) {
        return NextResponse.json({ success: false, error: 'This tool needs a prompt - describe the change you want.' }, { status: 400 });
      }
      // ByteDance upscale: scale_ratio must be >= 1.1 and the output is held to
      // 4K, so a clip already near 4K has nowhere to go
      if (model === 'bytedance-video-upscale' && probed && Math.min(probed.width, probed.height) * 1.1 > 2160) {
        return NextResponse.json({ success: false, error: 'This clip is already 4K - ByteDance upscale tops out at 4K.' }, { status: 400 });
      }
      // H3 Max Recast (schema 2026-10-02): a 5-30s source and 1-4 face photos
      if (model === 'minimax-h3-max-recast') {
        const faces = Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0
        if (faces < 1) {
          return NextResponse.json({ success: false, error: 'Recast needs a photo of each new person - add 1 to 4 images as references.' }, { status: 400 });
        }
        if (editVideoDurationSec > 0 && (editVideoDurationSec < 4.9 || editVideoDurationSec > 30.5)) {
          return NextResponse.json({ success: false, error: 'Recast takes clips of 5 to 30 seconds.' }, { status: 400 });
        }
      }
      if (model === 'minimax-h3-max-turbo-extend' && editVideoDurationSec > 0 && (editVideoDurationSec < 1.6 || editVideoDurationSec > 60.5)) {
        return NextResponse.json({ success: false, error: 'H3 Max Turbo extend takes clips of 1.6 to 60 seconds.' }, { status: 400 });
      }
      if (model === 'pixelcut-video-bg-removal' && editVideoDurationSec > PIXELCUT_BG_MAX_SECONDS + 0.5) {
        return NextResponse.json({ success: false, error: `Background removal takes clips up to ${PIXELCUT_BG_MAX_SECONDS} seconds.` }, { status: 400 });
      }
      if (model.startsWith('kling-o3-') && editVideoDurationSec > 0 && (editVideoDurationSec < 2.9 || editVideoDurationSec > 15.5)) {
        return NextResponse.json({ success: false, error: 'Kling O3 video tools take clips of 3 to 15 seconds.' }, { status: 400 });
      }
      if (model === 'grok-video-extend' && editVideoDurationSec > 0 && (editVideoDurationSec < 1.9 || editVideoDurationSec > 15.5)) {
        return NextResponse.json({ success: false, error: 'Grok extend takes clips of 2 to 15 seconds.' }, { status: 400 });
      }
      if ((model === 'luma-ray-3.2-edit' || model === 'luma-ray-3.2-reframe') && !prompt?.trim()) {
        return NextResponse.json({ success: false, error: model === 'luma-ray-3.2-edit'
          ? 'Describe the edit - Ray 3.2 needs a prompt.'
          : 'Describe what should fill the new space - Ray 3.2 reframe needs a prompt.' }, { status: 400 });
      }
      if (model === 'luma-ray-3.2-reframe' && editVideoDurationSec > 10.5) {
        return NextResponse.json({ success: false, error: 'Ray 3.2 reframe takes clips up to 10 seconds.' }, { status: 400 });
      }
    } else if (BATCH_1007_GENERATORS.has(model)) {
      // Vidu Q4: a start frame (prompt optional), or references (prompt required)
      const refCount = Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0
      if (effectiveSd20Mode === 'r2v' && refCount > 0) {
        if (!prompt?.trim()) {
          return NextResponse.json({ success: false, error: 'Describe the video - references need a prompt.' }, { status: 400 });
        }
      } else if (!imageUrl && refCount === 0) {
        return NextResponse.json({ success: false, error: 'Vidu Q4 needs a start image (or references).' }, { status: 400 });
      }
    } else if (BATCH_1003_GENERATORS.has(model)) {
      // The 2026-10-03 generators: a photo and/or an audio track, prompt optional
      if (BATCH_1003_NEEDS_IMAGE.has(model) && !imageUrl) {
        return NextResponse.json({ success: false, error: 'Add the photo to animate as the start frame.' }, { status: 400 });
      }
      if (BATCH_1003_AUDIO_DRIVEN.has(model) && !audioUrl) {
        return NextResponse.json({ success: false, error: model === 'pixverse-music-video' ? 'Upload the song (10 seconds to 6 minutes).' : 'Upload the voice track (at least 5 seconds).' }, { status: 400 });
      }
      if (model === 'minimax-h3-max-lipsync' && audioDurationSec > 0 && audioDurationSec < 4.9) {
        return NextResponse.json({ success: false, error: 'The voice track must be at least 5 seconds long.' }, { status: 400 });
      }
      if (model === 'pixverse-music-video' && audioDurationSec > 0 && (audioDurationSec < 9.9 || audioDurationSec > 360.5)) {
        return NextResponse.json({ success: false, error: 'The song must be 10 seconds to 6 minutes long.' }, { status: 400 });
      }
      if (model === 'heygen-avatar4' && !audioUrl && !prompt?.trim()) {
        return NextResponse.json({ success: false, error: 'Type what the avatar says, or upload a voice track.' }, { status: 400 });
      }
      if (LTX_AUDIO_MAX_SEC[model]) {
        if (audioDurationSec > 0 && (audioDurationSec < 1.9 || audioDurationSec > LTX_AUDIO_MAX_SEC[model] + 0.3)) {
          return NextResponse.json({ success: false, error: `The audio must be 2 to ${LTX_AUDIO_MAX_SEC[model]} seconds long for this model.` }, { status: 400 });
        }
        if (!imageUrl && !prompt?.trim()) {
          return NextResponse.json({ success: false, error: 'Add a start image or describe the video.' }, { status: 400 });
        }
      }
      if (model === 'happy-horse-1.1' && effectiveSd20Mode === 'r2v' && !prompt?.trim()) {
        return NextResponse.json({ success: false, error: 'Describe the video - references need a prompt (name them character1, character2...).' }, { status: 400 });
      }
      if (model === 'happy-horse-1.1' && effectiveSd20Mode !== 'r2v' && !imageUrl) {
        return NextResponse.json({ success: false, error: 'Happy Horse 1.1 needs a start image (or references).' }, { status: 400 });
      }
    } else if (model !== 'kling-v3-motion' && !isLipsync && !prompt && !(model === 'wan-2.7' && imageUrl) && model !== PIXELCUT_LOOPING) {
      // Name the field — a bare "missing required fields" tells nobody anything
      console.warn('Video submit rejected: no prompt', { model, mode: effectiveSd20Mode, hasImage: !!imageUrl, hasEditVideo: !!editVideoUrl })
      return NextResponse.json({ success: false, error: 'A prompt is required for this model.' }, { status: 400 });
    }
    if (model === 'flux-3' && effectiveSd20Mode === 'edit') {
      if (!editVideoUrl) {
        return NextResponse.json({ success: false, error: 'Flux 3 extend needs the source video — add it as a video reference.' }, { status: 400 });
      }
      // fal's extend-video schema documents "MP4, under 50 MB and under 15
      // seconds". It ACCEPTS the submit and then fails the queued job with a
      // bare "Invalid request parameters", which tells the user nothing and
      // costs them the run — so check what a HEAD can see beforehand.
      const problem = await flux3SourceProblem(editVideoUrl);
      if (problem) {
        return NextResponse.json({ success: false, error: problem }, { status: 400 });
      }
    }
    if (model === 'flux-3' && effectiveSd20Mode === 'r2v' && (!Array.isArray(referenceImageUrls) || referenceImageUrls.length === 0)) {
      return NextResponse.json({ success: false, error: 'Flux 3 keyframes need at least one reference image.' }, { status: 400 });
    }
    if (model === 'kling-v3-motion' && !motionVideoUrl) {
      return NextResponse.json({ success: false, error: 'Missing motion reference video URL' }, { status: 400 });
    }
    if (isLipsync && (!lipsyncVideoUrl || !lipsyncAudioUrl)) {
      return NextResponse.json({ success: false, error: 'Lipsync requires both video and audio URLs' }, { status: 400 });
    }

    if (!adminMode && !userId) {
      return NextResponse.json({ success: false, error: 'Please sign in to generate.' }, { status: 401 });
    }

    // Calculate ticket cost based on model. The formula lives in
    // lib/ticket-pricing.ts so the admin Ticket Economics page and this billing
    // path can never drift apart.
    /*
     * Luma lengths are enums: Ray 2 5s/9s, Ray 3.2 5s/10s. Ray 3.2's 10s
     * image-to-video only exists as a keyframed run, so it needs a start AND
     * an end frame (sent as keyframes); a start frame alone renders 5s. The
     * snapped length is what's both requested and billed.
     */
    const lumaDuration = model === 'luma-ray-3.2'
      ? (parseInt(duration) >= 10 && (!imageUrl || !!endImageUrl) ? '10' : '5')
      : parseInt(duration) >= 9 ? '9' : '5'
    /*
     * 2026-09-28 batch: the resolution that will actually render (Grok's
     * reference mode tops out at 720p; Vidu has no 360p with an end frame),
     * so the charge matches the output.
     */
    const batchMode = batch0928Mode(model, { imageUrl, endImageUrl, effectiveMode: effectiveSd20Mode })
    const batchRes = batch0928Resolution(model, resolution, batchMode, !!endImageUrl)
    const batchRefs = effectiveSd20Mode === 'r2v' && Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0
    const ticketCost: number = videoTicketCost({
      model,
      videoCreativity: videoToolCreativity,
      sourceHeight: probed?.height,
      sourceWidth: probed?.width,
      sourceFps: probed?.fps,
      targetFps: videoTargetFps,
      duration: LUMA_VIDEO_GENERATORS.has(model) ? lumaDuration : duration,
      resolution: BATCH_0928_GENERATORS.has(model) ? batchRes : resolution,
      referenceImageCount: batchRefs,
      hasStartImage: batchMode === 'i2v' || batchMode === 'transition' || ((BATCH_0929_GENERATORS.has(model) || LUMA_VIDEO_GENERATORS.has(model)) && !!imageUrl),
      hasEndImage: !!endImageUrl,
      fps: ltxFps,
      generateAudio,
      sd20Mode,
      effectiveSd20Mode,
      referenceVideoCount: Array.isArray(referenceVideoUrls) ? referenceVideoUrls.length : 0,
      referenceVideoDurationSec,
      editVideoDurationSec,
      lipsyncVideoDurationSec,
      motionVideoDurationSec,
      characterOrientation,
      videoUpscaleFactor,
      audioDurationSec,
      videoChoice: typeof videoChoice === 'string' ? videoChoice : undefined,
      promptWords: typeof prompt === 'string' ? prompt.trim().split(/\s+/).filter(Boolean).length : 0,
      ...(draftInfo ? { editVideoDurationSec: draftInfo.seconds } : {}),
      // SeeDance 2.5 Draft renders (and bills) at 480p whatever was picked
      ...(model === 'seedance-2.5' && videoChoice === 'draft' ? { resolution: '480p' } : {}),
    });

    // CCBill content filter — must pass BEFORE any charge or provider submit
    {
      const _cf = await enforceContentFilter(prompt, _u?.email)
      if (!_cf.ok) return NextResponse.json({ error: _cf.reason }, { status: 400 })
    }
    // For non-admin: verify and deduct tickets before queuing
    if (!adminMode) {
      const userTickets = await prisma.ticket.findUnique({
        where: { userId },
        select: { balance: true, reserved: true },
      });

      if (!userTickets) {
        return NextResponse.json({ success: false, error: 'User tickets not found' }, { status: 404 });
      }

      // Use the same effective balance formula as /api/user/tickets and the UI:
      // effectiveBalance = max(0, balance - reserved)
      // This prevents the display and the check from diverging when `reserved` is non-zero.
      const effectiveBalance = Math.max(0, userTickets.balance - (userTickets.reserved || 0));
      if (effectiveBalance < ticketCost) {
        return NextResponse.json(
          { success: false, error: `Insufficient tickets. Need ${ticketCost} tickets.` },
          { status: 400 }
        );
      }

      // Deduct tickets before submitting to FAL queue
      await prisma.ticket.update({
        where: { userId },
        data: {
          balance:   { decrement: ticketCost },
          totalUsed: { increment: ticketCost },
        },
      });
    }

    // Build FAL input based on model
    const falEndpoint = PIXELCUT_VIDEO_ENDPOINTS[model]
      ? PIXELCUT_VIDEO_ENDPOINTS[model]
      : (isSD20Family || isOmni)
      ? FAL_ENDPOINTS[`${model}-${effectiveSd20Mode}`] || FAL_ENDPOINTS[`${model}-t2v`]
      : model === 'seedance-1.5' && !imageUrl
      ? FAL_ENDPOINTS['seedance-1.5-text']
      : model === 'wan-2.7' && !imageUrl
      ? FAL_ENDPOINTS['wan-2.7-text']
      : isWanLora
      ? FAL_ENDPOINTS[imageUrl ? 'wan-2.2-lora-i2v' : 'wan-2.2-lora-t2v']
      : VIDEO_TOOL_MODELS.has(model)
      ? FAL_ENDPOINTS[model]
      : model === 'minimax-h3-max'
      ? FAL_ENDPOINTS[imageUrl ? 'minimax-h3-max' : 'minimax-h3-max-text']
      : BATCH_0928_GENERATORS.has(model)
      ? FAL_ENDPOINTS[`${model}-${batchMode}`]
      : BATCH_1007_GENERATORS.has(model)
      ? FAL_ENDPOINTS[batch1007EndpointKey(model, { referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [], effectiveMode: effectiveSd20Mode })]
      : BATCH_1003_GENERATORS.has(model)
      ? FAL_ENDPOINTS[batch1003EndpointKey(model, { referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [], effectiveMode: effectiveSd20Mode })]
      : BATCH_0929_GENERATORS.has(model)
      ? FAL_ENDPOINTS[batch0929EndpointKey(model, batch0929Mode(model, { imageUrl, endImageUrl, effectiveMode: effectiveSd20Mode }))]
      : (model === 'ltx-2.5-pro' || model === 'ltx-2.5-fast' || LUMA_VIDEO_GENERATORS.has(model))
      ? FAL_ENDPOINTS[`${model}-${imageUrl ? 'i2v' : 't2v'}`]
      : INPUT_ROUTED_MODELS.has(model)
      // Every one of these ships t2v/i2v (+ r2v where the family has it), so
      // the suffix follows the resolved mode. SeeDance 2.5 has no text-only
      // endpoint and Prime has no reference one — fall back to what exists.
      ? (FAL_ENDPOINTS[`${model}-${effectiveSd20Mode}`]
         || FAL_ENDPOINTS[`${model}-i2v`]
         || FAL_ENDPOINTS[`${model}-t2v`])
      : model === 'flux-3'
      // One family, five endpoints — the inputs decide which one runs
      ? FAL_ENDPOINTS[
          effectiveSd20Mode === 'edit' ? 'flux-3-extend'
          : effectiveSd20Mode === 'r2v' ? 'flux-3-keyframes'
          : (imageUrl && endImageUrl) ? 'flux-3-flf'
          : imageUrl ? 'flux-3-i2v'
          : 'flux-3-t2v'
        ]
      : FAL_ENDPOINTS[model] || FAL_ENDPOINTS['wan-2.5'];
    let falInput: Record<string, any>;

    if (isLipsync) {
      falInput = {
        video_url:  lipsyncVideoUrl,
        audio_url:  lipsyncAudioUrl,
        sync_mode:  lipsyncSyncMode || 'cut_off',
      };
    } else if (model === 'kling-v3-motion') {
      falInput = {
        image_url:             imageUrl,
        video_url:             motionVideoUrl,
        character_orientation: characterOrientation,
        keep_original_sound:   keepOriginalSound,
      };
      if (prompt?.trim()) falInput.prompt = prompt.trim();
    } else if (model === 'kling-v3') {
      falInput = {
        prompt,
        start_image_url: imageUrl,
        duration: String(duration),
        generate_audio: generateAudio,
      };
      // The frame follows the start image. fal still validates an aspect_ratio
      // if one is sent (16:9 / 9:16 / 1:1 only), so anything else - a 3:4 or
      // 4:3 storyboard - is left out rather than failing the shot
      if (['16:9', '9:16', '1:1'].includes(klingAspectRatio)) falInput.aspect_ratio = klingAspectRatio;
      if (endImageUrl) falInput.end_image_url = endImageUrl;
    } else if (model === 'kling-o3') {
      falInput = {
        prompt,
        image_url: imageUrl,
        duration: String(duration),
        generate_audio: generateAudio,
      };
    } else if (model === 'seedance-1.5') {
      falInput = {
        prompt,
        aspect_ratio: klingAspectRatio,
        resolution,
        duration: String(duration),
        generate_audio: generateAudio,
        enable_safety_checker: isAdminUser ? seedance15SafetyChecker === true : true,
      };
      if (imageUrl) falInput.image_url = imageUrl;
      if (endImageUrl) falInput.end_image_url = endImageUrl;
    } else if (isSD20Family) {
      // Base params shared across all SD20 modes.
      // fal's SeeDance 2.0 family accepts 480p/720p only — clamp any stale 1080p
      // from an old client to 720p instead of 422ing the whole job.
      const sd20Base: Record<string, any> = {
        prompt,
        resolution: resolution === '1080p' ? '720p' : resolution,
        generate_audio: generateAudio,
        enable_safety_checker: false,
      };
      // Only pass duration when explicitly selected (omit for "auto" — let the model decide)
      if (duration && duration !== 'auto') sd20Base.duration = String(duration);
      if (klingAspectRatio && klingAspectRatio !== 'auto') sd20Base.aspect_ratio = klingAspectRatio;

      if (effectiveSd20Mode === 'i2v') {
        falInput = { ...sd20Base, image_url: imageUrl };
        if (endImageUrl) falInput.end_image_url = endImageUrl;
      } else if (effectiveSd20Mode === 'r2v') {
        falInput = { ...sd20Base };
        if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) falInput.image_urls = referenceImageUrls;
        if (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0) falInput.video_urls = referenceVideoUrls;
        if (Array.isArray(referenceAudioUrls) && referenceAudioUrls.length > 0) falInput.audio_urls = referenceAudioUrls;
      } else {
        // t2v
        falInput = { ...sd20Base };
      }
    } else if (isOmni) {
      // Gemini Omni Flash schema: prompt + aspect_ratio (16:9|9:16) + duration
      // (INTEGER 3-10). No resolution/audio/safety params — extraneous keys 422.
      // Edit (video-to-video) takes ONLY prompt + video_url.
      const omniBase: Record<string, any> = { prompt };
      if (effectiveSd20Mode !== 'edit') {
        // fal takes 3-10 (an integer); anything outside is a 422 after the charge
        if (duration && duration !== 'auto') omniBase.duration = Math.min(10, Math.max(3, parseInt(duration) || 8));
        if (klingAspectRatio === '9:16' || klingAspectRatio === '16:9') omniBase.aspect_ratio = klingAspectRatio;
      }
      if (effectiveSd20Mode === 'i2v') {
        falInput = { ...omniBase, image_url: imageUrl };
      } else if (effectiveSd20Mode === 'r2v') {
        falInput = { ...omniBase, image_urls: (referenceImageUrls as string[]).slice(0, 9) };
      } else if (effectiveSd20Mode === 'edit') {
        falInput = { prompt, video_url: editVideoUrl };
      } else {
        falInput = { ...omniBase };
      }
    } else if (model === 'wan-2.7') {
      // ADMIN ONLY (testing). fal schema: 720p/1080p, duration 2-15 (integer),
      // optional prompt (i2v), first + end frame, driving audio; aspect_ratio is
      // t2v-only (i2v infers it from the start image).
      falInput = {
        resolution,
        duration: parseInt(duration) || 5,
        enable_prompt_expansion: true,
        enable_safety_checker: isAdminUser ? wan27SafetyChecker === true : true,
      };
      if (prompt?.trim()) falInput.prompt = prompt.trim();
      if (imageUrl) falInput.image_url = imageUrl;
      else if (klingAspectRatio && klingAspectRatio !== 'auto') falInput.aspect_ratio = klingAspectRatio;
      if (endImageUrl) falInput.end_image_url = endImageUrl;
      if (audioUrl) falInput.audio_url = audioUrl;
    } else if (PIXELCUT_VIDEO_ENDPOINTS[model]) {
      // lib/pixelcut-video builds the exact input; `videoChoice` is the motion
      // style (looping) or the background (removal)
      falInput = pixelcutVideoInput(model, {
        prompt, imageUrl, editVideoUrl, duration, resolution, generateAudio,
        choice: typeof videoChoice === 'string' ? videoChoice : undefined,
      });
    } else if (BATCH_1007_TOOLS.has(model) || BATCH_1007_GENERATORS.has(model)) {
      // lib/batch-1007-video builds the exact input (inputs checked above)
      falInput = batch1007Input(model, {
        prompt, imageUrl, editVideoUrl,
        referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [],
        duration, resolution, aspectRatio: klingAspectRatio, effectiveMode: effectiveSd20Mode, generateAudio,
        sourceWidth: probed?.width, sourceHeight: probed?.height,
      });
    } else if (BATCH_1003_TOOLS.has(model) || BATCH_1003_GENERATORS.has(model)) {
      // lib/batch-1003-video builds the exact input (inputs checked above)
      falInput = batch1003Input(model, {
        prompt, imageUrl, editVideoUrl, audioUrl,
        referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [],
        duration, resolution, aspectRatio: klingAspectRatio, effectiveMode: effectiveSd20Mode,
        choice: typeof videoChoice === 'string' ? videoChoice : undefined,
        insertStartSec: Number(insertStartSec), insertResumeSec: Number(insertResumeSec),
        sourceSec: editVideoDurationSec, sourceFps: probed?.fps,
        draftId: draftInfo?.draftId,
      });
    } else if (BATCH_0929_TOOLS.has(model) || BATCH_0929_GENERATORS.has(model)) {
      // lib/batch-0929-video builds the exact input (tools' prompts checked above)
      falInput = batch0929Input(model, {
        prompt, imageUrl, endImageUrl, editVideoUrl,
        referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [],
        duration, resolution, aspectRatio: klingAspectRatio, generateAudio, effectiveMode: effectiveSd20Mode,
      });
    } else if (BATCH_0928_TOOLS.has(model) || BATCH_0928_GENERATORS.has(model)) {
      // lib/batch-0928-video builds the exact input (tools' prompts checked above)
      falInput = batch0928Input(model, {
        prompt, imageUrl, endImageUrl, editVideoUrl,
        referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls as string[] : [],
        duration, resolution, aspectRatio: klingAspectRatio, generateAudio, effectiveMode: effectiveSd20Mode,
      });
    } else if (LUMA_VIDEO_TOOLS.has(model)) {
      // Luma tools. Resolution maps exactly as lib/ticket-pricing bills it.
      const res = resolution === '1080p' ? '1080p' : resolution === '720p' ? '720p' : '540p';
      const MODES = ['adhere_1', 'adhere_2', 'adhere_3', 'flex_1', 'flex_2', 'flex_3', 'reimagine_1', 'reimagine_2', 'reimagine_3'];
      const mode = MODES.includes(lumaMode) ? lumaMode : 'flex_1';
      const ar = (allowed: string[]) => allowed.includes(klingAspectRatio) ? klingAspectRatio : '9:16';
      if (model === 'luma-ray-2-modify' || model === 'luma-ray-2-flash-modify') {
        falInput = { video_url: editVideoUrl, mode };
        if (prompt?.trim()) falInput.prompt = prompt.trim();
      } else if (model === 'luma-ray-2-reframe' || model === 'luma-ray-2-flash-reframe') {
        falInput = { video_url: editVideoUrl, aspect_ratio: ar(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21']) };
        if (prompt?.trim()) falInput.prompt = prompt.trim();
      } else if (model === 'luma-ray-3.2-edit') {
        // Output length follows the source (and is billed that way)
        falInput = {
          video_url: editVideoUrl, prompt: prompt.trim(), edit_strength: mode, resolution: res,
          duration: (editVideoDurationSec > 0 ? editVideoDurationSec : 10) > 5.5 ? '10s' : '5s',
        };
      } else {
        // luma-ray-3.2-reframe: duration defaults to the source's
        falInput = { video_url: editVideoUrl, prompt: prompt.trim(), aspect_ratio: ar(['3:4', '4:3', '1:1', '9:16', '16:9', '21:9']), resolution: res };
      }
    } else if (LUMA_VIDEO_GENERATORS.has(model)) {
      const ray3 = model === 'luma-ray-3.2';
      const res = resolution === '1080p' ? '1080p' : resolution === '720p' ? '720p' : '540p';
      const ars = ray3 ? ['3:4', '4:3', '1:1', '9:16', '16:9', '21:9'] : ['16:9', '9:16', '4:3', '3:4', '21:9', '9:21'];
      falInput = { prompt, resolution: res, duration: `${lumaDuration}s` };
      if (ars.includes(klingAspectRatio)) falInput.aspect_ratio = klingAspectRatio;
      if (imageUrl) {
        // Ray 2 / Ray 2 Flash 422 any frame past 1920x1920 (a 2K 9:16 image is
        // 1536x2752); Ray 3.2 takes them as they are
        const frame = async (u: string) => (ray3 ? u : fitImageForFal(u, 1920));
        if (ray3 && lumaDuration === '10') {
          // 10s image-to-video is keyframed: pin the two frames at the ends
          // (24fps -> frames 0..240)
          falInput.keyframes = [imageUrl, endImageUrl];
          falInput.keyframe_indexes = [0, 240];
        } else {
          falInput.image_url = await frame(imageUrl);
          if (endImageUrl) falInput.end_image_url = await frame(endImageUrl);
        }
      }
    } else if (VIDEO_TOOL_MODELS.has(model)) {
      const factor = Math.max(1, Math.min(4, parseFloat(videoUpscaleFactor) || 2));
      falInput = { video_url: editVideoUrl };
      if (model === 'flux-video-upscale') {
        // This schema is stricter than the others: factor 1.5-3, and creativity
        // is an enum — 0 = faithful upscale, 1 = creative detail
        falInput.upscale_factor = Math.max(1.5, Math.min(3, factor));
        falInput.creativity = (parseFloat(videoToolCreativity) || 0) >= 0.5 ? 1 : 0;
        falInput.safety_tolerance = 2;
        if (prompt?.trim()) falInput.prompt = prompt.trim();   // optional guidance
      } else if (model.startsWith('topaz-upscale')) {
        falInput.upscale_factor = factor;
        falInput.H264_output = true;   // browser-playable output, not ProRes
        if (model === 'topaz-upscale-creative') {
          falInput.creativity = Math.max(0, Math.min(1, parseFloat(videoToolCreativity) || 0.35));
          if (prompt?.trim()) falInput.prompt = prompt.trim();
        }
        if (model === 'topaz-upscale-generative') falInput.model = 'Starlight Precise 2.6';
      } else if (model === 'seedvr2-video' || model === 'flashvsr-video') {
        falInput.upscale_factor = factor;
      } else if (model === 'kandinsky6-vsr' || model === 'kandinsky6-vsr-lite') {
        // Only 2, 2.25 (480p -> 1080p) or 4 - the factor upscalerVideoTicketCost billed
        const { KANDINSKY_VSR_FACTORS } = await import('@/lib/ticket-pricing')
        falInput.upscale_factor = KANDINSKY_VSR_FACTORS.includes(factor) ? factor : 2.25;
      } else if (model === 'bytedance-video-upscale') {
        // Same ratio, tier and frame rate the price was computed on
        // (upscalerVideoTicketCost): output capped at 4K, standard tier, the
        // source's own frame rate instead of fal's default 30
        const { bytedanceUpscaleRatio } = await import('@/lib/ticket-pricing')
        falInput.scale_ratio = bytedanceUpscaleRatio(factor, probed ? Math.min(probed.width, probed.height) : 1080);
        falInput.enhancement_tier = 'standard';
        falInput.target_fps = Math.max(24, Math.min(60, Math.round(probed?.fps || 30)));
      } else if (model === 'topaz-interpolate') {
        falInput.target_fps = Math.max(16, Math.min(120, parseInt(videoTargetFps) || 60));
        falInput.H264_output = true;
      } else if (model === 'topaz-colorize' || model === 'topaz-deblur') {
        falInput.H264_output = true;
      }
      // topaz-sdr-to-hdr takes only video_url (+ output_format, left at mp4)
    } else if (model === 'wan-3.0' || model === 'wan-3.0-prime') {
      // Wan 3.0: prompt optional on i2v, native audio, adaptive aspect.
      // Prime has no reference endpoint, so references route to i2v/t2v.
      falInput = {
        resolution: ['480p', '720p', '1080p'].includes(resolution) ? resolution : '1080p',
        duration: duration === 'auto' ? 5 : Math.max(2, parseInt(duration) || 5),
        audio: generateAudio,
        enable_prompt_expansion: true,
        enable_safety_checker: isAdminUser ? wan30SafetyChecker !== false : true,
      };
      if (prompt?.trim()) falInput.prompt = prompt.trim();
      if (['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(klingAspectRatio)) {
        falInput.aspect_ratio = klingAspectRatio;
      }
      if (effectiveSd20Mode === 'r2v' && model === 'wan-3.0') {
        falInput.reference_image_urls = (referenceImageUrls as string[] || []).slice(0, 9);
        if (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length) falInput.reference_video_urls = referenceVideoUrls;
        if (Array.isArray(referenceAudioUrls) && referenceAudioUrls.length) falInput.reference_audio_urls = referenceAudioUrls;
      } else if (imageUrl) {
        falInput.start_image_url = imageUrl;
        if (endImageUrl) falInput.end_image_url = endImageUrl;
      }
    } else if (model === 'seedance-2.5') {
      // No text-only endpoint: an image or references are required
      falInput = {
        prompt,
        resolution: ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p',
        duration: duration === 'auto' ? 'auto' : String(Math.min(12, Math.max(4, parseInt(duration) || 5))),
        generate_audio: generateAudio,
        bitrate_mode: 'standard',
        // fal's default for 2.5 is HEVC (Main 10), which desktop Chrome cannot
        // decode - the result would play black in the feed. H.264 plays everywhere.
        codec: 'H264',
      };
      // Draft: a 480p preview at the 480p rate, returning a draft id that
      // seedance-2.5-complete re-renders at 1080p within seven days
      if (videoChoice === 'draft') { falInput.draft = true; falInput.resolution = '480p' }
      if (['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(klingAspectRatio)) {
        falInput.aspect_ratio = klingAspectRatio;
      }
      if (effectiveSd20Mode === 'r2v') {
        falInput.image_urls = (referenceImageUrls as string[] || []).slice(0, 9);
        if (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length) falInput.video_urls = referenceVideoUrls;
        if (Array.isArray(referenceAudioUrls) && referenceAudioUrls.length) falInput.audio_urls = referenceAudioUrls;
      } else {
        falInput.image_url = imageUrl;
        if (endImageUrl) falInput.end_image_url = endImageUrl;
      }
    } else if (model === 'gemini-omni-1.1') {
      const omniRes = ['360p', '720p', '1080p', '4k'].includes(resolution) ? resolution : '720p';
      if (effectiveSd20Mode === 'edit') {
        // The 1.1 edit endpoint is VIDEO-to-video and takes nothing else —
        // no duration, no aspect ratio.
        falInput = { prompt, video_url: editVideoUrl, resolution: omniRes };
      } else {
        falInput = {
          prompt,
          resolution: omniRes,
          duration: Math.min(10, Math.max(3, parseInt(duration) || 8)), // fal's 3-10 range
          aspect_ratio: klingAspectRatio === '9:16' ? '9:16' : '16:9',
        };
        if (effectiveSd20Mode === 'r2v') {
          falInput.image_urls = (referenceImageUrls as string[] || []).slice(0, 9);
          if (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length) falInput.reference_video_urls = referenceVideoUrls;
        } else if (imageUrl) {
          falInput.image_url = imageUrl;
          if (endImageUrl) falInput.end_image_url = endImageUrl;
        }
      }
    } else if (model === 'ltx-2.5-pro' || model === 'ltx-2.5-fast') {
      const fastTier = model === 'ltx-2.5-fast';
      const allowedRes = fastTier ? ['720p', '1080p', '1440p', '2160p'] : ['720p', '1080p'];
      const wanted = parseInt(duration) || 0;
      const ltxRes = allowedRes.includes(resolution) ? resolution : '1080p';
      // Fast takes 48fps too (Pro doesn't); 48/50fps and 1440p+ cap Fast at 10s
      const ltxFpsNum = (fastTier ? [24, 25, 48, 50] : [24, 25, 50]).includes(parseInt(ltxFps)) ? parseInt(ltxFps) : 25;
      falInput = {
        prompt,
        resolution: ltxRes,
        // Enum durations only — snap to the nearest the tier supports (the
        // same function the price uses, so the charge matches the render)
        duration: fastTier
          ? ltxFastSeconds(duration, ltxRes, ltxFpsNum)
          : duration === 'auto' || !wanted
          ? 'auto'
          : [6, 8, 10].reduce((best, d) => Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best, 6),
        fps: ltxFpsNum,
        generate_audio: generateAudio,
        aspect_ratio: ['auto', '16:9', '9:16'].includes(klingAspectRatio) ? klingAspectRatio : 'auto',
      };
      if (imageUrl) {
        falInput.image_url = imageUrl;
        if (endImageUrl) falInput.end_image_url = endImageUrl;
      } else {
        // The text endpoint has no 'auto' aspect
        if (falInput.aspect_ratio === 'auto') falInput.aspect_ratio = '16:9';
      }
    } else if (model === 'minimax-h3-max') {
      // fal schema: prompt + prompt_expansion_mode required; duration 5-15;
      // resolution 480P/768P (capitalised); aspect_ratio is t2v-only, since an
      // input image already fixes the framing.
      falInput = {
        prompt,
        duration: Math.min(15, Math.max(5, parseInt(duration) || 5)),
        resolution: resolution === '480p' ? '480P' : '768P',
        prompt_expansion_mode: 'balanced',
        // Admins may flip fal's own checker; everyone else is forced ON
        enable_safety_checker: isAdminUser ? h3MaxSafetyChecker !== false : true,
      };
      if (imageUrl) falInput.image_url = imageUrl;
      // t2v only, and only values this schema accepts — a ratio carried over
      // from another model would otherwise be rejected by fal
      else if (['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(klingAspectRatio)) {
        falInput.aspect_ratio = klingAspectRatio;
      }
      if (endImageUrl) falInput.end_image_url = endImageUrl;
    } else if (model === 'flux-3') {
      // Shared across all five Flux 3 endpoints. safety_tolerance stays at
      // fal's default of 2 — the provider filter is deliberately left on.
      const secs = duration === 'auto' ? 0 : Math.min(20, Math.max(5, parseInt(duration) || 5));
      falInput = {
        prompt,
        resolution: resolution === '1080p' ? '1080p' : '720p',
        // 0 strictest … 4 most permissive (fal default 2). Admins who switch
        // the checker off get the most permissive setting the schema allows.
        safety_tolerance: isAdminUser && flux3SafetyChecker === false ? 4 : 2,
        generate_audio: generateAudio,
      };
      if (['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(klingAspectRatio)) {
        falInput.aspect_ratio = klingAspectRatio;
      }
      // 'auto' is sent as 10s: fal's own auto ran a test to 15s (it can reach
      // 20s), and the price is fixed up front (lib/ticket-pricing bills 10s)
      if (effectiveSd20Mode === 'edit') {
        falInput.video_url = editVideoUrl;
        falInput.duration = secs || 10;
      } else if (effectiveSd20Mode === 'r2v') {
        // Keyframes are pinned to FRAME positions in a 24fps render, must be
        // unique, and must not exceed duration * 24 — so spread them evenly
        // across a duration that is always concrete here.
        const imgs = (referenceImageUrls as string[]).slice(0, 10);
        const dur = secs || 5;
        const last = Math.max(1, dur * 24 - 1);
        falInput.duration = dur;
        falInput.keyframes = imgs.map((url, i) => ({
          image_url: url,
          frame_index: imgs.length === 1 ? 0 : Math.round((i * last) / (imgs.length - 1)),
        }));
      } else if (imageUrl && endImageUrl) {
        falInput.start_image_url = imageUrl;
        falInput.end_image_url = endImageUrl;
        falInput.duration = secs || 5;      // this endpoint has no 'auto'
      } else if (imageUrl) {
        falInput.image_url = imageUrl;
        falInput.duration = secs || 10;
      } else {
        falInput.duration = secs || 10;
      }
    } else if (isWanLora) {
      // Wan 2.2 A14B */lora schema (verified via fal OpenAPI): resolution
      // 480p/580p/720p, num_frames 17-161 (default 81 ≈ 5s @16fps), loras[]
      // of { path, scale, transformer }. duration (sec) → num_frames @16fps.
      const sec = Math.min(10, Math.max(1, parseInt(duration) || 5));
      falInput = {
        prompt,
        loras: wanLoras,
        resolution: ['480p', '580p', '720p'].includes(resolution) ? resolution : '720p',
        num_frames: Math.min(161, Math.max(17, sec * 16 + 1)),
        enable_safety_checker: isAdminUser ? false : true,
      };
      if (imageUrl) falInput.image_url = imageUrl;
      else if (['16:9', '9:16', '1:1'].includes(klingAspectRatio)) falInput.aspect_ratio = klingAspectRatio;
    } else if (model === 'happy-horse') {
      falInput = {
        image_url: imageUrl,
        resolution,
        duration: parseInt(duration),
        enable_safety_checker: false,
      };
      if (prompt?.trim()) falInput.prompt = prompt.trim();
    } else {
      // WAN 2.5
      falInput = {
        prompt,
        image_url: imageUrl,
        resolution,
        duration,
        enable_prompt_expansion: true,
        enable_safety_checker: isAdminUser ? wan25SafetyChecker === true : true,
      };
      if (audioUrl) falInput.audio_url = audioUrl;
    }

    console.log(`Submitting ${model} job to FAL queue:`, JSON.stringify({ falEndpoint, ...falInput }, null, 2));

    // Admin mode: resolve the target user, sync counter, then claim a slot or queue for later
    let adminSlotClaimed = false
    let adminTargetUserId: number | null = null
    if (adminMode) {
      const { cookies } = await import('next/headers')
      const { getUserFromSession } = await import('@/lib/auth')
      const FALLBACK_ADMIN_EMAILS = ['promptandprotocol@gmail.com', 'dirtysecretai@gmail.com']
      const cookieStore = await cookies()
      const token = cookieStore.get('session')?.value
      const sessionUser = token ? await getUserFromSession(token) : null
      if (!sessionUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      // Verify the session user is actually an admin
      let isAdmin = false
      try {
        const count = await prisma.adminAccount.count()
        if (count === 0) {
          isAdmin = FALLBACK_ADMIN_EMAILS.includes(sessionUser.email)
        } else {
          const account = await prisma.adminAccount.findUnique({ where: { email: sessionUser.email } })
          isAdmin = !!(account?.canAccessAdmin)
        }
      } catch {
        isAdmin = FALLBACK_ADMIN_EMAILS.includes(sessionUser.email)
      }
      if (!isAdmin) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      adminTargetUserId = sessionUser.id
      if (!adminTargetUserId) {
        return NextResponse.json({ success: false, error: 'No user found' }, { status: 500 });
      }

      const { claimed, maxConcurrent } = await syncAndClaimFalSlot()
      if (!claimed) {
        const queueEntry = await prisma.generationQueue.create({
          data: {
            userId:     adminTargetUserId,
            modelId:    model,
            modelType:  'video',
            prompt:     (prompt || '').trim(),
            parameters: { falEndpoint, falInput, usePolling: true, ...(model === 'void-video-removal' && probed?.fps ? { sourceFps: probed.fps } : {}) },
            status:     'queued',
            ticketCost: ticketCost, // real cost — admin video is debited client-side; refunded server-side on failure
          },
        })
        console.log(`Video queued (at capacity, max=${maxConcurrent}) model=${model} queueId=#${queueEntry.id}`)
        return NextResponse.json({ success: true, queued: true, queueId: queueEntry.id, ticketCost, model, resolution, duration, falEndpoint })
      }
      adminSlotClaimed = true
    }

    // Submit to FAL async queue (returns immediately with a requestId)
    let requestId: string;
    try {
      const submitted = await fal.queue.submit(falEndpoint, { input: falInput });
      requestId = submitted.request_id;
    } catch (falError: any) {
      // Refund tickets if FAL submit fails
      if (!adminMode) {
        await prisma.ticket.update({
          where: { userId },
          data: {
            balance:   { increment: ticketCost },
            totalUsed: { decrement: ticketCost },
          },
        }).catch(() => {}); // best-effort refund
      }

      // Release the admin slot we claimed (if any)
      if (adminMode && adminSlotClaimed) {
        const { FAL_GLOBAL_ID } = await import('@/lib/fal-queue')
        await prisma.modelConcurrencyLimit.updateMany({
          where: { modelId: FAL_GLOBAL_ID },
          data: { currentActive: { decrement: 1 } },
        }).catch(() => {})
      }

      console.error('FAL queue submit error:', falError);
      const isContentViolation = falError.body?.detail?.[0]?.type === 'content_policy_violation';
      const rawDetail = Array.isArray(falError.body?.detail)
        ? falError.body.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ')
        : falError.body?.message || falError.message || 'Unknown error'
      const { friendlyFalVideoError } = await import('@/lib/fal-friendly-errors')
      return NextResponse.json(
        {
          success: false,
          error: isContentViolation
            ? 'Content policy violation: Your prompt or image was flagged. Please use different content.'
            : `Failed to queue video generation: ${friendlyFalVideoError(rawDetail)}`,
          isContentViolation,
        },
        { status: 400 }
      );
    }

    // Track as processing in GenerationQueue so the polling status route can settle
    // the job and — on failure — refund the debited tickets server-side (works even
    // if the user's tab is closed). ticketCost is the amount actually debited:
    // admin video is debited client-side, non-admin server-side above.
    let queueId: number | null = null
    if (adminMode && adminSlotClaimed && adminTargetUserId) {
      queueId = (await prisma.generationQueue.create({
        data: {
          userId:      adminTargetUserId,
          modelId:     model,
          modelType:   'video',
          prompt:      (prompt || '').trim(),
          parameters:  { falEndpoint, falInput, usePolling: true, ...(model === 'void-video-removal' && probed?.fps ? { sourceFps: probed.fps } : {}) },
          status:      'processing',
          ticketCost:  ticketCost,
          falRequestId: requestId,
          startedAt:   new Date(),
        },
        select: { id: true },
      })).id
    } else if (!adminMode && userId) {
      queueId = (await prisma.generationQueue.create({
        data: {
          userId:       userId,
          modelId:      model,
          modelType:    'video',
          prompt:       (prompt || '').trim(),
          parameters:   { falEndpoint, falInput, usePolling: true, ...(model === 'void-video-removal' && probed?.fps ? { sourceFps: probed.fps } : {}) },
          status:       'processing',
          ticketCost:   ticketCost,
          falRequestId: requestId,
          startedAt:    new Date(),
        },
        select: { id: true },
      }).catch(() => null))?.id ?? null
    }

    return NextResponse.json({
      success: true,
      requestId,
      // The queue row this job owns, so a caller can poll it. Additive: the
      // portal ignores it; the chat hub polls on it.
      queueId,
      falEndpoint,
      ticketCost,
      model,
      resolution,
      duration,
    });

  } catch (error: any) {
    console.error('Video generation error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Failed to submit video generation' }, { status: 500 });
  }
}
