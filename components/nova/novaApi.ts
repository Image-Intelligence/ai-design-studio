"use client"

import type { NovaBudget, NovaChatSummary, NovaContextMark, NovaMessage, NovaSpend, NovaStep, NovaStreamEvent } from "@/lib/nova/config"

/*
 * Nova Studio's calls to /api/nova (2026-10-18). Thin wrappers, so the studio
 * component reads as UI and every error comes back as a plain message.
 */

export type NovaChatDetail = NovaChatSummary & { plan: { total: number; spent: number } | null }
/** A chat's references as the panel shows them (lib/nova/chat-refs). */
export type NovaRefAsset = { id: number; name: string; kind: string; notes: string; thumb: string | null; pictures: { url: string; thumb: string | null }[]; ids: number[] }
export type NovaRefGeneration = { id: number; kind: string; url: string; thumb: string | null; prompt: string; model: string }
export type NovaChatRefs = { assets: NovaRefAsset[]; generations: NovaRefGeneration[] }
/** The look bible Nova set for a chat (lib/nova/chat-refs resolveBible). */
export type NovaChatBible = { characters: { name: string; pictures: { id: number; thumb: string | null }[] }[]; places: { name: string; pictures: { id: number; thumb: string | null }[] }[]; style: string }
/** A note Nova remembers about the user (lib/nova/memory). */
export type NovaNote = { id: string; text: string; at: string }
/** Background runs (lib/nova/background): a revocable API key of the user's own, used by the cron. */
export type NovaBackground = { enabled: boolean; keyPrefix: string | null; since: string | null; available: boolean }
export type NovaSettings = { budget: NovaBudget; spend: NovaSpend; balance: number | null; memory: NovaNote[]; background?: NovaBackground }
export type NovaOverview = { chats: NovaChatSummary[]; isAdmin: boolean; budget: NovaBudget; spend: NovaSpend; balance: number | null }
export type NovaJobsResult = { updates: { messageId: number; step: NovaStep }[]; pending: number; readyToContinue: boolean }
export type NovaSendBody = {
  text: string
  attachmentIds?: number[]
  /** Assets the user picked: Nova gets their notes and pictures. */
  assetIds?: number[]
  /** Asset pictures with no generation row (uploaded straight into an asset). */
  attachmentUrls?: string[]
  model?: string
  approvePlan?: { messageId: number; tickets: number }
  declinePlan?: { messageId: number }
  continue?: boolean
  /** The prompt box's run budget: the most this request may spend without asking. */
  runBudget?: number
}

/** How much Prism's next reply re-reads: messages since the last compact / clear, and whether there is a summary. */
export type PrismContext = { messages: number; summary: boolean; marks: NovaContextMark[] }
export type PrismOverview = {
  chat: NovaChatSummary
  isAdmin: boolean
  budget: NovaBudget
  spend: NovaSpend
  balance: number | null
  /** Free quick questions left today (null = unmetered, an admin). */
  freeLeft: number | null
  freeLimit: number | null
  context: PrismContext
}

export class NovaError extends Error {
  status: number
  needTickets: boolean
  constructor(message: string, status: number, needTickets = false) {
    super(message)
    this.status = status
    this.needTickets = needTickets
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({} as Record<string, unknown>))
  if (!r.ok) {
    const msg = typeof (j as any).error === "string" ? (j as any).error
      : r.status === 401 ? "Sign in first"
      : r.status === 403 ? "Nova Studio is admin-only while it is being tested"
      : `Request failed (${r.status})`
    throw new NovaError(msg, r.status, (j as any).needTickets === true)
  }
  return j as T
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export const novaApi = {
  overview: () => call<NovaOverview>("/api/nova/chats"),
  createChat: (title?: string) => call<{ chat: NovaChatSummary }>("/api/nova/chats", json(title ? { title } : {})),
  /** A chat and a page of its messages: the newest `take`, or those before message `before` (older pages). */
  chat: (id: number, page?: { take?: number; before?: number }) => call<{ chat: NovaChatDetail; messages: NovaMessage[]; hasMore?: boolean; marks?: NovaContextMark[]; refs?: NovaChatRefs; bible?: NovaChatBible | null }>(
    `/api/nova/chats/${id}${page ? `?${new URLSearchParams(Object.entries(page).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString()}` : ""}`),
  /** Prism, the site guide: the account's one Prism chat (made on first open), its limits and today's free questions. */
  prism: () => call<PrismOverview>("/api/prism"),
  /** Take Prism's context back to its cheapest point. */
  prismContext: (action: "compact" | "clear") => call<{ ok: true; context: PrismContext }>("/api/prism", json({ action })),
  patchChat: (id: number, patch: { title?: string; model?: string; refs?: { assets: number[]; generations: number[] }; bible?: null }) =>
    call<{ chat: NovaChatSummary; refs?: NovaChatRefs }>(`/api/nova/chats/${id}`, json(patch, "PATCH")),
  deleteChat: (id: number) => call<{ ok: true }>(`/api/nova/chats/${id}`, { method: "DELETE" }),
  jobs: (id: number) => call<NovaJobsResult>(`/api/nova/chats/${id}/jobs`),
  settings: () => call<NovaSettings>("/api/nova/settings"),
  saveSettings: (budget: NovaBudget) => call<NovaSettings>("/api/nova/settings", json({ budget }, "PUT")),
  forgetNote: (id: string) => call<NovaSettings>(`/api/nova/settings?note=${encodeURIComponent(id)}`, { method: "DELETE" }),
  setBackground: (on: boolean) => call<NovaSettings>("/api/nova/settings", json({ background: on }, "PUT")),
  /** Stop the running reply on the server (it no longer stops when the connection drops). */
  stopChat: (id: number) => call<{ stopped: number }>(`/api/nova/chats/${id}/stop`, json({})),
}

/**
 * Send a turn and read its NDJSON stream, one event at a time. A JSON error
 * (402 / 400 / 403) can come back instead of a stream - it becomes a thrown
 * NovaError, exactly like the other calls.
 */
export async function novaSend(
  chatId: number,
  body: NovaSendBody,
  onEvent: (e: NovaStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`/api/nova/chats/${chatId}/send`, { ...json(body), signal })
  const type = r.headers.get("content-type") ?? ""
  if (!r.ok || !r.body || type.includes("application/json")) {
    const j = await r.json().catch(() => ({} as Record<string, unknown>))
    if (r.ok && !(j as any).error) return
    const msg = typeof (j as any).error === "string" ? (j as any).error
      : r.status === 403 ? "Nova Studio is admin-only while it is being tested"
      : `Nova could not answer (${r.status})`
    throw new NovaError(msg, r.status, (j as any).needTickets === true)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try { onEvent(JSON.parse(line) as NovaStreamEvent) } catch { /* a torn line - skip it */ }
    }
  }
  const tail = buf.trim()
  if (tail) { try { onEvent(JSON.parse(tail) as NovaStreamEvent) } catch {} }
}

/** Put a step into a list by id (insert or replace). */
export function upsertStep(steps: NovaStep[] | undefined, step: NovaStep): NovaStep[] {
  const list = steps ? [...steps] : []
  const i = list.findIndex(s => s.id === step.id)
  if (i >= 0) list[i] = { ...list[i], ...step }
  else list.push(step)
  return list
}
