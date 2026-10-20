/**
 * Nova Studio - look at and listen to finished media (server only, 2026-10-18).
 *
 * Nova judges its images by seeing them, but a video or an audio file was a
 * black box to it: it could not tell a clip whose motion went wrong, a music
 * bed that drowns the voice, or a render that fell silent half-way. This
 * reads a file the way a creative director would check it - a few frames
 * (first, middle, last by default), its length and size, and its loudness
 * (EBU R128 integrated LUFS + true peak, ffmpeg's max volume, silent stretches)
 * - and turns what matters into plain-language notes.
 *
 * ffprobe is not shipped with ffmpeg-static, so everything is read from
 * ffmpeg's own stderr (the same approach as app/api/video/assemble). Nothing
 * here throws for a bad file: the report says it could not be read.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { fetchMedia } from '@/lib/media-fetch'

const exec = promisify(execFile)
const FFMPEG_TIMEOUT_MS = 60_000
/** Short-form social video is mastered around here. */
const TARGET_LUFS = -14

export type MediaReport = {
  kind: 'video' | 'audio' | 'image'
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  loudness?: { integratedLufs: number | null; truePeakDb: number | null; maxVolumeDb: number | null }
  silences?: { startSec: number; endSec: number }[]
  frames?: { atSec: number; jpeg: Uint8Array }[]
  notes: string[]
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** ffmpeg's report (stderr) for a run; a non-zero exit still has a useful report. */
async function ffmpeg(args: string[]): Promise<string> {
  const r = await exec(ffmpegPath as string, ['-hide_banner', ...args], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    .catch((e: any) => ({ stderr: String(e?.stderr ?? ''), stdout: '' }))
  return String(r.stderr ?? '')
}

type Probe = { seconds: number; width: number; height: number; fps: number; hasAudio: boolean; hasVideo: boolean }

async function probe(file: string): Promise<Probe> {
  const stderr = await ffmpeg(['-i', file])
  const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr)
  const v = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
  const f = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
  return {
    seconds: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0,
    width: v ? Number(v[1]) : 0,
    height: v ? Number(v[2]) : 0,
    fps: f ? Number(f[1]) : 0,
    hasAudio: /Stream #\d+:\d+.*?: Audio:/i.test(stderr),
    hasVideo: !!v,
  }
}

/** Loudness and silences of the file's audio, in one ffmpeg pass. */
async function listen(file: string): Promise<{ loudness: NonNullable<MediaReport['loudness']>; silences: { startSec: number; endSec: number }[] }> {
  const stderr = await ffmpeg(['-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true,volumedetect,silencedetect=noise=-45dB:d=0.6', '-f', 'null', '-'])
  // ebur128 prints a running log and then a Summary block; read the summary
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
  const num = (re: RegExp, s: string) => { const m = re.exec(s); return m ? Number(m[1]) : null }
  const integrated = summary.includes('Summary:') ? num(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/, summary) : null
  const peak = summary.includes('Summary:') ? num(/Peak:\s*(-?\d+(?:\.\d+)?|-inf)\s*dBFS/, summary) : null
  const maxVol = num(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/, stderr)
  const silences: { startSec: number; endSec: number }[] = []
  const starts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map(m => Math.max(0, Number(m[1])))
  const ends = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))
  starts.forEach((s, i) => silences.push({ startSec: round(s, 2), endSec: round(ends[i] ?? NaN, 2) }))
  return {
    // ebur128 reports -70 LUFS for silence; keep it - a silent bed IS the finding
    loudness: { integratedLufs: integrated, truePeakDb: Number.isFinite(peak as number) ? peak : null, maxVolumeDb: maxVol },
    silences: silences.slice(0, 20),
  }
}

/** One frame at `at` seconds as a JPEG, longest side `side`. */
async function frameAt(file: string, at: number, side: number): Promise<Uint8Array | null> {
  try {
    const r = await new Promise<Buffer>((resolve, reject) => {
      execFile(ffmpegPath as string, ['-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
        { timeout: FFMPEG_TIMEOUT_MS, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => (err && !stdout?.length ? reject(err) : resolve(stdout as Buffer)))
    })
    if (!r.length) return null
    const jpg = await sharp(r).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    return new Uint8Array(jpg)
  } catch { return null }
}

function loudnessNotes(l: NonNullable<MediaReport['loudness']>, silences: MediaReport['silences'], duration: number): string[] {
  const notes: string[] = []
  const I = l.integratedLufs
  if (I !== null) {
    if (I <= -60) notes.push('The audio is silent')
    else if (I > TARGET_LUFS + 3) notes.push(`Loud: integrated ${round(I)} LUFS (social target about ${TARGET_LUFS})`)
    else if (I < TARGET_LUFS - 8) notes.push(`Quiet: integrated ${round(I)} LUFS (social target about ${TARGET_LUFS})`)
    else notes.push(`Loudness ${round(I)} LUFS - in a good range`)
  }
  if (l.truePeakDb !== null && l.truePeakDb > -1) notes.push(`Clipping risk: true peak ${round(l.truePeakDb)} dB (keep it under -1 dB)`)
  for (const s of silences ?? []) {
    if (!Number.isFinite(s.endSec)) { if (duration - s.startSec >= 0.6) notes.push(`Silent from ${round(s.startSec)}s to the end`) }
    else if (s.endSec - s.startSec >= 0.6) notes.push(`Silent from ${round(s.startSec)}s to ${round(s.endSec)}s`)
  }
  return notes
}

/**
 * Inspect one file. `kind` is what the caller believes it is (the feed row's
 * kind); a "video" that turns out to have no picture is reported as audio.
 */
export async function inspectMedia(
  url: string,
  kind: 'video' | 'audio' | 'image',
  /** at: exact frame times in seconds (overrides `frames`) - e.g. the middle of each shot of a cut. */
  opts: { frames?: number; maxFrameSide?: number; at?: number[] } = {},
): Promise<MediaReport> {
  if (kind === 'image') {
    try {
      const res = await fetchMedia(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return { kind, notes: ['Could not read this file'] }
      const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
      return { kind, width: m.width, height: m.height, notes: [] }
    } catch { return { kind, notes: ['Could not read this file'] } }
  }

  let dir: string | null = null
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'nova-inspect-'))
    const ext = (/\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|opus|flac)(\?|#|$)/i.exec(url)?.[1] ?? (kind === 'audio' ? 'mp3' : 'mp4')).toLowerCase()
    const file = path.join(dir, `in.${ext}`)
    const res = await fetchMedia(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) return { kind, notes: ['Could not read this file'] }
    await writeFile(file, Buffer.from(await res.arrayBuffer()))

    const p = await probe(file)
    if (!p.seconds && !p.hasVideo && !p.hasAudio) return { kind, notes: ['Could not read this file'] }
    const realKind: 'video' | 'audio' = p.hasVideo && kind === 'video' ? 'video' : 'audio'
    const report: MediaReport = { kind: realKind, durationSec: round(p.seconds, 2), notes: [] }
    if (p.seconds && p.seconds < 1.5) report.notes.push(`Very short: ${round(p.seconds)}s`)

    if (realKind === 'video') {
      Object.assign(report, { width: p.width, height: p.height, fps: p.fps || undefined, hasAudio: p.hasAudio })
      if (!p.hasAudio) report.notes.push('No audio track')
      // Frames spread over the clip: first (just past 0), middle, last (just before the end)
      const n = Math.min(8, Math.max(1, Math.round(opts.frames ?? 3)))
      const side = Math.min(1280, Math.max(160, Math.round(opts.maxFrameSide ?? 640)))
      const dur = Math.max(0.2, p.seconds)
      const times = opts.at?.length ? opts.at.filter(t => Number.isFinite(t)).map(t => Math.max(0, Math.min(dur - 0.05, t))).slice(0, 10) : n === 1 ? [dur / 2] : Array.from({ length: n }, (_, i) => {
        if (i === 0) return Math.min(0.1, dur / 4)
        if (i === n - 1) return Math.max(0, dur - 0.15)
        return (dur * i) / (n - 1)
      })
      const frames: { atSec: number; jpeg: Uint8Array }[] = []
      for (const t of times) {
        const jpeg = await frameAt(file, t, side)
        if (jpeg) frames.push({ atSec: round(t, 2), jpeg })
      }
      report.frames = frames
      if (!frames.length) report.notes.push('Could not read any frames')
    }

    if (p.hasAudio) {
      const heard = await listen(file)
      report.loudness = heard.loudness
      report.silences = heard.silences
      report.notes.push(...loudnessNotes(heard.loudness, heard.silences, p.seconds))
    } else if (realKind === 'audio') {
      report.notes.push('Could not read this file')
    }
    return report
  } catch {
    return { kind, notes: ['Could not read this file'] }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
