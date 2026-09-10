"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Plus, X, UsersRound, HelpCircle, Check } from "lucide-react"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { Dropdown } from "@/components/employees/Dropdown"

/**
 * Character Design, as a board builder rather than a chat.
 *
 * One character per project. References (or nothing but a description) go in,
 * and the sheets that lock the design come out. The employee behind it is the
 * same one the hub runs; only the surface changes.
 */

/** The sheets the user can ask for. Named so the request is unambiguous. */
const SHEETS = [
  { id: "turnaround", label: "Turnaround", hint: "front, 3/4, profile, back" },
  { id: "expressions", label: "Expressions", hint: "the face under emotion" },
  { id: "poses", label: "Poses", hint: "how the body reads" },
  { id: "wardrobe", label: "Wardrobe", hint: "same body, different clothes" },
  { id: "accessories", label: "Accessories", hint: "props on a clean ground" },
  { id: "palette", label: "Colour & material", hint: "swatches and fabrics" },
  { id: "closeups", label: "Close studies", hint: "hands, hair, signature detail" },
] as const

const MAX_REFS = 8

export function CharacterStudioWorkspace({
  signedIn,
  renderFeed,
  activeRefs,
  onRemoveRef,
  onUploadRefs,
  onEditRef,
}: {
  signedIn: boolean
  renderFeed: (kind: "image" | "video", nonce?: number) => React.ReactNode
  activeRefs: { id: string; url: string }[]
  onRemoveRef: (id: string) => void
  onUploadRefs: (items: { id: string; url: string }[]) => void
  onEditRef: (id: string, url: string) => void
}) {
  const refs = activeRefs
  const [brief, setBrief] = useState("")
  const [picked, setPicked] = useState<string[]>(["turnaround", "expressions", "poses"])
  const [quality, setQuality] = useState("4k")
  const [aspect, setAspect] = useState("1:1")
  const [uploading, setUploading] = useState(false)
  const [feedKey, setFeedKey] = useState(0)
  const [chatId, setChatId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  /**
   * The run is paused on a question, and these are the calls awaiting an
   * answer. Without this the board could reach "Waiting for you" and simply
   * stay there for ever — the status said the employee needed a decision and
   * offered no way to give one.
   */
  const [approvals, setApprovals] = useState<{ toolCallId: string; label: string }[]>([])
  const [pausedMessageId, setPausedMessageId] = useState<number | null>(null)
  const [answering, setAnswering] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sigRef = useRef("")
  /** Set once the account's saved workspace has been read, so the debounced
   *  save below cannot overwrite it with the empty initial state. */
  const loadedRef = useRef(false)
  const chatIdRef = useRef<number | null>(null)
  useEffect(() => { chatIdRef.current = chatId }, [chatId])

  /*
   * The workspace belongs to the ACCOUNT, not to the tab.
   *
   * Everything here used to be plain component state, so a refresh emptied the
   * brief, reset the sheets and — worst — lost the id of the project that was
   * mid-run, orphaning work that was still going. It lives in
   * portalPreferences, the same Json column the film studio uses, so it
   * follows the account to any device and survives a reload.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/user/preferences", { cache: "no-store" })
        const d = await r.json().catch(() => null)
        const cfg = d?.preferences?.characterStudio
        if (!cancelled && cfg && typeof cfg === "object") {
          if (typeof cfg.brief === "string") setBrief(cfg.brief)
          if (Array.isArray(cfg.picked) && cfg.picked.length) setPicked(cfg.picked.filter((x: unknown) => typeof x === "string"))
          if (typeof cfg.quality === "string") setQuality(cfg.quality)
          if (typeof cfg.aspect === "string") setAspect(cfg.aspect)
          const active = Number(cfg.activeProject ?? 0)
          if (active > 0 && !chatIdRef.current) setChatId(active)
        }
      } catch { /* an unreadable preference is not worth blocking the page */ }

      /*
       * No remembered project — reopen the most recent one.
       *
       * The preference only starts being written from now on, so projects
       * created before it existed would otherwise be unreachable: still
       * running, possibly paused on a question, with no way back into them.
       * The list is account-scoped, so this reopens the right one on any
       * device. "New" in the board header closes it.
       */
      if (!cancelled && !chatIdRef.current) {
        try {
          const r = await fetch("/api/employees/characters", { cache: "no-store" })
          const d = await r.json().catch(() => null)
          const newest = Array.isArray(d?.projects) ? d.projects[0] : null
          if (!cancelled && newest?.id) setChatId(Number(newest.id))
        } catch { /* nothing to resume */ }
      }
      if (!cancelled) loadedRef.current = true
    })()
    return () => { cancelled = true }
  }, [])

  // Debounced so typing a brief does not write on every keystroke.
  useEffect(() => {
    if (!loadedRef.current) return
    const t = setTimeout(() => {
      void fetch("/api/user/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterStudio: { brief, picked, quality, aspect, activeProject: chatId ?? 0 },
        }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [brief, picked, quality, aspect, chatId])

  const addFiles = useCallback(async (files: File[]) => {
    const room = MAX_REFS - refs.length
    if (room <= 0 || files.length === 0) return
    setUploading(true)
    try {
      const added: { id: string; url: string }[] = []
      for (const file of files.slice(0, room)) {
        const fd = new FormData()
        fd.append("file", file)
        const res = await fetch("/api/upload-reference", { method: "POST", body: fd })
        if (!res.ok) continue
        const { url } = await res.json()
        if (typeof url === "string") added.push({ id: url, url })
      }
      if (added.length) onUploadRefs(added)
    } finally {
      setUploading(false)
    }
  }, [refs.length, onUploadRefs])

  /** Read the project's state. Same shape as the film workspace's poll. */
  const readChat = useCallback(async (id: number) => {
    const res = await fetch(`/api/chat-hub/chats/${id}`, { cache: "no-store" })
    if (!res.ok) return
    const d = await res.json()
    const rows: any[] = d.messages ?? []
    const last = [...rows].reverse().find(m => m.role === "assistant")
    const meta = last?.metadata ?? {}
    const steps: any[] = meta.agentSteps ?? []
    const pending: any[] = meta.pendingApproval?.calls ?? []
    const running = [...steps].reverse().find(s => s.status === "running")

    setBusy(rows.length > 0 && pending.length === 0 && !!running)
    setStatus(
      pending.length ? "Waiting for you"
      : running ? "Working…"
      : rows.length ? "Standing by"
      : "",
    )

    // Carry the paused call out of the poll so the UI can answer it.
    setPausedMessageId(pending.length ? (last?.id ?? null) : null)
    setApprovals(pending.map((c: any) => ({
      toolCallId: String(c.toolCallId ?? c.id ?? ""),
      label: String(c.toolName ?? c.name ?? "this step"),
    })).filter((c: { toolCallId: string }) => c.toolCallId))

    // Only reload the feed when the project actually produced something new
    let made = 0
    for (const m of rows) made += Array.isArray(m?.imageUrls) ? m.imageUrls.length : 0
    const sig = String(made)
    if (sig !== sigRef.current) { sigRef.current = sig; setFeedKey(k => k + 1) }
  }, [])

  useEffect(() => {
    if (!chatId) return
    if (pollRef.current) clearInterval(pollRef.current)
    void readChat(chatId)
    pollRef.current = setInterval(() => { void readChat(chatId) }, 6000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [chatId, readChat])

  /** Answer whatever the run paused on, then let the poll pick it up. */
  const respond = useCallback(async (approved: boolean) => {
    const id = chatIdRef.current
    if (!id || pausedMessageId === null || approvals.length === 0 || answering) return
    setAnswering(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat-hub/chats/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: pausedMessageId,
          approvals: approvals.map(a => ({ toolCallId: a.toolCallId, approved })),
        }),
      })
      // The response streams the continued run; draining it is what keeps the
      // run alive, exactly as the initial send does.
      const reader = res.body?.getReader()
      if (reader) { for (;;) { const { done } = await reader.read(); if (done) break } }
      setApprovals([])
      setPausedMessageId(null)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setAnswering(false)
      void readChat(id)
    }
  }, [approvals, pausedMessageId, answering, readChat])

  const start = async () => {
    if (busy) return
    if (!brief.trim() && refs.length === 0) return
    setBusy(true)
    setError(null)
    setStatus("Reading the references…")
    try {
      const mk = await fetch("/api/employees/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!mk.ok) throw new Error("Could not start the project")
      const { project } = await mk.json()
      // A contract mismatch here used to surface as "Cannot read properties of
      // undefined", which says nothing about what actually went wrong.
      if (!project?.id) throw new Error("The server did not return a project")
      const sheets = SHEETS.filter(s => picked.includes(s.id)).map(s => `${s.label} (${s.hint})`)

      const res = await fetch(`/api/chat-hub/chats/${project.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content:
            (brief.trim() || "Design this character from the reference images.")
            + `\n\n[BOARD REQUESTED]\n${sheets.map(s => `- ${s}`).join("\n") || "- Turnaround"}\n`
            + `[OUTPUT SETTINGS — the user set these, treat them as fixed]\n`
            + `Every image: ${quality.toUpperCase()}, ${aspect} aspect.`,
          imageUrls: refs.map(r => r.url),
        }),
      })
      // Drain the stream: an unread response is a client that stopped
      // listening, and the run is cancelled with it.
      const reader = res.body?.getReader()
      if (reader) { for (;;) { const { done } = await reader.read(); if (done) break } }
      setChatId(project.id)
      void readChat(project.id)
    } catch (e: any) {
      setError(String(e?.message || e))
      setBusy(false)
    }
  }

  const started = chatId !== null

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 px-3 sm:px-4 pb-4">
      <div className="flex flex-col landscape:flex-row gap-3 min-h-0 flex-1 overflow-hidden">
        <div className="w-full landscape:w-[320px] shrink-0 flex flex-col portrait:flex-row gap-3 min-h-0 portrait:h-[176px]">
          {/* references */}
          <div className="relative flex flex-col min-h-0 flex-1 portrait:basis-1/2 rounded-2xl silver-edge p-3 portrait:p-2 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">The character</span>
              <span className="text-[10px] text-slate-500">{refs.length}/{MAX_REFS}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-wrap gap-1.5 content-start">
              {refs.map(r => (
                <div key={r.id} className="group relative w-[62px] h-[62px] portrait:w-[52px] portrait:h-[52px] shrink-0 rounded-lg overflow-hidden border border-white/10 bg-black/40">
                  <button onClick={() => onEditRef(r.id, r.url)} title="Edit this reference" className="absolute inset-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  </button>
                  <button
                    onClick={() => onRemoveRef(r.id)}
                    className="absolute z-10 top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-white/80 hover:text-white"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {refs.length < MAX_REFS && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-[62px] h-[62px] portrait:w-[52px] portrait:h-[52px] shrink-0 rounded-lg border border-dashed border-white/15 text-slate-500 hover:text-white hover:border-white/30 flex items-center justify-center transition-colors"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={e => { void addFiles([...(e.target.files ?? [])]); e.currentTarget.value = "" }} />
          </div>

          {/* brief + sheets */}
          <div className="relative flex flex-col min-h-0 flex-1 portrait:basis-1/2 rounded-2xl silver-edge p-3 portrait:p-2 overflow-hidden">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Who are they?
            </span>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              disabled={started}
              placeholder={refs.length ? "Anything the references don't show…" : "Describe the character — look, era, presence…"}
              className="w-full flex-1 min-h-[56px] rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-[12px] text-slate-100 placeholder:text-slate-600 resize-none focus:outline-none focus:border-cyan-500/40 disabled:opacity-60"
            />
            {/* Site dropdowns, not native selects: iOS renders those as a
                full-screen system picker over the panel. */}
            <div className="flex gap-1.5 mt-2">
              <Dropdown
                value={quality}
                disabled={started}
                onChange={setQuality}
                className="flex-1 min-w-0"
                options={[{ value: "2k", label: "2K" }, { value: "4k", label: "4K" }]}
              />
              <Dropdown
                value={aspect}
                disabled={started}
                onChange={setAspect}
                className="flex-1 min-w-0"
                options={["1:1", "4:5", "3:4", "2:3", "16:9"].map(a => ({ value: a, label: a }))}
              />
            </div>
            {(() => {
              const ready = (!!brief.trim() || refs.length > 0) && !busy && signedIn && !started
              return (
                <button
                  onClick={() => void start()}
                  disabled={!ready}
                  className={`relative overflow-hidden mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-bold transition-all ${
                    ready
                      ? "bg-white/10 border border-white/25 text-white hover:bg-white/15 hover:border-white/40"
                      : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
                  }`}
                >
                  {ready && (
                    <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
                      style={{ animation: "sheen-sweep 2.6s infinite" }} />
                  )}
                  {busy
                    ? <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    : <SiteLogoBox size={14} rounded={4} />}
                  {started ? "In progress" : "Build the board"}
                </button>
              )
            })()}
          </div>
        </div>

        {/* the board */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0 overflow-hidden">
          <div className="relative flex-1 min-h-0 portrait:flex-none portrait:h-[34vh] flex flex-col rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
            <SilverRimOverlay />
            <div className="shrink-0 px-3 py-1.5 border-b border-white/5 flex items-center gap-2">
              <UsersRound size={12} className="text-cyan-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">The board</span>
              {status && <span className="ml-auto text-[10px] text-slate-500">{status}</span>}
              {started && (
                // A project restored from the account can be mid-run, finished
                // or wedged, and without this there was no way to leave one and
                // begin another — the bench stays disabled while a project is
                // open, so a stuck project locked the whole workspace.
                <button
                  onClick={() => {
                    setChatId(null); setApprovals([]); setPausedMessageId(null)
                    setBusy(false); setStatus(""); setError(null); sigRef.current = ""
                  }}
                  title="Close this project and start a new one"
                  className={`${status ? "" : "ml-auto "}text-[10px] text-slate-500 hover:text-white transition-colors`}
                >
                  New
                </button>
              )}
            </div>

            {approvals.length > 0 && (
              /*
               * "Waiting for you" used to be a dead end: the status said the
               * employee needed a decision and the workspace offered no way to
               * give one, so the run sat paused for ever.
               */
              <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.07] px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-100">
                  The employee is waiting on you
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-amber-200/70">
                  {approvals.length === 1
                    ? `It wants to run ${approvals[0].label}.`
                    : `It wants to run ${approvals.length} steps: ${approvals.map(a => a.label).join(", ")}.`}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void respond(true)}
                    disabled={answering}
                    className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {answering ? "Sending…" : "Go ahead"}
                  </button>
                  <button
                    onClick={() => void respond(false)}
                    disabled={answering}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
                  >
                    Not that
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {!started ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                  <UsersRound size={20} className="text-slate-600" />
                  <p className="text-[11px] text-slate-500 max-w-sm">
                    Add references of ONE character, or describe them, then pick the sheets to build.
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5 max-w-lg">
                    {SHEETS.map(sh => {
                      const on = picked.includes(sh.id)
                      return (
                        <button
                          key={sh.id}
                          onClick={() => setPicked(p => on ? p.filter(x => x !== sh.id) : [...p, sh.id])}
                          title={sh.hint}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
                            on
                              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                              : "border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
                          }`}
                        >
                          {on && <Check size={10} className="inline mr-1 -mt-px" />}
                          {sh.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                  {busy
                    ? <><Loader2 size={18} className="animate-spin text-cyan-400/70" />
                        <span className="text-[11px]">{status}</span>
                        <span className="text-[10px] text-slate-600">sheets land in the feed below as they finish</span></>
                    : <><HelpCircle size={16} /><span className="text-[11px]">{status || "Standing by"}</span></>}
                  {error && (
                    <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-2 py-1.5 text-[11px] text-red-200">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 portrait:h-[30vh] landscape:h-[min(38vh,400px)]">
        <div className="relative h-full flex flex-col rounded-2xl silver-edge overflow-hidden">
          <div className="shrink-0 px-3 py-1.5 border-b border-white/5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sheets</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">{renderFeed("image", feedKey)}</div>
        </div>
      </div>
    </div>
  )
}
