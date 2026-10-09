import { cookies } from 'next/headers'
import sharp from 'sharp'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { fetchMedia } from '@/lib/media-fetch'
import { canonicalMediaUrl } from '@/lib/media-url'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { assetCaptionTickets, geminiUsage } from '@/lib/ai-text-pricing'
import { ASSET_KINDS, MAX_ASSET_REFS, cleanCaption, cleanTags } from '@/lib/storyboard'
import { assetsOut, findAsset, ownedImageUrls, storedRefs, updateAsset, withCaptions } from '@/lib/user-assets'

/**
 * POST /api/user/assets/caption - Auto caption (+ sort) an asset's pictures.
 *
 * Body: { assetId }                       a saved asset (My Assets): captions,
 *                                         tags and the new order are SAVED
 *       { urls, name?, kind?, notes? }    a board's asset: the captions come
 *                                         back and the page writes them
 * Returns: { asset } | { items: [{ url, caption, tags }] } - in the sorted order.
 *
 * Gemini Flash-Lite looks at each picture (512px) knowing what the asset is -
 * its name, kind and notes - and writes a caption made for the Storyboard's AI
 * draft, which picks pictures per shot by reading them ("Mara #2: ..."):
 *   - it starts with the asset's NAME, so the caption reads on its own;
 *   - then what is DISTINCT about that picture, in the facets that matter for
 *     that KIND (a character's angle / framing / expression / outfit; a
 *     location's view / area / time of day; a garment's pieces / worn or flat);
 * plus a few tags and a view group from the kind's own list. The pictures are
 * then sorted by those groups (a character: face, front, three-quarter, side,
 * back, full body...), with the clearest all-round picture first - the one
 * that leads when a shot is sent every picture of the asset.
 * Priced by lib/ai-text-pricing (1 ticket per started 12), charged before the
 * call and refunded if it fails; only the account's own pictures.
 */
export const maxDuration = 120
const MODEL = 'gemini-3.5-flash-lite'

/** Per kind: what a caption should say (in order), and the view groups to sort by (in order). */
type Profile = { facets: string; groups: string[] }
const PERSON: Profile = {
  facets: 'the view / angle and framing (face close-up, waist-up, full body, from behind...); the pose and expression; the outfit, hair and accessories visible; the setting or lighting only if it matters',
  groups: ['face', 'front', 'three-quarter', 'side', 'back', 'full-body', 'action', 'detail', 'other'],
}
const THING: Profile = {
  facets: 'the view / angle (front, three-quarter, side, rear, top, inside) and framing; which parts or details are visible; its state (open, moving, damaged, lit...); the setting or lighting only if it matters',
  groups: ['front', 'three-quarter', 'side', 'rear', 'top', 'interior', 'in-use', 'detail', 'other'],
}
const PLACE: Profile = {
  facets: 'the kind of view (establishing wide, exterior, interior, medium, close detail, aerial) and which part of the place it shows; the time of day, weather and light; notable features, props or signage; whether people are in it',
  groups: ['establishing', 'exterior', 'interior', 'medium', 'aerial', 'detail', 'other'],
}
const PROFILES: Record<string, Profile> = {
  character: PERSON,
  creature: PERSON,
  vehicle: THING,
  object: THING,
  wardrobe: {
    facets: 'how it is shown (worn front, worn side, worn back, flat lay, on a hanger, close detail); the pieces visible (top, jacket, trousers, shoes, accessories) with colour, fabric and fit; the pose only if it shows the clothes differently',
    groups: ['worn-front', 'worn-side', 'worn-back', 'full-look', 'flat-lay', 'detail', 'other'],
  },
  location: PLACE,
  landmark: PLACE,
  scenery: PLACE,
  style: {
    facets: 'what this picture shows of the look - the colour palette, the lighting, the texture / grain / medium, the composition and lens; the subject only briefly',
    groups: ['palette', 'lighting', 'texture', 'composition', 'example', 'other'],
  },
}
const GENERIC: Profile = {
  facets: 'the view / angle and framing; what is visible that differs from the other pictures; the setting or lighting if it matters',
  groups: ['main', 'alternate', 'detail', 'other'],
}

/**
 * One picture as a 512px JPEG for the model. Its library THUMBNAIL when it has
 * one: the originals are 2-20MB 2K-4K files, and fetching four in parallel
 * timed out (first live test, 2026-10-08) - a thumbnail is ~50KB and plenty to
 * describe. The original only when there's no thumbnail, with more time.
 */
async function inline(url: string, thumb?: string | null) {
  try {
    let res = thumb ? await fetchMedia(thumb, { signal: AbortSignal.timeout(15_000) }).catch(() => null) : null
    if (!res?.ok) res = await fetchMedia(url, { signal: AbortSignal.timeout(45_000) })
    if (!res.ok) return null
    const small = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } }
  } catch { return null }
}

export async function POST(req: Request) {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GEMINI_API_KEY) return jsonPrivate({ error: 'Captioning is not configured' }, { status: 500 })
  const body = await req.json().catch(() => ({})) as { assetId?: number; urls?: unknown[]; name?: string; kind?: string; notes?: string }

  // What is being captioned: a saved asset's pictures, or a board asset's (owned only)
  const row = Number.isInteger(Number(body.assetId)) && body.assetId ? await findAsset(user.id, Number(body.assetId)) : null
  if (body.assetId && !row) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const savedRefs = row ? storedRefs(row.refs) : []
  const urls = row ? savedRefs.map(r => r.url) : (await ownedImageUrls(user.id, Array.isArray(body.urls) ? body.urls : [])).slice(0, MAX_ASSET_REFS)
  if (!urls.length) return jsonPrivate({ error: 'Add pictures first' }, { status: 400 })
  const name = (row?.name ?? String(body.name ?? '')).slice(0, 80) || 'this asset'
  const kindId = String(row?.kind ?? body.kind ?? 'other')
  const kind = ASSET_KINDS.find(k => k.id === kindId)?.label ?? 'subject'
  const { facets, groups: GROUPS } = PROFILES[kindId] ?? GENERIC
  const notes = (row?.notes ?? String(body.notes ?? '')).slice(0, 600)

  const tickets = assetCaptionTickets(urls.length)
  const paid = await deductGenerationTickets(user.id, user.email ?? '', tickets)
  if (!paid.ok) return jsonPrivate({ error: `Auto caption needs ${paid.need} ticket${paid.need === 1 ? '' : 's'} - you have ${paid.have}`, needTickets: true }, { status: 402 })
  const charged = paid.newBalance >= 0 ? tickets : 0
  const fail = async (error: string, status = 502) => {
    if (charged) await refundGenerationTickets(user.id, user.email ?? '', charged)
    return jsonPrivate({ error }, { status })
  }

  try {
    // Library thumbnails for these pictures (generations have one), by stored URL
    const thumbRows = await prisma.generatedImage.findMany({ where: { userId: user.id, imageUrl: { in: urls }, thumbnailUrl: { not: null } }, select: { imageUrl: true, thumbnailUrl: true } })
    const thumbs = new Map(thumbRows.map(r => [r.imageUrl, r.thumbnailUrl]))
    const images = await Promise.all(urls.map(u => inline(u, thumbs.get(u))))
    const parts: object[] = []
    images.forEach((img, i) => { if (img) parts.push({ text: `Picture ${i + 1}:` }, img) })
    if (!parts.length) return await fail("Couldn't open the pictures - try again")
    const instruction = [
      `These are the reference pictures of ONE asset in a storyboard: a ${kind.toLowerCase()} called "${name}"${notes ? ` - ${notes}` : ''}. They keep it looking the same across AI-generated stills.`,
      'An AI planner will read your captions to pick, for each shot, the pictures that match the frame (a back view for a shot from behind, a face close-up for a close-up, the outfit a scene needs). Make every caption tell those pictures apart.',
      `For EACH numbered picture write one caption that STARTS with "${name} - " and then gives, in this order: ${facets}.`,
      'Say what is different about THIS picture; skip what is the same in all of them. Concrete plain words (colours, garments, directions), no opinions, no "image of" / "photo of", at most 28 words.',
      `Also give 2-5 short lowercase tags (the view first, then the most useful details), and a "group" - exactly one of: ${GROUPS.join(', ')}.`,
      `Finally pick "best": the number of the clearest, most representative picture of ${name} - the one to use when only one can be sent.`,
      'Reply with JSON only: {"items": [{"n": picture number, "caption": string, "tags": [string], "group": string}], "best": picture number}',
    ].join('\n')
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }, ...parts] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
    })
    if (!res.ok) return await fail(`Captioning failed (${res.status})`)
    const data = await res.json()
    { const u = geminiUsage(data); console.log(`[ai-usage] asset-caption pictures=${urls.length} in=${u.in} out=${u.out} tickets=${tickets}`) }
    const text = ((data?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[]).map(p => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    let items: { n?: number; caption?: string; tags?: string[]; group?: string }[] = []
    let best = -1
    try { const parsed = JSON.parse(text); items = parsed?.items ?? []; best = Number(parsed?.best) - 1 } catch { return await fail('The model did not return readable captions - try again') }
    // Every caption leads with the asset's name (the model sometimes drops it)
    const named = (c: string) => (!c || c.toLowerCase().startsWith(name.toLowerCase()) ? c : `${name} - ${c}`)
    const byIndex = new Map<number, { caption: string; tags: string[]; group: string }>()
    for (const it of items) {
      const i = Number(it?.n) - 1
      if (!Number.isInteger(i) || i < 0 || i >= urls.length) continue
      const group = GROUPS.includes(String(it.group)) ? String(it.group) : 'other'
      byIndex.set(i, { caption: cleanCaption(named(cleanCaption(it.caption))), tags: cleanTags(it.tags), group })
    }
    if (!byIndex.size) return await fail('The model returned no captions - try again')
    // The sort: the best all-round picture first, then by the kind's view
    // groups, keeping the original order inside a group
    const rank = (i: number) => (i === best ? -1 : Math.max(0, GROUPS.indexOf(byIndex.get(i)?.group ?? 'other')))
    const order = urls.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b)

    if (row) {
      const captions = Object.fromEntries(savedRefs.map((r, i) => [r.id, byIndex.get(i)?.caption ?? r.caption ?? '']))
      const tags = Object.fromEntries(savedRefs.map((r, i) => [r.id, byIndex.get(i)?.tags ?? r.tags ?? []]))
      const refs = withCaptions(savedRefs, { captions, tags, order: order.map(i => savedRefs[i].id) })
      const updated = await updateAsset(user.id, row.id, { kind: row.kind, name: row.name, notes: row.notes, refs })
      const [asset] = await assetsOut(user.id, [updated])
      return jsonPrivate({ asset, tickets: charged, ...(charged ? { balance: paid.newBalance } : {}) })
    }
    // A board's asset: hand the captions back keyed by the links the page sent
    const sent = (Array.isArray(body.urls) ? body.urls : []).filter((u): u is string => typeof u === 'string')
    const back = (canon: string) => sent.find(u => canonicalMediaUrl(u) === canon) ?? canon
    return jsonPrivate({
      items: order.map(i => ({ url: back(urls[i]), caption: byIndex.get(i)?.caption ?? '', tags: byIndex.get(i)?.tags ?? [] })),
      tickets: charged, ...(charged ? { balance: paid.newBalance } : {}),
    })
  } catch (e) {
    return await fail(`Captioning failed: ${(e as Error).message.slice(0, 160)}`)
  }
}
