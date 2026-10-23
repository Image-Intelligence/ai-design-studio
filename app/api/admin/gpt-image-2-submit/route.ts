import { NextResponse } from 'next/server'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import prisma from '@/lib/prisma'
import { syncAndClaimFalSlot } from '@/lib/admin-queue-helpers'
import { generationCaller } from '@/lib/api-key-auth'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { deductGenerationTickets, refundGenerationTickets, isAdminEmail } from '@/lib/ticket-gate'
import { enforceContentFilter } from '@/lib/content-filter'
import { canonicalisePayload } from '@/lib/media-url'

fal.config({ credentials: process.env.FAL_KEY })

const TEXT_ENDPOINT = 'fal-ai/gpt-image-2'
const EDIT_ENDPOINT = 'openai/gpt-image-2/edit'

/*
 * The same prices as the page's route (/api/admin/gpt-image-2-stream), which
 * this one had drifted from (2026-10-20, when the agents started using it): a
 * quality fal does not know runs - and is priced - as 'high', a size outside
 * the page's six as the 4K one (the dearest), and references are billed as
 * input tokens by the edit endpoint (~$0.01 each): one ticket per four.
 */
const GPT2_SIZES = new Set(['1024x1024', '1024x768', '1024x1536', '1920x1080', '2560x1440', '3840x2160'])
function computeGptTicketCost(rawQuality: string, rawSize: string, refs = 0): number {
  const quality = ['low', 'medium', 'high'].includes(rawQuality) ? rawQuality : 'high'
  const size = GPT2_SIZES.has(rawSize) ? rawSize : '3840x2160'
  return gptBaseTicketCost(quality, size) + Math.ceil(Math.max(0, Math.min(8, refs)) / 4)
}
function gptBaseTicketCost(quality: string, size: string): number {
  if (quality === 'low') return 1
  if (quality === 'high') {
    if (size === '1024x1024') return 8
    if (size === '2560x1440') return 9
    if (size === '3840x2160') return 15
    return 6
  }
  // medium (default)
  if (size === '1024x1024' || size === '2560x1440') return 3
  if (size === '3840x2160') return 4
  return 2
}

// Size tokens are the exact pixel dimensions shown in the portal (e.g. "1920x1080").
// Split on "x" to get width/height directly — no lookup table needed.
function parseSize(size: string): { width: number; height: number } {
  const [w, h] = size.split('x').map(Number)
  return (w && h) ? { width: w, height: h } : { width: 1024, height: 1024 }
}

// POST /api/admin/gpt-image-2-submit
// Text-to-image  → fal-ai/gpt-image-2   (no reference images)
// Image editing  → openai/gpt-image-2/edit  (reference images provided)
export async function POST(req: Request) {
  // Tickets charged by this request that no queue row owns yet - refunded by
  // the catch if anything throws before a row takes them over (2026-10-23
  // billing sweep: a throw between the charge and the row kept them).
  let refundOwed = 0
  let refundUserId = 0
  let refundEmail = ''
  try {
    // The page's session, or a personal API key (Nova, Prism, the ChatGPT / Claude connector) - lib/api-key-auth
    const sessionUser = await generationCaller(req)

    if (await isGenerationBlocked(sessionUser?.email)) {
      return NextResponse.json({ error: 'Generation is temporarily disabled for maintenance. Please check back soon.' }, { status: 503 })
    }

    const targetUserId: number | null = sessionUser?.id ?? null
    if (!targetUserId) {
      return NextResponse.json({ error: 'Not authenticated — log in before using the admin scanner' }, { status: 401 })
    }

    const { allowed, activeCount, limit } = await checkUserConcurrency(targetUserId)
    if (!allowed) {
      return NextResponse.json(
        { error: `Queue full (${activeCount}/${limit} active). Wait for a generation to finish.` },
        { status: 429 }
      )
    }

    const body = canonicalisePayload(await req.json())
    const {
      prompt,
      quality = 'medium',
      size = '1024x1024',        // pixel-dimension token from the portal
      referenceImages = [],       // base64 data URIs from the client
      referenceImageUrls = [],    // permanent R2 URLs for DB storage
    } = body

    // Compute ticket cost server-side — never trust client-supplied value
    const refCount = (Array.isArray(referenceImages) ? referenceImages.length : 0) + (Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0)
    const ticketCost = computeGptTicketCost(String(quality), String(size), refCount)

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // Deduct tickets before submitting to FAL
    // CCBill content filter — must pass BEFORE any charge or provider submit
    {
      const _cf = await enforceContentFilter(prompt, sessionUser?.email)
      if (!_cf.ok) return NextResponse.json({ error: _cf.reason }, { status: 400 })
    }
    const ticketResult = await deductGenerationTickets(targetUserId, sessionUser!.email, ticketCost)
    if (!ticketResult.ok) {
      return NextResponse.json(
        { error: `Insufficient tickets — need ${ticketResult.need}, have ${ticketResult.have}` },
        { status: 402 },
      )
    }
    /*
     * What was really taken (2026-10-23 billing sweep). deductGenerationTickets
     * charges nothing for owner emails, but the rows stored the full price - and
     * a failed job refunds the row's ticketCost (releaseQueueSlot), so every
     * failed owner job minted tickets. Rows store the charged amount, like the
     * sibling routes' chargedCost, and say they were charged up front.
     */
    const chargedCost = isAdminEmail(sessionUser!.email) ? 0 : ticketCost
    refundOwed = chargedCost
    refundUserId = targetUserId
    refundEmail = sessionUser!.email

    const { width, height } = parseSize(size)
    const hasRefImages = Array.isArray(referenceImages) && referenceImages.length > 0

    let endpoint: string
    let input: Record<string, unknown>
    const permanentReferenceUrls: string[] = [...referenceImageUrls]

    if (hasRefImages) {
      // ── Edit mode: upload ref images to FAL storage ───────────────────────────
      const falUrls: string[] = []
      for (let i = 0; i < referenceImages.slice(0, 8).length; i++) {
        const img = referenceImages[i] as string
        try {
          // Library refs arrive as permanent https URLs — pass them straight to
          // fal (it fetches URLs natively). Base64-decoding a URL string would
          // upload garbage bytes the model can't read.
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
          // Also persist to R2 so the DB reference survives FAL URL expiry
          if (!img.startsWith('data:') || permanentReferenceUrls.length <= i) {
            const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
            const r2Url = await uploadToR2(`ref-gpt2-${Date.now()}-${i}.${ext}`, buffer, mimeType)
            if (!permanentReferenceUrls[i]) permanentReferenceUrls.push(r2Url)
          }
        } catch (e) {
          console.error(`gpt-image-2-submit: failed to upload ref image ${i}:`, e)
        }
      }

      endpoint = EDIT_ENDPOINT
      input = {
        prompt: prompt.trim(),
        image_urls: falUrls,
        quality,
        // size not passed for edit — model infers from input image
      }
    } else {
      // ── Text-to-image mode ────────────────────────────────────────────────────
      endpoint = TEXT_ENDPOINT
      input = {
        prompt: prompt.trim(),
        quality,
        width,
        height,
        n: 1,
      }
    }

    console.log(`GPT Image 2 submit (${endpoint}) size=${size} quality=${quality} refs=${referenceImages.length}`)

    const { claimed } = await syncAndClaimFalSlot()

    if (!claimed) {
      const queueEntry = await prisma.generationQueue.create({
        data: {
          userId:    targetUserId,
          modelId:   'gpt-image-2',
          modelType: 'image',
          prompt:    prompt.trim(),
          parameters: { falEndpoint: endpoint, falInput: input, usePolling: true, chargeMode: 'deduct', permanentReferenceUrls, size, quality, ticketCost: chargedCost } as any,
          status:    'queued',
          ticketCost: chargedCost,
        },
      })
      // The queued row owns the charge now (its failure path refunds it)
      refundOwed = 0
      return NextResponse.json({ success: true, queued: true, queueId: queueEntry.id, permanentReferenceUrls })
    }

    try {
      const submitted = await fal.queue.submit(endpoint, { input })

      const queueEntry = await prisma.generationQueue.create({
        data: {
          userId:      targetUserId,
          modelId:     'gpt-image-2',
          modelType:   'image',
          prompt:      prompt.trim(),
          parameters:  { falEndpoint: endpoint, falInput: input, usePolling: true, chargeMode: 'deduct', permanentReferenceUrls, size, quality, ticketCost: chargedCost } as any,
          status:      'processing',
          ticketCost:  chargedCost,
          falRequestId: submitted.request_id,
          startedAt:   new Date(),
        },
      })
      refundOwed = 0

      console.log(`GPT Image 2 submitted requestId=${submitted.request_id} queueId=#${queueEntry.id}`)

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
      // Refunded once, by the outer catch (refundOwed)
      throw submitError
    }
  } catch (error: any) {
    console.error('GPT Image 2 submit error:', error)
    if (refundOwed > 0) {
      const owed = refundOwed
      refundOwed = 0
      await refundGenerationTickets(refundUserId, refundEmail, owed)
    }
    return NextResponse.json({ error: error.message || 'Submission failed' }, { status: 500 })
  }
}
