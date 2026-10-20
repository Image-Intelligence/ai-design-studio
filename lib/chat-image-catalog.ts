import { AI_MODELS, getTicketCost } from '@/config/ai-models.config'
import { ADMIN_FAL_IMAGE_MODEL_IDS, getFalImageModelSpec } from '@/lib/fal-image-models'
import { higgsfieldImageTicketCost } from '@/lib/higgsfield-models'

// The chat hub's IMAGE catalog, derived from the site's model config rather
// than hand-listed a second time — the same treatment the video catalog got.
//
// The hub described sixteen image models while the studio ships forty-nine, so
// most of the roster (Ideogram, the Recraft V4 line, the Topaz image suite,
// Qwen, Reve, MAI, Grok, Meta Muse, Bria, Pixelcut, Virtual Try-On) was simply
// unreachable from chat. Image generation now submits through /api/generate,
// which owns every model's input shape and the admin gate, so a derived entry
// is enough to make one usable.

export type ChatImageEntry = {
  id: string
  label: string
  kind: 'image'
  group: string
  maxRefs: number
  ticketCost: number
  needsRef?: boolean
  admin?: boolean
  strengths?: string
  fields?: { key: string; label: string; options: string[]; def: string }[]
}

/**
 * Admin-only images, mirroring app/api/generate's own set. Kept in sync by
 * construction: the fal suite comes from the same exported id list the route
 * spreads into its check.
 */
export const ADMIN_ONLY_IMAGE_MODELS = new Set<string>([
  'gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3-pro-image-preview',
  'flash-scanner-v2.5', 'pro-scanner-v3',
  'nano-banana-pro-2',
  // Only the ones still under test — see PUBLIC_FAL_IMAGE_MODEL_IDS.
  ...ADMIN_FAL_IMAGE_MODEL_IDS,
])

/**
 * The fal upscalers /api/generate runs from `upscaleImageUrl` + `upscaleFactor`
 * (not references): the factors each one takes, as the portal offers them.
 */
export const UPSCALER_FACTORS: Record<string, string[]> = {
  'clarity-upscaler': ['2', '4'],
  'aura-sr': ['4'],
  'esrgan': ['2', '4'],
  'drct': ['2', '4'],
}

function groupOf(id: string, name: string): string {
  if (id.startsWith('ideogram')) return 'Ideogram'
  if (id.startsWith('recraft')) return 'Recraft'
  if (id.startsWith('topaz')) return 'Topaz'
  if (id.startsWith('qwen')) return 'Alibaba'
  if (id.startsWith('reve')) return 'Reve'
  if (id.startsWith('luma')) return 'Luma'
  if (id.startsWith('krea')) return 'Krea'
  if (id.startsWith('moss')) return 'OpenMOSS'
  if (id.startsWith('hunyuan')) return 'Tencent'
  if (id.startsWith('mai-')) return 'Microsoft'
  if (id.startsWith('grok')) return 'xAI'
  if (id.startsWith('meta-')) return 'Meta'
  if (id.startsWith('bria')) return 'Bria'
  if (id.startsWith('pixelcut')) return 'Pixelcut'
  if (id.startsWith('seedream') || id.startsWith('seedance')) return 'ByteDance'
  if (id.startsWith('nano-banana') || id.startsWith('gemini') || id.includes('scanner') || id.startsWith('google')) return 'Google'
  if (id.startsWith('flux') || id.startsWith('z-image')) return 'Black Forest'
  if (id.startsWith('kling')) return 'Kling'
  if (id.startsWith('gpt-') || name.toLowerCase().includes('chatgpt')) return 'OpenAI'
  if (id.startsWith('wan')) return 'Wan'
  return 'Image'
}

/** Image models are LLM-facing text: say what each is actually for. */
const NOTES: Record<string, string> = {
  'ideogram-v4-instant': 'BEST FOR: text INSIDE the image — signage, posters, labels, book covers. The most reliable speller in the studio. Instant tier: fastest and cheapest.',
  'ideogram-v4-fast': 'BEST FOR: text inside the image, a quality step above Instant. Reach for this when lettering has to be right.',
  'recraft-v4-style': 'BEST FOR: designed typography and brand-consistent styling. Strong at layout-led work rather than photoreal scenes.',
  'recraft-v4-style-pro': 'BEST FOR: the same designed-type work at the highest quality tier.',
  'recraft-v4-vector': 'BEST FOR: true SVG VECTOR output — logos, icons, flat graphics that must scale cleanly.',
  'recraft-v4-vector-pro': 'BEST FOR: vector output at the highest quality tier.',
  'gpt-image-2': 'BEST FOR: instruction-following and short in-scene text; reliable at doing exactly what the prompt says.',
  'moss-image': 'BEST FOR: exact lettering in Chinese AND English, posters and structured layouts. Text to image only (no references); the aspect picks its size, 2 tickets.',
  'clarity-upscaler': 'UPSCALE TOOL - needs a picture: creative upscale that ADDS fine detail (skin, fabric, foliage). 2x or 4x (setting "factor"); priced by the output size (about 7 / 26 tickets).',
  'aura-sr': 'UPSCALE TOOL - needs a picture: fast, faithful 4x upscale, 1 ticket. Adds no new detail - the cheap way to make a picture bigger.',
  'esrgan': 'UPSCALE TOOL - needs a picture: classic 2x / 4x upscale, 1 ticket - clean edges, good on illustration and graphics.',
  'drct': 'UPSCALE TOOL - needs a picture: sharp, faithful 2x / 4x super-resolution, priced by output size (from 1 ticket).',
  'google-virtual-try-on': 'Dresses a person photo in a garment photo. Needs BOTH. Google screens the inputs and refuses recognisable real people.',
}

export const CHAT_IMAGE_MODELS: ChatImageEntry[] = AI_MODELS
  .filter(m => m.isAvailable !== false)
  // video and the local-only entries are not create_media material
  // (Krea 3 Realtime is a live session in its own panel, not a run). The fal
  // upscalers ARE (2026-10-20 - public in the portal, so the agents need them
  // too): one picture in, a factor (UPSCALER_FACTORS), via /api/generate.
  .filter(m => !/^(local-|supir|krea-3-realtime)/.test(m.id))
  .map(m => {
    const fal = getFalImageModelSpec(m.id)
    // A model whose references go to its EDIT endpoint (Ideogram 4.5, FLUX 3,
    // Qwen, Muse, Krea...) has 0 inputs on the text-to-image spec - count the
    // edit sibling's, or the refs are silently sliced away
    const edit = fal?.editVariant ? getFalImageModelSpec(fal.editVariant) : undefined
    const maxRefs = fal ? Math.max(fal.maxInputImages, edit?.maxInputImages ?? 0) : 4
    const factors = UPSCALER_FACTORS[m.id]
    return {
      id: m.id,
      label: m.displayName,
      kind: 'image' as const,
      group: groupOf(m.id, m.displayName),
      maxRefs: factors ? 1 : maxRefs,
      needsRef: fal?.needsImage === true || !!factors,
      ...(factors ? { fields: [{ key: 'factor', label: 'Factor', options: factors, def: factors[0] }] } : {}),
      admin: ADMIN_ONLY_IMAGE_MODELS.has(m.id),
      ticketCost: getTicketCost(m.id),
      strengths: NOTES[m.id] ?? m.description ?? undefined,
    }
  })

/*
 * Higgsfield's exclusive image models (public since 2026-10-13) are not in the
 * site's model config - they have a route and queue of their own
 * (/api/admin/higgsfield/image-submit, lib/higgsfield) - so they are listed
 * here (2026-10-20), and lib/dedicated-image-submit sends them to that route.
 */
const SOUL_AR = ['1:1', '9:16', '16:9', '4:3', '3:4', '2:3', '3:2']
CHAT_IMAGE_MODELS.push(
  { id: 'higgsfield-soul-2', label: 'Soul 2', kind: 'image', group: 'Higgsfield', maxRefs: 0, ticketCost: higgsfieldImageTicketCost('higgsfield-soul-2', '1k'),
    strengths: 'Higgsfield exclusive: fashion-editorial portraits and lifestyle photos with a real-camera look; text to image only; the cheapest premium portrait model.',
    fields: [{ key: 'aspect', label: 'AR', options: SOUL_AR, def: '3:4' }, { key: 'quality', label: 'Quality', options: ['1k', '2k'], def: '2k' }] },
  { id: 'higgsfield-soul', label: 'Soul', kind: 'image', group: 'Higgsfield', maxRefs: 1, ticketCost: higgsfieldImageTicketCost('higgsfield-soul', '1k'),
    strengths: 'Higgsfield exclusive: the original Soul fashion / portrait look; one optional reference picture.',
    fields: [{ key: 'aspect', label: 'AR', options: SOUL_AR, def: '4:3' }, { key: 'quality', label: 'Quality', options: ['1k', '2k'], def: '1k' }] },
  { id: 'higgsfield-marketing-image', label: 'Marketing Studio Image', kind: 'image', group: 'Higgsfield', maxRefs: 8, ticketCost: higgsfieldImageTicketCost('higgsfield-marketing-image', '1k'),
    strengths: 'Higgsfield exclusive: campaign and ad images - products and people in polished marketing scenes; product / brand pictures as references.',
    fields: [{ key: 'aspect', label: 'AR', options: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], def: 'auto' }, { key: 'quality', label: 'Quality', options: ['1k', '2k', '4k'], def: '2k' }] },
)
