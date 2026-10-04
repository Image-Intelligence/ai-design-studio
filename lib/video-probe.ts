import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { signMediaUrl } from '@/lib/media-url'

/*
 * What a remote clip really is: its pixel size, frame rate and length.
 *
 * The video tools that fal bills by OUTPUT resolution, frame rate and length
 * (the Topaz suite, Flux Video Upscale) cannot be priced honestly from what
 * the browser reports - it does not send the size or frame rate at all, and
 * the length it sends is trusted. ffmpeg reads the clip's header straight off
 * the (signed) URL, so only the first few hundred KB are fetched.
 *
 * ffmpeg-static ships no ffprobe, so this reads `ffmpeg -i`'s own report
 * (which exits non-zero: no output was asked for). Any route importing this
 * must list ffmpeg-static in next.config.ts `outputFileTracingIncludes`.
 */
const execP = promisify(execFile)

export type VideoProbe = { width: number; height: number; fps: number; seconds: number }

/**
 * Length in seconds of any remote media file - audio included, which the
 * video probe below rejects for having no video stream. The Audio Studio
 * bills its tools by the INPUT's length, so it measures it here rather than
 * trusting the number the browser sends.
 */
export async function probeRemoteMediaSeconds(url: string, timeoutMs = 12_000): Promise<number | null> {
  let report = ''
  try {
    await execP(ffmpegPath as string, ['-hide_banner', '-i', signMediaUrl(url, 600)], { timeout: timeoutMs })
  } catch (e: any) {
    report = String(e?.stderr ?? '')
  }
  const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(report)
  if (!d) return null
  const s = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3])
  return s > 0 ? s : null
}

export async function probeRemoteVideo(url: string, timeoutMs = 12_000): Promise<VideoProbe | null> {
  let report = ''
  try {
    await execP(ffmpegPath as string, ['-hide_banner', '-i', signMediaUrl(url, 600)], { timeout: timeoutMs })
  } catch (e: any) {
    report = String(e?.stderr ?? '')
  }
  const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(report)
  const v = /Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(report)
  const f = /,\s*([\d.]+)\s*fps/.exec(report)
  if (!d || !v) return null
  return {
    seconds: (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]),
    width: Number(v[1]),
    height: Number(v[2]),
    fps: f ? parseFloat(f[1]) : 30,
  }
}

/**
 * Play a clip faster or slower WITHOUT re-encoding: every timestamp is scaled
 * by `scale` (0.5 = twice as fast). Used to put VOID's 12 fps output back at
 * its source's speed. Audio, if any, is dropped - it would no longer match.
 */
export async function retimeVideo(input: Buffer, scale: number): Promise<Buffer> {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'retime-'))
  try {
    const src = join(dir, 'in.mp4'), out = join(dir, 'out.mp4')
    await writeFile(src, input)
    await promisify(execFile)(ffmpegPath as unknown as string, [
      '-y', '-hide_banner', '-loglevel', 'error', '-itsscale', String(scale), '-i', src,
      '-an', '-c:v', 'copy', '-movflags', '+faststart', out,
    ], { timeout: 60_000, maxBuffer: 1 << 26 })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
