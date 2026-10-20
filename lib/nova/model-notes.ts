/**
 * Nova Studio - what the studio has learned about each model (client-safe, 2026-10-19).
 *
 * The catalog says what a model IS (price, refs, settings); these notes say
 * how it BEHAVES when you actually use it - how to prompt it, what it is
 * good at, how it fails - written from the productions made on this site
 * (the mascot ads, the social ads, the loops) and the model audits. Nova sees
 * a model's note when it looks the model up (browse_models with search, and
 * recommend_models), so it costs context only for the models in play.
 *
 * Keep notes short and factual; add one when a production teaches something.
 */

export const NOVA_MODEL_NOTES: Record<string, string> = {
  // ── image ──
  'nano-banana-2.1': 'The studio workhorse for people, products and consistency: with references it keeps a face, an outfit or a product very well (it switches to its edit endpoint by itself). Prompt in plain sentences: subject, setting, framing, light, mood; for an established character say "the same <who> from reference 1" and repeat their description. Good at small targeted edits ("change only his skin colour"). Text is decent but put exact words on with edit_image for ads. Can refuse (422) photoreal people + reference combos - shorten to "the person from the reference".',
  'nano-banana-pro': 'Slower and pricier sibling of NanoBanana 2.1 - strongest detail and text rendering of the family; use for hero stills and posters.',
  'seedream-5-pro': 'Strong photoreal and stylised stills, good multi-reference consistency, rich colour. A good second opinion when NanoBanana keeps missing.',
  'gpt-image-2.5': 'Follows long, detailed instructions and lays out text well.',
  'ideogram-v4-fast': 'The text specialist: posters, signs, packaging, logos with words - put the words in quotes, keep lines short. Cheap.',
  'ideogram-4.5': 'Higher-quality Ideogram for typography-led designs.',
  'recraft-v4-vector': 'Real vector-style logos and icons: flat colour, clean shapes. No image-to-image here.',
  'flux-3-image': 'Strong stylised art and illustration; follows style words well.',
  'z-image-turbo': 'Very cheap, fast drafts. Not for finals or references.',
  'flux-2': 'Clean photoreal at a low price.',
  'kling-o3-image': 'Reference-driven stills that match Kling video well - good keyframes for a Kling sequence.',
  // ── video ──
  'kling-v3': 'Premium motion and the best start->end frame model here; follows the start image\'s aspect. One action + one camera move per clip. It ADDS motion you did not ask for (bobbing, pushing in) - say "perfectly steady, never dipping or bouncing" / "locked-off camera" when you need stillness. For loops pass the same still as start and end. A colour or shape change between start and end frames lands around 2.5-4s of a 5s clip.',
  'seedance-1.5': 'Good motion on a budget, with start/end frames; slightly softer than Kling.',
  'seedance-2.0': 'Premium motion with native sound and multi-reference (characters, objects); expensive at 1080p.',
  'minimax-h3-max': 'Strong motion with start/end frames; handles creatures and fantasy action well (the paper dragon ad).',
  'vidu-q4': 'Premium motion; takes reference images ([@reference_image_N] tags are handled by the site).',
  'veo-3.1': 'Text-to-video with its OWN sound and spoken lines (put dialogue in quotes); premium price. veo-3.1-fast is the cheaper version.',
  'wan-3.0': 'Start/end frames and up to 9 references.',
  'ltx-2.5-pro': 'Fast and cheap, with start/end frames.',
  // ── tools on clips (edit_clip / talking_head) ──
  'minimax-h3-max-lipsync': 'Talking head from ONE still + a voice line, at 1080P: sharp, about 5x faster than OmniHuman, works on non-human faces (a glass orb, a chameleon). Refuses audio under 5s (talking_head pads it).',
  'omnihuman-v2': 'Talking or singing person from a photo + audio with natural body and hand movement; slower; prompt directs gestures and camera.',
  'mirelo-sfx2-video': 'Sound effects composed to the picture (keeps any speech) - the studio\'s go-to for a clip\'s sound. Mixed raw it is LOUD: in a cut put it about 3 LU under the voices (gain_db around -9).',
  'kling-o3-pro-edit': 'Change what is in a clip and keep its motion; pass the character\'s pictures as cast to fix a drifted face or costume. Clips 3-15s.',
  'minimax-h3-max-recast': 'Puts the cast picture\'s face on the person in the clip, keeping the performance (5-30s clips).',
  'void-video-removal': 'Removes an object or person and fills behind it (up to ~8s); reflections in water can keep faint ripples.',
  'bytedance-video-upscale': 'Clean upscale to 1080p/2K - same motion, same frames. Do it last, on the final clip.',
  'topaz-interpolate': '60fps frame interpolation - smooths judder; do it after editing.',
  // ── audio ──
  'eleven-v4': 'The character-voice model: expressive, consistent per voice. Keep one voice per character across all lines. Level each line to about -18 LUFS before mixing (assemble_cut normalises the mix).',
  'stable-audio-3': 'Instrumental music beds to an exact length; describe mood, instruments, tempo.',
  'eleven-music-v2.5': 'Songs and beds; beds come out about as loud as speech - put them well under a voice (-14 dB or more).',
  'eleven-sfx-v2': 'One sound effect per prompt; say how long.',
}

export const modelNote = (id: string): string | undefined => NOVA_MODEL_NOTES[id]
