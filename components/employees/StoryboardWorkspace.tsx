"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Plus, X, Loader2, Play, Pause, ChevronLeft, ChevronRight, Copy, Trash2, GripVertical,
  ImagePlus, ArrowRight, Clock, Clapperboard, Sparkles, Check, Film, ImageUp,
  Download, CircleDashed, CircleCheck, CircleX, MinusCircle, Ticket, SquareCheck, Square,
  Megaphone, Package, UserRound, Shirt, Music, Smartphone, MapPin, Lightbulb, ChevronDown, Search, Minus,
  type LucideIcon,
} from "lucide-react"
import { videoTicketCost } from "@/lib/ticket-pricing"
import { Dropdown } from "@/components/employees/Dropdown"
import {
  STORYBOARD_ASPECTS, STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, STORYBOARD_VIDEO_IDS, SHOOT_RESOLUTIONS, DURATIONS, MAX_SHOTS,
  newShot, totalSeconds, fmtRuntime, imageModelLabel, stillKey, MAX_STILL_VERSIONS, type StoryboardDoc, type StoryboardShot, type ShotVideo,
  activeAssetRefs, stillModelSpec, stillTickets, stillSettingValue, newAsset, newAssetRef, MAX_ASSET_REFS, DEFAULT_IMAGE_MODEL, type StoryAsset, type AssetKind,
  BOARD_MODES, boardMode, frameLabel, type BoardModeId, MAX_DRAFT_SHOTS, TARGET_LENGTHS, runtimeRange, lengthLabel,
  FINAL_CUT_PHASES, FINAL_CUT_MAX_SHOTS, FINAL_CUT_MAX_SECONDS, NARRATOR_VOICES, DEFAULT_FINAL_CUT_OPTIONS,
  type FinalCutState, type FinalCutOptions,
} from "@/lib/storyboard"
import { AssetsPanel, AddToAssetMenu, type RefCap } from "@/components/employees/StoryboardAssets"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"

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

type BoardSummary = { id: number; title: string; shotCount: number; seconds: number; cover: string | null; mode?: string; updatedAt?: string }
type DraftMode = "replace" | "polish" | "regenerate" | "extend"
/** A still's library record, in the shape the portal's image viewer takes. */
type StillRecord = { id: number; imageUrl: string; prompt: string; model: string; createdAt?: string; aspectRatio?: string; quality?: string; referenceImageUrls?: string[]; videoMetadata?: Record<string, unknown> }

const ASPECT_CSS: Record<string, string> = { "16:9": "16/9", "9:16": "9/16", "1:1": "1/1", "4:3": "4/3", "3:4": "3/4", "21:9": "21/9" }
const IMAGE_OPTIONS = STORYBOARD_IMAGE_MODELS.map(m => ({ value: m.id, label: m.label }))
const VIDEO_OPTIONS = STORYBOARD_VIDEO_MODELS.map(m => ({ value: m, label: m }))
const DURATION_OPTIONS = DURATIONS.map(d => ({ value: String(d), label: `${d}s` }))
const ASPECT_OPTIONS = STORYBOARD_ASPECTS.map(a => ({ value: a, label: a }))
const RES_OPTIONS = SHOOT_RESOLUTIONS.map(r => ({ value: r, label: r }))
const pad2 = (n: number) => String(n).padStart(2, "0")
const MODE_ICONS: Record<BoardModeId, LucideIcon> = {
  story: Clapperboard, trailer: Film, ad: Megaphone, product: Package, character: UserRound,
  lookbook: Shirt, music: Music, social: Smartphone, location: MapPin, explainer: Lightbulb,
}
/** A ticket count, as it sits on a button. */
function Tix({ n, approx, className = "" }: { n: number; approx?: boolean; className?: string }) {
  return <span className={`inline-flex items-center gap-0.5 font-mono ${className}`}><Ticket size={9} />{approx ? "~" : ""}{n}</span>
}

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
  refLibrary,
  onAddRef,
  onOpenStill,
}: {
  signedIn: boolean
  /** The taskbar Refs library's active references - only to show a still is "In refs". */
  activeRefs: { id: string; url: string }[]
  /** The whole Refs library, to fill the board's assets from. */
  refLibrary: { id: string; url: string }[]
  /** Add a still to the account's Refs library, switched on (the feed popup's "Add to Refs"). */
  onAddRef?: (url: string) => Promise<{ added: number; limitHit: boolean; reason?: string | null }>
  /** Open a still in the portal's full image viewer; `list` is the board's stills, for its arrows. */
  onOpenStill?: (item: StillRecord, list: StillRecord[]) => void
}) {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [board, setBoard] = useState<StoryboardDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [shotError, setShotError] = useState<Record<string, string>>({})
  const [premise, setPremise] = useState("")
  const [shotCount, setShotCount] = useState("8")
  const [drafting, setDrafting] = useState<false | DraftMode>(false)
  // Drafting on part of the board: pick shots on the cards, then act on them
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [extendCount, setExtendCount] = useState("2")
  // The runtime a new board aims for, in seconds ("0" = Auto)
  const [targetLen, setTargetLen] = useState<string>(() => { try { return localStorage.getItem("pv2-storyboard-target") || "0" } catch { return "0" } })
  const [flashIds, setFlashIds] = useState<string[]>([])
  const [modeOpen, setModeOpen] = useState(false)
  // The shot being worked on - its still model sets the assets' ref limit
  const [focusId, setFocusId] = useState<string | null>(null)
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
  const activeRefKeys = useMemo(() => new Set(activeRefs.map(r => stillKey(r.url))), [activeRefs])
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
    setBoard({ ...storyboard, shots: storyboard.shots ?? [], assets: storyboard.assets ?? [], mode: boardMode(storyboard.mode).id })
    setShotError({})
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    setSelected([]); setSelecting(false); setFocusId(null)
    try { localStorage.setItem("pv2-storyboard", String(id)) } catch {}
    const fc = await fetch(`/api/employees/storyboards/${id}/final-cut`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    // Only if this board is still the one open - a slow answer for the board
    // just left would otherwise show its cuts on the next one
    if (fc?.finalCut && boardRef.current?.id === id) setFinalCut(fc.finalCut)
  }, [])
  const create = useCallback(async () => {
    const r = await fetch("/api/employees/storyboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    if (!r.ok) return
    const { storyboard } = await r.json()
    await loadList()
    // A new board has no cuts and no errors: clear the previous board's, or its
    // Final Cuts keep showing in the screening room of the empty board
    setBoard({ ...storyboard, shots: storyboard.shots ?? [], assets: storyboard.assets ?? [], mode: boardMode(storyboard.mode).id })
    setShotError({})
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    setSelected([]); setSelecting(false); setFocusId(null)
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
      body: JSON.stringify({ title: b.title, story: b.story, look: b.look, aspect: b.aspect, shots: b.shots, assets: b.assets, mode: b.mode }),
    }).catch(() => null)
    setSaveState(r?.ok ? "saved" : "error")
    // The saved board moves to the front, as the list is newest-edited first
    if (r?.ok) setBoards(list => {
      const hit = list.find(x => x.id === b.id)
      if (!hit) return list
      const fresh = { ...hit, title: b.title, mode: b.mode, shotCount: b.shots.length, seconds: totalSeconds(b.shots), cover: b.shots.find(s => s.stillUrl)?.stillUrl ?? null, updatedAt: new Date().toISOString() }
      return [fresh, ...list.filter(x => x.id !== b.id)]
    })
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
        // The switched-on asset refs, as many as this still's model takes
        body: JSON.stringify({
          prompt, model: shot.imageModel, quality: shot.imageQuality || undefined,
          options: shot.imageOptions,
          refs: activeAssetRefs(b.assets).slice(0, stillModelSpec(shot.imageModel).maxRefs).map(x => x.url),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "The still failed")
      // Only if this board is still the one open. The new take is added to the
      // slot's versions (read from the CURRENT shot, not this closure's copy),
      // so the one it replaces stays a tap away
      if (boardRef.current?.id === b.id) update(cur => ({
        ...cur,
        shots: cur.shots.map(s => s.id !== shot.id ? s : {
          ...s,
          stillUrl: j.url,
          imagePrompt: s.imagePrompt || prompt,
          stills: [...(s.stills ?? []), { url: j.url, prompt, model: shot.imageModel, at: Date.now() }].slice(-MAX_STILL_VERSIONS),
        }),
      }))
    } catch (e: any) {
      setShotError(x => ({ ...x, [shot.id]: String(e?.message || e) }))
    } finally {
      setBusy(x => { const n = { ...x }; delete n[shot.id]; return n })
    }
  // update is stable (it only closes over flush); the board is read from boardRef
  }, [update])
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
  const mergeVideos = useCallback((videos: Record<string, ShotVideo | { error: string }>, takes?: Record<string, ShotVideo[]>) => {
    const errs: Record<string, string> = {}
    for (const [id, v] of Object.entries(videos)) if (v && "error" in v && !("queueId" in v)) errs[id] = (v as { error: string }).error
    setBoard(b => b && ({
      ...b,
      shots: b.shots.map(s => {
        const v = videos[s.id]
        const next = v && "queueId" in v ? { ...s, video: v as ShotVideo } : s
        return takes && takes[s.id] ? { ...next, videos: takes[s.id] } : next
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
      if (boardRef.current?.id === b.id) mergeVideos(j.videos ?? {}, j.takes)
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
      if (r?.ok && boardRef.current?.id === boardId) { const j = await r.json(); mergeVideos(j.videos ?? {}, j.takes) }
    }, 8000)
    const tick = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [rendering, boardId, mergeVideos])
  /*
   * Play an earlier take on a shot. Shown at once, then made so on the server -
   * the autosave never touches `video`, so this is the only way it moves.
   */
  const pickVideoTake = useCallback(async (shotId: string, take: ShotVideo) => {
    const b = boardRef.current
    if (!b || !take.url) return
    const before = b.shots.find(s => s.id === shotId)?.video ?? null
    setBoard(cur => cur && ({ ...cur, shots: cur.shots.map(s => (s.id === shotId ? { ...s, video: take } : s)) }))
    const r = await fetch(`/api/employees/storyboards/${b.id}/shoot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick: { shotId, url: take.url } }),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) {
      // Put the clip that was playing back, and say why
      if (boardRef.current?.id === b.id) setBoard(cur => cur && ({ ...cur, shots: cur.shots.map(s => (s.id === shotId ? { ...s, video: before } : s)) }))
      setShotError(e => ({ ...e, [shotId]: j.error || "Could not switch the clip" }))
      return
    }
    if (boardRef.current?.id === b.id) mergeVideos({ [shotId]: j.video }, j.takes)
  }, [mergeVideos])
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
  // replace: a whole new board. polish / regenerate / extend act on the picked
  // shots (none picked = all of them) and leave every other slot as it is.
  const draft = async (mode: DraftMode) => {
    const b = boardRef.current
    if (!b) return
    if (mode === "replace" && b.shots.length > 0 && !confirmReplace) { setConfirmReplace(true); return }
    setConfirmReplace(false)
    setDrafting(mode)
    setDraftError(null)
    // The server merges into what is SAVED, so pending edits go first
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    const shotIds = selected.filter(id => b.shots.some(s => s.id === id))
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, boardMode: b.mode, premise, shots: Number(shotCount), targetSeconds: Number(targetLen), shotIds, extendCount: Number(extendCount),
          refs: activeAssetRefs(b.assets).slice(0, 4).map(x => x.url),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Drafting failed")
      if (boardRef.current?.id !== b.id) return
      update(cur => ({
        ...cur,
        title: cur.title === "Untitled storyboard" && j.title ? j.title : cur.title,
        story: j.story || cur.story,
        look: j.look || cur.look,
        shots: Array.isArray(j.shots) && j.shots.length ? j.shots : cur.shots,
      }))
      // Show what changed for a moment; extended shots become the selection
      const changed: string[] = Array.isArray(j.changed) ? j.changed : []
      setFlashIds(changed)
      setTimeout(() => setFlashIds([]), 4000)
      if (mode === "extend") setSelected(changed)
      if (mode === "replace") { setSelected([]); setSelecting(false) }
    } catch (e: any) {
      setDraftError(String(e?.message || e))
    } finally {
      setDrafting(false)
    }
  }
  const toggleSelected = (id: string) => setSelected(sel => (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]))

  // ── editing one shot with AI ──
  // The server writes a patch (only the fields in scope); the card applies it
  // and keeps the previous values for its Undo
  const aiEditShot = async (shot: StoryboardShot, instruction: string, scope: "image" | "video" | "both"): Promise<{ patch?: Partial<StoryboardShot>; note?: string; error?: string }> => {
    const b = boardRef.current
    if (!b) return { error: "No board open" }
    // The server reads the SAVED shot, so pending edits go first
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    const r = await fetch(`/api/employees/storyboards/${b.id}/shot-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId: shot.id, instruction, scope }),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) return { error: j.error || "The edit failed" }
    if (boardRef.current?.id === b.id) setShot(shot.id, j.patch)
    return { patch: j.patch, note: j.note }
  }

  // ── the full viewer ──
  // A still opens in the feed's own viewer (full quality + the info panel), its
  // arrows walking the board's stills in shot order. Records are looked up by
  // URL - every still the studio makes is saved to the library.
  /*
   * The library records behind the board's stills, loaded AHEAD of a click.
   * Opening a still used to fetch them first and only then show the viewer,
   * so a tap did nothing for half a second to a few seconds (the database
   * round trip, a cold start). Now they load when the board opens and again
   * whenever its stills change, and a click opens from what is already here.
   */
  const stillInfo = useRef<Map<string, StillRecord>>(new Map())
  const [opening, setOpening] = useState<string | null>(null)
  const loadStillInfo = useCallback(async (b: StoryboardDoc) => {
    const urls = b.shots.map(s => s.stillUrl).filter((u): u is string => !!u)
    if (!urls.length) return
    const r = await fetch(`/api/employees/storyboards/${b.id}/still-info`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }),
    }).catch(() => null)
    const items: StillRecord[] = r?.ok ? ((await r.json().catch(() => ({}))).items ?? []) : []
    for (const it of items) stillInfo.current.set(stillKey(it.imageUrl), it)
  }, [])
  const stillSig = board ? `${board.id}:${board.shots.map(s => s.stillUrl ?? "").join("|")}` : ""
  useEffect(() => {
    const b = boardRef.current
    if (!b || !stillSig) return
    // Only the stills not loaded yet; a short wait lets a burst of new stills settle
    if (b.shots.every(s => !s.stillUrl || stillInfo.current.has(stillKey(s.stillUrl)))) return
    const t = setTimeout(() => { if (boardRef.current) loadStillInfo(boardRef.current) }, 400)
    return () => clearTimeout(t)
  }, [stillSig, loadStillInfo])
  const openStill = async (shot: StoryboardShot) => {
    const b = boardRef.current
    if (!b || !shot.stillUrl) return
    const records = () => b.shots
      .map(s => (s.stillUrl ? stillInfo.current.get(stillKey(s.stillUrl)) : undefined))
      .filter((x): x is StillRecord => !!x)
    let item = stillInfo.current.get(stillKey(shot.stillUrl))
    if (!item) {
      // Not loaded yet (a still made a moment ago): show the click landed, then load
      setOpening(shot.id)
      await loadStillInfo(b)
      setOpening(null)
      item = stillInfo.current.get(stillKey(shot.stillUrl))
    }
    if (item && onOpenStill) onOpenStill(item, records())
    else window.open(shot.stillUrl, "_blank", "noopener")
  }

  const removeBoard = async () => {
    if (!board) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false)
    await fetch(`/api/employees/storyboards/${board.id}`, { method: "DELETE" })
    const list = await loadList()
    setBoard(null)
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
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
  // The same in tickets: shots at their ticket price, the rest at the $0.04 of
  // fal cost a ticket covers (lib/ticket-pricing's margin rule)
  const fcShootTickets = Math.round(fcShootUsd / 0.04)
  const fcExtraTickets = Math.ceil(fcExtraUsd / 0.04)
  const fcTickets = fcShootTickets + fcExtraTickets
  const fcBlocked = board ? (board.shots.length === 0 ? "Add shots first"
    : board.shots.length > FINAL_CUT_MAX_SHOTS ? `Up to ${FINAL_CUT_MAX_SHOTS} shots for now`
    : seconds > FINAL_CUT_MAX_SECONDS ? `Up to ${FINAL_CUT_MAX_SECONDS}s for now`
    : board.shots.some(s => !s.stillUrl) ? "Every shot needs its still first" : null) : null
  const shownVersion = finalCut.versions.find(v => v.n === fcVersion) ?? finalCut.versions.at(-1) ?? null
  const aspectCss = ASPECT_CSS[board?.aspect ?? "16:9"] ?? "16/9"
  const portrait = board ? ["9:16", "3:4"].includes(board.aspect) : false
  // Stills: what making the missing ones costs (each at its own model + quality)
  const missingShots = board ? board.shots.filter(s => !s.stillUrl && (s.imagePrompt || s.description).trim()) : []
  const refsOn = board ? activeAssetRefs(board.assets).length : 0
  const missingTickets = board ? missingShots.reduce((t, s) => t + stillTickets(s.imageModel, s.imageQuality, board.aspect, s.imageOptions, Math.min(refsOn, stillModelSpec(s.imageModel).maxRefs)), 0) : 0
  // The assets' ref limit follows the shot being worked on (else the first shot)
  const onRefs = board ? activeAssetRefs(board.assets) : []
  const focusIdx = board ? Math.max(0, board.shots.findIndex(s => s.id === focusId)) : 0
  const focusShot = board?.shots[focusIdx]
  const refCap: RefCap = {
    max: stillModelSpec(focusShot?.imageModel ?? DEFAULT_IMAGE_MODEL).maxRefs,
    model: imageModelLabel(focusShot?.imageModel ?? DEFAULT_IMAGE_MODEL),
    shot: focusShot ? `Shot ${pad2(focusIdx + 1)}` : "the first shot",
  }
  // Every still the board has had, for the asset picker
  const boardStills = board ? board.shots.flatMap((s, i) => {
    const urls = [...(s.stills ?? []).map(t => t.url), ...(s.stillUrl ? [s.stillUrl] : [])]
    const seen = new Set<string>()
    const uniq = urls.filter(u => { const k = stillKey(u); if (seen.has(k)) return false; seen.add(k); return true })
    return uniq.map((url, k) => ({ url, label: `${pad2(i + 1)}${uniq.length > 1 ? `.${k + 1}` : ""}` }))
  }) : []
  const addStillToAsset = (url: string, assetId: string | null, kind?: AssetKind) => update(b => {
    if (assetId) {
      return { ...b, assets: b.assets.map(a => a.id !== assetId || a.refs.some(r => stillKey(r.url) === stillKey(url)) ? a
        : { ...a, refs: [...a.refs, newAssetRef(url, false)].slice(0, MAX_ASSET_REFS) }) }
    }
    const k = kind ?? "other"
    const a: StoryAsset = { ...newAsset(k, `${k === "character" ? "Character" : "Asset"} ${b.assets.filter(x => x.kind === k).length + 1}`), refs: [newAssetRef(url, false)] }
    return { ...b, assets: [...b.assets, a] }
  })

  if (!signedIn) return <div className="py-24 text-center text-sm text-slate-400">Sign in to use the Storyboard Studio.</div>
  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-slate-500" size={20} /></div>

  // Drafting with AI, as an element (not a component) so typing in it keeps focus
  const pickedCount = board ? selected.filter(id => board.shots.some(s => s.id === id)).length : 0
  const scopeLabel = pickedCount ? `${pickedCount} picked shot${pickedCount === 1 ? "" : "s"}` : `all ${board?.shots.length ?? 0} shots`
  /*
   * The studio's action buttons wear the site's mark: the synced logo (the
   * admin-uploaded SystemState.logoUrl, in its spinning silver ring) where an
   * icon would be, the same silver-on-glass button the Movie Studio uses, and
   * the light sweep on the one that starts a board.
   */
  const brandBtn = (o: { onClick: () => void; disabled: boolean; busy: boolean; label: React.ReactNode; title?: string; primary?: boolean; className?: string; size?: "xs" | "sm" | "md" }) => (
    <BrandButton onClick={o.onClick} disabled={o.disabled} busy={o.busy} primary={o.primary} title={o.title} size={o.size} className={o.className}>
      <span className="truncate">{o.label}</span>
    </BrandButton>
  )
  const draftBtn = (mode: DraftMode, label: string, title: string) =>
    brandBtn({ onClick: () => draft(mode), disabled: !!drafting, busy: drafting === mode, label, title, className: "flex-1 min-w-0" })
  const shotsN = Number(shotCount) || 1
  const lenRange = runtimeRange(shotsN)
  const targetN = Number(targetLen) || 0
  // A target these shots cannot reach: say so (the server keeps it in range)
  const lenWarn = targetN > lenRange.max ? `${shotsN} shot${shotsN === 1 ? "" : "s"} run at most ${lengthLabel(lenRange.max)} - add shots for ${lengthLabel(targetN)}`
    : targetN > 0 && targetN < lenRange.min ? `${shotsN} shots run at least ${lengthLabel(lenRange.min)} - use fewer shots for ${lengthLabel(targetN)}`
    : null
  const setTarget = (v: string) => { setTargetLen(v); try { localStorage.setItem("pv2-storyboard-target", v) } catch {} }
  const newBoardRow = board && (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">Shots</span>
          <NumberStepper value={shotsN} min={1} max={MAX_DRAFT_SHOTS} onChange={n => setShotCount(String(n))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">Target length</span>
          <Dropdown
            value={targetLen}
            options={TARGET_LENGTHS.map(s => ({ value: String(s), label: lengthLabel(s) }))}
            onChange={setTarget}
            className="w-full"
          />
        </label>
      </div>
      <p className={`text-[9.5px] leading-snug ${lenWarn ? "text-amber-300" : "text-slate-500"}`}>
        {lenWarn ?? (targetN
          ? `${shotsN} shot${shotsN === 1 ? "" : "s"} adding up to ${lengthLabel(targetN)} - about ${Math.round(targetN / shotsN)}s each`
          : `Auto: the AI sets each shot's length for a ${boardMode(board.mode).label.toLowerCase()}`)}
      </p>
      {brandBtn({
        onClick: () => draft("replace"),
        disabled: !!drafting || !premise.trim(),
        busy: drafting === "replace",
        primary: true,
        className: "w-full",
        size: "md",
        label: confirmReplace ? `Replace ${board.shots.length} shots?` : board.shots.length ? "Draft new board" : "Draft the board",
      })}
    </div>
  )
  const draftBox = board && (
    <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-3">
      <SilverRimOverlay />
      <div className="relative flex flex-col gap-2.5">
        {/* the studio's mark, then what this panel does */}
        <div className="flex items-center gap-2.5">
          <SiteLogoBox size={30} rounded={8} />
          <div className="min-w-0">
            <div className="text-[13px] font-black tracking-tight leading-tight silver-shimmer-text">Draft with AI</div>
            <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-slate-500">AI Design Studio</div>
          </div>
          {drafting && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-slate-300">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-white/20 border-t-slate-200 animate-spin" />
              {drafting === "replace" ? "Writing the board…" : drafting === "polish" ? "Polishing…" : drafting === "regenerate" ? "Rewriting…" : "Extending…"}
            </span>
          )}
        </div>
        {/* what kind of video: it shapes every draft, polish and extension, and the Final Cut's edit */}
        {(() => {
          const m = boardMode(board.mode)
          const Icon = MODE_ICONS[m.id]
          return (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => setModeOpen(o => !o)}
                className="silver-edge w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-opacity hover:opacity-90"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-slate-100"><Icon size={14} /></span>
                <span className="min-w-0">
                  <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-slate-500">Making a</span>
                  <span className="block text-[12px] font-bold text-white leading-tight">{m.label}</span>
                  <span className="block text-[10px] text-slate-400 leading-snug">{m.blurb}</span>
                </span>
                <ChevronDown size={13} className={`ml-auto shrink-0 text-slate-400 transition-transform ${modeOpen ? "rotate-180" : ""}`} />
              </button>
              {modeOpen && (
                <div className="grid grid-cols-2 gap-1">
                  {BOARD_MODES.map(x => {
                    const XI = MODE_ICONS[x.id]
                    const on = x.id === m.id
                    return (
                      <button
                        key={x.id}
                        title={x.blurb}
                        onClick={() => {
                          update(b => ({ ...b, mode: x.id }))
                          // An empty board takes the mode's usual length
                          if (board.shots.length === 0) setShotCount(String(x.shots))
                          setModeOpen(false)
                        }}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10.5px] font-semibold text-left transition-colors ${on ? "border-white/40 bg-white/10 text-white" : "border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/5"}`}
                      >
                        <XI size={12} className={on ? "text-white" : "text-slate-500"} /> {x.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
        <textarea
          value={premise}
          onChange={e => setPremise(e.target.value)}
          rows={3}
          placeholder={board.shots.length
            ? "Direction (optional): what to change, or what happens next…"
            : boardMode(board.mode).placeholder}
          className="sb-input"
        />
        {board.shots.length > 0 ? (
          <>
            {/* which shots: all, or the ones picked on the cards */}
            <div className="flex items-center gap-1.5 text-[10.5px]">
              <span className="text-slate-500">Working on</span>
              <span className={`font-semibold ${pickedCount ? "text-white" : "text-slate-300"}`}>{scopeLabel}</span>
              <button
                onClick={() => setSelecting(v => !v)}
                className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${selecting ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
              >
                <SquareCheck size={11} /> {selecting ? "Done picking" : "Pick shots"}
              </button>
              {pickedCount > 0 && <button onClick={() => setSelected([])} className="text-[10px] text-slate-500 hover:text-white">Clear</button>}
            </div>
            <div className="flex gap-1.5">
              {draftBtn("polish", "Polish", "Improve the writing - each shot keeps what it shows, its still and its clip")}
              {draftBtn("regenerate", "Rewrite", "Re-imagine these shots to fit the story (their stills stay as takes)")}
            </div>
            <div className="flex items-center gap-1.5">
              <NumberStepper
                value={Math.min(Number(extendCount) || 1, Math.max(1, MAX_SHOTS - board.shots.length))}
                min={1}
                max={Math.max(1, Math.min(MAX_DRAFT_SHOTS, MAX_SHOTS - board.shots.length))}
                prefix="+"
                onChange={n => setExtendCount(String(n))}
                className="w-[104px] shrink-0"
              />
              {board.shots.length >= MAX_SHOTS
                ? <span className="text-[10px] text-slate-500">The board is full ({MAX_SHOTS} shots)</span>
                : draftBtn("extend", "Extend", pickedCount ? "Add new shots right after the last picked shot" : "Add new shots that carry on from the end")}
            </div>
            <details className="group">
              <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300 list-none flex items-center gap-1">
                <ChevronRight size={10} className="transition-transform group-open:rotate-90" /> Start over with a new board
              </summary>
              <div className="pt-1.5 flex flex-col gap-1">
                {newBoardRow}
                {confirmReplace && <button onClick={() => setConfirmReplace(false)} className="self-start text-[10px] text-slate-500 hover:text-slate-300">Cancel - keep my shots</button>}
              </div>
            </details>
          </>
        ) : newBoardRow}
        {draftError && <p className="text-[10px] text-red-400">{draftError}</p>}
      </div>
    </div>
  )

  // The pipeline: stills -> shots -> Final Cut. The first unfinished step is
  // the one the page points at, so the next move is always obvious.
  const n = board?.shots.length ?? 0
  const renderingCount = board ? board.shots.filter(s => s.video?.status === "rendering").length : 0
  const stillsDone = n > 0 && stillCount === n
  const shotsDone = n > 0 && shotCountDone === n
  const nextStep: "story" | "stills" | "shots" | "cut" | null = !board ? null
    : n === 0 ? "story" : !stillsDone ? "stills" : !shotsDone ? "shots" : finalCut.versions.length === 0 ? "cut" : null
  const setRes = (v: string) => { setShootRes(v); try { localStorage.setItem("pv2-storyboard-res", v) } catch {} }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── boards: the open one, the latest few, New - the rest a search away ── */}
      <BoardBar
        boards={boards}
        current={board?.id ?? null}
        currentTitle={board?.title}
        onOpen={id => {
          if (id === board?.id) return
          // Save the board being left ONLY if it has unsaved edits. Saving
          // unconditionally wrote this tab's copy back over the server's,
          // undoing anything changed meanwhile (a still made from another
          // device, or a fix made outside the page)
          if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; flush() }
          open(id)
        }}
        onCreate={create}
      />

      {!board ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 border-t border-white/5">
          <SiteLogoBox size={64} rounded={16} />
          <p className="text-xl font-black tracking-tight silver-shimmer-text">Storyboard Studio</p>
          <p className="text-sm text-slate-300 font-semibold -mt-1">Plan a video as a storyboard</p>
          <p className="text-xs text-slate-500 max-w-sm">Stills in order, the story that connects them, and the video prompt planned for every shot - all before anything is shot.</p>
          <BrandButton onClick={create} primary size="lg" className="mt-1">New storyboard</BrandButton>
        </div>
      ) : (
        <>
          {/* ── the board's header: title, numbers, and the pipeline ── */}
          <div className="shrink-0 border-y border-white/[0.06] bg-gradient-to-b from-white/[0.035] to-white/[0.01] px-3 sm:px-4 py-2.5 flex flex-col xl:flex-row xl:items-center gap-2.5">
            <div className="min-w-0 xl:flex-1 flex items-center gap-3">
              <SiteLogoBox size={38} rounded={10} />
              <div className="min-w-0 flex-1">
              <div className="w-fit text-[9px] font-mono font-bold uppercase tracking-[0.24em] silver-shimmer-text silver-shimmer-text-slow">Storyboard Studio</div>
              <input
                value={board.title}
                onChange={e => update(b => ({ ...b, title: e.target.value }))}
                className="w-full bg-transparent text-base sm:text-lg font-bold text-white focus:outline-none border-b border-transparent focus:border-white/15 truncate"
                placeholder="Untitled storyboard"
              />
              <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-0.5">
                <span className="inline-flex items-center gap-1"><Film size={10} />{n} shots</span>
                <span className="inline-flex items-center gap-1"><Clock size={10} />{fmtRuntime(seconds)}</span>
                <span>{board.aspect}</span>
                <span className="text-slate-200">{boardMode(board.mode).label}</span>
                <span className="inline-flex items-center gap-1">
                  {saveState === "saving" ? "saving…" : saveState === "error" ? <span className="text-red-400">not saved</span> : <><Check size={10} />saved</>}
                </span>
              </div>
              </div>
            </div>

            <div className="flex items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-3 px-3 sm:mx-0 sm:px-0 pb-0.5">
              <Step n={1} label="Stills" value={`${stillCount}/${n}`} done={stillsDone} next={nextStep === "stills"}>
                <BrandButton onClick={generateMissing} disabled={batch || missing === 0} busy={batch} primary={nextStep === "stills"} size="xs">
                  {missing ? `Make ${missing}` : "All made"}
                  {missing > 0 && <Tix n={missingTickets} className="text-slate-300" />}
                </BrandButton>
              </Step>
              <StepArrow />
              <Step n={2} label="Shots" value={`${shotCountDone}/${n}${renderingCount ? ` · ${renderingCount} shooting` : ""}`} done={shotsDone} next={nextStep === "shots"}>
                <Dropdown value={shootRes} options={RES_OPTIONS} onChange={setRes} className="w-[72px]" />
                <BrandButton
                  onClick={shootAll}
                  onBlur={() => setConfirmShootAll(false)}
                  disabled={toShoot.length === 0}
                  warn={confirmShootAll}
                  primary={nextStep === "shots"}
                  size="xs"
                  title={toShoot.length ? `Shoot ${toShoot.length} shots at ${shootRes} - ${shootTickets} tickets` : shotsDone ? "Every shot is shot" : "Make the stills first - a shot animates its still"}
                >
                  {confirmShootAll ? `Shoot ${toShoot.length} for ${shootTickets} tickets?` : toShoot.length ? `Shoot ${toShoot.length}` : shotsDone ? "All shot" : "Stills first"}
                  {toShoot.length > 0 && !confirmShootAll && <Tix n={shootTickets} className="text-slate-300" />}
                </BrandButton>
              </Step>
              <StepArrow />
              <Step
                n={3}
                label="Final Cut"
                value={fcRunning ? (finalCut.job?.message ?? "Cutting") : finalCut.versions.length ? `Cut ${finalCut.versions.at(-1)!.n} · ${fmtRuntime(finalCut.versions.at(-1)!.durationSec)}` : "Not cut yet"}
                done={finalCut.versions.length > 0 && !fcRunning}
                next={nextStep === "cut"}
              >
                <BrandButton onClick={() => setFcOpen(true)} disabled={fcRunning} busy={fcRunning} primary={nextStep === "cut"} size="xs">
                  {fcRunning ? "Cutting…" : finalCut.versions.length ? "New cut" : "Make it"}
                  {!fcRunning && n > 0 && <Tix n={fcTickets} approx className="text-slate-300" />}
                </BrandButton>
              </Step>
              <button
                onClick={() => setAnimatic(0)}
                disabled={n === 0}
                title="Play the board back at its planned lengths"
                className="silver-edge shrink-0 ml-1 flex flex-col items-center justify-center gap-0.5 px-3 rounded-xl text-slate-200 hover:text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Play size={14} />
                <span className="text-[9.5px] font-semibold">Animatic</span>
              </button>
            </div>
          </div>

          {/* Phones and tablets: ONE scroll - the story panel, then the whole
              board. Two stacked scroll panes inside a fixed-height page left the
              board a short strip under Safari's toolbar. Desktop keeps two panes. */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain lg:overflow-hidden flex flex-col lg:flex-row">
            {/* ── the story ── */}
            <aside className="lg:w-80 xl:w-96 shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 lg:overflow-y-auto p-3 sm:p-4 space-y-4">
              {/* drafting comes first on an empty board - it is the way in */}
              {n === 0 && draftBox}

              <section className="silver-edge rounded-2xl p-3 space-y-3">
              <BrandTitle title="The film" eyebrow="Story · look · frame" logo={22} size="sm" />
              <Field label="The story" hint="what happens, and how the shots connect">
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
              </section>

              {/* the cut's assets: characters, vehicles, props, places - each a set of refs */}
              <section className="silver-edge rounded-2xl p-3">
              <AssetsPanel
                assets={board.assets}
                onChange={fn => update(b => ({ ...b, assets: fn(b.assets) }))}
                refLibrary={refLibrary}
                boardStills={boardStills}
                cap={refCap}
              />
              </section>

              {n > 0 && draftBox}

              <button onClick={removeBoard} className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-red-400">
                <Trash2 size={11} /> {confirmDelete ? "Click again to delete this storyboard (stills stay in your library)" : "Delete storyboard"}
              </button>
            </aside>

            {/* ── the board ── */}
            {/* the bottom padding clears iOS Safari's floating toolbar */}
            <main className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto p-3 sm:p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-6">
              {(finalCut.job || finalCut.versions.length > 0) && (
                <ScreeningRoom
                  board={board}
                  finalCut={finalCut}
                  shown={shownVersion}
                  aspectCss={aspectCss}
                  onPick={setFcVersion}
                  onAction={fcAction}
                />
              )}

              <div className="flex items-center gap-2.5 mb-3">
                <BrandTitle title={`Shots · ${n}`} logo={0} size="sm" />
                <span className="text-[10px] text-slate-600">drag a number to reorder · make and shoot from the picture</span>
              </div>
              {/* As many columns as fit, with card widths that grow with the
                  screen: a tall frame gets narrower cards (a row of shots, not
                  one giant still), and a big monitor gets bigger cards rather
                  than a wall of thumbnails */}
              <div className="grid gap-3 items-start" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${portrait ? "min(clamp(210px, 14vw, 360px), 46%)" : board.aspect === "1:1" ? "min(clamp(240px, 17vw, 420px), 100%)" : "min(clamp(290px, 21vw, 540px), 100%)"}, 1fr))` }}>
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
                    stillCost={stillTickets(shot.imageModel, shot.imageQuality, board.aspect, shot.imageOptions, Math.min(refsOn, stillModelSpec(shot.imageModel).maxRefs))}
                    refsInfo={{ on: onRefs.length, max: stillModelSpec(shot.imageModel).maxRefs }}
                    assets={board.assets}
                    onAddToAsset={(assetId, kind) => shot.stillUrl && addStillToAsset(shot.stillUrl, assetId, kind)}
                    selecting={selecting}
                    picked={selected.includes(shot.id)}
                    onPick={() => toggleSelected(shot.id)}
                    flash={flashIds.includes(shot.id)}
                    onFocus={() => setFocusId(shot.id)}
                    onOpen={() => openStill(shot)}
                    onPickVideo={take => pickVideoTake(shot.id, take)}
                    opening={opening === shot.id}
                    onAiEdit={(instruction, scope) => aiEditShot(shot, instruction, scope)}
                    inRefs={!!shot.stillUrl && activeRefKeys.has(stillKey(shot.stillUrl))}
                    onAddRef={onAddRef && shot.stillUrl ? () => onAddRef(shot.stillUrl!) : undefined}
                    onDragStart={() => setDragFrom(i)}
                    onDragEnd={() => setDragFrom(null)}
                    onDrop={() => { if (dragFrom !== null) moveShot(dragFrom, i); setDragFrom(null) }}
                  />
                ))}
                {board.shots.length < MAX_SHOTS && (
                  <button
                    onClick={() => addShot()}
                    style={{ aspectRatio: aspectCss }}
                    className="rounded-2xl border border-dashed border-white/15 hover:border-white/40 hover:bg-white/[0.03] text-slate-500 hover:text-slate-200 flex flex-col items-center justify-center gap-2 min-h-[160px] transition-colors"
                  >
                    <Plus size={20} />
                    <span className="text-[11px] font-semibold">Add shot {pad2(board.shots.length + 1)}</span>
                  </button>
                )}
              </div>
            </main>
          </div>
        </>
      )}

      {board && fcOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={() => setFcOpen(false)}>
          <div className="relative isolate overflow-hidden w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-5" onClick={e => e.stopPropagation()}>
            <SilverRimOverlay />
            <div className="relative space-y-4">
            <BrandTitle
              title="Final Cut"
              eyebrow="Edit · score · narrate"
              logo={30}
              right={<button onClick={() => setFcOpen(false)} className="text-slate-500 hover:text-white"><X size={15} /></button>}
            />
            <p className="text-[11.5px] text-slate-400 leading-relaxed">
              Shoots any slot that has no clip yet, then plans the edit from the footage (which seconds of each clip to keep and how each cut lands),
              adds the cards, scores music to the picture, mixes and saves a new version.
            </p>
            <label className="flex items-center gap-2 text-[12px] text-slate-200 cursor-pointer">
              <input type="checkbox" className="accent-slate-300" checked={fcOptions.cards} onChange={e => setFcOptions(o => ({ ...o, cards: e.target.checked }))} />
              Title & end cards <span className="text-slate-500 text-[11px]">· lettered by Recraft v4.1</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] text-slate-200 cursor-pointer">
                <input type="checkbox" className="accent-slate-300" checked={fcOptions.narration} onChange={e => setFcOptions(o => ({ ...o, narration: e.target.checked }))} />
                Narration
              </label>
              {fcOptions.narration && <Dropdown value={fcOptions.voice} options={NARRATOR_VOICES.map(v => ({ value: v, label: v }))} onChange={v => setFcOptions(o => ({ ...o, voice: v }))} className="w-32 ml-auto" />}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-slate-200">
              Shoot missing shots at
              <Dropdown value={shootRes} options={RES_OPTIONS} onChange={v => { setShootRes(v); try { localStorage.setItem("pv2-storyboard-res", v) } catch {} }} className="w-20 ml-auto" />
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-[11.5px] text-slate-300 space-y-0.5">
              <div className="flex justify-between"><span>Shots still to shoot</span><span className="font-mono">{fcShootTickets} tickets</span></div>
              <div className="flex justify-between"><span>Edit, cards, score{fcOptions.narration ? ", narration" : ""}</span><span className="font-mono">~{fcExtraTickets} tickets</span></div>
              <div className="flex justify-between font-bold text-white pt-1 border-t border-white/10"><span>About</span><span className="font-mono">{fcTickets} tickets</span></div>
            </div>
            {(fcBlocked || fcError) && <p className="text-[11px] text-red-300">{fcBlocked || fcError}</p>}
            <BrandButton onClick={() => fcAction("start")} disabled={!!fcBlocked} primary size="lg" className="w-full">
              Make the Final Cut <Tix n={fcTickets} approx className="text-slate-300" />
            </BrandButton>
            </div>
          </div>
        </div>
      )}

      {board && animatic !== null && board.shots.length > 0 && (
        <Animatic board={board} start={animatic} aspectCss={aspectCss} onClose={() => setAnimatic(null)} />
      )}

      <style jsx global>{`
        .sb-input { width: 100%; border-radius: 0.6rem; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3);
          padding: 0.45rem 0.6rem; font-size: 11.5px; line-height: 1.45; color: #e2e8f0; resize: vertical; }
        .sb-input:focus { outline: none; border-color: rgba(226,232,240,0.4); box-shadow: 0 0 0 3px rgba(226,232,240,0.05); }
        .sb-input::placeholder { color: #475569; }
      `}</style>
    </div>
  )
}

/**
 * A number between min and max: - and + buttons, or type it. Typing is kept
 * as typed until it is done (blur / Enter), then clamped - so clearing the
 * box to type "12" does not snap to 1 in between.
 */
function NumberStepper({ value, min, max, onChange, prefix = "", className = "" }: {
  value: number
  min: number
  max: number
  onChange: (n: number) => void
  prefix?: string
  className?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const commit = (raw: string) => {
    const n = Math.round(Number(raw.replace(/[^0-9]/g, "")))
    const v = Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : value
    setText(String(v))
    if (v !== value) onChange(v)
  }
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)))
  const btn = "w-7 shrink-0 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
  return (
    <div className={`flex h-8 items-stretch rounded-lg border border-white/10 bg-black/30 overflow-hidden focus-within:border-white/35 ${className}`}>
      <button type="button" onClick={() => step(-1)} disabled={value <= min} className={btn} aria-label="Fewer"><Minus size={12} /></button>
      <div className="flex-1 min-w-0 flex items-center justify-center text-[12px] font-mono font-bold text-white">
        {prefix && <span className="text-slate-500">{prefix}</span>}
        <input
          value={text}
          inputMode="numeric"
          onChange={e => setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
            else if (e.key === "ArrowUp") { e.preventDefault(); step(1) }
            else if (e.key === "ArrowDown") { e.preventDefault(); step(-1) }
          }}
          aria-label={`A number from ${min} to ${max}`}
          className="w-[2.6ch] bg-transparent text-center focus:outline-none"
        />
      </div>
      <button type="button" onClick={() => step(1)} disabled={value >= max} className={btn} aria-label="More"><Plus size={12} /></button>
    </div>
  )
}

/** "Today" / "Yesterday" / ... for the picker's groups. */
function whenGroup(iso?: string): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return "Earlier"
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (t >= today) return "Today"
  if (t >= today - day) return "Yesterday"
  if (t >= today - 6 * day) return "This week"
  if (t >= today - 29 * day) return "This month"
  return "Earlier"
}
/** "5m", "3h", "2d" - or the date, once it is old. */
function ago(iso?: string): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ""
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000))
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`
  if (m < 60 * 24 * 14) return `${Math.floor(m / 1440)}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
}
function BoardCover({ url, className }: { url: string | null | undefined; className: string }) {
  return (
    <span className={`relative shrink-0 overflow-hidden rounded bg-black/50 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : <Clapperboard size={11} className="absolute inset-0 m-auto text-slate-600" />}
    </span>
  )
}

/**
 * The account's storyboards, built to hold tens to hundreds of them. The
 * old row put every board in one sideways strip, so New ended up off the end
 * of it. Now the open board (a switcher) and New are always on screen, the
 * latest few sit between them as quick chips (as many as the width allows),
 * and every board is a search away in the picker: filter by title, sort by
 * recent / name / length, grouped by when it was last edited, arrow keys and
 * Enter to open.
 */
function BoardBar({ boards, current, currentTitle, onOpen, onCreate }: {
  boards: BoardSummary[]
  current: number | null
  /** The open board's live title (the summary's lags behind typing). */
  currentTitle?: string
  onOpen: (id: number) => void
  onCreate: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<"recent" | "name" | "longest">("recent")
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const cur = boards.find(b => b.id === current)
  // The list arrives newest-edited first
  const recent = boards.filter(b => b.id !== current).slice(0, 5)
  const titleOf = (b: BoardSummary) => (b.id === current && currentTitle ? currentTitle : b.title) || "Untitled storyboard"

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", down)
    return () => document.removeEventListener("mousedown", down)
  }, [open])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle ? boards.filter(b => titleOf(b).toLowerCase().includes(needle)) : [...boards]
    if (sort === "name") hit.sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: "base", numeric: true }))
    else if (sort === "longest") hit.sort((a, b) => b.seconds - a.seconds)
    return hit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, q, sort, current, currentTitle])
  useEffect(() => { setCursor(0) }, [q, sort, open])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])
  const pick = (id: number) => { setOpen(false); setQ(""); onOpen(id) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(list.length - 1, c + 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === "Enter" && list[cursor]) { e.preventDefault(); pick(list[cursor].id) }
    else if (e.key === "Escape") setOpen(false)
  }
  const SORTS: { id: typeof sort; label: string }[] = [{ id: "recent", label: "Recent" }, { id: "name", label: "A-Z" }, { id: "longest", label: "Longest" }]

  return (
    <div ref={rootRef} className="relative z-40 flex items-center gap-1.5 px-3 sm:px-4 py-1.5 shrink-0">
      {/* the open board - opens every board */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="All storyboards"
        className={`min-w-0 max-w-[62%] sm:max-w-[300px] flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border text-[11px] transition-colors ${open ? "border-white/40 bg-white/10 text-white" : "border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.07] hover:border-white/25"}`}
      >
        <BoardCover url={cur?.cover} className="w-8 h-[22px]" />
        <span className="min-w-0 truncate font-semibold">{cur ? titleOf(cur) : boards.length ? "Choose a storyboard" : "No storyboards yet"}</span>
        <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[9px] font-mono text-slate-300" title={`${boards.length} storyboards`}>{boards.length}</span>
        <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* the latest few, as many as fit - never a sideways scroll */}
      <div className="hidden md:flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {recent.map((b, i) => (
          <button
            key={b.id}
            onClick={() => onOpen(b.id)}
            title={`${titleOf(b)} - ${b.shotCount} shots, ${fmtRuntime(b.seconds)}`}
            className={`${i >= 4 ? "hidden 2xl:flex" : i >= 2 ? "hidden xl:flex" : "flex"} min-w-0 max-w-[190px] items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg border border-white/[0.08] text-[11px] text-slate-400 hover:text-white hover:bg-white/5 transition-colors`}
          >
            <BoardCover url={b.cover} className="w-6 h-4" />
            <span className="min-w-0 truncate">{titleOf(b)}</span>
          </button>
        ))}
      </div>

      <button
        onClick={onCreate}
        className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/20 bg-white/[0.06] text-[11px] font-semibold text-white hover:bg-white/10 hover:border-white/35 transition-colors"
      >
        <Plus size={12} /> New<span className="hidden sm:inline">&nbsp;storyboard</span>
      </button>

      {/* the picker */}
      {open && (
        <div className="absolute left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] top-full mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#0a0f1a] shadow-2xl shadow-black/70">
          <SilverRimOverlay rounded="rounded-xl" />
          <div className="relative flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-2">
            <Search size={13} className="shrink-0 text-slate-500" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder={`Search ${boards.length} storyboard${boards.length === 1 ? "" : "s"}`}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-600 focus:outline-none"
            />
            <div className="flex shrink-0 rounded-md border border-white/10 p-0.5">
              {SORTS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-semibold transition-colors ${sort === s.id ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-200"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div ref={listRef} className="relative max-h-[min(60vh,460px)] overflow-y-auto overscroll-contain py-1">
            {list.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-slate-500">{q ? <>No storyboard is called &ldquo;{q}&rdquo;</> : "No storyboards yet"}</p>
            ) : list.map((b, i) => {
              const group = sort === "recent" && !q ? whenGroup(b.updatedAt) : null
              const showGroup = group && (i === 0 || whenGroup(list[i - 1].updatedAt) !== group)
              const mode = boardMode(b.mode)
              const MI = MODE_ICONS[mode.id]
              const isCur = b.id === current
              return (
                <div key={b.id}>
                  {showGroup && <p className="px-3 pt-2 pb-1 text-[9px] font-mono uppercase tracking-[0.18em] text-slate-600">{group}</p>}
                  <button
                    data-i={i}
                    onClick={() => pick(b.id)}
                    onMouseMove={() => { if (cursor !== i) setCursor(i) }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${i === cursor ? "bg-white/[0.07]" : ""}`}
                  >
                    <BoardCover url={b.cover} className="w-14 h-8" />
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1 text-[11.5px] font-semibold ${isCur ? "text-white" : "text-slate-200"}`}>
                        <span className="truncate">{titleOf(b)}</span>
                        {isCur && <Check size={11} className="shrink-0 text-slate-300" />}
                      </span>
                      <span className="flex items-center gap-1.5 text-[9.5px] font-mono text-slate-500">
                        <MI size={9} className="shrink-0" />{mode.label}
                        <span>·</span>{b.shotCount} shot{b.shotCount === 1 ? "" : "s"}
                        <span>·</span>{fmtRuntime(b.seconds)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[9px] font-mono text-slate-600">{ago(b.updatedAt)}</span>
                  </button>
                </div>
              )
            })}
          </div>
          <div className="relative flex items-center justify-between gap-2 border-t border-white/[0.06] px-2.5 py-1.5">
            <span className="text-[9px] font-mono text-slate-600 hidden sm:inline">↑↓ to move · Enter to open · Esc to close</span>
            <button
              onClick={() => { setOpen(false); onCreate() }}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-slate-200 hover:text-white hover:bg-white/5"
            >
              <Plus size={11} /> New storyboard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A text box that grows to fit what is in it - no inner scrollbar, the whole
 * text always shown. Re-measures when its width changes (a card resizing).
 */
function AutoText({ value, onChange, placeholder, className = "", minRows = 1 }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useEffect(() => { fit() }, [value, fit])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit() } })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${className} resize-none overflow-hidden`}
    />
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

/** One step of the pipeline bar. The next step to take glows. */
function Step({ n, label, value, done, next, children }: { n: number; label: string; value: string; done: boolean; next: boolean; children: React.ReactNode }) {
  return (
    <div className={`shrink-0 flex items-center gap-2.5 pl-2 pr-1.5 py-1.5 rounded-xl border transition-colors ${next ? "border-white/40 bg-white/[0.06] shadow-[0_0_22px_-6px_rgba(226,232,240,0.45)]" : "border-white/10 bg-black/20"}`}>
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${done ? "bg-emerald-400/90 text-black" : next ? "bg-slate-100 text-black" : "bg-white/10 text-slate-400"}`}>
        {done ? <Check size={11} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 max-w-[150px]">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-300 leading-none">{label}</div>
        <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">{value}</div>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}
function StepArrow() {
  return <ChevronRight size={14} className="shrink-0 self-center text-slate-700" />
}

/**
 * The finished cuts: the chosen one in a player sized to the screen (a 9:16
 * film is capped by height, not stretched to the panel's width), its versions
 * as posters, and - only while a cut is running or has stopped - its steps.
 */
function ScreeningRoom({ board, finalCut, shown, aspectCss, onPick, onAction }: {
  board: StoryboardDoc
  finalCut: FinalCutState
  shown: FinalCutState["versions"][number] | null
  aspectCss: string
  onPick: (n: number) => void
  onAction: (a: "start" | "resume" | "cancel") => void
}) {
  const job = finalCut.job
  const showSteps = !!job && job.status !== "done"
  const tall = ["9:16", "3:4"].includes(board.aspect)
  const square = board.aspect === "1:1"
  // Every cut opens on black (the title card fades in), so the player always
  // carries a poster: the cut's own mid frame, or the board's first still
  const poster = (v: FinalCutState["versions"][number]) => v.posterUrl || board.shots.find(s => s.stillUrl)?.stillUrl || undefined
  return (
    <section className="relative isolate overflow-hidden mb-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-[#0a0f1a] to-[#080b14] p-3 sm:p-4">
      <SilverRimOverlay />
      <div className="relative">
      <div className="flex items-center gap-3 mb-3">
        <BrandTitle title="Screening room" eyebrow="Your Final Cuts" logo={24} />
        {job && <span className="text-[10.5px] text-slate-400 truncate">{job.status === "running" ? job.message : job.status === "done" ? "" : job.message}</span>}
      </div>
      <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
        {shown && (
          <div
            className="relative shrink-0 rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl max-w-full"
            style={tall
              ? { aspectRatio: aspectCss, height: "min(56vh, 520px)" }
              : { aspectRatio: aspectCss, width: square ? "min(100%, 420px)" : "min(100%, 620px)" }}
          >
            <video key={shown.url} src={shown.url} poster={poster(shown)} controls playsInline preload="none" className="absolute inset-0 w-full h-full object-contain" />
          </div>
        )}
        <div className="flex-1 min-w-0 w-full space-y-3">
          {shown && (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-white">Final Cut {shown.n}</span>
                <span className="text-[11px] font-mono text-slate-400">{fmtRuntime(shown.durationSec)}</span>
                <a href={shown.url} download={`${board.title} - Final Cut ${shown.n}.mp4`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white hover:bg-white/5">
                  <Download size={11} /> Download
                </a>
              </div>
              <p className="text-[10.5px] text-slate-500 mt-1">{shown.note}</p>
              <p className="text-[10px] text-slate-600">Saved to My Generations › Storyboards › {board.title}</p>
            </div>
          )}
          {finalCut.versions.length > 1 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Versions</div>
              <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-1">
                {[...finalCut.versions].reverse().map(v => (
                  <button key={v.n} onClick={() => onPick(v.n)} className={`shrink-0 w-[72px] text-left rounded-lg overflow-hidden border transition-colors ${shown?.n === v.n ? "border-slate-100 ring-1 ring-white/40" : "border-white/10 opacity-70 hover:opacity-100"}`}>
                    <span className="relative block bg-black" style={{ aspectRatio: aspectCss }}>
                      {poster(v) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poster(v)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      )}
                    </span>
                    <span className="block px-1.5 py-1 text-[9.5px] font-semibold text-slate-200">Cut {v.n} · {fmtRuntime(v.durationSec)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {showSteps && job && (
            <div className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-2">
              <ol className="grid grid-cols-2 gap-x-3 gap-y-1">
                {FINAL_CUT_PHASES.map(ph => {
                  const order = FINAL_CUT_PHASES.findIndex(x => x.key === job.phase)
                  const me = FINAL_CUT_PHASES.findIndex(x => x.key === ph.key)
                  const skipped = job.skip.includes(ph.key)
                  const state = skipped ? "skip" : me < order ? "done" : me === order ? (job.status === "running" ? "now" : job.status === "failed" ? "fail" : "stop") : "todo"
                  return (
                    <li key={ph.key} className={`flex items-center gap-1.5 text-[11px] ${state === "todo" || state === "skip" ? "text-slate-600" : state === "fail" ? "text-red-300" : "text-slate-200"}`}>
                      {state === "done" ? <CircleCheck size={12} className="text-emerald-400" /> : state === "now" ? <Loader2 size={12} className="animate-spin text-slate-200" /> : state === "fail" ? <CircleX size={12} className="text-red-400" /> : state === "skip" ? <MinusCircle size={12} /> : <CircleDashed size={12} />}
                      {ph.label}{state === "skip" ? " (off)" : ""}
                    </li>
                  )
                })}
              </ol>
              {job.error && <p className="text-[10.5px] text-red-300 leading-snug">{job.error}</p>}
              <div className="flex gap-2">
                {job.status === "running" && <button onClick={() => onAction("cancel")} className="px-2.5 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white">Cancel</button>}
                {(job.status === "failed" || job.status === "cancelled") && (
                  <BrandButton onClick={() => onAction("resume")} primary size="xs">Resume from “{FINAL_CUT_PHASES.find(x => x.key === job.phase)?.label}”</BrandButton>
                )}
              </div>
            </div>
          )}
          {!shown && !showSteps && <p className="text-[11px] text-slate-500">No cut yet.</p>}
        </div>
      </div>
      </div>
    </section>
  )
}

/**
 * One slot. The picture leads - its number, its state and the two things you
 * do to it (make the still, shoot the clip) sit on the picture itself. The
 * prompts and models are one tap away under Details, so a board reads as a
 * storyboard, not a stack of forms.
 */
function ShotCard({
  index, shot, aspectCss, busy, error, last, dragging, shootTickets,
  onChange, onGenerate, onShoot, onMove, onDuplicate, onRemove, onPlay, onDragStart, onDragEnd, onDrop, inRefs, onAddRef,
  stillCost, refsInfo, assets, onAddToAsset, selecting, picked, onPick, flash, onFocus, onOpen, opening, onAiEdit, onPickVideo,
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
  /** This still is one of the active references already. */
  inRefs: boolean
  onAddRef?: () => Promise<{ added: number; limitHit: boolean; reason?: string | null }>
  /** Tickets for one still on this shot's model at its quality. */
  stillCost: number
  /** Switched-on asset refs, and how many this shot's model takes. */
  refsInfo: { on: number; max: number }
  assets: StoryAsset[]
  /** Put this still into an asset (null = a new one of `kind`). */
  onAddToAsset: (assetId: string | null, kind?: AssetKind) => void
  /** Picking shots for Draft with AI. */
  selecting: boolean
  picked: boolean
  onPick: () => void
  /** Just changed by Draft with AI. */
  flash: boolean
  /** The shot being worked on - sets the assets' ref limit. */
  onFocus: () => void
  /** Open the still in the full viewer. */
  onOpen: () => void
  /** The still's viewer is loading (its record was not ready yet). */
  opening?: boolean
  /** Play one of this shot's earlier video takes instead. */
  onPickVideo: (take: ShotVideo) => void
  /** Rewrite this shot's image and/or video plan with AI ("use LTX 2.5 Fast instead"...). */
  onAiEdit: (instruction: string, scope: "image" | "video" | "both") => Promise<{ patch?: Partial<StoryboardShot>; note?: string; error?: string }>
}) {
  const [details, setDetails] = useState(false)
  const [refMenu, setRefMenu] = useState(false)
  // Edit with AI
  const [aiText, setAiText] = useState("")
  const [aiScope, setAiScope] = useState<"image" | "video" | "both">("both")
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [aiUndo, setAiUndo] = useState<Partial<StoryboardShot> | null>(null)
  // A model switched by hand offers to rewrite its prompt for the new model
  const [adapt, setAdapt] = useState<{ image?: boolean; video?: boolean }>({})
  const runAi = async (instruction: string, scope: "image" | "video" | "both") => {
    if (!instruction.trim() || aiBusy) return
    setAiBusy(true)
    setAiNote(null)
    // What it was, so Undo can put it back
    const before: Partial<StoryboardShot> = {
      imageModel: shot.imageModel, imagePrompt: shot.imagePrompt, imageQuality: shot.imageQuality ?? "", imageOptions: shot.imageOptions ?? {},
      videoModel: shot.videoModel, videoPrompt: shot.videoPrompt, duration: shot.duration,
    }
    const r: { patch?: Partial<StoryboardShot>; note?: string; error?: string } = await onAiEdit(instruction.trim(), scope).catch(() => ({ error: "The edit failed" }))
    setAiBusy(false)
    if (r.error) { setAiNote({ ok: false, text: r.error }); return }
    const changed = Object.keys(r.patch ?? {}) as (keyof StoryboardShot)[]
    setAiUndo(Object.fromEntries(changed.map(k => [k, before[k]])) as Partial<StoryboardShot>)
    setAiNote({ ok: true, text: r.note || "Updated" })
    setAdapt({})
    setAiText("")
  }
  const knobs = stillModelSpec(shot.imageModel)
  const sent = Math.min(refsInfo.on, refsInfo.max)
  const [refState, setRefState] = useState<"idle" | "adding" | "added" | "full" | "failed">("idle")
  // A later shot usually needs an earlier one as its reference - one tap puts
  // this still in the Refs library, switched on for the next still made
  const addRef = async () => {
    if (!onAddRef || refState === "adding") return
    setRefState("adding")
    const r = await onAddRef().catch(() => null)
    setRefState(!r ? "failed" : r.added > 0 ? "added" : r.limitHit ? "full" : "failed")
    setTimeout(() => setRefState("idle"), 2500)
  }
  const v = shot.video
  const done = v?.status === "done" && !!v.url
  // A shot with a finished clip opens on the clip; the still is one tap away
  const [view, setView] = useState<"still" | "video">(done ? "video" : "still")
  const lastUrl = useRef(v?.url)
  useEffect(() => { if (v?.url && v.url !== lastUrl.current) { lastUrl.current = v.url; setView("video") } }, [v?.url])
  const showVideo = done && view === "video"
  // A conformed clip keeps its original (say Kling's 9:16 on a 3:4 board):
  // the card can play either. The Final Cut always uses the board's frame.
  const [frame, setFrame] = useState<"board" | "raw">("board")
  const hasRaw = !!v?.rawUrl
  const playUrl = hasRaw && frame === "raw" ? v!.rawUrl! : v?.url ?? null
  const stale = outOfDate(shot)
  const canShoot = !!shot.stillUrl && !!STORYBOARD_VIDEO_IDS[shot.videoModel]
  const shooting = v?.status === "rendering"
  // The still's takes: the slot shows one, the rest are a tap away
  const takes = shot.stills ?? []
  const takeIdx = shot.stillUrl ? takes.findIndex(t => stillKey(t.url) === stillKey(shot.stillUrl!)) : -1
  const pickTake = (k: number) => { const t = takes[(k + takes.length) % takes.length]; if (t) onChange({ stillUrl: t.url }) }
  // The video takes: every clip this slot has had (kept by the server)
  const clips = shot.videos ?? []
  const clipIdx = v?.url ? clips.findIndex(t => !!t.url && stillKey(t.url) === stillKey(v.url!)) : -1
  const pickClip = (k: number) => { const t = clips[(k + clips.length) % clips.length]; if (t && t !== clips[clipIdx]) onPickVideo(t) }
  const elapsed = shooting ? Math.max(0, Math.round((Date.now() - v!.at) / 1000)) : 0
  const status = shooting ? { label: `Shooting ${fmtRuntime(elapsed)}`, cls: "border-fuchsia-400/50 text-fuchsia-100" }
    : v?.status === "failed" ? { label: "Shoot failed", cls: "border-red-400/50 text-red-200" }
    : stale ? { label: "Edited", cls: "border-amber-300/50 text-amber-100", title: "The still or video prompt changed after this was shot - reshoot to match" }
    : done ? { label: "Shot", cls: "border-emerald-400/40 text-emerald-100" }
    : shot.stillUrl ? { label: "Still", cls: "border-white/20 text-slate-200" }
    : null
  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDrop() }}
      onPointerDownCapture={onFocus}
      className={`@container/card relative isolate flex flex-col rounded-2xl border bg-white/[0.02] overflow-hidden transition-all ${dragging ? "opacity-40" : ""} ${
        picked ? "border-slate-100 ring-2 ring-white/50" : flash ? "border-emerald-400/70 ring-2 ring-emerald-400/40" : "border-white/10 hover:border-white/20"
      }`}
    >
      {/* the picture */}
      <div className="@container relative bg-black/60 group" style={{ aspectRatio: aspectCss }}>
        {showVideo ? (
          // The original plays whole (letterboxed) - nothing is cut while viewing it
          <video key={playUrl!} src={playUrl!} poster={frame === "raw" ? undefined : shot.stillUrl ?? undefined} className={`absolute inset-0 w-full h-full ${frame === "raw" ? "object-contain bg-black" : "object-cover"}`} controls playsInline loop preload={frame === "raw" ? "metadata" : "none"} />
        ) : shot.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.stillUrl}
            alt={shot.description}
            onClick={onOpen}
            title="Open full size"
            className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-600">
            <ImagePlus size={18} />
            <span className="text-[10px]">No still yet</span>
          </div>
        )}

        {/* number, drag handle, status */}
        <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start gap-1 pointer-events-none">
          <span
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart() }}
            onDragEnd={onDragEnd}
            title="Drag to reorder"
            className="pointer-events-auto cursor-grab flex items-center gap-0.5 pl-0.5 pr-1.5 py-0.5 rounded-md bg-black/70 border border-white/10 font-mono text-[10px] font-bold text-slate-200"
          >
            <GripVertical size={11} className="text-slate-500" />{pad2(index + 1)}
          </span>
          {status && (
            <span title={"title" in status ? status.title : undefined} className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 border text-[9.5px] font-semibold whitespace-nowrap ${status.cls}`}>
              {shooting && <Loader2 size={9} className="animate-spin" />}{status.label}
            </span>
          )}
          {clips.length > 1 && showVideo && (
            <span title={clipIdx >= 0 ? `Clip ${clipIdx + 1} of ${clips.length}` : `${clips.length} clips`} className="px-1.5 py-0.5 rounded-md bg-black/70 border border-fuchsia-300/40 text-[9.5px] font-mono font-semibold text-fuchsia-50">
              {clipIdx >= 0 ? clipIdx + 1 : "–"}/{clips.length}
            </span>
          )}
          {takes.length > 1 && !showVideo && (
            <span title={takeIdx >= 0 ? `Take ${takeIdx + 1} of ${takes.length}` : `${takes.length} earlier takes`} className="px-1.5 py-0.5 rounded-md bg-black/70 border border-white/40 text-[9.5px] font-mono font-semibold text-white">
              {takeIdx >= 0 ? takeIdx + 1 : "–"}/{takes.length}
            </span>
          )}
          {showVideo && hasRaw && (
            <div title="The board's frame (used in the Final Cut) or the clip as the model rendered it" className="pointer-events-auto flex rounded-md overflow-hidden border border-white/15 text-[9.5px] font-mono font-semibold">
              <button onClick={() => setFrame("board")} className={`px-1.5 py-0.5 ${frame === "board" ? "bg-slate-100 text-black" : "bg-black/70 text-slate-300"}`}>{aspectCss.replace("/", ":")}</button>
              <button onClick={() => setFrame("raw")} className={`px-1.5 py-0.5 ${frame === "raw" ? "bg-slate-100 text-black" : "bg-black/70 text-slate-300"}`}>{frameLabel(v?.rawSize)}</button>
            </div>
          )}
          {done && (
            <div className="pointer-events-auto ml-auto flex rounded-md overflow-hidden border border-white/15 text-[9.5px] font-semibold">
              <button onClick={() => setView("still")} className={`px-1.5 py-0.5 ${!showVideo ? "bg-white/90 text-black" : "bg-black/70 text-slate-300"}`}>Still</button>
              <button onClick={() => setView("video")} className={`px-1.5 py-0.5 ${showVideo ? "bg-fuchsia-400 text-black" : "bg-black/70 text-slate-300"}`}>Video</button>
            </div>
          )}
        </div>

        {selecting && (
          <button onClick={onPick} title={picked ? "Unpick" : "Pick this shot for Draft with AI"} className={`absolute inset-0 z-[6] flex items-start justify-end p-1.5 ${picked ? "bg-white/15" : "bg-black/20 hover:bg-black/10"}`}>
            {picked ? <SquareCheck size={18} className="text-slate-200 drop-shadow" /> : <Square size={18} className="text-white/80 drop-shadow" />}
          </button>
        )}

        {opening && !busy && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
            <Loader2 size={20} className="animate-spin text-slate-100" />
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5">
            <Loader2 size={18} className="animate-spin text-slate-200" />
            <span className="text-[10px] text-slate-300">{imageModelLabel(shot.imageModel)}…</span>
          </div>
        )}

        {/* earlier and later clips, in the video view (above the player's own controls) */}
        {clips.length > 1 && showVideo && !busy && !selecting && !shooting && (
          <>
            <button onClick={() => pickClip(clipIdx - 1)} title="Previous clip" className="absolute left-1 top-[42%] -translate-y-1/2 w-7 h-7 rounded-full bg-black/65 border border-white/15 flex items-center justify-center text-white hover:bg-black/85 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => pickClip(clipIdx + 1)} title="Next clip" className="absolute right-1 top-[42%] -translate-y-1/2 w-7 h-7 rounded-full bg-black/65 border border-white/15 flex items-center justify-center text-white hover:bg-black/85 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
              <ChevronRight size={14} />
            </button>
          </>
        )}
        {/* earlier and later takes of the still (always shown on touch screens, on hover with a mouse) */}
        {takes.length > 1 && !busy && !showVideo && !selecting && (
          <>
            <button onClick={() => pickTake(takeIdx - 1)} title="Previous take" className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/65 border border-white/15 flex items-center justify-center text-white hover:bg-black/85 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => pickTake(takeIdx + 1)} title="Next take" className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/65 border border-white/15 flex items-center justify-center text-white hover:bg-black/85 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
              <ChevronRight size={14} />
            </button>
          </>
        )}

        {refMenu && shot.stillUrl && (
          <AddToAssetMenu
            assets={assets}
            onPick={id => { onAddToAsset(id); setRefMenu(false); setRefState("added"); setTimeout(() => setRefState("idle"), 2000) }}
            onNew={kind => { onAddToAsset(null, kind); setRefMenu(false); setRefState("added"); setTimeout(() => setRefState("idle"), 2000) }}
            onLibrary={onAddRef ? () => { setRefMenu(false); addRef() } : undefined}
            onClose={() => setRefMenu(false)}
          />
        )}

        {/* the two jobs, on the picture (always shown on touch screens, on hover with a mouse) */}
        {!busy && !showVideo && !selecting && (
          <div className="absolute inset-x-0 bottom-0 p-1.5 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
            <button onClick={onGenerate} title={`${shot.stillUrl ? "Make the still again" : "Make the still"} with ${imageModelLabel(shot.imageModel)}${knobs.qualities.length ? ` at ${shot.imageQuality || knobs.defQuality}` : ""} - ${stillCost} tickets${knobs.maxRefs ? `, ${sent} ref${sent === 1 ? "" : "s"}` : ""}`} className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/75 border border-white/30 text-[10px] font-semibold text-white hover:bg-white/15 hover:border-white/50">
              <SiteLogoBox size={12} rounded={3} spin={false} /><span className="hidden @[210px]:inline">{shot.stillUrl ? "Redo still" : "Make still"}</span>
              <span className="flex items-center gap-0.5 font-mono text-slate-300"><Ticket size={9} />{stillCost}</span>
            </button>
            {canShoot && (
              <button onClick={onShoot} disabled={shooting} title={`${shot.videoModel} · about ${shootTickets} tickets`} className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/75 border border-fuchsia-300/45 text-[10px] font-semibold text-fuchsia-50 hover:bg-fuchsia-500/25 disabled:opacity-40">
                <SiteLogoBox size={12} rounded={3} spin={false} /><span className="hidden @[210px]:inline">{done ? "Reshoot" : "Shoot"}</span>
                <Tix n={shootTickets} className="text-fuchsia-300/90" />
              </button>
            )}
            {shot.stillUrl && (
              <button
                onClick={() => setRefMenu(m => !m)}
                disabled={refState === "adding"}
                title="Use this still as a reference: add it to an asset (or your Refs library)"
                className={`flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border text-[10px] font-semibold ${
                  refState === "added" || inRefs ? "border-white/50 text-white" : refState === "full" || refState === "failed" ? "border-red-400/50 text-red-200" : "border-white/20 text-slate-100 hover:bg-white/15 hover:border-white/40"
                }`}
              >
                {refState === "adding" ? <Loader2 size={10} className="animate-spin" /> : refState === "added" || inRefs ? <Check size={10} /> : <ImageUp size={10} />}
                <span>{refState === "added" ? "Added" : refState === "full" ? "Refs full" : refState === "failed" ? "Failed" : inRefs ? "In refs" : "Ref"}</span>
              </button>
            )}
            {shot.stillUrl && (
              <button onClick={onPlay} title="Play the animatic from here" className="ml-auto w-6 h-6 rounded-full bg-black/70 border border-white/15 flex items-center justify-center text-white">
                <Play size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* the words */}
      <div className="p-2.5 @[300px]/card:p-3.5 flex flex-col gap-1.5 @[300px]/card:gap-2">
        <div className="flex items-center gap-1.5">
          <input
            value={shot.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Shot title"
            className="flex-1 min-w-0 bg-transparent text-[12px] @[300px]/card:text-[14px] font-bold text-slate-100 focus:outline-none placeholder:text-slate-600"
          />
          <Dropdown value={String(shot.duration)} options={DURATION_OPTIONS.some(o => o.value === String(shot.duration)) ? DURATION_OPTIONS : [...DURATION_OPTIONS, { value: String(shot.duration), label: `${shot.duration}s` }]} onChange={v => onChange({ duration: Number(v) })} className="w-16" />
        </div>
        <AutoText
          value={shot.description}
          onChange={v => onChange({ description: v })}
          placeholder="What we see - one sentence"
          className="w-full bg-transparent text-[11px] @[300px]/card:text-[12.5px] leading-snug @[300px]/card:leading-relaxed text-slate-300 focus:outline-none placeholder:text-slate-600 rounded-md focus:bg-black/30 focus:ring-1 focus:ring-white/30 px-1 -mx-1"
        />
        {/* how it hands over to the next shot */}
        <div className="flex items-start gap-1.5 text-[10px] @[300px]/card:text-[11px] text-slate-500">
          <ArrowRight size={10} className="text-slate-300 shrink-0 mt-[3px]" />
          <span className="shrink-0 mt-px">{last ? "Ending" : `To ${pad2(index + 2)}`}</span>
          <AutoText value={shot.transition} onChange={v => onChange({ transition: v })} placeholder={last ? "How the film ends" : "Cut, match cut, dissolve…"} className="flex-1 min-w-0 bg-transparent text-[10.5px] @[300px]/card:text-[11.5px] leading-snug text-slate-300 focus:outline-none border-b border-transparent focus:border-white/40" />
        </div>
        {(error || (v?.status === "failed" && v.error)) && <p className="text-[10px] text-red-400 leading-snug">{error || `Shoot failed: ${v!.error}`}</p>}

        <div className="flex items-center gap-0.5 pt-1 border-t border-white/5">
          <button onClick={() => setDetails(d => !d)} className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold ${details ? "text-white bg-white/10" : "text-slate-400 hover:text-white"}`}>
            {details ? <ChevronLeft size={11} className="-rotate-90" /> : <ChevronRight size={11} className="rotate-90" />} Details
          </button>
          <span className="text-[9.5px] text-slate-600 truncate ml-1">{shot.videoModel}</span>
          <span className="ml-auto" />
          <IconBtn title="Move earlier" onClick={() => onMove(-1)} disabled={index === 0}><ChevronLeft size={13} /></IconBtn>
          <IconBtn title="Move later" onClick={() => onMove(1)} disabled={last}><ChevronRight size={13} /></IconBtn>
          <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={12} /></IconBtn>
          <IconBtn title="Delete shot" onClick={onRemove}><Trash2 size={12} /></IconBtn>
        </div>

        {details && (
          <div className="space-y-2.5 pt-1">
            {/* Edit this shot's plan with AI: change the model, rewrite a prompt for one, restyle the motion */}
            <div className="silver-edge rounded-xl p-2 space-y-1.5">
              <BrandTitle title="Edit with AI" logo={16} size="sm" />
              <AutoText
                value={aiText}
                onChange={setAiText}
                minRows={2}
                placeholder="e.g. use LTX 2.5 Fast instead · rewrite the still for NanoBanana Pro 2 · slower camera, add rain"
                className="sb-input"
              />
              <div className="flex items-center gap-1">
                {(["image", "video", "both"] as const).map(sc => (
                  <button key={sc} onClick={() => setAiScope(sc)} className={`px-2 py-1 rounded-md border text-[10px] font-semibold capitalize ${aiScope === sc ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>
                    {sc}
                  </button>
                ))}
                <BrandButton onClick={() => runAi(aiText, aiScope)} disabled={aiBusy || !aiText.trim()} busy={aiBusy} primary size="xs" className="ml-auto">Apply</BrandButton>
              </div>
              {aiNote && (
                <div className={`flex items-start gap-1.5 text-[10px] leading-snug ${aiNote.ok ? "text-emerald-300" : "text-red-300"}`}>
                  <span className="flex-1">{aiNote.text}</span>
                  {aiNote.ok && aiUndo && (
                    <button onClick={() => { onChange(aiUndo); setAiUndo(null); setAiNote({ ok: true, text: "Undone" }) }} className="shrink-0 underline text-slate-300 hover:text-white">Undo</button>
                  )}
                </div>
              )}
            </div>
            {takes.length > 1 && (
              <Field label="Takes" hint="tap one to use it">
                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5">
                  {takes.map((t, k) => (
                    <button
                      key={t.url}
                      onClick={() => pickTake(k)}
                      title={`Take ${k + 1}${t.model ? ` · ${imageModelLabel(t.model)}` : ""}${t.prompt ? `
${t.prompt.slice(0, 200)}` : ""}`}
                      className={`relative shrink-0 w-11 rounded-md overflow-hidden border ${k === takeIdx ? "border-slate-100 ring-1 ring-slate-100" : "border-white/10 opacity-70 hover:opacity-100"}`}
                      style={{ aspectRatio: aspectCss }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8.5px] font-mono text-center text-slate-200">{k + 1}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {clips.length > 0 && (
              <Field label="Clips" hint={clips.length > 1 ? "tap one to use it in the cut" : "every clip this shot gets is kept here"}>
                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5">
                  {clips.map((t, k) => (
                    <button
                      key={t.url ?? k}
                      onClick={() => k !== clipIdx && onPickVideo(t)}
                      disabled={shooting}
                      title={`Clip ${k + 1} · ${t.model} · ${t.seconds}s${t.at ? ` · ${new Date(t.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`}
                      className={`relative shrink-0 w-16 rounded-md overflow-hidden border disabled:opacity-40 ${k === clipIdx ? "border-fuchsia-200 ring-1 ring-fuchsia-200/70" : "border-white/10 opacity-70 hover:opacity-100"}`}
                      style={{ aspectRatio: aspectCss }}
                    >
                      {t.fromStill ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.fromStill} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      ) : <span className="absolute inset-0 bg-white/5" />}
                      <span className="absolute top-0.5 left-0.5 rounded bg-black/70 px-0.5 text-[8px] text-white"><Play size={7} className="inline -mt-px" /></span>
                      <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[7.5px] font-mono text-center text-slate-200 truncate px-0.5">{k + 1} · {t.model.replace(/-/g, " ")}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="Still" hint={`${stillCost} tickets`}>
              <Dropdown value={shot.imageModel} options={IMAGE_OPTIONS} onChange={v => { onChange({ imageModel: v, imageQuality: "", imageOptions: {} }); setAdapt(a => ({ ...a, image: true })) }} className="w-full" />
              {adapt.image && (
                <button onClick={() => runAi(`Rewrite the image prompt so it suits ${imageModelLabel(shot.imageModel)}, keeping what the shot shows.`, "image")} disabled={aiBusy} className="mt-1 flex items-center gap-1 text-[10px] text-slate-200 hover:text-white disabled:opacity-40">
                  {aiBusy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Rewrite the prompt for {imageModelLabel(shot.imageModel)}
                </button>
              )}
              {/* The model's own settings - resolution, quality, speed, style... -
                  whatever it offers (lib/storyboard stillSettings) */}
              {knobs.settings.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {knobs.settings.map(set => {
                    const cur = stillSettingValue(set, shot.imageQuality, shot.imageOptions)
                    return (
                      <div key={set.key}>
                        <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">{set.label}</p>
                        <div className="flex gap-1">
                          {set.options.map(opt => {
                            const on = cur === opt.value
                            return (
                              <button
                                key={opt.value}
                                onClick={() => onChange(set.key === "quality" ? { imageQuality: opt.value } : { imageOptions: { ...(shot.imageOptions ?? {}), [set.key]: opt.value } })}
                                className={`flex-1 min-w-0 truncate py-1 px-1 rounded-md border text-[10px] font-mono ${on ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                        {set.hint && <p className="text-[9px] text-slate-500 mt-0.5">{set.hint}</p>}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[9.5px] mt-1 text-slate-500">{imageModelLabel(shot.imageModel)} has no size or quality settings - it renders at its own size for the board&apos;s frame</p>
              )}
              <p className={`text-[9.5px] mt-1 ${refsInfo.on > refsInfo.max ? "text-amber-300" : "text-slate-500"}`}>
                {refsInfo.max === 0
                  ? `${imageModelLabel(shot.imageModel)} takes no references${refsInfo.on ? ` - the ${refsInfo.on} switched on are not sent` : ""}`
                  : refsInfo.on === 0
                  ? `No refs switched on (this model takes up to ${refsInfo.max})`
                  : refsInfo.on > refsInfo.max
                  ? `Sends the first ${refsInfo.max} of ${refsInfo.on} switched-on refs (this model's limit)`
                  : `Sends ${refsInfo.on} switched-on ref${refsInfo.on === 1 ? "" : "s"} (up to ${refsInfo.max})`}
              </p>
              <AutoText value={shot.imagePrompt} onChange={v => onChange({ imagePrompt: v })} minRows={3} placeholder="The full prompt for the still (leave empty to use What we see)" className="sb-input mt-1.5" />
            </Field>
            <Field label="Video">
              <Dropdown value={shot.videoModel} options={VIDEO_OPTIONS.some(o => o.value === shot.videoModel) ? VIDEO_OPTIONS : [...VIDEO_OPTIONS, { value: shot.videoModel, label: shot.videoModel }]} onChange={v => { onChange({ videoModel: v }); setAdapt(a => ({ ...a, video: true })) }} className="w-full" />
              {adapt.video && (
                <button onClick={() => runAi(`Rewrite the video prompt so it suits ${shot.videoModel}, keeping the same motion and sound.`, "video")} disabled={aiBusy} className="mt-1 flex items-center gap-1 text-[10px] text-slate-200 hover:text-white disabled:opacity-40">
                  {aiBusy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Rewrite the prompt for {shot.videoModel}
                </button>
              )}
              <AutoText value={shot.videoPrompt} onChange={v => onChange({ videoPrompt: v })} minRows={2} placeholder="What moves, how the camera moves, the sound" className="sb-input mt-1.5" />
            </Field>
            <label className="flex items-center gap-2 text-[10.5px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={!!shot.keepWhole} onChange={e => onChange({ keepWhole: e.target.checked || undefined })} className="accent-slate-300" />
              Keep the whole clip in the Final Cut
            </label>
            <div className="flex items-center gap-2 text-[9.5px] font-mono text-slate-500">
              <span>~{shootTickets} tickets to shoot</span>
              {done && v && <span className="ml-auto truncate">last shot: {v.seconds}s · {v.model}</span>}
            </div>
          </div>
        )}
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
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 border border-white/40 text-[11px] text-white flex items-center gap-1.5">
              <ArrowRight size={11} /> {shot.transition || "Cut"}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent">
            <div className="text-[11px] font-mono text-slate-200 mb-0.5">SHOT {pad2(i + 1)}{shot.title ? ` · ${shot.title}` : ""} · {shot.duration}s · {shot.videoModel}{clip ? " · SHOT" : " · STILL"}</div>
            {shot.description && <div className="text-sm text-white leading-snug">{shot.description}</div>}
            {shot.videoPrompt && <div className="text-[11px] text-slate-400 mt-1 line-clamp-2"><span className="text-slate-500">Motion: </span>{shot.videoPrompt}</div>}
          </div>
        </div>
      </div>
      {/* timeline: one segment per shot, width = its length */}
      <div className="px-4 pt-3 pb-4 space-y-3">
        <div className="flex h-10 gap-0.5 rounded-md overflow-hidden">
          {shots.map((s, k) => (
            <button key={s.id} onClick={() => goTo(k)} style={{ flexGrow: s.duration || 1 }} className={`relative basis-0 overflow-hidden ${k === i ? "ring-2 ring-slate-100 ring-inset" : "opacity-60 hover:opacity-100"}`}>
              {s.stillUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.stillUrl} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 bg-white/5" />}
              {k === i && <span className="absolute left-0 bottom-0 h-1 bg-slate-100" style={{ width: `${Math.min(100, (into / (s.duration || 1)) * 100)}%` }} />}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => goTo(i - 1)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300"><ChevronLeft size={18} /></button>
          <button onClick={() => { if (t >= total) setT(0); setPlaying(p => !p) }} className="w-11 h-11 rounded-full bg-slate-100 hover:bg-white flex items-center justify-center text-black shadow-[0_0_24px_-4px_rgba(226,232,240,0.6)]">
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <button onClick={() => goTo(i + 1)} className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300"><ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  )
}
