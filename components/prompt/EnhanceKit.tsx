"use client"

/*
 * Prompt enhancement on the client: one shared allowance (so the Text panel
 * and both composers show the same "3 of 5 left"), the call itself, and the
 * composers' ✨ Enhance button with Undo. Server side: /api/prompt/enhance.
 */

import { useEffect, useRef, useState } from "react"
import { Sparkles, Undo2, Loader2 } from "lucide-react"

export type EnhanceAllowance = { used: number; limit: number | null; plan: string; planLabel: string; isAdmin: boolean }
export type EnhanceRequest = {
  idea?: string
  existing?: string
  styles?: string[]
  target: "image" | "video"
  modelName?: string
  /** Admins only - the server ignores it for everyone else. */
  promptModel?: string
}

// ── shared allowance store ──────────────────────────────────────────────────
let current: EnhanceAllowance | null = null
let loading: Promise<void> | null = null
const listeners = new Set<(a: EnhanceAllowance | null) => void>()
const publish = (a: EnhanceAllowance | null) => { current = a; listeners.forEach(l => l(a)) }

export function refreshEnhanceAllowance(): Promise<void> {
  loading ??= fetch("/api/prompt/enhance")
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d && typeof d.used === "number") publish(d) })
    .catch(() => {})
    .finally(() => { loading = null })
  return loading
}

export function useEnhanceAllowance(enabled = true): EnhanceAllowance | null {
  const [a, setA] = useState<EnhanceAllowance | null>(current)
  useEffect(() => {
    if (!enabled) return
    listeners.add(setA)
    if (!current) refreshEnhanceAllowance()
    return () => { listeners.delete(setA) }
  }, [enabled])
  return a
}

/** Left today, or null for unlimited / not yet known. */
export const enhancesLeft = (a: EnhanceAllowance | null) => (a && a.limit !== null ? Math.max(0, a.limit - a.used) : null)

export class EnhanceError extends Error {
  constructor(message: string, public limitReached = false) { super(message) }
}

/** Run one enhancement; updates the shared allowance either way. */
export async function enhancePrompt(req: EnhanceRequest): Promise<string> {
  const res = await fetch("/api/prompt/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  const d = await res.json().catch(() => ({}))
  if (d && typeof d.used === "number") publish({ used: d.used, limit: d.limit ?? null, plan: d.plan, planLabel: d.planLabel, isAdmin: !!d.isAdmin })
  if (!res.ok || !d.prompt) throw new EnhanceError(d.error || "Enhancement failed", !!d.limitReached)
  return d.prompt as string
}

/**
 * ✨ Enhance for a composer: rewrites whatever is typed into a full prompt for
 * the selected model, and offers Undo until the text is edited again.
 */
export function EnhanceButton({ text, onReplace, target, modelName, signedIn = true, className = "" }: {
  text: string
  onReplace: (next: string) => void
  target: "image" | "video"
  modelName?: string
  signedIn?: boolean
  className?: string
}) {
  const allowance = useEnhanceAllowance(signedIn)
  const left = enhancesLeft(allowance)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null)
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Undo only applies while the text is still what Enhance wrote
  useEffect(() => { if (undo && text !== undo.after) setUndo(null) }, [text, undo])

  const flash = (m: string) => {
    setErr(m)
    if (errTimer.current) clearTimeout(errTimer.current)
    errTimer.current = setTimeout(() => setErr(null), 6000)
  }
  const run = async () => {
    if (busy) return
    if (!signedIn) { flash("Sign in to enhance prompts"); return }
    const before = text.trim()
    if (!before) { flash("Type an idea first, then Enhance"); return }
    setBusy(true); setErr(null)
    try {
      const out = await enhancePrompt({ existing: before, target, modelName })
      onReplace(out)
      setUndo({ before: text, after: out })
    } catch (e) {
      flash(e instanceof Error ? e.message : "Enhancement failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`relative flex items-center gap-1 ${className}`}>
      {undo ? (
        <button
          onClick={() => { onReplace(undo.before); setUndo(null) }}
          title="Put back what you typed"
          className="h-7 px-2 rounded-lg border border-white/15 bg-white/[0.06] text-[10px] font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
        >
          <Undo2 size={11} /> Undo
        </button>
      ) : null}
      <button
        onClick={run}
        disabled={busy}
        title={`Rewrite what you typed into a full ${target} prompt${modelName ? ` for ${modelName}` : ""}${left !== null ? ` · ${left} left today` : ""}`}
        className="h-7 px-2 rounded-lg border border-violet-400/30 bg-violet-500/10 text-[10px] font-semibold text-violet-100 hover:bg-violet-500/20 hover:border-violet-400/50 transition-colors flex items-center gap-1 disabled:opacity-60"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        <span>Enhance</span>
        {left !== null && <span className="text-violet-300/70 font-mono">{left}</span>}
      </button>
      {err && (
        <div className="absolute bottom-full right-0 mb-1.5 w-60 rounded-lg border border-white/10 bg-[#0b0f19] px-2.5 py-1.5 text-[10px] leading-snug text-slate-300 shadow-xl z-50">
          {err}
          {/used today/i.test(err) && <a href="/prompting-studio/subscribe" className="block mt-1 text-violet-300 hover:text-violet-200">See Dev Tier plans →</a>}
        </div>
      )}
    </div>
  )
}
