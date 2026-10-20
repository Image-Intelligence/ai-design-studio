import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { requireNovaUser } from '@/lib/nova/auth'
import { requireIdVerified } from '@/lib/id-verification'
import { canonicalMediaUrl, isOurMedia, signMediaUrl } from '@/lib/media-url'
import { probeRemoteMediaSeconds } from '@/lib/video-probe'
import { readChatState } from '@/lib/nova/agent-tools'

/**
 * POST /api/nova/uploads { url, name?, chatId? } - a file the user uploaded
 * from their device becomes an item Nova can work with (2026-10-19, owner:
 * "uploads in the chat").
 *
 * The browser uploads straight to storage first (/api/upload-video-media/
 * presign - Vercel refuses big request bodies); this then files the upload as
 * a My Generations row (model "nova-upload", free) in the chat's folder and
 * answers with its id, so the composer attaches it like a library pick and
 * Nova refers to it by #id.
 *
 * Gated like every upload on the site: ID-verified accounts only (admins
 * exempt - lib/id-verification). Only the caller's OWN fresh upload is
 * accepted: the presign route names every file admin-upload-<userId>-...
 */
export const runtime = 'nodejs'

const KIND: Record<string, 'image' | 'video' | 'audio'> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
}

export async function POST(req: Request) {
  const a = await requireNovaUser()
  if (!a.ok) return a.res
  const idGate = await requireIdVerified(a.user)
  if (idGate) return idGate
  const body = await req.json().catch(() => ({})) as { url?: unknown; name?: unknown; chatId?: unknown }
  const url = typeof body.url === 'string' ? body.url : ''
  if (!url || !isOurMedia(url)) return jsonPrivate({ error: 'Upload the file first' }, { status: 400 })
  const key = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  if (!key.startsWith(`admin-upload-${a.user.id}-`)) return jsonPrivate({ error: 'That is not your upload' }, { status: 403 })
  const ext = (/\.([a-z0-9]+)$/i.exec(key)?.[1] ?? '').toLowerCase()
  const kind = KIND[ext]
  if (!kind) return jsonPrivate({ error: 'Images, videos and audio only' }, { status: 400 })
  const stored = canonicalMediaUrl(url.split('?')[0])
  // One row per upload, even if the page asks twice
  const existing = await prisma.generatedImage.findFirst({ where: { userId: a.user.id, imageUrl: stored, isDeleted: false }, select: { id: true } })
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  let folderId: number | null = null
  const chatId = Number(body.chatId)
  if (Number.isInteger(chatId) && chatId > 0) {
    const chat = await prisma.chat.findFirst({ where: { id: chatId, userId: a.user.id, source: 'nova' }, select: { skills: true } })
    folderId = readChatState(chat?.skills).folderId
  }
  const seconds = kind === 'image' ? null : await probeRemoteMediaSeconds(signMediaUrl(stored)).catch(() => null)
  const row = existing ?? await prisma.generatedImage.create({
    data: {
      userId: a.user.id, prompt: `Uploaded${name ? `: ${name}` : ''}`, imageUrl: stored,
      // Sound is "audio:" (how the library tells it apart); clips carry isVideo
      model: kind === 'audio' ? 'audio:nova-upload' : 'nova-upload', ticketCost: 0, referenceImageUrls: [],
      expiresAt: new Date(Date.now() + 100 * 365 * 864e5), folderId,
      ...(kind !== 'image' ? { videoMetadata: { ...(kind === 'video' ? { isVideo: true } : { isAudio: true }), ...(seconds ? { duration: String(Math.round(seconds * 10) / 10) } : {}), upload: true } } : {}),
    },
    select: { id: true },
  })
  return jsonPrivate({ id: row.id, kind, url: signMediaUrl(stored) })
}
