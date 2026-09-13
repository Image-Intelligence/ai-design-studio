/**
 * The text models the prompt sculptor can run.
 *
 * Enumerated from the live ListModels endpoint on 2026-09-13 and filtered to
 * the ones that actually do generateContent, rather than written from memory.
 * The old list had four entries, two of which (gemini-2.0-flash-exp,
 * gemini-exp-1206) no longer exist at all — the route quietly mapped them onto
 * 2.5, so picking them changed nothing and said nothing.
 *
 * Ordered cheapest-first inside each group, and the default is the cheapest
 * capable model: sculpting a prompt is a short, easy generation, and paying
 * flagship rates for it is waste.
 *
 * Music, image, audio, robotics and computer-use models are deliberately not
 * here. They are "options" only in the sense that the API lists them; none can
 * return a prompt.
 */
export type PromptModel = { id: string; label: string; group: string; note?: string }

export const PROMPT_MODELS: PromptModel[] = [
  // ── cheap and quick: the right default for rewriting a line of text ──
  { id: 'gemini-3.5-flash-lite',   label: 'Gemini 3.5 Flash Lite', group: 'Fast & cheap', note: 'default' },
  { id: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite', group: 'Fast & cheap' },
  { id: 'gemini-2.5-flash-lite',   label: 'Gemini 2.5 Flash Lite', group: 'Fast & cheap' },
  { id: 'gemini-flash-lite-latest',label: 'Flash Lite (latest)',   group: 'Fast & cheap', note: 'tracks the newest lite' },

  // ── the workhorses ──
  { id: 'gemini-3.8-flash',        label: 'Gemini 3.8 Flash',      group: 'Balanced' },
  { id: 'gemini-3.7-flash',        label: 'Gemini 3.7 Flash',      group: 'Balanced' },
  { id: 'gemini-3.6-flash',        label: 'Gemini 3.6 Flash',      group: 'Balanced' },
  { id: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash',      group: 'Balanced' },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash',        group: 'Balanced' },
  { id: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash',      group: 'Balanced' },
  { id: 'gemini-flash-latest',     label: 'Flash (latest)',        group: 'Balanced', note: 'tracks the newest flash' },

  // ── slower, better at holding a long brief together ──
  { id: 'gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro',        group: 'Strongest' },
  { id: 'gemini-2.5-pro',          label: 'Gemini 2.5 Pro',        group: 'Strongest' },
  { id: 'gemini-pro-latest',       label: 'Pro (latest)',          group: 'Strongest', note: 'tracks the newest pro' },

  // ── open weights, same API ──
  { id: 'gemma-4-31b-it',          label: 'Gemma 4 31B',           group: 'Open models' },
  { id: 'gemma-4-26b-a4b-it',      label: 'Gemma 4 26B',           group: 'Open models' },

  // ── these think for a long time before answering ──
  { id: 'deep-research-preview-04-2026',     label: 'Deep Research',      group: 'Research', note: 'slow' },
  { id: 'deep-research-pro-preview-12-2025', label: 'Deep Research Pro',  group: 'Research', note: 'slow' },
  { id: 'deep-research-max-preview-04-2026', label: 'Deep Research Max',  group: 'Research', note: 'slowest' },
]

/** Cheapest capable model. Sculpting a prompt does not need a flagship. */
export const DEFAULT_PROMPT_MODEL = PROMPT_MODELS[0].id

export const PROMPT_MODEL_GROUPS = [...new Set(PROMPT_MODELS.map(m => m.group))]

/**
 * Only ids from the list above may be sent to the API.
 *
 * The previous route accepted anything and fell back to a hardcoded default on
 * a miss, so a stale or mistyped id looked like it worked while quietly running
 * something else.
 */
export function resolvePromptModel(id: unknown): string {
  return typeof id === 'string' && PROMPT_MODELS.some(m => m.id === id) ? id : DEFAULT_PROMPT_MODEL
}
