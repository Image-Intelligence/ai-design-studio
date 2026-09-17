// Registry of fal-hosted LoRA trainer FAMILIES beyond the original flux/z-image
// set. Everything family-specific that the training pipeline needs — endpoint
// resolution, dataset media kind, zip field name, input params, output file
// shape, R2 destination — lives here so a new trainer (e.g. LTX-2) is a new
// record plus a UI entry, not another fork in prepare/webhook/finalize.

export type TrainerFamily = {
  familyId: string
  label: string
  media: 'image' | 'video'
  // Resolve the concrete fal endpoint (variants are URL sub-paths, e.g.
  // fal-ai/wan-22-trainer/t2v-a14b — verified via fal OpenAPI)
  falEndpoint: (config: Record<string, unknown>) => string
  // Input field that carries the dataset zip URL
  zipField: string
  buildInput: (config: Record<string, unknown>) => Record<string, unknown>
  // Output payload keys → canonical artifact names for finalize
  outputFiles: { key: string; saveAs: string }[]
  datasetRules: { min: number; max: number }
  r2Namespace: string
  /**
   * Longest side prepare resizes training images to (image families only).
   *
   * It is a ceiling on the run: a trainer that crops without upscaling can
   * never exceed what is in the zip. Defaults to 1024, which several trainers
   * are happy with and which keeps the zip small; raise it where the trainer
   * can actually use the pixels.
   */
  maxImageDim?: number
}

const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v))
const str = (v: unknown) => (v === undefined || v === '' ? undefined : String(v))

export const TRAINER_FAMILIES: Record<string, TrainerFamily> = {
  'fal-ai/wan-22-trainer': {
    familyId: 'wan22-video',
    label: 'Wan 2.2 Video LoRA',
    media: 'video',
    falEndpoint: (config) => {
      const variant = config.variant === 'i2v-a14b' ? 'i2v-a14b' : 't2v-a14b'
      return `fal-ai/wan-22-trainer/${variant}`
    },
    zipField: 'training_data_url',
    buildInput: (config) => {
      const input: Record<string, unknown> = {}
      const steps = num(config.steps); if (steps !== undefined) input.number_of_steps = steps
      const lr = num(config.learning_rate); if (lr !== undefined) input.learning_rate = lr
      const trigger = str(config.trigger_phrase); if (trigger) input.trigger_phrase = trigger
      // Default ON: normalizes arbitrary clips to the 81-frame/16fps window the
      // trainer expects — without it, odd-length clips fail validation
      input.auto_scale_input = config.auto_scale_input !== false
      return input
    },
    outputFiles: [
      { key: 'lora_file', saveAs: 'final.safetensors' },
      { key: 'config_file', saveAs: 'config.json' },
    ],
    datasetRules: { min: 5, max: 50 },
    r2Namespace: 'training/video-loras',
  },
  'fal-ai/wan-22-image-trainer': {
    familyId: 'wan22-image',
    label: 'Wan 2.2 Image LoRA',
    media: 'image',
    falEndpoint: () => 'fal-ai/wan-22-image-trainer',
    zipField: 'training_data_url',
    buildInput: (config) => {
      const input: Record<string, unknown> = {}
      const steps = num(config.steps); if (steps !== undefined) input.steps = steps
      const lr = num(config.learning_rate); if (lr !== undefined) input.learning_rate = lr
      const trigger = str(config.trigger_phrase); if (trigger) input.trigger_phrase = trigger
      if (config.is_style === true) input.is_style = true
      if (config.use_face_detection === false) input.use_face_detection = false
      if (config.use_face_cropping === true) input.use_face_cropping = true
      if (config.include_synthetic_captions === true) input.include_synthetic_captions = true
      return input
    },
    outputFiles: [
      { key: 'diffusers_lora_file', saveAs: 'final.safetensors' },
      { key: 'high_noise_lora', saveAs: 'high_noise.safetensors' },
      { key: 'config_file', saveAs: 'config.json' },
    ],
    datasetRules: { min: 5, max: 200 },
    r2Namespace: 'training/video-loras',
  },
  'ideogram/v4/trainer': {
    familyId: 'ideogram-v4',
    label: 'Ideogram v4 LoRA',
    media: 'image',
    falEndpoint: () => 'ideogram/v4/trainer',
    // NOT training_data_url — this trainer names the field differently, and
    // the wrong name is a 422 with no hint about which field is missing.
    zipField: 'images_data_url',
    buildInput: (config) => {
      const input: Record<string, unknown> = {}
      // Ranges are the schema's: steps 100..40000, lr 1e-6..0.01.
      const steps = num(config.steps)
      if (steps !== undefined) input.steps = Math.min(40000, Math.max(100, steps))
      const lr = num(config.learning_rate)
      if (lr !== undefined) input.learning_rate = Math.min(0.01, Math.max(0.000001, lr))
      // Ideogram has no trigger_phrase field; the caption is where a token
      // goes, so the UI's trigger box feeds this when no caption is given.
      const caption = str(config.default_caption) ?? str(config.trigger_phrase)
      if (caption) input.default_caption = caption
      const res = str(config.resolution); if (res) input.resolution = res
      // 'fal' is what ideogram/v4/lora loads; 'comfy' is for export elsewhere.
      input.output_lora_format = config.output_lora_format === 'comfy' ? 'comfy' : 'fal'
      return input
    },
    outputFiles: [
      { key: 'diffusers_lora_file', saveAs: 'final.safetensors' },
      { key: 'config_file', saveAs: 'config.json' },
    ],
    /*
     * 3 is the smallest set proven to train here: three captioned images
     * completed in 11 minutes, while two uncaptioned ones failed. Which of
     * those two differences mattered was not isolated, so this is a floor
     * taken from what worked rather than from a documented minimum.
     */
    datasetRules: { min: 3, max: 200 },
    r2Namespace: 'training/loras',
    /*
     * 2048, because "auto" takes the largest common no-upscale crop and then
     * center-crops. At the old 1024 ceiling a 3712x4608 source arrived as
     * 825x1024 and reached no preset at all, square included. At 2048 it is
     * 1650x2048 and reaches square, landscape, portrait and phone_wallpaper.
     * Measured: 128 MB per 191 images as JPEG q95, against 331 MB for the
     * 1024 PNGs this replaces.
     */
    maxImageDim: 2048,
  },
  'fal-ai/ltx2-video-trainer': {
    familyId: 'ltx2-video',
    label: 'LTX-2 Video LoRA',
    media: 'video',
    falEndpoint: () => 'fal-ai/ltx2-video-trainer',
    zipField: 'training_data_url',
    buildInput: (config) => {
      const input: Record<string, unknown> = {}
      const steps = num(config.steps); if (steps !== undefined) input.number_of_steps = steps
      const lr = num(config.learning_rate); if (lr !== undefined) input.learning_rate = lr
      const trigger = str(config.trigger_phrase); if (trigger) input.trigger_phrase = trigger
      const rank = num(config.rank)
      if (rank !== undefined && [8, 16, 32, 64, 128].includes(rank)) input.rank = rank
      const res = str(config.resolution)
      if (res && ['low', 'medium', 'high'].includes(res)) input.resolution = res
      const ar = str(config.aspect_ratio)
      if (ar && ['16:9', '1:1', '9:16'].includes(ar)) input.aspect_ratio = ar
      if (config.with_audio === true) input.with_audio = true
      return input
    },
    outputFiles: [
      { key: 'lora_file', saveAs: 'final.safetensors' },
      { key: 'config_file', saveAs: 'config.json' },
    ],
    datasetRules: { min: 5, max: 50 },
    r2Namespace: 'training/video-loras',
  },
}

export function getTrainerFamily(modelId: string): TrainerFamily | null {
  return TRAINER_FAMILIES[modelId] ?? null
}
