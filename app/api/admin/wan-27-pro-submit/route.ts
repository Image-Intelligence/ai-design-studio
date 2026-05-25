import { NextResponse } from 'next/server'
import { fal } from '@fal-ai/client'
import { uploadToR2 } from '@/lib/r2'
import prisma from '@/lib/prisma'
import { syncAndClaimFalSlot } from '@/lib/admin-queue-helpers'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'

fal.config({ credentials: process.env.FAL_KEY })

// Maps our aspect ratio strings to Wan 2.7 Pro image_size enum values
function aspectRatioToImageSize(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1':  return 'square_hd'
    case '4:3':  return 'landscape_4_3'
    case '16:9': return 'landscape_16_9'
    case '3:4':  return 'portrait_4_3'
    case '9:16': return 'portrait_16_9'
    default:     return 'landscape_16_9'
  }
}

// POST /api/admin/wan-27-pro-submit
// Submits a Wan 2.7 Pro image generation job to the FAL async queue.
// Uses text-to-image endpoint when no reference images; edit endpoint otherwise.
// Returns immediately with { requestId, falEndpoint } — client polls /api/admin/wan-27-pro-status.
export async function POST(req: Request) {
  try {
    const _ck = await cookies(); const _tok = _ck.get('session')?.value
    const _u = _tok ? await getUserFromSession(_tok) : null
    if (await isGenerationBlocked(_u?.email)) {
      return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
    }

    const {
      prompt,
      image_urls,          // array of hosted URLs or base64 data URIs (edit mode)
      aspect_ratio = '16:9',
      num_images = 1,
      enable_safety_checker = true,
    } = await req.json()

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const imageSize = aspectRatioToImageSize(aspect_ratio)
    const permanentReferenceUrls: string[] = []
    let endpoint: string
    const input: Record<string, unknown> = {
      prompt: prompt.trim(),
      image_size: imageSize,
      enable_safety_checker: enable_safety_checker === true,
    }

    if (Array.isArray(image_urls) && image_urls.length > 0) {
      // Edit mode — upload any data URIs to FAL storage and Vercel Blob
      const hostedUrls: string[] = []
      for (let i = 0; i < image_urls.length; i++) {
        const imgUrl = image_urls[i]
        if (imgUrl.startsWith('data:')) {
          const [meta, b64] = imgUrl.split(',')
          const mimeType = meta.split(':')[1]?.split(';')[0] || 'image/jpeg'
          const buffer = Buffer.from(b64, 'base64')
          const falBlob = new Blob([buffer], { type: mimeType })
          const falUrl = await fal.storage.upload(falBlob)
          const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
          const vUrl = await uploadToR2(`reference-wan27-${Date.now()}-${i}.${ext}`, buffer, mimeType)
          hostedUrls.push(falUrl)
          permanentReferenceUrls.push(vUrl)
        } else {
          hostedUrls.push(imgUrl)
          permanentReferenceUrls.push(imgUrl)
        }
      }
      input.image_urls = hostedUrls
      input.num_images = Math.min(Math.max(1, parseInt(num_images) || 1), 4)
      endpoint = 'fal-ai/wan/v2.7/pro/edit'
    } else {
      input.max_images = Math.min(Math.max(1, parseInt(num_images) || 1), 5)
      endpoint = 'fal-ai/wan/v2.7/pro/text-to-image'
    }

    console.log(`Wan 2.7 Pro submit (${endpoint}): aspect=${aspect_ratio} size=${imageSize}`)

    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null
    const targetUserId: number | null = sessionUser?.id ?? null
    if (!targetUserId) return NextResponse.json({ error: 'Not authenticated — log in before using the admin scanner' }, { status: 401 })

    // Server-side ticket check — WAN 2.7 Pro costs 4 tickets
    const ticketCost = 4
    const ticketResult = await deductGenerationTickets(targetUserId, sessionUser!.email, ticketCost)
    if (!ticketResult.ok) {
      return NextResponse.json(
        { error: `Insufficient tickets — need ${ticketResult.need}, have ${ticketResult.have}` },
        { status: 402 },
      )
    }

    const { allowed, activeCount, limit } = await checkUserConcurrency(targetUserId)
    if (!allowed) {
      return NextResponse.json(
        { error: `Queue full (${activeCount}/${limit} active). Wait for a generation to finish.` },
        { status: 429 }
      )
    }

    // Sync counter from ground truth, then atomically claim a slot
    const { claimed, maxConcurrent } = await syncAndClaimFalSlot()

    if (!claimed) {
      const queueEntry = await prisma.generationQueue.create({
        data: {
          userId:     targetUserId!,
          modelId:    'wan-2.7-pro',
          modelType:  'image',
          prompt:     (prompt as string).trim(),
          parameters: { falEndpoint: endpoint, falInput: input, usePolling: true, permanentReferenceUrls } as any,
          status:     'queued',
          ticketCost: 0,
        },
      })
      console.log(`Wan 2.7 Pro queued (at capacity, max=${maxConcurrent}) → queueId #${queueEntry.id}`)
      return NextResponse.json({ success: true, queued: true, queueId: queueEntry.id, permanentReferenceUrls })
    }

    try {
      const submitted = await fal.queue.submit(endpoint, { input })

      const queueEntry = await prisma.generationQueue.create({
        data: {
          userId:       targetUserId!,
          modelId:      'wan-2.7-pro',
          modelType:    'image',
          prompt:       (prompt as string).trim(),
          parameters:   { falEndpoint: endpoint, falInput: input, usePolling: true, permanentReferenceUrls } as any,
          status:       'processing',
          ticketCost:   0,
          falRequestId: submitted.request_id,
          startedAt:    new Date(),
        },
      })

      return NextResponse.json({
        success: true,
        requestId: submitted.request_id,
        falEndpoint: endpoint,
        queueId: queueEntry.id,
        permanentReferenceUrls,
      })
    } catch (submitError: any) {
      const { FAL_GLOBAL_ID } = await import('@/lib/fal-queue')
      await prisma.modelConcurrencyLimit.updateMany({
        where: { modelId: FAL_GLOBAL_ID },
        data: { currentActive: { decrement: 1 } },
      }).catch(() => {})
      await refundGenerationTickets(targetUserId!, sessionUser!.email, ticketCost)
      throw submitError
    }
  } catch (error: any) {
    console.error('Wan 2.7 Pro submit error:', error)
    return NextResponse.json({ error: error.message || 'Submission failed' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
