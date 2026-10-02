/**
 * AUDIO STUDIO - the portal's audio models (public since 2026-10-02).
 *
 * One registry for everything the Audio section needs: which fal endpoint a
 * model submits to, which controls its prompt box shows, how those controls
 * become the fal input, where the result files are in the response, and what
 * a run costs. The portal UI, /api/audio/generate and /api/audio/status all
 * read it, so the price a user is shown is the price they are charged.
 *
 * Client-safe: no server imports.
 *
 * Every input shape was read from the endpoint's live OpenAPI schema
 * (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=...) and every
 * price from fal's pricing API or, where that is empty, the price the model
 * page states (2026-09-30). Rows are stored with model `audio:<id>` so feeds
 * can tell audio apart from images and videos by prefix, the way 3D uses `3d:`.
 *
 * Separate from lib/audio-models.ts, which is the Chat Hub's scoring tool.
 */

export const AUDIO_MODEL_PREFIX = 'audio:'
export const AUDIO_FILE_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']
export const isAudioUrl = (u: string) => /\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|#|$)/i.test(u)

export type AudioGroup = 'tts' | 'dialogue' | 'voice' | 'music' | 'sfx' | 'tools'

export const AUDIO_GROUPS: { key: AudioGroup; label: string; note: string; accent: string; dot: string }[] = [
  { key: 'tts', label: 'Text to Speech', note: 'natural voices from text', accent: 'text-sky-300', dot: 'bg-sky-400' },
  { key: 'dialogue', label: 'Dialogue', note: 'multi-speaker scenes', accent: 'text-violet-300', dot: 'bg-violet-400' },
  { key: 'voice', label: 'Voice Lab', note: 'clone, design and change voices', accent: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  { key: 'music', label: 'Music', note: 'songs and scores', accent: 'text-amber-300', dot: 'bg-amber-400' },
  { key: 'sfx', label: 'Sound Effects', note: 'foley and ambience', accent: 'text-emerald-300', dot: 'bg-emerald-400' },
  { key: 'tools', label: 'Audio Tools', note: 'clean, isolate and separate', accent: 'text-rose-300', dot: 'bg-rose-400' },
]

/** What a run is billed on (fal's unit). */
export type AudioPriceUnit =
  | 'kchar'     // per 1,000 characters of text
  | 'second'    // per second of OUTPUT
  | 'minute'    // per minute of OUTPUT
  | 'request'   // flat per run
  | 'inMinute'  // per minute of INPUT audio
  | 'inSecond'  // per second of INPUT audio

export interface AudioPrice {
  usd: number
  per: AudioPriceUnit
  /** For output-billed speech: seconds are estimated from the text at this rate. */
  charsPerSecond?: number
  /** A multiplier for outputs billed per file (e.g. a separation returns two). */
  outputs?: number
  /**
   * The output contains the INPUT too, and fal bills the whole output: ACE-Step
   * Extend returns source + extension (measured 2026-10-02: 20s + 20s = 39.9s).
   */
  outputIncludesInput?: boolean
}

/** The values the prompt box collects. */
export interface AudioRunInput {
  text: string
  lyrics?: string
  style?: string
  voice?: string
  voice2?: string
  language?: string
  duration?: number
  instrumental?: boolean
  audioUrl?: string
}

export interface AudioOutput { url: string; label?: string }

export interface AudioStudioModel {
  /** Stored as `audio:<id>`. */
  id: string
  name: string
  group: AudioGroup
  provider: string
  endpoint: string
  blurb: string
  /** The main text box. */
  text?: { label: string; placeholder: string; max: number; required: boolean }
  lyrics?: { required: boolean; max: number; placeholder?: string }
  style?: { label: string; placeholder: string }
  voices?: { options: string[]; default: string; label?: string }
  /** Second voice, for two-speaker dialogue. */
  voice2?: { options: string[]; default: string }
  languages?: { options: string[]; default: string }
  /** Seconds. `options` makes it a picker instead of a slider. */
  duration?: { min: number; max: number; default: number; step?: number; options?: number[] }
  instrumental?: boolean
  /**
   * An uploaded input. `clonesVoice`: the model copies the voice in it, so the
   * user must confirm they own it or have the speaker's permission - checked
   * by /api/audio/generate, not just the checkbox.
   */
  audioIn?: { label: string; required: boolean; maxMinutes: number; hint?: string; clonesVoice?: boolean }
  price: AudioPrice
  build: (i: AudioRunInput) => Record<string, unknown>
  outputs: (data: any) => AudioOutput[]
}

// ─────────────────────────────────────────────────────────────────────────────
// voices (from the endpoints' own enums)
// ─────────────────────────────────────────────────────────────────────────────
const GEMINI_VOICES = ["Achernar","Achird","Algenib","Algieba","Alnilam","Aoede","Autonoe","Callirrhoe","Charon","Despina","Enceladus","Erinome","Fenrir","Gacrux","Iapetus","Kore","Laomedeia","Leda","Orus","Pulcherrima","Puck","Rasalgethi","Sadachbia","Sadaltager","Schedar","Sulafat","Umbriel","Vindemiatrix","Zephyr","Zubenelgenubi"]
const GEMINI_LANGS = ["Arabic (Egypt)","Bangla (Bangladesh)","Dutch (Netherlands)","English (India)","English (US)","French (France)","German (Germany)","Hindi (India)","Indonesian (Indonesia)","Italian (Italy)","Japanese (Japan)","Korean (South Korea)","Marathi (India)","Polish (Poland)","Portuguese (Brazil)","Romanian (Romania)","Russian (Russia)","Spanish (Spain)","Tamil (India)","Telugu (India)","Thai (Thailand)","Turkish (Turkey)","Ukrainian (Ukraine)","Vietnamese (Vietnam)","Afrikaans (South Africa)","Albanian (Albania)","Amharic (Ethiopia)","Arabic (World)","Armenian (Armenia)","Azerbaijani (Azerbaijan)","Basque (Spain)","Belarusian (Belarus)","Bulgarian (Bulgaria)","Burmese (Myanmar)","Catalan (Spain)","Cebuano (Philippines)","Chinese Mandarin (China)","Chinese Mandarin (Taiwan)","Croatian (Croatia)","Czech (Czech Republic)","Danish (Denmark)","English (Australia)","English (UK)","Estonian (Estonia)","Filipino (Philippines)","Finnish (Finland)","French (Canada)","Galician (Spain)","Georgian (Georgia)","Greek (Greece)","Gujarati (India)","Haitian Creole (Haiti)","Hebrew (Israel)","Hungarian (Hungary)","Icelandic (Iceland)","Javanese (Java)","Kannada (India)","Konkani (India)","Lao (Laos)","Latin (Vatican City)","Latvian (Latvia)","Lithuanian (Lithuania)","Luxembourgish (Luxembourg)","Macedonian (North Macedonia)","Maithili (India)","Malagasy (Madagascar)","Malay (Malaysia)","Malayalam (India)","Mongolian (Mongolia)","Nepali (Nepal)","Norwegian Bokmal (Norway)","Norwegian Nynorsk (Norway)","Odia (India)","Pashto (Afghanistan)","Persian (Iran)","Portuguese (Portugal)","Punjabi (India)","Serbian (Serbia)","Sindhi (India)","Sinhala (Sri Lanka)","Slovak (Slovakia)","Slovenian (Slovenia)","Spanish (Latin America)","Spanish (Mexico)","Swahili (Kenya)","Swedish (Sweden)","Urdu (Pakistan)"]
const INWORLD_VOICES = ["Loretta (en)","Darlene (en)","Marlene (en)","Hank (en)","Evelyn (en)","Celeste (en)","Pippa (en)","Tessa (en)","Liam (en)","Callum (en)","Hamish (en)","Abby (en)","Graham (en)","Rupert (en)","Mortimer (en)","Snik (en)","Anjali (en)","Saanvi (en)","Arjun (en)","Claire (en)","Oliver (en)","Simon (en)","Elliot (en)","James (en)","Serena (en)","Gareth (en)","Vinny (en)","Lauren (en)","Jessica (en)","Ethan (en)","Tyler (en)","Jason (en)","Chloe (en)","Veronica (en)","Victoria (en)","Miranda (en)","Sebastian (en)","Victor (en)","Malcolm (en)","Kayla (en)","Nate (en)","Jake (en)","Brian (en)","Amina (en)","Kelsey (en)","Derek (en)","Grant (en)","Evan (en)","Alex (en)","Ashley (en)","Craig (en)","Deborah (en)","Dennis (en)","Edward (en)","Elizabeth (en)","Hades (en)","Julia (en)","Pixie (en)","Mark (en)","Olivia (en)","Priya (en)","Ronald (en)","Sarah (en)","Shaun (en)","Theodore (en)","Timothy (en)","Wendy (en)","Dominus (en)","Hana (en)","Clive (en)","Carter (en)","Blake (en)","Luna (en)","Yichen (zh)","Xiaoyin (zh)","Xinyi (zh)","Jing (zh)","Erik (nl)","Katrien (nl)","Lennart (nl)","Lore (nl)","Alain (fr)","Hélène (fr)","Mathieu (fr)","Étienne (fr)","Johanna (de)","Josef (de)","Gianni (it)","Orietta (it)","Asuka (ja)","Satoshi (ja)","Hyunwoo (ko)","Minji (ko)","Seojun (ko)","Yoona (ko)","Szymon (pl)","Wojciech (pl)","Heitor (pt)","Maitê (pt)","Diego (es)","Lupita (es)","Miguel (es)","Rafael (es)","Svetlana (ru)","Elena (ru)","Dmitry (ru)","Nikolai (ru)","Riya (hi)","Manoj (hi)","Yael (he)","Oren (he)","Nour (ar)","Omar (ar)"]
const XAI_VOICES = ["carina","zagan","helix","orion","luna","iris","altair","zenith","perseus","helios","lux","kepler","rigel","cosmo","celeste","ursa","sirius","lumen","castor","naksh","atlas","aurora","liora","ara","eve","leo","rex","sal"]
const XAI_LANGS = ["auto","en","ar-EG","ar-SA","ar-AE","bn","zh","fr","de","hi","id","it","ja","ko","pt-BR","pt-PT","ru","es-MX","es-ES","tr","vi"]
const QWEN3_VOICES = ["Vivian","Serena","Uncle_Fu","Dylan","Eric","Ryan","Aiden","Ono_Anna","Sohee"]
const QWEN_LANGS = ["Auto","English","Chinese","Spanish","French","German","Italian","Japanese","Korean","Portuguese","Russian"]
const QWEN_AUDIO3_VOICES = ["Cherry","Serena","Ethan","Chelsie","Momo","Vivian","Moon","Maia","Kai","Nofish","Bella","Jennifer","Ryan","Katerina","Aiden","Mia","Mochi","Bellona","Vincent","Bunny","Neil","Elias","Arthur","Nini","Seren","Pip","Stella","Bodega","Sonrisa","Alek","Dolce","Sohee","Lenn","Emilien","Andre","Jada","Dylan","Li","Marcus","Roy","Peter","Sunny","Eric","Rocky","Kiki"]
const QWEN_AUDIO3_LANGS = ["Auto","Chinese","English","Spanish","Russian","Italian","French","Korean","Japanese","German","Portuguese"]
const CHATTERBOX_HD_VOICES = ["Aurora","Blade","Britney","Carl","Cliff","Richard","Rico","Siobhan","Vicky"]
const CHATTERBOX_LANGS = ["english","arabic","danish","german","greek","spanish","finnish","french","hebrew","hindi","italian","japanese","korean","malay","dutch","norwegian","polish","portuguese","russian","swedish","swahili","turkish","chinese"]
const SEED_SPEECH_VOICES = ["vivi_mixed_en_zh_ja_es_id","mindy_en_es_id_pt_zh","stokie_en","dacey_en","tim_en","kian_en_zh","cedric_en_zh","sophie_en_zh","jean_en_zh","magnus_en_zh","mabel_en_zh","nadia_en_zh","opal_en_zh","pearl_en_zh","quentin_en_zh","vienna_mixed_en_zh","alina_mixed_en_zh","corinne_mixed_en_zh","esther_mixed_en_zh","freya_mixed_en_zh","gigi_mixed_en_zh","holly_mixed_en_zh","lyla_mixed_en_zh","daisy_mixed_en_zh","tracy_es_zh","jess_ja_es_id_pt_en_zh","pinky_es_ko_mixed_en_zh","sweety_ja_es","sandy_es_mixed_en_zh","sven_de","minimi_ja","usseau_fr","felipe_es","han_id","martins_pt","enzo_it","shane_ko","bonnie_zh","felix_zh","celeste_zh","monkey_king_zh"]
const ORPHEUS_VOICES = ["tara","leah","jess","leo","dan","mia","zac","zoe"]
const KOKORO_VOICES = ["af_heart","af_alloy","af_aoede","af_bella","af_jessica","af_kore","af_nicole","af_nova","af_river","af_sarah","af_sky","am_adam","am_echo","am_eric","am_fenrir","am_liam","am_michael","am_onyx","am_puck","am_santa"]
const MINIMAX_LANGS = ["Chinese","Chinese,Yue","English","Arabic","Russian","Spanish","French","Portuguese","German","Turkish","Dutch","Ukrainian","Vietnamese","Indonesian","Japanese","Italian","Korean","Thai","Polish","Romanian","Greek","Czech","Finnish","Hindi","Bulgarian","Danish","Hebrew","Malay","Slovak","Swedish","Croatian","Hungarian","Norwegian","Slovenian","Catalan","Nynorsk","Afrikaans","auto"]
/** ElevenLabs premade voices (the endpoint takes a name or a cloned voice id). */
const ELEVEN_VOICES = ['Rachel', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill']
/** MiniMax system voices (voice_setting.voice_id). */
const MINIMAX_VOICES = ['Wise_Woman', 'Friendly_Person', 'Inspirational_girl', 'Deep_Voice_Man', 'Calm_Woman', 'Casual_Guy', 'Lively_Girl', 'Patient_Man', 'Young_Knight', 'Determined_Man', 'Lovely_Girl', 'Decent_Boy', 'Imposing_Manner', 'Elegant_Man', 'Abbess', 'Sweet_Girl_2', 'Exuberant_Girl']
const VIBEVOICE_PRESETS = ['Alice [EN]', 'Carter [EN]', 'Frank [EN]', 'Maya [EN]', 'Mary [EN] (Background Music)', 'Bowen [ZH]', 'Xinran [ZH]', 'Anchen [ZH] (Background Music)']

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────
const t = (label: string, placeholder: string, max: number, required = true) => ({ label, placeholder, max, required })
const SPEECH = (max: number) => t('Text', 'Type what the voice should say…', max)
/** fal File objects: `{ url }`, possibly null. */
const one = (label?: string) => (f: any): AudioOutput[] => (f?.url ? [{ url: f.url, label }] : [])
const audioOut = (d: any) => one()(d?.audio ?? d?.audios?.[0])
const clean = <T extends Record<string, unknown>>(o: T): T => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '') delete o[k]; return o }

/** "A: line" / "B: line" (any name) - speakers in order of first appearance. */
export function parseDialogue(text: string): { speaker: number; text: string }[] {
  const names: string[] = []
  const out: { speaker: number; text: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([^:]{1,24}):\s*(.+)$/)
    if (m) {
      let i = names.indexOf(m[1].trim())
      if (i < 0) { names.push(m[1].trim()); i = names.length - 1 }
      out.push({ speaker: Math.min(i, 1), text: m[2] })
    } else if (out.length) out[out.length - 1].text += ' ' + line
    else out.push({ speaker: 0, text: line })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// registry
// ─────────────────────────────────────────────────────────────────────────────
const elevenTts = (id: string, name: string, endpoint: string, usd: number, blurb: string): AudioStudioModel => ({
  id, name, group: 'tts', provider: 'ElevenLabs', endpoint, blurb,
  text: SPEECH(5000),
  voices: { options: ELEVEN_VOICES, default: 'Rachel' },
  price: { usd, per: 'kchar' },
  build: i => clean({ text: i.text, voice: i.voice || 'Rachel' }),
  outputs: audioOut,
})
const geminiTts = (id: string, name: string, endpoint: string, usd: number, blurb: string): AudioStudioModel => ({
  id, name, group: 'tts', provider: 'Google', endpoint, blurb,
  text: SPEECH(8000),
  style: { label: 'Delivery', placeholder: 'e.g. warm and slow, whispering, excited sports announcer' },
  voices: { options: GEMINI_VOICES, default: 'Kore' },
  price: { usd, per: 'kchar' },
  build: i => clean({ prompt: i.text, voice: i.voice || 'Kore', style_instructions: i.style }),
  outputs: audioOut,
})
const minimaxTts = (id: string, name: string, endpoint: string, usd: number, blurb: string): AudioStudioModel => ({
  id, name, group: 'tts', provider: 'MiniMax', endpoint, blurb,
  text: SPEECH(10000),
  voices: { options: MINIMAX_VOICES, default: 'Wise_Woman' },
  languages: { options: ['Auto', ...MINIMAX_LANGS], default: 'Auto' },
  price: { usd, per: 'kchar' },
  build: i => clean({ prompt: i.text, output_format: 'url', voice_setting: { voice_id: i.voice || 'Wise_Woman', speed: 1, vol: 1, pitch: 0 }, language_boost: i.language && i.language !== 'Auto' ? i.language : undefined }),
  outputs: audioOut,
})

export const AUDIO_STUDIO_MODELS: AudioStudioModel[] = [
  // ── Text to Speech ─────────────────────────────────────────────────────────
  elevenTts('eleven-v4', 'ElevenLabs v4', 'elevenlabs/tts/eleven-v4', 0.08, 'ElevenLabs’ newest and most expressive voice model.'),
  elevenTts('eleven-v4-turbo', 'ElevenLabs v4 Turbo', 'elevenlabs/tts/eleven-v4-turbo', 0.04, 'v4 quality at half the price and much lower latency.'),
  elevenTts('eleven-v3', 'ElevenLabs v3', 'fal-ai/elevenlabs/tts/eleven-v3', 0.1, 'Highly expressive; understands [whispers], [laughs] and other audio tags.'),
  elevenTts('eleven-multilingual-v2', 'ElevenLabs Multilingual v2', 'fal-ai/elevenlabs/tts/multilingual-v2', 0.1, 'Stable, lifelike speech in 29 languages.'),
  elevenTts('eleven-turbo-v2.5', 'ElevenLabs Turbo v2.5', 'fal-ai/elevenlabs/tts/turbo-v2.5', 0.05, 'Fast, low-cost speech in 32 languages.'),
  geminiTts('gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS', 'google/gemini-3.8-flash-tts', 0.045, 'Google’s steerable voices: describe the delivery in plain words.'),
  geminiTts('gemini-3.8-flash-lite-tts', 'Gemini 3.8 Flash Lite TTS', 'google/gemini-3.8-flash-lite-tts', 0.03, 'The lighter, cheaper Gemini 3.8 voice.'),
  {
    ...geminiTts('gemini-3.1-flash-tts', 'Gemini 3.1 Flash TTS', 'fal-ai/gemini-3.1-flash-tts', 0.05, 'Gemini 3.1 voices in 80+ languages.'),
    languages: { options: ['Auto', ...GEMINI_LANGS], default: 'Auto' },
    build: i => clean({ prompt: i.text, voice: i.voice || 'Kore', style_instructions: i.style, output_format: 'mp3', language_code: i.language && i.language !== 'Auto' ? i.language : undefined }),
  },
  minimaxTts('minimax-speech-2.8-hd', 'MiniMax Speech 2.8 HD', 'fal-ai/minimax/speech-2.8-hd', 0.1, 'Studio-grade MiniMax voices with emotion and language boost.'),
  minimaxTts('minimax-speech-2.8-turbo', 'MiniMax Speech 2.8 Turbo', 'fal-ai/minimax/speech-2.8-turbo', 0.06, 'Faster, cheaper MiniMax 2.8.'),
  {
    id: 'inworld-tts', name: 'Inworld TTS 1.5 Max', group: 'tts', provider: 'Inworld', endpoint: 'fal-ai/inworld-tts',
    blurb: 'Over 100 character voices across many languages, at a very low price.',
    text: SPEECH(2000), voices: { options: INWORLD_VOICES, default: 'Craig (en)' },
    price: { usd: 0.01, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'Craig (en)' }), outputs: audioOut,
  },
  {
    id: 'xai-tts', name: 'xAI Grok TTS', group: 'tts', provider: 'xAI', endpoint: 'xai/tts/v1',
    blurb: 'Grok’s voices, 28 of them, in 20 languages.',
    text: SPEECH(15000), voices: { options: XAI_VOICES, default: 'eve' }, languages: { options: XAI_LANGS, default: 'auto' },
    price: { usd: 0.015, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'eve', language: i.language || 'auto' }), outputs: audioOut,
  },
  {
    id: 'qwen3-tts', name: 'Qwen 3 TTS', group: 'tts', provider: 'Alibaba', endpoint: 'fal-ai/qwen-3-tts/text-to-speech/1.7b',
    blurb: 'Alibaba’s open voice model; steer it with an instruction.',
    text: SPEECH(5000), style: { label: 'Instruction', placeholder: 'e.g. speak cheerfully, like a radio host' },
    voices: { options: QWEN3_VOICES, default: 'Vivian' }, languages: { options: QWEN_LANGS, default: 'Auto' },
    price: { usd: 0.09, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'Vivian', language: i.language || 'Auto', prompt: i.style }), outputs: audioOut,
  },
  {
    id: 'qwen-audio-3-tts', name: 'Qwen Audio 3 TTS', group: 'tts', provider: 'Alibaba', endpoint: 'alibaba/qwen-audio-3-tts',
    blurb: '45 voices, including dialects, from Qwen Audio 3.',
    text: SPEECH(2000), voices: { options: QWEN_AUDIO3_VOICES, default: 'Cherry' }, languages: { options: QWEN_AUDIO3_LANGS, default: 'Auto' },
    price: { usd: 0.05, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'Cherry', language: i.language || 'Auto' }), outputs: audioOut,
  },
  {
    id: 'chatterbox-hd', name: 'Chatterbox HD', group: 'tts', provider: 'Resemble AI', endpoint: 'resemble-ai/chatterboxhd/text-to-speech',
    blurb: 'Emotive speech; attach a short voice sample to clone any voice.',
    text: SPEECH(3000), voices: { options: CHATTERBOX_HD_VOICES, default: 'Aurora' },
    audioIn: { label: 'Voice to clone (optional)', required: false, maxMinutes: 1, hint: '5-20 seconds of clean speech', clonesVoice: true },
    price: { usd: 0.04, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.audioUrl ? undefined : (i.voice || 'Aurora'), audio_url: i.audioUrl, high_quality_audio: true }), outputs: audioOut,
  },
  {
    id: 'chatterbox-multilingual', name: 'Chatterbox Multilingual', group: 'tts', provider: 'Resemble AI', endpoint: 'fal-ai/chatterbox/text-to-speech/multilingual',
    blurb: 'Open-source Chatterbox in 23 languages. Short lines (300 characters).',
    text: SPEECH(300), voices: { options: CHATTERBOX_LANGS, default: 'english', label: 'Language' },
    price: { usd: 0.025, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'english' }), outputs: audioOut,
  },
  {
    id: 'seed-speech-v2', name: 'ByteDance Seed Speech', group: 'tts', provider: 'ByteDance', endpoint: 'fal-ai/bytedance/seed-speech/tts/v2',
    blurb: 'ByteDance’s voices, many of them multilingual.',
    text: SPEECH(5000), style: { label: 'Voice instruction', placeholder: 'optional, e.g. calm and reassuring' },
    voices: { options: SEED_SPEECH_VOICES, default: 'stokie_en' },
    price: { usd: 0.03, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'stokie_en', voice_instruction: i.style, output_format: 'mp3' }), outputs: audioOut,
  },
  {
    id: 'orpheus-tts', name: 'Orpheus TTS', group: 'tts', provider: 'Canopy Labs', endpoint: 'fal-ai/orpheus-tts',
    blurb: 'Human-sounding open voices that can <laugh> and <sigh>.',
    text: SPEECH(3000), voices: { options: ORPHEUS_VOICES, default: 'tara' },
    price: { usd: 0.05, per: 'kchar' },
    build: i => clean({ text: i.text, voice: i.voice || 'tara' }), outputs: audioOut,
  },
  {
    id: 'kokoro', name: 'Kokoro', group: 'tts', provider: 'Kokoro', endpoint: 'fal-ai/kokoro/american-english',
    blurb: 'Tiny, fast, clean American-English voices.',
    text: SPEECH(5000), voices: { options: KOKORO_VOICES, default: 'af_heart' },
    price: { usd: 0.02, per: 'kchar' },
    build: i => clean({ prompt: i.text, voice: i.voice || 'af_heart' }), outputs: audioOut,
  },

  // ── Dialogue ───────────────────────────────────────────────────────────────
  {
    id: 'eleven-dialogue-v3', name: 'ElevenLabs Dialogue v3', group: 'dialogue', provider: 'ElevenLabs', endpoint: 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3',
    blurb: 'A two-voice scene from a script. Write one line per speaker: "Name: line".',
    text: { label: 'Script', placeholder: 'Nathan: Did you hear that?\nElena: Stay still. It hears everything.', max: 5000, required: true },
    voices: { options: ELEVEN_VOICES, default: 'George', label: 'First speaker' },
    voice2: { options: ELEVEN_VOICES, default: 'Charlotte' },
    price: { usd: 0.1, per: 'kchar' },
    build: i => ({ inputs: parseDialogue(i.text).map(l => ({ text: l.text, voice: l.speaker ? (i.voice2 || 'Charlotte') : (i.voice || 'George') })) }),
    outputs: audioOut,
  },
  {
    id: 'dia-tts', name: 'Dia', group: 'dialogue', provider: 'Nari Labs', endpoint: 'fal-ai/dia-tts',
    blurb: 'Natural two-person dialogue from one script. Mark speakers with [S1] and [S2].',
    text: { label: 'Script', placeholder: '[S1] Did you hear that? [S2] Stay still. (whispers) It hears everything.', max: 3000, required: true },
    price: { usd: 0.04, per: 'kchar' },
    build: i => ({ text: /\[S1\]/.test(i.text) ? i.text : parseDialogue(i.text).map(l => `[S${l.speaker + 1}] ${l.text}`).join(' ') }),
    outputs: audioOut,
  },
  {
    id: 'vibevoice-7b', name: 'VibeVoice 7B', group: 'dialogue', provider: 'Microsoft', endpoint: 'fal-ai/vibevoice/7b',
    blurb: 'Long-form, podcast-style conversation between two voices.',
    text: { label: 'Script', placeholder: 'Host: Welcome back to the show.\nGuest: Thanks for having me.', max: 20000, required: true },
    voices: { options: VIBEVOICE_PRESETS, default: 'Carter [EN]', label: 'First speaker' },
    voice2: { options: VIBEVOICE_PRESETS, default: 'Alice [EN]' },
    price: { usd: 0.04, per: 'minute', charsPerSecond: 12 },
    build: i => ({
      script: parseDialogue(i.text).map(l => `Speaker ${l.speaker}: ${l.text}`).join('\n'),
      speakers: [{ preset: i.voice || 'Carter [EN]' }, { preset: i.voice2 || 'Alice [EN]' }],
    }),
    outputs: audioOut,
  },

  // ── Voice Lab ──────────────────────────────────────────────────────────────
  {
    id: 'eleven-voice-changer', name: 'ElevenLabs Voice Changer', group: 'voice', provider: 'ElevenLabs', endpoint: 'fal-ai/elevenlabs/voice-changer',
    blurb: 'Re-voice a recording: same words and timing, a different voice.',
    voices: { options: ELEVEN_VOICES, default: 'Rachel', label: 'New voice' },
    audioIn: { label: 'Recording to re-voice', required: true, maxMinutes: 5 },
    price: { usd: 0.3, per: 'inMinute' },
    build: i => clean({ audio_url: i.audioUrl, voice: i.voice || 'Rachel', remove_background_noise: true }), outputs: audioOut,
  },
  {
    id: 'index-tts-2', name: 'IndexTTS 2', group: 'voice', provider: 'IndexTeam', endpoint: 'fal-ai/index-tts-2/text-to-speech',
    blurb: 'Clone a voice from a short sample and have it say anything, with emotion.',
    text: SPEECH(2000), style: { label: 'Emotion', placeholder: 'optional, e.g. frightened, whispering' },
    audioIn: { label: 'Voice sample', required: true, maxMinutes: 1, hint: '5-20 seconds of clean speech', clonesVoice: true },
    price: { usd: 0.002, per: 'second', charsPerSecond: 12 },
    build: i => clean({ audio_url: i.audioUrl, prompt: i.text, emotion_prompt: i.style, should_use_prompt_for_emotion: i.style ? true : undefined }), outputs: audioOut,
  },
  {
    id: 'zonos2', name: 'Zonos 2', group: 'voice', provider: 'Zyphra', endpoint: 'fal-ai/zonos2',
    blurb: 'Zero-shot voice cloning from a reference recording.',
    text: SPEECH(2000),
    audioIn: { label: 'Reference voice', required: true, maxMinutes: 1, hint: '10-30 seconds of clean speech', clonesVoice: true },
    price: { usd: 0.01, per: 'minute', charsPerSecond: 12 },
    build: i => clean({ reference_audio_url: i.audioUrl, text: i.text, language: 'en_us', clean_speaker_background: true }), outputs: audioOut,
  },
  {
    id: 'qwen3-voice-design', name: 'Qwen 3 Voice Design', group: 'voice', provider: 'Alibaba', endpoint: 'fal-ai/qwen-3-tts/voice-design/1.7b',
    blurb: 'Describe a voice that doesn’t exist - age, accent, texture - and hear it speak.',
    text: SPEECH(3000), style: { label: 'Describe the voice', placeholder: 'e.g. a gravelly old sea captain with a Scottish accent' },
    languages: { options: QWEN_LANGS, default: 'Auto' },
    price: { usd: 0.09, per: 'kchar' },
    build: i => clean({ text: i.text, prompt: i.style || 'A clear, natural adult voice.', language: i.language || 'Auto' }), outputs: audioOut,
  },

  // ── Music ──────────────────────────────────────────────────────────────────
  {
    id: 'eleven-music-v2.5', name: 'ElevenLabs Music v2.5', group: 'music', provider: 'ElevenLabs', endpoint: 'elevenlabs/music/v2.5',
    blurb: 'Full songs with vocals or instrumentals, at the length you choose.',
    text: t('Prompt', 'Describe the song: genre, mood, instruments, vocals, lyrics themes…', 4000),
    duration: { min: 10, max: 300, default: 30, step: 5 }, instrumental: true,
    price: { usd: 0.6, per: 'minute' },
    build: i => clean({ prompt: i.text, music_length_ms: Math.round((i.duration ?? 30) * 1000), force_instrumental: i.instrumental || undefined }), outputs: audioOut,
  },
  {
    id: 'lyria-3.5', name: 'Lyria 3.5', group: 'music', provider: 'Google', endpoint: 'google/lyria-3.5',
    blurb: 'Google DeepMind’s newest music model: rich, high-fidelity tracks.',
    text: t('Prompt', 'Describe the music…', 5000),
    price: { usd: 0.1, per: 'request' },
    build: i => clean({ prompt: i.text }), outputs: audioOut,
  },
  {
    id: 'lyria-3-pro', name: 'Lyria 3 Pro', group: 'music', provider: 'Google', endpoint: 'fal-ai/lyria3/pro',
    blurb: 'Lyria 3 at its highest quality.',
    text: t('Prompt', 'Describe the music…', 5000),
    price: { usd: 0.08, per: 'request' },
    build: i => clean({ prompt: i.text }), outputs: audioOut,
  },
  {
    id: 'minimax-music-3', name: 'MiniMax Music 3', group: 'music', provider: 'MiniMax', endpoint: 'minimax/music-3',
    blurb: 'Songs sung from your lyrics, up to five minutes.',
    text: t('Style', 'e.g. cinematic indie folk, female vocal, acoustic guitar', 2000),
    lyrics: { required: true, max: 3500, placeholder: '[verse]\n…\n[chorus]\n…' },
    duration: { min: 10, max: 300, default: 60, step: 5 },
    price: { usd: 0.002, per: 'second' },
    build: i => clean({ prompt: i.text, lyrics: i.lyrics, duration: i.duration ?? 60 }), outputs: audioOut,
  },
  {
    id: 'minimax-music-2.6', name: 'MiniMax Music 2.6', group: 'music', provider: 'MiniMax', endpoint: 'fal-ai/minimax-music/v2.6',
    blurb: 'Complete songs from a style prompt, with or without your lyrics.',
    text: t('Style', 'e.g. upbeat synth-pop, catchy chorus, female vocal', 2000),
    lyrics: { required: false, max: 3500 }, instrumental: true,
    price: { usd: 0.15, per: 'request' },
    build: i => clean({ prompt: i.text, lyrics: i.instrumental ? undefined : i.lyrics, is_instrumental: i.instrumental || undefined, lyrics_optimizer: !i.lyrics && !i.instrumental ? true : undefined }), outputs: audioOut,
  },
  {
    id: 'stable-audio-3', name: 'Stable Audio 3', group: 'music', provider: 'Stability AI', endpoint: 'fal-ai/stable-audio-3/medium/text-to-audio',
    blurb: 'Instrumental music and soundscapes up to six minutes.',
    text: t('Prompt', 'e.g. dark ambient drone, slow pulse, metallic textures, 90 BPM', 2000),
    duration: { min: 5, max: 380, default: 30, step: 5 },
    price: { usd: 0.0376, per: 'request' },
    build: i => clean({ prompt: i.text, duration: i.duration ?? 30, output_format: 'mp3' }), outputs: audioOut,
  },
  {
    id: 'stable-audio-2.5', name: 'Stable Audio 2.5', group: 'music', provider: 'Stability AI', endpoint: 'fal-ai/stable-audio-25/text-to-audio',
    blurb: 'Stable Audio 2.5 - polished instrumental tracks up to three minutes.',
    text: t('Prompt', 'Describe the music…', 2000),
    duration: { min: 5, max: 190, default: 45, step: 5 },
    price: { usd: 0.2, per: 'request' },
    build: i => clean({ prompt: i.text, seconds_total: i.duration ?? 45 }), outputs: audioOut,
  },
  {
    id: 'ace-step', name: 'ACE-Step', group: 'music', provider: 'ACE Studio', endpoint: 'fal-ai/ace-step',
    blurb: 'Fast open-source songs from genre tags and lyrics.',
    text: t('Tags', 'e.g. lofi, hip hop, chill, piano, rain', 1000),
    lyrics: { required: false, max: 3000, placeholder: '[inst] for instrumental, or [verse] / [chorus] lyrics' },
    duration: { min: 5, max: 240, default: 60, step: 5 },
    price: { usd: 0.0002, per: 'second' },
    build: i => clean({ tags: i.text, lyrics: i.lyrics || '[inst]', duration: i.duration ?? 60 }), outputs: audioOut,
  },
  {
    id: 'sonilo-music', name: 'Sonilo Music', group: 'music', provider: 'Sonilo', endpoint: 'sonilo/v1.1/text-to-music',
    blurb: 'Film and game scores from a description, up to ten minutes.',
    text: t('Prompt', 'e.g. tense survival-horror score, low drone, sparse piano', 2000),
    duration: { min: 10, max: 600, default: 60, step: 5 },
    price: { usd: 0.0025, per: 'second' },
    build: i => clean({ prompt: i.text, duration: i.duration ?? 60, num_samples: 1 }), outputs: audioOut,
  },
  {
    id: 'diffrhythm', name: 'DiffRhythm', group: 'music', provider: 'ASLP', endpoint: 'fal-ai/diffrhythm',
    blurb: 'Whole songs with sung vocals, straight from lyrics.',
    text: t('Style', 'e.g. emotional pop ballad, piano and strings', 1000, false),
    lyrics: { required: true, max: 3000, placeholder: '[00:00.00] First line\n[00:04.00] Second line' },
    duration: { min: 95, max: 285, default: 95, options: [95, 285] },
    price: { usd: 0.001, per: 'second' },
    build: i => clean({ lyrics: i.lyrics, style_prompt: i.text, music_duration: (i.duration ?? 95) > 95 ? '285s' : '95s' }), outputs: audioOut,
  },
  {
    id: 'cassette-music', name: 'CassetteAI Music', group: 'music', provider: 'CassetteAI', endpoint: 'cassetteai/music-generator',
    blurb: 'Quick, cheap background music and loops.',
    text: t('Prompt', 'e.g. upbeat corporate background, 120 BPM', 1000),
    duration: { min: 10, max: 180, default: 30, step: 5 },
    price: { usd: 0.02, per: 'minute' },
    build: i => ({ prompt: i.text, duration: Math.round(i.duration ?? 30) }), outputs: d => one()(d?.audio_file),
  },

  // ── Sound Effects ──────────────────────────────────────────────────────────
  {
    id: 'eleven-sfx-v2', name: 'ElevenLabs Sound Effects', group: 'sfx', provider: 'ElevenLabs', endpoint: 'fal-ai/elevenlabs/sound-effects/v2',
    blurb: 'Any sound effect from a description, up to 22 seconds.',
    text: t('Describe the sound', 'e.g. heavy steel door slamming in a concrete corridor', 450),
    duration: { min: 1, max: 22, default: 5, step: 0.5 },
    price: { usd: 0.002, per: 'second' },
    build: i => clean({ text: i.text, duration_seconds: i.duration ?? 5 }), outputs: audioOut,
  },
  {
    id: 'sonilo-sfx', name: 'Sonilo Sound Effects', group: 'sfx', provider: 'Sonilo', endpoint: 'sonilo/v1.1/text-to-sound-effects',
    blurb: 'Layered sound design and ambience, up to three minutes.',
    text: t('Describe the sound', 'e.g. rain on a tin roof with distant thunder', 2000),
    duration: { min: 1, max: 180, default: 8, step: 1 },
    price: { usd: 0.0018, per: 'second' },
    build: i => clean({ prompt: i.text, duration: i.duration ?? 8, audio_format: 'mp3' }), outputs: audioOut,
  },
  {
    id: 'mirelo-sfx', name: 'Mirelo SFX 1.6', group: 'sfx', provider: 'Mirelo', endpoint: 'mirelo-ai/sfx1.6/text-to-audio',
    blurb: 'High-quality foley and effects, up to a minute.',
    text: t('Describe the sound', 'e.g. footsteps on gravel, slow, at night', 2000),
    duration: { min: 1, max: 60, default: 10, step: 1 },
    price: { usd: 0.01, per: 'second' },
    build: i => clean({ text_prompt: i.text, duration: i.duration ?? 10, num_samples: 1, upload_audio_format: 'mp3' }),
    outputs: d => (Array.isArray(d?.audio) ? d.audio : [d?.audio]).flatMap((f: any) => one()(f)).slice(0, 1),
  },
  {
    id: 'stable-audio-3-sfx', name: 'Stable Audio 3 SFX', group: 'sfx', provider: 'Stability AI', endpoint: 'fal-ai/stable-audio-3/small/sfx/text-to-audio',
    blurb: 'Stable Audio 3 tuned for sound effects.',
    text: t('Describe the sound', 'e.g. electric coil whine rising, then a metallic click', 2000),
    duration: { min: 1, max: 120, default: 10, step: 1 },
    price: { usd: 0.0206, per: 'request' },
    build: i => clean({ prompt: i.text, duration: i.duration ?? 10, output_format: 'mp3' }), outputs: audioOut,
  },
  {
    id: 'cassette-sfx', name: 'CassetteAI SFX', group: 'sfx', provider: 'CassetteAI', endpoint: 'cassetteai/sound-effects-generator',
    blurb: 'Fast, low-cost sound effects up to 30 seconds.',
    text: t('Describe the sound', 'e.g. dog barking in the rain', 1000),
    duration: { min: 1, max: 30, default: 5, step: 1 },
    price: { usd: 0.01, per: 'request' },
    build: i => ({ prompt: i.text, duration: Math.round(i.duration ?? 5) }), outputs: d => one()(d?.audio_file),
  },
  {
    id: 'mmaudio-v2', name: 'MMAudio V2', group: 'sfx', provider: 'MMAudio', endpoint: 'fal-ai/mmaudio-v2/text-to-audio',
    blurb: 'Open model for realistic sounds, up to 30 seconds.',
    text: t('Describe the sound', 'e.g. crackling campfire, crickets', 1000),
    duration: { min: 1, max: 30, default: 8, step: 1 },
    price: { usd: 0.001, per: 'second' },
    build: i => clean({ prompt: i.text, duration: i.duration ?? 8 }), outputs: audioOut,
  },

  // ── Audio Tools ────────────────────────────────────────────────────────────
  {
    id: 'veed-clean-audio', name: 'VEED Clean Audio', group: 'tools', provider: 'VEED', endpoint: 'veed/clean-audio',
    blurb: 'One click: remove noise and echo, even out the level.',
    audioIn: { label: 'Audio to clean', required: true, maxMinutes: 30 },
    price: { usd: 0.0125, per: 'inMinute' },
    build: i => ({ audio_url: i.audioUrl, output_format: 'wav' }), outputs: audioOut,
  },
  {
    id: 'eleven-audio-isolation', name: 'ElevenLabs Voice Isolator', group: 'tools', provider: 'ElevenLabs', endpoint: 'fal-ai/elevenlabs/audio-isolation',
    blurb: 'Pull clean speech out of any noisy recording.',
    audioIn: { label: 'Noisy recording', required: true, maxMinutes: 10 },
    price: { usd: 0.1, per: 'inMinute' },
    build: i => ({ audio_url: i.audioUrl }), outputs: audioOut,
  },
  {
    id: 'demucs', name: 'Demucs Stem Splitter', group: 'tools', provider: 'Meta', endpoint: 'fal-ai/demucs',
    blurb: 'Split a song into vocals, drums, bass, guitar, piano and the rest.',
    audioIn: { label: 'Song', required: true, maxMinutes: 10 },
    price: { usd: 0.0007, per: 'inSecond' },
    build: i => ({ audio_url: i.audioUrl, model: 'htdemucs_6s', output_format: 'mp3' }),
    outputs: d => ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'].flatMap(s => one(s)(d?.[s])),
  },
  {
    id: 'sam-audio', name: 'SAM Audio Separator', group: 'tools', provider: 'Meta', endpoint: 'fal-ai/sam-audio/separate',
    blurb: 'Describe any sound and pull it out of a recording.',
    text: t('What to isolate', 'e.g. the barking dog / the lead vocal / the piano', 500),
    audioIn: { label: 'Recording', required: true, maxMinutes: 10 },
    price: { usd: 0.05 / 30, per: 'inSecond', outputs: 2 },
    build: i => ({ audio_url: i.audioUrl, prompt: i.text, output_format: 'mp3' }),
    outputs: d => [...one('isolated')(d?.target), ...one('everything else')(d?.residual)],
  },
  {
    id: 'deepfilternet3', name: 'DeepFilterNet 3', group: 'tools', provider: 'DeepFilterNet', endpoint: 'fal-ai/deepfilternet3',
    blurb: 'Fast speech denoising for voice recordings.',
    audioIn: { label: 'Recording', required: true, maxMinutes: 30 },
    price: { usd: 0.001, per: 'inSecond' },
    build: i => ({ audio_url: i.audioUrl, audio_format: 'mp3' }), outputs: d => one()(d?.audio_file),
  },
  {
    id: 'stable-audio-3-restyle', name: 'Stable Audio 3 Restyle', group: 'tools', provider: 'Stability AI', endpoint: 'fal-ai/stable-audio-3/medium/audio-to-audio',
    blurb: 'Transform a track into a new style while keeping its shape.',
    text: t('New style', 'e.g. the same melody as an orchestral piece', 2000),
    audioIn: { label: 'Track to restyle', required: true, maxMinutes: 6 },
    duration: { min: 5, max: 380, default: 30, step: 5 },
    price: { usd: 0.0417, per: 'request' },
    build: i => clean({ audio_url: i.audioUrl, prompt: i.text, duration: i.duration ?? 30, output_format: 'mp3' }), outputs: audioOut,
  },
  {
    id: 'ace-step-extend', name: 'ACE-Step Extend', group: 'tools', provider: 'ACE Studio', endpoint: 'fal-ai/ace-step/audio-outpaint',
    blurb: 'Continue a track: add more music after it ends.',
    text: t('Tags', 'e.g. same style, building to a big finish', 1000),
    audioIn: { label: 'Track to extend', required: true, maxMinutes: 4 },
    duration: { min: 5, max: 120, default: 30, step: 5 },
    price: { usd: 0.0002, per: 'second', outputIncludesInput: true },
    build: i => clean({ audio_url: i.audioUrl, tags: i.text, extend_after_duration: i.duration ?? 30, lyrics: '[inst]' }), outputs: audioOut,
  },
]

export const AUDIO_STUDIO_MODEL_IDS = AUDIO_STUDIO_MODELS.map(m => m.id)
export const getAudioStudioModel = (id: string) => AUDIO_STUDIO_MODELS.find(m => m.id === id || `${AUDIO_MODEL_PREFIX}${m.id}` === id)
export const getAudioStudioModelByName = (name: string) => AUDIO_STUDIO_MODELS.find(m => m.name === name)

// ─────────────────────────────────────────────────────────────────────────────
// pricing
// ─────────────────────────────────────────────────────────────────────────────
/** Half of the cheapest ticket ($0.08 on a subscription) is the house margin. */
const USD_PER_TICKET = 0.04
/** fal's audio prices move with text, retries and hidden work; keep 10% headroom. */
const BUFFER = 1.1

export interface AudioPriceQuery {
  /** Characters of text sent (text + lyrics). */
  chars?: number
  /** Requested output length. */
  seconds?: number
  /** Length of the uploaded input audio. */
  inputSeconds?: number
}

/** What fal charges for one run, in USD (buffered). */
export function audioRunCostUsd(m: AudioStudioModel, q: AudioPriceQuery): number {
  const p = m.price
  const chars = Math.max(q.chars ?? 0, 100)
  // Output length: what was asked for, or - for speech billed by output - an estimate from the text
  const inSec = Math.max(q.inputSeconds ?? 60, 1)
  const outSec = (q.seconds ?? m.duration?.default ?? (p.charsPerSecond ? chars / p.charsPerSecond : 30))
    + (p.outputIncludesInput ? inSec : 0)
  let usd: number
  switch (p.per) {
    case 'kchar': usd = (chars / 1000) * p.usd; break
    case 'second': usd = outSec * p.usd; break
    case 'minute': usd = (outSec / 60) * p.usd; break
    case 'request': usd = p.usd; break
    case 'inMinute': usd = (inSec / 60) * p.usd; break
    case 'inSecond': usd = inSec * p.usd; break
  }
  return usd * (p.outputs ?? 1) * BUFFER
}

/** Tickets for one run. */
export function audioTicketCost(m: AudioStudioModel, q: AudioPriceQuery): number {
  return Math.max(1, Math.ceil(audioRunCostUsd(m, q) / USD_PER_TICKET - 1e-9))
}

/** The picker's $ tier, from a typical run (a paragraph, a 30s clip, a minute of input). */
export function audioCostTier(m: AudioStudioModel): '$' | '$$' | '$$$' | '$$$+' {
  const tickets = audioTicketCost(m, { chars: 500, seconds: m.duration?.default ?? 30, inputSeconds: 60 })
  return tickets <= 1 ? '$' : tickets <= 3 ? '$$' : tickets <= 8 ? '$$$' : '$$$+'
}

/** A short human line for the price rule ("1 ticket per 500 characters"). */
export function audioPriceNote(m: AudioStudioModel): string {
  const p = m.price
  const perTicket = USD_PER_TICKET / (p.usd * (p.outputs ?? 1) * BUFFER)
  switch (p.per) {
    case 'kchar': return `≈ 1 ticket per ${Math.max(1, Math.round(perTicket * 1000)).toLocaleString()} characters`
    case 'second': return `≈ 1 ticket per ${Math.max(1, Math.round(perTicket))} seconds of audio`
    case 'minute': return `≈ 1 ticket per ${Math.max(1, Math.round(perTicket * 60))} seconds of audio`
    case 'request': { const n = audioTicketCost(m, {}); return `${n} ticket${n === 1 ? '' : 's'} per generation` }
    case 'inMinute': return `≈ 1 ticket per ${Math.max(1, Math.round(perTicket * 60))} seconds of input`
    case 'inSecond': return `≈ 1 ticket per ${Math.max(1, Math.round(perTicket))} seconds of input`
  }
}
