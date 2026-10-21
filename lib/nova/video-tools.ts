/**
 * Nova Studio / Prism - every public video model that is not a plain
 * text/picture-to-video generator (server only, 2026-10-20).
 *
 * Owner: "make sure ALL of the public image, video and audio models are usable
 * by Prism and Nova studios, so the same issue as Pixelcut Looping Video
 * doesn't happen again". generate_video covers the generators, edit_clip the
 * Storyboard's curated clip tools and talking_head the lip-sync pair; these
 * are the rest - upscalers, reframes, translation and dubbing, subtitles,
 * extends, relight, camera moves, depth, tracking, background removal, audio-
 * driven video, motion transfer, Higgsfield's exclusives - run by ONE tool
 * (use_video_tool) from this table.
 *
 * Every entry mirrors what the portal sends to /api/video/generate (or the
 * Higgsfield route) for that model - field names, required inputs, the one
 * option and its values - mapped from app/admin/portal-v2 handleVideoGenerate
 * and the route's own checks. The route still bills, gates and validates
 * every run; this table only lets the agent ask correctly.
 */

export type VideoToolInputs = {
  /** The source clip -> editVideoUrl (sd20Mode 'edit'). */
  clip?: { maxSec?: number; minSec?: number; note?: string }
  /** Pictures: the first as imageUrl, or all as referenceImageUrls. */
  pictures?: { as: 'imageUrl' | 'referenceImageUrls'; max: number; required: boolean; label: string }
  /** A sound file -> audioUrl. */
  audio?: { required: boolean; label: string; minSec?: number; maxSec?: number }
  /** Kling Motion Control: the clip whose movement is copied -> motionVideoUrl. */
  motionClip?: { maxSec: number }
}
export type NovaVideoTool = {
  id: string
  label: string
  does: string
  route?: 'higgsfield'
  inputs: VideoToolInputs
  prompt: 'required' | 'optional' | 'none'
  promptIs?: string
  /** The model's one setting, sent as body[param]. */
  option?: { param: 'videoChoice' | 'lumaMode' | 'videoUpscaleFactor' | 'klingAspectRatio' | 'videoToolCreativity'; label: string; values: string[]; def: string }
  /** Sent as `duration`. */
  seconds?: { meaning: string; values: string[]; def: string }
  resolutions?: string[]
  /** H3 Max Insert Shot: where the new shot goes. */
  insert?: boolean
}

const LANGS = ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese', 'Mandarin', 'Hindi', 'Arabic', 'Dutch', 'Polish', 'Turkish', 'Swedish', 'Danish', 'Romanian', 'Greek', 'Ukrainian', 'Indonesian', 'Filipino', 'English']
const ISO = ['es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'hi', 'ar', 'ru', 'nl', 'pl', 'tr', 'sv', 'id', 'fil', 'uk', 'el', 'cs', 'ro', 'da', 'fi', 'vi', 'en']
const S = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
const FACTOR4 = { param: 'videoUpscaleFactor' as const, label: 'Factor', values: ['2', '3', '4'], def: '2' }
const clipOnly = (maxSec?: number): VideoToolInputs => ({ clip: { maxSec } })

export const NOVA_VIDEO_TOOLS: NovaVideoTool[] = [
  // ── change / edit a clip ──
  { id: 'kling-o3-4k-edit', label: 'Kling O3 4K Video Edit', does: 'Edit a clip with words at 4K, keeping its motion; style pictures as @Image1...', inputs: { clip: { minSec: 3, maxSec: 15 }, pictures: { as: 'referenceImageUrls', max: 4, required: false, label: 'style / cast pictures (@Image1...)' } }, prompt: 'required', promptIs: 'the change; the clip is @Video1' },
  { id: 'luma-ray-2-modify', label: 'Luma Ray 2 Modify', does: 'Restyle a clip (film stock, anime, claymation...) keeping its motion; a styled first frame steers it.', inputs: { clip: { maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 1, required: false, label: 'styled first frame' } }, prompt: 'optional', option: { param: 'lumaMode', label: 'How far', values: ['flex_1', 'adhere_1', 'adhere_2', 'adhere_3', 'flex_2', 'flex_3', 'reimagine_1', 'reimagine_2', 'reimagine_3'], def: 'flex_1' } },
  { id: 'lucy-edit-pro', label: 'Lucy Edit Pro', does: 'Edit a clip with words (wardrobe, objects, scene); 720p 16:9 out.', inputs: clipOnly(15), prompt: 'required' },
  { id: 'minimax-h3-max-relight', label: 'H3 Max Relight', does: 'Relight a clip to match a lit-sphere picture (the light direction and colour on a grey ball).', inputs: { clip: { maxSec: 15 }, pictures: { as: 'referenceImageUrls', max: 1, required: true, label: 'lit-sphere picture' } }, prompt: 'none', resolutions: ['1080p', '480p', '768p', '2k'] },
  { id: 'dreamactor-v2', label: 'DreamActor v2', does: 'Puts the character in a picture into the clip, copying its whole-body performance; output takes the picture\'s shape.', inputs: { clip: { maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 1, required: true, label: 'character picture' } }, prompt: 'none' },
  { id: 'higgsfield-genjutsu-motion', label: 'Genjutsu Motion Transfer', does: 'Higgsfield: characters from pictures perform the clip\'s motion.', route: 'higgsfield', inputs: { clip: { minSec: 4, maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 8, required: true, label: 'characters' } }, prompt: 'optional', resolutions: ['720p', '480p', '1080p'] },
  { id: 'higgsfield-genjutsu-swap', label: 'Genjutsu Object Swap', does: 'Higgsfield: swaps an object or character in the clip for the one in a picture (clip at least 640x640).', route: 'higgsfield', inputs: { clip: { minSec: 4, maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 8, required: true, label: 'what to swap in' } }, prompt: 'optional', resolutions: ['720p', '480p', '1080p'] },
  { id: 'higgsfield-genjutsu-lite-motion', label: 'Genjutsu Lite Motion Transfer', does: 'Higgsfield (cheaper Lite model): characters from pictures perform the clip\'s motion.', route: 'higgsfield', inputs: { clip: { minSec: 4, maxSec: 15 }, pictures: { as: 'referenceImageUrls', max: 8, required: true, label: 'characters' } }, prompt: 'optional', resolutions: ['720p', '480p', '1080p'] },
  { id: 'higgsfield-genjutsu-lite-swap', label: 'Genjutsu Lite Object Swap', does: 'Higgsfield (cheaper Lite model): swaps an object or character in the clip for the one in a picture.', route: 'higgsfield', inputs: { clip: { minSec: 4, maxSec: 15 }, pictures: { as: 'referenceImageUrls', max: 8, required: true, label: 'what to swap in' } }, prompt: 'optional', resolutions: ['720p', '480p', '1080p'] },
  // ── reframe ──
  { id: 'minimax-h3-max-reframe', label: 'H3 Max Reframe', does: 'Re-frames a clip to another aspect by painting in the new area, keeping its timing and sound.', inputs: clipOnly(15), prompt: 'optional', promptIs: 'what the new area should show', option: { param: 'klingAspectRatio', label: 'Target aspect', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'], def: '9:16' }, resolutions: ['768p', '480p', '1080p'] },
  { id: 'luma-ray-3.2-reframe', label: 'Luma Ray 3.2 Reframe', does: 'Re-frames a clip to another aspect by painting in the new area.', inputs: clipOnly(10), prompt: 'required', promptIs: 'what the new area should show', option: { param: 'klingAspectRatio', label: 'Target aspect', values: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'], def: '9:16' }, resolutions: ['720p', '540p', '1080p'] },
  { id: 'luma-ray-2-reframe', label: 'Luma Ray 2 Reframe', does: 'Re-frames a clip to another aspect (Ray 2).', inputs: { clip: { maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 1, required: false, label: 'first frame' } }, prompt: 'optional', option: { param: 'klingAspectRatio', label: 'Target aspect', values: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9', '9:21'], def: '9:16' } },
  { id: 'luma-ray-2-flash-reframe', label: 'Luma Ray 2 Flash Reframe', does: 'Re-frames a clip to another aspect (Ray 2 Flash, cheaper).', inputs: { clip: { maxSec: 30 }, pictures: { as: 'referenceImageUrls', max: 1, required: false, label: 'first frame' } }, prompt: 'optional', option: { param: 'klingAspectRatio', label: 'Target aspect', values: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9', '9:21'], def: '9:16' } },
  // ── length ──
  { id: 'pixverse-v6-extend', label: 'PixVerse V6 Extend', does: 'Continues a clip.', inputs: clipOnly(30), prompt: 'required', promptIs: 'what happens next', seconds: { meaning: 'seconds to add', values: S(1, 15), def: '5' }, resolutions: ['720p', '360p', '540p', '1080p'] },
  { id: 'minimax-h3-max-turbo-extend', label: 'H3 Max Turbo Extend', does: 'Continues a clip, fast.', inputs: { clip: { minSec: 1.6, maxSec: 60 } }, prompt: 'required', promptIs: 'what happens next', seconds: { meaning: 'seconds to add', values: S(1, 15), def: '5' }, resolutions: ['768p', '480p', '1080p', '2k'] },
  { id: 'veo-3.1-extend', label: 'Veo 3.1 Extend', does: 'Adds 7 seconds to a VEO-made clip (720p/1080p, 16:9 or 9:16).', inputs: { clip: { maxSec: 30, note: 'must be a Veo-made clip' } }, prompt: 'required', promptIs: 'what happens next' },
  { id: 'veo-3.1-fast-extend', label: 'Veo 3.1 Fast Extend', does: 'Adds 7 seconds to a VEO-made clip, faster and cheaper.', inputs: { clip: { maxSec: 30, note: 'must be a Veo-made clip' } }, prompt: 'required', promptIs: 'what happens next' },
  { id: 'minimax-h3-max-insert', label: 'H3 Max Insert Shot', does: 'Inserts a new shot into a clip between two moments (insert_start / insert_resume seconds) and blends back.', inputs: { clip: { minSec: 3.2, maxSec: 60 }, pictures: { as: 'referenceImageUrls', max: 4, required: false, label: 'what the new shot shows' } }, prompt: 'optional', seconds: { meaning: 'length of the inserted shot', values: ['5', '8', '10', '13'], def: '5' }, resolutions: ['768p', '480p'], insert: true },
  // ── quality ──
  { id: 'topaz-upscale-precision', label: 'Topaz Upscale Precision', does: 'Faithful upscale.', inputs: clipOnly(60), prompt: 'none', option: FACTOR4 },
  { id: 'topaz-upscale-creative', label: 'Topaz Upscale Creative', does: 'Upscale that adds detail (pricey).', inputs: clipOnly(60), prompt: 'optional', option: FACTOR4 },
  { id: 'topaz-upscale-generative', label: 'Topaz Upscale Starlight', does: 'Generative restoration upscale for soft or old footage.', inputs: clipOnly(60), prompt: 'none', option: FACTOR4 },
  { id: 'topaz-sdr-to-hdr', label: 'Topaz SDR to HDR', does: 'Converts a clip to HDR.', inputs: clipOnly(60), prompt: 'none' },
  { id: 'flashvsr-video', label: 'FlashVSR', does: 'Fast upscale, keeps the sound.', inputs: clipOnly(60), prompt: 'none', option: FACTOR4 },
  { id: 'flux-video-upscale', label: 'Flux Video Upscale', does: 'Upscale (Faithful or Creative).', inputs: clipOnly(20), prompt: 'optional', option: { param: 'videoUpscaleFactor', label: 'Factor', values: ['2', '1.5', '2.5', '3'], def: '2' } },
  { id: 'kandinsky6-vsr', label: 'Kandinsky 6 VSR', does: 'Upscale - only the first ~5s are processed.', inputs: clipOnly(5), prompt: 'none', option: { param: 'videoUpscaleFactor', label: 'Factor', values: ['2', '2.25', '4'], def: '2' } },
  { id: 'kandinsky6-vsr-lite', label: 'Kandinsky 6 VSR Lite', does: 'Cheaper upscale - only the first ~5s are processed.', inputs: clipOnly(5), prompt: 'none', option: { param: 'videoUpscaleFactor', label: 'Factor', values: ['2', '2.25', '4'], def: '2' } },
  // ── analysis / masks ──
  { id: 'depth-anything-video', label: 'Depth Anything Video', does: 'A depth-map video of the clip.', inputs: clipOnly(100), prompt: 'none', option: { param: 'videoChoice', label: 'Colours', values: ['turbo', 'grayscale', 'inferno', 'magma', 'viridis'], def: 'turbo' } },
  { id: 'sam-3.1-video', label: 'SAM 3.1 Track', does: 'Tracks and masks named things through the clip.', inputs: clipOnly(120), prompt: 'required', promptIs: 'what to track, comma-separated (e.g. "the dog, the ball")' },
  { id: 'pixelcut-video-bg-removal', label: 'Pixelcut Video Background Removal', does: 'Removes the background of a clip (transparent keeps an alpha channel, WebM).', inputs: clipOnly(60), prompt: 'none', option: { param: 'videoChoice', label: 'Background', values: ['transparent', 'green', 'black', 'white', 'blue', 'magenta'], def: 'transparent' } },
  // ── language / sound / text ──
  { id: 'heygen-translate', label: 'HeyGen Translate', does: 'Translates the speech in a clip into another language, lip-synced.', inputs: clipOnly(480), prompt: 'none', option: { param: 'videoChoice', label: 'Language', values: LANGS, def: 'Spanish' } },
  { id: 'heygen-translate-fast', label: 'HeyGen Translate Fast', does: 'Faster, cheaper speech translation.', inputs: clipOnly(480), prompt: 'none', option: { param: 'videoChoice', label: 'Language', values: LANGS, def: 'Spanish' } },
  { id: 'elevenlabs-dubbing', label: 'ElevenLabs Dubbing', does: 'Dubs the speech of a clip into another language (ISO code).', inputs: clipOnly(900), prompt: 'none', option: { param: 'videoChoice', label: 'Language', values: ISO, def: 'es' } },
  { id: 'veed-subtitles', label: 'VEED Subtitles', does: 'Burns animated subtitles of the speech into the clip (styles glide/glass/handwritten/backdrop/terminal/fusion cost 2x).', inputs: clipOnly(600), prompt: 'none', option: { param: 'videoChoice', label: 'Style', values: ['simple', 'plain', 'corpo', 'karl', 'mint', 'vegas', 'beans', 'hustle', 'rizz', 'lowkey', 'glide', 'glass', 'handwritten', 'backdrop', 'terminal', 'fusion'], def: 'simple' } },
  { id: 'mirelo-sfx-video', label: 'Mirelo SFX 1.6', does: 'Adds sound effects to a clip (the older Mirelo).', inputs: clipOnly(60), prompt: 'optional', promptIs: 'what the sounds should be' },
  // ── from a picture / sound (no clip) ──
  { id: 'minimax-h3-max-camera', label: 'H3 Max Camera Controls', does: 'A photo with a named camera move (the scene holds still, the camera moves).', inputs: { pictures: { as: 'imageUrl', max: 1, required: true, label: 'photo' } }, prompt: 'optional', option: { param: 'videoChoice', label: 'Camera move', values: ['arc-push', 'orbit-right', 'orbit-left', 'orbit-360', 'dolly-in', 'dolly-out', 'crane-up', 'crane-down'], def: 'arc-push' }, seconds: { meaning: 'length', values: ['5', '3', '4', '6', '8', '10', '12', '15'], def: '5' }, resolutions: ['1080p', '480p', '768p'] },
  { id: 'heygen-avatar4', label: 'HeyGen Avatar 4', does: 'A talking presenter from one photo: it says the prompt (the script, in a stock voice) or lip-syncs an audio_id.', inputs: { pictures: { as: 'imageUrl', max: 1, required: true, label: 'presenter photo' }, audio: { required: false, label: 'their own voice line (replaces the script)' } }, prompt: 'optional', promptIs: 'the script to say (up to 5000 characters) - required unless audio_id is given', option: { param: 'klingAspectRatio', label: 'Aspect', values: ['auto', '16:9', '9:16', '1:1', '4:5', '5:4'], def: 'auto' } },
  { id: 'ltx-2.5-audio-pro', label: 'LTX 2.5 Audio to Video Pro', does: 'A video that follows a sound file (2-10s), from a start picture and/or a prompt.', inputs: { audio: { required: true, label: 'sound (2-10s)', minSec: 2, maxSec: 10 }, pictures: { as: 'imageUrl', max: 1, required: false, label: 'start picture' } }, prompt: 'optional', option: { param: 'klingAspectRatio', label: 'Aspect', values: ['auto', '16:9', '9:16'], def: 'auto' } },
  { id: 'ltx-2.5-audio-fast', label: 'LTX 2.5 Audio to Video Fast', does: 'A video that follows a sound file (2-20s), faster.', inputs: { audio: { required: true, label: 'sound (2-20s)', minSec: 2, maxSec: 20 }, pictures: { as: 'imageUrl', max: 1, required: false, label: 'start picture' } }, prompt: 'optional', option: { param: 'klingAspectRatio', label: 'Aspect', values: ['auto', '16:9', '9:16'], def: 'auto' } },
  { id: 'pixverse-music-video', label: 'PixVerse Music Video', does: 'A music video that follows a song (10s-6min), optionally starring a character photo.', inputs: { audio: { required: true, label: 'the song', minSec: 10, maxSec: 360 }, pictures: { as: 'imageUrl', max: 1, required: false, label: 'character photo' } }, prompt: 'optional', promptIs: 'lyrics or direction', option: { param: 'videoChoice', label: 'Style', values: ['Cinematic', 'Lo-fi', 'Dreamscape', 'Woolen Felt', 'Candy', 'Golden Age', 'Voxel', 'Retro Game', 'Claymation', 'Woodland Tale', 'Impressionism', 'Decadence', 'Futuristic', 'Chromatic Clash', 'Holiday'], def: 'Cinematic' }, resolutions: ['1080p', '720p'] },
  { id: 'kling-v3-motion', label: 'Kling V3 Motion Control', does: 'The character in a picture performs the movement of a motion clip (dance, gesture).', inputs: { pictures: { as: 'imageUrl', max: 1, required: true, label: 'character picture' }, motionClip: { maxSec: 10 } }, prompt: 'optional' },
  { id: 'higgsfield-cinema-4', label: 'Cinema Studio 4.0', does: 'Higgsfield: cinematic shots from a prompt and references (pictures, clips, sound).', route: 'higgsfield', inputs: { pictures: { as: 'referenceImageUrls', max: 9, required: false, label: 'references' }, audio: { required: false, label: 'reference sound' } }, prompt: 'required', seconds: { meaning: 'length', values: S(4, 30), def: '8' }, resolutions: ['720p', '480p'], option: { param: 'klingAspectRatio', label: 'Aspect', values: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], def: '16:9' } },
]
export const novaVideoTool = (id: string) => NOVA_VIDEO_TOOLS.find(t => t.id === id)

/** One catalog line per tool, for the tool description. */
export function describeVideoTool(t: NovaVideoTool): string {
  const i = t.inputs
  const needs = [
    i.clip ? `video_id (the clip${i.clip.minSec || i.clip.maxSec ? `, ${i.clip.minSec ?? 1}-${i.clip.maxSec ?? 600}s` : ''}${i.clip.note ? `; ${i.clip.note}` : ''})` : '',
    i.pictures ? `picture_ids (${i.pictures.label}, max ${i.pictures.max}${i.pictures.required ? ', required' : ''})` : '',
    i.audio ? `audio_id (${i.audio.label}${i.audio.required ? ', required' : ''})` : '',
    i.motionClip ? `motion_video_id (the movement to copy, up to ${i.motionClip.maxSec}s)` : '',
    t.prompt !== 'none' ? `prompt${t.prompt === 'required' ? ' (required)' : ''}${t.promptIs ? `: ${t.promptIs}` : ''}` : '',
    t.option ? `option (${t.option.label}: ${t.option.values.join('|')}; default ${t.option.def})` : '',
    t.seconds ? `seconds (${t.seconds.meaning}: ${t.seconds.values.length > 6 ? `${t.seconds.values[0]}-${t.seconds.values[t.seconds.values.length - 1]}` : t.seconds.values.join('|')})` : '',
    t.resolutions ? `resolution (${t.resolutions.join('|')})` : '',
    t.insert ? 'insert_start + insert_resume (seconds in the clip)' : '',
  ].filter(Boolean)
  return `- ${t.id}: ${t.label} - ${t.does} Takes ${needs.join('; ')}.`
}
