/**
 * The Gemini text models an ADMIN can pick for the site's writing features:
 * the prompt sculptor (portal-v2's Text dropdown, Prompt Enhance) and
 * Storyboard Studio (Draft with AI, Edit with AI). Everyone else always runs
 * the feature's default; the server ignores a pick from a non-admin.
 *
 * The full list (2026-10-18, at the owner's request - it used to be Flash
 * only): every Gemini model on the key's live ListModels that writes text.
 * Each id was run that day on both jobs - a one-line prompt rewrite and a
 * 6-shot JSON storyboard plan - and passed both. Left out on purpose:
 *  - gemini-2.5-flash-lite: 404 "no longer available to new users";
 *  - gemini-2.5-computer-use-preview: refuses any call without the Computer
 *    Use tool;
 *  - Deep Research (3 previews): background research agents that take
 *    minutes and return reports, not a prompt or a plan;
 *  - the image (Nano Banana), TTS, transcribe, Live and embedding models,
 *    and Lyria - none of them writes text.
 * Gemma 4 and the Antigravity agent are on the key too but are not Gemini.
 *
 * Gemini 4 Argon: announced 2026-09-30 for a closed program, on the public API
 * as `gemini-4-argon` by 2026-10-18 (1M in / 32k out, no thinking tokens).
 * Google has not published its price yet, so it is nobody's default.
 *
 * `api: 'interactions'` = the model answers only Google's Interactions API
 * (lib/gemini-generate handles both APIs, so callers do not care).
 *
 * Ordered newest-first inside each group.
 */
export type PromptModel = { id: string; label: string; group: string; note?: string; api?: 'interactions' }

export const PROMPT_MODELS: PromptModel[] = [
  // ── Gemini 4 ──
  { id: 'gemini-4-argon',                     label: 'Gemini 4 Argon',              group: 'Gemini 4', note: 'newest' },

  // ── Flash: the workhorses ──
  { id: 'gemini-3.8-flash',                   label: 'Gemini 3.8 Flash',            group: 'Flash' },
  { id: 'gemini-3.7-flash',                   label: 'Gemini 3.7 Flash',            group: 'Flash' },
  { id: 'gemini-3.6-flash',                   label: 'Gemini 3.6 Flash',            group: 'Flash' },
  { id: 'gemini-3.5-flash',                   label: 'Gemini 3.5 Flash',            group: 'Flash' },
  { id: 'gemini-3-flash-preview',             label: 'Gemini 3 Flash',              group: 'Flash' },
  { id: 'gemini-2.5-flash',                   label: 'Gemini 2.5 Flash',            group: 'Flash' },
  { id: 'gemini-flash-latest',                label: 'Flash (latest)',              group: 'Flash', note: 'tracks the newest flash' },

  // ── Flash-Lite: cheap and quick ──
  { id: 'gemini-3.5-flash-lite',              label: 'Gemini 3.5 Flash Lite',       group: 'Flash Lite' },
  { id: 'gemini-3.1-flash-lite',              label: 'Gemini 3.1 Flash Lite',       group: 'Flash Lite' },
  { id: 'gemini-3.1-flash-lite-preview',      label: 'Gemini 3.1 Flash Lite Preview', group: 'Flash Lite' },
  { id: 'gemini-flash-lite-latest',           label: 'Flash Lite (latest)',         group: 'Flash Lite', note: 'tracks the newest lite' },

  // ── Pro: slower, deeper ──
  { id: 'gemini-3.1-pro-preview',             label: 'Gemini 3.1 Pro',              group: 'Pro' },
  { id: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Pro (Custom Tools)', group: 'Pro' },
  { id: 'gemini-2.5-pro',                     label: 'Gemini 2.5 Pro',              group: 'Pro' },
  { id: 'gemini-pro-latest',                  label: 'Pro (latest)',                group: 'Pro', note: 'tracks the newest pro' },

  // ── Omni: Google's any-to-any models (Interactions API only) ──
  { id: 'gemini-omni-1.1-flash',              label: 'Gemini Omni 1.1 Flash',       group: 'Omni', api: 'interactions' },
  { id: 'gemini-omni-flash-preview',          label: 'Gemini Omni Flash Preview',   group: 'Omni', api: 'interactions' },

  // ── Specialist ──
  { id: 'gemini-robotics-er-2-preview',       label: 'Gemini Robotics-ER 2',        group: 'Specialist', note: 'robotics reasoning' },
]

export const PROMPT_MODEL_GROUPS = [...new Set(PROMPT_MODELS.map(m => m.group))]

/** The models that answer only the Interactions API (lib/gemini-generate). */
export const INTERACTIONS_MODELS = new Set(PROMPT_MODELS.filter(m => m.api === 'interactions').map(m => m.id))

/** The menu label: name plus any note, and "default" on the feature's own default. */
export const promptModelLabel = (m: PromptModel, defaultId: string) =>
  [m.label, m.id === defaultId ? 'default' : null, m.note].filter(Boolean).join(' · ')

/** Prompt Enhance's default: the cheapest capable model - sculpting a prompt does not need a flagship. */
export const DEFAULT_PROMPT_MODEL = 'gemini-3.5-flash-lite'

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

/**
 * Storyboard's default (Draft with AI, Edit with AI): 3.7 Flash - the model the
 * Draft prices in lib/ai-text-pricing were set from. A board plan is a long
 * structured job, so it does not run on Flash-Lite.
 */
export const DEFAULT_STORYBOARD_TEXT_MODEL = 'gemini-3.7-flash'

/** An admin's pick when it is on the list; everyone else (and any miss) gets the default. */
export function resolveStoryboardTextModel(id: unknown, isAdmin: boolean): string {
  return isAdmin && typeof id === 'string' && PROMPT_MODELS.some(m => m.id === id) ? id : DEFAULT_STORYBOARD_TEXT_MODEL
}
