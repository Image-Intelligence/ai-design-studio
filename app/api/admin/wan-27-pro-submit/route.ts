import { NextResponse } from 'next/server'
import { enforcePublicModeration } from '@/lib/public-moderation'
import { checkIsAdmin } from '@/lib/admin-check'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import prisma from '@/lib/prisma'
import { syncAndClaimFalSlot } from '@/lib/admin-queue-helpers'
import { generationCaller } from '@/lib/api-key-auth'
import { claimUserGenerationRow } from '@/lib/user-concurrency'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { deductGenerationTickets, refundGenerationTickets, isAdminEmail } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { fetchMedia } from '@/lib/media-fetch'
import { canonicalisePayload } from '@/lib/media-url'

fal.config({ credentials: process.env.FAL_KEY })

// fal rejects reference files over 10MB ("File size exceeds the maximum allowed
// size of 10485760 bytes"). Library refs are stored full-quality, so originals can
// exceed that — compress just the copy sent to the model, never the stored ref.
const FAL_REF_MAX_BYTES = 10 * 1024 * 1024

async function compressForFal(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  const sharp = (await import('sharp')).default
  // Try progressively harder: cap the long edge, then step down JPEG quality
  for (const [maxDim, quality] of [[4096, 92], [4096, 85], [3072, 82], [2048, 78]] as const) {
    const out = await sharp(buffer)
      .rotate() // bake EXIF orientation before stripping metadata
      .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (out.length <= FAL_REF_MAX_BYTES) return { buffer: out, mimeType: 'image/jpeg' }
  }
  throw new Error('Reference image could not be compressed under the 10MB model limit')
}

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
    const _u = await generationCaller(req)
    if (await isGenerationBlocked(_u?.email)) {
      return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
    }

    const {
      prompt,
      image_urls,          // array of hosted URLs or base64 data URIs (edit mode)
      aspect_ratio = '16:9',
      num_images = 1,
      enable_safety_checker = true,
    } = canonicalisePayload(await req.json())

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
          let mimeType = meta.split(':')[1]?.split(';')[0] || 'image/jpeg'
          let buffer: Buffer = Buffer.from(b64, 'base64')
          const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
          // Store the ORIGINAL full-quality upload; compress only fal's copy
          const vUrl = await uploadToR2(`reference-wan27-${Date.now()}-${i}.${ext}`, buffer, mimeType)
          if (buffer.length > FAL_REF_MAX_BYTES) {
            ({ buffer, mimeType } = await compressForFal(buffer))
          }
          const falUrl = await fal.storage.upload(new Blob([new Uint8Array(buffer)], { type: mimeType }))
          hostedUrls.push(falUrl)
          permanentReferenceUrls.push(vUrl)
        } else {
          // Hosted URL (library ref) — originals are stored full-quality, so check
          // the real size and swap in a compressed fal-storage copy when over cap
          permanentReferenceUrls.push(imgUrl)
          let pushed = false
          try {
            const head = await fetchMedia(imgUrl, { method: 'HEAD' })
            const len = parseInt(head.headers.get('content-length') || '0')
            if (len > FAL_REF_MAX_BYTES) {
              const res = await fetchMedia(imgUrl)
              if (res.ok) {
                const { buffer, mimeType } = await compressForFal(Buffer.from(await res.arrayBuffer()))
                hostedUrls.push(await fal.storage.upload(new Blob([new Uint8Array(buffer)], { type: mimeType })))
                pushed = true
              }
            }
          } catch (e) {
            console.warn('Wan 2.7 Pro ref size check failed — passing URL through:', e)
          }
          if (!pushed) hostedUrls.push(imgUrl)
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

    // The page's session, or a personal API key (Nova, Prism, the ChatGPT / Claude connector) - lib/api-key-auth
    const sessionUser = await generationCaller(req)
    const targetUserId: number | null = sessionUser?.id ?? null
    if (!targetUserId) return NextResponse.json({ error: 'Not authenticated — log in before using the admin scanner' }, { status: 401 })

    // Server-side ticket check — WAN 2.7 Pro costs 4 tickets per picture: fal bills each one, and the page may ask for several
    // (up to 4 edits / 5 text-to-image - a flat 4 lost money, 2026-10-17)
    const ticketCost = 4 * Number(input.num_images ?? input.max_images ?? 1)
    const chargedCost = isAdminEmail(sessionUser!.email) ? 0 : ticketCost
    // ── Spam-safe submission order (see kling-o3-submit for the rationale):
    // atomic user-slot claim → charge → global slot/submit, with the claimed
    // row flipped through pending → queued/processing/failed exactly once.
    const rowParams = { falEndpoint: endpoint, falInput: input, usePolling: true, permanentReferenceUrls }
    // CCBill content filter — must pass BEFORE any charge or provider submit
    {
      const _cf = await enforceContentFilter(prompt, sessionUser?.email)
      if (!_cf.ok) return NextResponse.json({ error: _cf.reason }, { status: 400 })
    }
    const claim = await claimUserGenerationRow({
      userId: targetUserId,
      modelId: 'wan-2.7-pro',
      modelType: 'image',
      prompt: (prompt as string).trim(),
      parameters: rowParams,
      ticketCost: chargedCost,
    })
    if (!claim.ok) {
      return NextResponse.json(
        { error: `Queue full (${claim.activeCount}/${claim.limit} active). Wait for a generation to finish.` },
        { status: 429 }
      )
    }
    const ticketResult = await deductGenerationTickets(targetUserId, sessionUser!.email, ticketCost)
    if (!ticketResult.ok) {
      await prisma.generationQueue.delete({ where: { id: claim.rowId } }).catch(() => {})
      return NextResponse.json(
        { error: `Insufficient tickets — need ${ticketResult.need}, have ${ticketResult.have}` },
        { status: 402 },
      )
    }
    await prisma.generationQueue.update({
      where: { id: claim.rowId },
      data: { parameters: { ...rowParams, chargeMode: 'deduct' } as any },
    }).catch(() => {})

    // Sync counter from ground truth, then atomically claim a global slot
    const { claimed, maxConcurrent } = await syncAndClaimFalSlot()

    if (!claimed) {
      await prisma.generationQueue.update({ where: { id: claim.rowId }, data: { status: 'queued' } })
      console.log(`Wan 2.7 Pro queued (at capacity, max=${maxConcurrent}) → queueId #${claim.rowId}`)
      return NextResponse.json({ success: true, queued: true, queueId: claim.rowId, permanentReferenceUrls })
    }

    try {
      // A non-admin runs moderated - checker on, standard tolerance - whatever
      // the request asked for (lib/public-moderation; 2026-10-17)
      enforcePublicModeration('wan-2.7-pro', input, await checkIsAdmin(sessionUser!.email))
      const submitted = await fal.queue.submit(endpoint, { input })
      await prisma.generationQueue.update({
        where: { id: claim.rowId },
        data: { status: 'processing', falRequestId: submitted.request_id, startedAt: new Date() },
      })

      return NextResponse.json({
        success: true,
        requestId: submitted.request_id,
        falEndpoint: endpoint,
        queueId: claim.rowId,
        permanentReferenceUrls,
      })
    } catch (submitError: any) {
      const { FAL_GLOBAL_ID } = await import('@/lib/fal-queue')
      await prisma.modelConcurrencyLimit.updateMany({
        where: { modelId: FAL_GLOBAL_ID },
        data: { currentActive: { decrement: 1 } },
      }).catch(() => {})
      await refundGenerationTickets(targetUserId!, sessionUser!.email, ticketCost)
      await prisma.generationQueue.update({
        where: { id: claim.rowId },
        data: { status: 'failed', completedAt: new Date(), errorMessage: 'Submission to provider failed' },
      }).catch(() => {})
      throw submitError
    }
  } catch (error: any) {
    console.error('Wan 2.7 Pro submit error:', error)
    return NextResponse.json({ error: error.message || 'Submission failed' }, { status: 500 })
  }
}
