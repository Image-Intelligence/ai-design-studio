/**
 * Nova Studio - which generation model for which job (server only, 2026-10-18).
 *
 * Two layers:
 *  1. CURATED: for each kind of job, the studio's public models in order of
 *     how well they do it - written from the models' documented strengths and
 *     what has worked on this site (NanoBanana 2.1 for people and products,
 *     Ideogram for lettering, Recraft for vectors, Kling 3.0 for premium
 *     motion...). The ids are checked against what this account may use, so a
 *     model that is renamed or gated simply drops out.
 *  2. LEARNED: real results move a model up or down - the site's star
 *     ratings (ImageRating), this user's own ratings (weighted higher: their
 *     taste is the point), and the scores Nova's critic gave (stored on the
 *     generation as videoMetadata.novaCritic). Cached for 30 minutes.
 *
 * recommend() returns the top picks with price and why, so Nova chooses with
 * reasons instead of habit - and gets better as people rate things.
 */
import prisma from '@/lib/prisma'
import { modelNote } from '@/lib/nova/model-notes'
import { novaImageModels, novaVideoModels, novaAudioModels, novaThreeDTools, type NovaKind } from '@/lib/nova/catalog'
import { audioTicketCost } from '@/lib/audio-studio'
import { toolTickets } from '@/lib/threed/catalog'

export type NovaTask = { id: string; kind: NovaKind; label: string; models: string[]; tip: string }

export const NOVA_TASKS: NovaTask[] = [
  // ── image ──
  { id: 'photoreal', kind: 'image', label: 'Photoreal people & lifestyle', models: ['nano-banana-2.1', 'nano-banana-pro', 'seedream-5-pro', 'gpt-image-2.5', 'mai-image-2.5-pro'], tip: 'Describe camera, lens and light; pass a character asset for the same face.' },
  { id: 'product', kind: 'image', label: 'Product shots & ads', models: ['nano-banana-2.1', 'pixelcut-product-photo', 'nano-banana-pro', 'seedream-5-pro', 'bria-product-holding'], tip: 'Pass the product picture as reference 1; say surface, light and mood.' },
  { id: 'text', kind: 'image', label: 'Text inside the image (posters, signs, packaging)', models: ['ideogram-v4-fast', 'ideogram-4.5', 'gpt-image-2.5', 'nano-banana-pro', 'nano-banana-2.1'], tip: 'Put the exact words in quotes; keep lines short.' },
  { id: 'logo', kind: 'image', label: 'Logos, icons & vector graphics', models: ['recraft-v4-vector', 'recraft-v4.1', 'ideogram-v4-fast', 'recraft-v4-vector-pro'], tip: 'Flat colours, simple shapes, plain background; vectorize afterwards if needed.' },
  { id: 'illustration', kind: 'image', label: 'Illustration & stylised art', models: ['recraft-v4-style', 'flux-3-image', 'krea-3', 'seedream-5-pro', 'nano-banana-2.1'], tip: 'Name the medium and style (gouache, flat vector, anime cel...).' },
  { id: 'consistency', kind: 'image', label: 'Same character / product across many images', models: ['nano-banana-2.1', 'kling-o3-image', 'seedream-5-pro', 'nano-banana-pro'], tip: 'Use the asset\'s pictures as references every time, most important first.' },
  { id: 'edit', kind: 'image', label: 'Change something in an existing image', models: ['nano-banana-2.1', 'gpt-image-2.5', 'bria-replace-background', 'qwen-image-3'], tip: 'Pass the image as reference 1 and say only what changes.' },
  { id: 'cutout', kind: 'image', label: 'Remove the background', models: ['bria-guided-remove-bg', 'pixelcut-bg-removal'], tip: 'Say what to keep.' },
  { id: 'upscale', kind: 'image', label: 'Upscale / sharpen', models: ['seedvr2-upscale', 'topaz-img-upscale-precision', 'topaz-img-upscale-generative'], tip: 'Precision keeps detail; generative invents texture.' },
  { id: 'draft', kind: 'image', label: 'Cheap fast drafts', models: ['z-image-turbo', 'flux-3-klein', 'ideogram-v4-instant', 'seedream-5-flash', 'luma-photon-flash'], tip: 'Draft cheap, then remake the chosen one on a premium model.' },
  // ── video ──
  { id: 'video-premium', kind: 'video', label: 'Premium cinematic motion', models: ['kling-v3', 'seedance-2.0', 'veo-3.1', 'vidu-q4'], tip: 'Animate a strong still (start_image_id); one camera move, one action.' },
  { id: 'video-budget', kind: 'video', label: 'Good motion on a budget', models: ['seedance-1.5', 'minimax-h3-max-turbo', 'hailuo-2.3-fast', 'veo-3.1-lite', 'kandinsky6-lite'], tip: '5 seconds, 720p; keep the prompt to the motion.' },
  { id: 'video-transform', kind: 'video', label: 'Start → end frame transformations', models: ['kling-v3', 'seedance-1.5', 'minimax-h3-max', 'wan-3.0', 'ltx-2.5-pro'], tip: 'Make the end frame as an edit of the start frame so they match.' },
  { id: 'video-sound', kind: 'video', label: 'Video with its own sound / speech', models: ['veo-3.1-fast', 'veo-3.1', 'seedance-2.0', 'kling-v3'], tip: 'Turn audio on; describe the sound and any spoken line in quotes.' },
  { id: 'video-text', kind: 'video', label: 'Text-to-video (no still)', models: ['veo-3.1-fast', 'wan-2.7', 'kling-o3', 'hailuo-2.3'], tip: 'Better: make a still first and animate it.' },
  // ── audio ──
  { id: 'voiceover', kind: 'audio', label: 'Voiceover / narration', models: ['eleven-v4', 'eleven-v4-turbo', 'gemini-3.8-flash-tts', 'minimax-speech-2.8-hd'], tip: 'Write it to be spoken; one line per beat.' },
  { id: 'dialogue', kind: 'audio', label: 'Two-voice dialogue', models: ['eleven-dialogue-v3', 'dia-tts', 'mureka-podcast'], tip: 'Label speakers per line.' },
  { id: 'song', kind: 'audio', label: 'Song with vocals', models: ['mureka-song', 'eleven-music-v2.5', 'minimax-music-3'], tip: 'Give genre, mood, tempo and the lyrics.' },
  { id: 'music-bed', kind: 'audio', label: 'Instrumental music bed', models: ['stable-audio-3', 'mureka-instrumental', 'lyria-3.5', 'eleven-music-v2.5'], tip: 'Set the length to the cut; mood + instruments + tempo.' },
  { id: 'sfx', kind: 'audio', label: 'Sound effects', models: ['eleven-sfx-v2', 'stable-audio-3-sfx', 'mirelo-sfx2'], tip: 'One sound per prompt; say how long.' },
  // ── 3D ──
  { id: '3d-image', kind: '3d', label: '3D model from a picture', models: ['tripo-h3.1-image', 'hunyuan-3.1-pro', 'meshy-7.1-image'], tip: 'A clean, front-on picture on a plain background works best.' },
  { id: '3d-text', kind: '3d', label: '3D model from a description', models: ['tripo-h3.1-text', 'meshy-7.1-text', 'hunyuan-3.1-pro-text'], tip: 'Better: make a picture first, then model it.' },
  { id: '3d-fast', kind: '3d', label: 'Quick 3D drafts', models: ['hunyuan-3.1-rapid', 'rodin-2.5-fast', 'trellis-2'], tip: 'For blocking out; remake the keeper on a pro tool.' },
]

// ── learned signals ──────────────────────────────────────────────────────────

type Stat = { avg: number; n: number }
let cache: { at: number; site: Map<string, Stat>; critic: Map<string, Stat> } | null = null
const userCache = new Map<number, { at: number; stats: Map<string, Stat> }>()
const TTL = 30 * 60_000

async function siteStats() {
  if (cache && Date.now() - cache.at < TTL) return cache
  const site = new Map<string, Stat>(), critic = new Map<string, Stat>()
  try {
    const rows = await prisma.$queryRaw<{ model: string; avg: number; n: bigint }[]>`
      SELECT gi.model, AVG(r.score)::float AS avg, COUNT(*) AS n
      FROM "ImageRating" r JOIN "GeneratedImage" gi ON gi.id = r."generatedImageId"
      WHERE r."createdAt" > now() - interval '120 days'
      GROUP BY gi.model HAVING COUNT(*) >= 5`
    for (const r of rows) site.set(r.model, { avg: r.avg, n: Number(r.n) })
    const crit = await prisma.$queryRaw<{ model: string; avg: number; n: bigint }[]>`
      SELECT model, AVG(("videoMetadata"->'novaCritic'->>'score')::float)::float AS avg, COUNT(*) AS n
      FROM "GeneratedImage"
      WHERE "videoMetadata" ? 'novaCritic' AND "createdAt" > now() - interval '120 days'
      GROUP BY model HAVING COUNT(*) >= 3`
    for (const r of crit) critic.set(r.model, { avg: r.avg, n: Number(r.n) })
  } catch { /* no stats is fine - the curated order stands */ }
  cache = { at: Date.now(), site, critic }
  return cache
}

async function userStats(userId: number) {
  const hit = userCache.get(userId)
  if (hit && Date.now() - hit.at < TTL) return hit.stats
  const stats = new Map<string, Stat>()
  try {
    const rows = await prisma.$queryRaw<{ model: string; avg: number; n: bigint }[]>`
      SELECT gi.model, AVG(r.score)::float AS avg, COUNT(*) AS n
      FROM "ImageRating" r JOIN "GeneratedImage" gi ON gi.id = r."generatedImageId"
      WHERE r."userId" = ${userId}
      GROUP BY gi.model HAVING COUNT(*) >= 3`
    for (const r of rows) stats.set(r.model, { avg: r.avg, n: Number(r.n) })
  } catch { /* none */ }
  userCache.set(userId, { at: Date.now(), stats })
  return stats
}

/** The models this user rates highest (for Nova's memory block). */
export async function userFavouriteModels(userId: number): Promise<string[]> {
  const s = await userStats(userId)
  return [...s.entries()].filter(([, v]) => v.avg >= 4).sort((a, b) => b[1].avg - a[1].avg).slice(0, 6).map(([m, v]) => `${m} (${v.avg.toFixed(1)}★ over ${v.n})`)
}

// ── recommend ────────────────────────────────────────────────────────────────

function priceOf(kind: NovaKind, id: string, isAdmin: boolean): number | null {
  if (kind === 'image') return novaImageModels(isAdmin).find(m => m.id === id)?.ticketCost ?? null
  if (kind === 'video') return novaVideoModels(isAdmin).find(m => m.id === id)?.ticketCost ?? null
  if (kind === 'audio') { const m = novaAudioModels(isAdmin).find(x => x.id === id); return m ? audioTicketCost(m, { chars: 300, seconds: m.duration?.default ?? 30 }) : null }
  const t = novaThreeDTools(isAdmin).find(x => x.id === id); return t ? toolTickets(t, {}, t.needs.images?.min ?? 0) : null
}

export async function recommend(o: { task: string; userId: number; isAdmin: boolean; maxTickets?: number }): Promise<string> {
  const q = o.task.trim().toLowerCase()
  const task = NOVA_TASKS.find(t => t.id === q) ?? NOVA_TASKS.find(t => t.label.toLowerCase().includes(q) || q.includes(t.id))
  if (!task) return `Unknown task. Tasks: ${NOVA_TASKS.map(t => `${t.id} (${t.label})`).join('; ')}`
  const [{ site, critic }, mine] = await Promise.all([siteStats(), userStats(o.userId)])
  const scored = task.models.map((id, i) => {
    const price = priceOf(task.kind, id, o.isAdmin)
    if (price == null) return null
    const s = site.get(id), c = critic.get(id), u = mine.get(id)
    // Curated order first; real ratings and critic scores nudge it
    let score = 100 - i * 10
    const why: string[] = []
    if (s) { score += (s.avg - 3) * 6; why.push(`site ${s.avg.toFixed(1)}★ (${s.n})`) }
    if (u) { score += (u.avg - 3) * 12; why.push(`your ${u.avg.toFixed(1)}★ (${u.n})`) }
    if (c) { score += (c.avg - 6) * 3; why.push(`critic ${c.avg.toFixed(1)}/10 (${c.n})`) }
    return { id, price, score, why }
  }).filter((x): x is NonNullable<typeof x> => !!x)
  const within = o.maxTickets ? scored.filter(x => x.price <= o.maxTickets!) : scored
  const ranked = (within.length ? within : scored).sort((a, b) => b.score - a.score).slice(0, 4)
  if (!ranked.length) return `No model for "${task.label}" is available to this account.`
  return [
    `${task.label} - best picks (price at default settings):`,
    // The studio's notes on how each model behaves (lib/nova/model-notes), for the top picks
    ...ranked.map((r, i) => `${i + 1}. ${r.id} · ${r.price} tickets${r.why.length ? ` · ${r.why.join(', ')}` : ''}${i < 3 && modelNote(r.id) ? `
   notes: ${modelNote(r.id)}` : ''}`),
    `Tip: ${task.tip}`,
  ].join('\n')
}
