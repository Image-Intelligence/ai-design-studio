import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { fal } from "@fal-ai/client";
import { syncAndClaimFalSlot } from '@/lib/admin-queue-helpers';
import { isGenerationBlocked } from '@/lib/generation-guard';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';


fal.config({
  credentials: process.env.FAL_KEY!
});

// FAL endpoint IDs by model
const FAL_ENDPOINTS: Record<string, string> = {
  'wan-2.5':               'fal-ai/wan-25-preview/image-to-video',
  'kling-v3':              'fal-ai/kling-video/v3/pro/image-to-video',
  'kling-o3':              'fal-ai/kling-video/o3/standard/image-to-video',
  'kling-v3-motion':       'fal-ai/kling-video/v3/pro/motion-control',
  'seedance-1.5':          'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  'seedance-1.5-text':     'fal-ai/bytedance/seedance/v1.5/pro/text-to-video',
  'seedance-2.0-t2v':           'fal-ai/bytedance/seedance-2.0/text-to-video',
  'seedance-2.0-i2v':           'fal-ai/bytedance/seedance-2.0/image-to-video',
  'seedance-2.0-r2v':           'fal-ai/bytedance/seedance-2.0/reference-to-video',
  'seedance-2.0-fast-t2v':      'fal-ai/bytedance/seedance-2.0/fast/text-to-video',
  'seedance-2.0-fast-i2v':      'fal-ai/bytedance/seedance-2.0/fast/image-to-video',
  'seedance-2.0-fast-r2v':      'fal-ai/bytedance/seedance-2.0/fast/reference-to-video',
  'lipsync-v3':                 'fal-ai/sync-lipsync/v3',
  'happy-horse':                'alibaba/happy-horse/image-to-video',
};

export async function POST(request: NextRequest) {
  try {
    const _ck = await cookies(); const _tok = _ck.get('session')?.value
    const _u = _tok ? await getUserFromSession(_tok) : null
    if (await isGenerationBlocked(_u?.email)) {
      return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
    }

    const {
      userId,
      prompt,
      imageUrl,
      duration = '5',
      resolution = '1080p',
      audioUrl,
      adminMode = false,
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
      // SeeDance 2.0 reference-to-video
      sd20Mode = 't2v',
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      referenceVideoDurationSec = 0,
      // Lipsync v3
      lipsyncVideoUrl,
      lipsyncAudioUrl,
      lipsyncSyncMode = 'cut_off',
      lipsyncVideoDurationSec = 0,
      // WAN 2.5 safety
      wan25SafetyChecker = true,
      // Seedance 1.5 safety
      seedance15SafetyChecker = true,
    } = await request.json();

    const isSD20Family = model === 'seedance-2.0' || model === 'seedance-2.0-fast'
    const isLipsync = model === 'lipsync-v3'
    // For SD20 family: auto-detect mode from imageUrl; explicit r2v overrides
    const effectiveSd20Mode = isSD20Family
      ? (sd20Mode === 'r2v' ? 'r2v' : imageUrl ? 'i2v' : 't2v')
      : sd20Mode
    const isTextToVideo = model === 'seedance-1.5'
      ? !imageUrl
      : isSD20Family
        ? (effectiveSd20Mode === 't2v')
        : false
    if (!imageUrl && !isTextToVideo && !isLipsync) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (model !== 'kling-v3-motion' && !isLipsync && !prompt) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (model === 'kling-v3-motion' && !motionVideoUrl) {
      return NextResponse.json({ success: false, error: 'Missing motion reference video URL' }, { status: 400 });
    }
    if (isLipsync && (!lipsyncVideoUrl || !lipsyncAudioUrl)) {
      return NextResponse.json({ success: false, error: 'Lipsync requires both video and audio URLs' }, { status: 400 });
    }

    if (!adminMode && !userId) {
      return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
    }

    // Calculate ticket cost based on model
    let ticketCost: number;
    if (isLipsync) {
      ticketCost = Math.max(10, Math.ceil((lipsyncVideoDurationSec || 0) * 6));
    } else if (model === 'kling-v3-motion') {
      // 6 tickets/sec × actual video duration (or max if unknown)
      const fallbackSec = characterOrientation === 'video' ? 30 : 10;
      const sec = motionVideoDurationSec ? Math.ceil(motionVideoDurationSec) : fallbackSec;
      ticketCost = sec * 6;
    } else if (model === 'kling-o3') {
      const pricing: Record<string, number> = {
        '3': 15, '4': 18, '5': 20, '6': 24, '7': 28,
        '8': 32, '9': 36, '10': 40, '11': 44, '12': 48,
        '13': 52, '14': 56, '15': 60,
      };
      ticketCost = pricing[duration] || 20;
    } else if (model === 'kling-v3') {
      ticketCost = parseInt(duration) * (generateAudio ? 8 : 6);
    } else if (model === 'seedance-1.5') {
      const resMultiplier = resolution === '1080p' ? 2.25 : resolution === '480p' ? 0.5 : 1.0
      const audioMultiplier = generateAudio ? 1.0 : 0.5
      ticketCost = Math.ceil(parseInt(duration) * 2.0 * resMultiplier * audioMultiplier) + 1
    } else if (model === 'seedance-2.0') {
      const resMultiplier = resolution === '1080p' ? 2.25 : resolution === '480p' ? 0.5 : 1.0
      const hasVideoRefs = sd20Mode === 'r2v' && Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0
      const videoInputMultiplier = hasVideoRefs ? 0.6 : 1.0
      const outputDurSec = duration === 'auto' ? 5 : parseInt(duration)
      const effectiveDur = outputDurSec + (hasVideoRefs ? (referenceVideoDurationSec || 0) : 0)
      ticketCost = Math.ceil(effectiveDur * 15 * resMultiplier * videoInputMultiplier)
    } else if (model === 'seedance-2.0-fast') {
      // 12 tickets/sec at 720p; 480p = 0.5x
      const resMultiplier = resolution === '480p' ? 0.5 : 1.0
      const hasVideoRefs = sd20Mode === 'r2v' && Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0
      const videoInputMultiplier = hasVideoRefs ? 0.6 : 1.0
      const outputDurSec = duration === 'auto' ? 5 : parseInt(duration)
      const effectiveDur = outputDurSec + (hasVideoRefs ? (referenceVideoDurationSec || 0) : 0)
      ticketCost = Math.ceil(effectiveDur * 12 * resMultiplier * videoInputMultiplier)
    } else if (model === 'happy-horse') {
      ticketCost = parseInt(duration) * (resolution === '1080p' ? 12 : 7);
    } else {
      const pricing: Record<string, Record<string, number>> = {
        '480p':  { '5': 7,  '10': 14 },
        '720p':  { '5': 13, '10': 26 },
        '1080p': { '5': 20, '10': 40 },
      };
      ticketCost = pricing[resolution]?.[duration] || 20;
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
    const falEndpoint = isSD20Family
      ? FAL_ENDPOINTS[`${model}-${effectiveSd20Mode}`] || FAL_ENDPOINTS[`${model}-t2v`]
      : model === 'seedance-1.5' && !imageUrl
      ? FAL_ENDPOINTS['seedance-1.5-text']
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
        aspect_ratio: klingAspectRatio,
        generate_audio: generateAudio,
      };
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
        enable_safety_checker: seedance15SafetyChecker === true,
      };
      if (imageUrl) falInput.image_url = imageUrl;
      if (endImageUrl) falInput.end_image_url = endImageUrl;
    } else if (isSD20Family) {
      // Base params shared across all SD20 modes
      const sd20Base: Record<string, any> = {
        prompt,
        resolution,
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
        enable_safety_checker: wan25SafetyChecker === true,
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
            parameters: { falEndpoint, falInput, usePolling: true },
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
      return NextResponse.json(
        {
          success: false,
          error: isContentViolation
            ? 'Content policy violation: Your prompt or image was flagged. Please use different content.'
            : `Failed to queue video generation: ${falError.message || 'Unknown error'}`,
          isContentViolation,
        },
        { status: 400 }
      );
    }

    // Track as processing in GenerationQueue so the polling status route can settle
    // the job and — on failure — refund the debited tickets server-side (works even
    // if the user's tab is closed). ticketCost is the amount actually debited:
    // admin video is debited client-side, non-admin server-side above.
    if (adminMode && adminSlotClaimed && adminTargetUserId) {
      await prisma.generationQueue.create({
        data: {
          userId:      adminTargetUserId,
          modelId:     model,
          modelType:   'video',
          prompt:      (prompt || '').trim(),
          parameters:  { falEndpoint, falInput, usePolling: true },
          status:      'processing',
          ticketCost:  ticketCost,
          falRequestId: requestId,
          startedAt:   new Date(),
        },
      })
    } else if (!adminMode && userId) {
      await prisma.generationQueue.create({
        data: {
          userId:       userId,
          modelId:      model,
          modelType:    'video',
          prompt:       (prompt || '').trim(),
          parameters:   { falEndpoint, falInput, usePolling: true },
          status:       'processing',
          ticketCost:   ticketCost,
          falRequestId: requestId,
          startedAt:    new Date(),
        },
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      requestId,
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
