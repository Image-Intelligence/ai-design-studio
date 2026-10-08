import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { enforceContentFilter } from '@/lib/content-filter'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { canonicalisePayload } from '@/lib/media-url'
import { fal } from '@/lib/fal-client'
import { jsonPrivate } from '@/lib/api-json'
import { AUDIO_MODEL_PREFIX, audioTicketCost, getAudioStudioModel, type AudioRunInput } from '@/lib/audio-studio'
import { requireOwnMediaUnlessVerified } from '@/lib/id-verification'

/**
 * POST /api/audio/generate - submit an Audio Studio run (public since 2026-10-02).
 *
 * Body: { model, text?, lyrics?, style?, voice?, voice2?, language?, duration?,
 *         instrumental?, audioUrl?, voiceConsent? }
 * Returns: { success, requestId, ticketCost }
 *
 * The run is submitted to fal's queue and tracked by a GenerationQueue row
 * with status 'audio-processing' (modelType 'audio'). That status is its own
 * on purpose: the image/video machinery counts 'processing' rows against the
 * global fal slots and its cron only knows how to settle images and videos, so
 * an audio row in 'processing' would sit there forever holding a slot. The
 * row is what /api/audio/status settles against - ownership, the price and
 * the prompt come from it, never from the client - and flipping its status is
 * what makes settling and refunding happen exactly once.
 *
 * Pricing is lib/audio-studio's audioTicketCost, the same function the portal
 * shows the price with. Input-audio tools are priced from the uploaded clip's
 * length as MEASURED here (ffmpeg on the signed URL) - the browser's own
 * reading is only used to show the price before submitting.
 *
 * Voice cloning (models whose input `clonesVoice`) needs `voiceConsent: true`:
 * the user's confirmation that they own the voice or have the speaker's
 * permission. Public users can upload anyone's recording, so this is enforced
 * here as well as by the checkbox.
 */
export const maxDuration = 60

/** The uploaded file's name, when the client sends it (for naming tool runs). */
const params_fileName = (body: any) => (typeof body?.audioName === 'string' ? body.audioName.trim().slice(0, 120) : '')

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user?.email) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const body = canonicalisePayload(await req.json().catch(() => ({})))
    // A voice track / song to work from is an upload unless it is one of the
    // account's own generations (CCBill: uploads need a verified account;
    // admins exempt - lib/id-verification)
    const idGate = await requireOwnMediaUnlessVerified(user, [body?.audioUrl])
    if (idGate) return idGate
    const spec = getAudioStudioModel(String(body?.model ?? ''))
    if (!spec) return jsonPrivate({ error: 'Unknown audio model' }, { status: 400 })

    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    // Only the fields this model has: a tool with no text box must not pick up
    // text left over from the last model (it would become the saved prompt)
    const input: AudioRunInput = {
      text: spec.text ? str(body.text, spec.text.max) : '',
      lyrics: spec.lyrics ? str(body.lyrics, spec.lyrics.max) || undefined : undefined,
      style: spec.style ? str(body.style, 2000) || undefined : undefined,
      voice: str(body.voice, 200) || undefined,
      voice2: str(body.voice2, 200) || undefined,
      language: str(body.language, 100) || undefined,
      instrumental: body.instrumental === true,
      audioUrl: str(body.audioUrl, 2000) || undefined,
    }
    if (spec.duration) {
      const d = Number(body.duration)
      input.duration = Number.isFinite(d) ? Math.min(spec.duration.max, Math.max(spec.duration.min, d)) : spec.duration.default
      if (spec.duration.options) input.duration = spec.duration.options.reduce((a, b) => Math.abs(b - input.duration!) < Math.abs(a - input.duration!) ? b : a)
    }
    // The model's own pickers (Mureka's vocal, genre, layout...): only values it lists
    if (spec.options) {
      const sent = body.options && typeof body.options === 'object' ? body.options as Record<string, unknown> : {}
      input.options = Object.fromEntries(spec.options.map(o => {
        const v = typeof sent[o.key] === 'string' ? sent[o.key] as string : o.default
        return [o.key, o.values.some(([val]) => val === v) ? v : o.default]
      }))
    }
    // Only the options the model offers; anything else falls back to its default
    if (spec.voices && input.voice && !spec.voices.options.includes(input.voice)) input.voice = spec.voices.default
    if (spec.voice2 && input.voice2 && !spec.voice2.options.includes(input.voice2)) input.voice2 = spec.voice2.default
    if (spec.languages && input.language && !spec.languages.options.includes(input.language)) input.language = spec.languages.default

    // Required inputs
    if (spec.text?.required && !input.text) return jsonPrivate({ error: `${spec.text.label} is required` }, { status: 400 })
    if (spec.lyrics?.required && !input.lyrics) return jsonPrivate({ error: 'Lyrics are required for this model' }, { status: 400 })
    // Admin-only models (under test) are refused for everyone else, whatever the client sent
    if (spec.admin) {
      const { checkIsAdmin } = await import('@/lib/admin-check')
      if (!(await checkIsAdmin(user.email))) return jsonPrivate({ error: 'Admin only' }, { status: 403 })
    }
    if (spec.audioIn?.required && !input.audioUrl) return jsonPrivate({ error: `${spec.audioIn.label} is required` }, { status: 400 })
    // Made from one of the user's own Mureka songs (Lyrics Video): its Mureka
    // id comes from that song's feed row, never from the client
    let sourceSong: { id: number; prompt: string } | null = null
    if (spec.fromSong) {
      const songId = parseInt(String(body.songAssetId ?? ''))
      const row = Number.isFinite(songId) ? await prisma.generatedImage.findFirst({
        where: { id: songId, userId: user.id, isDeleted: false, model: { startsWith: `${AUDIO_MODEL_PREFIX}mureka-` } },
        select: { id: true, prompt: true, videoMetadata: true },
      }) : null
      const meta = row?.videoMetadata as { murekaSongId?: unknown; durationMs?: unknown } | null
      const murekaId = meta?.murekaSongId
      if (!row || typeof murekaId !== 'string') return jsonPrivate({ error: 'Pick one of your Mureka songs to make this from' }, { status: 400 })
      // The video covers the whole song, so its length is needed (saved with every Mureka result)
      if (typeof meta?.durationMs !== 'number' || meta.durationMs < 1000) return jsonPrivate({ error: 'This song has no length on record, so it cannot be made into a lyrics video' }, { status: 400 })
      input.sourceSongId = murekaId
      input.sourceSongMs = meta.durationMs
      sourceSong = { id: row.id, prompt: row.prompt }
    }
    const invalid = spec.validate?.(input)
    if (invalid) return jsonPrivate({ error: invalid }, { status: 400 })
    if (input.audioUrl && !/^https:\/\//.test(input.audioUrl)) return jsonPrivate({ error: 'Invalid audio URL' }, { status: 400 })

    if (spec.audioIn?.clonesVoice && input.audioUrl && body.voiceConsent !== true) {
      return jsonPrivate({ error: 'Confirm that you own this voice or have the speaker’s permission to clone it.' }, { status: 400 })
    }

    let inputSeconds: number | undefined
    if (spec.audioIn && input.audioUrl) {
      // Measured, not taken from the browser - the tools are billed on it
      const { probeRemoteMediaSeconds } = await import('@/lib/video-probe')
      const s = await probeRemoteMediaSeconds(input.audioUrl).catch(() => null)
      if (!s) return jsonPrivate({ error: 'Could not read that audio file - try an MP3, WAV or M4A.' }, { status: 400 })
      const cap = spec.audioIn.maxMinutes * 60
      if (s > cap + 1) return jsonPrivate({ error: `That recording is too long - ${spec.audioIn.maxMinutes} minutes at most` }, { status: 400 })
      inputSeconds = Math.min(s, cap)
    }

    const promptText = [input.text, input.lyrics, input.style].filter(Boolean).join('\n')
    const filter = await enforceContentFilter(promptText, user.email)
    if (!filter.ok) return jsonPrivate({ error: filter.reason }, { status: 400 })

    const ticketCost = audioTicketCost(spec, {
      chars: (input.text?.length ?? 0) + (input.lyrics?.length ?? 0),
      seconds: input.duration,
      inputSeconds,
    })
    const charge = await deductGenerationTickets(user.id, user.email, ticketCost)
    if (!charge.ok) return jsonPrivate({ error: `Insufficient tickets. Need ${charge.need}, you have ${charge.have}.` }, { status: 402 })

    const falInput = spec.build(input)
    let requestId: string
    try {
      const sub = await fal.queue.submit(spec.endpoint, { input: falInput })
      requestId = sub.request_id
    } catch (e: any) {
      await refundGenerationTickets(user.id, user.email, ticketCost)
      const detail = e?.body?.detail
      const msg = Array.isArray(detail) ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ') : typeof detail === 'string' ? detail : e?.message
      return jsonPrivate({ error: msg ? `The model rejected this request: ${msg}` : 'Could not start the generation' }, { status: 502 })
    }

    await prisma.generationQueue.create({
      data: {
        userId: user.id,
        modelId: `${AUDIO_MODEL_PREFIX}${spec.id}`,
        modelType: 'audio',
        // A tool run with no text is named after its model and the file it worked on
        prompt: (sourceSong
          ? `${spec.name}${input.text ? ` · ${input.text}` : ''} · ${sourceSong.prompt}`
          : input.text || input.lyrics || (params_fileName(body) ? `${spec.name} · ${params_fileName(body)}` : spec.name)).slice(0, 5000),
        parameters: {
          falEndpoint: spec.endpoint,
          falInput: falInput as object,
          voice: input.voice ?? null,
          voice2: input.voice2 ?? null,
          duration: input.duration ?? null,
          inputSeconds: inputSeconds ?? null,
          audioUrl: input.audioUrl ?? null,
          options: input.options ?? null,
          sourceSongAssetId: sourceSong?.id ?? null,
          chargeMode: 'deduct',
        },
        status: 'audio-processing',
        ticketCost,
        falRequestId: requestId,
        startedAt: new Date(),
      },
    })

    // charged: what actually left the balance (admins are not charged)
    return jsonPrivate({ success: true, requestId, ticketCost, charged: charge.newBalance === -1 ? 0 : ticketCost })
  } catch (error: any) {
    console.error('audio generate error:', error)
    return jsonPrivate({ error: 'Server error' }, { status: 500 })
  }
}
