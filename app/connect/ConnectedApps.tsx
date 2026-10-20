"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2, Unplug } from "lucide-react"

/** The connector address with a copy button. */
export function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate text-[13px] text-slate-100">{url}</code>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 text-[11.5px] text-slate-200 hover:bg-white/[0.06]">
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

type Row = { id: string; app: string; connectedAt: string; lastUsedAt: string | null }
const when = (s: string | null) => { if (!s) return "never"; const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }

/** The account's connections (GET / DELETE /api/user/connections); signed out, a sign-in link. */
export function ConnectedApps() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch("/api/user/connections", { cache: "no-store" })
      .then(async r => { if (r.status === 401) { setSignedOut(true); return } const j = await r.json(); setRows(j.connections ?? []) })
      .catch(() => setError("Could not load your connections"))
  }, [])
  const remove = async (id: string) => {
    setBusy(id); setError(null)
    try {
      const r = await fetch(`/api/user/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "Could not disconnect")
      setRows(j.connections ?? [])
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  if (signedOut) return <p className="mt-2 text-[13px] text-slate-400"><a href="/login?next=%2Fconnect" className="underline text-white">Sign in</a> to see the apps connected to your account.</p>
  if (!rows) return <p className="mt-2 text-[13px] text-slate-500">{error ?? "Loading…"}</p>
  return (
    <div className="mt-2">
      {!rows.length ? (
        <p className="text-[13px] text-slate-500">No apps are connected to your account.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map(r => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-[12px] font-black">{r.app.slice(0, 1)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-white">{r.app}</span>
                <span className="block text-[11px] text-slate-500">Connected {when(r.connectedAt)} · last used {when(r.lastUsedAt)}</span>
              </span>
              <button type="button" onClick={() => void remove(r.id)} disabled={busy === r.id}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-400/30 text-[12px] text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />} Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
    </div>
  )
}
