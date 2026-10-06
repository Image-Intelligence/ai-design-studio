import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { requireStudioUser } from '@/lib/studio-auth'
import { jsonPrivate } from '@/lib/api-json'
import { fal } from '@/lib/fal-client'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { STUDIO_AI_TICKETS, type StudioAiOp } from '@/lib/image-studio'

/**
 * POST /api/employees/image-studio/ai - the studio's AI selections.
 *
 * Body: { op, image, prompt?, points?, box? }
 *   image    a data URL of what the user sees (the page sends it at most
 *            ~2048px on the long side - plenty for a mask, small enough for a
 *            request body)
 *   select   a text prompt ("the red car", "all the people"), clicks
 *            (points: [{ x, y, label: 1 keep | 0 not this }]) and/or a box
 *            ([x0, y0, x1, y1]) - in the sent image's pixels. Every object
 *            found is merged into one selection. With a prompt or a box it is
 *            SAM 3.1; clicks alone go to SAM 2 - fal's SAM 3.1 answers a bare
 *            click with nothing (tested 2026-10-06: a click on a boat gave 0
 *            masks, the same click plus "boat" or a box gave the boat).
 *   subject  BiRefNet v2: the main subject, no prompt (background removal)
 * Returns: { mask: data URL (white = selected), tickets, balance }
 *
 * Charged in tickets before the model runs (STUDIO_AI_TICKETS: fal cost /
 * $0.04, rounded up) and refunded if it fails. Any signed-in account (the
 * editor also runs in the Edit Image popup); admins are not charged.
 */
export const maxDuration = 120

const fail = (e: any) => {
  const detail = e?.body?.detail
  return Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : String(e?.message || e)
}

/** Black / white masks merged into one (the brightest of each pixel), as a PNG data URL. */
async function mergeMasks(urls: string[]): Promise<string | null> {
  const bufs: Buffer[] = []
  for (const b of await Promise.all(urls.map(async (u): Promise<Buffer | null> => {
    if (u.startsWith('data:')) return Buffer.from(u.split(',')[1] ?? '', 'base64')
    const r = await fetch(u)
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null
  }))) if (b) bufs.push(b)
  if (!bufs.length) return null
  const first = sharp(bufs[0]).greyscale()
  const { width, height } = await first.metadata()
  if (!width || !height) return null
  const acc = await sharp(bufs[0]).greyscale().raw().toBuffer()
  for (const b of bufs.slice(1)) {
    const px = await sharp(b).greyscale().resize(width, height, { fit: 'fill' }).raw().toBuffer()
    for (let i = 0; i < acc.length; i++) if (px[i] > acc[i]) acc[i] = px[i]
  }
  // An empty mask means nothing was found
  let any = false
  for (let i = 0; i < acc.length; i += 7) if (acc[i] > 127) { any = true; break }
  if (!any) return null
  const png = await sharp(acc, { raw: { width, height, channels: 1 } }).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

export async function POST(req: NextRequest) {
  const user = await requireStudioUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const op = body.op as StudioAiOp
  if (!(op in STUDIO_AI_TICKETS)) return jsonPrivate({ error: 'Unknown AI tool' }, { status: 400 })
  const image = typeof body.image === 'string' ? body.image : ''
  if (!image.startsWith('data:image/') || image.length > 4_200_000) return jsonPrivate({ error: 'Send the image as a data URL under ~3MB' }, { status: 400 })

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 300) : ''
  const points = (Array.isArray(body.points) ? body.points : []).slice(0, 24)
    .filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y), label: p.label === 0 ? 0 : 1 }))
  const box = Array.isArray(body.box) && body.box.length === 4 && body.box.every((n: any) => Number.isFinite(n)) ? body.box.map((n: number) => Math.round(n)) : null
  if (op === 'select' && !prompt && !points.length && !box) return jsonPrivate({ error: 'Describe it, click it or draw a box around it' }, { status: 400 })

  const cost = STUDIO_AI_TICKETS[op]
  const paid = await deductGenerationTickets(user.id, user.email, cost)
  if (!paid.ok) return jsonPrivate({ error: `This needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })

  try {
    let mask: string | null = null
    if (op === 'select' && points.length && !prompt && !box) {
      const out: any = await fal.subscribe('fal-ai/sam2/image', {
        input: { image_url: image, prompts: points.map((p: any) => ({ x: p.x, y: p.y, label: p.label })), apply_mask: false, output_format: 'png', sync_mode: true } as any,
      })
      const u = out?.data?.image?.url
      mask = u ? await mergeMasks([u]) : null
    } else if (op === 'select') {
      const out: any = await fal.subscribe('fal-ai/sam-3-1/image', {
        input: {
          image_url: image,
          ...(prompt ? { prompt } : {}),
          ...(points.length ? { point_prompts: points } : {}),
          ...(box ? { box_prompts: [{ x_min: box[0], y_min: box[1], x_max: box[2], y_max: box[3] }] } : {}),
          return_multiple_masks: !!prompt && !points.length && !box,
          max_masks: 16,
          apply_mask: false,
          output_format: 'png',
          sync_mode: true,
        } as any,
      })
      const urls = [...(out?.data?.masks ?? []), ...(out?.data?.masks?.length ? [] : [out?.data?.image])].map((m: any) => m?.url).filter(Boolean)
      mask = await mergeMasks(urls)
    } else {
      const out: any = await fal.subscribe('fal-ai/birefnet/v2', {
        input: { image_url: image, mask_only: true, operating_resolution: '2048x2048', output_format: 'png', sync_mode: true } as any,
      })
      const u = out?.data?.image?.url
      mask = u ? await mergeMasks([u]) : null
    }
    // Nothing found is still a run fal bills for, so the ticket stands
    if (!mask) return jsonPrivate({ error: op === 'select' ? (prompt ? `No "${prompt}" found - try other words, or click on it` : 'Nothing found there - try clicking closer to the middle of it') : 'No clear subject found', tickets: cost, balance: paid.newBalance }, { status: 422 })
    return jsonPrivate({ mask, tickets: cost, balance: paid.newBalance })
  } catch (e) {
    await refundGenerationTickets(user.id, user.email, cost)
    return jsonPrivate({ error: `The AI selection failed: ${fail(e).slice(0, 240)}` }, { status: 502 })
  }
}
