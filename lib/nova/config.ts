/**
 * Nova Studio - shared, client-safe config (2026-10-18).
 *
 * Nova is a chat studio: the user talks to a Gemini model that can read their
 * library (My Generations, folders, assets), make new media with the site's
 * public models, organise what it makes and assemble final cuts. It is the
 * user-facing, billed counterpart of the admin AI Chat Hub - built separately
 * because the hub assumes an admin everywhere (hard-coded isAdmin, unbilled
 * tools, unbilled tokens).
 *
 * Everything the screen and the server must agree on lives here: the models,
 * how a chat turn is priced, the budget settings and the message shapes.
 */
import { PROMPT_MODELS, type PromptModel } from '@/lib/prompt-models'

// ── Models ───────────────────────────────────────────────────────────────────

/**
 * The Gemini models Nova can run. Tool calling goes through the AI SDK's
 * Google provider (generateContent), so the Interactions-only Omni models are
 * left out. Everyone runs the default; admins may pick any of these.
 */
export const NOVA_MODELS: PromptModel[] = PROMPT_MODELS.filter(m => m.api !== 'interactions')

/**
 * 'auto' = routed per turn (lib/nova/router): the default for everyone. An
 * admin may pin one model instead, to compare them.
 */
export const NOVA_AUTO = 'auto'
export const DEFAULT_NOVA_MODEL = NOVA_AUTO

/** The fallback orchestrator, and what a pinned-but-unknown id becomes. */
export const NOVA_BASE_MODEL = 'gemini-3.8-flash'

export function resolveNovaModel(id: unknown, isAdmin: boolean): string {
  return isAdmin && typeof id === 'string' && (id === NOVA_AUTO || NOVA_MODELS.some(m => m.id === id)) ? id : NOVA_AUTO
}

// ── Routing (lib/nova/router) ────────────────────────────────────────────────

export type NovaTier = 'light' | 'create' | 'production' | 'run'

/**
 * Which model runs each kind of turn - set from the 2026-10-18/19 evaluation
 * (8 Nova tasks x Gemini 4 Argon / 3.8 Flash / 3.1 Pro / 3.5 Flash-Lite, plus
 * a critic test on 5 real deliverables with planted flaws):
 *  - light / create -> 3.8 Flash: as good as Argon on single images, edits,
 *    memory and advice, 2-5x faster and a fraction of the cost.
 *  - production (PLANNING a multi-step job) -> Gemini 4 Argon: the only model
 *    that planned the bakery ad like a producer (keyframes first, an end card
 *    made from the logo, the critic step) and that finished the hard library
 *    job (all 28 cuts filed correctly; Flash ran out of steps, Pro filed the
 *    wrong ones). It is slow (30-170s a turn), so it only plans.
 *  - run (carrying out an approved plan, waking after renders) -> 3.8 Flash:
 *    the same quality execution as Argon in 12s instead of 30s.
 *  - Flash-Lite is not used for turns: it leaked its reasoning into replies,
 *    filed half the cuts and chose a 75-ticket video model for a 45-ticket plan.
 */
export const NOVA_ROUTES: Record<NovaTier, string> = {
  light: 'gemini-3.8-flash',
  create: 'gemini-3.8-flash',
  production: 'gemini-4-argon',
  run: 'gemini-3.8-flash',
}

/**
 * The critic (lib/nova/critic): Gemini 4 Argon caught every planted flaw (a
 * cracked mascot sphere, 2 of 3 logos, a 16:9 picture asked for square, a
 * textured "flat" logo) in 7-25s; 3.8 Flash missed the crack, 3.1 Pro took
 * 30-74s. It runs once per production, so the stronger model is affordable.
 */
export const NOVA_CRITIC_MODEL = 'gemini-4-argon'

/** Turns a production may chain on its own (renders finished / step limit reached) before it waits for the user. */
export const NOVA_MAX_AUTO_TURNS = 12

// ── Pricing a chat turn ──────────────────────────────────────────────────────

/**
 * USD per million tokens, deliberately at the HIGH end so the margin survives
 * Google's price changes: Flash is priced at the raised 2027 rate of 3.7 Flash
 * ($1.50 in / $7.50 out; today it is half that), and a model with no published
 * price (Gemini 4 Argon) is priced like a premium model until it has one.
 * Thinking tokens bill as output.
 */
export function novaRate(model: string): { in: number; out: number } {
  if (model.includes('flash-lite')) return { in: 0.3, out: 1.5 }
  if (model.includes('flash') || model.includes('robotics')) return { in: 1.5, out: 7.5 }
  if (model.includes('pro')) return { in: 2.5, out: 15 }
  return { in: 5, out: 25 }
}

/** What one ticket is worth in model cost - the site's floor (packs sell a ticket for $0.08-0.20). */
export const NOVA_USD_PER_TICKET = 0.04
/** On top of the high rates above: chat is the part of Nova that costs us money with nothing to show for it. */
export const NOVA_CHAT_MARKUP = 1.5

/** cachedInputTokens: the part of inputTokens Google served from its cache (billed at a discount). */
export type NovaUsage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number }

export function novaChatUsd(model: string, u: NovaUsage): number {
  const r = novaRate(model)
  return (u.inputTokens / 1e6) * r.in + (u.outputTokens / 1e6) * r.out
}

/**
 * What Google actually bills for those tokens: cached input reads at a tenth
 * of the input rate (Gemini's implicit cache - measured 2026-10-20: from a
 * turn's second step on, ~93% of Flash's input was a cache read; Argon showed
 * none). Recorded per turn as `costUsd`; the ticket charge still uses
 * novaChatUsd, the full rate.
 */
export function novaChatCostUsd(model: string, u: NovaUsage): number {
  const r = novaRate(model)
  const cached = Math.min(u.inputTokens, u.cachedInputTokens ?? 0)
  return ((u.inputTokens - cached) / 1e6) * r.in + (cached / 1e6) * r.in * 0.1 + (u.outputTokens / 1e6) * r.out
}

/** Tickets for an amount of model cost (a turn mixes models: router, orchestrator, critic): at least 1, rounded up. */
export function novaTicketsForUsd(usd: number): number {
  return Math.max(1, Math.ceil((usd * NOVA_CHAT_MARKUP) / NOVA_USD_PER_TICKET - 1e-9))
}

/** Tickets for a chat turn's tokens on one model. */
export function novaChatTickets(model: string, u: NovaUsage): number {
  return novaTicketsForUsd(novaChatUsd(model, u))
}

/**
 * The most one turn's CHAT can cost - held from the balance before the turn
 * and the unused part given back after. The turn is capped in steps and output
 * tokens, so this is a ceiling the model cannot talk its way past; a
 * production turn also holds room for one critic review.
 */
export function novaTurnHold(model: string, withCritic = false, steps = NOVA_MAX_STEPS): number {
  const base = novaChatUsd(model, { inputTokens: steps * 14_000, outputTokens: steps * 1_500 })
  // A production turn also holds room for one critic review and the per-shot continuity checks (lib/nova/agent-tools-studio)
  const critic = withCritic ? novaChatUsd(NOVA_CRITIC_MODEL, { inputTokens: 20_000 + 4 * 12_000, outputTokens: 4_000 + 4 * 2_000 }) : 0
  return novaTicketsForUsd(base + critic)
}

/** Tool steps per turn (the default). A plan that needs more continues on the next turn. */
export const NOVA_MAX_STEPS = 8

/**
 * Steps per turn by tier (2026-10-19, owner: "routing/limits"). A production
 * has to make, CHECK and redo inside a turn - eight steps ran out before the
 * checks. Small turns keep a short leash. The turn's clock (lib/nova/agent)
 * still ends any turn at ~3.5 minutes; it then carries on by itself.
 */
export const NOVA_TIER_STEPS: Record<NovaTier, number> = { light: 6, create: 10, production: 16, run: 16 }

/** Assembling a cut is our own ffmpeg time: 1 ticket, plus 1 per started 30 seconds. */
export const novaCutTickets = (seconds: number) => 1 + Math.ceil(Math.max(1, seconds) / 30)

// ── Budgets ──────────────────────────────────────────────────────────────────

/**
 * The user's own spending limits (0 = no limit), kept in portalPreferences
 * `novaBudget`. What has been SPENT is a separate server-only ledger
 * (`_nova`), which the preferences route never lets the browser write.
 */
export type NovaBudget = {
  /** Most tickets one chat may spend in total. */
  perChat: number
  /** Most tickets Nova may spend in one UTC day / calendar month. */
  daily: number
  monthly: number
  /**
   * Nova may spend up to this much in one turn WITHOUT a plan; anything bigger
   * needs a plan the user approves (and then the plan's budget is the limit).
   */
  askAbove: number
}

export const DEFAULT_NOVA_BUDGET: NovaBudget = { perChat: 0, daily: 0, monthly: 0, askAbove: 10 }

export function sanitizeNovaBudget(raw: unknown): NovaBudget {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const n = (v: unknown, d: number, max: number) => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) && x >= 0 ? Math.min(max, x) : d
  }
  return {
    perChat: n(o.perChat, DEFAULT_NOVA_BUDGET.perChat, 100_000),
    daily: n(o.daily, DEFAULT_NOVA_BUDGET.daily, 100_000),
    monthly: n(o.monthly, DEFAULT_NOVA_BUDGET.monthly, 1_000_000),
    askAbove: n(o.askAbove, DEFAULT_NOVA_BUDGET.askAbove, 1_000),
  }
}

export type NovaSpend = { today: number; month: number }

/**
 * The agent's two personas (2026-10-20): Nova Studio (many chats, admin-only
 * for now) and Prism, the site guide every user has - one continuous chat per
 * account (Chat.source 'prism'). Same engine, tools, budgets and billing.
 */
export type NovaPersonaId = 'nova' | 'prism'
/**
 * Prism is admin-only again while it is developed (2026-10-20, owner: "switched
 * OFF for all users"). The server refuses Prism's routes to everyone else
 * (lib/nova/auth requireAgentUser) and the pages show its button and Feed-menu
 * switch to admins only. Opening it to everyone is this one flag.
 */
export const PRISM_ADMIN_ONLY = true
/**
 * The ChatGPT / Claude connector is admin-only until the owner makes it
 * public (2026-10-20): the /connect page, the profile menu's "Use in ChatGPT
 * & Claude", the Connected apps list, and the sign-in that creates a
 * connection (/oauth/authorize) are for admins. The connector's discovery
 * documents stay up (they reveal nothing), so the apps can still be tested.
 */
export const CONNECTOR_ADMIN_ONLY = true
/** Where the user compacted or cleared the context (shown as a divider after that message). */
export type NovaContextMark = { afterId: number; kind: 'compact' | 'clear'; at: string }

/**
 * A run budget (2026-10-19, owner): set in the prompt box for each request -
 * the most Nova may spend on that request (with every turn it carries on by
 * itself) without asking. Requests sent without one fall back to askAbove a
 * turn, and askAbove x NOVA_CHAIN_ASK_MULTIPLE for the whole request.
 */
export const NOVA_RUN_BUDGET_MAX = 100_000
export const NOVA_RUN_BUDGET_PRESETS = [10, 25, 50, 100, 250, 500] as const
export function cleanRunBudget(v: unknown): number | undefined {
  const x = Math.round(Number(v))
  return Number.isFinite(x) && x >= 1 ? Math.min(NOVA_RUN_BUDGET_MAX, x) : undefined
}

// ── Message shapes (what the screen renders) ─────────────────────────────────

export type NovaMediaKind = 'image' | 'video' | 'audio' | '3d' | 'cut'

/** One thing Nova did in a turn: a library action, a generation, a plan... */
export type NovaStep = {
  id: string
  tool: string
  /** One line for the step card ("NanoBanana 2.1 · 1:1", "Moved 4 to Ads"). */
  label: string
  status: 'running' | 'pending' | 'done' | 'error'
  kind?: NovaMediaKind
  model?: string
  prompt?: string
  /** The finished media (signed when sent to the browser). */
  mediaUrl?: string
  posterUrl?: string
  /** The saved GeneratedImage row, once known - what "#id" in the chat refers to. */
  generationId?: number
  /** A render that finishes after the turn (video, audio, 3D): settled by the jobs route. */
  queueId?: number
  requestId?: string
  threeDJobId?: number
  tickets?: number
  /**
   * Tickets a pay-first tool (lib/nova/agent-tools prepayTool) has taken and
   * not yet squared up (billing sweep 2026-10-23). Cleared to 0 when the tool
   * delivers or refunds; a turn killed mid-render leaves it set, and
   * sweepStaleTurns refunds it - once, under the reply's `running` claim.
   */
  prepaid?: number
  error?: string
  /** A short result for library tools ("12 matches"). */
  note?: string
  /** When the step began (server clock, epoch ms): its timer counts from here, so a reload keeps it (2026-10-19). */
  startedAt?: number
  /**
   * How much of the reply's text was written when this step began (2026-10-20,
   * owner: Prism's "done" recap showed ABOVE the pictures it was about). The
   * chat lays text and steps out in the order they happened: what was said
   * before the work, the work, then the wrap-up under it. Older steps have none
   * and show before the text.
   */
  textAt?: number
}

export type NovaPlan = {
  summary: string
  steps: { title: string; tickets: number }[]
  totalTickets: number
  status: 'proposed' | 'approved' | 'declined' | 'replaced'
  /** What the user approved (may differ from what was asked). */
  approvedTickets?: number
  /**
   * Approved by the studio, not the user (2026-10-19): the plan fitted inside
   * what this run may spend without asking, so Nova went straight on.
   */
  auto?: boolean
}

export type NovaMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** user: attached library items. */
  attachments?: { id: number; url: string; kind: NovaMediaKind }[]
  /** user: Assets the user picked for this message (lib/user-assets) - Nova gets their notes and pictures. */
  assets?: { id: number; name: string; kind: string; thumb?: string | null }[]
  /** user: a system note (renders finished / plan approved), not typed by the user. */
  system?: boolean
  /** assistant: */
  steps?: NovaStep[]
  plan?: NovaPlan
  model?: string
  /** Tickets this turn cost: chat tokens and generations, and what it WOULD have cost an admin (who pays nothing). */
  /** `free`: a Prism quick question paid from the daily free AI-text allowance. */
  tickets?: { chat: number; media: number; charged: boolean; free?: boolean }
  /** Nova asked to be woken when its renders finish. */
  continueAfterRenders?: boolean
  /** The turn ran out of steps or time before the work was done: it carries on by itself. */
  keepGoing?: boolean
  /**
   * The reply is still being written on the server (a page opened or reloaded
   * mid-turn): the studio shows Nova at work and follows it until it lands.
   */
  running?: boolean
  /** How the turn was routed (lib/nova/router); `mix` = steps per model when they differed (lib/nova/agent stepModel). */
  route?: { tier: NovaTier; model: string; why: string; mix?: Record<string, number> }
}

export type NovaChatSummary = {
  id: number
  title: string
  model: string
  updatedAt: string
  spent: number
  folderId: number | null
  /** A background turn finished here while the user was away. */
  unread?: boolean
}

/** NDJSON events from the send route. */
export type NovaStreamEvent =
  | { t: 'text'; d: string }
  | { t: 'step'; step: NovaStep }
  | { t: 'plan'; plan: NovaPlan }
  | { t: 'done'; message: NovaMessage; balance: number | null; spend: NovaSpend; chatSpent: number }
  | { t: 'error'; error: string; needTickets?: boolean }
