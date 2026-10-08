"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { ArrowLeft, BadgeCheck, Loader2, RefreshCw, Search, Copy, Check, RotateCcw, ExternalLink, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

// Admin console for ID verification (Didit) - who is verified, who is stuck,
// and whether the integration is healthy. Data + actions: /api/admin/id-verifications.
// Verification itself only ever happens at Didit; this page can re-read a
// session from Didit ("Refresh") or make an account verify again ("Reset").

type Row = {
  id: number; email: string; name: string | null; createdAt: string
  idVerifiedAt: string | null; idVerificationStatus: string | null
  idVerificationSessionId: string | null; contentTermsAcceptedAt: string | null
}
type Data = {
  counts: Record<string, number>
  rows: Row[]; page: number; pages: number
  config: { available: boolean; webhookSecret: boolean; webhookUrl: string }
}

const FILTERS: { key: string; label: string; tone: string }[] = [
  { key: "started", label: "Started", tone: "text-slate-200" },
  { key: "verified", label: "Verified", tone: "text-emerald-300" },
  { key: "review", label: "In review", tone: "text-amber-300" },
  { key: "progress", label: "In progress", tone: "text-sky-300" },
  { key: "declined", label: "Declined", tone: "text-red-300" },
  { key: "abandoned", label: "Abandoned", tone: "text-slate-400" },
  { key: "all", label: "All accounts", tone: "text-slate-400" },
]

function getAdminPassword(): string {
  try { return sessionStorage.getItem("admin-password") ?? "" } catch { return "" }
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—")

/** The badge for an account: verified wins; then Didit's latest status; terms only = opened the popup and stopped. */
function StatusBadge({ r }: { r: Row }) {
  const s = r.idVerificationStatus
  const [label, cls] = r.idVerifiedAt ? ["Verified", "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"]
    : s === "In Review" ? ["In review", "bg-amber-500/15 text-amber-300 border-amber-500/25"]
    : s?.startsWith("Declined") || s === "Kyc Expired" ? [s, "bg-red-500/15 text-red-300 border-red-500/25"]
    : s === "Abandoned" || s === "Expired" ? [s, "bg-white/[0.06] text-slate-400 border-white/10"]
    : s ? [s, "bg-sky-500/15 text-sky-300 border-sky-500/25"]
    : r.contentTermsAcceptedAt ? ["Terms only", "bg-white/[0.06] text-slate-400 border-white/10"]
    : ["Not started", "bg-white/[0.03] text-slate-500 border-white/[0.06]"]
  return <span className={cn("inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap", cls)}>{label}</span>
}

export default function IdVerificationsAdminPage() {
  const [pw, setPw] = useState("")
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("started")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null)

  const headers = useCallback((): Record<string, string> => {
    const p = getAdminPassword()
    return p ? { "x-admin-password": p } : {}
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, page: String(page), ...(query ? { q: query } : {}) })
      const res = await fetch(`/api/admin/id-verifications?${params}`, { headers: headers() })
      if (res.status === 401) { setAuthed(false); return }
      const d = await res.json().catch(() => null)
      if (!res.ok) { setError(d?.error ?? "Could not load"); setAuthed(true); return }
      setError(null); setData(d); setAuthed(true)
    } finally { setLoading(false) }
  }, [filter, page, query, headers])

  useEffect(() => { load() }, [load])

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    try { sessionStorage.setItem("admin-password", pw) } catch {}
    await load()
  }

  async function act(action: "refresh" | "reset", r: Row) {
    setBusy(`${action}-${r.id}`); setConfirmReset(null); setNote(null)
    try {
      const res = await fetch("/api/admin/id-verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ action, userId: r.id }),
      })
      const d = await res.json().catch(() => null)
      setNote(res.ok
        ? { id: r.id, text: action === "reset" ? "Reset - they'll verify again at their next upload" : `Didit says: ${d?.status ?? "unknown"}${d?.verified ? " (verified)" : ""}` }
        : { id: r.id, text: d?.error ?? "Failed", bad: true })
      await load()
    } finally { setBusy(null) }
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1200) }).catch(() => {})
  }

  if (authed === false) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center p-6">
        <form onSubmit={submitPassword} className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-2 text-white font-semibold"><BadgeCheck size={16} className="text-emerald-400" /> ID Verification</div>
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
          />
          <button className="w-full py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm hover:bg-emerald-500/30 transition-all">Unlock</button>
        </form>
      </div>
    )
  }

  const counts = data?.counts ?? {}
  const cfg = data?.config

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#050810]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/admin" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm">
            <ArrowLeft size={15} /> Admin
          </Link>
          <span className="text-white/10">|</span>
          <BadgeCheck size={16} className="text-emerald-400" />
          <h1 className="text-base font-semibold">ID Verification</h1>
          <a href="https://business.didit.me" target="_blank" rel="noreferrer"
            className="ml-auto hidden sm:inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-300 transition-colors">
            Didit console <ExternalLink size={11} />
          </a>
          <button onClick={load} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all" title="Reload">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Integration health: what would silently break verification */}
        {cfg && (
          <div className="grid sm:grid-cols-3 gap-3">
            <Health ok={cfg.available} label="Didit API key + workflow" bad="Missing DIDIT_API_KEY or DIDIT_WORKFLOW_ID - nobody can verify" />
            <Health ok={cfg.webhookSecret} label="Webhook secret" bad="Missing DIDIT_WEBHOOK_SECRET - late results (In Review → Approved) won't arrive" />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Webhook URL (set in Didit)</p>
              <button onClick={() => copy(cfg.webhookUrl)} className="mt-1 w-full flex items-center gap-1.5 text-left text-[11px] font-mono text-slate-300 hover:text-white truncate">
                {copied === cfg.webhookUrl ? <Check size={11} className="shrink-0 text-emerald-400" /> : <Copy size={11} className="shrink-0" />}
                <span className="truncate">{cfg.webhookUrl}</span>
              </button>
            </div>
          </div>
        )}

        {/* Buckets - each one a filter */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setPage(1) }}
              className={cn("rounded-xl border p-3 text-left transition-all",
                filter === f.key ? "border-white/30 bg-white/[0.07]" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]")}>
              <p className={cn("text-xl font-semibold tabular-nums", f.tone)}>{counts[f.key] ?? "—"}</p>
              <p className="text-[11px] text-slate-500">{f.label}</p>
            </button>
          ))}
        </div>

        <form onSubmit={e => { e.preventDefault(); setQuery(q.trim()); setPage(1) }} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.1] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
          </div>
          <button className="px-4 rounded-lg bg-white/[0.06] border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.1] transition-all">Search</button>
        </form>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[13px] text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* Accounts */}
        <div className="rounded-xl border border-white/10 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Account</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="text-left font-semibold px-3 py-2">Verified</th>
                <th className="text-left font-semibold px-3 py-2">Terms accepted</th>
                <th className="text-left font-semibold px-3 py-2">Didit session</th>
                <th className="text-right font-semibold px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No accounts here yet</td></tr>
              )}
              {data?.rows.map(r => (
                <tr key={r.id} className="border-t border-white/[0.05] align-top">
                  <td className="px-3 py-2.5">
                    <p className="text-slate-100 break-all">{r.email}</p>
                    <p className="text-[11px] text-slate-600">#{r.id} · joined {fmt(r.createdAt)}</p>
                    {note?.id === r.id && <p className={cn("text-[11px] mt-1", note.bad ? "text-red-400" : "text-emerald-400")}>{note.text}</p>}
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge r={r} /></td>
                  <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmt(r.idVerifiedAt)}</td>
                  <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmt(r.contentTermsAcceptedAt)}</td>
                  <td className="px-3 py-2.5">
                    {r.idVerificationSessionId ? (
                      <button onClick={() => copy(r.idVerificationSessionId!)} title="Copy - search it in Didit's console"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-white">
                        {copied === r.idVerificationSessionId ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        {r.idVerificationSessionId.slice(0, 8)}…
                      </button>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {r.idVerificationSessionId && (
                        <button onClick={() => act("refresh", r)} disabled={!!busy} title="Re-read this session from Didit"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-[11px] text-slate-300 hover:bg-white/[0.08] disabled:opacity-40 transition-all">
                          {busy === `refresh-${r.id}` ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
                        </button>
                      )}
                      {(r.idVerificationStatus || r.idVerifiedAt) && (confirmReset === r.id ? (
                        <>
                          <button onClick={() => act("reset", r)} disabled={!!busy}
                            className="px-2 py-1 rounded-md border border-red-500/40 bg-red-500/15 text-[11px] text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-all">
                            {busy === `reset-${r.id}` ? <Loader2 size={11} className="animate-spin" /> : "Confirm reset"}
                          </button>
                          <button onClick={() => setConfirmReset(null)} className="px-2 py-1 rounded-md text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmReset(r.id)} disabled={!!busy} title="Make this account verify again"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-[11px] text-slate-400 hover:text-red-300 hover:border-red-500/30 disabled:opacity-40 transition-all">
                          <RotateCcw size={11} /> Reset
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-[12px] text-slate-400">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded-md border border-white/10 disabled:opacity-30 hover:bg-white/[0.05]">Previous</button>
            <span>Page {data.page} of {data.pages}</span>
            <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages} className="px-3 py-1 rounded-md border border-white/10 disabled:opacity-30 hover:bg-white/[0.05]">Next</button>
          </div>
        )}

        <p className="text-[11px] text-slate-600 leading-relaxed">
          Only the result is stored here (status, dates, Didit&apos;s session id) - ID photos, selfies, names and dates of birth stay at Didit.
          Look a session up in Didit&apos;s console by its id. <span className="text-slate-500">Refresh</span> re-reads a session from Didit
          (use it when a result looks stuck); <span className="text-slate-500">Reset</span> makes the account verify again. Admins never need to verify.
        </p>
      </main>
    </div>
  )
}

function Health({ ok, label, bad }: { ok: boolean; label: string; bad: string }) {
  return (
    <div className={cn("rounded-xl border p-3", ok ? "border-emerald-500/20 bg-emerald-500/[0.05]" : "border-red-500/30 bg-red-500/10")}>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={cn("mt-1 text-[12px]", ok ? "text-emerald-300" : "text-red-300")}>{ok ? "Configured" : bad}</p>
    </div>
  )
}
