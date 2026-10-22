/**
 * Storyboard Studio - shared shapes and limits (client-safe).
 *
 * A storyboard is a film planned as an ordered row of stills before any motion
 * is shot: each slot carries its still, the model that made it, what the shot
 * shows, the prompt planned for its video and how it cuts to the next one.
 * Stored as one JSON array on the Storyboard row (see prisma/schema.prisma),
 * so a reorder or an edit is a single write.
 *
 * SCENES (2026-10-05): a board can be split into scenes, the way a film is
 * shot - each scene a place and time, the cast and locations in it, and its
 * own run of shots. Scenes are their own list (Storyboard.scenes); a shot
 * names its scene by `sceneId`, and the shot array is kept in scene order, so
 * everything that reads "the board in order" (the animatic, the Final Cut)
 * still just reads `shots`. A board with no scenes is a single run of shots,
 * exactly as before.
 */

import { getCreateModel, computeCreateCost } from '@/lib/chat-hub-models'
import { getTicketCost } from '@/config/ai-models.config'
import { flux3ImageTicketCost, flux1DevTicketCost, gptImage25TicketCost, ideogramTicketCost, nb21TicketCost, kleinTicketCost, krea3TicketCost } from '@/lib/ticket-pricing'
import { higgsfieldImageTicketCost } from '@/lib/higgsfield-models'
import { ELEVEN_VOICES, getAudioStudioModel } from '@/lib/audio-studio'

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
  /** The still's quality (2k / 4k / ...): one of its model's options; empty = the model's default. */
  imageQuality?: string
  /**
   * The still model's other settings (FLUX 3's nothing, Ideogram's speed,
   * Krea's creativity...), keyed as stillSettings(imageModel) lists them.
   * A key missing here is that setting's default. Cleared when the model changes.
   */
  imageOptions?: Record<string, string>
  /** The shot's video, once it has been shot (see /api/employees/storyboards/[id]/shoot). */
  video?: ShotVideo | null
  /**
   * Every finished clip this slot has had, oldest first - the video takes, the
   * way `stills` keeps the still takes. Written only by the server (a reshoot
   * keeps the clip it replaces; a finished render is added), and the slot
   * plays whichever take `video` is; picking another goes through the shoot
   * route's `pick`, never the autosave.
   */
  videos?: ShotVideo[]
  /**
   * Every still this slot has had, oldest first. Make and Redo add one; the
   * slot shows whichever `stillUrl` points at, so an earlier take is one tap
   * away instead of lost to the redo.
   */
  stills?: StillVersion[]
  /**
   * Final Cut keeps this shot's whole clip instead of trimming it - for a
   * moment worth watching in full (the edit plan otherwise picks the window).
   */
  keepWhole?: boolean
  /** The scene this shot belongs to (StoryScene.id); absent on a board without scenes. */
  sceneId?: string
  /**
   * This still's own references, each switched on or off - set by the AI
   * draft (from the assets it says the shot shows) or by hand in Details.
   * Absent = automatic: the scene's cast, else the board's switched-on refs.
   */
  refs?: ShotRef[]
  /**
   * The still being made for this slot, on the SERVER (the still route writes
   * it): queued in a batch, being made, or failed. Every session of the
   * account reads it, so a refresh or another device still shows "Queued" /
   * the spinner, and queued stills carry on after a reload. Cleared when the
   * still lands (the route puts it on the slot itself). Never the page's to set.
   */
  stillJob?: StillJob | null
  /**
   * The shot whose still this one EDITS (its id): that still goes first among
   * the references, so a chain of edits - new outfit, new pose, new background
   * - keeps everything the prompt does not change. Absent = a fresh image.
   */
  editOf?: string
  /**
   * This still's own frame shape when it differs from the board's (a 4:1
   * panorama on a 4:3 board, a 9:16 poster...). The still is made in it; a
   * model that cannot render it is cropped or fitted to it. Videos and the
   * Final Cut stay in the board's frame; the Stills cut pans or fits it.
   */
  aspect?: string
  /**
   * A "before" picture (an upload, an old photo, another still): the still is
   * made as an edit of it, and the Stills cut plays before -> after with a wipe.
   */
  beforeUrl?: string | null
  /** The Stills cut's caption for this shot (empty = the AI writes one from the title). */
  caption?: string
  /** A smaller line under the caption. */
  captionSub?: string
  /**
   * The audio lane (2026-10-19): lines spoken over this shot - dialogue or
   * voice-over - each voiced on its own, placed `offset` seconds into the
   * shot. The page owns the words, voice and offset; the recording (url,
   * seconds, status) is the audio route's, kept by the autosave merge.
   */
  lines?: VoiceLine[]
  /**
   * A music cue that STARTS on this shot and plays until the next shot that
   * has one (or the end of the board) - the board's score, written cue by cue.
   */
  music?: MusicCue | null
}

// ── The audio lane (2026-10-19) ──────────────────────────────────────────────
//
// Sound is planned along the board, not only at the Final Cut: voice lines
// sit on the shots they are spoken over, music cues start on a shot and run
// to the next cue. The animatic plays them, and the Final Cut uses them
// (lines placed where they belong, cues instead of the AI score).

/** What a recording is doing: 'idle' = words written, not voiced yet. */
export type AudioStatus = 'idle' | 'making' | 'done' | 'failed'
export type VoiceLine = {
  id: string
  /** Who says it (a cast name or "Narrator") - shown on the lane, told to the planner. */
  speaker: string
  text: string
  /** One of its model's voices (voicesFor) - ElevenLabs names on the ElevenLabs models. */
  voice: string
  /** STORYBOARD_VOICE_MODELS id. */
  model: string
  /** Seconds into the shot the line starts. */
  offset: number
  url: string | null
  seconds: number
  status: AudioStatus
  error?: string | null
  at: number
  /** The words / voice the recording was made from, so an edited line shows it is out of date. */
  madeText?: string | null
  madeVoice?: string | null
}
export type MusicCue = {
  id: string
  prompt: string
  /** STORYBOARD_MUSIC_MODELS id. */
  model: string
  /** Level under the picture, dB (default -10; the Final Cut ducks it under speech). */
  gainDb?: number
  url: string | null
  seconds: number
  status: AudioStatus
  error?: string | null
  at: number
  madePrompt?: string | null
}
export const MAX_LINES_PER_SHOT = 4
/** A recording "making" this long is dead (the route gives up long before). */
export const AUDIO_STALE_MS = 6 * 60_000
export const STORYBOARD_VOICE_MODELS = [
  { id: 'eleven-v4', label: 'ElevenLabs v4' },
  { id: 'eleven-v4-turbo', label: 'ElevenLabs v4 Turbo' },
  { id: 'eleven-v3', label: 'ElevenLabs v3 (audio tags)' },
  // Every other public single-voice model of the Audio Studio (2026-10-22):
  // each speaks from the words and one of its OWN voices (voicesFor) - the
  // dialogue models, voice changers and the ones that need a recording to
  // clone are left out. HeyGen Voice runs Standard (its spec.endpoint)
  { id: 'eleven-multilingual-v2', label: 'ElevenLabs Multilingual v2' },
  { id: 'eleven-turbo-v2.5', label: 'ElevenLabs Turbo v2.5' },
  { id: 'heygen-voice', label: 'HeyGen Voice' },
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS' },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash Lite TTS' },
  { id: 'gemini-3.1-flash-tts', label: 'Gemini 3.1 Flash TTS' },
  { id: 'minimax-speech-2.8-hd', label: 'MiniMax Speech 2.8 HD' },
  { id: 'minimax-speech-2.8-turbo', label: 'MiniMax Speech 2.8 Turbo' },
  { id: 'inworld-tts', label: 'Inworld TTS 1.5 Max' },
  { id: 'xai-tts', label: 'xAI Grok TTS' },
  { id: 'qwen3-tts', label: 'Qwen 3 TTS' },
  { id: 'qwen-audio-3-tts', label: 'Qwen Audio 3 TTS' },
  { id: 'chatterbox-hd', label: 'Chatterbox HD' },
  { id: 'chatterbox-multilingual', label: 'Chatterbox Multilingual (300 characters)' },
  { id: 'seed-speech-v2', label: 'ByteDance Seed Speech' },
  { id: 'orpheus-tts', label: 'Orpheus TTS' },
  { id: 'kokoro', label: 'Kokoro (American English)' },
] as const
export const DEFAULT_VOICE_MODEL = 'eleven-v4'
/**
 * The voices a line's model speaks in - its own list from lib/audio-studio
 * (Kokoro's af_heart, Gemini's Kore...). The planner casts ElevenLabs names,
 * which only the ElevenLabs models have; Brian stays the ElevenLabs default.
 */
export function voicesFor(model: string): { options: readonly string[]; def: string } {
  const v = getAudioStudioModel(model)?.voices
  if (!v) return { options: ELEVEN_VOICES, def: 'Brian' }
  return { options: v.options, def: v.options.includes('Brian') ? 'Brian' : v.default }
}
/** The line's voice when its model has it, else that model's default (what the audio route records). */
export const lineVoice = (model: string, voice: string) => {
  const v = voicesFor(model)
  return v.options.includes(voice) ? voice : v.def
}
/*
 * The lane's cue is the bed of sound under a stretch of shots: music, or
 * (2026-10-21, owner: "music or ambient noises/sound effects") ambience and
 * effects - a street, rain, a room tone. Same slot, same Record button; the
 * sound models are the Audio Studio's (lib/audio-studio).
 */
export const STORYBOARD_MUSIC_MODELS = [
  { id: 'sonilo-music', label: 'Sonilo (film score)', kind: 'music' },
  { id: 'eleven-music-v2.5', label: 'ElevenLabs Music', kind: 'music' },
  { id: 'stable-audio-3', label: 'Stable Audio 3', kind: 'music' },
  { id: 'cassette-music', label: 'CassetteAI (quick)', kind: 'music' },
  { id: 'sonilo-sfx', label: 'Sonilo Sound (ambience, sound design)', kind: 'sound' },
  { id: 'eleven-sfx-v2', label: 'ElevenLabs Sound Effects (up to 22s)', kind: 'sound' },
  // Every other public text-to-music and text-to-sound model (2026-10-22).
  // Left out: the ones that need lyrics (MiniMax Music 3, DiffRhythm, Mureka
  // Song) or a recording / clip (Sonilo Video to Music, Mirelo Video to Sound).
  // Lyria and Mureka pick their own length - the cue's span is not sent to them
  { id: 'lyria-3.5', label: 'Lyria 3.5', kind: 'music' },
  { id: 'lyria-3-pro', label: 'Lyria 3 Pro', kind: 'music' },
  { id: 'minimax-music-2.6', label: 'MiniMax Music 2.6', kind: 'music' },
  { id: 'stable-audio-2.5', label: 'Stable Audio 2.5 (up to 3 min)', kind: 'music' },
  { id: 'ace-step', label: 'ACE-Step (cheap, open)', kind: 'music' },
  { id: 'mureka-instrumental', label: 'Mureka 9.5 Instrumental', kind: 'music' },
  { id: 'mureka-song-prompt', label: 'Mureka 9.5 Song (sung, dear)', kind: 'music' },
  { id: 'mirelo-sfx2', label: 'Mirelo SFX 2.0 (up to 60s)', kind: 'sound' },
  { id: 'mirelo-sfx', label: 'Mirelo SFX 1.6 (up to 60s)', kind: 'sound' },
  { id: 'stable-audio-3-sfx', label: 'Stable Audio 3 SFX (up to 2 min)', kind: 'sound' },
  { id: 'cassette-sfx', label: 'CassetteAI SFX (up to 30s)', kind: 'sound' },
  { id: 'mmaudio-v2', label: 'MMAudio V2 (up to 30s)', kind: 'sound' },
] as const
export const DEFAULT_MUSIC_MODEL = 'sonilo-music'
/** The planner's "ambience" cues: Sonilo's sound design runs up to 3 minutes, so one cue covers a long stretch. */
export const DEFAULT_SOUND_MODEL = 'sonilo-sfx'
export type CueKind = 'music' | 'sound'
export const cueKindOf = (model: string): CueKind => STORYBOARD_MUSIC_MODELS.find(m => m.id === model)?.kind ?? 'music'
/** A recording's status now: one "making" past AUDIO_STALE_MS has failed. */
export const liveAudio = (a: { status: AudioStatus; at: number }, now = Date.now()): AudioStatus =>
  a.status === 'making' && now - a.at > AUDIO_STALE_MS ? 'failed' : a.status
export const newVoiceLine = (partial: Partial<VoiceLine> = {}): VoiceLine => ({
  speaker: 'Narrator', text: '', voice: 'Brian', model: DEFAULT_VOICE_MODEL, offset: 0.3, url: null, seconds: 0, status: 'idle', at: 0, ...partial, id: partial.id || newId('l'),
})
export const newMusicCue = (partial: Partial<MusicCue> = {}): MusicCue => ({
  prompt: '', model: DEFAULT_MUSIC_MODEL, url: null, seconds: 0, status: 'idle', at: 0, ...partial, id: partial.id || newId('m'),
})
/*
 * ── The audio lane written by AI (2026-10-19, owner) ──────────────────────
 * Draft with AI fills the lane along with the shots (always, since
 * 2026-10-21), and Edit with AI works on one shot's lines and music. Both ask
 * the text model for the same shape, read back here:
 *   voiceLines: [{ speaker, text, at }]  - at = seconds into the shot
 *   musicCue:   "prompt" for a NEW cue starting on this shot, "" for none
 *   cueKind:    "music" | "ambience" - what that cue is (picks its model)
 *   voices:     { speaker: ElevenLabs voice } - one voice per speaker
 * The planner judges whether the piece needs voice at all, and whether a
 * stretch wants a score or the sound of the place.
 * Nothing is recorded: the lane's Record buttons make the audio (and price it).
 */
/** The ElevenLabs voices with what they sound like, so the planner can cast them. */
export const VOICE_HINTS: Record<string, string> = {
  Rachel: 'calm young American woman', Aria: 'expressive American woman', Roger: 'confident middle-aged man', Sarah: 'soft young woman',
  Laura: 'upbeat young woman', Charlie: 'natural Australian man', George: 'warm British man, storyteller', Callum: 'intense, gravelly man',
  River: 'calm neutral voice', Liam: 'articulate young American man', Charlotte: 'smooth Swedish-accented woman', Alice: 'confident British woman',
  Matilda: 'friendly warm woman', Will: 'friendly young man', Jessica: 'bright expressive young woman', Eric: 'friendly middle-aged man',
  Chris: 'casual, natural man', Brian: 'deep American man, narrator', Daniel: 'authoritative British man, newsreader', Lily: 'warm British woman', Bill: 'trustworthy older American man',
}
export const voiceMenu = () => Object.entries(VOICE_HINTS).map(([v, h]) => `${v} (${h})`).join(', ')
/** The rules both AI routes give the model for a shot's sound. */
export const AUDIO_PLAN_RULES = [
  '- First decide what this video SOUNDS like, from its kind, the direction and the pictures. Voice only where words carry it: an ad or explainer\'s voiceover, characters who talk to each other, a trailer or documentary narrator, someone speaking to camera. NO voice at all for a music video, a mood piece, a montage, a fashion or product loop, a nature or travel film, an action or chase beat told in pictures, or when the direction asks for no voice - those are music, or the sound of the place.',
  '- "voiceLines": the words SPOKEN over this shot - narration or dialogue - as [{"speaker": a character\'s name from the board or "Narrator", "text": the exact words, "at": seconds into the shot it starts}]. An empty list for every shot that should breathe, and for the whole board when the piece has no voice. Dialogue belongs to characters the shot shows speaking. At most 2 per shot. Spoken at about 2.5 words a second, a line must END before the shot does ("at" + words / 2.5 <= the shot\'s duration). Plain words only - no stage directions or sound descriptions.',
  '- "musicCue": the prompt for a NEW bed of sound that STARTS on this shot and plays until the next shot with a cue, and "cueKind" saying what it is: "music" (genre, mood, instruments, tempo, and "instrumental" - no singing - under any voice) or "ambience" (the sound of the place and what happens in it: room tone, weather, crowd, traffic, machines, footsteps, an impact - layered, specific, no music). Music for a score, a hook, an ad\'s energy; ambience where the piece should feel real, quiet or tense, or a scene plays out in its own sound. Start one on the first shot (unless the piece should be silent under its voice) and a new one only where the mood, place or kind of sound clearly changes - switching between music and ambience counts; "" everywhere else.',
  '- Top level, "voices": {"<speaker>": "<voice>"} - one ElevenLabs voice per speaker, chosen to fit them, from: ' + Object.keys(VOICE_HINTS).join(', ') + '. Keep a speaker\'s voice the same everywhere.',
]
/**
 * A shot's lines from the model's "voiceLines". A line whose words match one
 * already there keeps it (and its recording); a changed line keeps its slot,
 * id and recording - the lane then shows it "edited since" to re-record.
 */
export function linesFromPlan(raw: unknown, existing: VoiceLine[] | undefined, voiceFor: (speaker: string) => string, duration: number): VoiceLine[] {
  const rows = (Array.isArray(raw) ? raw : []).slice(0, MAX_LINES_PER_SHOT)
  const old = [...(existing ?? [])]
  const out: VoiceLine[] = []
  rows.forEach((r: any, k: number) => {
    const text = String(r?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)
    if (!text) return
    const speaker = String(r?.speaker ?? 'Narrator').trim().slice(0, 60) || 'Narrator'
    const at = Math.max(0, Math.min(Math.max(0, duration - 0.5), Math.round((Number(r?.at) || 0.3) * 10) / 10))
    const same = old.findIndex(l => l.text.trim() === text)
    if (same >= 0) { out.push({ ...old[same], speaker, offset: at }); old.splice(same, 1); return }
    const slot = old.length && k < (existing?.length ?? 0) ? old.shift() : undefined
    // A reused slot keeps its model, so the cast voice must be one that model has
    out.push(slot ? { ...slot, speaker, text, voice: lineVoice(slot.model, voiceFor(speaker)), offset: at } : newVoiceLine({ speaker, text, voice: voiceFor(speaker), offset: at }))
  })
  return out
}
/**
 * A shot's cue from the model's "musicCue" + "cueKind": a new prompt (keeping
 * the slot and recording), or the cue it had. The kind picks the model - a
 * cue that switches between music and ambience moves to that kind's default
 * model; one that stays its kind keeps the model it was given. No kind given
 * (an older reply, or an edit that only rewords) keeps the cue's own kind.
 */
export function cueFromPlan(raw: unknown, existing: MusicCue | null | undefined, rawKind?: unknown): MusicCue | null {
  const prompt = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 1500) : ''
  if (!prompt) return existing ?? null
  const kind: CueKind = typeof rawKind === 'string' && rawKind.trim()
    ? (/ambien|sound|sfx|effect/i.test(rawKind) ? 'sound' : 'music')
    : existing ? cueKindOf(existing.model) : 'music'
  const model = existing && cueKindOf(existing.model) === kind ? existing.model : kind === 'sound' ? DEFAULT_SOUND_MODEL : DEFAULT_MUSIC_MODEL
  if (!existing) return newMusicCue({ prompt, model })
  return existing.prompt.trim() === prompt && existing.model === model ? existing : { ...existing, prompt, model }
}
/** One voice per speaker: the plan's pick, else the one the board already uses for them, else Brian. */
export function voicePicker(planVoices: unknown, shots: Pick<StoryboardShot, 'lines'>[]): (speaker: string) => string {
  const map = new Map<string, string>()
  for (const s of shots) for (const l of s.lines ?? []) if (!map.has(l.speaker.toLowerCase())) map.set(l.speaker.toLowerCase(), l.voice)
  const plan = planVoices && typeof planVoices === 'object' ? planVoices as Record<string, unknown> : {}
  for (const [k, v] of Object.entries(plan)) { const name = String(v ?? '').trim(); const hit = Object.keys(VOICE_HINTS).find(x => x.toLowerCase() === name.toLowerCase()); if (hit) map.set(k.toLowerCase(), hit) }
  return speaker => map.get(speaker.toLowerCase()) ?? 'Brian'
}

/** A line whose words or voice changed since it was recorded. */
export const lineStale =(l: VoiceLine) => !!l.url && (l.madeText != null && l.madeText !== l.text || l.madeVoice != null && l.madeVoice !== l.voice)
/**
 * The seconds a cue on `shotId` covers: from that shot to the next shot with
 * a cue (or the end), at the planned lengths, plus a short tail for the fade.
 */
export function musicSpanSeconds(shots: Pick<StoryboardShot, 'id' | 'duration' | 'music'>[], shotId: string): number {
  const i = shots.findIndex(s => s.id === shotId)
  if (i < 0) return 30
  let secs = 0
  for (let k = i; k < shots.length; k++) {
    if (k > i && shots[k].music) break
    secs += shots[k].duration || 0
  }
  return Math.max(10, Math.min(300, Math.ceil(secs + 3)))
}

/** Frame shapes a single still may take (SHOT_ASPECTS) - wider and taller than a board's. */
export const SHOT_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3', '4:5', '5:4', '4:1', '1:4', '8:1', '1:8'] as const
/** The frame a still is made in: its own, else the board's. */
export const shotAspect = (shot: Pick<StoryboardShot, 'aspect'>, boardAspect: string) =>
  shot.aspect && (SHOT_ASPECTS as readonly string[]).includes(shot.aspect) ? shot.aspect : boardAspect

/** One of a shot's own references; `assetId` = the asset it came from, if any. */
export type ShotRef = { id: string; url: string; on: boolean; assetId?: string }
export const MAX_SHOT_REFS = 40

/**
 * A still sent to fal's queue (2026-10-21, owner: stills left running while
 * the iPad slept came back "load failed" - "this should all be done on the
 * site in the background"). The still and still-edit routes submit and
 * answer at once; whoever looks next settles it (lib/storyboard-stills): the
 * board's poll, the feed's job poll, the per-minute cron. Everything the save
 * needs rides here, so no page has to be open.
 */
export type StillFalJob = {
  requestId: string
  endpoint: string
  /** Tickets charged for it (0 for admins) - refunded if it fails. */
  cost: number
  /** Its feed tile (lib/studio-activity). */
  track: number | null
  /** The saved row's prompt, and the take's. */
  prompt: string
  takePrompt: string
  model: string
  quality?: string
  /** The saved row's aspect ratio. */
  aspect: string
  refs: string[]
  /** Fitted into this frame when it comes back off it (null = kept as made). */
  conform: string | null
  /** R2 file name prefix. */
  name: string
  /** Also set on the shot when it lands (an expand's new frame, a first prompt). */
  patch?: Record<string, unknown>
  /**
   * A Higgsfield still (Soul 2 / Soul / Marketing Studio, 2026-10-22): not a
   * fal job but the GenerationQueue row lib/higgsfield runs and settles. Then
   * requestId is "hf-<row id>" (the row may wait for a Higgsfield slot before
   * it has a request id) and endpoint "higgsfield:<endpoint>"; cost is 0 -
   * Higgsfield's route charged, and lib/higgsfield refunds a failure.
   */
  hfQueueId?: number
}
export type StillJob = { status: 'queued' | 'making' | 'failed'; at: number; model?: string; error?: string; fal?: StillFalJob; savingAt?: number }
/**
 * A still that has been "making" this long is dead (the route gives up at
 * 300s): the slot is free again. A queued one waits for a page to run it.
 * One at fal (it has a request id) may wait in fal's queue: it is given
 * STILL_FAL_STALE_MS before the slot is free again.
 */
export const STILL_JOB_STALE_MS = 6 * 60_000
export const STILL_FAL_STALE_MS = 45 * 60_000
/**
 * A "queued" still nobody started (the old page-run batches) is let go after
 * this long - before 2026-10-21 one waited forever, and the Stills phase said
 * "Making 12" over slots nothing was making.
 */
export const STILL_QUEUED_STALE_MS = 15 * 60_000
export const stillStaleMs = (j: Pick<StillJob, 'fal'>) => (j.fal?.requestId ? STILL_FAL_STALE_MS : STILL_JOB_STALE_MS)
/** The job as it stands now: a stale "making" counts as none. */
export function liveStillJob(j: StillJob | null | undefined, now = Date.now()): StillJob | null {
  if (!j) return null
  if (j.status === 'making' && now - j.at > stillStaleMs(j)) return null
  if (j.status === 'queued' && now - j.at > STILL_QUEUED_STALE_MS) return null
  return j
}

/** One take of a slot's still. */
export type StillVersion = { url: string; prompt: string; model: string; at: number }
export const MAX_STILL_VERSIONS = 24
/** Video takes kept per slot - the oldest drop off first (they stay in My Generations). */
export const MAX_VIDEO_TAKES = 16
/**
 * A still's identity across signing: the page holds signed links and the
 * board stores canonical ones, but the file name (storyboard-<user>-<board>-
 * <time>.png) is the same in both.
 */
export const stillKey = (url: string) => url.split('?')[0].split('/').pop() ?? url

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
  /**
   * The clip as the model rendered it, when that was not the board's frame
   * (Kling 3.0 has no 3:4) - `url` is then the conformed copy (lib/storyboard-shoot).
   */
  rawUrl?: string | null
  /** The original's pixel size ("1080x1920"), to label the toggle between the two. */
  rawSize?: string | null
  /**
   * A clip EDIT (the Shot edits phase, 2026-10-19): the tool that made it
   * from an earlier take - upscale, restyle, extend, lip-sync... `lineId` =
   * the voice line lip-synced into it (the Final Cut does not lay it again).
   */
  edit?: { tool: string; label: string; of: string; prompt?: string; lineId?: string } | null
}

/** "1080x1920" -> "9:16" (the nearest common frame), else the pixel size. */
export function frameLabel(size: string | null | undefined): string {
  const [w, h] = String(size ?? '').split('x').map(Number)
  if (!(w > 0 && h > 0)) return 'Original'
  const r = Math.log(w / h)
  const known = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3', '4:5', '5:4']
  const best = known.reduce((b, k) => { const [a, c] = k.split(':').map(Number); const d = Math.abs(Math.log(a / c) - r); return d < b.d ? { k, d } : b }, { k: '', d: Infinity })
  return best.d < 0.03 ? best.k : `${w}×${h}`
}

export type StoryboardDoc = {
  id: number
  title: string
  story: string
  look: string
  aspect: string
  shots: StoryboardShot[]
  /** The cast, vehicles, props and places, each with its reference images. */
  assets: StoryAsset[]
  /** What kind of video this board plans (BOARD_MODES) - shapes drafting and the Final Cut. */
  mode: BoardModeId
  /** The board's scenes, in order (empty = one run of shots, no scenes). */
  scenes: StoryScene[]
  updatedAt?: string
}

// ── Board modes ──────────────────────────────────────────────────────────────
//
// What kind of video a board plans. A mode is a brief for the AI: the shape of
// the piece, what every shot must hold to, and how the Final Cut should edit
// it. It applies to every draft action (new board, polish, rewrite, extend),
// so a character board stays a character board when it is extended.
// `framing`: the kind puts characters on screen, so the Draft box offers the
// Framing choice (waist up / full body / mix) for it.

export const BOARD_MODES = [
  {
    /*
     * General (2026-10-11): no preset structure - the plan follows the
     * director's description (its kind of video, its moments in its order, its
     * style and pacing) instead of a story arc, trailer beats or an ad's shape.
     * The default (2026-10-11): new boards start on it, and an unknown mode
     * falls back to it. Boards made before keep their stored mode (Story).
     */
    id: 'general', label: 'General', shots: 8, framing: true,
    blurb: 'No preset - the plan follows your description, whatever kind of video it is.',
    placeholder: 'Describe exactly what you want - the video, the moments or shots, the style, the pacing…',
    brief: 'No preset format: follow the description the director gives as THE brief. Make the kind of video it describes, with the moments, order, style, pacing, framing and tone it asks for - and nothing it does not ask for: do not impose a story arc, trailer beats, an ad structure or any other template on it. Where it names specific shots or moments, plan exactly those, in that order. Where it leaves something open, choose what best serves the description.',
    edit: 'Edit to suit the description: cut where it asks; otherwise clean, motivated cuts at a pace that fits the piece.',
  },
  {
    id: 'story', label: 'Story', shots: 8, framing: true,
    blurb: 'A short film - beginning, middle and end, shots that cut together.',
    placeholder: 'Describe the video: who, where, what happens, the feeling…',
    brief: 'A short narrative film with a clear beginning, middle and end. Shots cut together into one continuous piece: motivated cuts, match cuts, continuity of light, place and time.',
    edit: 'Edit for story: let moments breathe, cut on action, dissolve only for time passing.',
  },
  {
    id: 'trailer', label: 'Trailer', shots: 10, framing: true,
    blurb: 'Hook, rising tension, a title beat - sells the film without spoiling it.',
    placeholder: 'The film being sold: genre, hero, the threat, the tone…',
    brief: 'A movie trailer. Open on an arresting hook, set up the world and the hero, escalate with faster and bigger moments, land a title beat near the end and a final sting after it. Tease, never resolve. Pace accelerates: early shots longer, late shots shorter.',
    edit: 'Edit like a trailer: start measured, accelerate, hard cuts and fade-to-black beats between acts, a sting after the title.',
  },
  {
    id: 'ad', label: 'Advertisement', shots: 8, framing: true,
    blurb: 'Hook in 2 seconds, desire, the product, the payoff, a brand end card.',
    placeholder: 'The brand and product, who it is for, the one thing it should make people feel or do…',
    brief: 'A video advertisement. Shot 1 is a scroll-stopping hook (under 3 seconds). Then the desire or problem, the product revealed as the answer, two or three benefits SHOWN not told, the payoff (the life with it), and a final brand / call-to-action shot with clean space for an end card. Every shot polished, commercial lighting, the product always recognisable. No on-screen text in the stills.',
    edit: 'Edit like a commercial: tight, rhythmic hard cuts, the hook short, the product reveal held a beat longer, end on the brand shot.',
  },
  {
    id: 'product', label: 'Product showcase', shots: 6, framing: false,
    blurb: 'The product is the hero of every shot, placed in full scenes.',
    placeholder: 'The product - what it is, its materials and colours - and the world it belongs in…',
    brief: 'A product showcase. THE PRODUCT IS THE HERO OF EVERY SHOT: describe it IDENTICALLY in every imagePrompt (same shape, materials, colours, logo placement) so it stays the same object. Place it in complete, believable scenes - in use, in its environment, in hero close-ups and detail macros - with premium product-photography lighting. Camera moves are slow and deliberate (orbits, push-ins, rack focus).',
    edit: 'Edit for the product: smooth dissolves and slow moves, each shot held long enough to see the product, end on the hero shot.',
  },
  {
    id: 'character', label: 'Character board', shots: 8, framing: true,
    blurb: 'One character, one outfit - every shot a different pose, angle and expression.',
    placeholder: 'The character - face, build, hair, the exact outfit - and the setting or backdrop…',
    brief: 'A character board: ONE character in ONE outfit throughout. Repeat the same full character and wardrobe description VERBATIM in every imagePrompt (face, hair, build, every garment and accessory, colours) so the model draws the same person every time. Each shot changes only the pose, action, camera angle, framing (full body, medium, close-up, profile, three-quarter, back) and expression. Keep one consistent backdrop or setting. Motion is small and in character (a turn, a gesture, a look).',
    edit: 'Edit as a character reel: steady hard cuts on the beat of each pose, every shot held long enough to read the character.',
  },
  {
    /*
     * For a character known only by their face: references that show little
     * or none of the body. Every shot is a head shot of that same face - the
     * angles, expressions and light a face library needs - and nothing below
     * the shoulders is invented. Always close, so no Framing choice.
     */
    id: 'face', label: 'Face study', shots: 8, framing: false,
    blurb: 'Face-only references in - the same face from every angle, expression and light.',
    placeholder: 'The character - add their face as references - and the look and lighting you want…',
    brief: 'A FACE STUDY. The reference images show a character\'s FACE, with little or none of the body. Every shot is a head shot of THAT SAME FACE: keep every facial feature identical to the references - face shape, jaw and chin, eyes and eye colour, brows, nose, lips, ears, skin tone, freckles, marks and scars, hair colour, hairline and hairstyle, age - and repeat the same full face description VERBATIM in every imagePrompt. Vary only the angle (front, three-quarter left, three-quarter right, profile, slightly high, slightly low, looking back over the shoulder), the expression (neutral, gentle smile, laugh, serious, surprised, thoughtful, determined), where the eyes look, and the light (soft beauty key, window light, rim light, dramatic side light, golden hour). Frame close-ups, extreme close-ups and head-and-shoulders portraits only: never show or invent the body below the shoulders, and never change the identity, age or features of the face. Keep clothing at the neckline simple and the same throughout. A plain or softly blurred backdrop so the face reads. Motion is small and natural: a blink, a breath, a slow turn of the head, a change of expression, a gentle push-in.',
    edit: 'Edit as a portrait reel: gentle cuts or slow dissolves, every face held long enough to read the expression.',
  },
  {
    id: 'lookbook', label: 'Fashion lookbook', shots: 8, framing: true,
    blurb: 'One model and setting, a different look in every shot.',
    placeholder: 'The model, the setting, the collection - colours, fabrics, the mood…',
    brief: 'A fashion lookbook film. The same model (describe them identically every time) in the same setting and light; each shot is a NEW LOOK described garment by garment, with an editorial pose. Camera language of a fashion film: walking shots, slow turns, fabric in motion, detail close-ups of texture and accessories.',
    edit: 'Edit like a fashion film: cut on the walk and the turn, one look per beat, smooth and confident.',
  },
  {
    /*
     * The garments alone - no model, no mannequin with a face - for building a
     * library of a specific outfit. Each outfit (a Wardrobe asset, or one
     * named in the brief) becomes its own scene with that asset attached, so
     * every still of an outfit is made from that outfit's own photos only.
     * `shots` here is per outfit.
     */
    id: 'outfit', label: 'Outfit pack', shots: 6, framing: false,
    blurb: 'No people - each outfit shot from every angle, as clean assets.',
    placeholder: 'The outfit(s) - or add them as Wardrobe assets - and the backdrop you want…',
    brief: 'An OUTFIT ASSET PACK: the clothes themselves, with NO PEOPLE - no model, no body, no face, no hands, no mannequin head. Each outfit is shot as a set of clean, consistent product photographs of the garments alone, for example: a front flat lay of the whole outfit, a back flat lay, an invisible / ghost-mannequin front (the clothes holding their 3D shape with nothing inside), a ghost-mannequin side or three-quarter view, on a hanger against a plain wall, close-up detail macros (fabric weave, stitching, buttons, zips, hardware, trims), the shoes and accessories arranged together, and one styled still life. Describe EVERY garment of the outfit IDENTICALLY in every shot of that outfit - cut, colour, material, pattern, every visible detail from its reference photos - so it stays the same clothes. One backdrop for the whole pack (seamless paper or a plain surface, soft even studio light, gentle shadows) unless the brief asks for another. Never add a person. No readable text or brand names unless they are on the reference garment. Motion is minimal and product-like: a slow turntable spin, fabric settling, a gentle push-in or orbit.',
    edit: 'Edit as a clean product reel: grouped by outfit, steady cuts or quick dissolves, every shot held long enough to read the garment.',
  },
  {
    id: 'music', label: 'Music video', shots: 10, framing: true,
    blurb: 'Performance and story B-roll, cut to a beat.',
    placeholder: 'The song - genre, tempo, mood - the artist, the visual concept…',
    brief: 'A music video. Alternate performance shots (the artist performing, consistent look) with concept / story B-roll that carries a visual idea. Strong stylised lighting, bold compositions, motion that would cut on a beat. Shots are short (2-4 seconds) except one or two signature moments.',
    edit: 'Edit to the music: short hard cuts on the beat, a couple of held signature shots, energy building to the end.',
  },
  {
    id: 'social', label: 'Social short', shots: 6, framing: true,
    blurb: 'Vertical-first, a thumb-stopping first shot, fast beats, a loopable end.',
    placeholder: 'The idea in one line - the hook, the payoff, who it is for…',
    brief: 'A short-form social video (Reels / TikTok / Shorts). The first shot must stop the scroll in under 2 seconds. Fast beats, one idea, a satisfying payoff, and a last shot that loops back into the first. Compose for a phone screen: subject large and centred, close framing.',
    edit: 'Edit for social: fast hard cuts, no slow fades, the end flowing back into the start.',
  },
  {
    id: 'location', label: 'Location tour', shots: 8, framing: false,
    blurb: 'A place shown space by space - property, venue, destination.',
    placeholder: 'The place - what it is, its style, the spaces and views worth showing…',
    brief: 'A location tour (property, venue, hotel, destination). Open on an establishing exterior or vista, then move through the space in a logical path - arrival, main spaces, details, the signature view - ending on the best shot. Architectural / travel photography: level verticals, wide lenses, golden or soft natural light, smooth gimbal and drone moves.',
    edit: 'Edit as a tour: smooth dissolves and directional moves that carry you from one space to the next.',
  },
  {
    id: 'explainer', label: 'Explainer', shots: 7, framing: false,
    blurb: 'How something works, step by step, in clear visuals.',
    placeholder: 'What is being explained, to whom, the steps or idea in order…',
    brief: 'An explainer: show how something works or how to do something, one clear step per shot, in order. Clean, uncluttered compositions with the subject obvious; consistent style (e.g. one setting or one visual language) across shots; the last shot shows the result or the takeaway.',
    edit: 'Edit for clarity: steady pacing, simple cuts, each step held long enough to understand.',
  },
] as const
export type BoardModeId = (typeof BOARD_MODES)[number]['id']

/**
 * How the characters are framed, for the kinds of video with people in them.
 * Mix is no rule at all - the kind of video and the shot decide. The rest go
 * tightest to widest (the picker shows them in this order, three a row).
 */
export const FRAMINGS = [
  { id: 'mix', label: 'Mix', hint: 'No rule - each shot frames itself' },
  { id: 'close', label: 'Close-up', hint: 'Faces: head and shoulders - expression and likeness first' },
  { id: 'waist', label: 'Waist up', hint: 'Medium shots and closer - no full-body shots' },
  { id: 'knee', label: 'Knee up', hint: 'Cut at the knees - more of the outfit and pose than waist up, still close enough for the face' },
  { id: 'full', label: 'Full body', hint: 'Head to toe in frame, feet visible' },
  { id: 'wide', label: 'Wide', hint: 'The place first - characters full-body and small in a big setting' },
] as const
export type FramingId = (typeof FRAMINGS)[number]['id']
export const isFraming = (v: unknown): v is FramingId => FRAMINGS.some(f => f.id === v)
/** The planner's rule for a framing (empty for mix). It overrides any framing the kind of video suggests. */
export function framingRule(f: FramingId): string {
  if (f === 'close') return 'FRAMING - CLOSE-UP: frame the characters\' faces in (nearly) every shot - close-ups and medium close-ups showing the head and shoulders, cut at or above the chest, so expression and likeness carry the story; now and then an extreme close-up of the eyes, the hands or a telling detail. Do NOT plan waist-up, full-body or wide shots of the characters; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "close-up, head and shoulders"). This overrides any other framing the brief above suggests.'
  if (f === 'knee') return 'FRAMING - KNEE UP: frame the characters from the knees up in (nearly) every shot - medium-long ("American" / cowboy) shots cut at or just above the knees, showing the head, the whole torso, the hands and most of the legs, so the outfit and the pose read as well as the face. Do NOT plan full-body shots that show the feet, and do not go tighter than waist-up except for an occasional close-up insert; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "knee-up medium-long shot, cut at the knees"). This overrides any other framing the brief above suggests.'
  if (f === 'wide') return 'FRAMING - WIDE: frame the characters within their setting in (nearly) every shot - wide and extreme-wide shots where the place matters as much as the people: the characters full-body and small to mid-size in the frame, with plenty of environment around them (architecture, landscape, sky, crowd). At most an occasional full shot or close-up insert; no run of tight shots. Say the framing in every imagePrompt (e.g. "wide shot, characters small in the frame"). This overrides any other framing the brief above suggests.'
  if (f === 'waist') return 'FRAMING - WAIST UP: frame the characters from the waist up in (nearly) every shot - medium shots, medium close-ups, close-ups and over-the-shoulder shots that show the head, shoulders, torso and hands, cut off at or above the waist. Do NOT plan full-body or wide shots that show a character\'s legs or feet; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "waist-up medium shot"). This overrides any other framing the brief above suggests.'
  if (f === 'full') return 'FRAMING - FULL BODY: frame the characters head to toe in (nearly) every shot - full shots and wide shots with the feet in frame and a little room above the head and below the feet; at most an occasional close-up insert of a detail. Say the framing in every imagePrompt (e.g. "full-body shot, head to toe"). This overrides any other framing the brief above suggests.'
  return ''
}
export type BoardMode = (typeof BOARD_MODES)[number]
// An unknown or missing mode is General, the default
export const DEFAULT_BOARD_MODE = 'general'
export const boardMode = (id: string | null | undefined): BoardMode => BOARD_MODES.find(m => m.id === id) ?? BOARD_MODES.find(m => m.id === DEFAULT_BOARD_MODE)!
export const isBoardMode = (id: unknown): id is BoardModeId => BOARD_MODES.some(m => m.id === id)

// ── Assets ───────────────────────────────────────────────────────────────────
//
// What a cut is made of - characters, vehicles, objects, places - each a set of
// reference images. Any ref of any asset can be switched on, and the switched-on
// refs (in asset order) go with the next still, up to what that still's model
// takes. Lives on the board (Storyboard.assets), autosaved with it.

export const ASSET_KINDS = [
  { id: 'character', label: 'Character' },
  { id: 'creature', label: 'Creature' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'object', label: 'Object / prop' },
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'location', label: 'Location' },
  { id: 'landmark', label: 'Landmark' },
  { id: 'scenery', label: 'Scenery' },
  { id: 'style', label: 'Style / look' },
  { id: 'other', label: 'Other' },
] as const
export type AssetKind = (typeof ASSET_KINDS)[number]['id']
/**
 * One picture of an asset. `caption` (2026-10-08): what's distinct about THIS
 * picture - the angle, pose, expression, outfit detail - written by hand or by
 * Auto caption (Gemini), with short `tags`. The AI draft reads them to pick the
 * right pictures for each shot instead of sending all of an asset's photos.
 */
export type AssetRef = { id: string; url: string; active: boolean; caption?: string; tags?: string[] }
export const MAX_CAPTION = 300
export const cleanCaption = (c: unknown) => (typeof c === 'string' ? c.trim().slice(0, MAX_CAPTION) : '')
export const cleanTags = (t: unknown): string[] =>
  Array.isArray(t) ? [...new Set(t.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8) : []
/**
 * `libraryId`: the account's saved asset (UserAsset, lib/user-assets) this
 * board copy came from or was saved to - "Save to My Assets" updates that one
 * rather than making another. The board keeps its own copy either way.
 */
/**
 * `suggested`: proposed by the AI draft (Cast & sets, 2026-10-11) and not yet
 * accepted - shown in the Assets panel's "Suggested" strip, never sent with a
 * still. `auto`: made by the draft (its pictures generated from the notes).
 */
/**
 * `draftOff` / `refOff` (2026-10-21, owner: the scenes' on/off "toggle to all
 * assets so I can turn them on/off for drafting", and pick "a certain image
 * instead of the entire asset"): an asset switched off is not shown to the AI
 * draft at all; `refOff` = its pictures left out of the draft (by ref id).
 * Stills already made keep their own references.
 */
export type StoryAsset = { id: string; kind: AssetKind; name: string; notes: string; refs: AssetRef[]; libraryId?: number; suggested?: boolean; auto?: boolean; draftOff?: boolean; refOff?: string[] }
/** The asset as the AI draft sees it: null when switched off, else without its left-out pictures. */
export function assetForDraft(a: StoryAsset): StoryAsset | null {
  if (a.draftOff) return null
  return a.refOff?.length ? { ...a, refs: a.refs.filter(r => !a.refOff!.includes(r.id)) } : a
}
export const MAX_ASSETS = 40
export const MAX_ASSET_REFS = 24

const newId = (p: string) => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${p}${Date.now()}${Math.random().toString(36).slice(2, 9)}`)
export const newAsset = (kind: AssetKind, name: string): StoryAsset => ({ id: newId('a'), kind, name, notes: '', refs: [] })
export const newAssetRef = (url: string, active = true): AssetRef => ({ id: newId('r'), url, active })

export function sanitizeAssets(raw: unknown): StoryAsset[] {
  if (!Array.isArray(raw)) return []
  const kinds = ASSET_KINDS.map(k => k.id) as string[]
  return raw.slice(0, MAX_ASSETS).map((a: any) => ({
    id: str(a?.id, 64) || newId('a'),
    kind: (kinds.includes(a?.kind) ? a.kind : 'other') as AssetKind,
    name: str(a?.name, 80) || 'Untitled',
    notes: str(a?.notes, 1000),
    ...(Number.isInteger(a?.libraryId) && a.libraryId > 0 ? { libraryId: a.libraryId as number } : {}),
    ...(a?.suggested === true ? { suggested: true } : {}),
    ...(a?.auto === true ? { auto: true } : {}),
    ...(a?.draftOff === true ? { draftOff: true } : {}),
    ...(Array.isArray(a?.refOff) && a.refOff.length
      ? { refOff: (a.refOff as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_ASSET_REFS).map(x => x.slice(0, 64)) }
      : {}),
    refs: (Array.isArray(a?.refs) ? a.refs : [])
      .filter((r: any) => /^https:\/\//.test(str(r?.url, 2000)))
      .slice(0, MAX_ASSET_REFS)
      .map((r: any) => {
        const caption = cleanCaption(r?.caption), tags = cleanTags(r?.tags)
        return { id: str(r?.id, 64) || newId('r'), url: str(r?.url, 2000), active: r?.active === true, ...(caption ? { caption } : {}), ...(tags.length ? { tags } : {}) }
      }),
  }))
}

/** The switched-on refs, in asset order then ref order. */
export const activeAssetRefs = (assets: StoryAsset[]) => assets.flatMap(a => a.refs.filter(r => r.active).map(r => ({ ...r, assetId: a.id, assetName: a.name })))

// ── Scenes ───────────────────────────────────────────────────────────────────

export type StoryScene = {
  id: string
  title: string
  /** The slug line: where and when ("INT. LIGHTHOUSE - NIGHT"). */
  setting: string
  /** What happens in the scene - what its shots are drafted from. */
  summary: string
  /**
   * The board assets in this scene (its cast, the location, the outfit...).
   * Their references go with every still made in the scene, in place of the
   * board-wide switched-on set - so scene 3's stills carry scene 3's cast.
   */
  assetIds: string[]
  /**
   * The scene as a reference for the AI draft (2026-10-08): `asRef` switches
   * the whole scene on, and its stills become pictures the draft may hand to
   * new shots ("Scene 2 #3") - the same faces, set and outfits carried into
   * the scenes that follow. `refOff` = the shots of it left out. A still made
   * later in a switched-on scene joins automatically. See sceneRefAssets.
   */
  asRef?: boolean
  refOff?: string[]
}
export const MAX_SCENES = 30
export const newScene = (partial: Partial<StoryScene> = {}): StoryScene => ({
  title: '', setting: '', summary: '', assetIds: [], ...partial, id: partial.id || newId('c'),
})

export function sanitizeScenes(raw: unknown): StoryScene[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoryScene[] = []
  for (const r of raw.slice(0, MAX_SCENES) as any[]) {
    const id = str(r?.id, 64) || newId('c')
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: str(r?.title, 120),
      setting: str(r?.setting, 160),
      summary: str(r?.summary, 2000),
      assetIds: (Array.isArray(r?.assetIds) ? r.assetIds : []).filter((x: unknown) => typeof x === 'string').slice(0, MAX_ASSETS).map((x: string) => x.slice(0, 64)),
      ...(r?.asRef === true ? { asRef: true } : {}),
      ...(r?.asRef === true && Array.isArray(r?.refOff) && r.refOff.length
        ? { refOff: (r.refOff as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_SHOTS).map(x => x.slice(0, 64)) }
        : {}),
    })
  }
  return out
}

/** A still's description, from its shot: the title and the plain-language "what we see". */
export const shotCaption = (s: Pick<StoryboardShot, 'title' | 'description' | 'imagePrompt'>) => {
  const what = (s.description || s.imagePrompt.split(/(?<=[.!?])\s/)[0] || '').trim()
  return [s.title.trim(), what].filter(Boolean).join(': ').slice(0, MAX_CAPTION)
}

/** How the draft names a scene used as a reference: "Scene 2". */
export const sceneRefName = (k: number) => `Scene ${k + 1}`
/** The id a scene's pseudo-asset carries ("scene:<scene id>") - never a board asset's. */
export const SCENE_REF_PREFIX = 'scene:'

/** The shots of a scene that go into its reference set: those with a still, minus the ones left out. */
export const sceneRefShots = (shots: StoryboardShot[], scene: StoryScene) =>
  scene.asRef ? shots.filter(s => s.sceneId === scene.id && s.stillUrl && !scene.refOff?.includes(s.id)) : []

/**
 * The switched-on scenes as assets the AI draft can pick pictures from: one
 * per scene, named "Scene N", each still described from its own shot (led by
 * the scene's name, the same shape Auto caption writes). Not stored - built
 * from the board each time, so a remade still is the one that goes.
 */
export function sceneRefAssets(board: { scenes: StoryScene[]; shots: StoryboardShot[] }): StoryAsset[] {
  return board.scenes.flatMap((c, k) => {
    const own = sceneRefShots(board.shots, c)
    if (!own.length) return []
    const name = sceneRefName(k)
    const about = [c.title, c.setting, c.summary].filter(Boolean).join(' - ').slice(0, 1000)
    return [{
      id: `${SCENE_REF_PREFIX}${c.id}`, kind: 'other' as AssetKind, name, notes: about,
      refs: own.map(s => ({ id: `s${s.id}`, url: s.stillUrl!, active: false, caption: `${name} - ${shotCaption(s)}`.slice(0, MAX_CAPTION) })),
    }]
  }).slice(0, MAX_SCENES)
}

/**
 * Shots in scene order. Every shot is placed in a scene that exists (a shot
 * with none, or a deleted scene's, joins the first), and within a scene shots
 * keep their order. A board without scenes comes back with no scene ids.
 */
export function orderByScenes(shots: StoryboardShot[], scenes: StoryScene[]): StoryboardShot[] {
  if (!scenes.length) return shots.some(s => s.sceneId) ? shots.map(({ sceneId: _drop, ...s }) => s) : shots
  const rank = new Map(scenes.map((c, i) => [c.id, i]))
  return shots
    .map((s, i) => {
      const placed = s.sceneId && rank.has(s.sceneId) ? s : { ...s, sceneId: scenes[0].id }
      return { s: placed, i, r: rank.get(placed.sceneId!)! }
    })
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.s)
}

/**
 * Shots always live in a scene: a board with shots and no scenes (one made
 * before scenes, or drafted as a single run) gets a Scene 1 holding them all,
 * and the shots are put in scene order. An empty board stays without scenes.
 */
export function ensureScenes<T extends { shots: StoryboardShot[]; scenes: StoryScene[] }>(b: T): T {
  if (b.scenes.length) return { ...b, shots: orderByScenes(b.shots, b.scenes) }
  if (!b.shots.length) return b
  const first = newScene()
  return { ...b, scenes: [first], shots: b.shots.map(s => ({ ...s, sceneId: first.id })) }
}

/** The shots of one scene, in order. */
export const sceneShots = (shots: StoryboardShot[], sceneId: string) => shots.filter(s => s.sceneId === sceneId)

type RefOut = { id: string; url: string; assetId?: string; assetName?: string }

/**
 * The references a shot's still is made with, before the model's limit: the
 * shot's own list when it has one (the switched-on ones), else automatic -
 * see autoShotRefs.
 */
export function shotRefs(board: Pick<StoryboardDoc, 'assets' | 'scenes'>, shot: Pick<StoryboardShot, 'sceneId' | 'refs'>): RefOut[] {
  if (Array.isArray(shot.refs)) {
    return shot.refs.filter(r => r.on).map(r => ({ id: r.id, url: r.url, assetId: r.assetId, assetName: board.assets.find(a => a.id === r.assetId)?.name }))
  }
  return autoShotRefs(board, shot)
}

/**
 * Automatic references, for a shot without its own list: every photo of the
 * assets cast in its scene - else none. Assets have no switches any more
 * (2026-10-05): the AI draft gives each shot its own list, and a shot added
 * by hand gets one from "Match references" or its Details.
 */
export function autoShotRefs(board: Pick<StoryboardDoc, 'assets' | 'scenes'>, shot: Pick<StoryboardShot, 'sceneId'>): RefOut[] {
  const scene = shot.sceneId ? board.scenes?.find(c => c.id === shot.sceneId) : undefined
  if (!scene?.assetIds.length) return []
  return scene.assetIds.flatMap(id => {
    const a = board.assets.find(x => x.id === id)
    return a ? a.refs.map(r => ({ id: r.id, url: r.url, assetId: a.id, assetName: a.name })) : []
  })
}

/**
 * A board from the days of switched-on refs: the shots that used them (no
 * list of their own, no scene cast) get those refs as their own list - so
 * nothing changes for them, and it is now visible in Details - and the
 * switches are cleared. Null when there is nothing to convert.
 */
export function migrateActiveRefs<T extends Pick<StoryboardDoc, 'assets' | 'scenes' | 'shots'>>(b: T): T | null {
  const on = activeAssetRefs(b.assets)
  if (!on.length) return null
  const shots = b.shots.map(s => {
    const scene = s.sceneId ? b.scenes.find(c => c.id === s.sceneId) : undefined
    if (Array.isArray(s.refs) || scene?.assetIds.length) return s
    return { ...s, refs: on.map(r => ({ id: newId('r'), url: r.url, on: true, assetId: r.assetId })).slice(0, MAX_SHOT_REFS) }
  })
  return { ...b, shots, assets: b.assets.map(a => ({ ...a, refs: a.refs.map(r => ({ ...r, active: false })) })) }
}

/** How the AI draft names one picture: "<asset name> #<n>" (1-based). */
export const photoLabel = (a: Pick<StoryAsset, 'name'>, k: number) => `${a.name} #${k + 1}`

/**
 * The pictures the AI draft named for a shot ("Mara #2", "Red dress #1"...),
 * from any asset, as the shot's own list. Labels that don't match are dropped;
 * none matching = null (the caller falls back to whole assets).
 */
export function refsFromPhotos(assets: StoryAsset[], labels: unknown): ShotRef[] | null {
  if (!Array.isArray(labels)) return null
  const out: ShotRef[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const m = raw.trim().match(/^(.*?)\s*#\s*(\d+)$/)
    if (!m) continue
    const name = m[1].trim().toLowerCase(), k = parseInt(m[2]) - 1
    const a = assets.find(x => x.name.trim().toLowerCase() === name)
    const r = a?.refs[k]
    if (!a || !r || seen.has(r.url)) continue
    seen.add(r.url)
    out.push({ id: newId('r'), url: r.url, on: true, assetId: a.id })
    if (out.length >= MAX_SHOT_REFS) break
  }
  return out.length ? out : null
}

/**
 * Models that need EVERY reference slot filled to hold a character's likeness
 * (2026-10-08). Their few slots (2-5: Ideogram 4.5, FLUX 2, Qwen, Grok, Luma
 * Uni, Wan 2.7...) are all the identity they get, and the owner saw an
 * Ideogram character board made from one picture each while the asset had
 * eleven. Models with many slots (Nano Banana's 14) stay with the plan's own
 * picks - more pictures there do not help.
 */
export const isRefHungryModel = (id: string) => {
  const n = stillModelSpec(id).maxRefs
  return n >= 2 && n <= 5
}

/**
 * A shot's list topped up to its model's slots with more pictures of the
 * characters / creatures already in it, for a ref-hungry model: those
 * pictures go after the plan's picks (so "the first reference image" in the
 * prompt still means the same one), a turn from each character at a time,
 * in each asset's order (Auto caption sorts it best-first, then by view). An
 * edit's source still takes one slot. Other models' lists come back as is.
 */
export function fillCharacterSlots(assets: StoryAsset[], refs: ShotRef[], model: string, editing: boolean): ShotRef[] {
  if (!isRefHungryModel(model)) return refs
  const room = stillModelSpec(model).maxRefs - (editing ? 1 : 0) - refs.length
  if (room <= 0) return refs
  const cast = [...new Set(refs.map(r => r.assetId).filter((x): x is string => !!x))]
    .map(id => assets.find(a => a.id === id))
    .filter((a): a is StoryAsset => !!a && (a.kind === 'character' || a.kind === 'creature'))
  if (!cast.length) return refs
  const have = new Set(refs.map(r => stillKey(r.url)))
  const queues = cast.map(a => a.refs.filter(r => !have.has(stillKey(r.url))).map(r => ({ url: r.url, assetId: a.id })))
  const extra: ShotRef[] = []
  for (let k = 0; extra.length < room && queues.some(q => q.length); k = (k + 1) % queues.length) {
    const next = queues[k].shift()
    if (next) extra.push({ id: newId('r'), url: next.url, on: true, assetId: next.assetId })
  }
  return [...refs, ...extra]
}

/** Every ref of these assets, switched on - a shot's list as the AI draft sets it. */
export function refsFromAssets(assets: StoryAsset[], ids: string[]): ShotRef[] {
  return ids.flatMap(id => {
    const a = assets.find(x => x.id === id)
    return a ? a.refs.map(r => ({ id: newId('r'), url: r.url, on: true, assetId: a.id })) : []
  }).slice(0, MAX_SHOT_REFS)
}

/** The shot this one edits, when it still exists and has a still. */
export function editSource(shots: Pick<StoryboardShot, 'id' | 'stillUrl' | 'title'>[], shot: Pick<StoryboardShot, 'editOf' | 'id'>) {
  if (!shot.editOf || shot.editOf === shot.id) return null
  const src = shots.find(s => s.id === shot.editOf)
  return src?.stillUrl ? src : null
}

/**
 * Every reference a still is made with, in the order the model sees them: the
 * "before" picture, then the still it edits, then its own refs (a turn from
 * each asset) - as many as the model takes. URLs, deduplicated.
 */
export function stillRefUrls(board: Pick<StoryboardDoc, 'assets' | 'scenes' | 'shots'>, shot: StoryboardShot, max: number): string[] {
  const lead = [shot.beforeUrl, editSource(board.shots, shot)?.stillUrl].filter((u): u is string => !!u)
  const seen = new Set(lead.map(stillKey))
  const own = shotRefs(board, shot).filter(r => !seen.has(stillKey(r.url)))
  return [...lead, ...pickRefs(own, Math.max(0, max - lead.length)).map(r => r.url)].slice(0, Math.max(0, max))
}

/**
 * The refs that fit the model: when there are more than it takes, they are
 * taken in turns from each asset (one of each, then a second of each...), so
 * two characters with six photos each both make it into a four-ref model.
 */
export function pickRefs<T extends { assetId?: string }>(list: T[], max: number): T[] {
  if (max <= 0) return []
  if (list.length <= max) return list
  const groups = new Map<string, T[]>()
  for (const r of list) {
    const k = r.assetId ?? '_own'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const queues = [...groups.values()]
  const out: T[] = []
  for (let i = 0; out.length < max; i++) {
    let any = false
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); any = true; if (out.length >= max) break }
    }
    if (!any) break
  }
  return out
}

// ── A still model's knobs: quality options, reference limit, ticket price ───
// From the chat hub's create catalog (lib/chat-hub-models), so a storyboard
// still is priced and limited exactly like the same model anywhere else.

/**
 * One setting a still's model offers in the shot's Details. `key` 'quality'
 * is the shot's imageQuality; any other key lives in imageOptions and is
 * passed to the model's builder (lib/fal-image-models reads it from
 * ctx.options under the same name). `as` says how the builder wants it.
 */
export type StillSetting = {
  key: string
  label: string
  options: { value: string; label: string }[]
  def: string
  as?: 'bool' | 'number'
  /** One line on what it changes (the control's tooltip). */
  hint?: string
  /** Shown to admins only - the routes ignore it for everyone else (publicStillSafety). */
  admin?: boolean
}
const o = (...vals: (string | [string, string])[]) => vals.map(v => Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v.toUpperCase() })
const RES = (vals: string[], def: string): StillSetting => ({ key: 'quality', label: 'Resolution', options: o(...vals), def })

/*
 * The settings of the models built from lib/fal-image-models (buildFalCall's
 * registry fallback) - the chat hub's catalog has no fields for them, which is
 * why FLUX 3 & co showed no resolution at all. Mirrors the portal's prompt bar
 * (IMAGE_MODEL_CONFIGS qualityOptions) and the ctx.options each builder reads.
 * Defaults are what the still route used before, so nothing re-prices itself.
 */
const REGISTRY_STILL_SETTINGS: Record<string, StillSetting[]> = {
  'gpt-image-2.5': [
    RES(['1k', '2k', '4k'], '2k'),
    { key: 'gptVariant', label: 'Renderer', options: o(['sunburst', 'Sunburst'], ['flare', 'Flare']), def: 'sunburst', hint: 'Two renderers of the same model - Flare leans more stylised' },
  ],
  'ideogram-4.5': [
    { key: 'quality', label: 'Quality', options: o(['low', 'Low'], ['medium', 'Medium'], ['high', 'High']), def: 'medium', hint: 'Size is always the largest for the frame; quality sets the detail' },
  ],
  'ideogram-v4': [
    RES(['1k', '2k'], '2k'),
    { key: 'ideogramRenderingSpeed', label: 'Speed', options: o(['TURBO', 'Turbo'], ['BALANCED', 'Balanced'], ['QUALITY', 'Quality']), def: 'BALANCED' },
    { key: 'ideogramExpansionModel', label: 'Magic prompt', options: o(['None', 'Off'], ['Medium', 'Medium'], ['Large', 'Large']), def: 'Medium', hint: 'Lets Ideogram expand the prompt - Off keeps it word for word' },
  ],
  // 2026-10-22: v4's other tiers, as the portal's Ideogram v4 config offers
  // them. Fast and Instant's own endpoints stop at Medium expansion; Instant
  // has no speed (a reference moves it to image-to-image at TURBO - the
  // builder does it and ideogramTicketCost prices it)
  'ideogram-v4-fast': [
    RES(['1k', '2k'], '2k'),
    { key: 'ideogramRenderingSpeed', label: 'Speed', options: o(['TURBO', 'Turbo'], ['BALANCED', 'Balanced'], ['QUALITY', 'Quality']), def: 'BALANCED' },
    { key: 'ideogramExpansionModel', label: 'Magic prompt', options: o(['None', 'Off'], ['Medium', 'Medium']), def: 'Medium', hint: 'Lets Ideogram expand the prompt - Off keeps it word for word' },
  ],
  'ideogram-v4-instant': [
    RES(['1k', '2k'], '2k'),
    { key: 'ideogramExpansionModel', label: 'Magic prompt', options: o(['None', 'Off'], ['Medium', 'Medium']), def: 'Medium', hint: 'Lets Ideogram expand the prompt - Off keeps it word for word' },
  ],
  // A seamless texture whose edges join up when repeated (wallpaper, fabric) - not a scene
  'ideogram-v4-tiling': [
    RES(['1k', '2k'], '2k'),
    { key: 'tilingMode', label: 'Repeats', options: o(['both', 'Both ways'], ['horizontal', 'Side to side'], ['vertical', 'Top to bottom']), def: 'both', hint: 'Which edges join up seamlessly' },
    { key: 'ideogramRenderingSpeed', label: 'Speed', options: o(['TURBO', 'Turbo'], ['BALANCED', 'Balanced'], ['QUALITY', 'Quality']), def: 'BALANCED' },
    { key: 'ideogramExpansionModel', label: 'Magic prompt', options: o(['None', 'Off'], ['Medium', 'Medium'], ['Large', 'Large']), def: 'Medium', hint: 'Lets Ideogram expand the prompt - Off keeps it word for word' },
  ],
  /*
   * Z-Image Base is built by hand in buildFalCall (no registry spec), but its
   * sizes are listed here: the catalog offers a 4k it cannot make (z-image
   * stops at 2048 a side - /api/generate renders "4k" as 2k), and the
   * portal charges it getTicketCost's flat 1 at every size.
   */
  'z-image-base': [RES(['1k', '2k'], '2k')],
  'flux-3-image': [RES(['1k', '2k', '4k'], '2k')],
  // 2026-10-17: the 2026-10-15 batch, public 2026-10-16 - the portal's sizes
  'flux-3-klein': [RES(['1k', '2k', '4k'], '2k')],
  'flux-3-klein-base': [RES(['1k', '2k', '4k'], '2k')],
  'krea-3': [RES(['1k', '2k'], '2k')],
  'qwen-image-3': [
    RES(['1k', '2k'], '2k'),
    { key: 'qwenPromptExpansion', label: 'Prompt expansion', options: o(['true', 'On'], ['false', 'Off']), def: 'true', as: 'bool' },
  ],
  // Thinking and web search as in the portal (lib/fal-image-models nb21Knobs);
  // both priced by nb21TicketCost
  'nano-banana-2.1': [
    RES(['1k', '2k', '4k'], '2k'),
    { key: 'nb21Thinking', label: 'Thinking', options: o(['minimal', 'Minimal'], ['medium', 'Medium'], ['high', 'High']), def: 'high', hint: 'High plans complex scenes, text and many references more carefully' },
    { key: 'nb21WebSearch', label: 'Web search', options: o(['false', 'Off'], ['true', 'On']), def: 'false', as: 'bool', hint: 'Looks up real, current facts (an infographic, a landmark, today\'s news) before drawing' },
    // As the portal's admin picker (nb21Knobs reads it); everyone else is held at 4 by publicStillSafety
    { key: 'nb21SafetyTolerance', label: 'Safety', options: o(['1', '1 - strictest'], ['2', '2'], ['3', '3'], ['4', '4 - what users get'], ['5', '5'], ['6', '6 - most permissive']), def: '6', admin: true, hint: 'Safety tolerance (admins only). Everyone else runs at 4.' },
  ],
  'grok-imagine-2': [
    RES(['1k', '2k'], '2k'),
    { key: 'grokQuality', label: 'Detail', options: o(['low', 'Low'], ['medium', 'Medium']), def: 'medium' },
  ],
  'bria-fibo': [
    { key: 'quality', label: 'Resolution', options: o(['1k', '1MP'], ['4k', '4MP']), def: '4k' },
    { key: 'briaStyle', label: 'Style', options: o(['none', 'None'], ['photoreal', 'Photoreal'], ['illustration', 'Illustration'], ['cinematic', 'Cinematic']), def: 'none' },
  ],
  'krea-2-large': [{ key: 'kreaCreativity', label: 'Creativity', options: o(['raw', 'Raw'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']), def: 'medium', hint: 'Raw follows the prompt closely; High takes more liberties' }],
  'luma-photon': [{ key: 'lumaStrength', label: 'Reference pull', options: o(['0.3', 'Light'], ['0.6', 'Medium'], ['0.9', 'Strong']), def: '0.6', as: 'number', hint: 'How closely it keeps the first reference (only with refs on)' }],
  'luma-uni-1': [{ key: 'lumaUniStyle', label: 'Style', options: o(['auto', 'Auto'], ['manga', 'Manga']), def: 'auto' }],
  /*
   * Higgsfield's exclusives (2026-10-22) - the portal's pickers: Soul's 720p /
   * 1080p ride its 1K / 2K, Marketing Studio renders 1K / 2K / 4K. Defaults as
   * the chat catalog's (lib/chat-image-catalog), so Nova and the Studio agree.
   */
  'higgsfield-soul-2': [{ key: 'quality', label: 'Resolution', options: o(['1k', '1K (720p)'], ['2k', '2K (1080p)']), def: '2k' }],
  'higgsfield-soul': [{ key: 'quality', label: 'Resolution', options: o(['1k', '1K (720p)'], ['2k', '2K (1080p)']), def: '1k' }],
  'higgsfield-marketing-image': [RES(['1k', '2k', '4k'], '2k')],
}
REGISTRY_STILL_SETTINGS['krea-2-medium'] = REGISTRY_STILL_SETTINGS['krea-2-large']
REGISTRY_STILL_SETTINGS['krea-2-medium-turbo'] = REGISTRY_STILL_SETTINGS['krea-2-large']
REGISTRY_STILL_SETTINGS['luma-photon-flash'] = REGISTRY_STILL_SETTINGS['luma-photon']
REGISTRY_STILL_SETTINGS['luma-uni-1-max'] = REGISTRY_STILL_SETTINGS['luma-uni-1']

/** Every setting this still model offers, quality first. Empty = the model has none (it renders one size). */
export function stillSettings(id: string): StillSetting[] {
  const reg = REGISTRY_STILL_SETTINGS[id]
  if (reg) return reg
  // Hand-built models: their quality field from the chat hub's catalog
  const q = getCreateModel(id)?.fields?.find(f => f.key === 'quality')
  if (!q || q.options.length < 2) return []
  const label = q.options.every(x => /^\dk$/.test(x)) ? 'Resolution' : 'Quality'
  return [{ key: 'quality', label, options: o(...q.options.map(x => /^\dk$/.test(x) ? x : [x, x[0].toUpperCase() + x.slice(1)] as [string, string])), def: q.def }]
}

/** The shot's value for one setting, falling back to its default. */
export function stillSettingValue(set: StillSetting, quality: string | undefined, options: Record<string, string> | undefined): string {
  const v = set.key === 'quality' ? quality : options?.[set.key]
  return v && set.options.some(x => x.value === v) ? v : set.def
}

/**
 * A shot's options as the model's builder takes them: only known keys with
 * allowed values, typed per `as`. Server-side guard and client both use it.
 */
export function stillBuildOptions(id: string, options: unknown): Record<string, string | number | boolean> {
  const src = options && typeof options === 'object' ? options as Record<string, unknown> : {}
  const out: Record<string, string | number | boolean> = {}
  for (const set of stillSettings(id)) {
    if (set.key === 'quality') continue
    const raw = typeof src[set.key] === 'string' ? src[set.key] as string : ''
    const v = set.options.some(x => x.value === raw) ? raw : set.def
    out[set.key] = set.as === 'bool' ? v === 'true' : set.as === 'number' ? Number(v) : v
  }
  return out
}

export type StillModelSpec = { qualities: string[]; defQuality: string; maxRefs: number; settings: StillSetting[] }
export function stillModelSpec(id: string): StillModelSpec {
  const m = getCreateModel(id)
  const settings = stillSettings(id)
  const q = settings.find(s => s.key === 'quality')
  return {
    qualities: q?.options.map(x => x.value) ?? [],
    defQuality: q?.def ?? '',
    maxRefs: m?.noRefs ? 0 : Math.max(0, m?.maxRefs ?? 0),
    settings,
  }
}
/** GPT Image takes pixel sizes, not ratios: the nearest it offers to the board's frame. */
export const GPT_SIZE_FOR_ASPECT: Record<string, string> = {
  '16:9': '1920x1080', '21:9': '1920x1080', '9:16': '1024x1536', '3:4': '1024x1536', '4:3': '1024x768', '1:1': '1024x1024',
}
/**
 * Tickets for one still on this model with these settings and frame (what a
 * user would pay) - the registry models priced as app/api/generate prices
 * them, so a 4K FLUX 3 or a high Ideogram costs what it does in the portal.
 */
export function stillTickets(id: string, quality: string | undefined, aspect: string, options?: Record<string, string>, refs = 0): number {
  const m = getCreateModel(id)
  if (!m) return 0
  const spec = stillModelSpec(id)
  const q = quality && spec.qualities.includes(quality) ? quality : spec.defQuality || undefined
  const opt = (key: string) => {
    const set = spec.settings.find(s => s.key === key)
    return set ? stillSettingValue(set, q, options) : undefined
  }
  try {
    if (REGISTRY_STILL_SETTINGS[id] || !m.fields) {
      switch (id) {
        case 'gpt-image-2.5': return gptImage25TicketCost({ quality: q ?? '2k', aspectRatio: aspect, refCount: refs })
        case 'nano-banana-2.1': return nb21TicketCost({ quality: q ?? '2k', refCount: refs, thinking: opt('nb21Thinking'), webSearch: opt('nb21WebSearch') === 'true' })
        case 'flux-3-image': return flux3ImageTicketCost({ quality: q, aspectRatio: aspect, refs })
        // Priced on the size sent (and Krea 3 on every reference), as /api/generate charges
        case 'flux-3-klein': case 'flux-3-klein-base': return kleinTicketCost(id, { quality: q, aspectRatio: aspect })
        case 'krea-3': return krea3TicketCost({ quality: q, aspectRatio: aspect, refs })
        case 'qwen-image-3': return (q === '1k' ? 1 : 2) + (refs > 0 ? 1 : 0)
        case 'ideogram-v4': case 'ideogram-v4-fast': case 'ideogram-v4-instant': case 'ideogram-v4-tiling':
          return ideogramTicketCost({ tier: id, quality: q, aspectRatio: aspect, ref: refs > 0, speed: opt('ideogramRenderingSpeed'), expansion: opt('ideogramExpansionModel') })
        case 'grok-imagine-2': return getTicketCost(refs > 0 ? 'grok-imagine-2-edit' : id, q)
        case 'mai-image-2.5-pro': return getTicketCost(refs > 0 ? 'mai-image-2.5-pro-edit' : id, q)
        // What /api/admin/higgsfield/image-submit charges (references cost nothing extra)
        case 'higgsfield-soul-2': case 'higgsfield-soul': case 'higgsfield-marketing-image': return higgsfieldImageTicketCost(id, q)
        default: return getTicketCost(id, q)
      }
    }
    // The chat catalog prices Z-Image Turbo flat; the portal charges by size
    if (id === 'z-image-turbo') return q === '4k' ? 8 : q === '2k' ? 2 : 1
    // FLUX.1 Dev by megapixel, image-to-image (a reference) dearer - as /api/generate charges it
    if (id === 'flux-1-dev') return flux1DevTicketCost({ quality: q, aspectRatio: aspect, i2i: refs > 0 })
    const size = id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[aspect] ?? '1024x1024') : aspect
    return computeCreateCost(m, q ? { quality: q, aspect: size } : { aspect: size })
  } catch { return m.ticketCost ?? 0 }
}

export const STORYBOARD_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
/** Shots a board holds in all - scenes made boards longer (it was 40). */
export const MAX_SHOTS = 120
export const DURATIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15] as const
/** How many shots one draft (or one Extend) may ask for. A board holds MAX_SHOTS in all. */
export const MAX_DRAFT_SHOTS = 20
/** Target lengths a draft can aim for, in seconds; 0 = Auto (the kind of video decides). */
export const TARGET_LENGTHS = [0, 15, 30, 45, 60, 90, 120, 180] as const
/** A target length as a person says it: 30s, 1 min, 1:30, 3 min. */
export const lengthLabel = (s: number) => s === 0 ? 'Auto' : s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** The runtimes `count` shots can reach with the lengths a shot may have. */
export const runtimeRange = (count: number) => ({ min: count * DURATIONS[0], max: count * DURATIONS[DURATIONS.length - 1] })

/**
 * Make shot lengths add up to `target` seconds - the planner aims for it, but
 * models add up loosely. Every shot is scaled by the same factor first (so the
 * pacing the planner chose survives: the long shot stays the long one), then
 * snapped to the lengths a shot may have (DURATIONS), and the leftover is
 * nudged one notch at a time onto the shot furthest from its scaled length.
 * Stops at the closest sum it can reach.
 */
export function fitDurations(shots: StoryboardShot[], target: number): StoryboardShot[] {
  if (!target || !shots.length) return shots
  const steps = DURATIONS as readonly number[]
  const total = shots.reduce((a, s) => a + (s.duration > 0 ? s.duration : 5), 0)
  const ideal = shots.map(s => ((s.duration > 0 ? s.duration : 5) * target) / total)
  const snap = (d: number) => steps.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
  const out = shots.map((s, i) => ({ ...s, duration: snap(ideal[i]) }))
  const sum = () => out.reduce((a, s) => a + s.duration, 0)
  for (let guard = 0; guard < 400; guard++) {
    const diff = target - sum()
    if (diff === 0) break
    const up = diff > 0
    // The shot furthest short of (or past) its scaled length, that can still move
    let best = -1
    for (let i = 0; i < out.length; i++) {
      const k = steps.indexOf(out[i].duration)
      if (up ? k >= steps.length - 1 : k <= 0) continue
      const gap = up ? ideal[i] - out[i].duration : out[i].duration - ideal[i]
      if (best < 0 || gap > (up ? ideal[best] - out[best].duration : out[best].duration - ideal[best])) best = i
    }
    if (best < 0) break
    const next = steps[steps.indexOf(out[best].duration) + (up ? 1 : -1)]
    // Stop rather than overshoot further than we are now
    if (Math.abs(diff - (next - out[best].duration)) >= Math.abs(diff)) break
    out[best].duration = next
  }
  return out
}

/**
 * The image models a still can be made with: the ones whose fal call
 * lib/chat-hub-create's buildFalCall builds in full (references included), so
 * every option in the picker actually runs - and Higgsfield's three, which
 * run through their own route (HIGGSFIELD_IMAGE_MODELS, see the end).
 */
export const STORYBOARD_IMAGE_MODELS: { id: string; label: string; refs: boolean }[] = [
  // First: the house default (2026-10-07) - the menus and the planners read this order
  { id: 'nano-banana-2.1', label: 'NanoBanana 2.1', refs: true },
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
  // Public 2026-10-01/02 - built through lib/fal-image-models (buildFalCall's
  // registry fallback), references through each model's edit endpoint
  { id: 'gpt-image-2.5', label: 'ChatGPT Images 2.5', refs: true },
  { id: 'ideogram-4.5', label: 'Ideogram v4.5', refs: true },
  { id: 'ideogram-v4', label: 'Ideogram v4', refs: true },
  { id: 'flux-3-image', label: 'FLUX 3', refs: true },
  { id: 'qwen-image-3', label: 'Qwen Image 3', refs: true },
  { id: 'meta-muse', label: 'Meta Muse', refs: true },
  { id: 'seedream-5-flash', label: 'SeeDream 5.0 Flash', refs: true },
  { id: 'grok-imagine-2', label: 'Grok Imagine 2', refs: true },
  { id: 'nano-banana-2-lite', label: 'NanoBanana 2 Lite', refs: false },
  { id: 'mai-image-2.5-pro', label: 'MAI Image 2.5 Pro', refs: true },
  { id: 'hunyuan-image-3', label: 'Hunyuan Image 3', refs: false },
  { id: 'hunyuan-image-3-instruct', label: 'Hunyuan Image 3 Instruct', refs: true },
  { id: 'krea-2-large', label: 'Krea 2 Large', refs: true },
  { id: 'krea-2-medium', label: 'Krea 2 Medium', refs: true },
  { id: 'krea-2-medium-turbo', label: 'Krea 2 Medium Turbo', refs: true },
  { id: 'bria-fibo-2', label: 'Bria Fibo 2.0', refs: true },
  { id: 'bria-fibo', label: 'Bria FIBO 1.5', refs: true },
  { id: 'luma-photon', label: 'Luma Photon', refs: true },
  { id: 'luma-photon-flash', label: 'Luma Photon Flash', refs: true },
  { id: 'luma-uni-1', label: 'Luma Uni-1', refs: true },
  { id: 'luma-uni-1-max', label: 'Luma Uni-1 Max', refs: true },
  { id: 'recraft-v4.1-flash', label: 'Recraft V4.1 Flash', refs: false },
  // Public 2026-10-16 (added to the Storyboard 2026-10-17): FLUX 3 Klein /
  // Klein Base and Krea 3, references through their edit endpoints
  { id: 'flux-3-klein', label: 'FLUX 3 Klein', refs: true },
  { id: 'flux-3-klein-base', label: 'FLUX 3 Klein Base', refs: true },
  { id: 'krea-3', label: 'Krea 3', refs: true },
  // Public 2026-10-20: the still's aspect picks MOSS's nearest named size (2 tickets)
  { id: 'moss-image', label: 'MOSS Image', refs: false },
  // Public models the Storyboard had not listed (added 2026-10-22): FLUX 1 Dev
  // and Z-Image Base are hand-built cases of buildFalCall (one reference =
  // FLUX's image-to-image; Z-Image Base takes none), the Ideogram v4 tiers go
  // through lib/fal-image-models like v4 itself. Ideogram Vector is left out:
  // it answers with an SVG, which the still pipeline would save under a .jpg
  // name and the shot could not animate (fal's video models take raster frames)
  { id: 'flux-1-dev', label: 'FLUX 1 Dev', refs: true },
  { id: 'z-image-base', label: 'Z-Image Base', refs: false },
  { id: 'ideogram-v4-fast', label: 'Ideogram v4 Fast', refs: true },
  { id: 'ideogram-v4-instant', label: 'Ideogram v4 Instant', refs: true },
  { id: 'ideogram-v4-tiling', label: 'Ideogram v4 Tiling', refs: true },
  // Higgsfield's exclusives (public, added 2026-10-22): NOT fal calls - the
  // still and Image Studio routes send them through Higgsfield's own route and
  // queue (lib/storyboard-stills submitHiggsfieldImage). Soul 2 is text only;
  // Soul takes one picture (it guides its prompt enhancement); Marketing
  // Studio takes product / brand / people pictures
  { id: 'higgsfield-soul-2', label: 'Soul 2', refs: false },
  { id: 'higgsfield-soul', label: 'Soul', refs: true },
  { id: 'higgsfield-marketing-image', label: 'Marketing Studio Image', refs: true },
]
// NanoBanana 2.1 since the Studio went public (2026-10-07): Pro 2 is admin-only
export const DEFAULT_IMAGE_MODEL = 'nano-banana-2.1'

/** The video models a shot can be planned for (a plan label - nothing is shot here yet). */
export const STORYBOARD_VIDEO_MODELS = [
  'SeeDance 2.5', 'SeeDance 2.0', 'Kling 3.0', 'Kling O3 Pro', 'Veo 3.1', 'LTX 2.5 Pro',
  'Wan 2.7', 'Wan 2.5', 'Hailuo 2.3 Pro', 'Luma Ray 3.2', 'PixVerse V6', 'Happy Horse',
  // public 2026-10-01
  'LTX 2.5 Fast', 'Gemini Omni Flash', 'Omni Flash 1.1', 'Flux 3', 'Flux 3 Max', 'Grok Imagine 1.5',
  // public 2026-10-01/02 - every one animates a start frame
  'Veo 3.1 Fast', 'Veo 3.1 Lite', 'Kling O3 4K', 'Kling V3 Turbo Pro', 'Kling V3 Turbo',
  'SeeDance 2.0 Fast', 'SeeDance 2.0 Mini', 'SeeDance 1.5', 'PixVerse C1', 'Vidu Q3', 'Vidu Q3 Turbo',
  'Pika 2.2', 'Hailuo 2.3', 'Hailuo 2.3 Fast Pro', 'Hailuo 2.3 Fast', 'MiniMax H3 Max', 'MiniMax H3 Max Turbo',
  'Wan 3.0', 'Wan 3.0 Prime', 'Luma Ray 2', 'Luma Ray 2 Flash', 'Hunyuan Video 1.5', 'Grok Imagine 1.5 Lite',
  // 2026-10-06 (public): 5s with sound, 480p or upscaled in the same job
  'Kandinsky 6 Pro', 'Kandinsky 6 Lite',
  // 2026-10-08 (public): the still is its start frame (fal's image-to-video), 3-16s, sound always on
  'Vidu Q4',
  // Public image-to-video models the Storyboard had not listed (added 2026-10-17):
  // each animates the still as its start frame
  'Happy Horse 1.1', 'Kling O3', 'H3 Max Camera Controls',
  // 2026-10-22: HeyGen Video (the still routes it to its image-to-video
  // endpoint; it always needs the prompt, which a shot always has), Pixelcut's
  // looping product video, and H3 Max References - which takes the still as a
  // REFERENCE (re-stages its subject) rather than as the first frame
  'HeyGen Video', 'Pixelcut Loop', 'H3 Max References',
] as const
export const DEFAULT_VIDEO_MODEL = 'SeeDance 2.5'
/**
 * The plan label -> the site's video model id (lib/chat-video-catalog), which is
 * what /api/video/generate takes. Every one of these animates a start frame,
 * save H3 Max References (the still goes in as its reference picture).
 */
export const STORYBOARD_VIDEO_IDS: Record<string, string> = {
  'SeeDance 2.5': 'seedance-2.5', 'SeeDance 2.0': 'seedance-2.0', 'Kling 3.0': 'kling-v3', 'Kling O3 Pro': 'kling-o3-pro',
  'Veo 3.1': 'veo-3.1', 'LTX 2.5 Pro': 'ltx-2.5-pro', 'Wan 2.7': 'wan-2.7', 'Wan 2.5': 'wan-2.5', 'Hailuo 2.3 Pro': 'hailuo-2.3-pro',
  'Luma Ray 3.2': 'luma-ray-3.2', 'PixVerse V6': 'pixverse-v6', 'Happy Horse': 'happy-horse',
  'LTX 2.5 Fast': 'ltx-2.5-fast', 'Gemini Omni Flash': 'gemini-omni-flash', 'Omni Flash 1.1': 'gemini-omni-1.1',
  'Flux 3': 'flux-3', 'Flux 3 Max': 'flux-3-max', 'Grok Imagine 1.5': 'grok-video-1.5',
  'Veo 3.1 Fast': 'veo-3.1-fast', 'Veo 3.1 Lite': 'veo-3.1-lite', 'Kling O3 4K': 'kling-o3-4k',
  'Kling V3 Turbo Pro': 'kling-v3-turbo-pro', 'Kling V3 Turbo': 'kling-v3-turbo',
  'SeeDance 2.0 Fast': 'seedance-2.0-fast', 'SeeDance 2.0 Mini': 'seedance-2.0-mini', 'SeeDance 1.5': 'seedance-1.5',
  'PixVerse C1': 'pixverse-c1', 'Vidu Q3': 'vidu-q3', 'Vidu Q3 Turbo': 'vidu-q3-turbo', 'Pika 2.2': 'pika-2.2',
  'Hailuo 2.3': 'hailuo-2.3', 'Hailuo 2.3 Fast Pro': 'hailuo-2.3-fast-pro', 'Hailuo 2.3 Fast': 'hailuo-2.3-fast',
  'MiniMax H3 Max': 'minimax-h3-max', 'MiniMax H3 Max Turbo': 'minimax-h3-max-turbo',
  'Wan 3.0': 'wan-3.0', 'Wan 3.0 Prime': 'wan-3.0-prime', 'Luma Ray 2': 'luma-ray-2', 'Luma Ray 2 Flash': 'luma-ray-2-flash',
  'Hunyuan Video 1.5': 'hunyuan-video-1.5', 'Grok Imagine 1.5 Lite': 'grok-video-1.5-lite',
  'Kandinsky 6 Pro': 'kandinsky6-pro', 'Kandinsky 6 Lite': 'kandinsky6-lite',
  'Vidu Q4': 'vidu-q4',
  'Happy Horse 1.1': 'happy-horse-1.1', 'Kling O3': 'kling-o3', 'H3 Max Camera Controls': 'minimax-h3-max-camera',
  'HeyGen Video': 'heygen-video', 'Pixelcut Loop': 'pixelcut-looping-video', 'H3 Max References': 'minimax-h3-max-ref',
}

/**
 * What each storyboard model is FOR, in one planning line - what the AI draft
 * reads to cast a model per shot. Plain craft notes (not prices): the
 * catalog's own text is pricing detail, which says nothing about which shot a
 * model suits.
 */
export const STORYBOARD_MODEL_NOTES: Record<string, string> = {
  // images (by id)
  'nano-banana-2.1': 'THE DEFAULT for every still: newest NanoBanana - holds faces and outfits across up to 14 refs, changes pose/angle/outfit/background, several subjects, clean in-image text, long prompts; cheaper than Pro',
  'nano-banana-pro-2': 'older premium NanoBanana; only when NanoBanana 2.1 has failed a shot',
  'nano-banana-pro': 'older NanoBanana; NanoBanana 2.1 does the same job better',
  'seedream-5-pro': 'sharp 2K photoreal detail; cinematic lighting',
  'seedream-5-lite': 'quick, cheap drafts', 'seedream-4.5': 'dependable general images',
  'seedream-5-flash': 'fast and cheap; fine for many filler or background shots',
  'flux-2': 'fast, strong prompt adherence', 'flux-3-image': 'newest FLUX; crisp detail, follows long prompts; edits with up to 10 refs',
  'kling-o3-image': 'high-fidelity stylised art', 'kling-image-v3': 'stylised art and illustration',
  'wan-2.7-pro': 'detailed scenes, strong composition', 'recraft-v4.1': 'design work, logos and layout',
  'recraft-v4.1-flash': 'cheap design-y graphics', 'gpt-image-2': 'follows instructions exactly; short text in scene',
  'gpt-image-2.5': 'best at complex instructions, diagrams and in-scene text', 'z-image-turbo': 'fastest cheap drafts',
  'ideogram-4.5': 'TITLE CARDS, signage, posters - the most reliable lettering; precise edits from refs',
  'ideogram-v4': 'text inside images, speed tiers', 'qwen-image-3': 'strong text rendering; edits with refs',
  'meta-muse': 'cheap, clean general images; edits with up to 10 refs', 'grok-imagine-2': 'expressive, bold style',
  'nano-banana-2-lite': 'cheap NanoBanana for simple frames', 'mai-image-2.5-pro': 'photoreal people and products',
  'hunyuan-image-3': 'rich detailed illustration', 'hunyuan-image-3-instruct': 'follows complex instructions; edits up to 3 images',
  'krea-2-large': 'aesthetic, art-directed looks; copies a style from refs', 'krea-2-medium': 'art-directed looks, cheaper',
  'krea-2-medium-turbo': 'fastest Krea look', 'bria-fibo': 'licensed-data, commercially safe imagery', 'moss-image': 'exact Chinese & English lettering, structured layouts', 'bria-fibo-2': 'reasoning-heavy prompts, licensed data, edits up to 4 pictures',
  'luma-photon': 'cinematic, moody photographic frames', 'luma-photon-flash': 'cheap cinematic frames',
  'luma-uni-1': 'stylised scenes with refs', 'luma-uni-1-max': 'highest-quality Luma stills',
  'flux-3-klein': 'very cheap, fast FLUX 3 at up to 4K; quick drafts and filler, edits with up to 10 refs',
  'flux-3-klein-base': 'the fuller Klein - more detail and range than Klein, still cheap; up to 4K and 10 refs',
  'krea-3': 'newest Krea: aesthetic, art-directed photographic looks; keeps characters across up to 8 refs',
  'flux-1-dev': 'classic FLUX look - crisp graphic compositions, posters, concept art; one ref restyles that picture',
  'z-image-base': 'cheapest full-quality stills (1 ticket), strong realism; text only, no refs',
  'ideogram-v4-fast': 'Ideogram v4 lettering, quicker and cheaper; signage and labels in scene',
  'ideogram-v4-instant': 'fastest, cheapest Ideogram - draft title cards and signage',
  'ideogram-v4-tiling': 'SEAMLESS REPEATING TEXTURES only (wallpaper, fabric, ground cover) - never a shot; for a pattern asset',
  'higgsfield-soul-2': 'fashion-editorial portraits and lifestyle photos with a real-camera look; text only (no refs), so it cannot hold a cast member - mood and b-roll people shots; very cheap',
  'higgsfield-soul': 'the original Soul fashion / portrait look; one ref only guides the style, it does not keep a face',
  'higgsfield-marketing-image': 'polished ad and campaign images - products and people in marketing scenes; product / brand pictures as refs; packshots and commercial beats',
  // videos (by plan label)
  'SeeDance 2.5': 'best general motion and acting, native audio; refuses close-ups of realistic faces',
  'SeeDance 2.0': 'multi-reference motion with audio', 'SeeDance 2.0 Fast': 'cheaper SeeDance 2.0',
  'SeeDance 2.0 Mini': 'budget SeeDance with audio', 'SeeDance 1.5': 'reliable simple image-to-video',
  'Kling 3.0': 'smooth realistic motion, good with faces', 'Kling O3 Pro': 'expressive motion with audio',
  'Kling O3 4K': 'Kling O3 at 4K for hero shots', 'Kling V3 Turbo Pro': 'fast Kling up to 15s', 'Kling V3 Turbo': 'cheapest Kling',
  'Veo 3.1': "Google's flagship: cinematic realism and synced dialogue/sound", 'Veo 3.1 Fast': 'Veo quality, faster and cheaper',
  'Veo 3.1 Lite': 'lowest-cost Veo for simple shots', 'LTX 2.5 Pro': 'fast 1080p with directed camera and audio',
  'LTX 2.5 Fast': 'up to 4K and long takes, cheap', 'Wan 2.7': 'start/end frame control', 'Wan 2.5': 'solid 1080p image-to-video',
  'Wan 3.0': 'latest Wan, native audio', 'Wan 3.0 Prime': 'top Wan quality', 'Hailuo 2.3 Pro': 'MiniMax Hailuo at 1080p, dynamic action',
  'Hailuo 2.3': 'Hailuo 6 or 10s', 'Hailuo 2.3 Fast Pro': 'fast Hailuo at 1080p', 'Hailuo 2.3 Fast': 'cheapest Hailuo',
  'MiniMax H3 Max': 'strong prompt following', 'MiniMax H3 Max Turbo': 'fast cheap H3',
  'Luma Ray 3.2': 'cinematic camera moves, start + end frames', 'Luma Ray 2': 'Dream Machine motion', 'Luma Ray 2 Flash': 'cheaper Ray 2',
  'PixVerse V6': 'cheap and quick, stylised', 'PixVerse C1': 'PixVerse with stronger subjects',
  'Vidu Q3': 'up to 16s with audio, anime and stylised', 'Vidu Q3 Turbo': 'faster half-price Vidu',
  'Pika 2.2': 'playful stylised effects', 'Happy Horse': 'stylised character animation',
  'Gemini Omni Flash': 'versatile, follows complex direction', 'Omni Flash 1.1': 'Omni with 4K',
  'Flux 3': 'keyframe-precise motion with audio', 'Flux 3 Max': 'Flux 3 with stronger prompt following, faster', 'Grok Imagine 1.5': 'bold expressive motion', 'Grok Imagine 1.5 Lite': 'cheapest Grok motion',
  'Hunyuan Video 1.5': 'open model, permissive, simple motion',
  'Kandinsky 6 Pro': 'rich 5s shots with generated sound; slow and dear - hero moments',
  'Kandinsky 6 Lite': 'cheap 5s shots with sound; quick drafts and filler',
  'Vidu Q4': 'newest Vidu: 3-16s with native sound, up to 4K; strong anime and stylised motion, holds the start frame closely',
  'Happy Horse 1.1': 'newer Happy Horse: 3-15s at up to 1080p, lively character animation',
  'Kling O3': 'Kling O3 standard: 3-15s, expressive motion with optional audio, cheaper than O3 Pro',
  'H3 Max Camera Controls': 'the scene holds still while the camera moves (orbit, push, crane) - establishing and reveal shots',
  'HeyGen Video': 'newest HeyGen: 5-15s with sound from the still, up to 2K; natural people, presenters and everyday scenes',
  'Pixelcut Loop': 'PRODUCT LOOPS only: a seamless 5-15s loop that starts and ends on the still, gentle motion - packshots, not story beats',
  'H3 Max References': 'the still is a REFERENCE, not the first frame - re-stages its subject in a new shot with strong prompt following; when the opening need not match the still',
}

/** The planner's menu: one line per model, image ids and video labels. */
export function storyboardModelMenu(): { images: string; videos: string } {
  // Each model's reference slots, so the plan picks as many pictures as the
  // model takes (2026-10-08: Ideogram's 5 slots got one picture of a character)
  const slots = (id: string, refs: boolean) => {
    const n = refs ? stillModelSpec(id).maxRefs : 0
    return n ? `, takes up to ${n} reference image${n === 1 ? '' : 's'}` : ', no reference images'
  }
  return {
    images: STORYBOARD_IMAGE_MODELS.map(m => `- ${m.id} (${m.label}${slots(m.id, !!m.refs)}): ${STORYBOARD_MODEL_NOTES[m.id] ?? 'general image model'}`).join('\n'),
    videos: STORYBOARD_VIDEO_MODELS.map(l => `- ${l}: ${STORYBOARD_MODEL_NOTES[l] ?? 'image-to-video'}`).join('\n'),
  }
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
    title: '', description: '', imagePrompt: '', stillUrl: null,
    videoPrompt: '', duration: 5, transition: 'Cut',
    ...partial,
    // Same for the models: the first shot of an empty board is made with the
    // previous shot's models, which are `undefined` there - it showed blank
    // pickers and "undefined takes no references"
    imageModel: partial.imageModel || DEFAULT_IMAGE_MODEL,
    videoModel: partial.videoModel || DEFAULT_VIDEO_MODEL,
    // After the spread: a partial carrying `id: undefined` (a drafted shot, a
    // duplicate) must still get its own id - shared ids made every slot
    // react to one slot's edits and spinner
    id: partial.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 9)}`),
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** A shot's still settings: short string pairs only (values are checked against the model at generation). */
function sanitizeImageOptions(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (/^[a-zA-Z]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 24) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeStills(raw: unknown, current: string | null, prompt: string, model: string): StillVersion[] {
  const out: StillVersion[] = []
  const seen = new Set<string>()
  for (const v of Array.isArray(raw) ? raw : []) {
    const url = str((v as any)?.url, 2000)
    if (!/^https:\/\//.test(url) || seen.has(stillKey(url))) continue
    seen.add(stillKey(url))
    const at = Number((v as any)?.at)
    out.push({ url, prompt: str((v as any)?.prompt, 4000), model: str((v as any)?.model, 60), at: Number.isFinite(at) ? at : 0 })
  }
  // A slot from before versions (or a still set some other way) still lists
  // the still it shows, so its first redo does not lose it
  if (current && !seen.has(stillKey(current))) out.push({ url: current, prompt, model, at: 0 })
  return out.slice(-MAX_STILL_VERSIONS)
}

/**
 * The stored takes plus any the page adds, never fewer: autosave sends the
 * page's copy of the board, and a stale copy must not drop a take made
 * meanwhile (from another tab or device).
 */
export function mergeStills(stored: StillVersion[] | undefined, incoming: StillVersion[] | undefined): StillVersion[] {
  const out = [...(stored ?? [])]
  const seen = new Set(out.map(v => stillKey(v.url)))
  for (const v of incoming ?? []) if (!seen.has(stillKey(v.url))) { seen.add(stillKey(v.url)); out.push(v) }
  return out.slice(-MAX_STILL_VERSIONS)
}

/** Finished takes only, one per clip, the newest MAX_VIDEO_TAKES. */
function sanitizeVideoTakes(raw: unknown): ShotVideo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  let out: ShotVideo[] = []
  for (const r of raw.slice(-MAX_VIDEO_TAKES * 2)) {
    const v = sanitizeVideo(r)
    if (v && v.status === 'done' && v.url) out = addVideoTake(out, v)
  }
  return out.length ? out : undefined
}
/** A take added to a slot's list - an already-kept clip moves to the end rather than repeating. */
export function addVideoTake(list: ShotVideo[] | undefined, v: ShotVideo): ShotVideo[] {
  if (v.status !== 'done' || !v.url) return list ?? []
  const k = stillKey(v.url)
  return [...(list ?? []).filter(t => !t.url || stillKey(t.url) !== k), v].slice(-MAX_VIDEO_TAKES)
}

/** A shot's own refs: absent stays absent (automatic); an empty list means "none". */
function sanitizeShotRefs(raw: unknown): ShotRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: ShotRef[] = []
  for (const r of raw.slice(0, MAX_SHOT_REFS * 2) as any[]) {
    const url = str(r?.url, 2000)
    if (!/^https:\/\//.test(url) || seen.has(stillKey(url))) continue
    seen.add(stillKey(url))
    out.push({ id: str(r?.id, 64) || newId('r'), url, on: r?.on !== false, ...(str(r?.assetId, 64) ? { assetId: str(r?.assetId, 64) } : {}) })
  }
  return out.slice(0, MAX_SHOT_REFS)
}

function sanitizeStillJob(j: any): StillJob | undefined {
  if (!j || typeof j !== 'object' || !['queued', 'making', 'failed'].includes(j.status)) return undefined
  const at = Number(j.at)
  // The fal job a background still is waiting on: kept whole, or the save has nothing to go on
  const f = j.fal
  const fal: StillFalJob | undefined = f && typeof f === 'object' && typeof f.requestId === 'string' && typeof f.endpoint === 'string' ? {
    requestId: str(f.requestId, 200), endpoint: str(f.endpoint, 200), cost: Math.max(0, Math.round(Number(f.cost) || 0)),
    track: Number.isInteger(f.track) ? f.track : null, prompt: str(f.prompt, 5000), takePrompt: str(f.takePrompt, 4000), model: str(f.model, 60),
    ...(str(f.quality, 20) ? { quality: str(f.quality, 20) } : {}), aspect: str(f.aspect, 20),
    refs: Array.isArray(f.refs) ? f.refs.filter((u: unknown): u is string => typeof u === 'string').slice(0, 20) : [],
    conform: typeof f.conform === 'string' ? str(f.conform, 20) : null, name: str(f.name, 200),
    ...(f.patch && typeof f.patch === 'object' ? { patch: f.patch as Record<string, unknown> } : {}),
    ...(Number.isInteger(f.hfQueueId) && f.hfQueueId > 0 ? { hfQueueId: f.hfQueueId } : {}),
  } : undefined
  const savingAt = Number(j.savingAt)
  return {
    status: j.status, at: Number.isFinite(at) ? at : 0, model: str(j.model, 60) || undefined, error: str(j.error, 400) || undefined,
    ...(fal ? { fal } : {}), ...(Number.isFinite(savingAt) && savingAt > 0 ? { savingAt } : {}),
  }
}

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
    rawUrl: /^https:\/\//.test(str(v.rawUrl, 2000)) ? str(v.rawUrl, 2000) : null,
    rawSize: /^\d{2,5}x\d{2,5}$/.test(str(v.rawSize, 20)) ? str(v.rawSize, 20) : null,
    edit: v.edit && typeof v.edit === 'object' && str(v.edit.tool, 60)
      ? { tool: str(v.edit.tool, 60), label: str(v.edit.label, 80), of: str(v.edit.of, 2000), ...(str(v.edit.prompt, 1000) ? { prompt: str(v.edit.prompt, 1000) } : {}), ...(str(v.edit.lineId, 64) ? { lineId: str(v.edit.lineId, 64) } : {}) }
      : null,
  }
}

const audioStatus = (v: unknown): AudioStatus => (v === 'making' || v === 'done' || v === 'failed' ? v : 'idle')
const httpsOrNull = (v: unknown) => { const u = str(v, 2000); return /^https:\/\//.test(u) ? u : null }
function sanitizeLines(raw: unknown): VoiceLine[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: VoiceLine[] = []
  for (const r of raw.slice(0, MAX_LINES_PER_SHOT) as any[]) {
    if (!r || typeof r !== 'object') continue
    const off = Number(r.offset)
    out.push({
      id: str(r.id, 64) || newId('l'), speaker: str(r.speaker, 60) || 'Narrator', text: str(r.text, 600), voice: str(r.voice, 40) || 'Brian',
      model: STORYBOARD_VOICE_MODELS.some(m => m.id === r.model) ? r.model : DEFAULT_VOICE_MODEL,
      offset: Number.isFinite(off) ? Math.max(0, Math.min(30, Math.round(off * 10) / 10)) : 0.3,
      url: httpsOrNull(r.url), seconds: Number.isFinite(Number(r.seconds)) ? Math.max(0, Number(r.seconds)) : 0,
      status: audioStatus(r.status), error: str(r.error, 300) || null, at: Number.isFinite(Number(r.at)) ? Number(r.at) : 0,
      madeText: typeof r.madeText === 'string' ? r.madeText.slice(0, 600) : null, madeVoice: typeof r.madeVoice === 'string' ? r.madeVoice.slice(0, 40) : null,
    })
  }
  return out.length ? out : undefined
}
function sanitizeCue(r: any): MusicCue | undefined {
  if (!r || typeof r !== 'object') return undefined
  const g = Number(r.gainDb)
  return {
    id: str(r.id, 64) || newId('m'), prompt: str(r.prompt, 1500),
    model: STORYBOARD_MUSIC_MODELS.some(m => m.id === r.model) ? r.model : DEFAULT_MUSIC_MODEL,
    ...(r.gainDb != null && Number.isFinite(g) ? { gainDb: Math.max(-30, Math.min(0, g)) } : {}),
    url: httpsOrNull(r.url), seconds: Number.isFinite(Number(r.seconds)) ? Math.max(0, Number(r.seconds)) : 0,
    status: audioStatus(r.status), error: str(r.error, 300) || null, at: Number.isFinite(Number(r.at)) ? Number(r.at) : 0,
    madePrompt: typeof r.madePrompt === 'string' ? r.madePrompt.slice(0, 1500) : null,
  }
}
/**
 * The page's lines with the server's recordings: the words, voice and offset
 * are the page's; url / seconds / status come from what is stored (only the
 * audio route records). A line being recorded that a stale page does not
 * know yet is kept.
 */
export function mergeLines(stored: VoiceLine[] | undefined, incoming: VoiceLine[] | undefined): VoiceLine[] | undefined {
  const old = new Map((stored ?? []).map(l => [l.id, l]))
  const out: VoiceLine[] = (incoming ?? []).map(l => {
    const o = old.get(l.id)
    return o ? { ...l, url: o.url, seconds: o.seconds, status: o.status, error: o.error ?? null, at: o.at, madeText: o.madeText ?? null, madeVoice: o.madeVoice ?? null }
      : { ...l, url: null, seconds: 0, status: 'idle', error: null, at: 0, madeText: null, madeVoice: null }
  })
  const ids = new Set(out.map(l => l.id))
  for (const o of stored ?? []) if (!ids.has(o.id) && liveAudio(o) === 'making') out.push(o)
  return out.length ? out.slice(0, MAX_LINES_PER_SHOT) : undefined
}
/** The same for a shot's music cue. */
export function mergeCue(stored: MusicCue | null | undefined, incoming: MusicCue | null | undefined): MusicCue | undefined {
  if (!incoming) return stored && liveAudio(stored) === 'making' ? stored : undefined
  if (stored && stored.id === incoming.id) return { ...incoming, url: stored.url, seconds: stored.seconds, status: stored.status, error: stored.error ?? null, at: stored.at, madePrompt: stored.madePrompt ?? null }
  return { ...incoming, url: null, seconds: 0, status: 'idle', error: null, at: 0, madePrompt: null }
}

/**
 * The frame to ask a video model for: the board's when the model offers it,
 * else the closest one in the SAME ORIENTATION - a 3:4 board asks for 9:16, a
 * 4:3 or 21:9 board for 16:9 - so the clip is conformed by trimming the long
 * side only, at full resolution (never squeezed or upscaled). Square only when
 * the model has nothing in that orientation.
 *
 * Models that animate a still mostly ignore this and follow the still, which
 * is already in the board's frame (Kling 3.0: a 3:4 still renders 3:4).
 */
export function shootAspect(aspectOptions: string[] | undefined, boardAspect: string): string {
  const opts = (aspectOptions ?? []).filter(o => /^\d+:\d+$/.test(o))
  if (!opts.length || opts.includes(boardAspect)) return boardAspect
  const lr = (a: string) => { const [w, h] = a.split(':').map(Number); return Math.log(w / h) }
  const t = lr(boardAspect)
  const side = (x: number) => Math.sign(Math.round(x * 1000))   // -1 portrait, 0 square, 1 landscape
  const same = opts.filter(o => side(lr(o)) === side(t))
  const pool = same.length ? same : opts
  return pool.reduce((best, o) => (Math.abs(lr(o) - t) < Math.abs(lr(best) - t) - 1e-9 ? o : best))
}

/** Clean whatever arrived into a valid shot list - the server never stores raw client JSON. */
export function sanitizeShots(raw: unknown): StoryboardShot[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_SHOTS).map((r: any) => {
    const d = Number(r?.duration)
    const still = str(r?.stillUrl, 2000)
    // An id, or a label from a planner that wrote the name
    const im = STORYBOARD_IMAGE_MODELS.find(m => m.id === r?.imageModel || m.label === r?.imageModel)
    const imageModel = im?.id ?? DEFAULT_IMAGE_MODEL
    return newShot({
      id: str(r?.id, 64) || undefined,
      title: str(r?.title, 120),
      description: str(r?.description, 2000),
      imagePrompt: str(r?.imagePrompt, 4000),
      imageModel,
      imageQuality: str(r?.imageQuality, 12),
      imageOptions: sanitizeImageOptions(r?.imageOptions),
      stillUrl: /^https:\/\//.test(still) ? still : null,
      videoPrompt: str(r?.videoPrompt, 4000),
      videoModel: str(r?.videoModel, 60) || DEFAULT_VIDEO_MODEL,
      duration: Number.isFinite(d) ? Math.min(30, Math.max(1, Math.round(d * 2) / 2)) : 5,
      transition: str(r?.transition, 300) || 'Cut',
      keepWhole: r?.keepWhole === true ? true : undefined,
      sceneId: str(r?.sceneId, 64) || undefined,
      refs: sanitizeShotRefs(r?.refs),
      editOf: str(r?.editOf, 64) || undefined,
      aspect: (SHOT_ASPECTS as readonly string[]).includes(r?.aspect) ? r.aspect : undefined,
      beforeUrl: /^https:\/\//.test(str(r?.beforeUrl, 2000)) ? str(r?.beforeUrl, 2000) : undefined,
      caption: str(r?.caption, 60) || undefined,
      captionSub: str(r?.captionSub, 90) || undefined,
      stillJob: sanitizeStillJob(r?.stillJob),
      video: sanitizeVideo(r?.video),
      videos: sanitizeVideoTakes(r?.videos),
      stills: sanitizeStills(r?.stills, /^https:\/\//.test(still) ? still : null, str(r?.imagePrompt, 4000), imageModel),
      lines: sanitizeLines(r?.lines),
      music: sanitizeCue(r?.music),
    })
  })
}

export const totalSeconds = (shots: StoryboardShot[]) => shots.reduce((a, s) => a + (s.duration || 0), 0)
export const fmtRuntime = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`

// ── Final Cut ────────────────────────────────────────────────────────────────

/** The Stills cut's flat price: the render and one AI look at every frame for the captions. */
export const STILLS_CUT_TICKETS = 2
/**
 * A Final Cut's own cost on top of the shots it shoots: the edit plan (~$0.02),
 * title and end cards (~$0.20), the score (~$0.01 a second), the mix (~$0.05),
 * narration (~$0.05) - in tickets at the $0.04 of fal cost a ticket covers
 * (lib/ticket-pricing's margin rule). The page shows it; the route charges it.
 */
export function finalCutExtraTickets(o: { cards: boolean; narration: boolean; review?: boolean; formats?: string[]; cardStyle?: string; score?: string }, seconds: number, reuse: { score?: boolean } = {}): number {
  // Exact-text cards are our own render (free); designed cards are AI lettering
  const cards = o.cards ? (o.cardStyle === 'exact' ? 0.01 : 0.2) : 0
  // The critic (Gemini 4 Argon, ~$0.04 a look at the film, priced high while
  // Argon has no published price) twice at most, plus one re-plan and re-cut
  const review = o.review ? 0.12 : 0
  // Each extra format is one re-frame of the finished film (our own ffmpeg time)
  const formats = (o.formats?.length ?? 0) * (0.01 + seconds * 0.002)
  // The AI score (~$0.01 a second) only when it is composed: the board's own
  // music cues were paid for on the lane, and a revision may keep the last score
  const score = (o.score ?? 'ai') === 'ai' && !reuse.score ? seconds * 0.01 : 0
  const usd = 0.02 + cards + score + 0.05 + (o.narration ? 0.05 : 0) + review + formats
  return Math.ceil(usd / 0.04)
}

/** Extra shapes the Final Cut can also deliver (the board's own aspect is the main cut). */
export const FINAL_CUT_FORMATS = ['16:9', '9:16', '1:1', '4:5'] as const

/** What the Final Cut button is asked for. */
export type FinalCutOptions = {
  /** Title and end cards. */
  cards: boolean
  /**
   * 'designed' = AI lettering (Recraft v4.1, Ideogram v4 fallback);
   * 'exact' = the exact words set in type on a darkened frame of the film -
   * free and never misspelled (2026-10-19). A designed card that fails falls
   * back to an exact one instead of leaving the film without it.
   */
  cardStyle?: 'designed' | 'exact'
  /** Narration burned in as subtitles. */
  captions?: boolean
  /**
   * The critic (Nova Studio's: Gemini 4 Argon) watches the finished film -
   * frames and measured sound - against the story; if it says revise, ONE
   * automatic revision follows (re-plan with its notes, re-cut, re-mix).
   */
  review?: boolean
  /** Extra shapes delivered after the main cut (FINAL_CUT_FORMATS). */
  formats?: string[]
  /**
   * The music: 'board' = the audio lane's cues (2026-10-19), 'ai' = Sonilo
   * composes to the cut, 'none'. A board with no recorded cues falls back to 'ai'.
   */
  score?: 'board' | 'ai' | 'none'
  /** Lay the audio lane's recorded voice lines where they belong (default on). */
  lines?: boolean
  /** A narrator over the film (lines written by the edit plan, voiced by ElevenLabs). */
  narration: boolean
  voice: string
  /** Resolution for any shots it still has to shoot. */
  resolution: string
}
export const DEFAULT_FINAL_CUT_OPTIONS: FinalCutOptions = { cards: true, cardStyle: 'designed', narration: false, captions: false, review: true, formats: [], score: 'ai', lines: true, voice: 'Brian', resolution: '720p' }
export const NARRATOR_VOICES = ['Brian', 'George', 'Liam', 'Aria', 'Sarah', 'Laura', 'Charlotte', 'Daniel', 'Bill', 'Jessica'] as const

/** The steps, in order, as the page shows them. */
export const FINAL_CUT_PHASES = [
  { key: 'shoot', label: 'Shoot missing shots' },
  { key: 'plan', label: 'Plan the edit' },
  { key: 'cards', label: 'Title & end cards' },
  { key: 'cut', label: 'Cut the picture' },
  { key: 'voice', label: 'Voices' },
  { key: 'score', label: 'Music' },
  { key: 'mix', label: 'Mix & master' },
  { key: 'review', label: 'Critic review' },
  { key: 'save', label: 'Save the cut' },
  { key: 'formats', label: 'Other formats' },
] as const
export type FinalCutPhase = (typeof FINAL_CUT_PHASES)[number]['key']

export type FinalCutVersion = {
  n: number; url: string; durationSec: number; at: number; imageId: number | null; note: string
  /** A frame from the middle of the cut. Every cut opens on black (the title card fades in), so without it the player is a black box. */
  posterUrl?: string | null
  /** The scene this cut is of ("Scene 2 · The Chase"); absent = the whole board. */
  scene?: string | null
  /** The critic's verdict on this version (and whether a revision was made for it). */
  review?: { verdict: 'pass' | 'revise'; score: number; summary: string; revised: boolean; issues?: string[] } | null
  /** The same film in other shapes. */
  formats?: { aspect: string; url: string; imageId: number | null }[]
  /** What it was asked for, and its parts - a revision starts from these (its plan, score, cards). */
  options?: FinalCutOptions
  parts?: { plan?: unknown; musicUrl?: string | null; titleCard?: string | null; endCard?: string | null }
  /** A revision: the version it revised and the edits it was asked to make. */
  revisedFrom?: number | null
  edits?: string[]
}

/**
 * The Revise phase (2026-10-19): the user says what to change about a cut,
 * the edit AI turns it into an edit list - 'cut' items the Final Cut makes
 * itself (trims, order of emphasis, cards, lines' timing, music level), and
 * 'board' items that need the board changed first (a reshoot, a new line) -
 * and the cut is re-run with the list switched on. As often as it takes.
 */
export type ReviseEdit = { id: string; kind: 'cut' | 'board'; shot?: number | null; text: string; on: boolean }
export type ReviseDraft = { from: number; notes: string; summary: string; edits: ReviseEdit[]; rescore: boolean; at: number }
export const MAX_REVISE_EDITS = 12

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
    /** Cutting one scene (its id) instead of the whole board. */
    sceneId?: string | null
    /** Tickets charged for the cut's own work (finalCutExtraTickets) - refunded if it is cancelled or started over. */
    charged?: number
    /** A revision run: the version it starts from and the edits to make. */
    revise?: { from: number; edits: string[]; notes: string; rescore: boolean } | null
    /** Its generating tile in the feed (lib/studio-activity), while it runs. */
    trackId?: number | null
  } | null
  versions: FinalCutVersion[]
  /** The edit list being written / reviewed in the Revise phase. */
  revision?: ReviseDraft | null
}

/**
 * Shots the Final Cut can hold: the assembly route takes 16 clips (two are the
 * cards) and 2 minutes. A long board in scenes is cut a scene at a time.
 */
export const FINAL_CUT_MAX_SHOTS = 14
export const FINAL_CUT_MAX_SECONDS = 105

// ── Cast & sets: asset pictures made from an asset's description (2026-10-11) ──
//
// The views a kind gets, and their frame. The first is made from the
// description; every later one is an EDIT of the first (the same face, outfit,
// place), so the set stays consistent. Characters / creatures: front,
// three-quarter, back. A place: one wide view - another angle only as an edit
// of the first. An outfit: 1-3 (front, back, detail), the garments alone. A
// prop / vehicle: one, another angle as an edit. Used by the route and by the
// prices the page shows, so they agree.

export const ASSET_PICTURE_MODEL = 'nano-banana-2.1'
export const ASSET_PICTURE_QUALITY = '2k'
export type AssetView = { id: string; label: string; aspect: string }
const PLACE_KINDS = new Set(['location', 'landmark', 'scenery'])
const PERSON_KINDS = new Set(['character', 'creature'])
export const isPlaceKind = (k: string) => PLACE_KINDS.has(k)
export const isPersonKind = (k: string) => PERSON_KINDS.has(k)

/**
 * The views to make for an asset. `outfitViews` 1-3 (wardrobe only). `another`:
 * one more angle of an asset that has pictures (a place, a prop) - an edit of its first.
 */
export function assetViewPlan(kind: string, o: { outfitViews?: number; another?: boolean; boardAspect?: string } = {}): AssetView[] {
  const wide = o.boardAspect && ['16:9', '21:9', '4:3'].includes(o.boardAspect) ? o.boardAspect : '16:9'
  if (o.another) {
    if (PLACE_KINDS.has(kind)) return [{ id: 'angle', label: 'another angle', aspect: wide }]
    return [{ id: 'angle', label: 'another angle', aspect: kind === 'wardrobe' || PERSON_KINDS.has(kind) ? '3:4' : '1:1' }]
  }
  if (PERSON_KINDS.has(kind)) return [
    { id: 'front', label: 'front', aspect: '3:4' },
    { id: 'three-quarter', label: 'three-quarter', aspect: '3:4' },
    { id: 'back', label: 'back', aspect: '3:4' },
  ]
  if (kind === 'wardrobe') {
    const n = Math.min(3, Math.max(1, Math.round(o.outfitViews ?? 1)))
    return [{ id: 'front', label: 'front', aspect: '3:4' }, { id: 'back', label: 'back', aspect: '3:4' }, { id: 'detail', label: 'detail', aspect: '1:1' }].slice(0, n)
  }
  if (PLACE_KINDS.has(kind)) return [{ id: 'wide', label: 'wide', aspect: wide }]
  return [{ id: 'hero', label: 'hero', aspect: '1:1' }]
}

/** Tickets for an asset's pictures: the first from words, the rest edits of it (one reference each). */
export function assetPicturesTickets(kind: string, o: { outfitViews?: number; another?: boolean; boardAspect?: string } = {}): number {
  return assetViewPlan(kind, o).reduce((n, v, i) =>
    n + stillTickets(ASSET_PICTURE_MODEL, ASSET_PICTURE_QUALITY, v.aspect, undefined, o.another || i > 0 ? 1 : 0), 0)
}

/** The draft's suggested assets added to a board's (names it already has are skipped). */
export function addSuggestedAssets(assets: StoryAsset[], list: unknown): StoryAsset[] {
  if (!Array.isArray(list) || !list.length) return assets
  const have = new Set(assets.map(a => a.name.trim().toLowerCase()))
  const kinds = ASSET_KINDS.map(k => k.id) as string[]
  const out = [...assets]
  for (const raw of list as { kind?: string; name?: string; description?: string }[]) {
    const name = String(raw?.name ?? '').trim().slice(0, 80)
    if (!name || have.has(name.toLowerCase()) || out.length >= MAX_ASSETS) continue
    const kind = (kinds.includes(String(raw?.kind)) ? raw!.kind : 'other') as AssetKind
    have.add(name.toLowerCase())
    out.push({ ...newAsset(kind, name), notes: String(raw?.description ?? '').slice(0, 1000), suggested: true, auto: true })
  }
  return out
}
