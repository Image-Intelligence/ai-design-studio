import prisma from '@/lib/prisma'
import { fal } from '@/lib/fal-client'
import { uploadToR2, uploadPublicAsset } from '@/lib/r2'
import { signMediaUrl, canonicalMediaUrl } from '@/lib/media-url'
import { getTool, toolEndpoint, toolTickets, toolUsd, withDefaults, type ToolInput } from '@/lib/threed/catalog'

/**
 * The 3D Production Studio's job pipeline (2026-10-07; replaces the settle
 * code in /api/admin/threed).
 *
 *   submit  - a tool run: inputs checked, tickets charged (lib/ticket-gate -
 *             admins are not), the job submitted to fal's queue through the
 *             SIGNING client (our bucket is private: unsigned links never
 *             reached fal), a GenerationQueue row (modelType 'threed').
 *   settle  - finished jobs, from the page's poll AND the per-minute cron (a
 *             job no longer needs an open page to land): every file fal hands
 *             back is found (any field name, nested), copied to our storage
 *             (fal's CDN is not an archive), a light "viewer copy" of the main
 *             mesh is built (meshopt geometry, WebP textures at 1K, very dense
 *             static meshes simplified) so the studio opens it in about a second
 *             instead of downloading tens of MB, and the asset is saved as a
 *             GeneratedImage (model '3d:<tool>', videoMetadata.threed v2).
 *             A failure refunds the run.
 */

export const TAG = 'threed'
const FOREVER = () => new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000)
/** Files bigger than this stay on fal's CDN (a world archive can be 500MB+). */
const MAX_REHOST_BYTES = 220 * 1024 * 1024
/** How long a save may hold its claim before another pass takes over. */
const SAVE_CLAIM_MS = 6 * 60 * 1000
/** A job not finished after this long is given up on (and refunded). */
const GIVE_UP_MS = 75 * 60 * 1000

export type ThreeDFile = { url: string; name: string; ext: string; kind: 'mesh' | 'image' | 'archive' | 'data' | 'video' | 'other'; bytes?: number }
export type ThreeDMeta = {
  v: 2
  tool: string
  endpoint: string
  files: ThreeDFile[]
  /** The light copy the studio's viewer loads. */
  viewer: { url: string; bytes: number; from: string } | null
  poster: string | null
  usd: number | null
  tickets: number
  parentId: number | null
  options: Record<string, unknown>
  partNames?: string[]
  /** Hunyuan World: what is inside its archive, and parallax plates. */
  archive?: { name: string; bytes: number }[] | null
  layers?: { url: string; role: string; depth: number; label?: string }[] | null
}

const MESH_EXT = new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'usdz', 'ply', 'splat', '3mf'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'exr'])

function extOf(url: string, fileName?: string, contentType?: string): string {
  const fromName = (fileName ?? '').match(/\.([a-z0-9]+)$/i)?.[1]
  const fromUrl = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1]
  const fromType = contentType?.includes('gltf-binary') ? 'glb' : contentType?.split('/')[1]?.split(';')[0]
  return (fromName ?? fromUrl ?? fromType ?? 'bin').toLowerCase()
}
const kindOf = (ext: string): ThreeDFile['kind'] =>
  MESH_EXT.has(ext) ? 'mesh' : IMAGE_EXT.has(ext) ? 'image' : ext === 'zip' ? 'archive' : ext === 'json' ? 'data' : ext === 'mp4' ? 'video' : 'other'

/**
 * Every file in a fal result, whatever the model calls it: the families
 * disagree completely (model_glb, model_mesh, model_urls.*, rigged_character_*,
 * basic_animations.*, animations[], result_files[], individual_glbs[]...), so
 * the result is walked and every URL kept, named by where it was found. Links
 * that came IN (an input echoed back) are left out.
 */
export function harvestFiles(data: unknown, inputs: string[] = []): ThreeDFile[] {
  const out: ThreeDFile[] = []
  const seen = new Set(inputs.map(u => u.split('?')[0]))
  const walk = (v: unknown, path: string[]) => {
    if (out.length > 80) return
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v) && !seen.has(v.split('?')[0]) && path.length) {
        seen.add(v.split('?')[0])
        const ext = extOf(v)
        out.push({ url: v, name: path.join('.'), ext, kind: kindOf(ext) })
      }
      return
    }
    if (Array.isArray(v)) { v.forEach((x, k) => walk(x, [...path, String(k)])); return }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      // A fal File: { url, content_type, file_name, file_size }
      if (typeof o.url === 'string' && /^https?:\/\//.test(o.url)) {
        const url = o.url
        if (seen.has(url.split('?')[0])) return
        seen.add(url.split('?')[0])
        const ext = extOf(url, typeof o.file_name === 'string' ? o.file_name : undefined, typeof o.content_type === 'string' ? o.content_type : undefined)
        out.push({ url, name: path.join('.') || 'file', ext, kind: kindOf(ext), bytes: typeof o.file_size === 'number' ? o.file_size : undefined })
        return
      }
      for (const [k, x] of Object.entries(o)) walk(x, [...path, k])
    }
  }
  walk(data, [])
  return out
}

/** The file the viewer should show: a rig first, then the main GLB, then any mesh. */
export function primaryMesh(files: ThreeDFile[]): ThreeDFile | undefined {
  const meshes = files.filter(f => f.kind === 'mesh')
  const by = (re: RegExp) => meshes.find(f => re.test(f.name))
  return by(/^rigged_character_glb/) ?? by(/^model_glb$/) ?? by(/^model_mesh$/) ?? by(/^model_urls\.glb$/)
    ?? meshes.find(f => f.ext === 'glb') ?? meshes.find(f => ['fbx', 'obj', 'stl', 'ply', 'splat'].includes(f.ext)) ?? meshes[0]
}

/**
 * A light copy of a GLB for the viewer: geometry compressed with meshopt,
 * textures as WebP at most 1024px, and a static mesh over 300k triangles
 * simplified to that. Rigged meshes are never simplified (it would tear the
 * skin weights). The originals are untouched - downloads are full quality.
 */
export async function buildViewerGlb(buf: Buffer): Promise<Buffer | null> {
  try {
    const [{ NodeIO }, { ALL_EXTENSIONS }, fn, mo, sharpMod] = await Promise.all([
      import('@gltf-transform/core'), import('@gltf-transform/extensions'), import('@gltf-transform/functions'), import('meshoptimizer'), import('sharp'),
    ])
    await Promise.all([mo.MeshoptEncoder.ready, mo.MeshoptSimplifier.ready])
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': mo.MeshoptEncoder })
    const doc = await io.readBinary(new Uint8Array(buf))
    const root = doc.getRoot()
    const skinned = root.listSkins().length > 0
    let tris = 0
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices()
      const pos = p.getAttribute('POSITION')
      tris += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3
    }
    const ops = [fn.dedup(), fn.prune()]
    if (!skinned && tris > 300_000) ops.push(fn.weld(), fn.simplify({ simplifier: mo.MeshoptSimplifier, ratio: 300_000 / tris, error: 0.002 }))
    ops.push(
      fn.textureCompress({ encoder: sharpMod.default, targetFormat: 'webp', resize: [1024, 1024] }),
      fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium' }),
    )
    await doc.transform(...ops)
    return Buffer.from(await io.writeBinary(doc))
  } catch (e) {
    console.error('[3d viewer copy]', String((e as Error)?.message || e).slice(0, 200))
    return null
  }
}

async function fetchBuf(url: string, max = MAX_REHOST_BYTES): Promise<Buffer | null> {
  const res = await fetch(url.includes('r2.dev') || url.includes('prompt-protocol-media') ? signMediaUrl(url) : url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) return null
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > max) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length > max ? null : buf
}

const CONTENT_TYPE: Record<string, string> = {
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', fbx: 'application/octet-stream', stl: 'model/stl',
  usdz: 'model/vnd.usdz+zip', ply: 'application/octet-stream', splat: 'application/octet-stream', zip: 'application/zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json', mp4: 'video/mp4', exr: 'image/x-exr',
}

/**
 * Copy a job's files to our storage (three at a time) and build the viewer
 * copy and poster. Anything too big or unreachable keeps its fal link.
 */
export async function rehost(userId: number, key: string, files: ThreeDFile[]): Promise<{ files: ThreeDFile[]; viewer: ThreeDMeta['viewer']; poster: string | null }> {
  const main = primaryMesh(files)
  let mainBuf: Buffer | null = null
  const out: ThreeDFile[] = new Array(files.length)
  let i = 0
  const work = async () => {
    while (i < files.length) {
      const k = i++
      const f = files[k]
      try {
        const buf = await fetchBuf(f.url)
        if (!buf) { out[k] = f; continue }
        if (f === main) mainBuf = buf
        const safe = f.name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'file'
        const url = await uploadToR2(`3d/${userId}/${key}/${safe}.${f.ext}`, buf, CONTENT_TYPE[f.ext] ?? 'application/octet-stream')
        out[k] = { ...f, url, bytes: buf.length }
      } catch {
        out[k] = f
      }
    }
  }
  await Promise.all([work(), work(), work()])

  let viewer: ThreeDMeta['viewer'] = null
  if (main && main.ext === 'glb') {
    const src: Buffer | null = mainBuf ?? (await fetchBuf(main.url).catch(() => null))
    const light = src ? await buildViewerGlb(src) : null
    if (light) viewer = { url: await uploadToR2(`3d/${userId}/${key}/viewer.glb`, light, 'model/gltf-binary'), bytes: light.length, from: main.name }
  }

  // The poster: the model's own render or thumbnail, as a small WebP
  let poster: string | null = null
  const pic = out.find(f => f.kind === 'image' && /thumbnail|rendered_image|preview|visualization|preprocessed/i.test(f.name))
  if (pic) {
    try {
      const raw = await fetchBuf(pic.url, 30 * 1024 * 1024)
      if (raw) {
        const sharp = (await import('sharp')).default
        poster = await uploadPublicAsset(`thumbnails/3d-${userId}-${key}.webp`, await sharp(raw).resize(640, 640, { fit: 'inside' }).webp({ quality: 82 }).toBuffer(), 'image/webp')
      }
    } catch { /* the page draws one from the model */ }
  }
  return { files: out, viewer, poster }
}

/** The viewer copy of an asset's main GLB, built now (null when it has none or the build fails). */
export async function prepareViewer(userId: number, key: string, files: ThreeDFile[]): Promise<ThreeDMeta['viewer']> {
  const main = primaryMesh(files)
  if (!main || main.ext !== 'glb') return null
  const src = await fetchBuf(main.url).catch(() => null)
  const light = src ? await buildViewerGlb(src) : null
  return light ? { url: await uploadToR2(`3d/${userId}/${key}/viewer.glb`, light, 'model/gltf-binary'), bytes: light.length, from: main.name } : null
}

// ── fal's queue over REST (the client's helpers silently failed for deep endpoint paths) ──
const baseApp = (endpoint: string) => endpoint.split('/').slice(0, 2).join('/')
async function falStatus(endpoint: string, id: string): Promise<string | null> {
  const r = await fetch(`https://queue.fal.run/${baseApp(endpoint)}/requests/${id}/status`, { headers: { Authorization: `Key ${process.env.FAL_KEY ?? ''}` }, signal: AbortSignal.timeout(12_000) }).catch(() => null)
  if (!r) return null
  if (r.status === 404) return 'GONE'
  if (!r.ok) return null
  return ((await r.json().catch(() => ({}))) as { status?: string }).status ?? null
}
async function falResult(endpoint: string, id: string): Promise<{ data: Record<string, unknown> } | { why: string }> {
  const r = await fetch(`https://queue.fal.run/${baseApp(endpoint)}/requests/${id}`, { headers: { Authorization: `Key ${process.env.FAL_KEY ?? ''}` }, signal: AbortSignal.timeout(25_000) })
  const body = await r.text().catch(() => '')
  if (r.ok) { try { return { data: JSON.parse(body) } } catch { return { why: 'fal returned a result that was not JSON' } } }
  let detail: unknown = null
  try { detail = (JSON.parse(body) as { detail?: unknown }).detail } catch { /* not JSON */ }
  if (Array.isArray(detail)) return { why: `fal refused the input - ${detail.map((d: any) => `${Array.isArray(d?.loc) ? d.loc.at(-1) : '?'}: ${d?.msg ?? d?.type ?? 'invalid'}`).join('; ')}` }
  return { why: `fal returned ${r.status}${typeof detail === 'string' ? ` - ${detail.slice(0, 200)}` : body ? ` - ${body.slice(0, 160)}` : ''}` }
}

async function refund(userId: number, tickets: number) {
  if (tickets > 0) await prisma.ticket.update({ where: { userId }, data: { balance: { increment: tickets } } }).catch(() => {})
}

/**
 * Settle finished 3D jobs - one account's (the page's poll) or everyone's
 * (the cron). Every running job's status is checked (cheap); finished ones are
 * saved within the time budget, oldest first. Two settlers never save one job:
 * the row is claimed first.
 */
export async function settleThreeD(o: { userId?: number; budgetMs?: number; limit?: number } = {}): Promise<number> {
  const until = Date.now() + (o.budgetMs ?? 60_000)
  const running = await prisma.generationQueue.findMany({
    where: {
      modelType: TAG, ...(o.userId ? { userId: o.userId } : {}),
      // A 'saving' claim older than SAVE_CLAIM_MS was cut off mid-copy (a
      // function timed out): it is picked up again
      OR: [{ status: { in: ['processing', 'queued'] } }, { status: 'saving', completedAt: { lt: new Date(Date.now() - SAVE_CLAIM_MS) } }],
    },
    orderBy: { id: 'asc' },
    take: o.limit ?? 30,
    select: { id: true, userId: true, modelId: true, prompt: true, falRequestId: true, parameters: true, createdAt: true, ticketCost: true },
  })
  let saved = 0
  for (const job of running) {
    if (Date.now() > until) break
    const p = (job.parameters ?? {}) as Record<string, any>
    const endpoint = String(p.endpoint ?? '')
    const charged = Number(p.charged ?? 0)
    const fail = async (why: string) => {
      const done = await prisma.generationQueue.updateMany({ where: { id: job.id, status: { in: ['processing', 'queued', 'saving'] } }, data: { status: 'failed', errorMessage: why.slice(0, 400), completedAt: new Date() } })
      if (done.count) await refund(job.userId, charged)
    }
    if (!job.falRequestId || !endpoint) { await fail('Submitted without a request id'); continue }
    try {
      const st = await falStatus(endpoint, job.falRequestId)
      if (st === 'GONE') { await fail('fal no longer knows this job - refunded'); continue }
      if (st !== 'COMPLETED') {
        if (Date.now() - job.createdAt.getTime() > GIVE_UP_MS) await fail('Still not finished after 75 minutes - refunded')
        continue
      }
      const got = await falResult(endpoint, job.falRequestId)
      if ('why' in got) { await fail(`${got.why} - refunded`); continue }
      const inputs: string[] = Array.isArray(p.inputs) ? p.inputs : []
      const files = harvestFiles(got.data, inputs)
      if (!files.length) { await fail(`Returned no file (keys: ${Object.keys(got.data).slice(0, 8).join(', ')}) - refunded`); continue }

      // Claim it ('saving'), so a second settler (page + cron) stops here; a
      // claim cut off mid-copy is retried after SAVE_CLAIM_MS
      const claim = await prisma.generationQueue.updateMany({
        where: { id: job.id, OR: [{ status: { in: ['processing', 'queued'] } }, { status: 'saving', completedAt: { lt: new Date(Date.now() - SAVE_CLAIM_MS) } }] },
        data: { status: 'saving', completedAt: new Date() },
      })
      if (!claim.count) continue
      try {
        const key = `job-${job.id}`
        let { files: kept, viewer, poster } = await rehost(job.userId, key, files)
        // Hunyuan World: its picture lives inside the archive (lib/world-layers)
        let archive: ThreeDMeta['archive'] = null, layers: ThreeDMeta['layers'] = null
        const zip = kept.find(f => f.kind === 'archive')
        if (zip && !poster) {
          try {
            const { buildWorldLayers, worthParallax } = await import('@/lib/world-layers')
            const built = await buildWorldLayers(zip.url.includes('fal.media') ? zip.url : signMediaUrl(zip.url))
            archive = built.entries
            if (worthParallax(built.layers)) {
              layers = []
              for (const [k, layer] of built.layers.entries()) layers.push({ url: await uploadToR2(`3d/${job.userId}/${key}/layer-${k}-${layer.role}.webp`, layer.webp, 'image/webp'), role: layer.role, depth: layer.depth, label: layer.label })
            }
            if (built.full) { const url = await uploadToR2(`3d/${job.userId}/${key}/panorama.png`, built.full, 'image/png'); kept = [...kept, { url, name: 'panorama', ext: 'png', kind: 'image' }]; poster = url }
          } catch (e) { console.error('[3d settle] archive', job.id, String((e as Error)?.message).slice(0, 120)) }
        }
        const partNames = Array.isArray((got.data as any).part_names) ? (got.data as any).part_names.map(String).slice(0, 60) : undefined
        const meta: ThreeDMeta = {
          v: 2, tool: job.modelId, endpoint, files: kept, viewer, poster, usd: typeof p.usd === 'number' ? p.usd : null, tickets: charged,
          parentId: Number.isInteger(p.parentId) ? p.parentId : null, options: p.options ?? {}, ...(partNames ? { partNames } : {}), archive, layers,
        }
        const main = primaryMesh(kept)
        await prisma.generatedImage.create({
          data: {
            userId: job.userId, prompt: job.prompt, model: `3d:${job.modelId}`, ticketCost: charged,
            imageUrl: poster ?? viewer?.url ?? main?.url ?? kept[0].url,
            referenceImageUrls: inputs.map(canonicalMediaUrl).slice(0, 20),
            expiresAt: FOREVER(), falRequestId: job.falRequestId,
            videoMetadata: { [TAG]: meta } as object,
          },
        })
        await prisma.generationQueue.update({ where: { id: job.id }, data: { status: 'completed', completedAt: new Date() } })
        saved++
      } catch (e) {
        // Hand the claim back: the next pass tries again
        await prisma.generationQueue.update({ where: { id: job.id }, data: { status: 'processing', completedAt: null } }).catch(() => {})
        console.error('[3d settle] save', job.id, String((e as Error)?.message || e).slice(0, 200))
      }
    } catch (e) {
      console.error('[3d settle]', job.id, String((e as Error)?.message || e).slice(0, 200))
    }
  }
  return saved
}

/**
 * Submit one tool run. Returns the job, or why not. `charge` false = an admin
 * (nothing taken). Inputs must already be checked (ownership, filter).
 */
export async function submitThreeD(o: {
  userId: number; email: string; isAdmin: boolean; toolId: string; input: ToolInput; parentId?: number | null; title: string
}): Promise<{ ok: true; job: { id: number; toolId: string; prompt: string; queuedAt: Date; tickets: number } } | { ok: false; error: string; status: number; needTickets?: boolean }> {
  const tool = getTool(o.toolId)
  if (!tool) return { ok: false, error: 'Unknown 3D tool', status: 400 }
  if (tool.admin && !o.isAdmin) return { ok: false, error: 'This tool is not available', status: 403 }
  const images = (o.input.images ?? []).filter(Boolean)
  const n = tool.needs
  if (n.prompt === 'required' && !o.input.prompt?.trim()) return { ok: false, error: `${tool.label} needs a description`, status: 400 }
  if (n.images && images.length < n.images.min) return { ok: false, error: n.images.min === 1 ? `${tool.label} needs a picture` : `${tool.label} needs at least ${n.images.min} pictures`, status: 400 }
  if (n.mesh && !o.input.mesh) return { ok: false, error: `${tool.label} works on a model - pick one from your library`, status: 400 }
  if (n.meshExt && o.input.mesh && !n.meshExt.includes(o.input.mesh.split('?')[0].split('.').pop()!.toLowerCase()))
    return { ok: false, error: `${tool.label} needs a ${n.meshExt.join('/').toUpperCase()} file`, status: 400 }
  const options = withDefaults(tool, o.input.options ?? {})
  const missing = tool.controls.filter(c => c.required && (options[c.key] === undefined || options[c.key] === '')).map(c => c.label)
  if (missing.length) return { ok: false, error: `${tool.label} needs ${missing.join(' and ')}`, status: 400 }

  const usd = toolUsd(tool, options, images.length)
  const tickets = toolTickets(tool, options, images.length)
  const input = tool.build({ ...o.input, images: n.images ? images.slice(0, n.images.max) : [], options })
  // fal's own safety checker stays on for everyone but admins
  if (!o.isAdmin && 'enable_safety_checker' in input) input.enable_safety_checker = true
  const endpoint = toolEndpoint(tool, options)

  // Charged before submit (admins skipped), refunded if the submit fails
  const { deductGenerationTickets } = await import('@/lib/ticket-gate')
  const paid = await deductGenerationTickets(o.userId, o.email, tickets)
  if (!paid.ok) return { ok: false, error: `${tool.label} needs ${paid.need} tickets - you have ${paid.have}`, status: 402, needTickets: true }
  const charged = o.isAdmin ? 0 : tickets
  try {
    const { request_id } = await fal.queue.submit(endpoint, { input: input as any })
    const job = await prisma.generationQueue.create({
      data: {
        userId: o.userId, modelId: tool.id, modelType: TAG, prompt: o.title.slice(0, 500), status: 'processing',
        ticketCost: charged, falRequestId: request_id, startedAt: new Date(),
        parameters: {
          source: TAG, endpoint, usd, charged, chargeMode: charged ? 'deduct' : 'none',
          options: options as object, parentId: o.parentId ?? null,
          inputs: [...images, ...(o.input.mesh ? [o.input.mesh] : [])].map(canonicalMediaUrl),
        },
      },
      select: { id: true, createdAt: true },
    })
    return { ok: true, job: { id: job.id, toolId: tool.id, prompt: o.title, queuedAt: job.createdAt, tickets } }
  } catch (e: any) {
    await refund(o.userId, charged)
    const detail = e?.body?.detail
    const msg = Array.isArray(detail) ? detail.map((d: any) => `${d?.loc?.at?.(-1) ?? ''} ${d?.msg ?? ''}`.trim()).join('; ') : typeof detail === 'string' ? detail : e?.message
    return { ok: false, error: `${tool.label} could not start: ${String(msg || e).slice(0, 240)}`, status: 502 }
  }
}
