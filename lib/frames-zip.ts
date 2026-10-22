import { uploadToR2 } from '@/lib/r2'

/**
 * A run's Frames ZIP (Wan 2.2 Animate's return_frames_zip, 2026-10-22): every
 * frame as a lossless image, which fal hands back beside the video. fal's
 * links expire, so it is copied to our storage like the video is - up to the
 * size the 3D pipeline re-hosts (lib/threed/pipeline). A bigger or unreachable
 * one keeps fal's link rather than losing it.
 */
const MAX_FRAMES_ZIP_BYTES = 220 * 1024 * 1024

export async function keepFramesZip(data: unknown): Promise<{ url: string; bytes: number | null } | null> {
  const f = (data as { frames_zip?: { url?: unknown; file_size?: unknown } } | null)?.frames_zip
  const falUrl = typeof f?.url === 'string' ? f.url : null
  if (!falUrl) return null
  const fallback = { url: falUrl, bytes: typeof f?.file_size === 'number' ? f.file_size : null }
  try {
    const res = await fetch(falUrl, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) return fallback
    if (Number(res.headers.get('content-length') ?? 0) > MAX_FRAMES_ZIP_BYTES) return fallback
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_FRAMES_ZIP_BYTES) return fallback
    const url = await uploadToR2(`video-frames-${Date.now()}.zip`, buf, 'application/zip')
    return { url, bytes: buf.length }
  } catch (e) {
    console.error('[frames-zip] copy failed (keeping fal link):', e)
    return fallback
  }
}
