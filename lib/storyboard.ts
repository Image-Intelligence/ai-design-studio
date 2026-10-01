/**
 * Storyboard Studio - shared shapes and limits (client-safe).
 *
 * A storyboard is a film planned as an ordered row of stills before any motion
 * is shot: each slot carries its still, the model that made it, what the shot
 * shows, the prompt planned for its video and how it cuts to the next one.
 * Stored as one JSON array on the Storyboard row (see prisma/schema.prisma),
 * so a reorder or an edit is a single write.
 */

export type StoryboardShot = {
  id: string
  title: string
  /** What we see - the plain-language description of the shot. */
  description: string
  /** The prompt the still is (re)generated from. */
  imagePrompt: string
  imageModel: string
  stillUrl: string | null
  /** The planned prompt for the video shot made from this still. */
  videoPrompt: string
  videoModel: string
  /** Planned seconds on screen. */
  duration: number
  /** How this shot hands over to the next one (cut, match cut, dissolve...). */
  transition: string
  /** The shot's video, once it has been shot (see /api/employees/storyboards/[id]/shoot). */
  video?: ShotVideo | null
}

export type ShotVideo = {
  /** The GenerationQueue row the render owns. */
  queueId: number
  status: 'rendering' | 'done' | 'failed'
  url: string | null
  error: string | null
  /** Catalog id actually used, and the length actually requested. */
  model: string
  seconds: number
  /** The still and prompt it was shot from, so an edited slot shows it is out of date. */
  fromStill: string | null
  fromPrompt: string
  at: number
}

export type StoryboardDoc = {
  id: number
  title: string
  story: string
  look: string
  aspect: string
  shots: StoryboardShot[]
  updatedAt?: string
}

export const STORYBOARD_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
export const MAX_SHOTS = 40
export const DURATIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15] as const

/**
 * The image models a still can be made with: the ones whose fal call
 * lib/chat-hub-create's buildFalCall builds in full (references included), so
 * every option in the picker actually runs.
 */
export const STORYBOARD_IMAGE_MODELS: { id: string; label: string; refs: boolean }[] = [
  { id: 'nano-banana-pro-2', label: 'NanoBanana Pro 2', refs: true },
  { id: 'nano-banana-pro', label: 'NanoBanana Pro', refs: true },
  { id: 'seedream-5-pro', label: 'SeeDream 5.0 Pro', refs: true },
  { id: 'seedream-5-lite', label: 'SeeDream 5.0 Lite', refs: true },
  { id: 'seedream-4.5', label: 'SeeDream 4.5', refs: true },
  { id: 'flux-2', label: 'FLUX 2', refs: true },
  { id: 'kling-o3-image', label: 'Kling O3', refs: true },
  { id: 'kling-image-v3', label: 'Kling V3', refs: true },
  { id: 'wan-2.7-pro', label: 'Wan 2.7 Pro', refs: true },
  { id: 'recraft-v4.1', label: 'Recraft v4.1', refs: false },
  { id: 'gpt-image-2', label: 'ChatGPT Images 2.0', refs: true },
  { id: 'z-image-turbo', label: 'Z-Image Turbo', refs: true },
]
export const DEFAULT_IMAGE_MODEL = 'nano-banana-pro-2'

/** The video models a shot can be planned for (a plan label - nothing is shot here yet). */
export const STORYBOARD_VIDEO_MODELS = [
  'SeeDance 2.5', 'SeeDance 2.0', 'Kling 3.0', 'Kling O3 Pro', 'Veo 3.1', 'LTX 2.5 Pro',
  'Wan 2.7', 'Wan 2.5', 'Hailuo 2.3 Pro', 'Luma Ray 3.2', 'PixVerse V6', 'Happy Horse',
] as const
export const DEFAULT_VIDEO_MODEL = 'SeeDance 2.5'
/**
 * The plan label -> the site's video model id (lib/chat-video-catalog), which is
 * what /api/video/generate takes. Every one of these animates a start frame.
 */
export const STORYBOARD_VIDEO_IDS: Record<string, string> = {
  'SeeDance 2.5': 'seedance-2.5', 'SeeDance 2.0': 'seedance-2.0', 'Kling 3.0': 'kling-v3', 'Kling O3 Pro': 'kling-o3-pro',
  'Veo 3.1': 'veo-3.1', 'LTX 2.5 Pro': 'ltx-2.5-pro', 'Wan 2.7': 'wan-2.7', 'Wan 2.5': 'wan-2.5', 'Hailuo 2.3 Pro': 'hailuo-2.3-pro',
  'Luma Ray 3.2': 'luma-ray-3.2', 'PixVerse V6': 'pixverse-v6', 'Happy Horse': 'happy-horse',
}
export const SHOOT_RESOLUTIONS = ['720p', '1080p'] as const
/** The shortest length the model offers that covers the planned one (the edit trims), else its longest. */
export function pickDuration(options: string[], planned: number): string {
  const n = options.filter(o => /^\d+$/.test(o)).map(Number).sort((a, b) => a - b)
  if (!n.length) return options[0] ?? '5'
  return String(n.find(v => v >= planned) ?? n[n.length - 1])
}

export const imageModelLabel = (id: string) => STORYBOARD_IMAGE_MODELS.find(m => m.id === id)?.label ?? id

export function newShot(partial: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    title: '', description: '', imagePrompt: '', imageModel: DEFAULT_IMAGE_MODEL, stillUrl: null,
    videoPrompt: '', videoModel: DEFAULT_VIDEO_MODEL, duration: 5, transition: 'Cut',
    ...partial,
    // After the spread: a partial carrying `id: undefined` (a drafted shot, a
    // duplicate) must still get its own id - shared ids made every slot
    // react to one slot's edits and spinner
    id: partial.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 9)}`),
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

function sanitizeVideo(v: any): ShotVideo | null {
  if (!v || typeof v !== 'object' || !Number.isInteger(v.queueId)) return null
  const url = str(v.url, 2000)
  return {
    queueId: v.queueId,
    status: v.status === 'done' || v.status === 'failed' ? v.status : 'rendering',
    url: /^https:\/\//.test(url) ? url : null,
    error: str(v.error, 400) || null,
    model: str(v.model, 60),
    seconds: Number.isFinite(Number(v.seconds)) ? Number(v.seconds) : 0,
    fromStill: /^https:\/\//.test(str(v.fromStill, 2000)) ? str(v.fromStill, 2000) : null,
    fromPrompt: str(v.fromPrompt, 4000),
    at: Number.isFinite(Number(v.at)) ? Number(v.at) : 0,
  }
}

/** Clean whatever arrived into a valid shot list - the server never stores raw client JSON. */
export function sanitizeShots(raw: unknown): StoryboardShot[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_SHOTS).map((r: any) => {
    const d = Number(r?.duration)
    const still = str(r?.stillUrl, 2000)
    return newShot({
      id: str(r?.id, 64) || undefined,
      title: str(r?.title, 120),
      description: str(r?.description, 2000),
      imagePrompt: str(r?.imagePrompt, 4000),
      imageModel: STORYBOARD_IMAGE_MODELS.some(m => m.id === r?.imageModel) ? r.imageModel : DEFAULT_IMAGE_MODEL,
      stillUrl: /^https:\/\//.test(still) ? still : null,
      videoPrompt: str(r?.videoPrompt, 4000),
      videoModel: str(r?.videoModel, 60) || DEFAULT_VIDEO_MODEL,
      duration: Number.isFinite(d) ? Math.min(30, Math.max(1, Math.round(d * 2) / 2)) : 5,
      transition: str(r?.transition, 300) || 'Cut',
      video: sanitizeVideo(r?.video),
    })
  })
}

export const totalSeconds = (shots: StoryboardShot[]) => shots.reduce((a, s) => a + (s.duration || 0), 0)
export const fmtRuntime = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`

// ── Final Cut ────────────────────────────────────────────────────────────────

/** What the Final Cut button is asked for. */
export type FinalCutOptions = {
  /** Title and end cards (lettering by Ideogram v4). */
  cards: boolean
  /** A narrator over the film (lines written by the edit plan, voiced by ElevenLabs). */
  narration: boolean
  voice: string
  /** Resolution for any shots it still has to shoot. */
  resolution: string
}
export const DEFAULT_FINAL_CUT_OPTIONS: FinalCutOptions = { cards: true, narration: false, voice: 'Brian', resolution: '720p' }
export const NARRATOR_VOICES = ['Brian', 'George', 'Liam', 'Aria', 'Sarah', 'Laura', 'Charlotte', 'Daniel', 'Bill', 'Jessica'] as const

/** The steps, in order, as the page shows them. */
export const FINAL_CUT_PHASES = [
  { key: 'shoot', label: 'Shoot missing shots' },
  { key: 'plan', label: 'Plan the edit' },
  { key: 'cards', label: 'Title & end cards' },
  { key: 'cut', label: 'Cut the picture' },
  { key: 'voice', label: 'Narration' },
  { key: 'score', label: 'Score the music' },
  { key: 'mix', label: 'Mix & master' },
  { key: 'save', label: 'Save the cut' },
] as const
export type FinalCutPhase = (typeof FINAL_CUT_PHASES)[number]['key']

export type FinalCutVersion = { n: number; url: string; durationSec: number; at: number; imageId: number | null; note: string }

/** The board's Final Cut record: the running (or last) job, and every version made. */
export type FinalCutState = {
  job: {
    status: 'running' | 'done' | 'failed' | 'cancelled'
    phase: FinalCutPhase
    message: string
    error: string | null
    startedAt: number
    options: FinalCutOptions
    /** Skipped phases (no cards / no narration), so the page can grey them out. */
    skip: FinalCutPhase[]
  } | null
  versions: FinalCutVersion[]
}

/** Shots the Final Cut can hold: the assembly route takes 16 clips (two are the cards) and 2 minutes. */
export const FINAL_CUT_MAX_SHOTS = 14
export const FINAL_CUT_MAX_SECONDS = 105
