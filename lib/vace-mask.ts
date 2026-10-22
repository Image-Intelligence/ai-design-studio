import { execFile } from 'node:child_process'
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
  const frame = await firstFrame(videoUrl)
  const frameUrl = await fal.storage.upload(new Blob([new Uint8Array(frame)], { type: 'image/png' }))
  const out: any = await fal.subscribe('fal-ai/sam-3-1/image', {
    input: {
      image_url: frameUrl, prompt: VACE_SUBJECTS[subject] ?? 'person',
      return_multiple_masks: true, max_masks: 8, apply_mask: false, output_format: 'png', sync_mode: false,
    } as any,
  })
  const urls: string[] = [...(out?.data?.masks ?? []), ...(out?.data?.masks?.length ? [] : [out?.data?.image])].map((m: any) => m?.url).filter(Boolean)
  // The largest one - the main subject, not someone in the background
  let best: { buf: Buffer; area: number } | null = null
  for (const u of urls) {
    const r = await fetch(u)
    if (!r.ok) continue
    const buf = Buffer.from(await r.arrayBuffer())
    const px = await sharp(buf).greyscale().raw().toBuffer()
    let area = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] > 127) area++
    if (area > 0 && (!best || area > best.area)) best = { buf, area }
  }
  if (!best) return null
  // Grown ~1.5% of the frame's width so edges, hair and loose clothing are inside it
  const meta = await sharp(best.buf).metadata()
  const grow = Math.max(3, Math.round((meta.width ?? 800) * 0.015)) | 1
  const mask = await sharp(best.buf).greyscale().blur(grow / 2).threshold(16).png().toBuffer()
  return fal.storage.upload(new Blob([new Uint8Array(mask)], { type: 'image/png' }))
}
