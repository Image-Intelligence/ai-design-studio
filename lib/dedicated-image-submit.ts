/**
 * Image models with routes of their own (2026-10-20), for the agents.
 *
 * The portal sends SeeDream 5 Lite / Pro, Recraft v4.1, Kling V3 Image, Kling
 * O3 Image, Wan 2.7 Pro and GPT Image 2 to per-model submit routes under
 * /api/admin, each with its own body, pricing and refund handling; the
 * agents (Nova, Prism, the ChatGPT / Claude connector) go through
 * /api/generate, which does not know them - every one failed ("not
 * available" / "runs from the image page"). This maps an agent's request onto
 * the model's own route and calls it in-process with the user's key (the
 * routes take keys since this change - lib/api-key-auth generationCaller), so
 * a model costs and behaves exactly as it does on the page.
 *
 * References: the routes accept pictures inline (data: URIs) and upload them
 * to fal themselves; our stored links are private (fal answers 422 on them),
 * so each is fetched here and passed inline, at most 2048px.
 *
 * Completion: SeeDream / Recraft settle by fal's webhook; Kling, Wan and GPT
 * Image 2 are "polled" jobs the harvester (lib/harvest-polling-jobs) finishes
 * - lib/chat-image-submit and lib/nova/jobs nudge it while they wait.
 */
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { fetchMedia } from '@/lib/media-fetch'
import { signMediaUrl } from '@/lib/media-url'

type Settings = { aspect?: string; quality?: string; format?: string }
type RouteCall = { load: () => Promise<{ POST: (req: Request) => Promise<Response> }>; path: string; body: (p: string, refs: string[], s: Settings) => Record<string, unknown> }

/** The page's SeeDream 5 size rule (portal seedream5LiteImageSize): square = auto, else the long side at 2048 / 3072. */
function seedreamSize(quality: string | undefined, aspect: string): Record<string, string | number> {
  const base = quality === '3k' || quality === '4k' ? 3072 : 2048
  const [w, h] = aspect.split(':').map(Number)
  if (!w || !h || w === h) return { image_size: base === 3072 ? 'auto_3K' : 'auto_2K' }
  return w > h
    ? { image_size: 'custom', custom_width: base, custom_height: Math.round((base * h) / w) }
    : { image_size: 'custom', custom_width: Math.round((base * w) / h), custom_height: base }
}

/** GPT Image 2 takes six sizes (the page's): the one nearest the asked shape, larger for 4K. */
function gptSize(aspect: string, quality?: string): string {
  if (/^\d+x\d+$/.test(aspect)) return aspect
  const [w, h] = aspect.split(':').map(Number)
  const r = w && h ? w / h : 1
  if (r > 1.45) return quality === '4k' ? '3840x2160' : quality === '2k' ? '2560x1440' : '1920x1080'
  if (r > 1.1) return '1024x768'
  if (r < 0.9) return '1024x1536'
  return '1024x1024'
}

const kling = (q?: string, top = '2K') => (q === '4k' ? top : q === '2k' ? '2K' : '1K')

export const DEDICATED_IMAGE_ROUTES: Record<string, RouteCall> = {
  'seedream-5-lite': {
    path: 'seedream-5-lite-submit', load: () => import('@/app/api/admin/seedream-5-lite-submit/route'),
    body: (prompt, refs, s) => ({ prompt, images_base64: refs, ...seedreamSize(s.quality, s.aspect ?? '1:1'), quality: s.quality === '4k' || s.quality === '3k' ? '3k' : '2k', aspectRatio: s.aspect ?? '1:1', referenceImageUrls: [] }),
  },
  'seedream-5-pro': {
    path: 'seedream-5-pro-submit', load: () => import('@/app/api/admin/seedream-5-pro-submit/route'),
    body: (prompt, refs, s) => ({ prompt, images_base64: refs, ...seedreamSize('2k', s.aspect ?? '1:1'), enable_safety_checker: true, quality: '2k', aspectRatio: s.aspect ?? '1:1', referenceImageUrls: [] }),
  },
  'recraft-v4.1': {
    path: 'recraft-submit', load: () => import('@/app/api/admin/recraft-submit/route'),
    body: (prompt, _refs, s) => ({ prompt, aspectRatio: s.aspect ?? '1:1', enable_safety_checker: true }),
  },
  'kling-image-v3': {
    path: 'kling-image-submit', load: () => import('@/app/api/admin/kling-image-submit/route'),
    body: (prompt, refs, s) => ({ prompt, ...(refs[0] ? { image_url: refs[0] } : {}), num_images: 1, aspect_ratio: s.aspect ?? '1:1', output_format: s.format ?? 'png', resolution: kling(s.quality, '2K') }),
  },
  'kling-o3-image': {
    path: 'kling-o3-submit', load: () => import('@/app/api/admin/kling-o3-submit/route'),
    body: (prompt, refs, s) => ({ prompt, ...(refs.length ? { image_urls: refs } : {}), num_images: 1, aspect_ratio: s.aspect ?? '1:1', output_format: s.format ?? 'png', resolution: kling(s.quality, '4K') }),
  },
  'wan-2.7-pro': {
    path: 'wan-27-pro-submit', load: () => import('@/app/api/admin/wan-27-pro-submit/route'),
    body: (prompt, refs, s) => ({ prompt, ...(refs.length ? { image_urls: refs } : {}), aspect_ratio: s.aspect ?? '1:1', num_images: 1, enable_safety_checker: true }),
  },
  'gpt-image-2': {
    path: 'gpt-image-2-submit', load: () => import('@/app/api/admin/gpt-image-2-submit/route'),
    // 1K is medium quality, 2K / 4K high (the page's default)
    body: (prompt, refs, s) => ({ prompt, quality: s.quality === '1k' ? 'medium' : 'high', size: gptSize(s.aspect ?? '1:1', s.quality), referenceImages: refs, referenceImageUrls: [] }),
  },
}

export const isDedicatedImageModel = (id: string) => id in DEDICATED_IMAGE_ROUTES

/** A stored or outside picture as an inline JPEG (at most 2048px) the routes upload to fal themselves. */
async function inline(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url
  try {
    const res = await fetchMedia(signMediaUrl(url), { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
    return `data:image/jpeg;base64,${jpg.toString('base64')}`
  } catch { return null }
}

export async function submitDedicatedImage(
  modelId: string, prompt: string, refs: string[], settings: Settings, headers: Record<string, string>,
): Promise<{ ok: true; queueId: number; ticketCost: number } | { ok: false; error: string }> {
  const call = DEDICATED_IMAGE_ROUTES[modelId]
  if (!call) return { ok: false, error: `No route for ${modelId}` }
  const inlined = (await Promise.all(refs.map(inline))).filter((u): u is string => !!u)
  if (inlined.length < refs.length) return { ok: false, error: "A reference picture couldn't be loaded - try again, or pick another." }
  try {
    const { POST } = await call.load()
    const res = await POST(new NextRequest(`http://internal/api/admin/${call.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(call.body(prompt, inlined, settings)),
    }))
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok || data.success === false || data.error) return { ok: false, error: String(data.error || `Image submit failed (${res.status})`).slice(0, 300) }
    const queueId = Number(data.queueId ?? 0)
    if (!queueId) return { ok: false, error: 'The generation was accepted but returned no job to track.' }
    // What the route charged is on its queue row
    const row = await prisma.generationQueue.findUnique({ where: { id: queueId }, select: { ticketCost: true } })
    return { ok: true, queueId, ticketCost: Number(row?.ticketCost ?? 0) }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 300) }
  }
}
