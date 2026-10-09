/**
 * Tickets for the site's Gemini TEXT features (2026-10-08) - client-safe, so a
 * button shows exactly what the route charges.
 *
 * Until now these were free: Storyboard's Draft with AI (write / polish /
 * rewrite / extend / scene / match references), "Edit with AI" on a shot,
 * and Prompt Enhance (the Text dropdown's idea box and the ✨ buttons). Asset
 * auto-captions are new and priced here too. Final Cut and the Stills cut
 * already charge, AI included.
 *
 * The cost basis is Google's paid-tier list price at the RAISED rate:
 * Gemini 3.7 Flash goes from $0.75 / $3.75 to $1.50 / $7.50 per million
 * input / output tokens on 2027-01-01 - priced at the higher one now so the
 * margin survives the change. A ticket is worth $0.04 of model cost (the
 * site's floor; packs sell it for $0.08-0.20), and every price below is at
 * least 2x the generous estimate for its job:
 *   draft a 20-shot board   ~12k in + ~12k out (thinking incl.) ~$0.11 -> 6 tickets
 *   polish / regenerate 10  ~10k in +  ~6k out                  ~$0.06 -> 3
 *   extend / scene by 5     ~10k in +  ~3k out                  ~$0.04 -> 2
 *   match references        ~8k in  +  ~1k out (+ captions)     ~$0.02 -> 1-2
 *   edit one shot           ~5k in  +  ~1k out                  ~$0.02 -> 1
 *   enhance a prompt        Flash-Lite, ~1k in + 0.3k out       ~$0.001 -> 1 (the minimum)
 *   caption 12 asset photos Flash-Lite vision, ~13k in + 1k out ~$0.007 -> 1 per 12
 * Each route logs Gemini's real token counts ([ai-usage]) so these can be tuned.
 * Admin accounts are never charged (lib/ticket-gate).
 */

export type DraftMode = 'replace' | 'polish' | 'regenerate' | 'extend' | 'scene' | 'refs'

/** Draft with AI. `shots` = shots written (replace), shots picked (polish / regenerate / refs) or new shots (extend / scene). */
export function storyboardDraftTickets(mode: DraftMode, shots: number, opts: { withImages?: boolean } = {}): number {
  const n = Math.max(1, Math.round(shots) || 1)
  const base =
    mode === 'replace' ? 2 + Math.ceil(n / 5)
    : mode === 'refs' ? 1 + Math.floor(n / 20)
    : 1 + Math.ceil(n / 5)
  // An outfit pack reads the wardrobe photos too (image tokens)
  return base + (opts.withImages ? 1 : 0)
}

/** "Edit with AI" on one shot. */
export const SHOT_EDIT_TICKETS = 1

/** Prompt Enhance (Text dropdown / ✨). The daily caps by plan stay as an abuse limit. */
export const ENHANCE_TICKETS = 1

/** Gemini captions + tags for an asset's photos: 1 ticket per started 12. */
export const assetCaptionTickets = (photos: number) => Math.max(1, Math.ceil(Math.max(0, photos) / 12))

/** Gemini's own token count for a call, for the [ai-usage] log line. */
export function geminiUsage(data: unknown): { in: number; out: number } {
  const u = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } } | null)?.usageMetadata
  return { in: u?.promptTokenCount ?? 0, out: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) }
}
