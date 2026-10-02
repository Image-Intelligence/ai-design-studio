import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { buildFalCall } from '@/lib/chat-hub-create'
import { ensureThumbnail } from '@/lib/thumbnail'
import { STORYBOARD_IMAGE_MODELS, stillModelSpec, stillBuildOptions, GPT_SIZE_FOR_ASPECT } from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/still - make one slot's still.
 *
 * Body: { prompt, model, quality?, options?: Record<string, string>, refs?: string[] }
 * Returns: { url, imageId }
 *
 * The board's look notes are appended to the prompt and its aspect ratio is
 * used, so every slot of a board shares one look and one frame. The call is
 * built by lib/chat-hub-create's buildFalCall (the same shapes the hub uses),
 * run synchronously, re-hosted on R2 and saved to the account's library under
 * My Generations > Storyboards > <board title>, so a still is never lost if
 * the slot is regenerated. The slot itself is saved by the workspace (PATCH).
 *
 * ADMIN ONLY. No tickets: the Studios section is admin-only for now.
 */
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

async function boardFolder(userId: number, title: string): Promise<number> {
  const find = (name: string, parentId: number | null) => prisma.userGenerationFolder.findFirst({ where: { userId, name, parentId } })
  const root = (await find('Storyboards', null)) ?? await prisma.userGenerationFolder.create({ data: { userId, name: 'Storyboards', parentId: null } })
  const name = title.slice(0, 80) || 'Untitled storyboard'
  const leaf = (await find(name, root.id)) ?? await prisma.userGenerationFolder.create({ data: { userId, name, parentId: root.id } })
  return leaf.id
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
  if (!prompt) return jsonPrivate({ error: 'Write an image prompt first' }, { status: 400 })
  const spec = STORYBOARD_IMAGE_MODELS.find(m => m.id === body.model)
  if (!spec) return jsonPrivate({ error: 'Unknown image model' }, { status: 400 })
  // The model's own limits: how many refs it takes (Recraft none, Kling V3
  // one, NanoBanana Pro 2 fourteen...) and which qualities it offers
  const knobs = stillModelSpec(spec.id)
  const refs = spec.refs && Array.isArray(body.refs)
    ? (body.refs as unknown[]).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, knobs.maxRefs)
    : []
  const quality = typeof body.quality === 'string' && knobs.qualities.includes(body.quality) ? body.quality : (knobs.defQuality || '2k')

  const fullPrompt = [prompt, board.look.trim() && `Look: ${board.look.trim()}`].filter(Boolean).join('\n\n')
  // GPT Image takes a pixel size rather than a ratio
  const aspect = spec.id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[board.aspect] ?? '1024x1024') : board.aspect
  // The model's other settings, kept to the values it offers (stillSettings)
  const call = buildFalCall(spec.id, fullPrompt, refs, { aspect, quality }, stillBuildOptions(spec.id, body.options))
  if ('error' in call) return jsonPrivate({ error: call.error }, { status: 400 })

  let falUrl: string | undefined
  try {
    const out: any = await fal.subscribe(call.endpoint, { input: call.input })
    falUrl = out?.data?.images?.[0]?.url ?? out?.data?.image?.url
  } catch (e: any) {
    const detail = e?.body?.detail
    const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
    return jsonPrivate({ error: msg ? `${spec.label} refused: ${String(msg).slice(0, 240)}` : 'The model failed' }, { status: 502 })
  }
  if (!falUrl) return jsonPrivate({ error: 'The model returned no image' }, { status: 502 })

  const res = await fetch(falUrl)
  if (!res.ok) return jsonPrivate({ error: 'Could not fetch the result' }, { status: 502 })
  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') ?? 'image/png'
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
  const url = await uploadToR2(`storyboard-${user.id}-${board.id}-${Date.now()}.${ext}`, buf, ct)
  const row = await prisma.generatedImage.create({
    data: {
      userId: user.id, prompt: fullPrompt, imageUrl: url, model: spec.id, ticketCost: 0, referenceImageUrls: refs,
      folderId: await boardFolder(user.id, board.title),
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
      quality, aspectRatio: board.aspect,
    },
  })
  await ensureThumbnail(row.id).catch(() => {})
  return jsonPrivate({ url, imageId: row.id })
}
