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
  song?: { url: string; name: string; id?: number }
  /**
   * The composer as it was set up for this run - model, prompt as typed, every
   * slot (the refs panel with its S/E tags, frames, clips, voice, elements,
   * song) and every knob - so Rescan puts the run back exactly (2026-10-21,
   * owner: the video popup's button only brought the prompt back). The
   * page's buildVideoDraft shape plus the model's own knobs; cleaned by
   * cleanRescan, its links kept only when the account owns them.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plain JSON (cleanRescan); `any` so it stores as Prisma Json
  rescan?: Record<string, any>
}

/*
 * A rescan snapshot is the client's own JSON, stored on the job and the
 * finished row: plain values only, bounded in depth, size and length.
 */
const RESCAN_MAX_BYTES = 48_000
function cleanValue(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.slice(0, 12_000)
  if (depth >= 4) return undefined
  if (Array.isArray(v)) return v.slice(0, 32).map(x => { const c = cleanValue(x, depth + 1); return c === undefined ? null : c })
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 80)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue
      const c = cleanValue(x, depth + 1)
      if (c !== undefined) out[k] = c
    }
    return out
  }
  return undefined
}
export function cleanRescan(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const c = cleanValue(v, 0) as Record<string, unknown>
  try { if (JSON.stringify(c).length > RESCAN_MAX_BYTES) return undefined } catch { return undefined }
  return c
}
/** Every https link anywhere in a snapshot. */
function rescanLinks(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') { if (URL_RE.test(v)) out.push(v) }
  else if (Array.isArray(v)) v.forEach(x => rescanLinks(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => rescanLinks(x, out))
  return out
}
/** The snapshot with every link the account may not keep blanked (null keeps array positions - the S/E tags index them). */
function keepRescanLinks(v: unknown, keep: (u: string) => boolean): unknown {
  if (typeof v === 'string') return URL_RE.test(v) && !keep(v) ? null : v
  if (Array.isArray(v)) return v.map(x => keepRescanLinks(x, keep))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keepRescanLinks(x, keep)]))
  return v
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
    rescan: cleanRescan(b.rescan),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as GenInputVideo
}

/** Every link in a record (for an ownership check). */
export function videoInputLinks(i: GenInputVideo): string[] {
  return [
    i.imageUrl, i.endImageUrl, ...(i.referenceImageUrls ?? []), ...(i.referenceVideoUrls ?? []), ...(i.referenceAudioUrls ?? []),
    i.editVideoUrl, i.motionVideoUrl, i.lipsyncVideoUrl, i.lipsyncAudioUrl, i.audioUrl, i.song?.url,
    ...(i.klingElements ?? []).flatMap(e => [e.frontal, ...e.views]),
    ...rescanLinks(i.rescan),
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
    ...(i.rescan ? { rescan: keepRescanLinks(i.rescan, keep) as Record<string, unknown> } : {}),
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
