/**
 * The text models the prompt sculptor can run: Gemini FLASH only.
 *
 * Trimmed 2026-10-02 to the Flash family (Pro, Gemma and Deep Research were
 * dropped - slow or costly for rewriting a line of text). Every id below was
 * checked against the live ListModels endpoint that day and does
 * generateContent.
 *
 * Gemini 4: announced 2026-09-30 ("Argon") for a closed cyber-defence
 * program only - no public API model id yet (gemini-4-flash and the like
 * return 404). The two "latest" aliases follow Google's newest Flash and
 * Flash-Lite, so they pick Gemini 4 Flash up the day it ships; add its own
 * id here then.
 *
 * Ordered newest-first inside each group; the default stays the cheapest
 * capable model - sculpting a prompt is a short, easy generation.
 */
export type PromptModel = { id: string; label: string; group: string; note?: string }

export const PROMPT_MODELS: PromptModel[] = [
  // ── Flash-Lite: cheap and quick, the right default for rewriting a line ──
  { id: 'gemini-3.5-flash-lite',   label: 'Gemini 3.5 Flash Lite', group: 'Flash Lite', note: 'default' },
  { id: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite', group: 'Flash Lite' },
  { id: 'gemini-2.5-flash-lite',   label: 'Gemini 2.5 Flash Lite', group: 'Flash Lite' },
  { id: 'gemini-flash-lite-latest',label: 'Flash Lite (latest)',   group: 'Flash Lite', note: 'tracks the newest lite' },

  // ── Flash: the workhorses ──
  { id: 'gemini-3.8-flash',        label: 'Gemini 3.8 Flash',      group: 'Flash', note: 'newest' },
  { id: 'gemini-3.7-flash',        label: 'Gemini 3.7 Flash',      group: 'Flash' },
  { id: 'gemini-3.6-flash',        label: 'Gemini 3.6 Flash',      group: 'Flash' },
  { id: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash',      group: 'Flash' },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash',        group: 'Flash' },
  { id: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash',      group: 'Flash' },
  { id: 'gemini-flash-latest',     label: 'Flash (latest)',        group: 'Flash', note: 'tracks the newest flash' },
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
