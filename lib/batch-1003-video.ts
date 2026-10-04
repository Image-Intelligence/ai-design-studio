/**
 * The 2026-10-03 video batch (ADMIN ONLY while under test):
 *
 *   generators   H3 Max Lip Sync (a photo + a voice track -> a talking video),
 *                PixVerse Music Video (a song -> a music video), H3 Max Camera
 *                Controls (a photo -> a camera move through it), Happy Horse 1.1
 *                (image-to-video, or references)
 *   clip tools   VOID object removal, VEED Subtitles, H3 Max Insert Shot,
 *                Depth Anything Video, HeyGen Translate (precision / fast),
 *                Mirelo SFX 1.6 (adds synced sound effects)
 *
 * One place that decides which fal endpoint runs and builds its exact input.
 * app/api/video/generate calls these, and so do the test scripts, so what is
 * tested is what the site sends. Every field was checked against the live
 * schemas on 2026-10-03. Pricing: lib/ticket-pricing's batch1003TicketCost.
 */

export const BATCH_1003_GENERATORS = new Set([
  'minimax-h3-max-lipsync', 'pixverse-music-video', 'minimax-h3-max-camera', 'happy-horse-1.1',
  // second round: a talking photo with built-in voices, and video from a song or voice track
  'heygen-avatar4', 'ltx-2.5-audio-pro', 'ltx-2.5-audio-fast',
  // SeeDance 2.5 Draft -> Complete: re-renders a 480p draft at 1080p (no source clip - the draft's id)
  'seedance-2.5-complete',
])
/*
 * Promoted to public on 2026-10-04 after a priced, end-to-end run of each
 * through the portal UI. Everything else in the batch stays admin-only.
 */
export const BATCH_1003_PUBLIC = new Set([
  'happy-horse-1.1', 'pixverse-music-video', 'heygen-avatar4', 'ltx-2.5-audio-pro', 'ltx-2.5-audio-fast',
  'minimax-h3-max-lipsync', 'minimax-h3-max-camera', 'minimax-h3-max-insert',
  'void-video-removal', 'sam-3.1-video',
  // second wave, same day: captions, translation + dubbing, sound effects, depth
  'veed-subtitles', 'heygen-translate', 'heygen-translate-fast', 'elevenlabs-dubbing',
  'mirelo-sfx-video', 'depth-anything-video',
  // SeeDance 2.5 Draft -> Complete in 1080p, public together (2026-10-04)
  'seedance-2.5-complete',
])
export const BATCH_1003_TOOLS = new Set([
  'void-video-removal', 'veed-subtitles', 'minimax-h3-max-insert', 'depth-anything-video',
  'heygen-translate', 'heygen-translate-fast', 'mirelo-sfx-video',
  // second round: text-prompted masks that track through a clip, and audio-only dubbing
  'sam-3.1-video', 'elevenlabs-dubbing',
])
/** Tools that refuse to run without a prompt (VOID: what to remove; SAM: what to track). */
export const BATCH_1003_PROMPT_REQUIRED = new Set(['void-video-removal', 'sam-3.1-video'])
/** Generators driven by an uploaded audio track (audioUrl), not a prompt. */
export const BATCH_1003_AUDIO_DRIVEN = new Set(['minimax-h3-max-lipsync', 'pixverse-music-video', 'ltx-2.5-audio-pro', 'ltx-2.5-audio-fast'])
/** Generators that need a photo to start from. */
export const BATCH_1003_NEEDS_IMAGE = new Set(['minimax-h3-max-lipsync', 'minimax-h3-max-camera', 'heygen-avatar4'])
/** LTX 2.5 audio-to-video takes 2s of audio at least; Pro up to 10s, Fast up to 20s. */
export const LTX_AUDIO_MAX_SEC: Record<string, number> = { 'ltx-2.5-audio-pro': 10, 'ltx-2.5-audio-fast': 20 }

/** fal endpoints, keyed by model (Happy Horse 1.1 by `${model}-${mode}`). */
export const BATCH_1003_ENDPOINTS: Record<string, string> = {
  'minimax-h3-max-lipsync': 'minimax/h3-max/lip-sync/image-to-video',
  'pixverse-music-video': 'pixverse/music-video/vibemv',
  'minimax-h3-max-camera': 'minimax/h3-max/camera-controls',
  'happy-horse-1.1-i2v': 'alibaba/happy-horse/v1.1/image-to-video',
  'happy-horse-1.1-r2v': 'alibaba/happy-horse/v1.1/reference-to-video',
  'void-video-removal': 'fal-ai/void-video-inpainting',
  'veed-subtitles': 'veed/subtitles',
  'minimax-h3-max-insert': 'minimax/h3-max/insert-video',
  'depth-anything-video': 'fal-ai/depth-anything-video',
  'heygen-translate': 'fal-ai/heygen/v2/translate/precision',
  'heygen-translate-fast': 'fal-ai/heygen/v2/translate/speed',
  'mirelo-sfx-video': 'mirelo-ai/sfx1.6/video-to-video',
  'heygen-avatar4': 'fal-ai/heygen/avatar4/image-to-video',
  'ltx-2.5-audio-pro': 'lightricks/ltx-2.5/audio-to-video/pro',
  'ltx-2.5-audio-fast': 'lightricks/ltx-2.5/audio-to-video/fast',
  'seedance-2.5-complete': 'bytedance/seedance-2.5/draft/complete',
  'sam-3.1-video': 'fal-ai/sam-3-1/video',
  'elevenlabs-dubbing': 'fal-ai/elevenlabs/dubbing',
}

/** Happy Horse 1.1: references (r2v) when they are given, else a start frame (i2v). */
export function batch1003EndpointKey(model: string, p: { referenceImageUrls?: string[]; effectiveMode?: string }): string {
  if (model !== 'happy-horse-1.1') return model
  return p.effectiveMode === 'r2v' && (p.referenceImageUrls?.length ?? 0) > 0 ? 'happy-horse-1.1-r2v' : 'happy-horse-1.1-i2v'
}

// ── The choices each model offers (the portal's `choice` picker sends one) ──

/** VEED caption styles. The first nine are fal's "dynamic" tier, billed at 2x. */
export const VEED_DYNAMIC_PRESETS = ['glass', 'whisper', 'glide2', 'fusion', 'glide', 'terminal', 'handwritten', 'backdrop', 'backdrop2']
export const VEED_PRESETS = [...VEED_DYNAMIC_PRESETS, 'simple', 'plain', 'beans', 'corpo', 'boo', 'shadeplay', 'casper', 'capri', 'lowkey', 'vinta', 'diego', 'ali', 'slay', 'kitty', 'hustle', 'karl', 'sprout', 'flex', 'mint', 'rizz', 'vegas']
export const HEYGEN_LANGUAGES = ['English', 'Spanish', 'French', 'Hindi', 'Italian', 'German', 'Polish', 'Portuguese', 'Chinese', 'Japanese', 'Dutch', 'Turkish', 'Korean', 'Danish', 'Arabic', 'Romanian', 'Mandarin', 'Filipino', 'Swedish', 'Indonesian', 'Ukrainian', 'Greek']
export const DEPTH_COLORMAPS = ['turbo', 'grayscale', 'inferno', 'magma', 'viridis']
/** HeyGen Avatar IV's voices (fal's enum, 2026-10-03 - some names carry a trailing space there). */
export const HEYGEN_VOICES = ["Warm Pro Narrator","Chill Brian","Ivy","John Doe","Monika Sogam","Hope ","Archer ","Brittney","Patrick","David Castlemore","Michael C","Adam Stone ","Juniper","Cassidy ","Jessica Anne Bogart","Arabella","Andrew","Spuds Oxley ","Grace Elder","Helen","Canyon Rivers","Derya - Lifelike - Excited 🤩","Mellow Marcus","Jack Sterling - Broadcaster 🎙️","Brenda - UGC - 1.mp4","Reid","Reagan","Terry","Jenny","Radio Rick","Denise","Tim in car - Excited 🤩","Iskander","Thompson","Delicate Daisy - Excited 🤩","Kingston","George UGC 1","Bold Blake","Jane","Expressive Evan","Marianne - IA","Aaron","Modern Recipe Host - Voice 1","Willow","Cute Chloe - Friendly 😊","Rafael","June - Lifelike","Crisp Chloe","Slick Simon","Nassim - Informative","Baritone Ben","Maxwell","Ellie Faye - Excited 🤩","Milani","Feisty Fiona - Excited 🤩","Professor Dean","Rose - UGC - 1.mp4","Shona","Hudson Wilder","Ann - IA","Alastair Kensington","Oxley","Christina","Andrew Rizz ","Peyton","Gerardo - Outdoor","Chloe - Lifelike","Stephanie","Anthony - IA","Signal - Voice 1","Luca","Lisa - Voice 1","T.W.Tucker","Jack Sullivan - Serious 😐","Winter","Mireia - Lifelike","Georgia","Stella","Masha - Lifelike","Charming Charles - Friendly 😊","Serenity","Annie - Excited","Ralph","Bethany","Dominic","Mason Finn","Leena","Veteran Victor","Tamara","Nik Public","Calm Chloe","Sevik","Reilly","Raul","Imposing Ian","Relaxed Ray","Dexter - Professional","Relaxed Rick","Edwin","Rupert Blackwood","Ginny","Hope"]
/** ElevenLabs dubbing targets (ISO 639-1) with their names, the common ones first. */
export const DUB_LANGUAGES: [string, string][] = [['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ru', 'Russian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['sv', 'Swedish'], ['id', 'Indonesian'], ['fil', 'Filipino'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['cs', 'Czech'], ['ro', 'Romanian'], ['da', 'Danish'], ['fi', 'Finnish'], ['vi', 'Vietnamese'], ['en', 'English']]
export const PIXVERSE_MV_STYLES = ['Cinematic', 'Lo-fi', 'Dreamscape', 'Woolen Felt', 'Candy', 'Golden Age', 'Voxel', 'Retro Game', 'Claymation', 'Woodland Tale', 'Impressionism', 'Decadence', 'Futuristic', 'Chromatic Clash', 'Holiday']

/*
 * H3 Max camera moves, as keyframes. A pose is (azimuth: orbit angle, elevation:
 * height angle, distance: 1 = the photo's own framing, smaller = closer) at a
 * normalised time 0-1. The model holds the first pose before its time and the
 * last after it.
 */
type Pose = { time: number; azimuth: number; elevation: number; distance: number }
const P = (time: number, azimuth: number, elevation: number, distance: number): Pose => ({ time, azimuth, elevation, distance })
export const CAMERA_MOVES: Record<string, { label: string; keys: Pose[] }> = {
  'orbit-right': { label: 'Orbit right', keys: [P(0, 0, 0, 1), P(1, 60, 5, 1)] },
  'orbit-left': { label: 'Orbit left', keys: [P(0, 0, 0, 1), P(1, -60, 5, 1)] },
  'orbit-360': { label: 'Full orbit', keys: [P(0, 0, 5, 1), P(1, 360, 5, 1)] },
  'dolly-in': { label: 'Push in', keys: [P(0, 0, 0, 1), P(1, 0, 0, 0.55)] },
  'dolly-out': { label: 'Pull back', keys: [P(0, 0, 0, 0.8), P(1, 0, 5, 1.6)] },
  'crane-up': { label: 'Crane up', keys: [P(0, 0, 0, 1), P(1, 0, 40, 1.1)] },
  'crane-down': { label: 'Low angle sweep', keys: [P(0, 0, 25, 1.1), P(1, 0, -15, 0.9)] },
  'arc-push': { label: 'Arc + push', keys: [P(0, -25, 0, 1), P(1, 25, 10, 0.65)] },
}

export interface Batch1003Params {
  prompt: string
  imageUrl?: string | null
  referenceImageUrls?: string[]
  editVideoUrl?: string | null
  audioUrl?: string | null
  duration: string
  resolution: string
  aspectRatio: string
  effectiveMode?: string
  /** The model's single choice (caption style, language, colormap, camera move, visual style). */
  choice?: string
  /** H3 Max Insert Shot: where the new shot goes in the source, seconds. */
  insertStartSec?: number
  insertResumeSec?: number
  /** The source clip's measured length (tools that take a window of it). */
  sourceSec?: number
  /** The source clip's measured frame rate (VOID reads frames at it). */
  sourceFps?: number
  /** SeeDance 2.5 Complete: the draft to re-render (looked up server-side from the draft video). */
  draftId?: string
}

/** VOID's frame window for a clip: every source frame, snapped up to fal's steps (69, 77, ... 197). */
export function voidFrames(sourceSec?: number, sourceFps?: number): number {
  const need = Math.ceil((sourceSec && sourceSec > 0 ? sourceSec : 5) * (sourceFps && sourceFps > 0 ? sourceFps : 24))
  return Math.min(197, 69 + 8 * Math.ceil(Math.max(0, need - 69) / 8))
}
/** VOID writes its result at 12 fps whatever the source was. */
export const VOID_OUTPUT_FPS = 12

const pick = (allowed: readonly string[], v: string | undefined, fallback: string) => (v && allowed.includes(v) ? v : fallback)
/** MiniMax spells resolutions with a capital P. */
const mmRes = (r: string, allowed: string[], fallback: string) => pick(allowed, (r || '').toUpperCase(), fallback)

/** fal input for a 2026-10-03 generator or tool. */
export function batch1003Input(model: string, p: Batch1003Params): Record<string, any> {
  const prompt = (p.prompt ?? '').trim()
  const refs = (p.referenceImageUrls ?? []).filter(Boolean)
  const secs = Math.max(1, parseInt(p.duration) || 5)

  switch (model) {
    // ── Generators ──
    case 'minimax-h3-max-lipsync':
      // The output runs as long as the audio (5s minimum). Transcription helps
      // the mouth shapes; it is free.
      return {
        image_url: p.imageUrl, audio_url: p.audioUrl,
        resolution: mmRes(p.resolution, ['480P', '768P', '1080P'], '768P'),
        enable_transcription: true,
      }
    case 'pixverse-music-video': {
      // The prompt box carries the lyrics (shown as subtitles), when given
      const style = pick(PIXVERSE_MV_STYLES, p.choice, 'Cinematic')
      return {
        audio_url: p.audioUrl, style,
        aspect_ratio: pick(['16:9', '9:16', '1:1', '4:3', '3:4'], p.aspectRatio, '16:9'),
        resolution: pick(['720p', '1080p'], p.resolution, '720p'),
        ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
        ...(prompt ? { lyrics: prompt.slice(0, 4000) } : {}),
      }
    }
    case 'minimax-h3-max-camera': {
      const move = CAMERA_MOVES[p.choice ?? ''] ?? CAMERA_MOVES['arc-push']
      return {
        image_url: p.imageUrl, camera_trajectory: move.keys,
        duration: Math.min(15, Math.max(1, secs)),
        resolution: mmRes(p.resolution, ['480P', '768P', '1080P'], '768P'),
        prompt_expansion_mode: 'balanced',
        // Blank = the model's own "frozen scene, only the camera moves"
        ...(prompt ? { prompt } : {}),
      }
    }
    case 'happy-horse-1.1': {
      const base = {
        duration: Math.min(15, Math.max(3, secs)),
        resolution: pick(['720p', '1080p'], p.resolution, '1080p'),
      }
      if (batch1003EndpointKey(model, p) === 'happy-horse-1.1-r2v') {
        // References are named character1..character9 in the prompt, in order
        return {
          ...base, prompt: prompt.replace(/@Image(\d+)/gi, 'character$1'), image_urls: refs.slice(0, 9),
          aspect_ratio: pick(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', '5:4', '4:5'], p.aspectRatio, '16:9'),
        }
      }
      return { ...base, image_url: p.imageUrl || refs[0], ...(prompt ? { prompt } : {}) }
    }

    // ── Clip tools ──
    case 'void-video-removal': {
      // One box for the user: WHAT to remove. SAM-3 masks it from that text,
      // and the background prompt is written from it.
      // VOID reads num_frames frames of the source AT THE SOURCE'S RATE but
      // writes them at 12 fps (tested 2026-10-03: a 24 fps clip came back at
      // half speed; asked for 197 frames, a 5s clip came back 16.4s). So the
      // window is the clip's own frame count, and /api/video/status re-times
      // the result back to the source's speed (VOID_OUTPUT_FPS -> sourceFps).
      const frames = voidFrames(p.sourceSec, p.sourceFps)
      return {
        video_url: p.editVideoUrl, mask_prompt: prompt,
        prompt: `The same scene with ${prompt} completely removed - a clean, natural background that matches the lighting, perspective and motion of the shot.`,
        num_frames: frames,
      }
    }
    case 'veed-subtitles':
      return { video_url: p.editVideoUrl, preset: pick(VEED_PRESETS, p.choice, 'simple') }
    case 'minimax-h3-max-insert': {
      // The new shot replaces the source between start and resume; start must
      // be >= 1.625s (the schema) and resume after it, inside the clip
      const src = p.sourceSec && p.sourceSec > 0 ? p.sourceSec : 60
      const start = Math.min(Math.max(1.625, Number(p.insertStartSec) || 2), Math.max(1.625, src - 0.5))
      const resume = Math.min(src, Math.max(start, Number(p.insertResumeSec) || start))
      return {
        video_url: p.editVideoUrl, start_time: Math.round(start * 1000) / 1000, resume_time: Math.round(resume * 1000) / 1000,
        duration: Math.min(13, Math.max(5, secs)),
        resolution: pick(['480p', '768p'], p.resolution, '768p'),
        enable_prompt_expansion: true, color_match: true,
        ...(prompt ? { prompt } : {}),
        ...(refs.length ? { reference_image_urls: refs.slice(0, 4) } : {}),
      }
    }
    case 'depth-anything-video':
      return { video_url: p.editVideoUrl, colormap: pick(DEPTH_COLORMAPS, p.choice, 'turbo'), model: 'VDA-Large', resolution: 'auto' }
    case 'heygen-translate':
    case 'heygen-translate-fast':
      return { video_url: p.editVideoUrl, output_language: pick(HEYGEN_LANGUAGES, p.choice, 'Spanish') }
    case 'heygen-avatar4': {
      // A typed script in one of HeyGen's voices - or an uploaded track, which overrides both.
      // resolution and talking_style are legacy-path options: with aspect 'auto'
      // (the v3 path) fal fails the job outright ("requires the v3-compatible
      // ... path"), so they are only sent alongside a concrete aspect ratio.
      const aspect = pick(['16:9', '9:16', '4:5', '5:4', '1:1', 'auto'], p.aspectRatio, 'auto')
      return {
        image_url: p.imageUrl,
        aspect_ratio: aspect,
        ...(aspect === 'auto' ? {} : { resolution: pick(['360p', '480p', '540p', '720p', '1080p'], p.resolution, '720p'), talking_style: 'expressive' }),
        ...(p.audioUrl ? { audio_url: p.audioUrl } : { prompt: prompt.slice(0, 5000), voice: pick(HEYGEN_VOICES, p.choice, 'Warm Pro Narrator') }),
      }
    }
    case 'ltx-2.5-audio-pro':
    case 'ltx-2.5-audio-fast':
      return {
        audio_url: p.audioUrl,
        aspect_ratio: pick(['auto', '16:9', '9:16'], p.aspectRatio, 'auto'),
        ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
        ...(prompt ? { prompt } : {}),
      }
    case 'seedance-2.5-complete':
      // H.264, like every SeeDance 2.5 run here: fal's HEVC default plays black in desktop Chrome
      return { draft_id: p.draftId, resolution: '1080p', codec: 'H264' }
    case 'sam-3.1-video':
      // Comma-separated subjects are tracked together ("person, dog")
      return { video_url: p.editVideoUrl, prompt, apply_mask: true, video_output_type: 'X264 (.mp4)', detection_threshold: 0.5 }
    case 'elevenlabs-dubbing': {
      const lang = DUB_LANGUAGES.some(([c]) => c === p.choice) ? p.choice! : 'es'
      return { video_url: p.editVideoUrl, target_lang: lang, highest_resolution: true }
    }
    case 'mirelo-sfx-video':
      // One take (fal bills per sample), as long as the clip (max 60s)
      return {
        video_url: p.editVideoUrl, num_samples: 1,
        duration: Math.min(60, Math.max(1, Math.ceil(p.sourceSec && p.sourceSec > 0 ? p.sourceSec : 10))),
        ...(prompt ? { text_prompt: prompt } : {}),
      }
  }
  throw new Error(`Not a 2026-10-03 batch model: ${model}`)
}
