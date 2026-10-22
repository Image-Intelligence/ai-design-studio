import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { fal } from '@/lib/fal-client'
import { signMediaUrl } from '@/lib/media-url'

/*
 * Wan VACE's first-frame mask (2026-10-22). fal's plain-words VACE endpoint
 * (wan-vace-apps/video-edit) answered every run - fal's own example included -
 * with "Internal Server Error", so Wan VACE Video Edit runs on
 * wan-vace-14b/inpainting, which needs to be told WHAT to replace: a mask of
 * the subject on the first frame, which fal then tracks through the clip
 * ("salient mask tracking"). This makes that mask: the clip's first frame,
 * SAM 3.1 finding the subject by name ("person"), the largest one kept,
 * grown a little so hair and edges are covered. About $0.01 at fal.
 *
 * Callers need ffmpeg on Vercel: /api/video/generate is already in
 * next.config.ts outputFileTracingIncludes.
 */
const execP = promisify(execFile)

/** The subjects the panel offers (its `choice`), as SAM 3.1 is asked for them. */
export const VACE_SUBJECTS: Record<string, string> = { person: 'person', animal: 'animal', vehicle: 'vehicle' }

/** A clip's first frame as a PNG (a hair past 0 - some encoders put a black frame at 0). */
export async function firstFrame(videoUrl: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vace-'))
  try {
    const out = path.join(dir, 'f0.png')
    // A hair past 0: some encoders put a black frame at exactly 0
    await execP(ffmpegPath as string, ['-hide_banner', '-y', '-ss', '0.05', '-i', signMediaUrl(videoUrl, 600), '-frames:v', '1', out], { timeout: 45_000 })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The subject's mask on the clip's first frame, uploaded to fal's storage
 * (white = replace). Null when nothing of that kind is in the frame.
 */
export async function vaceSubjectMask(videoUrl: string, subject: string): Promise<string | null> {
  return subjectMask(videoUrl, [VACE_SUBJECTS[subject] ?? 'person'])
}

/**
 * The same mask for the first of `prompts` SAM 3.1 finds anything for - so a
 * caller can fall back from "person" to "figure" (MoCha, 2026-10-22: YOLO's
 * person class, and SAM's "person", both miss a wooden mannequin; "figure"
 * finds it). `coverAspect` is the landscape w/h a worker cover-crops the clip
 * to (portrait clips get its inverse): the mask is centre-cropped the same
 * way, since such a worker just resizes the mask it is given onto its frame.
 */
export async function subjectMask(videoUrl: string, prompts: string[], opts: { coverAspect?: number } = {}): Promise<string | null> {
  const frame = await firstFrame(videoUrl)
  const frameUrl = await fal.storage.upload(new Blob([new Uint8Array(frame)], { type: 'image/png' }))
  let best: { buf: Buffer; area: number } | null = null
  for (const prompt of prompts) {
    const out: any = await fal.subscribe('fal-ai/sam-3-1/image', {
      input: {
        image_url: frameUrl, prompt,
        return_multiple_masks: true, max_masks: 8, apply_mask: false, output_format: 'png', sync_mode: false,
      } as any,
    })
    const urls: string[] = [...(out?.data?.masks ?? []), ...(out?.data?.masks?.length ? [] : [out?.data?.image])].map((m: any) => m?.url).filter(Boolean)
    // The largest one - the main subject, not someone in the background
    for (const u of urls) {
      const r = await fetch(u)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      const px = await sharp(buf).greyscale().raw().toBuffer()
      let area = 0
      for (let i = 0; i < px.length; i += 4) if (px[i] > 127) area++
      if (area > 0 && (!best || area > best.area)) best = { buf, area }
    }
    if (best) break
  }
  if (!best) return null
  // Grown ~1.5% of the frame's width so edges, hair and loose clothing are inside it
  const meta = await sharp(best.buf).metadata()
  const grow = Math.max(3, Math.round((meta.width ?? 800) * 0.015)) | 1
  let img = sharp(best.buf).greyscale().blur(grow / 2).threshold(16)
  const w = meta.width ?? 0, h = meta.height ?? 0
  if (opts.coverAspect && w > 0 && h > 0) {
    const a = w >= h ? opts.coverAspect : 1 / opts.coverAspect
    // ffmpeg's scale=...:force_original_aspect_ratio=increase,crop=W:H keeps the centre
    const cw = Math.min(w, Math.round(h * a)), ch = Math.min(h, Math.round(w / a))
    img = img.extract({ left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch })
  }
  const mask = await img.png().toBuffer()
  return fal.storage.upload(new Blob([new Uint8Array(mask)], { type: 'image/png' }))
}

/**
 * The first of `prompts` SAM 3.1 finds anything for on a clip's first frame,
 * or null (H3 Character Swap's worker runs SAM itself, by that word - Relay's
 * own "person" misses a wooden mannequin; "figure" finds it). About $0.01 a try.
 */
export async function firstMatchingSubject(videoUrl: string, prompts: string[]): Promise<string | null> {
  const frame = await firstFrame(videoUrl)
  const frameUrl = await fal.storage.upload(new Blob([new Uint8Array(frame)], { type: 'image/png' }))
  for (const prompt of prompts) {
    const out: any = await fal.subscribe('fal-ai/sam-3-1/image', {
      input: { image_url: frameUrl, prompt, return_multiple_masks: true, max_masks: 1, apply_mask: false, output_format: 'png', sync_mode: false } as any,
    })
    if ((out?.data?.masks ?? []).some((m: any) => m?.url)) return prompt
  }
  return null
}

/**
 * How different a picture is from a clip's first frame: the mean absolute
 * difference of the two as 48x27 grey thumbnails (0-255). A frame of the clip
 * itself, even with a character painted in, comes out ~10; a separate
 * character picture ~80 (2026-10-22: H3 Character Swap given the clip's own
 * frame as its character returned the clip unchanged after a 34-minute run).
 */
export async function differenceFromFirstFrame(videoUrl: string, imageUrl: string): Promise<number> {
  const W = 48, H = 27
  const grey = (buf: Buffer) => sharp(buf).resize(W, H, { fit: 'cover' }).greyscale().raw().toBuffer()
  const frame = await firstFrame(videoUrl)
  const res = await fetch(signMediaUrl(imageUrl, 600), { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`picture ${res.status}`)
  const [a, b] = await Promise.all([grey(frame), grey(Buffer.from(await res.arrayBuffer()))])
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** ffmpeg with optional stdin, its stdout as a Buffer (raw frames in and out). */
function ffmpegPipe(args: string[], input?: Buffer, timeoutMs = 120_000): Promise<{ out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as string, ['-hide_banner', ...args])
    const out: Buffer[] = []
    let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')) }, timeoutMs)
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => { err += d.toString() })
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ out: Buffer.concat(out), err })
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
    })
    if (input) p.stdin.end(input)
    else p.stdin.end()
  })
}

/** A clip's frames as tiny greyscale pictures (w x h each), plus the clip's own size and rate. */
async function grayFrames(url: string, w: number): Promise<{ frames: Buffer[]; w: number; h: number; srcW: number; srcH: number; fps: number }> {
  // The size and rate first (ffmpeg prints the stream line for -i alone, then fails for want of an output)
  const info = await ffmpegPipe(['-i', url], undefined, 45_000).then(r => r.err, (e: Error) => e.message)
  const dims = /, (\d{2,5})x(\d{2,5})[, \[]/.exec(info)
  const fpsM = /, ([\d.]+) fps/.exec(info)
  const srcW = dims ? Number(dims[1]) : 1280, srcH = dims ? Number(dims[2]) : 720
  const fps = fpsM ? Number(fpsM[1]) : 24
  const h = Math.max(2, Math.round((w * srcH) / srcW / 2) * 2)
  const { out } = await ffmpegPipe(['-v', 'error', '-i', url, '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-'])
  const frames: Buffer[] = []
  for (let i = 0; i + w * h <= out.length; i += w * h) frames.push(out.subarray(i, i + w * h))
  return { frames, w, h, srcW, srcH, fps }
}

/** Longest clip Wan VACE renders whole: fal's inpainting caps num_frames at 241 (10 s at 24 fps). */
export const VACE_MAX_FRAMES = 241
export const VACE_MAX_FPS = 24
export const VACE_MAX_SEC = 10

/**
 * Wan VACE's inputs, made here (2026-10-22): the clip as VACE will render it,
 * with the subject GREYED OUT, plus its mask as a video.
 *
 * Why each step - the first version sent the untouched clip and the first
 * frame's exact outline (mask_image_url), and the owner's runs came back
 * "almost identical to the input":
 *  - fal's endpoint gives VACE the pixels INSIDE the mask too, and VACE keeps
 *    them: even a whole-frame mask returned the same car, restyled. Its own
 *    example clip has the masked box painted flat grey, as VACE replacement
 *    workflows do - so the masked area here is grey, and what fills it comes
 *    from the prompt and the reference pictures.
 *  - An exact outline forces the new subject into the old one's shape; a
 *    padded box filled the whole frame for a car crossing it. So the mask is
 *    SAM 3.1's tracked subject, grown and BLOCKIFIED (every grid block it
 *    touches - Kijai's BlockifyMask, the usual VACE swap mask), steadied over
 *    a few frames so it doesn't flicker.
 *  - fal renders at most 241 frames (a 14.9 s clip came back as 10.00 s), so
 *    the clip is cut to that at no more than 24 fps first - all 10 s survive -
 *    and SAM runs on that same cut, so mask and clip match frame for frame.
 * About $0.01 at fal for SAM. Null when SAM finds no such subject.
 */
export async function vacePrepare(videoUrl: string, subject: string): Promise<{ videoUrl: string; maskVideoUrl: string; seconds: number } | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vace-prep-'))
  try {
    const src = signMediaUrl(videoUrl, 3600)
    const info = await ffmpegPipe(['-i', src], undefined, 45_000).then(r => r.err, (e: Error) => e.message)
    const srcFps = Number(/, ([\d.]+) fps/.exec(info)?.[1]) || 24
    const fps = Math.min(VACE_MAX_FPS, srcFps)
    // The clip VACE renders: even sides, at most 24 fps, at most 241 frames, no sound
    const prep = path.join(dir, 'prep.mp4')
    await ffmpegPipe(['-v', 'error', '-y', '-i', src, '-an',
      '-vf', `${srcFps > VACE_MAX_FPS ? `fps=${VACE_MAX_FPS},` : ''}scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`,
      '-frames:v', String(VACE_MAX_FRAMES), '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', prep], undefined, 180_000)
    const prepUrl = await fal.storage.upload(new Blob([new Uint8Array(await readFile(prep))], { type: 'video/mp4' }))
    const sam: any = await fal.subscribe('fal-ai/sam-3-1/video', {
      input: { video_url: prepUrl, prompt: VACE_SUBJECTS[subject] ?? 'person', apply_mask: false, max_num_objects: 1 } as any,
    })
    const samUrl: string | undefined = sam?.data?.video?.url
    if (!samUrl) return null
    const W = 160
    const m = await grayFrames(samUrl, W)
    const s = await grayFrames(prep, 16)
    const n = s.frames.length
    if (!m.frames.length || !n) return null
    // Each frame as blocks of B x B cells (a 160-wide grid: 20 blocks across,
    // ~67 px each at 1344): a block is on when the subject, grown by G cells,
    // touches it. Null where SAM lost the subject.
    const B = 8, G = 2
    const bw = Math.ceil(W / B), bh = Math.ceil(m.h / B)
    const blocks: (Uint8Array | null)[] = m.frames.map(f => {
      const g = new Uint8Array(bw * bh)
      let any = false
      for (let y = 0; y < m.h; y++) for (let x = 0; x < W; x++) {
        if (f[y * W + x] <= 127) continue
        any = true
        for (let by = Math.floor(Math.max(0, y - G) / B); by <= Math.floor(Math.min(m.h - 1, y + G) / B); by++)
          for (let bx = Math.floor(Math.max(0, x - G) / B); bx <= Math.floor(Math.min(W - 1, x + G) / B); bx++) g[by * bw + bx] = 1
      }
      return any ? g : null
    })
    if (!blocks.some(Boolean)) return null
    // Frames where it was lost borrow the nearest found frame
    for (let i = 0; i < blocks.length; i++) if (!blocks[i]) {
      for (let d = 1; d < blocks.length; d++) {
        const b = blocks[i - d] ?? blocks[i + d]
        if (b) { blocks[i] = b; break }
      }
    }
    const frameBlocks = (i: number) => blocks[Math.max(0, Math.min(i, blocks.length - 1))]!
    const raw = Buffer.alloc(n * W * m.h)
    for (let i = 0; i < n; i++) {
      // Steadied: a block is on if it is on within 2 frames either side
      const on = new Uint8Array(bw * bh)
      for (let d = -2; d <= 2; d++) { const b = frameBlocks(i + d); for (let k = 0; k < on.length; k++) on[k] |= b[k] }
      const base = i * W * m.h
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        if (!on[by * bw + bx]) continue
        for (let y = by * B; y < Math.min(m.h, (by + 1) * B); y++) raw.fill(255, base + y * W + bx * B, base + y * W + Math.min(W, (bx + 1) * B))
      }
    }
    const size = `${s.srcW}x${s.srcH}`
    const mask = path.join(dir, 'mask.mp4')
    await ffmpegPipe(['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${m.h}`, '-r', String(fps), '-i', '-',
      '-vf', `scale=${s.srcW}:${s.srcH}:flags=neighbor,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', mask], raw, 180_000)
    // The clip with the masked blocks painted flat grey (maskedmerge: white = the grey frame)
    const grey = path.join(dir, 'grey.mp4')
    await ffmpegPipe(['-v', 'error', '-y', '-i', prep, '-i', mask, '-f', 'lavfi', '-i', `color=c=0x808080:s=${size}:r=${fps}`,
      '-filter_complex', '[0:v]format=gbrp[a];[2:v]format=gbrp[g];[1:v]format=gbrp[m];[a][g][m]maskedmerge,format=yuv420p[v]',
      '-map', '[v]', '-frames:v', String(n), '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', grey], undefined, 180_000)
    const [greyUrl, maskUrl] = await Promise.all([grey, mask].map(async f =>
      fal.storage.upload(new Blob([new Uint8Array(await readFile(f))], { type: 'video/mp4' }))))
    return { videoUrl: greyUrl, maskVideoUrl: maskUrl, seconds: n / fps }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

