"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Plus, X, Loader2, Play, Pause, ChevronLeft, ChevronRight, Copy, Trash2, GripVertical, Wand2,
  ImagePlus, RefreshCw, ArrowRight, Clock, Clapperboard, Sparkles, Check, Film, Video, AlertTriangle,
  Scissors, Download, CircleDashed, CircleCheck, CircleX, MinusCircle,
} from "lucide-react"
import { videoTicketCost } from "@/lib/ticket-pricing"
import { Dropdown } from "@/components/employees/Dropdown"
import {
  STORYBOARD_ASPECTS, STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, STORYBOARD_VIDEO_IDS, SHOOT_RESOLUTIONS, DURATIONS, MAX_SHOTS,
  newShot, totalSeconds, fmtRuntime, imageModelLabel, type StoryboardDoc, type StoryboardShot, type ShotVideo,
  FINAL_CUT_PHASES, FINAL_CUT_MAX_SHOTS, FINAL_CUT_MAX_SECONDS, NARRATOR_VOICES, DEFAULT_FINAL_CUT_OPTIONS,
  type FinalCutState, type FinalCutOptions,
} from "@/lib/storyboard"

/**
 * Storyboard Studio - see the cut before any motion is shot.
 *
 * A storyboard is the film as an ordered row of stills. The left panel holds
 * the story (what happens and how the shots connect) and the look every still
 * shares; each slot holds its still, the model that made it, what we see, the
 * prompt for its still, the planned video prompt and model, its length and
 * how it cuts to the next slot. Everything is editable, and the animatic
 * plays the stills back at their planned lengths so the cut can be judged -
 * and changed - before a single video is paid for.
 *
 * The board belongs to the account (one Storyboard row, autosaved), so the
 * same work is there on the next device. Stills also land in My Generations
 * under Storyboards > <title>.
 */

type BoardSummary = { id: number; title: string; shotCount: number; seconds: number; cover: string | null }

const ASPECT_CSS: Record<string, string> = { "16:9": "16/9", "9:16": "9/16", "1:1": "1/1", "4:3": "4/3", "3:4": "3/4", "21:9": "21/9" }
const IMAGE_OPTIONS = STORYBOARD_IMAGE_MODELS.map(m => ({ value: m.id, label: m.label }))
const VIDEO_OPTIONS = STORYBOARD_VIDEO_MODELS.map(m => ({ value: m, label: m }))
const DURATION_OPTIONS = DURATIONS.map(d => ({ value: String(d), label: `${d}s` }))
const ASPECT_OPTIONS = STORYBOARD_ASPECTS.map(a => ({ value: a, label: a }))
const RES_OPTIONS = SHOOT_RESOLUTIONS.map(r => ({ value: r, label: r }))
const pad2 = (n: number) => String(n).padStart(2, "0")

/** Can this shot be shot right now? */
const shootable = (s: StoryboardShot) => !!s.stillUrl && !!STORYBOARD_VIDEO_IDS[s.videoModel] && s.video?.status !== "rendering"
/** The clip no longer matches the slot: the still or the motion prompt changed after it was shot. */
const outOfDate = (s: StoryboardShot) => !!s.video && s.video.status === "done" &&
  (s.video.fromStill !== s.stillUrl || s.video.fromPrompt !== (s.videoPrompt || s.description).trim())
/** Rough tickets for one shot (the site's own pricing); tickets x $0.04 is about what fal is paid. */
function shotTickets(s: StoryboardShot, resolution: string): number {
  const model = STORYBOARD_VIDEO_IDS[s.videoModel]
  if (!model) return 0
  try { return videoTicketCost({ model, duration: String(s.duration), resolution, generateAudio: true, sd20Mode: "i2v" }) } catch { return 0 }
}

export function StoryboardWorkspace({
  signedIn,
  activeRefs,
  onRemoveRef,
}: {
  signedIn: boolean
  /** The taskbar Refs library's active references - used for character consistency. */
  activeRefs: { id: string; url: string }[]
  onRemoveRef: (id: string) => void
}) {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [board, setBoard] = useState<StoryboardDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [shotError, setShotError] = useState<Record<string, string>>({})
  const [useRefs, setUseRefs] = useState(true)
  const [premise, setPremise] = useState("")
  const [shotCount, setShotCount] = useState("8")
  const [drafting, setDrafting] = useState<false | "replace" | "rewrite">(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [animatic, setAnimatic] = useState<number | null>(null)
  const [batch, setBatch] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [shootRes, setShootRes] = useState<string>(() => { try { return localStorage.getItem("pv2-storyboard-res") || "720p" } catch { return "720p" } })
  const [confirmShootAll, setConfirmShootAll] = useState(false)
  const [, setTick] = useState(0) // re-renders the "shooting 0:42" timers
  const [finalCut, setFinalCut] = useState<FinalCutState>({ job: null, versions: [] })
  const [fcOpen, setFcOpen] = useState(false)
  const [fcOptions, setFcOptions] = useState<FinalCutOptions>(DEFAULT_FINAL_CUT_OPTIONS)
  const [fcError, setFcError] = useState<string | null>(null)
  const [fcVersion, setFcVersion] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boardRef = useRef<StoryboardDoc | null>(null)
  useEffect(() => { boardRef.current = board }, [board])

  // ── loading ──
  const loadList = useCallback(async () => {
    const r = await fetch("/api/employees/storyboards")
    if (!r.ok) return [] as BoardSummary[]
    const j = await r.json()
    setBoards(j.storyboards ?? [])
    return (j.storyboards ?? []) as BoardSummary[]
  }, [])
  const open = useCallback(async (id: number) => {
    const r = await fetch(`/api/employees/storyboards/${id}`)
    if (!r.ok) return
    const { storyboard } = await r.json()
    setBoard({ ...storyboard, shots: storyboard.shots ?? [] })
    setShotError({})
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    try { localStorage.setItem("pv2-storyboard", String(id)) } catch {}
    const fc = await fetch(`/api/employees/storyboards/${id}/final-cut`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    if (fc?.finalCut) setFinalCut(fc.finalCut)
  }, [])
  const create = useCallback(async () => {
    const r = await fetch("/api/employees/storyboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    if (!r.ok) return
    const { storyboard } = await r.json()
    await loadList()
    setBoard({ ...storyboard, shots: storyboard.shots ?? [] })
    try { localStorage.setItem("pv2-storyboard", String(storyboard.id)) } catch {}
  }, [loadList])
  useEffect(() => {
    if (!signedIn) return
    ;(async () => {
      const list = await loadList()
      let last: number | null = null
      try { last = Number(localStorage.getItem("pv2-storyboard")) || null } catch {}
      const pick = list.find(b => b.id === last) ?? list[0]
      if (pick) await open(pick.id)
      setLoading(false)
    })()
  }, [signedIn, loadList, open])

  // ── saving (debounced; the whole board is one document) ──
  const flush = useCallback(async () => {
    const b = boardRef.current
    if (!b) return
    setSaveState("saving")
    const r = await fetch(`/api/employees/storyboards/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: b.title, story: b.story, look: b.look, aspect: b.aspect, shots: b.shots }),
    }).catch(() => null)
    setSaveState(r?.ok ? "saved" : "error")
    if (r?.ok) setBoards(list => list.map(x => x.id === b.id ? { ...x, title: b.title, shotCount: b.shots.length, seconds: totalSeconds(b.shots), cover: b.shots.find(s => s.stillUrl)?.stillUrl ?? null } : x))
  }, [])
  const update = useCallback((fn: (b: StoryboardDoc) => StoryboardDoc) => {
    setBoard(b => (b ? fn(b) : b))
    setSaveState("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 700)
  }, [flush])
  // Leaving the board (tab switch, unmount) saves what is pending first
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); flush() } }, [flush])

  const setShot = (id: string, patch: Partial<StoryboardShot>) => update(b => ({ ...b, shots: b.shots.map(s => s.id === id ? { ...s, ...patch } : s) }))
  const moveShot = (from: number, to: number) => update(b => {
    if (to < 0 || to >= b.shots.length || from === to) return b
    const shots = [...b.shots]
    const [s] = shots.splice(from, 1)
    shots.splice(to, 0, s)
    return { ...b, shots }
  })
  const addShot = (at?: number) => update(b => {
    if (b.shots.length >= MAX_SHOTS) return b
    const shots = [...b.shots]
    const prev = shots[(at ?? shots.length) - 1]
    shots.splice(at ?? shots.length, 0, newShot({ imageModel: prev?.imageModel, videoModel: prev?.videoModel }))
    return { ...b, shots }
  })
  const duplicateShot = (i: number) => update(b => {
    if (b.shots.length >= MAX_SHOTS) return b
    const shots = [...b.shots]
    shots.splice(i + 1, 0, newShot({ ...b.shots[i], id: undefined }))
    return { ...b, shots }
  })
  const removeShot = (id: string) => update(b => ({ ...b, shots: b.shots.filter(s => s.id !== id) }))

  // ── stills ──
  const generateStill = useCallback(async (shot: StoryboardShot) => {
    const b = boardRef.current
    if (!b) return
    const prompt = (shot.imagePrompt || shot.description).trim()
    if (!prompt) { setShotError(e => ({ ...e, [shot.id]: "Write what we see or an image prompt first" })); return }
    setBusy(x => ({ ...x, [shot.id]: true }))
    setShotError(e => { const n = { ...e }; delete n[shot.id]; return n })
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/still`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: shot.imageModel, refs: useRefs ? activeRefs.map(x => x.url) : [] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "The still failed")
      // Only if this board is still the one open
      if (boardRef.current?.id === b.id) setShot(shot.id, { stillUrl: j.url, imagePrompt: shot.imagePrompt || prompt })
    } catch (e: any) {
      setShotError(x => ({ ...x, [shot.id]: String(e?.message || e) }))
    } finally {
      setBusy(x => { const n = { ...x }; delete n[shot.id]; return n })
    }
  // setShot is stable enough through update/flush
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useRefs, activeRefs])
  const generateMissing = async () => {
    const b = boardRef.current
    if (!b) return
    const todo = b.shots.filter(s => !s.stillUrl && (s.imagePrompt || s.description).trim())
    setBatch(true)
    let i = 0
    await Promise.all(Array.from({ length: 3 }, async () => { while (i < todo.length) await generateStill(todo[i++]) }))
    setBatch(false)
  }

  // ── shooting ──
  // A shot's video is owned by the server (the shoot route writes it; autosave
  // keeps the stored copy), so it is merged into local state here, never saved.
  const mergeVideos = useCallback((videos: Record<string, ShotVideo | { error: string }>) => {
    const errs: Record<string, string> = {}
    for (const [id, v] of Object.entries(videos)) if (v && "error" in v && !("queueId" in v)) errs[id] = (v as { error: string }).error
    setBoard(b => b && ({
      ...b,
      shots: b.shots.map(s => {
        const v = videos[s.id]
        return v && "queueId" in v ? { ...s, video: v as ShotVideo } : s
      }),
    }))
    if (Object.keys(errs).length) setShotError(e => ({ ...e, ...errs }))
  }, [])
  const shoot = useCallback(async (ids: string[]) => {
    const b = boardRef.current
    if (!b || !ids.length) return
    // Pending edits first: the server shoots what is SAVED
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    setShotError(e => { const n = { ...e }; for (const id of ids) delete n[id]; return n })
    setBusy(x => ({ ...x, ...Object.fromEntries(ids.map(id => [id, true])) }))
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/shoot`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotIds: ids, resolution: shootRes }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Could not start the shoot")
      if (boardRef.current?.id === b.id) mergeVideos(j.videos ?? {})
    } catch (e: any) {
      setShotError(x => ({ ...x, ...Object.fromEntries(ids.map(id => [id, String(e?.message || e)])) }))
    } finally {
      setBusy(x => { const n = { ...x }; for (const id of ids) delete n[id]; return n })
    }
  }, [flush, mergeVideos, shootRes])
  // While anything renders: settle every 8s, and tick the timers every second
  const rendering = !!board?.shots.some(s => s.video?.status === "rendering")
  const boardId = board?.id
  useEffect(() => {
    if (!rendering || !boardId) return
    const poll = setInterval(async () => {
      const r = await fetch(`/api/employees/storyboards/${boardId}/shoot`).catch(() => null)
      if (r?.ok && boardRef.current?.id === boardId) mergeVideos((await r.json()).videos ?? {})
    }, 8000)
    const tick = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [rendering, boardId, mergeVideos])
  const shootAll = () => {
    const b = boardRef.current
    if (!b) return
    const todo = b.shots.filter(s => shootable(s) && s.video?.status !== "done")
    if (!confirmShootAll) { setConfirmShootAll(true); return }
    setConfirmShootAll(false)
    shoot(todo.map(s => s.id))
  }

  // ── the Final Cut ──
  // The server runs it as a step machine; this loop just keeps asking it to
  // take the next step while the job is running (one request at a time).
  const fcRunning = finalCut.job?.status === "running"
  useEffect(() => {
    if (!fcRunning || !boardId) return
    let stop = false
    ;(async () => {
      while (!stop) {
        const r = await fetch(`/api/employees/storyboards/${boardId}/final-cut`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "advance" }),
        }).catch(() => null)
        if (stop || boardRef.current?.id !== boardId) return
        const j = r?.ok ? await r.json().catch(() => null) : null
        if (j?.videos) mergeVideos(j.videos)
        if (j?.finalCut) {
          setFinalCut(j.finalCut)
          if (j.finalCut.job?.status !== "running") {
            if (j.finalCut.job?.status === "done") setFcVersion(j.finalCut.versions.at(-1)?.n ?? null)
            return
          }
        }
        // Rendering phases come back quickly while fal works; give it a beat
        await new Promise(res => setTimeout(res, j?.busy ? 6000 : 3000))
      }
    })()
    return () => { stop = true }
  }, [fcRunning, boardId, mergeVideos])
  const fcAction = async (action: "start" | "resume" | "cancel") => {
    const b = boardRef.current
    if (!b) return
    setFcError(null)
    if (action === "start" && saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    const r = await fetch(`/api/employees/storyboards/${b.id}/final-cut`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(action === "start" ? { options: { ...fcOptions, resolution: shootRes } } : {}) }),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setFcError(j.error || "Could not start the Final Cut"); return }
    setFinalCut(j.finalCut)
    if (action === "start") setFcOpen(false)
  }

  // ── drafting with AI ──
  const draft = async (mode: "replace" | "rewrite") => {
    const b = boardRef.current
    if (!b) return
    if (mode === "replace" && b.shots.length > 0 && !confirmReplace) { setConfirmReplace(true); return }
    setConfirmReplace(false)
    setDrafting(mode)
    setDraftError(null)
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premise, shots: Number(shotCount), mode, refs: useRefs ? activeRefs.map(x => x.url) : [] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Drafting failed")
      update(cur => ({
        ...cur,
        title: cur.title === "Untitled storyboard" && j.title ? j.title : cur.title,
        story: j.story || cur.story,
        look: j.look || cur.look,
        shots: Array.isArray(j.shots) && j.shots.length ? j.shots : cur.shots,
      }))
    } catch (e: any) {
      setDraftError(String(e?.message || e))
    } finally {
      setDrafting(false)
    }
  }

  const removeBoard = async () => {
    if (!board) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false)
    await fetch(`/api/employees/storyboards/${board.id}`, { method: "DELETE" })
    const list = await loadList()
    setBoard(null)
    if (list[0]) await open(list[0].id)
  }

  const seconds = board ? totalSeconds(board.shots) : 0
  const stillCount = board ? board.shots.filter(s => s.stillUrl).length : 0
  const missing = board ? board.shots.filter(s => !s.stillUrl && (s.imagePrompt || s.description).trim()).length : 0
  const toShoot = board ? board.shots.filter(s => shootable(s) && s.video?.status !== "done") : []
  const shootTickets = toShoot.reduce((a, s) => a + shotTickets(s, shootRes), 0)
  const shotCountDone = board ? board.shots.filter(s => s.video?.status === "done").length : 0
  // The Final Cut's own cost on top of any shots it has to shoot: the edit plan
  // and cards (~$0.20), the score (~$0.01/s), narration (pennies)
  const fcShootUsd = board ? board.shots.filter(s => !(s.video?.status === "done" && s.video.url) && s.video?.status !== "rendering").reduce((a, s) => a + shotTickets(s, shootRes), 0) * 0.04 : 0
  const fcExtraUsd = 0.02 + (fcOptions.cards ? 0.2 : 0) + seconds * 0.01 + 0.05 + (fcOptions.narration ? 0.05 : 0)
  const fcBlocked = board ? (board.shots.length === 0 ? "Add shots first"
    : board.shots.length > FINAL_CUT_MAX_SHOTS ? `Up to ${FINAL_CUT_MAX_SHOTS} shots for now`
    : seconds > FINAL_CUT_MAX_SECONDS ? `Up to ${FINAL_CUT_MAX_SECONDS}s for now`
    : board.shots.some(s => !s.stillUrl) ? "Every shot needs its still first" : null) : null
  const shownVersion = finalCut.versions.find(v => v.n === fcVersion) ?? finalCut.versions.at(-1) ?? null
  const aspectCss = ASPECT_CSS[board?.aspect ?? "16:9"] ?? "16/9"
  const portrait = board ? ["9:16", "3:4"].includes(board.aspect) : false

  if (!signedIn) return <div className="py-24 text-center text-sm text-slate-400">Sign in to use the Storyboard Studio.</div>
  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-slate-500" size={20} /></div>

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── tabs + board actions ── */}
      <div className="flex items-center gap-2 px-3 sm:px-4 pb-2 shrink-0 border-b border-white/5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1">
          {boards.map(b => (
            <button
              key={b.id}
              onClick={() => { if (b.id !== board?.id) { flush(); open(b.id) } }}
              className={`shrink-0 flex items-center gap-2 pl-1 pr-3 py-1 rounded-lg border text-[11px] transition-colors ${b.id === board?.id ? "border-sky-400/50 bg-sky-500/10 text-white" : "border-white/10 text-slate-400 hover:text-white hover:bg-white/5"}`}
            >
              <span className="w-7 h-5 rounded bg-black/50 overflow-hidden shrink-0">
                {b.cover && /* eslint-disable-next-line @next/next/no-img-element */ <img src={b.cover} alt="" className="w-full h-full object-cover" />}
              </span>
              <span className="max-w-[160px] truncate font-semibold">{b.id === board?.id ? board.title : b.title}</span>
              <span className="text-[9px] text-slate-500 font-mono">{b.shotCount} · {fmtRuntime(b.seconds)}</span>
            </button>
          ))}
          <button onClick={create} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-white/15 text-[11px] text-slate-400 hover:text-white hover:border-white/30">
            <Plus size={12} /> New storyboard
          </button>
        </div>
        {board && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono text-slate-500">
              {saveState === "saving" ? "saving…" : saveState === "error" ? <span className="text-red-400">not saved</span> : <span className="inline-flex items-center gap-1"><Check size={10} />saved</span>}
            </span>
            <button
              onClick={generateMissing}
              disabled={batch || missing === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-40"
            >
              {batch ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} Generate missing stills{missing ? ` (${missing})` : ""}
            </button>
            <Dropdown value={shootRes} options={RES_OPTIONS} onChange={v => { setShootRes(v); try { localStorage.setItem("pv2-storyboard-res", v) } catch {} }} className="w-20" />
            <button
              onClick={shootAll}
              onBlur={() => setConfirmShootAll(false)}
              disabled={toShoot.length === 0}
              title={toShoot.length ? `Shoot ${toShoot.length} shots at ${shootRes}` : "Every shot with a still is shot or shooting"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40 ${confirmShootAll ? "bg-amber-500 text-black" : "border border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25"}`}
            >
              <Video size={12} /> {confirmShootAll ? `Shoot ${toShoot.length} for ~${shootTickets} tickets (about $${(shootTickets * 0.04).toFixed(2)})?` : `Shoot all${toShoot.length ? ` (${toShoot.length})` : ""}`}
            </button>
            <button
              onClick={() => setAnimatic(0)}
              disabled={board.shots.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/90 hover:bg-sky-400 text-[11px] font-bold text-white disabled:opacity-40"
            >
              <Play size={12} /> Play animatic
            </button>
            <button
              onClick={() => setFcOpen(true)}
              disabled={fcRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-200 to-amber-400 hover:opacity-90 text-[11px] font-bold text-black disabled:opacity-50"
            >
              {fcRunning ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />} {fcRunning ? "Cutting…" : "Final Cut"}
            </button>
          </div>
        )}
      </div>

      {!board ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <Clapperboard size={26} className="text-sky-400" />
          <p className="text-sm text-slate-300 font-semibold">Plan a video as a storyboard</p>
          <p className="text-xs text-slate-500 max-w-sm">Stills in order, the story that connects them, and the video prompt planned for every shot - all before anything is shot.</p>
          <button onClick={create} className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500/90 hover:bg-sky-400 text-xs font-bold text-white"><Plus size={13} /> New storyboard</button>
        </div>
      ) : (
        // Phones and tablets: ONE scroll - the story panel, then the whole
        // board. Two stacked scroll panes inside a fixed-height page left the
        // board a short strip under Safari's toolbar. Desktop keeps two panes.
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain lg:overflow-hidden flex flex-col lg:flex-row">
          {/* ── the story ── */}
          <aside className="lg:w-80 xl:w-96 shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 lg:overflow-y-auto p-3 sm:p-4 space-y-4">
            <input
              value={board.title}
              onChange={e => update(b => ({ ...b, title: e.target.value }))}
              className="w-full bg-transparent text-lg font-bold text-white focus:outline-none border-b border-transparent focus:border-white/15 pb-1"
              placeholder="Untitled storyboard"
            />
            <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
              <span className="inline-flex items-center gap-1"><Film size={11} />{board.shots.length} shots</span>
              <span className="inline-flex items-center gap-1"><Clock size={11} />{fmtRuntime(seconds)}</span>
              <span>{stillCount}/{board.shots.length} stills</span>
              <span>{shotCountDone}/{board.shots.length} shot</span>
            </div>

            <Field label="The story" hint="what happens, and how the shots connect into one film">
              <textarea
                value={board.story}
                onChange={e => update(b => ({ ...b, story: e.target.value }))}
                rows={7}
                placeholder="A lone astronaut lands on an alien world… each shot hands over to the next on a match cut…"
                className="sb-input"
              />
            </Field>
            <Field label="Look" hint="added to every still's prompt">
              <textarea
                value={board.look}
                onChange={e => update(b => ({ ...b, look: e.target.value }))}
                rows={2}
                placeholder="35mm anamorphic, teal-and-amber grade, film grain, natural light"
                className="sb-input"
              />
            </Field>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Frame</span>
              <Dropdown value={board.aspect} options={ASPECT_OPTIONS} onChange={v => update(b => ({ ...b, aspect: v }))} className="w-24" />
            </div>

            {/* references */}
            <Field label="References" hint={activeRefs.length ? "from the taskbar Refs - keeps characters consistent" : "activate images in the taskbar Refs to keep characters consistent"}>
              {activeRefs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeRefs.map(r => (
                    <div key={r.id} className="relative w-12 h-12 rounded-md overflow-hidden border border-white/10 group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => onRemoveRef(r.id)} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 hidden group-hover:flex items-center justify-center"><X size={9} /></button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-[11px] text-slate-400 mt-1.5 cursor-pointer">
                <input type="checkbox" checked={useRefs} onChange={e => setUseRefs(e.target.checked)} className="accent-sky-500" />
                Use them for stills and drafting
              </label>
            </Field>

            {/* drafting */}
            <div className="relative isolate rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-300"><Wand2 size={12} /> Draft with AI</div>
              <textarea
                value={premise}
                onChange={e => setPremise(e.target.value)}
                rows={3}
                placeholder="Describe the video: who, where, what happens, the feeling…"
                className="sb-input"
              />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">Shots</span>
                <Dropdown value={shotCount} options={[4, 6, 8, 10, 12, 16, 20].map(n => ({ value: String(n), label: String(n) }))} onChange={setShotCount} className="w-20" />
                <button
                  onClick={() => draft("replace")}
                  disabled={!!drafting || !premise.trim()}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/90 hover:bg-sky-400 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  {drafting === "replace" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {confirmReplace ? `Replace ${board.shots.length} shots?` : "Draft board"}
                </button>
              </div>
              {confirmReplace && <button onClick={() => setConfirmReplace(false)} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel - keep my shots</button>}
              {board.shots.length > 0 && (
                <button
                  onClick={() => draft("rewrite")}
                  disabled={!!drafting}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-40"
                >
                  {drafting === "rewrite" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Polish the writing (keeps shots & stills)
                </button>
              )}
              {draftError && <p className="text-[10px] text-red-400">{draftError}</p>}
            </div>

            <div className="flex md:hidden gap-2">
              <button onClick={generateMissing} disabled={batch || missing === 0} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[11px] text-slate-200 disabled:opacity-40">
                {batch ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} Stills{missing ? ` (${missing})` : ""}
              </button>
              <button onClick={shootAll} disabled={toShoot.length === 0} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold disabled:opacity-40 ${confirmShootAll ? "bg-amber-500 text-black" : "border border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"}`}>
                <Video size={12} /> {confirmShootAll ? `About $${(shootTickets * 0.04).toFixed(2)} - confirm` : `Shoot${toShoot.length ? ` (${toShoot.length})` : ""}`}
              </button>
              <button onClick={() => setAnimatic(0)} disabled={board.shots.length === 0} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/90 text-[11px] font-bold text-white disabled:opacity-40"><Play size={12} /> Animatic</button>
            </div>
            <button onClick={() => setFcOpen(true)} disabled={fcRunning} className="md:hidden w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-200 to-amber-400 text-[11px] font-bold text-black disabled:opacity-50">
              {fcRunning ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />} {fcRunning ? "Cutting…" : "Final Cut"}
            </button>
            <button onClick={removeBoard} className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-red-400">
              <Trash2 size={11} /> {confirmDelete ? "Click again to delete this storyboard (stills stay in your library)" : "Delete storyboard"}
            </button>
          </aside>

          {/* ── the board ── */}
          {/* the bottom padding clears iOS Safari's floating toolbar */}
          <main className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto p-3 sm:p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4">
            {(finalCut.job || finalCut.versions.length > 0) && (
              <section className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-200/[0.03] p-3 flex flex-col xl:flex-row gap-3">
                {/* the cut itself */}
                {shownVersion && (
                  <div className="xl:w-[55%] shrink-0 space-y-2">
                    <div className="relative rounded-xl overflow-hidden bg-black border border-white/10" style={{ aspectRatio: aspectCss }}>
                      <video key={shownVersion.url} src={shownVersion.url} controls playsInline preload="metadata" className="absolute inset-0 w-full h-full object-contain" />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {finalCut.versions.map(v => (
                        <button key={v.n} onClick={() => setFcVersion(v.n)} className={`px-2 py-1 rounded-md border text-[10.5px] font-semibold ${v.n === shownVersion.n ? "border-amber-300/60 bg-amber-300/15 text-amber-100" : "border-white/10 text-slate-400 hover:text-white"}`}>
                          Cut {v.n} · {fmtRuntime(v.durationSec)}
                        </button>
                      ))}
                      <a href={shownVersion.url} download={`${board.title} - Final Cut ${shownVersion.n}.mp4`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white">
                        <Download size={11} /> Download
                      </a>
                    </div>
                    <p className="text-[10px] text-slate-500">{shownVersion.note} · saved to My Generations › Storyboards › {board.title}</p>
                  </div>
                )}
                {/* the job's steps */}
                {finalCut.job && (
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Scissors size={13} className="text-amber-300" />
                      <span className="text-[12px] font-bold text-amber-100">Final Cut</span>
                      <span className="text-[10.5px] text-slate-400 truncate">{finalCut.job.message}</span>
                    </div>
                    <ol className="space-y-1">
                      {FINAL_CUT_PHASES.map(ph => {
                        const job = finalCut.job!
                        const order = FINAL_CUT_PHASES.findIndex(x => x.key === job.phase)
                        const me = FINAL_CUT_PHASES.findIndex(x => x.key === ph.key)
                        const skipped = job.skip.includes(ph.key)
                        const state = skipped ? "skip" : job.status === "done" || me < order ? "done" : me === order ? (job.status === "running" ? "now" : job.status === "failed" ? "fail" : "stop") : "todo"
                        return (
                          <li key={ph.key} className={`flex items-center gap-2 text-[11px] ${state === "todo" || state === "skip" ? "text-slate-600" : state === "fail" ? "text-red-300" : "text-slate-200"}`}>
                            {state === "done" ? <CircleCheck size={13} className="text-emerald-400" /> : state === "now" ? <Loader2 size={13} className="animate-spin text-amber-300" /> : state === "fail" ? <CircleX size={13} className="text-red-400" /> : state === "skip" ? <MinusCircle size={13} /> : <CircleDashed size={13} />}
                            {ph.label}{state === "skip" ? " (off)" : ""}
                          </li>
                        )
                      })}
                    </ol>
                    {finalCut.job.error && <p className="text-[10.5px] text-red-300 leading-snug">{finalCut.job.error}</p>}
                    <div className="flex gap-2 pt-1">
                      {fcRunning && <button onClick={() => fcAction("cancel")} className="px-2.5 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white">Cancel</button>}
                      {(finalCut.job.status === "failed" || finalCut.job.status === "cancelled") && (
                        <button onClick={() => fcAction("resume")} className="px-2.5 py-1 rounded-md bg-amber-300 text-black text-[10.5px] font-bold">Resume from “{FINAL_CUT_PHASES.find(x => x.key === finalCut.job!.phase)?.label}”</button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
            <div className={`grid gap-x-3 gap-y-4 ${portrait ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
              {board.shots.map((shot, i) => (
                <ShotCard
                  key={shot.id}
                  index={i}
                  shot={shot}
                  next={board.shots[i + 1]}
                  aspectCss={aspectCss}
                  busy={!!busy[shot.id]}
                  error={shotError[shot.id]}
                  last={i === board.shots.length - 1}
                  dragging={dragFrom === i}
                  onChange={patch => setShot(shot.id, patch)}
                  onGenerate={() => generateStill(shot)}
                  onShoot={() => shoot([shot.id])}
                  shootTickets={shotTickets(shot, shootRes)}
                  onMove={d => moveShot(i, i + d)}
                  onDuplicate={() => duplicateShot(i)}
                  onRemove={() => removeShot(shot.id)}
                  onPlay={() => setAnimatic(i)}
                  onDragStart={() => setDragFrom(i)}
                  onDragEnd={() => setDragFrom(null)}
                  onDrop={() => { if (dragFrom !== null) moveShot(dragFrom, i); setDragFrom(null) }}
                />
              ))}
              {board.shots.length < MAX_SHOTS && (
                <button
                  onClick={() => addShot()}
                  className="rounded-2xl border border-dashed border-white/15 hover:border-sky-400/40 hover:bg-sky-500/[0.03] text-slate-500 hover:text-sky-300 flex flex-col items-center justify-center gap-2 min-h-[220px] transition-colors"
                >
                  <Plus size={20} />
                  <span className="text-[11px] font-semibold">Add shot {pad2(board.shots.length + 1)}</span>
                </button>
              )}
            </div>
          </main>
        </div>
      )}

      {board && fcOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={() => setFcOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-amber-300/25 bg-[#0b0f19] p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Scissors size={16} className="text-amber-300" />
              <h3 className="text-sm font-bold text-white">Final Cut</h3>
              <button onClick={() => setFcOpen(false)} className="ml-auto text-slate-500 hover:text-white"><X size={15} /></button>
            </div>
            <p className="text-[11.5px] text-slate-400 leading-relaxed">
              Shoots any slot that has no clip yet, then plans the edit from the footage (which seconds of each clip to keep and how each cut lands),
              adds the cards, scores music to the picture, mixes and saves a new version.
            </p>
            <label className="flex items-center gap-2 text-[12px] text-slate-200 cursor-pointer">
              <input type="checkbox" className="accent-amber-400" checked={fcOptions.cards} onChange={e => setFcOptions(o => ({ ...o, cards: e.target.checked }))} />
              Title & end cards <span className="text-slate-500 text-[11px]">· lettered by Recraft v4.1</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] text-slate-200 cursor-pointer">
                <input type="checkbox" className="accent-amber-400" checked={fcOptions.narration} onChange={e => setFcOptions(o => ({ ...o, narration: e.target.checked }))} />
                Narration
              </label>
              {fcOptions.narration && <Dropdown value={fcOptions.voice} options={NARRATOR_VOICES.map(v => ({ value: v, label: v }))} onChange={v => setFcOptions(o => ({ ...o, voice: v }))} className="w-32 ml-auto" />}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-slate-200">
              Shoot missing shots at
              <Dropdown value={shootRes} options={RES_OPTIONS} onChange={v => { setShootRes(v); try { localStorage.setItem("pv2-storyboard-res", v) } catch {} }} className="w-20 ml-auto" />
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-[11.5px] text-slate-300 space-y-0.5">
              <div className="flex justify-between"><span>Shots still to shoot</span><span className="font-mono">≈ ${fcShootUsd.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Edit, cards, score{fcOptions.narration ? ", narration" : ""}</span><span className="font-mono">≈ ${fcExtraUsd.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-white pt-1 border-t border-white/10"><span>About</span><span className="font-mono">${(fcShootUsd + fcExtraUsd).toFixed(2)}</span></div>
            </div>
            {(fcBlocked || fcError) && <p className="text-[11px] text-red-300">{fcBlocked || fcError}</p>}
            <button
              onClick={() => fcAction("start")}
              disabled={!!fcBlocked}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-gradient-to-r from-amber-200 to-amber-400 text-[12px] font-bold text-black disabled:opacity-40"
            >
              <Scissors size={13} /> Make the Final Cut
            </button>
          </div>
        </div>
      )}

      {board && animatic !== null && board.shots.length > 0 && (
        <Animatic board={board} start={animatic} aspectCss={aspectCss} onClose={() => setAnimatic(null)} />
      )}

      <style jsx global>{`
        .sb-input { width: 100%; border-radius: 0.6rem; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3);
          padding: 0.45rem 0.6rem; font-size: 11.5px; line-height: 1.45; color: #e2e8f0; resize: vertical; }
        .sb-input:focus { outline: none; border-color: rgba(56,189,248,0.45); }
        .sb-input::placeholder { color: #475569; }
      `}</style>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}{hint && <span className="normal-case tracking-normal font-normal text-slate-600"> · {hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ShotCard({
  index, shot, next, aspectCss, busy, error, last, dragging, shootTickets,
  onChange, onGenerate, onShoot, onMove, onDuplicate, onRemove, onPlay, onDragStart, onDragEnd, onDrop,
}: {
  index: number
  shot: StoryboardShot
  next?: StoryboardShot
  aspectCss: string
  busy: boolean
  error?: string
  last: boolean
  dragging: boolean
  onChange: (patch: Partial<StoryboardShot>) => void
  onGenerate: () => void
  onShoot: () => void
  shootTickets: number
  onMove: (d: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  onPlay: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  const v = shot.video
  const done = v?.status === "done" && !!v.url
  // A shot with a finished clip opens on the clip; the still is one tap away
  const [view, setView] = useState<"still" | "video">(done ? "video" : "still")
  const lastUrl = useRef(v?.url)
  useEffect(() => { if (v?.url && v.url !== lastUrl.current) { lastUrl.current = v.url; setView("video") } }, [v?.url])
  const showVideo = done && view === "video"
  const stale = outOfDate(shot)
  const canShoot = !!shot.stillUrl && !!STORYBOARD_VIDEO_IDS[shot.videoModel]
  const elapsed = v?.status === "rendering" ? Math.max(0, Math.round((Date.now() - v.at) / 1000)) : 0
  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDrop() }}
      className={`relative isolate flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-2.5 gap-2 transition-opacity ${dragging ? "opacity-40" : ""}`}
    >
      {/* header */}
      <div className="flex items-center gap-1.5">
        <span
          draggable
          onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart() }}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          className="cursor-grab text-slate-600 hover:text-slate-300"
        >
          <GripVertical size={14} />
        </span>
        <span className="font-mono text-[11px] font-bold text-sky-300">SHOT {pad2(index + 1)}</span>
        <input
          value={shot.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Shot title"
          className="flex-1 min-w-0 bg-transparent text-[11.5px] font-semibold text-slate-100 focus:outline-none placeholder:text-slate-600"
        />
        <Dropdown value={String(shot.duration)} options={DURATION_OPTIONS.some(o => o.value === String(shot.duration)) ? DURATION_OPTIONS : [...DURATION_OPTIONS, { value: String(shot.duration), label: `${shot.duration}s` }]} onChange={v => onChange({ duration: Number(v) })} className="w-16" />
      </div>

      {/* the still */}
      <div className="relative rounded-xl overflow-hidden bg-black/50 border border-white/5 group" style={{ aspectRatio: aspectCss }}>
        {showVideo ? (
          <video key={v!.url!} src={v!.url!} className="absolute inset-0 w-full h-full object-cover" controls playsInline loop preload="metadata" />
        ) : shot.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.stillUrl} alt={shot.description} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-600">
            <ImagePlus size={18} />
            <span className="text-[10px]">No still yet</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5">
            <Loader2 size={18} className="animate-spin text-sky-300" />
            <span className="text-[10px] text-slate-300">{imageModelLabel(shot.imageModel)}…</span>
          </div>
        )}
        {shot.stillUrl && !busy && !showVideo && (
          <button onClick={onPlay} title="Play the animatic from here" className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 border border-white/15 hidden group-hover:flex items-center justify-center text-white">
            <Play size={12} />
          </button>
        )}
        {done && (
          <div className="absolute top-1.5 left-1.5 flex rounded-md overflow-hidden border border-white/15 text-[9.5px] font-semibold">
            <button onClick={() => setView("still")} className={`px-1.5 py-0.5 ${!showVideo ? "bg-white/90 text-black" : "bg-black/60 text-slate-300"}`}>Still</button>
            <button onClick={() => setView("video")} className={`px-1.5 py-0.5 ${showVideo ? "bg-fuchsia-400 text-black" : "bg-black/60 text-slate-300"}`}>Video</button>
          </div>
        )}
        {v?.status === "rendering" && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 border border-fuchsia-400/40 text-[9.5px] text-fuchsia-100">
            <Loader2 size={9} className="animate-spin" /> Shooting {fmtRuntime(elapsed)}
          </div>
        )}
      </div>

      {/* image model + generate */}
      <div className="flex items-center gap-1.5">
        <Dropdown value={shot.imageModel} options={IMAGE_OPTIONS} onChange={v => onChange({ imageModel: v })} className="flex-1 min-w-0" />
        <button
          onClick={onGenerate}
          disabled={busy}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-[10.5px] font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
        >
          {shot.stillUrl ? <RefreshCw size={11} /> : <ImagePlus size={11} />} {shot.stillUrl ? "Redo" : "Generate"}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-400 leading-snug">{error}</p>}

      <Field label="What we see">
        <textarea value={shot.description} onChange={e => onChange({ description: e.target.value })} rows={2} placeholder="One sentence: what this shot shows" className="sb-input" />
      </Field>
      <button onClick={() => setShowPrompt(v => !v)} className="self-start text-[10px] text-slate-500 hover:text-slate-300">
        {showPrompt ? "▾" : "▸"} Image prompt{shot.imagePrompt ? "" : " (uses What we see)"}
      </button>
      {showPrompt && (
        <textarea value={shot.imagePrompt} onChange={e => onChange({ imagePrompt: e.target.value })} rows={4} placeholder="The full prompt for the still" className="sb-input" />
      )}

      <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.03] p-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-sky-300/90 font-bold">Video prompt</span>
          <Dropdown value={shot.videoModel} options={VIDEO_OPTIONS.some(o => o.value === shot.videoModel) ? VIDEO_OPTIONS : [...VIDEO_OPTIONS, { value: shot.videoModel, label: shot.videoModel }]} onChange={v => onChange({ videoModel: v })} className="ml-auto w-36" />
        </div>
        <textarea value={shot.videoPrompt} onChange={e => onChange({ videoPrompt: e.target.value })} rows={3} placeholder="What moves, how the camera moves, the sound" className="sb-input" />
        <div className="flex items-center gap-1.5">
          <button
            onClick={onShoot}
            disabled={!canShoot || busy || v?.status === "rendering"}
            title={!shot.stillUrl ? "Make the still first" : !STORYBOARD_VIDEO_IDS[shot.videoModel] ? "This model can't shoot from a still" : `About ${shootTickets} tickets`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-fuchsia-400/35 bg-fuchsia-500/15 text-[10.5px] font-semibold text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-35"
          >
            {v?.status === "rendering" ? <Loader2 size={11} className="animate-spin" /> : <Video size={11} />}
            {v?.status === "rendering" ? "Shooting…" : done ? "Reshoot" : "Shoot"}
          </button>
          <span className="text-[9.5px] text-slate-500 font-mono">~{shootTickets} tix</span>
          {done && v && <span className="ml-auto text-[9.5px] text-slate-500 truncate">{v.seconds}s · {v.model}</span>}
        </div>
        {stale && (
          <p className="flex items-center gap-1 text-[10px] text-amber-300/90"><AlertTriangle size={10} /> Edited since it was shot - reshoot to match</p>
        )}
        {v?.status === "failed" && v.error && <p className="text-[10px] text-red-400 leading-snug">Shoot failed: {v.error}</p>}
      </div>

      {/* how it hands over to the next shot */}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <ArrowRight size={11} className="text-sky-400 shrink-0" />
        <span className="shrink-0">{last ? "Ending:" : `To ${pad2(index + 2)}${next?.title ? ` ${next.title}` : ""}:`}</span>
        <input value={shot.transition} onChange={e => onChange({ transition: e.target.value })} placeholder={last ? "How the film ends" : "Cut, match cut, dissolve…"} className="flex-1 min-w-0 bg-transparent text-[10.5px] text-slate-300 focus:outline-none border-b border-white/5 focus:border-sky-400/40" />
      </div>

      {/* card actions */}
      <div className="flex items-center gap-1 pt-1 border-t border-white/5">
        <IconBtn title="Move earlier" onClick={() => onMove(-1)} disabled={index === 0}><ChevronLeft size={13} /></IconBtn>
        <IconBtn title="Move later" onClick={() => onMove(1)} disabled={last}><ChevronRight size={13} /></IconBtn>
        <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={12} /></IconBtn>
        <span className="ml-auto text-[9.5px] text-slate-600 truncate">{shot.stillUrl ? imageModelLabel(shot.imageModel) : ""}</span>
        <IconBtn title="Delete shot" onClick={onRemove}><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}

/**
 * The animatic: the stills played back at their planned lengths, each with a
 * slow push-in, the shot's description and planned video prompt as captions,
 * and the transition note as it hands over - the cut, judged before it is shot.
 */
function Animatic({ board, start, aspectCss, onClose }: { board: StoryboardDoc; start: number; aspectCss: string; onClose: () => void }) {
  const shots = board.shots
  const starts = useMemo(() => { let t = 0; return shots.map(s => { const a = t; t += s.duration || 0; return a }) }, [shots])
  const total = totalSeconds(shots)
  const [t, setT] = useState(starts[start] ?? 0)
  const [playing, setPlaying] = useState(true)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) { last.current = null; return }
    let raf = 0
    const tick = (now: number) => {
      if (last.current !== null) setT(x => Math.min(total, x + (now - last.current!) / 1000))
      last.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total])
  useEffect(() => { if (t >= total) setPlaying(false) }, [t, total])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === " ") { e.preventDefault(); setPlaying(p => !p) }
      if (e.key === "ArrowRight") setT(x => starts.find(s => s > x + 0.01) ?? x)
      if (e.key === "ArrowLeft") setT(x => [...starts].reverse().find(s => s < x - 0.3) ?? 0)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onClose, starts])

  let i = 0
  for (let k = 0; k < starts.length; k++) if (t >= starts[k]) i = k
  const shot = shots[i]
  const into = t - starts[i]
  const remaining = (shot.duration || 0) - into
  const handing = remaining < 0.9 && i < shots.length - 1
  // A shot that has been shot plays its real clip (with its sound), kept on
  // the playhead; the rest show their still with the push-in
  const clip = shot.video?.status === "done" ? shot.video.url : null
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (Math.abs(el.currentTime - into) > 0.35) el.currentTime = Math.min(into, (el.duration || into + 1) - 0.05)
    if (playing && el.paused) el.play().catch(() => {})
    if (!playing && !el.paused) el.pause()
  })
  const goTo = (k: number) => { setT(starts[Math.max(0, Math.min(shots.length - 1, k))]); last.current = null }

  return (
    <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 text-slate-300">
        <span className="text-sm font-bold text-white truncate">{board.title}</span>
        <span className="text-[11px] font-mono text-slate-500">ANIMATIC · SHOT {pad2(i + 1)}/{pad2(shots.length)} · {fmtRuntime(t)} / {fmtRuntime(total)}</span>
        <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-4">
        <div className="relative max-h-full max-w-full w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: aspectCss, maxWidth: `min(100%, calc((100dvh - 230px) * ${aspectCss.replace("/", " / ")}))` }}>
          {clip ? (
            <video ref={videoRef} key={clip} src={clip} className="absolute inset-0 w-full h-full object-cover" playsInline preload="auto" />
          ) : shot.stillUrl ? (
            // A slow push-in driven by the playhead itself, so pausing, scrubbing
            // and jumping between shots all show the right moment of the move
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot.stillUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: `scale(${(1 + 0.12 * Math.min(1, into / (shot.duration || 1))).toFixed(4)}) translate(${(-1.5 * Math.min(1, into / (shot.duration || 1))).toFixed(3)}%, ${(-1 * Math.min(1, into / (shot.duration || 1))).toFixed(3)}%)` }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-slate-400 text-sm">{shot.description || "No still yet"}</div>
          )}
          {/* the handover to the next shot */}
          {handing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 border border-sky-400/40 text-[11px] text-sky-200 flex items-center gap-1.5">
              <ArrowRight size={11} /> {shot.transition || "Cut"}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent">
            <div className="text-[11px] font-mono text-sky-300 mb-0.5">SHOT {pad2(i + 1)}{shot.title ? ` · ${shot.title}` : ""} · {shot.duration}s · {shot.videoModel}{clip ? " · SHOT" : " · STILL"}</div>
            {shot.description && <div className="text-sm text-white leading-snug">{shot.description}</div>}
            {shot.videoPrompt && <div className="text-[11px] text-slate-400 mt-1 line-clamp-2"><span className="text-slate-500">Motion: </span>{shot.videoPrompt}</div>}
          </div>
        </div>
      </div>
      {/* timeline: one segment per shot, width = its length */}
      <div className="px-4 pt-3 pb-4 space-y-3">
        <div className="flex h-10 gap-0.5 rounded-md overflow-hidden">
          {shots.map((s, k) => (
            <button key={s.id} onClick={() => goTo(k)} style={{ flexGrow: s.duration || 1 }} className={`relative basis-0 overflow-hidden ${k === i ? "ring-2 ring-sky-400 ring-inset" : "opacity-60 hover:opacity-100"}`}>
              {s.stillUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.stillUrl} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 bg-white/5" />}
              {k === i && <span className="absolute left-0 bottom-0 h-1 bg-sky-400" style={{ width: `${Math.min(100, (into / (s.duration || 1)) * 100)}%` }} />}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => goTo(i - 1)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300"><ChevronLeft size={18} /></button>
          <button onClick={() => { if (t >= total) setT(0); setPlaying(p => !p) }} className="w-11 h-11 rounded-full bg-sky-500 hover:bg-sky-400 flex items-center justify-center text-white">
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <button onClick={() => goTo(i + 1)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300"><ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  )
}
