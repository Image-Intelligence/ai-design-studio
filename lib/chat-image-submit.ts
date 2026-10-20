import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import type { ChatCreateModel, ChatCreateSettings } from '@/lib/chat-hub-models'
import { isDedicatedImageModel, submitDedicatedImage } from '@/lib/dedicated-image-submit'
import { UPSCALER_FACTORS } from '@/lib/chat-image-catalog'

// Chat IMAGE generation, routed through the site's own /api/generate.
//
// Same reasoning as the video path: that route owns every image model the
// studio ships (including the ones with bespoke branches — NanoBanana, SeeDream,
// GPT-Image, Kling, Ideogram, Recraft), ADMIN_ONLY_IMAGE_MODELS, the ticket
// maths and the GenerationQueue row. The hub's private catalog had sixteen of
// them and no gate at all.
//
// Unlike video, images are WAITED FOR here. They finish in tens of seconds,
// comfortably inside the send route's 300s budget, and waiting keeps the
// behaviour the rest of the agent depends on: the image comes back in the same
// turn, is attached to the reply, and gets evaluated before anything is built
// on top of it. If a render outruns the wait it degrades to the same
// submitted-and-settled-later path video uses, rather than failing.

export type ChatImageResult =
  | { ok: true; url: string; queueId: number | null; ticketCost: number }
  | { ok: true; pending: true; queueId: number; ticketCost: number }
  | { ok: false; error: string }

/** How long to wait in-turn before handing the job to the settler. */
const WAIT_MS = 150_000
const POLL_MS = 2_500

function buildBody(
  spec: ChatCreateModel,
  prompt: string,
  refs: string[],
  settings: ChatCreateSettings,
  userId: number,
): Record<string, unknown> {
  return {
    model: spec.id,
    prompt,
    userId,
    // The route is the sole authority on charging; chat does not pre-deduct.
    adminMode: false,
    aspectRatio: settings.aspect ?? 'auto',
    quality: settings.quality ?? '2k',
    outputFormat: settings.format ?? 'png',
    // https refs pass through as URLs — the route fetches them itself
    referenceImages: refs,
    // The fal upscalers take their picture and factor in fields of their own
    ...(UPSCALER_FACTORS[spec.id] ? { upscaleImageUrl: refs[0], upscaleFactor: Number(settings.factor) || Number(UPSCALER_FACTORS[spec.id][0]) } : {}),
  }
}

export async function submitChatImage(
  spec: ChatCreateModel,
  prompt: string,
  refs: string[],
  settings: ChatCreateSettings,
  userId: number,
  /** headers: e.g. Nova Studio's background-run API key (lib/nova/background) when there is no browser session. */
  opts?: {
    noWait?: boolean; headers?: Record<string, string>
    /** Stop waiting at this time (epoch ms) even before WAIT_MS - Nova's turn time limit. */
    waitUntil?: number
  },
): Promise<ChatImageResult> {
  let queueId: number | null = null
  let ticketCost = 0
  /** A model with a submit route of its own (lib/dedicated-image-submit): a polled job the harvester may finish. */
  const dedicated = isDedicatedImageModel(spec.id)

  if (dedicated) {
    const r = await submitDedicatedImage(spec.id, prompt, refs, settings, opts?.headers ?? {})
    if (!r.ok) return { ok: false, error: r.error }
    queueId = r.queueId
    ticketCost = r.ticketCost
  } else try {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(new NextRequest('http://internal/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts?.headers ?? {}) },
      body: JSON.stringify(buildBody(spec, prompt, refs, settings, userId)),
    }))
    const data = (await res.json()) as Record<string, any>

    if (!res.ok || data?.error) {
      return { ok: false, error: String(data?.error || `Image submit failed (${res.status})`) }
    }

    // Some models answer inline; most queue and are settled by the webhook.
    const inline: string | undefined =
      (Array.isArray(data.images) && typeof data.images[0] === 'string' ? data.images[0] : undefined)
      ?? (Array.isArray(data.images) && data.images[0]?.url)
      ?? data.imageUrl
    ticketCost = Number(data.ticketsUsed ?? data.ticketCost ?? 0)
    if (inline) return { ok: true, url: inline, queueId: null, ticketCost }

    queueId = Number(data.queueId ?? 0) || null
    if (!queueId) return { ok: false, error: 'The generation was accepted but returned no job to track.' }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 300) }
  }

  // A BATCH of plates is submitted and settled later: waiting here would make
  // six parallel submissions finish one after another.
  if (opts?.noWait) return { ok: true, pending: true, queueId, ticketCost }

  // ── wait for it, so the agent can still see and judge its own image ──
  const deadline = Math.min(Date.now() + WAIT_MS, opts?.waitUntil ?? Infinity)
  let polls = 0
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))
    // A polled job (Kling, Wan, GPT Image 2) is finished by the harvester - there is no page here to poll it
    if (dedicated && ++polls % 3 === 0) {
      if (spec.id.startsWith('higgsfield-')) {
        // Higgsfield's jobs are settled by its own harvester, not fal's
        const { harvestHiggsfieldJobs } = await import('@/lib/higgsfield')
        await harvestHiggsfieldJobs({ userId, limit: 2, budgetMs: 15_000 }).catch(() => {})
      } else {
        const { harvestPollingJobs } = await import('@/lib/harvest-polling-jobs')
        await harvestPollingJobs({ userId, minAgeMs: 0, graceMs: 0, limit: 2, budgetMs: 15_000 }).catch(() => {})
      }
    }
    const row = await prisma.generationQueue.findUnique({
      where: { id: queueId },
      select: { status: true, errorMessage: true, parameters: true, falRequestId: true },
    })
    if (!row) continue
    if (row.status === 'completed') {
      const p = (row.parameters ?? {}) as Record<string, unknown>
      const urls = Array.isArray(p.completedImageUrls) ? p.completedImageUrls : []
      // The harvester saves the picture without listing it on the job: the feed row has it
      const saved = !urls.length && row.falRequestId
        ? await prisma.generatedImage.findFirst({ where: { userId, falRequestId: row.falRequestId, isDeleted: false }, orderBy: { id: 'asc' }, select: { imageUrl: true } })
        : null
      const url = typeof urls[0] === 'string' ? urls[0] : saved?.imageUrl ?? null
      if (url) return { ok: true, url, queueId, ticketCost }
      return { ok: false, error: 'The job completed but saved no image.' }
    }
    if (row.status === 'failed') {
      return { ok: false, error: row.errorMessage || 'Generation failed' }
    }
  }

  // Outran the wait: hand it to the same settler the video shots use.
  return { ok: true, pending: true, queueId, ticketCost }
}
