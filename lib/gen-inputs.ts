/*
 * What a generation was given - its INPUTS - kept with the job so its
 * "generating…" tile (and the finished item) can show them (2026-10-21,
 * owner: "the start frame and end frame in the generating tile popup shows
 * as empty. Each model takes different inputs, so each model should have a
 * separate layout displaying the inputs").
 *
 * The record is taken from what was actually SENT (the submit body), so the
 * popup shows exactly what the model got: the start frame a SeeDance S tag
 * picked, Kling 4.0's references and elements, a tool's source clip, lip
 * sync's video and voice... Which of them a model uses - and what each is
 * called for it - is the page's per-model layout (portal-v2 videoInputGroups).
 *
 * Client-safe (no server imports): the page and the routes share it.
 */

export type GenInputVideo = {
  /** start frame / character picture / a single image */
  imageUrl?: string
  endImageUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  /** a tool's source clip, the clip an extend continues, Omni's video to edit */
  editVideoUrl?: string
  motionVideoUrl?: string
  lipsyncVideoUrl?: string
  lipsyncAudioUrl?: string
  /** an uploaded track (audio-driven models) */
  audioUrl?: string
  klingElements?: { frontal: string; views: string[] }[]
  /** SeeDance / Omni: which run it became (t2v / i2v / r2v / edit) */
  mode?: string
  /** Mureka Lyrics Video: the song it was made from */
  song?: { url: string; name: string }
}

const URL_RE = /^https:\/\//
const url = (u: unknown): string | undefined => (typeof u === 'string' && URL_RE.test(u) ? u : undefined)
const urls = (v: unknown, max = 12): string[] | undefined => {
  const out = (Array.isArray(v) ? v : []).map(url).filter((u): u is string => !!u).slice(0, max)
  return out.length ? out : undefined
}

/** The inputs out of a /api/video/generate (or Higgsfield video-submit) body - empty fields left out. */
export function videoInputsFromBody(b: Record<string, unknown> | null | undefined): GenInputVideo {
  if (!b) return {}
  const els = (Array.isArray(b.klingElements) ? b.klingElements : [])
    .map((e: any) => ({ frontal: url(e?.frontal), views: urls(e?.views, 3) ?? [] }))
    .filter((e): e is { frontal: string; views: string[] } => !!e.frontal)
    .slice(0, 4)
  const out: GenInputVideo = {
    imageUrl: url(b.imageUrl), endImageUrl: url(b.endImageUrl),
    referenceImageUrls: urls(b.referenceImageUrls), referenceVideoUrls: urls(b.referenceVideoUrls, 5), referenceAudioUrls: urls(b.referenceAudioUrls, 3),
    editVideoUrl: url(b.editVideoUrl), motionVideoUrl: url(b.motionVideoUrl),
    lipsyncVideoUrl: url(b.lipsyncVideoUrl), lipsyncAudioUrl: url(b.lipsyncAudioUrl), audioUrl: url(b.audioUrl),
    ...(els.length ? { klingElements: els } : {}),
    ...(typeof b.sd20Mode === 'string' ? { mode: b.sd20Mode.slice(0, 8) } : {}),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as GenInputVideo
}

/** Every link in a record (for an ownership check). */
export function videoInputLinks(i: GenInputVideo): string[] {
  return [
    i.imageUrl, i.endImageUrl, ...(i.referenceImageUrls ?? []), ...(i.referenceVideoUrls ?? []), ...(i.referenceAudioUrls ?? []),
    i.editVideoUrl, i.motionVideoUrl, i.lipsyncVideoUrl, i.lipsyncAudioUrl, i.audioUrl, i.song?.url,
    ...(i.klingElements ?? []).flatMap(e => [e.frontal, ...e.views]),
  ].filter((u): u is string => !!u)
}

/** The record with only the links `keep` allows (the server keeps the account's own - they come back signed). */
export function keepVideoInputs(i: GenInputVideo, keep: (u: string) => boolean): GenInputVideo {
  const one = (u?: string) => (u && keep(u) ? u : undefined)
  const many = (l?: string[]) => { const k = (l ?? []).filter(keep); return k.length ? k : undefined }
  const els = (i.klingElements ?? []).filter(e => keep(e.frontal)).map(e => ({ frontal: e.frontal, views: e.views.filter(keep) }))
  const out: GenInputVideo = {
    imageUrl: one(i.imageUrl), endImageUrl: one(i.endImageUrl),
    referenceImageUrls: many(i.referenceImageUrls), referenceVideoUrls: many(i.referenceVideoUrls), referenceAudioUrls: many(i.referenceAudioUrls),
    editVideoUrl: one(i.editVideoUrl), motionVideoUrl: one(i.motionVideoUrl),
    lipsyncVideoUrl: one(i.lipsyncVideoUrl), lipsyncAudioUrl: one(i.lipsyncAudioUrl), audioUrl: one(i.audioUrl),
    ...(els.length ? { klingElements: els } : {}),
    ...(i.mode ? { mode: i.mode } : {}),
    ...(i.song && keep(i.song.url) ? { song: i.song } : {}),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as GenInputVideo
}

// ── The popup's layout: labelled groups of media ────────────────────────────

export type GenInputKind = 'image' | 'video' | 'audio'
export type GenInputItem = { url: string; kind: GenInputKind; tag?: string }
export type GenInputGroup = { label: string; items: GenInputItem[]; note?: string }

export const img = (u: string, tag?: string): GenInputItem => ({ url: u, kind: 'image', ...(tag ? { tag } : {}) })
export const vid = (u: string, tag?: string): GenInputItem => ({ url: u, kind: 'video', ...(tag ? { tag } : {}) })
export const aud = (u: string, tag?: string): GenInputItem => ({ url: u, kind: 'audio', ...(tag ? { tag } : {}) })
/** A link's kind by its file name (pictures by default). */
export const kindOfUrl = (u: string): GenInputKind => {
  const p = u.split('?')[0].toLowerCase()
  return /\.(mp4|webm|mov|m4v)$/.test(p) ? 'video' : /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/.test(p) ? 'audio' : 'image'
}
