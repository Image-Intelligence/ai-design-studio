/**
 * fal's live-video models (2026-10-16) - the ones fal calls "WMA": the page
 * opens a WebRTC session with the model and video streams back while it is
 * steered with small JSON control messages.
 *
 *   Lingbot World 2 / Abot World 0  walk and look around a world started from
 *                                   a picture or a preset (Worlds studio,
 *                                   components/worlds)
 *   H3 Max Reference Director       direct a continuous film from a prompt and
 *                                   named references (a video model with a
 *                                   live popup, components/realtime/DirectorLiveSession)
 *
 * Client-safe: the pickers, the meter route and the proxy all read this one
 * list. The browser never talks to fal with our key - it goes through
 * /api/realtime/wma (only these apps, only the session calls), and time is
 * paid in 30-second blocks through /api/realtime/wma/meter. The proxy refuses
 * the session's heartbeat once paid time runs out, and fal ends a session
 * whose heartbeats stop - so the bill is enforced server-side, not by the page.
 *
 * ADMIN ONLY while under test.
 */

export type WmaModelId = 'lingbot-world-2' | 'abot-world-0' | 'minimax-h3-max-director'

export interface WmaModel {
  id: WmaModelId
  /** fal's endpoint id - the only apps the proxy opens */
  app: string
  /** Where fal's request history files its sessions (and their full-quality recordings) -
   *  not always `app`: H3 Max Director's are only found under this internal id */
  history: string
  name: string
  maker: string
  kind: 'world' | 'director'
  /** fal's price in USD per second the session runs, by resolution where it varies */
  usdPerSecond: (resolution?: string) => number
  blurb: string
}

/** H3 Max Director's billable units per second, by size (fal session_info); unknown sizes price at the top rate. */
const DIRECTOR_UNITS: Record<string, number> = { '480p': 1, '544p': 1.04, '640p': 1.1, '704p': 1.15, '768p': 1.2, '1080p': 1.2, '1440p': 1.2 }

/** One paid block of live time. */
export const WMA_BLOCK_SEC = 30
/** USD per ticket, the rate every fal price is turned into tickets at. */
const USD_PER_TICKET = 0.04

/*
 * Prices: fal lists H3 Max Director at $0.05 per second, and the two worlds at
 * "$0.00125 per compute second" - which is GPU time, not session time, so the
 * per-second figure below is MEASURED from fal balance changes, not read off
 * the page. Until it is measured the worlds carry a placeholder of $0.02/s.
 */
export const WMA_MODELS: Record<WmaModelId, WmaModel> = {
  'lingbot-world-2': {
    id: 'lingbot-world-2', app: 'robbyant/lingbot-world-2', history: 'fal-ai/lingbot-world-2/start-session', name: 'Lingbot World 2', maker: 'Robbyant', kind: 'world',
    usdPerSecond: () => 0.02,
    blurb: 'Walk a world started from your picture - 1664x960 at 48 fps, with up to nine actions on the number keys',
  },
  'abot-world-0': {
    id: 'abot-world-0', app: 'alibaba/abot-world-0', history: 'fal-ai/abot-world-0/start-session', name: 'Abot World 0', maker: 'Alibaba', kind: 'world',
    usdPerSecond: () => 0.02,
    blurb: 'Walk and look around a world started from your picture - 1280x704 at 16 fps',
  },
  'minimax-h3-max-director': {
    id: 'minimax-h3-max-director', app: 'minimax/h3-max/reference-director', history: 'fal-ai/minimax-h3-max-reference-director/start-session', name: 'H3 Max Director', maker: 'MiniMax', kind: 'director',
    // fal's own session_info (2026-10-16, "provisional-experiment" pricing):
    // billable units per playable second by size, at $0.05 a unit
    usdPerSecond: res => 0.05 * (DIRECTOR_UNITS[res ?? ''] ?? 1.2),
    blurb: 'Direct a continuous film live - a prompt, named character pictures, then new directions while it plays',
  },
}

export const WMA_MODEL_IDS = Object.keys(WMA_MODELS) as WmaModelId[]

export function isWmaModelId(v: unknown): v is WmaModelId {
  return typeof v === 'string' && (WMA_MODEL_IDS as string[]).includes(v)
}

export function wmaModelForApp(app: unknown): WmaModel | null {
  return WMA_MODEL_IDS.map(id => WMA_MODELS[id]).find(m => m.app === app) ?? null
}

/** Tickets for one 30-second block (fal's price over the block, rounded up). */
export function wmaBlockTickets(id: WmaModelId, resolution?: string): number {
  return Math.max(1, Math.ceil((WMA_MODELS[id].usdPerSecond(resolution) * WMA_BLOCK_SEC) / USD_PER_TICKET - 1e-9))
}

/** H3 Max Director's sizes and shapes (fal's configure message). */
export const DIRECTOR_RESOLUTIONS = ['480p', '544p', '640p', '704p', '768p', '1080p', '1440p'] as const
export const DIRECTOR_ASPECTS = ['16:9', '9:16', '1:1'] as const
/** Named references it takes at most. */
export const DIRECTOR_MAX_REFS = 9
