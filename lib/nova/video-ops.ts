/**
 * Nova Studio - frame and loop work on a finished clip (server only, 2026-10-19).
 *
 * The owner asked why Nova's loops and multi-shot pieces were not as clean as
 * the ones made with Claude Code on the project. Two things Claude did with
 * ffmpeg that Nova could not:
 *  1. pull a frame out of a clip - the LAST frame of shot N becomes the start
 *     frame of shot N+1, the main trick for continuity between shots;
 *  2. look at a loop's seam (the last frame against the first) and repair it:
 *     cross-fade the tail into the head, cut at the two frames that match
 *     best, or play it forward and back (ping-pong).
 *
 * The seam is measured, not guessed: frames are sampled at 8 fps as 32x32
 * greyscale, and the jump from the last frame to the first is compared with
 * the clip's own typical frame-to-frame change. A jump no bigger than an
 * ordinary step reads as seamless; three times bigger is a visible pop.
 *
 * ffmpeg-static runs in-process (as in lib/nova/media-inspect and
 * /api/video/assemble). Nothing here writes to storage - the tool layer saves.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
import { fetchMedia } from '@/lib/media-fetch'

const exec = promisify(execFile)
const TIMEOUT_MS = 120_000
const SIG_FPS = 8
const SIG_SIDE = 32

export type ClipProbe = { seconds: number; width: number; height: number; fps: number; hasAudio: boolean }

async function ffmpeg(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath as string, ['-hide_banner', ...args], { timeout: TIMEOUT_MS, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = { stdout: stdout as Buffer, stderr: String(stderr ?? '') }
      if (err && !(stdout as Buffer)?.length && !/Duration:/.test(out.stderr)) reject(Object.assign(err, out))
      else resolve(out)
    })
  })
}

async function probe(file: string): Promise<ClipProbe> {
  const { stderr } = await exec(ffmpegPath as string, ['-hide_banner', '-i', file]).catch((e: any) => ({ stderr: String(e?.stderr ?? '') }))
  const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr)
  const v = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
  const f = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
  return {
    seconds: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0,
    width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0,
    fps: f ? Number(f[1]) : 24,
    hasAudio: /Stream #\d+:\d+.*?: Audio:/i.test(stderr),
  }
}

/** Download a clip to a temp dir and run `fn` on it; the dir is always removed. */
export async function withClip<T>(url: string, fn: (file: string, dir: string, p: ClipProbe) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-vops-'))
  try {
    const ext = (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.exec(url)?.[1] ?? 'mp4').toLowerCase()
    const file = path.join(dir, `in.${ext}`)
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`Could not read the clip (${res.status})`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    const p = await probe(file)
    if (!p.width || !p.seconds) throw new Error('That file has no readable video')
    return await fn(file, dir, p)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * One full-resolution frame as PNG. 'last' decodes the tail instead of
 * seeking: a seek on the container's end (often longer than the picture when
 * the audio runs on) lands after the last frame and writes nothing.
 */
export async function stillAt(file: string, dir: string, p: ClipProbe, at: 'first' | 'middle' | 'last' | number): Promise<{ png: Buffer; atSec: number }> {
  const out = path.join(dir, `still-${Date.now()}.png`)
  const t = at === 'first' ? 0 : at === 'middle' ? p.seconds / 2 : at === 'last' ? Math.max(0, p.seconds - 0.05) : Math.max(0, Math.min(p.seconds - 0.05, at))
  if (at === 'last') {
    await ffmpeg(['-y', '-sseof', '-1.5', '-i', file, '-update', '1', '-frames:v', '9999', out]).catch(() => null)
  } else {
    await ffmpeg(['-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', out]).catch(() => null)
  }
  const ok = await stat(out).then(s => s.size > 0, () => false)
  if (!ok) throw new Error('Could not read that frame')
  return { png: await readFile(out), atSec: Math.round(t * 100) / 100 }
}

/** The clip as tiny greyscale frames at SIG_FPS - the material every seam measurement works on. */
async function signature(file: string): Promise<Uint8Array[]> {
  const { stdout } = await ffmpeg(['-i', file, '-an', '-vf', `fps=${SIG_FPS},scale=${SIG_SIDE}:${SIG_SIDE}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'])
  const n = SIG_SIDE * SIG_SIDE
  const frames: Uint8Array[] = []
  for (let i = 0; i + n <= stdout.length; i += n) frames.push(new Uint8Array(stdout.subarray(i, i + n)))
  return frames
}

/** How different two signature frames are: 0 (same) to 1. */
const diff = (a: Uint8Array, b: Uint8Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / (a.length * 255) }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

export type SeamReport = {
  /** The jump from the last frame back to the first, 0-1. */
  jump: number
  /** The clip's ordinary frame-to-frame change at the same sampling. */
  typicalStep: number
  /** jump / typicalStep: about 1 = seamless, 3+ = a visible pop. */
  ratio: number
  verdict: 'seamless' | 'slight' | 'visible'
}

function seamOf(frames: Uint8Array[]): SeamReport {
  if (frames.length < 4) return { jump: 0, typicalStep: 0, ratio: 1, verdict: 'seamless' }
  const steps = frames.slice(1).map((f, i) => diff(frames[i], f))
  const typicalStep = Math.max(0.002, median(steps))
  const jump = diff(frames[frames.length - 1], frames[0])
  const ratio = jump / typicalStep
  return { jump: Math.round(jump * 1000) / 1000, typicalStep: Math.round(typicalStep * 1000) / 1000, ratio: Math.round(ratio * 10) / 10, verdict: ratio <= 1.6 ? 'seamless' : ratio <= 3 ? 'slight' : 'visible' }
}

export async function measureSeam(file: string): Promise<SeamReport> {
  return seamOf(await signature(file))
}

/**
 * The best place to cut a loop: a start in the first quarter and an end in the
 * last 45% whose frames match most closely, keeping at least 60% of the clip.
 */
async function bestCut(file: string, p: ClipProbe, minSec?: number): Promise<{ start: number; end: number; match: number }> {
  const f = await signature(file)
  if (f.length < 8) return { start: 0, end: p.seconds, match: 1 }
  let best = { i: 0, j: f.length - 1, d: Infinity }
  // At least 60% of the clip - or the length asked for (2026-10-19 test: a 5s request came out 3s)
  const minLen = Math.min(f.length - 2, Math.max(Math.floor(f.length * 0.6), Math.ceil((minSec ?? 0) * SIG_FPS)))
  for (let i = 0; i <= Math.floor(f.length * 0.25); i++) {
    for (let j = Math.max(i + minLen, Math.floor(f.length * 0.55)); j < f.length; j++) {
      // Loop plays ... j-1 -> i: frame j (the first one dropped) should look like frame i
      if (j - i < minLen) continue
      const d = diff(f[j], f[i])
      if (d < best.d) best = { i, j, d }
    }
  }
  // Asked for (nearly) the whole clip: no cut fits - keep it all (the blend still joins the ends)
  if (!Number.isFinite(best.d)) best = { i: 0, j: f.length - 1, d: diff(f[f.length - 1], f[0]) }
  return { start: best.i / SIG_FPS, end: Math.min(p.seconds, best.j / SIG_FPS), match: Math.round((1 - best.d) * 1000) / 1000 }
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
const AUDIO = ['-c:a', 'aac', '-b:a', '160k']

export type LoopMethod = 'crossfade' | 'best_cut' | 'pingpong'

/**
 * Make a seamless loop of a clip.
 *  - crossfade: the last `blend` seconds dissolve into the first ones, so the
 *    end flows into the start (the output is `blend` shorter). Works on any
 *    motion; best when the start and end are already close.
 *  - best_cut: trim to the two most alike frames (then a short cross-fade).
 *    Best for repeating motion (waves, flames, a spinning object).
 *  - pingpong: forward, then backward. Only for motion with no direction
 *    (breathing, a gentle sway) - smoke rising or water flowing would run
 *    backwards. Picture only (backwards sound is wrong); at most 10 seconds.
 */
export async function makeLoop(file: string, dir: string, p: ClipProbe, method: LoopMethod, blendSec?: number, minSec?: number): Promise<{ mp4: Buffer; seconds: number; note: string; before: SeamReport; after: SeamReport }> {
  const before = await measureSeam(file)
  const out = path.join(dir, `loop-${method}.mp4`)
  let note = ''
  const crossfade = async (src: string, s0: number, s1: number, blend: number, hasAudio: boolean, dst: string) => {
    // Kept part [s0, s1]: the middle plays, then the tail dissolves into the head
    const L = s1 - s0
    const D = Math.min(Math.max(0.2, blend), L / 3)
    const fps = Math.round(p.fps) || 24
    const v = `[0:v]fps=${fps},settb=AVTB,split=3[a][b][c];`
      + `[a]trim=start=${(s0 + D).toFixed(3)}:end=${(s1 - D).toFixed(3)},setpts=PTS-STARTPTS[mid];`
      + `[b]trim=start=${(s1 - D).toFixed(3)}:end=${s1.toFixed(3)},setpts=PTS-STARTPTS[tail];`
      + `[c]trim=start=${s0.toFixed(3)}:end=${(s0 + D).toFixed(3)},setpts=PTS-STARTPTS[head];`
      + `[tail][head]xfade=transition=fade:duration=${D.toFixed(3)}:offset=0[blend];`
      + `[mid][blend]concat=n=2:v=1:a=0,format=yuv420p[v]`
    const a = hasAudio
      ? `;[0:a]asplit=3[x][y][z];`
        + `[x]atrim=start=${(s0 + D).toFixed(3)}:end=${(s1 - D).toFixed(3)},asetpts=PTS-STARTPTS[amid];`
        + `[y]atrim=start=${(s1 - D).toFixed(3)}:end=${s1.toFixed(3)},asetpts=PTS-STARTPTS[atail];`
        + `[z]atrim=start=${s0.toFixed(3)}:end=${(s0 + D).toFixed(3)},asetpts=PTS-STARTPTS[ahead];`
        + `[atail][ahead]acrossfade=d=${D.toFixed(3)}:c1=tri:c2=tri[ablend];`
        + `[amid][ablend]concat=n=2:v=0:a=1[aout]`
      : ''
    await ffmpeg(['-y', '-i', src, '-filter_complex', v + a, '-map', '[v]', ...(hasAudio ? ['-map', '[aout]', ...AUDIO] : ['-an']), ...ENCODE, dst])
    return { seconds: L - D, D }
  }

  let seconds = p.seconds
  if (method === 'crossfade') {
    const r = await crossfade(file, 0, p.seconds, blendSec ?? 0.8, p.hasAudio, out)
    seconds = r.seconds
    note = `Cross-faded the last ${r.D.toFixed(2)}s into the start`
  } else if (method === 'best_cut') {
    const c = await bestCut(file, p, minSec)
    const r = await crossfade(file, c.start, c.end, blendSec ?? 0.3, p.hasAudio, out)
    seconds = r.seconds
    note = `Cut at ${c.start.toFixed(2)}s-${c.end.toFixed(2)}s (frames ${Math.round(c.match * 100)}% alike) with a ${r.D.toFixed(2)}s blend`
  } else {
    if (p.seconds > 10.5) throw new Error('Ping-pong works on clips up to 10 seconds - use crossfade or best_cut')
    // Scaled to at most 1280 on the long side: reverse holds every frame in memory
    const scale = Math.max(p.width, p.height) > 1280 ? (p.width >= p.height ? 'scale=1280:-2,' : 'scale=-2:1280,') : ''
    const fps = Math.round(p.fps) || 24
    // The reversed half drops its first and last frames, so no frame shows twice at the turns
    await ffmpeg(['-y', '-i', file, '-filter_complex', `[0:v]${scale}fps=${fps},split[f][r];[r]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[rv];[rv]trim=end_frame=${Math.max(1, Math.round(p.seconds * fps) - 2)},setpts=PTS-STARTPTS[rv2];[f][rv2]concat=n=2:v=1:a=0,format=yuv420p[v]`, '-map', '[v]', '-an', ...ENCODE, out])
    seconds = p.seconds * 2
    note = 'Forward then backward (the sound was left out - played backwards it is wrong)'
  }
  const ok = await stat(out).then(s => s.size > 0, () => false)
  if (!ok) throw new Error('The loop could not be made')
  const after = await measureSeam(out)
  const real = await probe(out)
  return { mp4: await readFile(out), seconds: Math.round((real.seconds || seconds) * 100) / 100, note, before, after }
}

/** An audio file padded with silence to at least `minSec` (lip-sync models refuse lines under 5s). */
export async function padAudio(url: string, minSec: number): Promise<{ mp3: Buffer; seconds: number; padded: number } | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-pad-'))
  try {
    const src = path.join(dir, 'in')
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    await writeFile(src, Buffer.from(await res.arrayBuffer()))
    const p = await probe(src)
    if (!p.seconds || p.seconds >= minSec) return null
    const out = path.join(dir, 'out.mp3')
    await ffmpeg(['-y', '-i', src, '-af', `apad=whole_dur=${minSec.toFixed(2)}`, '-c:a', 'libmp3lame', '-b:a', '192k', out])
    return { mp3: await readFile(out), seconds: minSec, padded: Math.round((minSec - p.seconds) * 100) / 100 }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** The frames either side of a loop's seam (the end, then the start), for the model to look at. */
export async function seamFrames(file: string, dir: string, p: ClipProbe): Promise<Buffer[]> {
  const a = await stillAt(file, dir, p, 'last').catch(() => null)
  const b = await stillAt(file, dir, p, 'first').catch(() => null)
  return [a?.png, b?.png].filter((x): x is Buffer => !!x)
}

/**
 * A clip as Gemini can WATCH it (2026-10-19, owner): a small copy - 480p,
 * low bitrate, sound kept, at most `maxSec` - inlined in the request, so the
 * critic and the continuity check see the motion (a face that morphs, judder,
 * a seam, lips against the words) instead of three still frames. Gemini
 * prices video by its length (~300 tokens a second with sound), not its size.
 * null when the file cannot be read or stays too big to inline.
 */
const INLINE_MAX_BYTES = 14 * 1024 * 1024
export async function watchableVideo(url: string, maxSec = 30): Promise<{ mime: 'video/mp4'; data: string; seconds: number } | null> {
  try {
    return await withClip(url, async (file, dir, p) => {
      const out = path.join(dir, 'watch.mp4')
      const scale = p.width >= p.height ? 'scale=-2:480' : 'scale=480:-2'
      await ffmpeg(['-y', '-i', file, '-t', String(maxSec), '-vf', `${scale},fps=24`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', ...(p.hasAudio ? ['-c:a', 'aac', '-b:a', '64k'] : ['-an']), '-movflags', '+faststart', out])
      const buf = await readFile(out).catch(() => null)
      if (!buf?.length || buf.length > INLINE_MAX_BYTES) return null
      return { mime: 'video/mp4' as const, data: buf.toString('base64'), seconds: Math.min(maxSec, p.seconds) }
    })
  } catch { return null }
}

// ── Post-production (2026-10-19, owner: trims, overlays, colour matching) ────

/** Any media file (video OR audio) downloaded to a temp dir; `p.width` is 0 for audio. */
export async function withMedia<T>(url: string, fn: (file: string, dir: string, p: ClipProbe) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-media-'))
  try {
    const ext = (/\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|opus|flac)(\?|#|$)/i.exec(url)?.[1] ?? 'mp4').toLowerCase()
    const file = path.join(dir, `in.${ext}`)
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`Could not read the file (${res.status})`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    const p = await probe(file)
    if (!p.seconds) throw new Error('That file could not be read')
    return await fn(file, dir, p)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export type TrimOpts = { start?: number; end?: number; speed?: number; mute?: boolean; fadeIn?: number; fadeOut?: number; gainDb?: number; normalize?: boolean }

/**
 * Trim / speed / mute / fade / level one clip or audio file - the small,
 * exact jobs that used to need a whole recut (cutting the silence a lip-sync
 * pad left, a clip a beat too long, a line too quiet).
 */
export async function trimMedia(file: string, dir: string, p: ClipProbe, o: TrimOpts): Promise<{ buf: Buffer; seconds: number; mime: string; done: string[] }> {
  const isVideo = p.width > 0
  const start = Math.max(0, Math.min(p.seconds - 0.1, Number(o.start) || 0))
  const end = o.end && o.end > start ? Math.min(p.seconds, o.end) : p.seconds
  const speed = Math.min(4, Math.max(0.25, Number(o.speed) || 1))
  const len = (end - start) / speed
  const done: string[] = []
  if (start > 0 || end < p.seconds) done.push(`kept ${start.toFixed(2)}s-${end.toFixed(2)}s`)
  const vf: string[] = []
  const af: string[] = []
  if (speed !== 1) {
    vf.push(`setpts=PTS/${speed}`)
    // atempo takes 0.5-2 per stage
    let r = speed
    const stages: number[] = []
    while (r > 2) { stages.push(2); r /= 2 }
    while (r < 0.5) { stages.push(0.5); r /= 0.5 }
    stages.push(r)
    af.push(...stages.map(x => `atempo=${x.toFixed(4)}`))
    done.push(`speed x${speed}`)
  }
  const fi = Math.max(0, Math.min(len / 2, Number(o.fadeIn) || 0)), fo = Math.max(0, Math.min(len / 2, Number(o.fadeOut) || 0))
  if (fi) { vf.push(`fade=t=in:st=0:d=${fi.toFixed(2)}`); af.push(`afade=t=in:st=0:d=${fi.toFixed(2)}`); done.push(`fade in ${fi}s`) }
  if (fo) { vf.push(`fade=t=out:st=${(len - fo).toFixed(2)}:d=${fo.toFixed(2)}`); af.push(`afade=t=out:st=${(len - fo).toFixed(2)}:d=${fo.toFixed(2)}`); done.push(`fade out ${fo}s`) }
  if (o.normalize) { af.push('loudnorm=I=-16:TP=-1.5:LRA=11'); done.push('levelled to -16 LUFS') }
  else if (o.gainDb) { af.push(`volume=${Math.max(-30, Math.min(20, Number(o.gainDb)))}dB`); done.push(`${o.gainDb > 0 ? '+' : ''}${o.gainDb} dB`) }
  const mute = !!o.mute && isVideo
  if (mute) done.push('sound removed')
  const out = path.join(dir, isVideo ? 'trim.mp4' : 'trim.mp3')
  const args = ['-y', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', file]
  if (isVideo) {
    args.push(...(vf.length ? ['-vf', [...vf, 'format=yuv420p'].join(',')] : []), ...ENCODE)
    if (mute || !p.hasAudio) args.push('-an')
    else args.push(...(af.length ? ['-af', af.join(',')] : []), ...AUDIO)
  } else {
    args.push('-vn', ...(af.length ? ['-af', af.join(',')] : []), '-c:a', 'libmp3lame', '-b:a', '192k')
  }
  await ffmpeg([...args, out])
  const buf = await readFile(out).catch(() => null)
  if (!buf?.length) throw new Error('The edit could not be made')
  const real = await probe(out)
  return { buf, seconds: Math.round((real.seconds || len) * 100) / 100, mime: isVideo ? 'video/mp4' : 'audio/mpeg', done: done.length ? done : ['re-encoded'] }
}

/** A clip's colour: the mean and spread of R, G, B over three frames (for matching shots to each other). */
export async function colourStats(url: string): Promise<{ mean: [number, number, number]; std: [number, number, number] } | null> {
  try {
    return await withClip(url, async (file, dir, p) => {
      const sharp = (await import('sharp')).default
      const acc = { mean: [0, 0, 0], std: [0, 0, 0], n: 0 }
      for (const at of [p.seconds * 0.2, p.seconds * 0.5, p.seconds * 0.8]) {
        const f = await stillAt(file, dir, p, at).catch(() => null)
        if (!f) continue
        const st = await sharp(f.png).resize(160, 160, { fit: 'inside' }).removeAlpha().stats()
        st.channels.slice(0, 3).forEach((c, k) => { acc.mean[k] += c.mean; acc.std[k] += c.stdev })
        acc.n++
      }
      if (!acc.n) return null
      return { mean: acc.mean.map(v => v / acc.n) as [number, number, number], std: acc.std.map(v => v / acc.n) as [number, number, number] }
    })
  } catch { return null }
}

/** The ffmpeg filter that moves one clip's colour toward a reference (gentle: gains and contrast are clamped). */
export function matchFilter(clip: { mean: number[]; std: number[] }, ref: { mean: number[]; std: number[] }): string | null {
  const gain = [0, 1, 2].map(k => Math.min(1.25, Math.max(0.8, (ref.mean[k] + 1) / (clip.mean[k] + 1))))
  const lum = (v: number[]) => 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]
  const contrast = Math.min(1.2, Math.max(0.85, (lum(ref.std) + 1) / (lum(clip.std) + 1)))
  if (gain.every(g => Math.abs(g - 1) < 0.03) && Math.abs(contrast - 1) < 0.03) return null
  return `colorchannelmixer=rr=${gain[0].toFixed(3)}:gg=${gain[1].toFixed(3)}:bb=${gain[2].toFixed(3)},eq=contrast=${contrast.toFixed(3)}`
}

/** A finishing look for the whole cut. */
export const LOOKS: Record<string, string> = {
  warm: 'colorbalance=rs=0.06:gs=0.01:bs=-0.06:rm=0.04:bm=-0.04,eq=saturation=1.06',
  cool: 'colorbalance=rs=-0.05:bs=0.06:rm=-0.03:bm=0.05,eq=saturation=1.02',
  filmic: 'curves=preset=medium_contrast,colorbalance=rs=0.03:bs=-0.03:rh=0.02:bh=-0.02,eq=saturation=0.92',
  vivid: 'eq=saturation=1.25:contrast=1.06',
  muted: 'eq=saturation=0.78:contrast=0.96',
  bw: 'hue=s=0,eq=contrast=1.1',
}

/** Re-encode a clip through a filter (colour match / look). */
export async function filterClip(file: string, dir: string, p: ClipProbe, vf: string, name = 'graded.mp4'): Promise<Buffer> {
  const out = path.join(dir, name)
  await ffmpeg(['-y', '-i', file, '-vf', `${vf},format=yuv420p`, ...ENCODE, ...(p.hasAudio ? ['-c:a', 'copy'] : ['-an']), out])
  const buf = await readFile(out).catch(() => null)
  if (!buf?.length) throw new Error('The colour pass failed')
  return buf
}

/**
 * Titles, lower thirds and logos over a video: each layer is a transparent PNG
 * the size of the frame (drawn by lib/nova/image-edit), shown from `start` to
 * `end` with a short fade - plus an optional finishing look over everything.
 */
export async function overlayLayers(file: string, dir: string, p: ClipProbe, layers: { png: Buffer; start: number; end: number; fade: number }[], look?: string): Promise<Buffer> {
  const inputs: string[] = []
  const chain: string[] = []
  let last = '0:v'
  const fps = Math.round(p.fps) || 24
  if (look && LOOKS[look]) { chain.push(`[0:v]${LOOKS[look]}[lk]`); last = 'lk' }
  for (const [k, l] of layers.entries()) {
    const f = path.join(dir, `layer${k}.png`)
    await writeFile(f, l.png)
    inputs.push('-loop', '1', '-framerate', String(fps), '-i', f)
    const s = Math.max(0, l.start), e = Math.max(s + 0.2, Math.min(p.seconds, l.end)), fd = Math.min(l.fade, (e - s) / 3)
    chain.push(`[${k + 1}:v]format=rgba,${fd > 0 ? `fade=t=in:st=${s.toFixed(2)}:d=${fd.toFixed(2)}:alpha=1,fade=t=out:st=${(e - fd).toFixed(2)}:d=${fd.toFixed(2)}:alpha=1,` : ''}setpts=PTS-STARTPTS[o${k}]`)
    chain.push(`[${last}][o${k}]overlay=0:0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})':shortest=1[v${k}]`)
    last = `v${k}`
  }
  if (!chain.length) throw new Error('Nothing to add')
  const out = path.join(dir, 'overlaid.mp4')
  await ffmpeg(['-y', '-i', file, ...inputs, '-filter_complex', chain.join(';'), '-map', `[${last}]`, ...(p.hasAudio ? ['-map', '0:a', '-c:a', 'copy'] : ['-an']), ...ENCODE, '-t', p.seconds.toFixed(3), out])
  const buf = await readFile(out).catch(() => null)
  if (!buf?.length) throw new Error('The overlays could not be added')
  return buf
}
