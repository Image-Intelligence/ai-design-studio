import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { requireStoryboardUser } from '@/lib/storyboard-gate'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload, isOurMedia } from '@/lib/media-url'
import { fetchMedia } from '@/lib/media-fetch'
import { uploadToR2, uploadPublicAsset } from '@/lib/r2'
import { boardFolder } from '@/lib/storyboard-shoot'
import { sanitizeShots, sanitizeScenes, orderByScenes, STILLS_CUT_TICKETS, type StoryboardShot } from '@/lib/storyboard'
import { renderCaption, isCaptionPos, SAFE_AREAS, type CaptionPos, type SafeArea } from '@/lib/caption-art'

/**
 * POST /api/employees/storyboards/[id]/stills-cut - the board as a film of
 * its STILLS: for an image model's showcase, a lookbook, a before/after reel -
 * anything where the pictures are the point and no video model should redraw
 * them.
 *
 * Body: { format?: 'board' | 'card' | 'social' | 'wide', captions?: boolean, tag?: string,
 *         clips?: boolean, loop?: boolean, sceneId?: string }
 *   format    board = the board's frame; card = 4:3 1280x960, silent, light
 *             enough for a home-page card; social = 9:16 1080x1920 (Reels /
 *             TikTok / Shorts); wide = 16:9 1920x1080 (YouTube)
 *   captions  a caption on every shot - the shot's own (Details) or one the AI
 *             writes from its title - placed by the AI where it covers no face,
 *             subject or text in that frame, inside the format's safe area
 *   tag       a small gold line over every caption ("NANO BANANA 2.1")
 *   clips     use a shot's video where it has one (a still otherwise) - stills
 *             and motion in one cut
 *   loop      open on the last shot too, so a looping player runs seamlessly
 * Each still is held with a slow push-in (a panorama or a tall still pans
 * instead); a shot that edits the one before it arrives with a wipe, so the
 * change reads as an edit, and a shot with a "before" picture plays before ->
 * after. Everything else dissolves.
 * Returns: { url, durationSec, imageId, posterUrl } - also saved to My Generations.
 *
 *     or:  { op: 'home-card', url, key } -> { cardUrl } puts a cut on a home-page
 *          card (key as /api/admin/home-cards uses it, e.g. "image:NanoBanana 2.1"):
 *          re-encoded card-sized (long side 1280, ~3 Mbps, no sound).
 *
 * Any signed-in account: a cut costs STILLS_CUT_TICKETS (refunded if it
 * fails); putting one on a home card is ADMIN ONLY.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

const exec = promisify(execFile)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const FPS = 30
const MAX_SEGMENTS = 30
type Ctx = { params: Promise<{ id: string }> }
type Format = 'board' | 'card' | 'social' | 'wide'

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
/** The output frame for a format. */
function frameFor(format: Format, boardAspect: string): { W: number; H: number } {
  if (format === 'card') return { W: 1280, H: 960 }
  if (format === 'social') return { W: 1080, H: 1920 }
  if (format === 'wide') return { W: 1920, H: 1080 }
  const [a, b] = boardAspect.split(':').map(Number)
  const r = a > 0 && b > 0 ? a / b : 16 / 9
  // 1080 on the short side, the long side at most 1920
  return r >= 1 ? { W: even(Math.min(1920, 1080 * r)), H: even(Math.min(1920, 1080 * r) / r) } : { W: even(Math.min(1920, 1080 / r) * r), H: even(Math.min(1920, 1080 / r)) }
}

async function ff(args: string[]) {
  await exec(ffmpegPath as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1024 * 1024 * 32 })
}
async function clipSeconds(file: string): Promise<number> {
  const { stderr } = await exec(ffmpegPath as string, ['-hide_banner', '-i', file]).catch((e: any) => ({ stderr: String(e?.stderr ?? '') }))
  const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr)
  return d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0
}

/**
 * A still made ready for one frame, at `k` times its size (room for the
 * push-in): cropped to fill when little is lost, else whole over a blurred,
 * darkened copy of itself. A panorama / very tall strip is kept whole for a pan.
 */
async function prepStill(buf: Buffer, W: number, H: number, k: number): Promise<{ file: Buffer; pan: 'x' | 'y' | null }> {
  const meta = await sharp(buf).metadata()
  const r = (meta.width ?? 1) / (meta.height ?? 1), t = W / H
  // Only a real panorama (2.4:1 and wider) or tall strip pans - an ordinary
  // 4:3 still in a 9:16 frame panned would crop the people out of it
  if (r >= 2.4 && r > t * 1.6) return { file: await sharp(buf).resize({ height: H * k }).png().toBuffer(), pan: 'x' }
  if (r <= 1 / 2.4 && r < t / 1.6) return { file: await sharp(buf).resize({ width: W * k }).png().toBuffer(), pan: 'y' }
  const lost = 1 - Math.min(r / t, t / r)
  const size = { width: W * k, height: H * k }
  if (lost <= 0.3) return { file: await sharp(buf).resize({ ...size, fit: 'cover', position: sharp.strategy.attention }).png().toBuffer(), pan: null }
  const bg = await sharp(buf).resize({ ...size, fit: 'cover' }).blur(40).modulate({ brightness: 0.5 }).toBuffer()
  const fg = await sharp(buf).resize({ ...size, fit: 'inside' }).toBuffer()
  return { file: await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).png().toBuffer(), pan: null }
}

type Plan = { text: string; sub: string; pos: CaptionPos }
/**
 * The AI's captions: for each frame, the words (the shot's own when it has
 * them) and the one spot of six where the box covers nothing that matters.
 */
async function planCaptions(frames: { n: number; jpg: Buffer; shot: StoryboardShot }[], format: Format): Promise<Map<number, Plan>> {
  const out = new Map<number, Plan>()
  const fallback = (s: StoryboardShot): Plan => ({ text: (s.caption || s.title || '').slice(0, 40), sub: s.captionSub || '', pos: 'tl' })
  frames.forEach(f => out.set(f.n, fallback(f.shot)))
  if (!GEMINI_API_KEY || !frames.length) return out
  const where = format === 'social'
    ? 'This is a 9:16 phone video: never use the bottom quarter or the right edge (the app\'s buttons sit there) - so prefer top-left, top-center or top-right.'
    : format === 'card' ? 'This plays on a website card that prints its own name along the bottom edge - keep clear of the bottom sixth.' : ''
  const parts: any[] = [{
    text: [
      'You place captions on the frames of a short video. For EACH frame below, decide:',
      '- "pos": where a caption box (about 40% of the frame wide and 15% tall) goes so it covers NOTHING important: never over a face or head, a person\'s or animal\'s body, the main subject or product, or any text already in the picture. Prefer empty sky, a plain wall or floor, or soft out-of-focus background. One of: tl (top-left), tr (top-right), tc (top-center), bl (bottom-left), br (bottom-right), bc (bottom-center).',
      where,
      '- "text": the caption. When the frame comes with CAPTION, use it exactly. Otherwise write 1-4 punchy words from its title and description (e.g. "NEW OUTFIT", "ANY ANGLE", "PERFECT TEXT").',
      '- "sub": when the frame comes with SUB, use it exactly; otherwise an optional short second line (up to 6 words) or an empty string.',
      'Reply with JSON only: {"frames": [{"n": number, "pos": string, "text": string, "sub": string}]}',
    ].filter(Boolean).join('\n'),
  }]
  for (const f of frames) {
    parts.push({ text: `FRAME ${f.n}: title "${f.shot.title}" - ${f.shot.description}${f.shot.caption ? ` | CAPTION: "${f.shot.caption}"` : ''}${f.shot.captionSub ? ` | SUB: "${f.shot.captionSub}"` : ''}` })
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: f.jpg.toString('base64') } })
  }
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }),
    })
    if (!res.ok) return out
    const data = await res.json() as any
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    for (const r of (JSON.parse(text)?.frames ?? []) as any[]) {
      const n = Number(r?.n)
      const f = frames.find(x => x.n === n)
      if (!f) continue
      out.set(n, {
        text: (f.shot.caption || String(r?.text ?? '') || f.shot.title).slice(0, 40),
        sub: (f.shot.captionSub ?? String(r?.sub ?? '')).slice(0, 60),
        pos: isCaptionPos(r?.pos) ? r.pos : 'tl',
      })
    }
  } catch { /* the fallbacks stand */ }
  // A phone frame's bottom belongs to the app
  if (format === 'social') for (const [n, p] of out) if (p.pos[0] === 'b') out.set(n, { ...p, pos: (`t${p.pos[1]}` as CaptionPos) })
  return out
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  let dir: string | null = null
  let charged = 0

  try {
    dir = await mkdtemp(path.join(tmpdir(), 'stillscut-'))

    // ── a cut onto a home-page card ──
    if (body.op === 'home-card') {
      if (!user.isAdmin) return jsonPrivate({ error: 'Only an admin can change the home page' }, { status: 403 })
      const url = String(body.url ?? ''), key = String(body.key ?? '').trim().slice(0, 120)
      if (!isOurMedia(url) || !/^[a-z]+:.+/i.test(key)) return jsonPrivate({ error: 'Send the cut and a card key like image:NanoBanana 2.1' }, { status: 400 })
      const src = path.join(dir, 'src.mp4'), out = path.join(dir, 'card.mp4')
      const res = await fetchMedia(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) return jsonPrivate({ error: 'Could not fetch the cut' }, { status: 502 })
      await writeFile(src, Buffer.from(await res.arrayBuffer()))
      // As every card video is kept (lib card renditions): long side 1280, <= 30 fps, ~3 Mbps, no sound
      await ff(['-i', src, '-vf', "scale=w='if(gte(iw,ih),min(iw,1280),-2)':h='if(gte(iw,ih),-2,min(ih,1280))'", '-fpsmax', '30',
        '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M',
        '-preset', 'veryfast', '-g', '60', '-movflags', '+faststart', '-an', out])
      const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
      const cardUrl = await uploadPublicAsset(`home-cards/${slug}-cut-${crypto.randomUUID()}.mp4`, await readFile(out), 'video/mp4')
      const prev = await prisma.homeCard.findUnique({ where: { key } })
      await prisma.homeCard.upsert({ where: { key }, update: { mediaUrl: cardUrl, mediaType: 'video' }, create: { key, mediaUrl: cardUrl, mediaType: 'video' } })
      console.log(`[stills-cut] home card ${key} -> ${cardUrl} (was ${prev?.mediaUrl ?? 'empty'})`)
      return jsonPrivate({ cardUrl, previous: prev?.mediaUrl ?? null })
    }

    // ── the cut ──
    const format: Format = (['board', 'card', 'social', 'wide'] as const).includes(body.format as Format) ? body.format as Format : 'board'
    const { W, H } = frameFor(format, board.aspect)
    const safe: SafeArea = SAFE_AREAS[format === 'social' ? 'social' : format === 'card' ? 'card' : 'plain']
    const scenes = sanitizeScenes(board.scenes)
    let shots = orderByScenes(sanitizeShots(board.shots), scenes)
    if (typeof body.sceneId === 'string' && body.sceneId) shots = shots.filter(s => s.sceneId === body.sceneId)
    const useClips = body.clips === true
    const usable = shots.filter(s => s.stillUrl || (useClips && s.video?.status === 'done' && s.video.url))
    if (!usable.length) return jsonPrivate({ error: 'Make some stills first' }, { status: 400 })
    // Open on the last shot as well: a looping player then runs on seamlessly
    const order = (body.loop === true && usable.length > 1 ? [usable[usable.length - 1], ...usable] : usable).slice(0, MAX_SEGMENTS)
    const tag = typeof body.tag === 'string' ? body.tag.trim().slice(0, 40) : ''
    // Paid for up front (admins are skipped by the gate), refunded if the cut fails
    const paid = await deductGenerationTickets(user.id, user.email, STILLS_CUT_TICKETS)
    if (!paid.ok) return jsonPrivate({ error: `A Stills cut needs ${paid.need} tickets - you have ${paid.have}`, needTickets: true }, { status: 402 })
    charged = STILLS_CUT_TICKETS

    const fetchBuf = async (url: string) => {
      const r = await fetchMedia(url, { signal: AbortSignal.timeout(90_000) })
      if (!r.ok) throw new Error(`Could not fetch a shot (${r.status})`)
      return Buffer.from(await r.arrayBuffer())
    }
    // The pictures, once each
    const stillBufs = new Map<string, Buffer>()
    await Promise.all([...new Set(order.flatMap(s => [s.stillUrl, s.beforeUrl].filter((u): u is string => !!u)))].map(async u => stillBufs.set(u, await fetchBuf(u))))

    // Captions: one call for the whole board, each frame judged on its own picture
    const caps = new Map<number, Plan>()
    if (body.captions === true) {
      const frames = await Promise.all(order.map(async (s, n) => ({ n, shot: s, jpg: await sharp(stillBufs.get(s.stillUrl ?? '') ?? stillBufs.get(s.beforeUrl ?? '')!).resize(W > H ? 640 : 400, W > H ? 400 : 640, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer() })))
      const planned = await planCaptions(frames.filter(f => f.jpg), format)
      // The loop's opener repeats the last shot - no caption on it twice
      for (const [n, p] of planned) if (!(body.loop === true && n === 0)) caps.set(n, p)
    }

    // Transitions: a shot that edits the one before it wipes in (the change reads as an edit)
    const arrival = (i: number): { kind: 'wipeleft' | 'fade'; d: number } | null => {
      // None before the first segment, nor after the last
      if (i <= 0 || i >= order.length) return null
      const s = order[i], prev = order[i - 1]
      return s.editOf && s.editOf === prev.id ? { kind: 'wipeleft', d: 0.5 } : { kind: 'fade', d: 0.45 }
    }
    const holdOf = (s: StoryboardShot) => Math.min(6, Math.max(1.6, s.duration || 3))

    // Each segment, rendered on its own (three at a time) with its caption burned in
    const segs: { file: string; secs: number }[] = new Array(order.length)
    let next = 0
    const work = async () => {
      while (next < order.length) {
        const i = next++
        const s = order[i]
        const tail = arrival(i + 1)?.d ?? 0
        const file = path.join(dir!, `seg-${i}.mp4`)
        // The caption goes on after the join (see below), never inside a dissolve
        const cap = caps.get(i)
        if (cap?.text) await writeFile(path.join(dir!, `cap-${i}.png`), await renderCaption({ width: W, height: H, text: cap.text, sub: cap.sub, tag, pos: cap.pos, safe }))
        const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an']
        const clip = useClips && s.video?.status === 'done' && s.video.url ? s.video.url : null
        if (clip) {
          // A shot's video, filling the frame, held on its last frame through the hand-over
          const src = path.join(dir!, `clip-${i}.mp4`)
          await writeFile(src, await fetchBuf(clip))
          const len = await clipSeconds(src)
          const secs = Math.max(1, Math.min(len || s.duration, s.keepWhole ? 60 : Math.max(s.duration, 1)))
          await ff(['-i', src, '-filter_complex',
            `[0:v]trim=duration=${secs.toFixed(2)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},tpad=stop_mode=clone:stop_duration=${tail.toFixed(2)},setsar=1[v]`,
            '-map', '[v]', '-t', (secs + tail).toFixed(2), ...enc, file])
          segs[i] = { file, secs }
          continue
        }
        const secs = holdOf(s)
        const dur = secs + tail
        const frames = Math.round(dur * FPS)
        const K = 1.5
        const after = await prepStill(stillBufs.get(s.stillUrl!)!, W, H, K)
        const aFile = path.join(dir!, `still-${i}.png`)
        await writeFile(aFile, after.file)
        /*
         * One picture as `secs` of motion: a pan along a panorama / tall still
         * (a looped input, timed by t), else a push-in (a single input frame -
         * zoompan makes every frame from it). `zoom` = how far it pushes in.
         */
        const still = (file: string, pan: 'x' | 'y' | null, secs: number, zoom = 0.06) => {
          const n = Math.round(secs * FPS)
          return pan
            ? { input: ['-loop', '1', '-framerate', String(FPS), '-t', secs.toFixed(2), '-i', file],
                vf: pan === 'x'
                  ? `crop=${W * K}:${H * K}:x='(iw-${W * K})*min(1,t/${secs.toFixed(2)})':y=0,scale=${W}:${H},setsar=1`
                  : `crop=${W * K}:${H * K}:x=0:y='(ih-${H * K})*min(1,t/${secs.toFixed(2)})',scale=${W}:${H},setsar=1` }
            : { input: ['-i', file], vf: `zoompan=z='1+${zoom}*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1` }
        }
        if (s.beforeUrl && stillBufs.get(s.beforeUrl)) {
          // Before -> after: the before held (barely moving), then a slow wipe reveals the result
          const before = await prepStill(stillBufs.get(s.beforeUrl)!, W, H, K)
          const bFile = path.join(dir!, `before-${i}.png`)
          await writeFile(bFile, before.file)
          const hold = Math.max(1, secs * 0.4), wipe = 0.9
          const b = still(bFile, before.pan, hold + wipe, 0.015), a = still(aFile, after.pan, dur - hold)
          await ff([...b.input, ...a.input, '-filter_complex',
            `[0:v]${b.vf}[b0];[1:v]${a.vf}[a0];[b0][a0]xfade=transition=wipeleft:duration=${wipe}:offset=${hold.toFixed(2)}[v]`,
            '-map', '[v]', '-frames:v', String(frames), ...enc, file])
        } else {
          const a = still(aFile, after.pan, dur)
          await ff([...a.input, '-filter_complex', `[0:v]${a.vf}[v]`,
            '-map', '[v]', '-frames:v', String(frames), ...enc, file])
        }
        segs[i] = { file, secs }
      }
    }
    await Promise.all([work(), work(), work()])

    // Join: each arrival overlaps the end of the segment before it
    const joined = path.join(dir, 'joined.mp4')
    const out = path.join(dir, 'cut.mp4')
    if (segs.length === 1) {
      await ff(['-i', segs[0].file, '-c', 'copy', joined])
    } else {
      let chain = '', prev = '[0:v]', t = 0
      for (let i = 1; i < segs.length; i++) {
        t += segs[i - 1].secs
        const a = arrival(i)!
        const label = i === segs.length - 1 ? '[out]' : `[x${i}]`
        chain += `${prev}[${i}:v]xfade=transition=${a.kind}:duration=${a.d}:offset=${t.toFixed(3)}${label};`
        prev = label
      }
      await ff([...segs.flatMap(s => ['-i', s.file]), '-filter_complex', chain.slice(0, -1), '-map', '[out]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', joined])
    }
    /*
     * The captions, on the joined film: caption i shows from the moment shot i
     * has fully arrived until the next one starts to arrive, fading in and out
     * - so a dissolve never shows two captions on top of each other.
     */
    const capIn: string[] = [], capChain: string[] = []
    let at = 0, prevLabel = '[0:v]', k = 0
    for (let i = 0; i < segs.length; i++) {
      const start = at + (arrival(i)?.d ?? 0), end = at + segs[i].secs
      at += segs[i].secs
      const file = path.join(dir, `cap-${i}.png`)
      if (!caps.get(i)?.text || end - start < 0.5) continue
      const len = end - start, f = Math.min(0.2, len / 4)
      k++
      capIn.push('-loop', '1', '-framerate', String(FPS), '-t', len.toFixed(3), '-i', file)
      capChain.push(`[${k}:v]format=rgba,fade=t=in:st=0:d=${f.toFixed(2)}:alpha=1,fade=t=out:st=${(len - f).toFixed(3)}:d=${f.toFixed(2)}:alpha=1,setpts=PTS+${start.toFixed(3)}/TB[c${k}]`)
      const label = `[o${k}]`
      capChain.push(`${prevLabel}[c${k}]overlay=0:0:eof_action=pass${label}`)
      prevLabel = label
    }
    const quality = format === 'card' ? ['-crf', '22', '-maxrate', '3M', '-bufsize', '6M', '-g', '60'] : ['-crf', '19']
    await ff(['-i', joined, ...capIn, ...(capChain.length ? ['-filter_complex', capChain.join(';'), '-map', prevLabel] : ['-map', '0:v']),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', ...quality, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out])
    const durationSec = Math.round(segs.reduce((a, s) => a + s.secs, 0) * 10) / 10
    const buf = await readFile(out)
    const url = await uploadToR2(`storyboard-${user.id}-${board.id}-stills-cut-${format}-${Date.now()}.mp4`, buf, 'video/mp4')
    // The poster: the first shot's picture, at the cut's size
    const first = order[0]
    const poster = await sharp((await prepStill(stillBufs.get(first.stillUrl ?? first.beforeUrl!)!, W, H, 1)).file).resize(W, H, { fit: 'cover' }).jpeg({ quality: 84 }).toBuffer()
    const posterUrl = await uploadPublicAsset(`thumbnails/stills-cut-${crypto.randomUUID()}.jpg`, poster, 'image/jpeg')
    const row = await prisma.generatedImage.create({
      data: {
        userId: user.id, imageUrl: url, model: 'storyboard-final-cut', ticketCost: 0,
        prompt: `Stills cut (${format}${body.captions === true ? ', captions' : ''}${useClips ? ', with clips' : ''}) of "${board.title}" - ${order.length} shots`.slice(0, 4000),
        referenceImageUrls: order.map(s => s.stillUrl).filter((u): u is string => !!u).slice(0, 40),
        folderId: await boardFolder(user.id, board.title),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
        quality: '1080p', aspectRatio: format === 'card' ? '4:3' : format === 'social' ? '9:16' : format === 'wide' ? '16:9' : board.aspect,
        videoMetadata: { isVideo: true, duration: String(Math.round(durationSec)), thumbnailUrl: posterUrl },
      },
    })
    return jsonPrivate({ url, durationSec, imageId: row.id, posterUrl, width: W, height: H })
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err).slice(-400)
    console.error('[stills-cut] failed:', msg)
    if (charged) await refundGenerationTickets(user.id, user.email, charged)
    return jsonPrivate({ error: `The cut failed: ${msg}` }, { status: 500 })
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
