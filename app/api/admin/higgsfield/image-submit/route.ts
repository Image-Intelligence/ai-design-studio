import { generationCaller } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { checkUserConcurrency } from '@/lib/user-concurrency'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'
import { isGenerationBlocked } from '@/lib/generation-guard'
import { enforceContentFilter } from '@/lib/content-filter'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'
import { uploadToR2, userKey } from '@/lib/r2'
import { queueHiggsfieldJob, higgsfieldConfigured } from '@/lib/higgsfield'
import { HIGGSFIELD_ENDPOINTS, HIGGSFIELD_IMAGE_MODELS, soulResolution, higgsfieldImageTicketCost, type HiggsfieldModelId } from '@/lib/higgsfield-models'

/**
 * POST /api/admin/higgsfield/image-submit - one Higgsfield image job
 * (2026-10-13: Soul 2, Soul, Marketing Studio Image - PUBLIC since the same
 * day; the /admin path is historical). Charged in tickets like every model
 * (admins free), refunded by lib/higgsfield when the job fails.
 *
 * Body: { model, prompt, aspectRatio, quality, referenceImages? }
 * Returns { success, queueId, requestId, permanentReferenceUrls }. The page
 * watches the queue row like any other job; lib/higgsfield settles it.
 */

const SOUL_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2']
const MARKETING_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']

export async function POST(req: Request) {
  try {
    // A browser session, or an agent's key (Nova / Prism / the ChatGPT connector - 2026-10-20)
    const user = await generationCaller(req, 'image')
    if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })
    const isAdmin = await checkIsAdmin(user.email)
    if (await isGenerationBlocked(user.email)) return jsonPrivate({ error: 'Generation is temporarily disabled for maintenance.' }, { status: 503 })
    if (!higgsfieldConfigured()) return jsonPrivate({ error: 'Higgsfield is not set up yet - add HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET to the environment.' }, { status: 503 })

    const body = await req.json().catch(() => ({})) as { model?: string; prompt?: string; aspectRatio?: string; quality?: string; referenceImages?: unknown[] }
    const model = String(body.model || '') as HiggsfieldModelId
    if (!HIGGSFIELD_IMAGE_MODELS.has(model)) return jsonPrivate({ error: 'Unknown Higgsfield model' }, { status: 400 })
    const prompt = String(body.prompt || '').trim()
    if (!prompt) return jsonPrivate({ error: 'Prompt is required' }, { status: 400 })
    {
      const cf = await enforceContentFilter(prompt, user.email)
      if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
    }

    // Your own pictures need a verified ID (CCBill; admins exempt - lib/id-verification)
    {
      const idGate = await requireOwnMediaUnlessVerified(user, (Array.isArray(body.referenceImages) ? body.referenceImages : []).filter((r): r is string => typeof r === 'string' && !r.startsWith('data:')))
      if (idGate) return idGate
      if (!isAdmin && (body.referenceImages ?? []).some(r => typeof r === 'string' && r.startsWith('data:'))) {
        const pasted = await requireOwnMediaUnlessVerified(user, ['data:pasted'])
        if (pasted) return pasted
      }
    }
    // The account's own limit on generations at once
    if (!isAdmin) {
      const c = await checkUserConcurrency(user.id)
      if (!c.allowed) return jsonPrivate({ error: `Queue full (${c.activeCount}/${c.limit} active). Wait for a generation to finish.` }, { status: 429 })
    }

    // References: kept on R2 (a picture pasted in arrives as a data URL)
    const refs: string[] = []
    for (const r of (Array.isArray(body.referenceImages) ? body.referenceImages : []).slice(0, 16)) {
      if (typeof r !== 'string') continue
      if (r.startsWith('data:')) {
        const [meta, b64] = r.split(',')
        const mime = meta.split(':')[1]?.split(';')[0] || 'image/jpeg'
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
        refs.push(await uploadToR2(userKey(user.id, `reference-hf-${Date.now()}-${refs.length}.${ext}`), Buffer.from(b64, 'base64'), mime))
      } else if (r.startsWith('https://')) {
        refs.push(canonicalMediaUrl(r))
      }
    }
    // Stored canonical; lib/higgsfield signs the links when the job is sent
    const forHf = (u: string) => u

    const quality = typeof body.quality === 'string' ? body.quality : '1k'
    const ar = typeof body.aspectRatio === 'string' ? body.aspectRatio : '1:1'
    let input: Record<string, unknown>
    let resolution: string
    if (model === 'higgsfield-marketing-image') {
      resolution = quality === '4k' ? '4k' : quality === '2k' ? '2k' : '1k'
      input = {
        prompt, quality: 'high', resolution,
        aspect_ratio: MARKETING_RATIOS.includes(ar) ? ar : 'auto',
        ...(refs.length ? { image_urls: refs.map(forHf) } : {}),
      }
    } else {
      resolution = soulResolution(quality)
      input = {
        prompt, resolution, batch_size: 1,
        aspect_ratio: SOUL_RATIOS.includes(ar) ? ar : model === 'higgsfield-soul' ? '4:3' : '1:1',
        // Soul (standard) takes one picture to guide its prompt enhancement
        ...(model === 'higgsfield-soul' && refs[0] ? { image_reference_url: forHf(refs[0]) } : {}),
      }
    }

    // Charged up front (admins free); a failed job refunds it (lib/higgsfield)
    const price = higgsfieldImageTicketCost(model, quality)
    const charge = isAdmin ? 0 : price
    if (charge > 0) {
      const paid = await deductGenerationTickets(user.id, user.email, charge)
      if (!paid.ok) return jsonPrivate({ error: `Insufficient tickets - need ${paid.need}, have ${paid.have}` }, { status: 402 })
    }
    // Higgsfield's own queue (20 at once): sent now, or waits its turn
    try {
      const job = await queueHiggsfieldJob({
        userId: user.id, modelId: model, modelType: 'image', prompt,
        endpoint: HIGGSFIELD_ENDPOINTS[model], input, ticketCost: charge,
        parameters: {
          source: 'main-scanner',
          aspectRatio: ar, quality, resolution, referenceImageUrls: refs,
          listTickets: price,
        },
      })
      return jsonPrivate({ success: true, queueId: job.queueId, requestId: job.requestId, queued: job.queued, ticketCost: charge, permanentReferenceUrls: refs })
    } catch (e) {
      // A refused send has already failed its row - and refunded it (failRow);
      // a row that couldn't be made is refunded by queueHiggsfieldJob itself
      // (2026-10-23 billing sweep)
      throw e
    }
  } catch (e: any) {
    console.error('higgsfield image-submit error:', e)
    return jsonPrivate({ error: e?.message || 'Submission failed' }, { status: 500 })
  }
}
