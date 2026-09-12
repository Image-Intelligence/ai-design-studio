"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Plus, X, UsersRound, HelpCircle, Check } from "lucide-react"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { Dropdown } from "@/components/employees/Dropdown"
import { CHAT_IMAGE_MODELS } from "@/lib/chat-image-catalog"

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

/**
 * How the character comes out.
 *
 * The workspace only ever built reference SHEETS %s one image holding several
 * views of the same character. That is the right output for locking a design
 * and the wrong one for almost everything you do afterwards, so it is a mode
 * rather than the only behaviour.
 */
const MODES = [
  { id: "sheets", label: "Sheets", hint: "one image, several views of the character" },
  { id: "singles", label: "Singles", hint: "one character, one look, per image" },
] as const
type ModeId = (typeof MODES)[number]["id"]

/**
 * The image models this employee can actually run.
 *
 * Taken from the hub's own catalog rather than a second hand-written list:
 * the employee generates THROUGH the hub, so a model missing from there is not
 * selectable no matter what a picker claims. Sorted by maker so the list reads
 * the way the taskbar's picker does.
 */
const IMAGE_MODELS = [...CHAT_IMAGE_MODELS].sort(
  (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label),
)

const MAX_REFS = 8

export function CharacterStudioWorkspace({
  signedIn,
  isAdmin,
  renderFeed,
  activeRefs,
  onRemoveRef,
  onUploadRefs,
  onEditRef,
}: {
  signedIn: boolean
  isAdmin: boolean
  renderFeed: (
    kind: "image" | "video",
    nonce?: number,
    pending?: { queueId: number; prompt: string; at: number; model: string; aspect?: string; quality?: string; refs?: string[] }[],
  ) => React.ReactNode
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
  const [mode, setMode] = useState<ModeId>("sheets")
  const [model, setModel] = useState("nano-banana-pro-2")
  /** Finished plates by queue id, so the board can show them as they land. */
  /**
   * Every character project, as tabs.
   *
   * A project is a row in the database, not something this browser tab
   * remembers, so the same work is there on the next device. Replaces the old
   * single-project model, where the only way out of a finished or wedged
   * project was a "New" button that threw it away.
   */
  const [projects, setProjects] = useState<
    { id: number; title: string; awaitingUser?: boolean; shotsSubmitted?: number; shotsLanded?: number; filmUrl?: string | null }[]
  >([])
  const [renaming, setRenaming] = useState<{ id: number; text: string } | null>(null)
  const [confirmClose, setConfirmClose] = useState<number | null>(null)
  /**
   * Has THIS project actually started a run?
   *
   * The brief used to be locked by `chatId !== null`, which meant a project
   * restored from the account arrived disabled with nothing to do — the panel
   * said "Standing by" and refused to be edited. What should lock the brief is
   * the run having begun, not a project being open.
   */
  const [hasRun, setHasRun] = useState(false)
  const [plateUrls, setPlateUrls] = useState<Record<number, string>>({})
  /** Plates that died — without these a failed one spins for ever. */
  const [deadPlates, setDeadPlates] = useState<Record<number, string>>({})
  /** Plates still rendering. These are the feed's "generating" tiles. */
  const [pendingPlates, setPendingPlates] = useState<
    { queueId: number; prompt: string; at: number; model: string; aspect?: string; quality?: string; refs?: string[] }[]
  >([])
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
          if (cfg.mode === "sheets" || cfg.mode === "singles") setMode(cfg.mode)
          // Only restore a model that still exists and is still allowed: a
          // remembered id that has since gone admin-only, or been removed,
          // would otherwise sit in the picker and fail at generation time.
          if (typeof cfg.model === "string"
              && IMAGE_MODELS.some(m => m.id === cfg.model && (isAdmin || !m.admin))) {
            setModel(cfg.model)
          }
          const active = Number(cfg.activeProject ?? 0)
          if (active > 0 && !chatIdRef.current) setChatId(active)
        }
      } catch { /* an unreadable preference is not worth blocking the page */ }

      /*
       * The workspace never opens onto nothing.
       *
       * Reopen whichever project was last active, else the most recent one,
       * else start a fresh one — so there is always a tab, and a brief you can
       * actually type into. Projects created before the preference existed
       * would otherwise be unreachable: still running, possibly paused on a
       * question, with no way back into them.
       */
      if (!cancelled && !chatIdRef.current) {
        try {
          const r = await fetch("/api/employees/characters", { cache: "no-store" })
          const d = await r.json().catch(() => null)
          const list = Array.isArray(d?.projects) ? d.projects : []
          if (!cancelled && list.length > 0) setChatId(Number(list[0].id))
          else if (!cancelled) {
            const mk = await fetch("/api/employees/characters", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
            })
            const made = mk.ok ? await mk.json().catch(() => null) : null
            if (!cancelled && made?.project?.id) {
              setProjects([made.project])
              setChatId(Number(made.project.id))
            }
          }
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
          characterStudio: { brief, picked, quality, aspect, mode, model, activeProject: chatId ?? 0 },
        }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [brief, picked, quality, aspect, chatId])

  const plateSigRef = useRef("")
  const pendingSigRef = useRef("")

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

    setHasRun(rows.length > 0)
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

    /*
     * THE BOARD.
     *
     * Every generation this project has made, by queue id, in three states:
     * landed, died, still rendering. A step carries a queueId (one image) or
     * queueIds (a batch); the settler later writes shotResults[id] with either
     * a url or "ERROR:…". Reading all three is what lets a plate appear as a
     * spinner the moment it is submitted and become the picture in place —
     * rather than materialising out of nowhere once finished.
     */
    const urlById: Record<number, string> = {}
    const deadById: Record<number, string> = {}
    const waiting: { queueId: number; prompt: string; at: number; model: string; aspect?: string; quality?: string; refs?: string[] }[] = []

    for (const m of rows) {
      const at = Date.parse(m?.createdAt ?? "") || Date.now()
      for (const st of ((m?.metadata?.agentSteps ?? []) as any[])) {
        const res = (st?.shotResults && typeof st.shotResults === "object") ? st.shotResults : {}
        for (const [q, v] of Object.entries(res)) {
          if (typeof v !== "string" || !v) continue
          if (v.startsWith("ERROR:")) deadById[Number(q)] = v.slice(6).trim() || "Generation failed"
          else urlById[Number(q)] = v
        }
        // A single create_media that finished in the turn.
        if (typeof st?.queueId === "number" && typeof st?.imageUrl === "string" && st.imageUrl) {
          urlById[st.queueId] = st.imageUrl
        }
        if (st?.status === "error" && typeof st?.queueId === "number") {
          deadById[st.queueId] = String(st.error || "Generation failed").slice(0, 200)
        }

        const ids: number[] = Array.isArray(st?.queueIds)
          ? st.queueIds.filter((n: unknown): n is number => typeof n === "number")
          : typeof st?.queueId === "number" ? [st.queueId] : []
        const models = (st?.shotModels && typeof st.shotModels === "object") ? st.shotModels : {}
        for (const q of ids) {
          if (urlById[q] || deadById[q]) continue
          waiting.push({
            queueId: q,
            prompt: String(st?.prompt ?? "Character plate"),
            at,
            model: String(models[String(q)] ?? st?.model ?? ""),
            aspect: st?.settings?.aspect,
            quality: st?.settings?.quality ?? st?.settings?.resolution,
            refs: Array.isArray(st?.refs) ? st.refs : undefined,
          })
        }
      }
    }
    waiting.sort((a, b) => a.queueId - b.queueId)

    const plateSig = Object.keys(urlById).sort().join(",") + "!" + Object.keys(deadById).sort().join(",")
    if (plateSig !== plateSigRef.current) {
      plateSigRef.current = plateSig
      setPlateUrls(urlById)
      setDeadPlates(deadById)
    }
    const waitSig = waiting.map(w => w.queueId).join(",")
    if (waitSig !== pendingSigRef.current) {
      pendingSigRef.current = waitSig
      setPendingPlates(waiting)
    }

    // Only reload the feed when the project actually produced something new
    let made = 0
    for (const m of rows) made += Array.isArray(m?.imageUrls) ? m.imageUrls.length : 0
    const sig = String(made) + ":" + plateSig
    if (sig !== sigRef.current) { sigRef.current = sig; setFeedKey(k => k + 1) }
  }, [])

  useEffect(() => {
    if (!chatId) return
    if (pollRef.current) clearInterval(pollRef.current)
    void readChat(chatId)
    pollRef.current = setInterval(() => { void readChat(chatId); void loadProjects() }, 6000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [chatId, readChat])

  /** The tab strip's contents. Cheap, and polled with the open project. */
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/employees/characters", { cache: "no-store" })
      if (!res.ok) return
      const d = await res.json()
      if (Array.isArray(d.projects)) setProjects(d.projects)
    } catch { /* the strip is not worth an error banner */ }
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])

  /**
   * Switch tabs.
   *
   * Everything derived from the OLD project is cleared first: leaving plates,
   * approvals or a status line behind would show one project's work under
   * another's name until the first poll landed.
   */
  const openProject = useCallback((id: number) => {
    setChatId(id)
    setPlateUrls({}); setDeadPlates({}); setPendingPlates([])
    setApprovals([]); setPausedMessageId(null)
    setStatus(""); setError(null); setBusy(false); setHasRun(false)
    plateSigRef.current = ""; pendingSigRef.current = ""; sigRef.current = ""
  }, [])

  const newProject = useCallback(async () => {
    try {
      const res = await fetch("/api/employees/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
      const { project } = await res.json()
      if (!project?.id) return
      setProjects(prev => [project, ...prev])
      openProject(project.id)
      // A new tab is a blank brief, not the last one's.
      setBrief("")
    } catch { /* ignore */ }
  }, [openProject])

  const renameProject = useCallback(async (id: number, text: string) => {
    const clean = text.trim().slice(0, 80)
    setRenaming(null)
    if (!clean) return
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, title: clean } : p)))
    await fetch("/api/employees/characters", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: clean }),
    }).catch(() => {})
  }, [])

  const closeProject = useCallback(async (id: number) => {
    setConfirmClose(null)
    await fetch(`/api/employees/characters?id=${id}`, { method: "DELETE" }).catch(() => {})
    setProjects(prev => {
      const left = prev.filter(p => p.id !== id)
      if (chatIdRef.current === id) {
        if (left.length > 0) openProject(left[0].id)
        else { setChatId(null); setHasRun(false); setPlateUrls({}); setDeadPlates({}); setPendingPlates([]) }
      }
      return left
    })
  }, [openProject])

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
      const chosen = IMAGE_MODELS.find(m => m.id === model)
      /*
       * The mode is a layout instruction, and it has to be unambiguous.
       *
       * "Singles" fails in exactly one way: the model helpfully returns a
       * contact sheet anyway, because that is what "character design" looks
       * like in its training data. So the rule is stated as a prohibition with
       * the failure named, not as a preference.
       */
      const modeNote = mode === "singles"
        ? `[MODE — SINGLES]\n`
          + `Generate SEPARATE images, ONE per item below. Each image contains exactly ONE `
          + `view of the character, framed as a finished picture. Do NOT produce a grid, a `
          + `contact sheet, a collage, a multi-panel layout, or several poses side by side `
          + `in one frame — that is the other mode. One character, one look, one image.\n`
        : `[MODE — SHEETS]\n`
          + `Each item below is ONE image: a reference sheet holding several views of the `
          + `same character, laid out on a clean neutral ground, consistent scale and light `
          + `across the views.\n`

      const res = await fetch(`/api/chat-hub/chats/${project.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content:
            (brief.trim() || "Design this character from the reference images.")
            + `\n\n${modeNote}`
            + `[BOARD REQUESTED]\n${sheets.map(s => `- ${s}`).join("\n") || "- Turnaround"}\n`
            + `[OUTPUT SETTINGS — the user set these, treat them as fixed]\n`
            + `Every image: ${quality.toUpperCase()}, ${aspect} aspect.\n`
            + `MODEL: use \`${chosen?.id ?? model}\`${chosen ? ` (${chosen.label})` : ""} for every image in `
            + `this board. The user picked it; do not substitute. If it cannot do something being `
            + `asked of it, say which item and why in one line rather than quietly using another.`,
          imageUrls: refs.map(r => r.url),
        }),
      })
      // Drain the stream: an unread response is a client that stopped
      // listening, and the run is cancelled with it.
      const reader = res.body?.getReader()
      if (reader) { for (;;) { const { done } = await reader.read(); if (done) break } }
      setChatId(project.id)
      setHasRun(true)
      setProjects(prev => prev.some(p => p.id === project.id) ? prev : [project, ...prev])
      void readChat(project.id)
      void loadProjects()
    } catch (e: any) {
      setError(String(e?.message || e))
      setBusy(false)
    }
  }

  // See hasRun: a project that has not been run is still editable.
  const started = hasRun

  /**
   * One row per plate, whatever state it is in, in queue order.
   *
   * Merging the three sources here rather than in the markup is what lets a
   * tile KEEP its identity as it changes: the same queueId is the React key
   * whether it is rendering, finished or dead, so the picture replaces the
   * spinner in place instead of the grid re-shuffling under it.
   */
  const plates = (() => {
    const byId = new Map<number, { queueId: number; url?: string; error?: string }>()
    for (const pl of pendingPlates) byId.set(pl.queueId, { queueId: pl.queueId })
    for (const [q, url] of Object.entries(plateUrls)) byId.set(Number(q), { queueId: Number(q), url })
    for (const [q, err] of Object.entries(deadPlates)) byId.set(Number(q), { queueId: Number(q), error: err })
    return [...byId.values()].sort((a, b) => a.queueId - b.queueId)
  })()
  const settledCount = plates.filter(pl => pl.url || pl.error).length

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 px-3 sm:px-4 pb-4">
      {/* ── projects as tabs: each one is a row in the database, so a character
             is an ongoing project rather than whatever this browser remembers ── */}
      <div className="shrink-0 -mb-1 flex items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {projects.map(pr => {
          const open = chatId === pr.id
          const rendering = (pr.shotsSubmitted ?? 0) > (pr.shotsLanded ?? 0)
          return (
            <div
              key={pr.id}
              className={`group relative flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-t-lg border-t border-x text-[11px] shrink-0 max-w-[190px] transition-colors ${
                open
                  ? "border-white/15 bg-white/[0.06] text-slate-100"
                  : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200"
              }`}
            >
              {renaming?.id === pr.id ? (
                // Tap the title of the OPEN project to rename it in place.
                <input
                  autoFocus
                  value={renaming.text}
                  onChange={e => setRenaming({ id: pr.id, text: e.target.value })}
                  onBlur={() => void renameProject(pr.id, renaming.text)}
                  onKeyDown={e => {
                    if (e.key === "Enter") void renameProject(pr.id, renaming.text)
                    if (e.key === "Escape") setRenaming(null)
                  }}
                  className="w-[150px] bg-black/50 border border-cyan-500/40 rounded px-1.5 py-0.5 text-[11px] text-slate-100 focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => { if (!open) openProject(pr.id); else setRenaming({ id: pr.id, text: pr.title }) }}
                  title={open ? "Tap to rename" : pr.title}
                  className="flex items-center gap-1.5 min-w-0"
                >
                  {pr.awaitingUser
                    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Waiting for you" />
                    : rendering
                      ? <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" title="Rendering" />
                      : (pr.shotsLanded ?? 0) > 0
                        ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Built" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />}
                  <span className="truncate">{pr.title}</span>
                </button>
              )}
              <button
                onClick={() => setConfirmClose(pr.id)}
                title="Close this project"
                className="opacity-60 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-slate-500 hover:text-white transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => void newProject()}
          title="New character"
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-t-lg border-t border-x border-white/[0.06] bg-white/[0.02] text-[11px] text-slate-500 hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          <Plus size={11} />
        </button>
      </div>

      {confirmClose !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={() => setConfirmClose(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-[340px] rounded-2xl border border-white/10 bg-[#0e0e18] p-4 overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <SilverRimOverlay />
            <p className="text-[13px] font-semibold text-white">Close this project?</p>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              The board goes with it. Everything it generated stays in your feed.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void closeProject(confirmClose)}
                className="flex-1 rounded-lg border border-red-500/40 bg-red-500/15 py-1.5 text-[11px] font-semibold text-red-100 hover:bg-red-500/25 transition-colors"
              >
                Close it
              </button>
              <button
                onClick={() => setConfirmClose(null)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-slate-300 hover:border-white/30 hover:text-white transition-colors"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}

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
              {/* WHICH MODEL draws the character. The employee runs through the
                  hub, so this lists the hub's catalog rather than a second copy
                  of the taskbar's; admin-only models appear only for admins,
                  matching the gate the generate route enforces anyway. */}
              <Dropdown
                value={model}
                disabled={started}
                onChange={setModel}
                className="flex-1 min-w-0"
                options={IMAGE_MODELS
                  .filter(m => isAdmin || !m.admin)
                  .map(m => ({ value: m.id, label: m.label }))}
              />
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {/* SHEETS or SINGLES. See MODES. */}
              <Dropdown
                value={mode}
                disabled={started}
                onChange={v => setMode(v as ModeId)}
                className="flex-1 min-w-0"
                options={MODES.map(m => ({ value: m.id, label: m.label }))}
              />
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
            <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
              {MODES.find(m => m.id === mode)?.hint}
            </p>
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
                    Add references of ONE character, or describe them, then pick what to build.
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
              ) : plates.length > 0 ? (
                /*
                 * THE BOARD, as the work actually arrives.
                 *
                 * Every plate the project has asked for, in the order it was
                 * queued: a spinner the moment it is submitted, the picture in
                 * the SAME tile when it lands, an error card if it dies. The
                 * board used to be a single status line, so a run that was
                 * making eight images looked identical to one making none.
                 */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{settledCount} of {plates.length} done</span>
                    {busy && <Loader2 size={10} className="animate-spin text-cyan-400/70" />}
                    {status && <span className="ml-auto">{status}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {plates.map(pl => (
                      <div key={pl.queueId}
                        className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-black/50">
                        {pl.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pl.url} alt="" loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover" />
                        ) : pl.error ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                            <X size={12} className="text-red-400" />
                            <span className="text-[9px] leading-tight text-red-200/80 line-clamp-3">{pl.error}</span>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                            <Loader2 size={14} className="animate-spin text-cyan-400/70" />
                            <span className="text-[9px] text-slate-500">rendering</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] px-2 py-1.5 text-[11px] text-red-200">
                      {error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                  {busy
                    ? <><Loader2 size={18} className="animate-spin text-cyan-400/70" />
                        <span className="text-[11px]">{status}</span>
                        <span className="text-[10px] text-slate-600">plates appear here as they render</span></>
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
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Feed</span>
            {pendingPlates.length > 0 && (
              <span className="ml-2 text-[10px] text-slate-500">{pendingPlates.length} rendering</span>
            )}
          </div>
          {/* The pending list goes in so this employee's work shows as
              "generating" tiles here too, and settles in place — the same
              behaviour the Movie Studio's feeds already had. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">{renderFeed("image", feedKey, pendingPlates)}</div>
        </div>
      </div>
    </div>
  )
}
