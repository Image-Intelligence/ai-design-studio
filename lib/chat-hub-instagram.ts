// Instagram publishing connector (server-only) — Instagram API with Instagram
// Login (graph.instagram.com), professional account, dev-mode Meta app.
// Container flow: POST /{ig-user-id}/media → (reels: poll status) →
// POST /{ig-user-id}/media_publish → fetch permalink.
//
// Credentials live in ChatProviderKey (provider 'instagram') as an encrypted
// JSON blob {accessToken, igUserId} — same AES-256-GCM as the LLM keys.
// Long-lived tokens last 60 days; error code 190 = expired/invalid → the UI
// tells the owner to reconnect in Providers → Connectors.

import prisma from '@/lib/prisma'
import { decryptKey } from '@/lib/chat-key-crypto'
import { uploadToR2 } from '@/lib/r2'

const IG_GRAPH = 'https://graph.instagram.com/v23.0'

export type IgCreds = { accessToken: string; igUserId: string }

export async function loadInstagramCreds(userId: number): Promise<IgCreds | null> {
  try {
    const row = await prisma.chatProviderKey.findUnique({
      where: { userId_provider: { userId, provider: 'instagram' } },
      select: { encrypted: true },
    })
    if (!row) return null
    const plain = decryptKey(row.encrypted)
    if (!plain) return null
    const parsed = JSON.parse(plain)
    if (typeof parsed?.accessToken !== 'string' || typeof parsed?.igUserId !== 'string') return null
    return { accessToken: parsed.accessToken, igUserId: parsed.igUserId }
  } catch {
    return null
  }
}

// Pull the human-readable error out of a Graph API response body
function igError(body: any, fallback: string): string {
  const err = body?.error
  if (!err) return fallback
  const msg = String(err.message ?? fallback).slice(0, 300)
  if (err.code === 190) {
    return 'Instagram token expired or invalid — reconnect in Profile → Chat Settings → Providers → Instagram.'
  }
  return `Instagram error${err.code ? ` (code ${err.code})` : ''}: ${msg}`
}

async function igFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body }
}

export async function igMe(creds: IgCreds): Promise<{ username: string; userId: string } | { error: string }> {
  const { ok, body } = await igFetch(
    `${IG_GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(creds.accessToken)}`
  )
  if (!ok) return { error: igError(body, 'Could not verify the Instagram connection') }
  return { username: String(body.username ?? ''), userId: String(body.user_id ?? body.id ?? '') }
}

// Instagram feed images must be JPEG with aspect ratio between 4:5 (0.8) and
// 1.91:1. Anything else gets converted + padded to the nearest legal aspect
// and re-hosted on R2 (IG fetches media from public URLs).
async function normalizeImageForInstagram(imageUrl: string): Promise<{ url: string } | { error: string }> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return { error: `Could not fetch the image (${res.status})` }
    const input = Buffer.from(await res.arrayBuffer())
    const sharp = (await import('sharp')).default
    const meta = await sharp(input).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (!w || !h) return { error: 'Could not read the image dimensions' }
    const aspect = w / h
    const isJpeg = meta.format === 'jpeg'
    const legal = aspect >= 0.8 && aspect <= 1.91
    if (isJpeg && legal && input.length <= 8 * 1024 * 1024) return { url: imageUrl }

    let img = sharp(input)
    if (!legal) {
      // Pad (not crop) to the nearest legal aspect — never destroy composition
      const target = aspect < 0.8 ? 0.8 : 1.91
      const bg = { r: 10, g: 10, b: 14 }
      if (aspect < target) {
        const newW = Math.ceil(h * target)
        const padX = Math.ceil((newW - w) / 2)
        img = img.extend({ left: padX, right: padX, background: bg })
      } else {
        const newH = Math.ceil(w / target)
        const padY = Math.ceil((newH - h) / 2)
        img = img.extend({ top: padY, bottom: padY, background: bg })
      }
    }
    const out = await img.jpeg({ quality: 90 }).toBuffer()
    const key = `chat-hub/ig-publish/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const url = await uploadToR2(key, out, 'image/jpeg')
    return { url }
  } catch (err: any) {
    return { error: `Image normalization failed: ${String(err?.message || err).slice(0, 150)}` }
  }
}

async function publishContainer(
  creds: IgCreds,
  containerId: string,
): Promise<{ permalink: string; mediaId: string } | { error: string }> {
  const pub = await igFetch(`${IG_GRAPH}/${creds.igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: creds.accessToken }),
  })
  if (!pub.ok || !pub.body?.id) return { error: igError(pub.body, 'Publishing the container failed') }
  const mediaId = String(pub.body.id)
  const perma = await igFetch(
    `${IG_GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(creds.accessToken)}`
  )
  return { permalink: String(perma.body?.permalink ?? ''), mediaId }
}

export async function publishImage(
  creds: IgCreds,
  { imageUrl, caption }: { imageUrl: string; caption: string },
): Promise<{ permalink: string; mediaId: string } | { error: string }> {
  const normalized = await normalizeImageForInstagram(imageUrl)
  if ('error' in normalized) return normalized
  const container = await igFetch(`${IG_GRAPH}/${creds.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: normalized.url, caption, access_token: creds.accessToken }),
  })
  if (!container.ok || !container.body?.id) return { error: igError(container.body, 'Creating the media container failed') }
  return publishContainer(creds, String(container.body.id))
}

export async function publishReel(
  creds: IgCreds,
  { videoUrl, caption }: { videoUrl: string; caption: string },
): Promise<{ permalink: string; mediaId: string } | { error: string }> {
  const container = await igFetch(`${IG_GRAPH}/${creds.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption, access_token: creds.accessToken }),
  })
  if (!container.ok || !container.body?.id) return { error: igError(container.body, 'Creating the reel container failed') }
  const containerId = String(container.body.id)

  // Reels process asynchronously — poll until FINISHED (or ~2 min timeout)
  const deadline = Date.now() + 120_000
  for (;;) {
    await new Promise(r => setTimeout(r, 4000))
    const status = await igFetch(
      `${IG_GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(creds.accessToken)}`
    )
    const code = String(status.body?.status_code ?? '')
    if (code === 'FINISHED') break
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { error: igError(status.body, `Instagram could not process the video (status ${code}) — check it is MP4/MOV, 3s-15min`) }
    }
    if (Date.now() > deadline) {
      return { error: 'Timed out waiting for Instagram to process the video (~2 min). It may still finish — check the account before retrying to avoid a duplicate post.' }
    }
  }
  return publishContainer(creds, containerId)
}
