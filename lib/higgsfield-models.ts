/**
 * Higgsfield's exclusive models (2026-10-13, ADMIN ONLY) - the ones fal does
 * not carry. Shared by the page (pickers, prices) and the server (lib/higgsfield).
 *
 * Higgsfield API: https://docs.higgsfield.ai - async like fal: POST
 * https://api.higgsfield.ai/<endpoint> returns a request_id, then
 * GET /requests/<id>/status until completed | failed | nsfw | canceled.
 *
 * Prices: Higgsfield's published API list rates (2026-10-12), turned into
 * tickets the site's way - USD / $0.04 a ticket, rounded up - so a ticket
 * still costs at most $0.04 to serve. Their promo discounts (30-50% on some
 * models) are NOT priced in: they end, list price does not.
 *   Soul 2            $0.0032 / $0.0057 per image (720p / 1080p)
 *   Soul (standard)   $0.0938 / $0.1875 per image
 *   Marketing Studio  $0.0162 (1k low) .. $0.7219 (4k high) per image - the
 *                     mid tiers are not published: priced from the top end
 *   Genjutsu          $0.318 / $0.681 / $1.632 per second of the source clip
 *                     (480p / 720p / 1080p), rounded up to whole seconds
 *   Cinema Studio 4.0 $0.2057 / $0.4623 per second (480p / 720p); input video
 *                     seconds are billed too, at 0.6x (token metering)
 * Soul Cinema has no published price and Genjutsu Restyle needs its style
 * presets from the API - both left out until there is a key to check them.
 */

export type HiggsfieldModelId =
  | 'higgsfield-soul-2' | 'higgsfield-soul' | 'higgsfield-marketing-image'
  | 'higgsfield-genjutsu-motion' | 'higgsfield-genjutsu-swap' | 'higgsfield-cinema-4'

export const HIGGSFIELD_IMAGE_MODELS = new Set<string>(['higgsfield-soul-2', 'higgsfield-soul', 'higgsfield-marketing-image'])
export const HIGGSFIELD_VIDEO_MODELS = new Set<string>(['higgsfield-genjutsu-motion', 'higgsfield-genjutsu-swap', 'higgsfield-cinema-4'])
export const isHiggsfieldModel = (id: string | null | undefined) => !!id && (HIGGSFIELD_IMAGE_MODELS.has(id) || HIGGSFIELD_VIDEO_MODELS.has(id))
/**
 * Every Higgsfield model id. Higgsfield jobs are GenerationQueue rows with the
 * usual statuses ('queued' / 'processing') but run on their OWN queue
 * (lib/higgsfield, 20 at once): fal's slot counting and promotion exclude
 * these ids, or a waiting Higgsfield job would hold fal's FIFO, be submitted
 * to fal, and running ones would eat fal's 40 slots.
 */
export const HIGGSFIELD_MODEL_IDS: string[] = [...HIGGSFIELD_IMAGE_MODELS, ...HIGGSFIELD_VIDEO_MODELS]

/** Their endpoint ids (POST https://api.higgsfield.ai/<id>). */
export const HIGGSFIELD_ENDPOINTS: Record<HiggsfieldModelId, string> = {
  'higgsfield-soul-2': 'higgsfield-ai/soul/v2/standard',
  'higgsfield-soul': 'higgsfield-ai/soul/standard',
  'higgsfield-marketing-image': 'marketing-studio/image',
  'higgsfield-genjutsu-motion': 'higgsfield/genjutsu/motion-transfer/v1.0',
  'higgsfield-genjutsu-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  'higgsfield-cinema-4': 'higgsfield/cinema-studio/4.0',
}

/**
 * The page's video slots carry `falEndpoint` for their poller; a Higgsfield
 * job's is "higgsfield:<endpoint id>" so /api/admin/video-status knows it is
 * not a fal job.
 */
export const HF_ENDPOINT_PREFIX = 'higgsfield:'
export const isHiggsfieldEndpoint = (ep: unknown): ep is string => typeof ep === 'string' && ep.startsWith(HF_ENDPOINT_PREFIX)

/** Soul's two sizes ride the portal's 1K / 2K picker. */
export const soulResolution = (quality: string | undefined) => (quality === '2k' ? '1080p' : '720p')

/** Genjutsu: whole seconds of the source clip it bills (4-30, rounded up). */
export const genjutsuSeconds = (sourceSec: number) => Math.min(30, Math.max(4, Math.ceil((sourceSec || 0) - 1e-6)))

const t = (usd: number) => Math.max(1, Math.ceil(usd / 0.04 - 1e-9))

export function higgsfieldImageTicketCost(model: string, quality?: string): number {
  if (model === 'higgsfield-soul-2') return t(quality === '2k' ? 0.0057 : 0.0032)
  if (model === 'higgsfield-soul') return t(quality === '2k' ? 0.1875 : 0.0938)
  if (model === 'higgsfield-marketing-image') {
    // high quality (the only tier enhancement takes); 4k is published, 1k/2k
    // high are not - priced at a share of 4k that leaves room either way
    return quality === '4k' ? t(0.7219) : quality === '2k' ? t(0.40) : t(0.25)
  }
  return 1
}

export function higgsfieldVideoTicketCost(model: string, o: { resolution?: string; duration?: string; sourceSec?: number; refVideoSec?: number }): number {
  if (model === 'higgsfield-genjutsu-motion' || model === 'higgsfield-genjutsu-swap') {
    const perSec = o.resolution === '1080p' ? 1.632 : o.resolution === '480p' ? 0.318 : 0.681
    return t(genjutsuSeconds(o.sourceSec ?? 0) * perSec)
  }
  if (model === 'higgsfield-cinema-4') {
    const perSec = o.resolution === '480p' ? 0.2057 : 0.4623
    const sec = Math.min(30, Math.max(4, parseInt(o.duration || '5') || 5))
    return t((sec + 0.6 * Math.max(0, o.refVideoSec || 0)) * perSec)
  }
  return 1
}
