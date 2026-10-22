/**
 * Nova Studio - what Nova may generate with (server only).
 *
 * The catalog is only what Nova is TOLD about; the site's own routes stay the
 * authority on who may run what (/api/generate and /api/video/generate refuse
 * an admin-only model, /api/audio/generate and submitThreeD check their own
 * flags) and on the price. So a model wrongly listed here fails cleanly, it
 * cannot leak.
 *
 * Left out on purpose:
 *  - the image models the hub runs through the raw Gemini API (`geminiApi`):
 *    that path skips /api/generate's gate and billing;
 *  - audio models that need an uploaded recording (voice changers, cloning) -
 *    Nova has no upload of its own, and cloning needs the user's consent;
 *  - 3D tools that work on an existing mesh (Nova makes models, it does not
 *    take files in).
 */
import { usableCreateModels, computeCreateCost, resolveCreateSettings, type ChatCreateModel, type CreateField } from '@/lib/chat-hub-models'
import { getFalImageModelSpec } from '@/lib/fal-image-models'
import { UPSCALER_FACTORS } from '@/lib/chat-image-catalog'
import { novaVideoTool, NOVA_VIDEO_TOOLS } from '@/lib/nova/video-tools'
import { imageModelOpen } from '@/lib/storyboard-access'
import { ADMIN_ONLY_VIDEO_MODELS } from '@/lib/fal-video-endpoints'
import { AUDIO_STUDIO_MODELS, audioTicketCost, type AudioStudioModel } from '@/lib/audio-studio'
import { THREED_TOOLS, toolTickets, type ThreeDTool } from '@/lib/threed/catalog'
import { modelNote } from '@/lib/nova/model-notes'

export type NovaKind = 'image' | 'video' | 'audio' | '3d'

/*
 * Settings for image models that have none in the shared catalog (2026-10-18).
 *
 * The catalog generated from AI_MODELS (lib/chat-image-catalog) carries no
 * fields, so Nova could not ask NanoBanana 2.1 - the site's main model - for a
 * square, got its default shape, judged it wrong and paid for a second image
 * on another model. Every image model takes the portal's aspect + quality
 * (/api/generate maps both per model), so they are filled in here: the shapes
 * the model's own fal spec lists, else the portal's common set.
 */
const COMMON_ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9']
function withImageFields(m: ChatCreateModel): ChatCreateModel {
  // An upscaler's only setting is its factor - no shape, no quality
  if (m.fields?.some(f => f.key === 'aspect' || f.key === 'factor')) return m
  const spec = getFalImageModelSpec(m.id)
  const listed = (spec?.aspectRatios ?? []).filter(a => /^\d+:\d+$/.test(a))
  const aspects = listed.length ? listed : COMMON_ASPECTS
  return {
    ...m,
    fields: [
      ...(m.fields ?? []),
      { key: 'aspect', label: 'AR', options: aspects, def: aspects.includes('1:1') ? '1:1' : aspects[0] },
      // MOSS Image has no quality: the aspect picks one of its <=1MP sizes (lib/ticket-pricing mossSize)
      ...(m.fields?.some(f => f.key === 'quality') || m.id === 'moss-image' ? [] : [{ key: 'quality', label: 'Quality', options: ['1k', '2k', '4k'], def: '2k' }]),
    ] as CreateField[],
  }
}

/** "-edit" twins are picked by the site itself when references are attached - listing them twice only costs context. */
const isEditTwin = (id: string) => id.endsWith('-edit') && !!getFalImageModelSpec(id.slice(0, -5))?.editVariant

/*
 * Image models the agents cannot run (2026-10-20, found through the ChatGPT
 * connector: "ChatGPT Images 2.0 couldn't run through the studio
 * integration"). Every agent generation goes through /api/generate
 * (lib/chat-image-submit) with the user's key, but the portal sends these to
 * routes of their own (/api/admin/gpt-image-2-stream, kling-image-submit,
 * kling-o3-submit, seedream-5-lite-submit, seedream-5-pro-submit,
 * recraft-submit, wan-27-pro-submit), which take a browser session only -
 * /api/generate answers "not available" (or, for GPT Image 2, "runs from the
 * image page"). FIXED the same day: those routes take the key now and
 * lib/dedicated-image-submit maps agent requests onto them - this set stays
 * for any model that cannot run through the agents (none today).
 */
export const AGENT_UNRUNNABLE_IMAGE_MODELS = new Set<string>([])

export function novaImageModels(isAdmin: boolean): ChatCreateModel[] {
  return usableCreateModels(isAdmin).filter(m => m.kind === 'image' && !m.disabled && !m.geminiApi && !isEditTwin(m.id) && !AGENT_UNRUNNABLE_IMAGE_MODELS.has(m.id) && imageModelOpen(m.id, isAdmin)).map(withImageFields)
}

/** A picture TOOL (cut-out, upscale, vectorize, try-on...): it works on a picture and makes nothing from a prompt alone. */
export const needsPicture = (id: string) => !!getFalImageModelSpec(id)?.needsImage || !!UPSCALER_FACTORS[id]
/*
 * Video TOOLS that work on an existing clip (upscale, edit, extend, relight,
 * subtitles, dubbing, lip sync...): generate_video only sends pictures, so they
 * would fail - and listing ~40 of them only costs context. Left out until Nova
 * has a video-in tool of its own. `-reference` (2026-10-22): Kling O3's
 * video-to-video reference needs a source clip too - it was offered to
 * generate_video and failed; it runs through use_video_tool now.
 */
const VIDEO_IN_TOOL = /upscale|vsr|seedvr|topaz|modify|reframe|-edit|-reference|extend|relight|subtitles|translate|sfx|removal|depth|insert|recast|lipsync|animate-replace|animate-move|dreamactor|lucy|camera|music-video|omnihuman|interpolate|deblur|sdr-to-hdr/

export function novaVideoModels(isAdmin: boolean): ChatCreateModel[] {
  return usableCreateModels(isAdmin).filter(m => m.kind === 'video' && !m.disabled && !VIDEO_IN_TOOL.test(m.id) && !novaVideoTool(m.id) && (isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has(m.id)))
}
export function novaAudioModels(isAdmin: boolean): AudioStudioModel[] {
  // Models that need a recording (or a video) in are included since 2026-10-20 - generate_audio takes input_id
  return AUDIO_STUDIO_MODELS.filter(m => (isAdmin || !m.admin) && !m.hidden && !m.fromSong && !m.outputVideo)
}
export function novaThreeDTools(isAdmin: boolean): ThreeDTool[] {
  return THREED_TOOLS.filter(t => (isAdmin || !t.admin) && !t.needs.mesh)
}

const clip = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * The models the user NAMED in their request (2026-10-20, owner: "I clearly
 * asked for Pixelcut Looping Video (360 spin) and Prism used PixVerse").
 * Names are matched with spaces and punctuation ignored ("pixel cut looping
 * video" = "Pixelcut Looping Video"); the longest names win, so "Kling V3
 * Motion" is not also read as "Kling V3". Short or generic names (Soul, Pika)
 * need the whole word. The turn's instructions then say to use exactly these.
 */
export function namedModels(text: string, isAdmin: boolean): { id: string; label: string; via: string }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '')
  const hay = norm(text)
  if (!hay) return []
  const cands: { id: string; label: string; via: string }[] = [
    ...novaImageModels(isAdmin).map(m => ({ id: m.id, label: m.label, via: 'generate_image' })),
    ...novaVideoModels(isAdmin).map(m => ({ id: m.id, label: m.label, via: 'generate_video' })),
    ...NOVA_VIDEO_TOOLS.filter(t => isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has(t.id)).map(t => ({ id: t.id, label: t.label, via: 'use_video_tool' })),
    // The portal's own names where a tool's label differs
    ...(isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has('kling-v3-motion') ? [{ id: 'kling-v3-motion', label: 'Kling V3 Motion', via: 'use_video_tool' }] : []),
    ...novaAudioModels(isAdmin).map(m => ({ id: m.id, label: m.name, via: 'generate_audio' })),
  ].filter(c => norm(c.label).length >= 4)
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9.]+/g, ' ')} `
  const hits = cands
    .filter(c => (norm(c.label).length >= 8 ? hay.includes(norm(c.label)) : words.includes(` ${c.label.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()} `)))
    .sort((a, b) => norm(b.label).length - norm(a.label).length)
  const out: typeof hits = []
  for (const h of hits) if (!out.some(o => norm(o.label).includes(norm(h.label)))) out.push(h)
  return out.slice(0, 4)
}

/**
 * The catalog of one kind, for the model (asked per kind, so the system prompt
 * stays small). Without `search` it is a COMPACT list - id, price, refs and a
 * one-line strength - because whatever a tool returns is re-sent on every
 * later step of the turn: the full listing with every setting was ~7k tokens
 * per kind. With `search`, the matching models (at most 6) come back in full,
 * settings included.
 */
export function describeModels(kind: NovaKind, isAdmin: boolean, search?: string): string {
  const q = (search ?? '').trim().toLowerCase()
  const hit = (...xs: (string | undefined)[]) => !q || xs.some(x => (x ?? '').toLowerCase().includes(q))
  const full = !!q
  const cap = full ? 6 : 200
  if (kind === 'image' || kind === 'video') {
    const list = (kind === 'image' ? novaImageModels(isAdmin) : novaVideoModels(isAdmin)).filter(m => hit(m.id, m.label, m.group)).slice(0, cap)
    const lines = list.map(m => {
      const refs = kind === 'image' && (m.needsRef || needsPicture(m.id)) ? 'TOOL - needs a picture to work on (pass it as a reference)' : m.needsRef ? `needs a start image${m.endFrame ? ' (+ end frame)' : ''}` : m.maxRefs ? `${m.maxRefs} refs${m.endFrame ? ', 2nd = end frame' : ''}` : 'no refs'
      if (!full) return `- ${m.id} · ${m.ticketCost}t · ${refs} · ${clip(m.strengths, 70)}`
      const fields = (m.fields ?? []).map(f => `${f.key}: ${f.options.join('|')} (default ${f.def})`).join('; ')
      const note = modelNote(m.id)
      return `- ${m.id} "${m.label}" · ${m.ticketCost} tickets at defaults · ${refs}${fields ? ` · settings {${fields}}` : ''} · ${clip(m.strengths, 400)}${note ? `
  STUDIO NOTES: ${note}` : ''}`
    })
    if (!full) lines.push("(t = tickets at default settings. Call browse_models with search=<id> for a model's exact settings before using one you have not checked.)")
    return lines.join('\n')
  }
  if (kind === 'audio') {
    return novaAudioModels(isAdmin).filter(m => hit(m.id, m.name, m.group)).slice(0, cap).map(m => {
      const price = audioTicketCost(m, { chars: 300, seconds: m.duration?.default ?? 30 })
      if (!full) return `- ${m.id} [${m.group}] · ~${price}t · ${clip(m.blurb, 70)}`
      const bits = [
        m.text ? `text: ${m.text.label}${m.text.required ? ' (required)' : ''}, max ${m.text.max} chars` : null,
        m.lyrics ? `lyrics${m.lyrics.required ? ' (required)' : ''}` : null,
        m.style ? `style: ${m.style.label}` : null,
        m.voices ? `voice: ${m.voices.options.slice(0, 16).join('|')} (default ${m.voices.default})` : null,
        m.duration ? `duration ${m.duration.min}-${m.duration.max}s (default ${m.duration.default})` : null,
        m.instrumental ? 'instrumental: true|false' : null,
      ].filter(Boolean).join('; ')
      return `- ${m.id} "${m.name}" [${m.group}] · ~${price} tickets typical · ${bits} · ${clip(m.blurb, 200)}${modelNote(m.id) ? `
  STUDIO NOTES: ${modelNote(m.id)}` : ''}`
    }).join('\n')
  }
  return novaThreeDTools(isAdmin).filter(t => hit(t.id, t.label, t.family)).slice(0, cap).map(t => {
    const imgs = t.needs.images ? `${t.needs.images.min}-${t.needs.images.max} images` : 'no images'
    const price = toolTickets(t, {}, t.needs.images?.min ?? 0)
    if (!full) return `- ${t.id} [${t.stage}] · ~${price}t · ${imgs} · ${clip(t.bestFor, 70)}`
    const ctrls = t.controls.filter(c => c.kind === 'select' && c.options?.length).map(c => `${c.key}: ${c.options!.map(o => o.value).join('|')}`).join('; ')
    return `- ${t.id} "${t.label}" [${t.stage}] · ~${price} tickets · prompt ${t.needs.prompt ?? 'none'} · ${imgs} · ~${t.minutes} min · ${clip(t.bestFor, 200)}${ctrls ? ` · options {${ctrls}}` : ''}`
  }).join('\n')
}

/** The estimated price of an image or video run, before the site route charges the real one. */
export function estimateCreate(m: ChatCreateModel, settings: unknown): { settings: ReturnType<typeof resolveCreateSettings>; tickets: number } {
  const s = resolveCreateSettings(m, settings)
  return { settings: s, tickets: computeCreateCost(m, s) }
}
