"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Plus, X, Loader2, Play, Pause, ChevronLeft, ChevronRight, Copy, Trash2, GripVertical,
  ImagePlus, ArrowRight, Clock, Clapperboard, Sparkles, Check, Film, ImageUp,
  Download, CircleDashed, CircleCheck, CircleX, MinusCircle, Ticket, SquareCheck, Square,
  Megaphone, Package, UserRound, Shirt, Music, Smartphone, MapPin, Lightbulb, ChevronDown, Search, Minus,
  ShoppingBag, Layers, ChevronUp, Scissors, ScanFace, Wand2, GalleryHorizontalEnd, Upload, Globe,
  Pencil, type LucideIcon,
} from "lucide-react"
import { storyboardDraftTickets } from "@/lib/ai-text-pricing"
import { BoardToAsset } from "@/components/employees/BoardToAsset"
import { SceneRefs } from "@/components/employees/SceneRefs"
import { StillThumbs, AddStillThumbs, thumbFrom, useThumb, mergeThumbs } from "@/components/employees/still-thumbs"
import { videoTicketCost } from "@/lib/ticket-pricing"
import { Dropdown } from "@/components/employees/Dropdown"
import {
  STORYBOARD_ASPECTS, STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, STORYBOARD_VIDEO_IDS, SHOOT_RESOLUTIONS, DURATIONS, MAX_SHOTS,
  newShot, totalSeconds, fmtRuntime, imageModelLabel, stillKey, MAX_STILL_VERSIONS, type StoryboardDoc, type StoryboardShot, type ShotVideo,
  stillModelSpec, stillTickets, stillSettingValue, newAsset, newAssetRef, MAX_ASSET_REFS, type StoryAsset, type AssetKind,
  BOARD_MODES, boardMode, frameLabel, type BoardModeId, MAX_DRAFT_SHOTS, TARGET_LENGTHS, runtimeRange, lengthLabel,
  FINAL_CUT_PHASES, FINAL_CUT_MAX_SHOTS, FINAL_CUT_MAX_SECONDS, NARRATOR_VOICES, DEFAULT_FINAL_CUT_OPTIONS,
  type FinalCutState, type FinalCutOptions,
  newScene, orderByScenes, ensureScenes, sceneShots, shotRefs, MAX_SCENES, type StoryScene,
  FRAMINGS, isFraming, type FramingId, liveStillJob, mergeStills, pickRefs, autoShotRefs, type ShotRef,
  stillRefUrls, editSource, SHOT_ASPECTS, finalCutExtraTickets,
} from "@/lib/storyboard"
import { AssetsPanel, AddToAssetMenu, ShotRefsPanel, uploadImage } from "@/components/employees/StoryboardAssets"
import { StillsCutPanel } from "@/components/employees/StillsCutPanel"
import { imageModelOpen, videoModelOpen } from "@/lib/storyboard-access"
import { EditImagePopup } from "@/components/image-studio/EditImagePopup"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { gateFileInput, gateUpload } from "@/components/id-verification/IdVerificationGate"

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
type DraftMode = "replace" | "polish" | "regenerate" | "extend" | "scene" | "refs"
/** A still's library record, in the shape the portal's image viewer takes. */
type StillRecord = { id: number; imageUrl: string; prompt: string; model: string; createdAt?: string; aspectRatio?: string; quality?: string; referenceImageUrls?: string[]; videoMetadata?: Record<string, unknown> }

const ASPECT_CSS: Record<string, string> = { "16:9": "16/9", "9:16": "9/16", "1:1": "1/1", "4:3": "4/3", "3:4": "3/4", "21:9": "21/9" }
/*
 * The models an account can pick (public 2026-10-07): admin-only ones stay
 * off a non-admin's menus - the routes refuse them anyway (lib/storyboard-access).
 * A shot already on one (an old board) keeps it listed, so the menu shows it.
 */
const imageOptions = (isAdmin: boolean, current?: string) => {
  const list = STORYBOARD_IMAGE_MODELS.filter(m => imageModelOpen(m.id, isAdmin)).map(m => ({ value: m.id, label: m.label }))
  return current && !list.some(o => o.value === current) ? [...list, { value: current, label: `${imageModelLabel(current)} (admin)` }] : list
}
const videoOptions = (isAdmin: boolean, current?: string) => {
  const list = STORYBOARD_VIDEO_MODELS.filter(m => videoModelOpen(m, isAdmin)).map(m => ({ value: m as string, label: m as string }))
  return current && !list.some(o => o.value === current) ? [...list, { value: current, label: current }] : list
}
const DURATION_OPTIONS = DURATIONS.map(d => ({ value: String(d), label: `${d}s` }))
const ASPECT_OPTIONS = STORYBOARD_ASPECTS.map(a => ({ value: a, label: a }))
const RES_OPTIONS = SHOOT_RESOLUTIONS.map(r => ({ value: r, label: r }))
const pad2 = (n: number) => String(n).padStart(2, "0")
const MODE_ICONS: Record<BoardModeId, LucideIcon> = {
  story: Clapperboard, trailer: Film, ad: Megaphone, product: Package, character: UserRound, face: ScanFace,
  lookbook: Shirt, outfit: ShoppingBag, music: Music, social: Smartphone, location: MapPin, explainer: Lightbulb,
}
/** A ticket count, as it sits on a button. */
function Tix({ n, approx, className = "" }: { n: number; approx?: boolean; className?: string }) {
  return <span className={`inline-flex items-center gap-0.5 font-mono ${className}`}><Ticket size={9} />{approx ? "~" : ""}{n}</span>
}

/**
 * A request that never throws: a failed one comes back as { ok: false }.
 * The browser cancels requests on its own - an iPad sleeping, Safari
 * suspending the tab, Wi-Fi dropping, the dev server reloading - and an
 * unguarded one surfaced as "Runtime AbortError: The operation was aborted",
 * which on the dev server takes over the whole screen. Every studio request
 * that is not already guarded goes through here.
 */
async function getJson<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const r = await fetch(url, init)
    const data = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
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
  try { return videoTicketCost({ model, duration: String(s.duration), resolution, generateAudio: true, sd20Mode: "i2v", hasStartImage: true }) } catch { return 0 }
}

export function StoryboardWorkspace({
  signedIn,
  activeRefs,
  refLibrary,
  onAddRef,
  onOpenStill,
  isAdmin = false,
}: {
  signedIn: boolean
  /** An admin account: every model, and the admin-only actions (a cut onto a home card). */
  isAdmin?: boolean
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
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map())
  const addThumbs = useCallback((pairs: [string, string][]) => setThumbs(prev => mergeThumbs(prev, pairs)), [])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  /*
   * Stills waiting their turn in a batch ("Make 10" runs three at a time).
   * They show as queued at once, so a shot that is already on its way is
   * never offered - and never charged - twice. The refs are the same sets for
   * the guards, which must not wait for a render.
   */
  const [queued, setQueued] = useState<Record<string, boolean>>({})
  const queuedRef = useRef<Set<string>>(new Set())
  const makingRef = useRef<Set<string>>(new Set())
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
  // "Make an asset" from the board's stills (components/employees/BoardToAsset)
  const [assetFromBoard, setAssetFromBoard] = useState(false)
  const [boardNote, setBoardNote] = useState<string | null>(null)
  // The Stills cut panel (null = closed; "" = the whole board, else a scene id)
  const [stillsCut, setStillsCut] = useState<string | null>(null)
  // The shot whose still is open in the Image Studio popup
  const [studioShot, setStudioShot] = useState<string | null>(null)
  const [fcOptions, setFcOptions] = useState<FinalCutOptions>(DEFAULT_FINAL_CUT_OPTIONS)
  const [fcError, setFcError] = useState<string | null>(null)
  const [fcVersion, setFcVersion] = useState<number | null>(null)
  // Scenes: how many a new board is planned in, which are folded away, and
  // which scene the Final Cut window is cutting (null = the whole board)
  const [sceneCount, setSceneCount] = useState("1")
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [fcScene, setFcScene] = useState<string | null>(null)
  const [batchScene, setBatchScene] = useState<string | null>(null)
  const [draftScene, setDraftScene] = useState<string | null>(null)
  // Scenes on one continuous page, or one scene at a time (its own page)
  const [sceneView, setSceneView] = useState<"all" | "one">(() => { try { return localStorage.getItem("pv2-storyboard-view") === "one" ? "one" : "all" } catch { return "all" } })
  const [pageScene, setPageScene] = useState<string | null>(null)
  // Waist up / full body / mix: a draft setting, remembered per board on this device
  const [framing, setFramingState] = useState<FramingId>("mix")
  const activeRefKeys = useMemo(() => new Set(activeRefs.map(r => stillKey(r.url))), [activeRefs])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boardRef = useRef<StoryboardDoc | null>(null)
  useEffect(() => { boardRef.current = board }, [board])

  // ── loading ──
  const loadList = useCallback(async () => {
    const r = await getJson<{ storyboards?: BoardSummary[] }>("/api/employees/storyboards")
    // A failed read keeps the list the page already has
    if (!r.ok || !r.data) return [] as BoardSummary[]
    setBoards(r.data.storyboards ?? [])
    return r.data.storyboards ?? []
  }, [])
  const open = useCallback(async (id: number) => {
    const r = await getJson<{ storyboard?: StoryboardDoc; thumbs?: [string, string][] }>(`/api/employees/storyboards/${id}`)
    const storyboard = r.data?.storyboard
    if (!r.ok || !storyboard) return
    setThumbs(prev => mergeThumbs(prev, r.data?.thumbs))
    setBoard({ ...storyboard, shots: storyboard.shots ?? [], assets: storyboard.assets ?? [], scenes: storyboard.scenes ?? [], mode: boardMode(storyboard.mode).id })
    setShotError({})
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    setSelected([]); setSelecting(false); setFocusId(null)
    try { localStorage.setItem("pv2-storyboard", String(id)) } catch {}
    try { const f = localStorage.getItem(`pv2-storyboard-framing-${id}`); setFramingState(isFraming(f) ? f : "mix") } catch { setFramingState("mix") }
    const fc = await fetch(`/api/employees/storyboards/${id}/final-cut`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    // Only if this board is still the one open - a slow answer for the board
    // just left would otherwise show its cuts on the next one
    if (fc?.finalCut && boardRef.current?.id === id) setFinalCut(fc.finalCut)
  }, [])
  const create = useCallback(async () => {
    const r = await getJson<{ storyboard?: StoryboardDoc }>("/api/employees/storyboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    const storyboard = r.data?.storyboard
    if (!r.ok || !storyboard) return
    await loadList()
    // A new board has no cuts and no errors: clear the previous board's, or its
    // Final Cuts keep showing in the screening room of the empty board
    setBoard({ ...storyboard, shots: storyboard.shots ?? [], assets: storyboard.assets ?? [], scenes: storyboard.scenes ?? [], mode: boardMode(storyboard.mode).id })
    setShotError({})
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    setSelected([]); setSelecting(false); setFocusId(null)
    try { localStorage.setItem("pv2-storyboard", String(storyboard.id)) } catch {}
  }, [loadList])
  useEffect(() => {
    if (!signedIn) return
    ;(async () => {
      // However the loads go, the spinner ends - a failed first read used to leave it spinning
      try {
        const list = await loadList()
        let last: number | null = null
        try { last = Number(localStorage.getItem("pv2-storyboard")) || null } catch {}
        const pick = list.find(b => b.id === last) ?? list[0]
        if (pick) await open(pick.id)
      } finally {
        setLoading(false)
      }
    })()
  }, [signedIn, loadList, open])

  // ── saving (debounced; the whole board is one document) ──
  const flush = useCallback(async () => {
    const b = boardRef.current
    if (!b) return
    setSaveState("saving")
    const r = await fetch(`/api/employees/storyboards/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: b.title, story: b.story, look: b.look, aspect: b.aspect, shots: b.shots, assets: b.assets, mode: b.mode, scenes: b.scenes }),
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
    // Shots always live in a scene - the first shot on an empty board makes Scene 1
    setBoard(b => (b ? ensureScenes(fn(b)) : b))
    setSaveState("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 700)
  }, [flush])
  // Leaving the board (tab switch, unmount) saves what is pending first
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); flush() } }, [flush])

  const setShot = (id: string, patch: Partial<StoryboardShot>) => update(b => ({ ...b, shots: b.shots.map(s => s.id === id ? { ...s, ...patch } : s) }))
  // A shot moved onto another's place takes that shot's scene - so dragging
  // (or stepping) across a scene's edge moves it into the next scene
  const moveShot = (from: number, to: number) => update(b => {
    if (to < 0 || to >= b.shots.length || from === to) return b
    const shots = [...b.shots]
    const into = shots[to].sceneId
    const [s] = shots.splice(from, 1)
    shots.splice(to, 0, into ? { ...s, sceneId: into } : s)
    return { ...b, shots }
  })
  /** A shot dropped on a scene's "Add shot" tile: to the end of that scene. */
  const moveShotToScene = (from: number, sceneId: string) => update(b => {
    const s = b.shots[from]
    if (!s) return b
    return { ...b, shots: orderByScenes([...b.shots.filter((_, i) => i !== from), { ...s, sceneId }], b.scenes) }
  })
  /** A new shot at the end of a scene (or of the board), carrying on the last shot's models. */
  const addShot = (sceneId?: string) => update(b => {
    if (b.shots.length >= MAX_SHOTS) return b
    const scene = sceneId ?? b.scenes.at(-1)?.id
    const prev = (scene ? sceneShots(b.shots, scene) : b.shots).at(-1) ?? b.shots.at(-1)
    return { ...b, shots: orderByScenes([...b.shots, newShot({ imageModel: prev?.imageModel, videoModel: prev?.videoModel, sceneId: scene })], b.scenes) }
  })
  // ── scenes ──
  /** A new, empty scene at the end - shown at once when scenes are paged. */
  const addScene = () => {
    const b = boardRef.current
    if (!b || b.scenes.length >= MAX_SCENES) return
    const c = newScene()
    update(x => ({ ...x, scenes: [...x.scenes, c] }))
    setPageScene(c.id)
  }
  const setScene = (id: string, patch: Partial<StoryScene>) => update(b => ({ ...b, scenes: b.scenes.map(c => (c.id === id ? { ...c, ...patch } : c)) }))
  const moveScene = (id: string, d: -1 | 1) => update(b => {
    const i = b.scenes.findIndex(c => c.id === id)
    const j = i + d
    if (i < 0 || j < 0 || j >= b.scenes.length) return b
    const scenes = [...b.scenes]
    ;[scenes[i], scenes[j]] = [scenes[j], scenes[i]]
    return { ...b, scenes, shots: orderByScenes(b.shots, scenes) }
  })
  /** A scene removed: its shots join the scene before it (none left = a board without scenes). */
  const removeScene = (id: string) => update(b => {
    const i = b.scenes.findIndex(c => c.id === id)
    if (i < 0) return b
    const rest = b.scenes.filter(c => c.id !== id)
    // The only scene goes only when it is empty (shots always live in a scene)
    if (!rest.length) return b.shots.length ? b : { ...b, scenes: [] }
    const into = rest[Math.max(0, i - 1)].id
    return { ...b, scenes: rest, shots: orderByScenes(b.shots.map(x => (x.sceneId === id ? { ...x, sceneId: into } : x)), rest) }
  })
  const duplicateShot = (i: number) => update(b => {
    if (b.shots.length >= MAX_SHOTS) return b
    const shots = [...b.shots]
    shots.splice(i + 1, 0, newShot({ ...b.shots[i], id: undefined }))
    return { ...b, shots }
  })
  /**
   * A blank shot right before or after shot i - in the same scene, carrying its
   * models (the board's list is in scene order, so a neighbour's place is the
   * right place). It flashes so it's easy to find.
   */
  const insertShot = (i: number, side: "before" | "after") => {
    const b = boardRef.current
    if (!b || b.shots.length >= MAX_SHOTS) return
    const at = b.shots[i]
    const fresh = newShot({ imageModel: at?.imageModel, videoModel: at?.videoModel, sceneId: at?.sceneId })
    update(cur => {
      const shots = [...cur.shots]
      const k = cur.shots.findIndex(s => s.id === at?.id)
      shots.splice(k < 0 ? shots.length : side === "before" ? k : k + 1, 0, fresh)
      return { ...cur, shots }
    })
    setFlashIds([fresh.id])
    setTimeout(() => setFlashIds([]), 3000)
  }
  const removeShot = (id: string) => update(b => ({ ...b, shots: b.shots.filter(s => s.id !== id) }))

  // ── stills ──
  const generateStill = useCallback(async (shot: StoryboardShot) => {
    const b = boardRef.current
    if (!b) return
    const prompt = (shot.imagePrompt || shot.description).trim()
    if (!prompt) { setShotError(e => ({ ...e, [shot.id]: "Write what we see or an image prompt first" })); return }
    // Already being made: a second press must not make (and charge) it twice
    if (makingRef.current.has(shot.id)) return
    makingRef.current.add(shot.id)
    // The server tracks the slot, so it must have it: pending edits go first
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    // Its turn has come: no longer waiting, now making
    if (queuedRef.current.delete(shot.id)) setQueued(q => { const n = { ...q }; delete n[shot.id]; return n })
    setBusy(x => ({ ...x, [shot.id]: true }))
    setShotError(e => { const n = { ...e }; delete n[shot.id]; return n })
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/still`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Its "before" picture and the still it edits first, then its own refs
        // (a turn from each asset) - as many as this still's model takes
        body: JSON.stringify({
          prompt, model: shot.imageModel, quality: shot.imageQuality || undefined, shotId: shot.id,
          options: shot.imageOptions,
          refs: stillRefUrls(b, shot, stillModelSpec(shot.imageModel).maxRefs),
        }),
      })
      const j = await r.json().catch(() => ({}))
      // Another tab or device is making this one: not an error - the board's
      // own state shows it, and the still arrives with the next poll
      if (r.status === 409 && j.busy) return
      if (!r.ok || !j.url) throw new Error(j.error || "The still failed")
      // Only if this board is still the one open. The new take is added to the
      // slot's versions (read from the CURRENT shot, not this closure's copy),
      // so the one it replaces stays a tap away
      if (boardRef.current?.id === b.id) update(cur => ({
        ...cur,
        shots: cur.shots.map(s => s.id !== shot.id ? s : {
          ...s,
          stillUrl: j.url,
          stillJob: null,
          imagePrompt: s.imagePrompt || prompt,
          stills: [...(s.stills ?? []), { url: j.url, prompt, model: shot.imageModel, at: Date.now() }].slice(-MAX_STILL_VERSIONS),
        }),
      }))
    } catch (e: any) {
      setShotError(x => ({ ...x, [shot.id]: String(e?.message || e) }))
    } finally {
      makingRef.current.delete(shot.id)
      setBusy(x => { const n = { ...x }; delete n[shot.id]; return n })
    }
  // update / flush are stable; the board is read from boardRef
  }, [update, flush])
  /*
   * An edit from the Image Studio popup becomes the shot's still: a new take
   * (the one it replaces stays), saved in the board's folder by the still
   * route. The popup hands over a flattened JPEG data URL; a big one is
   * scaled to fit a request (Vercel takes ~4.5 MB).
   */
  const adoptStudioEdit = useCallback(async (shotId: string, dataUrl: string) => {
    const b = boardRef.current
    if (!b) return
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    setBusy(x => ({ ...x, [shotId]: true }))
    setShotError(e => { const n = { ...e }; delete n[shotId]; return n })
    try {
      let data = dataUrl
      if (data.length > 3_200_000) {
        const img = new Image()
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Could not read the edit")); img.src = data })
        const k = Math.min(1, 3072 / Math.max(img.width, img.height))
        const c = document.createElement("canvas")
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
        data = c.toDataURL("image/jpeg", 0.88)
      }
      const r = await fetch(`/api/employees/storyboards/${b.id}/still`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adopt: data, shotId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || "Could not keep the edit")
      if (boardRef.current?.id === b.id) update(cur => ({
        ...cur,
        shots: cur.shots.map(s => s.id !== shotId ? s : {
          ...s, stillUrl: j.url, stillJob: null,
          stills: [...(s.stills ?? []), { url: j.url, prompt: "Edited in the Image Studio", model: "image-studio-edit", at: Date.now() }].slice(-MAX_STILL_VERSIONS),
        }),
      }))
    } catch (e: any) {
      setShotError(x => ({ ...x, [shotId]: String(e?.message || e) }))
    } finally {
      setBusy(x => { const n = { ...x }; delete n[shotId]; return n })
    }
  }, [update, flush])
  /** Make every missing still - on the board, or in one scene. */
  const generateMissing = async (sceneId?: string) => {
    const b = boardRef.current
    if (!b) return
    // Not the ones already being made or waiting in another batch
    const todo = b.shots.filter(s => !s.stillUrl && (s.imagePrompt || s.description).trim() && (!sceneId || s.sceneId === sceneId)
      && !makingRef.current.has(s.id) && !queuedRef.current.has(s.id) && !liveStillJob(s.stillJob))
    await runStills(todo, sceneId)
  }
  /*
   * Run stills three at a time, every one shown as queued until its turn -
   * here AND on the server, so a refresh or another session shows the same
   * queue (and a page that finds queued stills nobody is running picks them
   * up: see the resume effect).
   */
  const runStills = async (todo: StoryboardShot[], sceneId?: string) => {
    const b = boardRef.current
    if (!b || !todo.length) return
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    // Queued on the server BEFORE any starts: a late "queue" landing after a
    // still had finished would put that slot back in the queue (and make it again)
    await getJson(`/api/employees/storyboards/${b.id}/still`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queue: todo.map(s => s.id) }),
    })
    if (sceneId) setBatchScene(sceneId); else setBatch(true)
    // Every one of them shows as queued now, not just the three that start
    for (const s of todo) queuedRef.current.add(s.id)
    setQueued(q => ({ ...q, ...Object.fromEntries(todo.map(s => [s.id, true])) }))
    let i = 0
    try {
      await Promise.all(Array.from({ length: 3 }, async () => { while (i < todo.length) await generateStill(todo[i++]) }))
    } finally {
      // Anything never started (the board was left mid-batch) stops waiting
      for (const s of todo) queuedRef.current.delete(s.id)
      setQueued(q => { const n = { ...q }; for (const s of todo) delete n[s.id]; return n })
      if (sceneId) setBatchScene(null); else setBatch(false)
    }
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
      // The body can be cut off mid-read too (a tab put to sleep) - that is a missed poll, not an error
      const j = r?.ok ? await r.json().catch(() => null) : null
      if (j && boardRef.current?.id === boardId) mergeVideos(j.videos ?? {}, j.takes)
    }, 8000)
    const tick = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [rendering, boardId, mergeVideos])
  /*
   * Stills in flight are the server's to report (shot.stillJob, written by the
   * still route): while any is queued or being made - by this page, another
   * tab or another device - the board is re-read every 5s and the server's
   * still state merged in: the job, the takes, and a still that landed. Not
   * an edit, so nothing is autosaved.
   */
  const stillsPending = !!board?.shots.some(s => { const j = liveStillJob(s.stillJob); return j?.status === "making" || j?.status === "queued" })
  const mergeStillState = useCallback((server: StoryboardShot[]) => {
    const byId = new Map(server.map(s => [s.id, s]))
    setBoard(b => b && ({
      ...b,
      shots: b.shots.map(s => {
        const sv = byId.get(s.id)
        if (!sv) return s
        const known = new Set((s.stills ?? []).map(v => stillKey(v.url)))
        // A still the server put on the slot that this page has never seen: show it
        const landed = !!sv.stillUrl && sv.stillUrl !== s.stillUrl && !known.has(stillKey(sv.stillUrl))
        return { ...s, stillJob: sv.stillJob ?? null, stills: mergeStills(s.stills, sv.stills), ...(landed ? { stillUrl: sv.stillUrl, imagePrompt: s.imagePrompt || sv.imagePrompt } : {}) }
      }),
    }))
  }, [])
  useEffect(() => {
    if (!stillsPending || !boardId) return
    const poll = setInterval(async () => {
      const r = await getJson<{ storyboard?: StoryboardDoc; thumbs?: [string, string][] }>(`/api/employees/storyboards/${boardId}`)
      if (r.data?.storyboard && boardRef.current?.id === boardId) mergeStillState(r.data.storyboard.shots ?? [])
      if (r.data?.thumbs) setThumbs(prev => mergeThumbs(prev, r.data?.thumbs))
    }, 5000)
    return () => clearInterval(poll)
  }, [stillsPending, boardId, mergeStillState])
  /*
   * Queued stills nobody is running - the page that queued them was refreshed
   * or closed - are picked up here once they have waited 30s (a page still
   * running its batch gets to them first). The still route claims each slot,
   * so two pages picking up the same queue never make a still twice.
   */
  const orphanSig = board ? board.shots.filter(s => liveStillJob(s.stillJob)?.status === "queued").map(s => s.id).join(",") : ""
  useEffect(() => {
    if (!orphanSig) return
    const t = setTimeout(() => {
      const b = boardRef.current
      if (!b) return
      const now = Date.now()
      const orphans = b.shots.filter(s => {
        const j = liveStillJob(s.stillJob)
        return j?.status === "queued" && now - j.at > 30_000 && !makingRef.current.has(s.id) && !queuedRef.current.has(s.id)
      })
      if (orphans.length) runStills(orphans)
    }, 31_000)
    return () => clearTimeout(t)
  // runStills reads the board from boardRef; only the queued set matters here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphanSig])

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
      body: JSON.stringify({ action, ...(action === "start" ? { options: { ...fcOptions, resolution: shootRes }, sceneId: fcScene } : {}) }),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setFcError(j.error || "Could not start the Final Cut"); return }
    setFinalCut(j.finalCut)
    if (action === "start") setFcOpen(false)
  }

  // ── drafting with AI ──
  // replace: a whole new board. polish / regenerate / extend act on the picked
  // shots (none picked = all of them) and leave every other slot as it is.
  /*
   * `scene` drafts new shots into one scene, from the scene header - its own
   * direction and count, its own refs. Returns the error, if any, for the
   * caller to show where the request was made.
   */
  const draft = async (mode: DraftMode, sc?: { sceneId: string; count: number; direction: string }): Promise<string | null> => {
    const b = boardRef.current
    if (!b) return null
    if (mode === "replace" && b.shots.length > 0 && !confirmReplace) { setConfirmReplace(true); return null }
    setConfirmReplace(false)
    setDrafting(mode)
    if (sc) setDraftScene(sc.sceneId)
    setDraftError(null)
    let failed: string | null = null
    // The server merges into what is SAVED, so pending edits go first
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; await flush() }
    const shotIds = selected.filter(id => b.shots.some(s => s.id === id))
    try {
      const r = await fetch(`/api/employees/storyboards/${b.id}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, boardMode: b.mode, framing, premise: sc ? sc.direction : premise, shots: Number(shotCount), targetSeconds: Number(targetLen), shotIds,
          extendCount: sc ? sc.count : Number(extendCount), scenes: Number(sceneCount), sceneId: sc?.sceneId,
          // A scene draft sees its cast; otherwise the server shows the planner every asset
          refs: sc ? shotRefs(b, { sceneId: sc.sceneId }).slice(0, 4).map(x => x.url) : [],
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "Drafting failed")
      if (boardRef.current?.id !== b.id) return null
      update(cur => ({
        ...cur,
        title: cur.title === "Untitled storyboard" && j.title ? j.title : cur.title,
        story: j.story || cur.story,
        look: j.look || cur.look,
        shots: Array.isArray(j.shots) && j.shots.length ? j.shots : cur.shots,
        scenes: Array.isArray(j.scenes) ? j.scenes : cur.scenes,
      }))
      // Show what changed for a moment; extended shots become the selection
      const changed: string[] = Array.isArray(j.changed) ? j.changed : []
      setFlashIds(changed)
      setTimeout(() => setFlashIds([]), 4000)
      if (mode === "extend") setSelected(changed)
      if (mode === "replace") { setSelected([]); setSelecting(false); setCollapsed([]) }
    } catch (e: any) {
      failed = String(e?.message || e)
      if (!sc) setDraftError(failed)
    } finally {
      setDrafting(false)
      setDraftScene(null)
    }
    return failed
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
    const del = await getJson(`/api/employees/storyboards/${board.id}`, { method: "DELETE" })
    if (!del.ok) return
    const list = await loadList()
    setBoard(null)
    setFinalCut({ job: null, versions: [] })
    setFcVersion(null)
    if (list[0]) await open(list[0].id)
  }

  const seconds = board ? totalSeconds(board.shots) : 0
  const stillCount = board ? board.shots.filter(s => s.stillUrl).length : 0
  /*
   * What the bulk buttons count leaves out the work already under way: a
   * still being made one at a time (or queued, here or on the server), a shot
   * whose shoot request is still starting. They counted it before - "Make 10"
   * with 2 already making - and Shoot / the Final Cut estimate could send a
   * starting shot a second time.
   */
  const stillBusy = (s: StoryboardShot) => !!busy[s.id] || makingRef.current.has(s.id) || queuedRef.current.has(s.id) || !!liveStillJob(s.stillJob)
  const needsStill = (s: StoryboardShot) => !s.stillUrl && !!(s.imagePrompt || s.description).trim()
  const missing = board ? board.shots.filter(s => needsStill(s) && !stillBusy(s)).length : 0
  const stillsMaking = board ? board.shots.filter(s => needsStill(s) && stillBusy(s)).length : 0
  const toShoot = board ? board.shots.filter(s => shootable(s) && s.video?.status !== "done" && !busy[s.id]) : []
  const shootTickets = toShoot.reduce((a, s) => a + shotTickets(s, shootRes), 0)
  const shotCountDone = board ? board.shots.filter(s => s.video?.status === "done").length : 0
  // The Final Cut's own cost on top of any shots it has to shoot: the edit plan
  // and cards (~$0.20), the score (~$0.01/s), narration (pennies)
  // The Final Cut's shots: the whole board, or the scene its window was opened for
  const fcSceneDoc = board && fcScene ? board.scenes.find(c => c.id === fcScene) ?? null : null
  const fcShots = board ? (fcSceneDoc ? sceneShots(board.shots, fcSceneDoc.id) : board.shots) : []
  const fcSeconds = totalSeconds(fcShots)
  const fcShootUsd = fcShots.filter(s => !(s.video?.status === "done" && s.video.url) && s.video?.status !== "rendering" && !busy[s.id]).reduce((a, s) => a + shotTickets(s, shootRes), 0) * 0.04

  // The same in tickets: shots at their ticket price, the rest at the $0.04 of
  // fal cost a ticket covers (lib/ticket-pricing's margin rule)
  const fcShootTickets = Math.round(fcShootUsd / 0.04)
  // The route charges exactly this at the start (lib/storyboard finalCutExtraTickets)
  const fcExtraTickets = finalCutExtraTickets(fcOptions, fcSeconds)
  const fcTickets = fcShootTickets + fcExtraTickets
  const cutAScene = board && board.scenes.length > 1 && !fcSceneDoc ? " - cut it a scene at a time" : ""
  const fcBlocked = board ? (fcShots.length === 0 ? (fcSceneDoc ? "This scene has no shots yet" : "Add shots first")
    : fcShots.length > FINAL_CUT_MAX_SHOTS ? `Up to ${FINAL_CUT_MAX_SHOTS} shots for now${cutAScene}`
    : fcSeconds > FINAL_CUT_MAX_SECONDS ? `Up to ${FINAL_CUT_MAX_SECONDS}s for now${cutAScene}`
    : fcShots.some(s => !s.stillUrl) ? "Every shot needs its still first" : null) : null
  const shownVersion = finalCut.versions.find(v => v.n === fcVersion) ?? finalCut.versions.at(-1) ?? null
  const aspectCss = ASPECT_CSS[board?.aspect ?? "16:9"] ?? "16/9"
  const portrait = board ? ["9:16", "3:4"].includes(board.aspect) : false
  // Stills: what making the missing ones costs (each at its own model + quality)
  const missingShots = board ? board.shots.filter(s => needsStill(s) && !stillBusy(s)) : []
  // What one still costs: its model, quality and frame, with the refs its scene sends
  const stillPrice = (s: StoryboardShot) => board ? stillTickets(s.imageModel, s.imageQuality, s.aspect || board.aspect, s.imageOptions, stillRefUrls(board, s, stillModelSpec(s.imageModel).maxRefs).length) : 0
  const missingTickets = missingShots.reduce((t, s) => t + stillPrice(s), 0)
  // The assets' ref limit follows the shot being worked on (else the first shot)

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
  // What a Draft-with-AI job costs (lib/ai-text-pricing - the route charges the same)
  const pickedN = board ? (selected.filter(id => board.shots.some(s => s.id === id)).length || board.shots.length) : 0
  const draftPrice = (mode: DraftMode) => mode === "extend" ? storyboardDraftTickets("extend", Number(extendCount) || 2) : storyboardDraftTickets(mode, pickedN)
  const draftBtn = (mode: DraftMode, label: string, title: string) =>
    brandBtn({ onClick: () => draft(mode), disabled: !!drafting, busy: drafting === mode, label: <>{label}<TicketChip n={draftPrice(mode)} /></>, title: `${title} - ${draftPrice(mode)} ticket${draftPrice(mode) === 1 ? "" : "s"}`, className: "flex-1 min-w-0" })
  const shotsN = Number(shotCount) || 1
  const lenRange = runtimeRange(shotsN)
  const targetN = Number(targetLen) || 0
  // A target these shots cannot reach: say so (the server keeps it in range)
  const lenWarn = targetN > lenRange.max ? `${shotsN} shot${shotsN === 1 ? "" : "s"} run at most ${lengthLabel(lenRange.max)} - add shots for ${lengthLabel(targetN)}`
    : targetN > 0 && targetN < lenRange.min ? `${shotsN} shots run at least ${lengthLabel(lenRange.min)} - use fewer shots for ${lengthLabel(targetN)}`
    : null
  const setTarget = (v: string) => { setTargetLen(v); try { localStorage.setItem("pv2-storyboard-target", v) } catch {} }
  // An outfit pack plans a scene per Wardrobe asset; `shots` is per outfit
  const outfitMode = board?.mode === "outfit"
  const outfitAssets = board ? board.assets.filter(a => a.kind === "wardrobe") : []
  const scenesN = Math.max(1, Number(sceneCount) || 1)
  const newBoardRow = board && (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">{outfitMode ? "Shots per outfit" : "Shots"}</span>
          <NumberStepper value={shotsN} min={1} max={outfitMode ? 12 : MAX_DRAFT_SHOTS} onChange={n => setShotCount(String(n))} />
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
      {outfitMode ? (
        <p className={`text-[9.5px] leading-snug ${outfitAssets.length ? "text-slate-400" : "text-amber-300"}`}>
          {outfitAssets.length
            ? `${outfitAssets.length} outfit${outfitAssets.length === 1 ? "" : "s"} (Wardrobe assets) × ${shotsN} = ${Math.min(36, outfitAssets.length * shotsN)} shots - one scene per outfit, each made from its own photos, no people`
            : "Add each outfit as a Wardrobe asset with its photos (below), or describe them above - each gets its own scene"}
        </p>
      ) : (
        <label className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500 shrink-0">Scenes</span>
          <NumberStepper value={scenesN} min={1} max={Math.min(MAX_SCENES, shotsN)} onChange={n => setSceneCount(String(n))} className="w-[104px] shrink-0" />
          <span className="text-[9.5px] text-slate-500 leading-snug">{scenesN > 1 ? `${shotsN} shots across ${scenesN} scenes` : "one run of shots"}</span>
        </label>
      )}
      <p className={`text-[9.5px] leading-snug ${lenWarn ? "text-amber-300" : "text-slate-500"}`}>
        {lenWarn ?? (targetN
          ? `${shotsN} shot${shotsN === 1 ? "" : "s"} adding up to ${lengthLabel(targetN)} - about ${Math.round(targetN / shotsN)}s each`
          : `Auto: the AI sets each shot's length for a ${boardMode(board.mode).label.toLowerCase()}`)}
      </p>
      {brandBtn({
        onClick: () => draft("replace"),
        disabled: !!drafting || (!premise.trim() && !(outfitMode && outfitAssets.length)),
        busy: drafting === "replace",
        primary: true,
        className: "w-full",
        size: "md",
        label: <>{confirmReplace ? `Replace ${board.shots.length} shots?` : board.shots.length ? "Draft new board" : "Draft the board"}<TicketChip n={storyboardDraftTickets("replace", outfitMode ? Math.min(36, shotsN * Math.max(1, outfitAssets.length)) : shotsN, { withImages: outfitMode && outfitAssets.length > 0 })} /></>,
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
              {drafting === "replace" ? "Writing the board…" : drafting === "polish" ? "Polishing…" : drafting === "regenerate" ? "Rewriting…" : drafting === "scene" ? "Drafting the scene…" : drafting === "refs" ? "Matching references…" : "Extending…"}
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
              {/* how the characters are framed - for the kinds with people in them */}
              {m.framing && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500 shrink-0">Framing</span>
                  <div className="flex-1 grid grid-cols-3 rounded-lg border border-white/10 bg-black/30 p-0.5">
                    {FRAMINGS.map(f => (
                      <button
                        key={f.id}
                        title={f.hint}
                        onClick={() => { setFramingState(f.id); try { localStorage.setItem(`pv2-storyboard-framing-${board.id}`, f.id) } catch {} }}
                        className={`px-1.5 py-1 rounded-md text-[10.5px] font-semibold transition-colors ${framing === f.id ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {m.framing && framing !== "mix" && (
                <p className="-mt-0.5 pl-[58px] text-[9.5px] leading-snug text-slate-500">{FRAMINGS.find(f => f.id === framing)?.hint}</p>
              )}
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
            {/* pick each shot's references from the assets - for shots added by hand, or assets added later */}
            {board.assets.some(a => a.refs.length > 0) && draftBtn("refs", "Match references", "Give each shot the references of the assets its frame shows - nothing else changes")}
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
    <StillThumbs.Provider value={thumbs}>
    <AddStillThumbs.Provider value={addThumbs}>
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
                {board.scenes.length > 0 && <span className="inline-flex items-center gap-1"><Layers size={10} />{board.scenes.length} scene{board.scenes.length === 1 ? "" : "s"}</span>}
                <span className="inline-flex items-center gap-1"><Film size={10} />{n} shot{n === 1 ? "" : "s"}</span>
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
                <BrandButton onClick={() => generateMissing()} disabled={batch || missing === 0} busy={batch} primary={nextStep === "stills"} size="xs">
                  {missing ? `Make ${missing}` : stillsMaking ? `Making ${stillsMaking}` : "All made"}
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
                <BrandButton onClick={() => { setFcScene(null); setFcOpen(true) }} disabled={fcRunning} busy={fcRunning} primary={nextStep === "cut"} size="xs">
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
              <button
                onClick={() => setStillsCut("")}
                disabled={stillCount === 0}
                title="The board as a film of its stills - push-ins, edit wipes, before/after, AI-placed captions; for a home card, social or YouTube"
                className="silver-edge shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 rounded-xl text-slate-200 hover:text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <GalleryHorizontalEnd size={14} />
                <span className="text-[9.5px] font-semibold whitespace-nowrap">Stills cut</span>
              </button>
              <button
                onClick={() => setAssetFromBoard(true)}
                disabled={stillCount === 0}
                title="Turn the board's stills into a saved asset (My Assets) - pick the shots scene by scene; each picture is described from its shot"
                className="silver-edge shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 rounded-xl text-slate-200 hover:text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Package size={14} />
                <span className="text-[9.5px] font-semibold whitespace-nowrap">Make asset</span>
              </button>
            </div>
          </div>

          {boardNote && (
            <div className="mx-3 sm:mx-4 mt-2 flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-1.5 text-[11.5px] text-emerald-100">
              <span className="flex-1">{boardNote}</span>
              <button onClick={() => setBoardNote(null)} className="text-emerald-200/60 hover:text-white" aria-label="Dismiss"><X size={12} /></button>
            </div>
          )}
          {assetFromBoard && board && (
            <BoardToAsset board={board} onClose={() => setAssetFromBoard(false)} onSaved={msg => { setBoardNote(msg); setTimeout(() => setBoardNote(n => (n === msg ? null : n)), 8000) }} />
          )}

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
              />
              {/* the board's own scenes, switchable as references for the AI draft */}
              <SceneRefs scenes={board.scenes} shots={board.shots} onChange={fn => update(b => ({ ...b, scenes: fn(b.scenes) }))} />
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

              {(() => {
                // The server's word on a slot's still (queued / making / failed), from any session
                const jobOf = (shot: StoryboardShot) => liveStillJob(shot.stillJob)
                // One card, wherever it sits: the flat board and every scene use it
                const cardFor = (shot: StoryboardShot, label?: string, nextLabel?: string) => {
                  const i = board.shots.indexOf(shot)
                  return (
                    <ShotCard
                      key={shot.id}
                      index={i}
                      label={label}
                      nextLabel={nextLabel}
                      shot={shot}
                      next={board.shots[i + 1]}
                      aspectCss={aspectCss}
                      busy={!!busy[shot.id] || !!queued[shot.id] || jobOf(shot)?.status === "making" || jobOf(shot)?.status === "queued"}
                      queued={!busy[shot.id] && jobOf(shot)?.status !== "making" && (!!queued[shot.id] || jobOf(shot)?.status === "queued")}
                      error={shotError[shot.id] || (jobOf(shot)?.status === "failed" ? `Still failed: ${jobOf(shot)?.error ?? "try again"}` : undefined)}
                      last={i === board.shots.length - 1}
                      dragging={dragFrom === i}
                      onChange={patch => setShot(shot.id, patch)}
                      onGenerate={() => generateStill(shot)}
                      onShoot={() => shoot([shot.id])}
                      shootTickets={shotTickets(shot, shootRes)}
                      onMove={d => moveShot(i, i + d)}
                      onDuplicate={() => duplicateShot(i)}
                      onInsert={side => insertShot(i, side)}
                      canInsert={board.shots.length < MAX_SHOTS}
                      onRemove={() => removeShot(shot.id)}
                      onPlay={() => setAnimatic(i)}
                      stillCost={stillPrice(shot)}
                      refsInfo={{ on: stillRefUrls(board, shot, 99).length, max: stillModelSpec(shot.imageModel).maxRefs }}
                      editChoices={[{ value: "", label: "A fresh image" }, ...board.shots.slice(0, i).map((x, k) => ({ value: x.id, label: `${pad2(k + 1)} · ${x.title || x.description.slice(0, 40) || "Untitled"}${x.stillUrl ? "" : " (no still yet)"}` })).reverse()]}
                      editFrom={editSource(board.shots, shot)}
                      boardAspect={board.aspect}
                      onEditInStudio={() => setStudioShot(shot.id)}
                      isAdmin={isAdmin}
                      refList={Array.isArray(shot.refs) ? shot.refs : autoShotRefs(board, shot).map(r => ({ id: r.id, url: r.url, on: true, assetId: r.assetId }))}
                      refsAuto={!Array.isArray(shot.refs)}
                      onRefsChange={next => setShot(shot.id, { refs: next })}
                      refLibrary={refLibrary}
                      boardStills={boardStills}
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
                  )
                }
                /* As many columns as fit, with card widths that grow with the
                   screen: a tall frame gets narrower cards (a row of shots, not
                   one giant still), and a big monitor gets bigger cards rather
                   than a wall of thumbnails */
                const gridStyle = { gridTemplateColumns: `repeat(auto-fill, minmax(${portrait ? "min(clamp(210px, 14vw, 360px), 46%)" : board.aspect === "1:1" ? "min(clamp(240px, 17vw, 420px), 100%)" : "min(clamp(290px, 21vw, 540px), 100%)"}, 1fr))` }
                // The "Add shot" tile - also where a shot dragged from another scene lands
                const addTile = (label: string, sceneId?: string) => board.shots.length < MAX_SHOTS && (
                  <button
                    onClick={() => addShot(sceneId)}
                    onDragOver={e => { if (dragFrom !== null && sceneId) e.preventDefault() }}
                    onDrop={() => { if (dragFrom !== null && sceneId) moveShotToScene(dragFrom, sceneId); setDragFrom(null) }}
                    style={{ aspectRatio: aspectCss }}
                    className="rounded-2xl border border-dashed border-white/15 hover:border-white/40 hover:bg-white/[0.03] text-slate-500 hover:text-slate-200 flex flex-col items-center justify-center gap-2 min-h-[160px] transition-colors"
                  >
                    <Plus size={20} />
                    <span className="text-[11px] font-semibold">Add shot {label}</span>
                  </button>
                )
                const addSceneBtn = (big: boolean) => board.scenes.length < MAX_SCENES && (
                  <button
                    onClick={addScene}
                    title={board.scenes.length ? "A new scene at the end of the board" : "Split the board into scenes - the shots so far become scene 1"}
                    className={big
                      ? "w-full mt-1 rounded-2xl border border-dashed border-white/15 hover:border-white/40 hover:bg-white/[0.03] text-slate-400 hover:text-white flex items-center justify-center gap-2 py-5 text-[12px] font-semibold transition-colors"
                      : "ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 text-[10.5px] font-semibold text-slate-300 hover:text-white hover:border-white/30 transition-colors"}
                  >
                    <Layers size={big ? 14 : 12} /> {board.scenes.length ? `Add scene ${pad2(board.scenes.length + 1)}` : "Add scenes"}
                  </button>
                )

                // ── an empty board: the first shot (or Draft with AI) makes Scene 1 ──
                if (!board.scenes.length) return (
                  <>
                    <div className="flex items-center gap-2.5 mb-3">
                      <BrandTitle title="Scene 01" logo={0} size="sm" />
                      <span className="hidden sm:inline text-[10px] text-slate-600">add a shot, or draft the board with AI</span>
                    </div>
                    <div className="grid gap-3 items-start" style={gridStyle}>
                      {addTile("1.01")}
                    </div>
                  </>
                )

                // ── scene by scene: shot numbers are scene.shot ("2.03") ──
                const labelOf = new Map<string, string>()
                board.scenes.forEach((c, k) => sceneShots(board.shots, c.id).forEach((x, j) => labelOf.set(x.id, `${k + 1}.${pad2(j + 1)}`)))
                // One scene at a time: the page's scene (the first, if it is gone)
                const paged = sceneView === "one"
                const pageIdx = Math.max(0, board.scenes.findIndex(c => c.id === pageScene))
                const setView = (v: "all" | "one") => { setSceneView(v); try { localStorage.setItem("pv2-storyboard-view", v) } catch {} }
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2.5 mb-3">
                      <BrandTitle title={`Scenes · ${board.scenes.length}`} logo={0} size="sm" />
                      <span className="hidden sm:inline text-[10px] text-slate-600">{n} shot{n === 1 ? "" : "s"}{paged ? "" : " · drag a shot onto another scene to move it"}</span>
                      {/* the view: every scene on one page, or one scene per page */}
                      <div className="ml-auto flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
                        {([["all", "All scenes"], ["one", "One scene"]] as const).map(([v, label]) => (
                          <button
                            key={v}
                            onClick={() => setView(v)}
                            className={`px-2.5 py-1 rounded-md text-[10.5px] font-semibold transition-colors ${sceneView === v ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {paged && (
                      // The scene strip: every scene as a tab, with previous / next
                      <div className="flex items-center gap-1.5 mb-3">
                        <IconBtn title="Previous scene" onClick={() => setPageScene(board.scenes[pageIdx - 1]?.id ?? null)} disabled={pageIdx === 0}><ChevronLeft size={14} /></IconBtn>
                        <div className="flex-1 min-w-0 flex items-stretch gap-1.5 overflow-x-auto [scrollbar-width:thin] pb-0.5">
                          {board.scenes.map((c, k) => {
                            const own = sceneShots(board.shots, c.id)
                            const cover = thumbFrom(thumbs, own.find(x => x.stillUrl)?.stillUrl)
                            const on = k === pageIdx
                            return (
                              <button
                                key={c.id}
                                onClick={() => setPageScene(c.id)}
                                onDragOver={e => { if (dragFrom !== null) e.preventDefault() }}
                                onDrop={() => { if (dragFrom !== null) moveShotToScene(dragFrom, c.id); setDragFrom(null) }}
                                title={c.title || `Scene ${k + 1}`}
                                className={`shrink-0 flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-xl border text-left transition-colors ${on ? "border-white/40 bg-white/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.04]"}`}
                              >
                                {cover
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={cover} alt="" className="w-12 h-8 rounded-md object-cover" />
                                  : <span className="w-12 h-8 rounded-md bg-white/[0.06] flex items-center justify-center"><Layers size={11} className="text-slate-600" /></span>}
                                <span className="min-w-0">
                                  <span className="block text-[9px] font-mono font-bold tracking-[0.16em] text-slate-400">SCENE {pad2(k + 1)}</span>
                                  <span className={`block max-w-[11rem] truncate text-[11px] font-semibold ${on ? "text-white" : "text-slate-300"}`}>{c.title || "Untitled"} <span className="text-slate-500 font-normal">· {own.length}</span></span>
                                </span>
                              </button>
                            )
                          })}
                          {board.scenes.length < MAX_SCENES && (
                            <button onClick={addScene} title="A new scene at the end" className="shrink-0 flex items-center gap-1 px-2.5 rounded-xl border border-dashed border-white/15 text-[10.5px] font-semibold text-slate-400 hover:text-white hover:border-white/40">
                              <Plus size={12} /> Scene
                            </button>
                          )}
                        </div>
                        <IconBtn title="Next scene" onClick={() => setPageScene(board.scenes[pageIdx + 1]?.id ?? null)} disabled={pageIdx >= board.scenes.length - 1}><ChevronRight size={14} /></IconBtn>
                      </div>
                    )}
                    {board.scenes.map((c, k) => {
                      if (paged && k !== pageIdx) return null
                      const own = sceneShots(board.shots, c.id)
                      const folded = collapsed.includes(c.id)
                      const missingHere = own.filter(x => needsStill(x) && !stillBusy(x))
                      const shootHere = own.filter(x => shootable(x) && x.video?.status !== "done" && !busy[x.id])
                      return (
                        <section key={c.id} className="mb-6">
                          <SceneHeader
                            scene={c}
                            n={k + 1}
                            shots={own}
                            assets={board.assets}
                            refCount={shotRefs(board, { sceneId: c.id }).length}
                            collapsed={folded}
                            onToggle={() => setCollapsed(x => (x.includes(c.id) ? x.filter(y => y !== c.id) : [...x, c.id]))}
                            onChange={patch => setScene(c.id, patch)}
                            onMove={d => moveScene(c.id, d)}
                            first={k === 0}
                            last={k === board.scenes.length - 1}
                            prevName={k > 0 ? `scene ${k}` : board.scenes.length > 1 ? "scene 2" : null}
                            canRemove={board.scenes.length > 1 || own.length === 0}
                            onRemove={() => removeScene(c.id)}
                            missing={missingHere.length}
                            missingTickets={missingHere.reduce((t, x) => t + stillPrice(x), 0)}
                            making={batchScene === c.id}
                            onMakeStills={() => generateMissing(c.id)}
                            toShoot={shootHere.length}
                            shootTickets={shootHere.reduce((t, x) => t + shotTickets(x, shootRes), 0)}
                            shootRes={shootRes}
                            onShoot={() => shoot(shootHere.map(x => x.id))}
                            onPlay={() => own.length && setAnimatic(board.shots.indexOf(own[0]))}
                            onCut={() => { setFcScene(c.id); setFcOpen(true) }}
                            cutBusy={fcRunning}
                            room={MAX_SHOTS - board.shots.length}
                            drafting={draftScene === c.id}
                            draftLocked={!!drafting}
                            onDraft={(direction, count) => draft("scene", { sceneId: c.id, count, direction })}
                          />
                          {!folded && (
                            <div className="grid gap-3 items-start mt-3" style={gridStyle}>
                              {own.map(x => {
                                const nx = board.shots[board.shots.indexOf(x) + 1]
                                return cardFor(x, labelOf.get(x.id), nx ? labelOf.get(nx.id) : undefined)
                              })}
                              {addTile(`${k + 1}.${pad2(own.length + 1)}`, c.id)}
                            </div>
                          )}
                        </section>
                      )
                    })}
                    {!paged && addSceneBtn(true)}
                  </>
                )
              })()}
            </main>
          </div>
        </>
      )}

      {board && stillsCut !== null && (
        <StillsCutPanel
          boardId={board.id}
          sceneId={stillsCut || null}
          sceneName={stillsCut ? board.scenes.find(c => c.id === stillsCut)?.title : undefined}
          hasClips={board.shots.some(x => x.video?.status === "done" && !!x.video.url)}
          isAdmin={isAdmin}
          onClose={() => setStillsCut(null)}
        />
      )}
      {board && studioShot && (() => {
        const sh = board.shots.find(x => x.id === studioShot)
        if (!sh?.stillUrl) return null
        return (
          <EditImagePopup
            image={{ id: `storyboard-${board.id}-${sh.id}`, url: sh.stillUrl }}
            onApply={dataUrl => { setStudioShot(null); adoptStudioEdit(sh.id, dataUrl) }}
            onClose={() => setStudioShot(null)}
          />
        )
      })()}
      {board && fcOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={() => setFcOpen(false)}>
          <div className="relative isolate overflow-hidden w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-b from-[#0d1322] to-[#080b14] p-5" onClick={e => e.stopPropagation()}>
            <SilverRimOverlay />
            <div className="relative space-y-4">
            <BrandTitle
              title={fcSceneDoc ? `Final Cut · Scene ${board.scenes.indexOf(fcSceneDoc) + 1}` : "Final Cut"}
              eyebrow={fcSceneDoc ? (fcSceneDoc.title || "This scene's shots only") : "Edit · score · narrate"}
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
    </AddStillThumbs.Provider>
    </StillThumbs.Provider>
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
    // z-30: above the board (so the picker opens over the shot cards) but under
    // the portal's sticky taskbar (z-40) - on phones and tablets the page scrolls
    // as one, and at z-40 this bar slid over the taskbar instead of behind it
    <div ref={rootRef} className="relative z-30 flex items-center gap-1.5 px-3 sm:px-4 py-1.5 shrink-0">
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
  index, label, nextLabel, shot, aspectCss, busy, queued = false, error, last, dragging, shootTickets,
  onChange, onGenerate, onShoot, onMove, onDuplicate, onInsert, canInsert, onRemove, onPlay, onDragStart, onDragEnd, onDrop, inRefs, onAddRef,
  stillCost, refsInfo, assets, onAddToAsset, selecting, picked, onPick, flash, onFocus, onOpen, opening, onAiEdit, onPickVideo,
  refList, refsAuto, onRefsChange, refLibrary, boardStills, editChoices, editFrom, boardAspect, onEditInStudio, isAdmin,
}: {
  /** Admin-only models in the menus. */
  isAdmin: boolean
  index: number
  /** Its number on the board ("03", or "2.03" in scene 2); default = position. */
  label?: string
  /** The next shot's number, for "To ..." (it may be in the next scene). */
  nextLabel?: string
  shot: StoryboardShot
  next?: StoryboardShot
  aspectCss: string
  busy: boolean
  /** Waiting its turn in a "Make N stills" batch (busy is true too). */
  queued?: boolean
  error?: string
  last: boolean
  dragging: boolean
  onChange: (patch: Partial<StoryboardShot>) => void
  onGenerate: () => void
  onShoot: () => void
  shootTickets: number
  onMove: (d: -1 | 1) => void
  onDuplicate: () => void
  /** A new blank shot right before / after this one, in its scene */
  onInsert: (side: "before" | "after") => void
  canInsert: boolean
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
  /** This still's references - its own list, or the automatic one - for Details. */
  refList: ShotRef[]
  refsAuto: boolean
  /** The shot's own list changed (undefined = back to automatic). */
  onRefsChange: (next: ShotRef[] | undefined) => void
  refLibrary: { id: string; url: string }[]
  boardStills: { url: string; label: string }[]
  /** The shots this one can edit (the earlier ones), for "Edit from". */
  editChoices: { value: string; label: string }[]
  /** The shot it edits, when that shot has a still. */
  editFrom: { id: string; stillUrl: string | null; title: string } | null
  boardAspect: string
  /** Open this still in the Image Studio popup; the edit comes back as a new take. */
  onEditInStudio: () => void
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
  const thumb = useThumb()
  const [details, setDetails] = useState(false)
  const [refMenu, setRefMenu] = useState(false)
  const [beforeBusy, setBeforeBusy] = useState(false)
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
          <video key={playUrl!} src={playUrl!} poster={frame === "raw" ? undefined : thumb(shot.stillUrl)} className={`absolute inset-0 w-full h-full ${frame === "raw" ? "object-contain bg-black" : "object-cover"}`} controls playsInline loop preload={frame === "raw" ? "metadata" : "none"} />
        ) : shot.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb(shot.stillUrl)}
            alt={shot.description}
            onClick={onOpen}
            title="Open full size"
            // A still in its own frame (a panorama, a poster) is shown whole
            className={`absolute inset-0 w-full h-full cursor-zoom-in ${shot.aspect && shot.aspect !== boardAspect ? "object-contain bg-black" : "object-cover"}`}
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
            <GripVertical size={11} className="text-slate-500" />{label ?? pad2(index + 1)}
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
          {shot.aspect && shot.aspect !== boardAspect && !showVideo && (
            <span title="This still has its own frame" className="px-1.5 py-0.5 rounded-md bg-black/70 border border-sky-300/40 text-[9.5px] font-mono font-semibold text-sky-100">{shot.aspect}</span>
          )}
          {editFrom && !showVideo && (
            <span title={`Edits the still of "${editFrom.title || "an earlier shot"}"`} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/70 border border-amber-300/40 text-[9.5px] font-semibold text-amber-100"><Wand2 size={9} />Edit</span>
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
            {queued ? (
              <>
                <Clock size={17} className="text-slate-300" />
                <span className="text-[10px] font-semibold text-slate-200">Queued</span>
                <span className="text-[9.5px] text-slate-400">{imageModelLabel(shot.imageModel)} · starts in a moment</span>
              </>
            ) : (
              <>
                <Loader2 size={18} className="animate-spin text-slate-200" />
                <span className="text-[10px] text-slate-300">{imageModelLabel(shot.imageModel)}…</span>
              </>
            )}
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
            {/* Edit the still itself in the Image Studio editor (the same popup as
                editing a reference in the portal) - the result comes back as this
                shot's new still. Clicking the picture still opens it full size. */}
            {shot.stillUrl && (
              <button onClick={onEditInStudio} title="Edit this still in the Image Studio editor - crop, paint, AI fill, layers..."
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 border border-white/20 text-[10px] font-semibold text-slate-100 hover:bg-white/15 hover:border-white/40">
                <Pencil size={10} /><span>Edit</span>
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
          <span className="shrink-0 mt-px">{last ? "Ending" : `To ${nextLabel ?? pad2(index + 2)}`}</span>
          <AutoText value={shot.transition} onChange={v => onChange({ transition: v })} placeholder={last ? "How the film ends" : "Cut, match cut, dissolve…"} className="flex-1 min-w-0 bg-transparent text-[10.5px] @[300px]/card:text-[11.5px] leading-snug text-slate-300 focus:outline-none border-b border-transparent focus:border-white/40" />
        </div>
        {(error || (v?.status === "failed" && v.error)) && <p className="text-[10px] text-red-400 leading-snug">{error || `Shoot failed: ${v!.error}`}</p>}

        <div className="flex items-center gap-0.5 pt-1 border-t border-white/5">
          <button onClick={() => setDetails(d => !d)} className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold ${details ? "text-white bg-white/10" : "text-slate-400 hover:text-white"}`}>
            {details ? <ChevronLeft size={11} className="-rotate-90" /> : <ChevronRight size={11} className="rotate-90" />} Details
          </button>
          {/* Both models at a glance - the still's and the video's - without opening Details */}
          <span className="ml-1 min-w-0 flex items-center gap-1 text-[9.5px] text-slate-500" title={`Still: ${imageModelLabel(shot.imageModel)} · Video: ${shot.videoModel}`}>
            <ImagePlus size={10} className="shrink-0 text-slate-600" />
            <span className="truncate text-slate-400">{imageModelLabel(shot.imageModel)}</span>
            <span className="shrink-0 text-slate-700">·</span>
            <Film size={10} className="shrink-0 text-slate-600" />
            <span className="truncate">{shot.videoModel}</span>
          </span>
          <span className="ml-auto" />
          <IconBtn title="Add a new shot before this one" onClick={() => onInsert("before")} disabled={!canInsert}><span className="flex items-center"><Plus size={11} /><ChevronLeft size={10} className="-ml-0.5" /></span></IconBtn>
          <IconBtn title="Add a new shot after this one" onClick={() => onInsert("after")} disabled={!canInsert}><span className="flex items-center"><ChevronRight size={10} className="-mr-0.5" /><Plus size={11} /></span></IconBtn>
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <IconBtn title="Move earlier" onClick={() => onMove(-1)} disabled={index === 0}><ChevronLeft size={13} /></IconBtn>
          <IconBtn title="Move later" onClick={() => onMove(1)} disabled={last}><ChevronRight size={13} /></IconBtn>
          <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={12} /></IconBtn>
          <IconBtn title="Delete shot" onClick={onRemove}><Trash2 size={12} /></IconBtn>
        </div>

        {details && (
          <div className="space-y-2.5 pt-1">
            {/* the references this still is made with: switch, remove, add */}
            <ShotRefsPanel
              refs={refList}
              auto={refsAuto}
              assets={assets}
              refLibrary={refLibrary}
              boardStills={boardStills}
              max={refsInfo.max}
              model={imageModelLabel(shot.imageModel)}
              onChange={onRefsChange}
              // The pictures stillRefUrls sends ahead of the list - shown first, numbered
              lead={[
                ...(shot.beforeUrl ? [{ url: shot.beforeUrl, label: "Before", hint: "The before picture - goes first (set in Edit & frame)", kind: "before" as const }] : []),
                ...(editFrom?.stillUrl ? [{
                  url: editFrom.stillUrl,
                  label: `Edits ${editChoices.find(o => o.value === editFrom.id)?.label.split(" · ")[0] ?? "a shot"}`,
                  hint: `The still of "${editFrom.title || "an earlier shot"}" - this shot is an edit of it, so it goes first (set in Edit & frame)`,
                  kind: "edit" as const,
                }] : []),
              ]}
              onClearLead={k => onChange(k === "edit" ? { editOf: undefined } : { beforeUrl: null })}
            />
            {/* Edit from an earlier still, the still's own frame, a before picture, the Stills cut caption */}
            <div className="silver-edge rounded-xl p-2 space-y-2">
              <BrandTitle title="Edit & frame" logo={16} size="sm" />
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">Edit from</p>
                <Dropdown value={shot.editOf ?? ""} options={editChoices.some(o => o.value === (shot.editOf ?? "")) ? editChoices : [...editChoices, { value: shot.editOf!, label: "A later shot" }]} onChange={v => onChange({ editOf: v || undefined })} className="w-full" />
                <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">
                  {shot.editOf
                    ? editFrom ? "That still goes first among the references. Write the prompt as an edit: \"change ONLY the outfit, keep everything else the same\"." : "That shot has no still yet - make it first."
                    : "A fresh image - or pick an earlier shot to edit its still (new outfit, pose, angle, background, character…)."}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">Frame</p>
                <Dropdown value={shot.aspect ?? ""} options={[{ value: "", label: `The board's (${boardAspect})` }, ...SHOT_ASPECTS.filter(a => a !== boardAspect).map(a => ({ value: a, label: a }))]} onChange={v => onChange({ aspect: v || undefined })} className="w-full" />
                {shot.aspect && <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">This still only - its video and the Final Cut keep the board&apos;s {boardAspect}; the Stills cut pans across it or fits it.</p>}
              </div>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">Before / after</p>
                {shot.beforeUrl ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb(shot.beforeUrl)} alt="Before" className="w-14 shrink-0 rounded-md border border-white/15 object-cover" style={{ aspectRatio: aspectCss }} />
                    <span className="flex-1 text-[9.5px] text-slate-400 leading-snug">The still is made as an edit of this picture; the Stills cut wipes from it to the result.</span>
                    <IconBtn title="Remove the before picture" onClick={() => onChange({ beforeUrl: undefined })}><X size={12} /></IconBtn>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <label className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-[10px] font-semibold text-slate-200 cursor-pointer hover:bg-white/10 ${beforeBusy ? "opacity-50 pointer-events-none" : ""}`}>
                      {beforeBusy ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}Upload
                      <input type="file" onClick={gateFileInput} accept="image/*" className="hidden" onChange={async e => {
                        const f = e.target.files?.[0]
                        e.target.value = ""
                        if (!f) return
                        setBeforeBusy(true)
                        try { onChange({ beforeUrl: await uploadImage(f) }) } catch { /* the field stays empty */ } finally { setBeforeBusy(false) }
                      }} />
                    </label>
                    <Dropdown value="" options={[{ value: "", label: boardStills.length ? "or a board still…" : "No board stills yet" }, ...boardStills.map(b => ({ value: b.url, label: `Still ${b.label}` }))]} onChange={v => v && onChange({ beforeUrl: v })} className="flex-1" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <input value={shot.caption ?? ""} onChange={e => onChange({ caption: e.target.value || undefined })} maxLength={60} placeholder="Caption (Stills cut)" className="sb-input" />
                <input value={shot.captionSub ?? ""} onChange={e => onChange({ captionSub: e.target.value || undefined })} maxLength={90} placeholder="Second line" className="sb-input" />
              </div>
              {shot.stillUrl && (
                <BrandButton onClick={onEditInStudio} size="xs" className="w-full">
                  <Wand2 size={11} />Edit in Image Studio
                </BrandButton>
              )}
            </div>
            {/* Edit this shot's plan with AI: change the model, rewrite a prompt for one, restyle the motion */}
            <div className="silver-edge rounded-xl p-2 space-y-1.5">
              <BrandTitle title="Edit with AI" logo={16} size="sm" />
              <AutoText
                value={aiText}
                onChange={setAiText}
                minRows={2}
                placeholder="e.g. use LTX 2.5 Fast instead · rewrite the still for NanoBanana 2.1 · slower camera, add rain"
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
                      <img src={thumb(t.url)} alt="" className="absolute inset-0 w-full h-full object-cover" />
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
                        <img src={thumb(t.fromStill)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      ) : <span className="absolute inset-0 bg-white/5" />}
                      <span className="absolute top-0.5 left-0.5 rounded bg-black/70 px-0.5 text-[8px] text-white"><Play size={7} className="inline -mt-px" /></span>
                      <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[7.5px] font-mono text-center text-slate-200 truncate px-0.5">{k + 1} · {t.model.replace(/-/g, " ")}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="Still" hint={`${stillCost} tickets`}>
              <Dropdown value={shot.imageModel} options={imageOptions(isAdmin, shot.imageModel)} onChange={v => { onChange({ imageModel: v, imageQuality: "", imageOptions: {} }); setAdapt(a => ({ ...a, image: true })) }} className="w-full" />
              {adapt.image && (
                <button onClick={() => runAi(`Rewrite the image prompt so it suits ${imageModelLabel(shot.imageModel)}, keeping what the shot shows.`, "image")} disabled={aiBusy} className="mt-1 flex items-center gap-1 text-[10px] text-slate-200 hover:text-white disabled:opacity-40">
                  {aiBusy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Rewrite the prompt for {imageModelLabel(shot.imageModel)}
                </button>
              )}
              {/* The model's own settings - resolution, quality, speed, style... -
                  whatever it offers (lib/storyboard stillSettings) */}
              {knobs.settings.length > 0 ? (() => {
                // One grid, two to a row: choices as compact dropdowns, on/off
                // ones as a toggle button in a cell of their own (web search
                // sits beside the safety level); what each does is its tooltip
                const sets = knobs.settings.filter(set => !set.admin || isAdmin)
                const setOpt = (key: string, v: string) => onChange(key === "quality" ? { imageQuality: v } : { imageOptions: { ...(shot.imageOptions ?? {}), [key]: v } })
                return (
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    {sets.map(set => {
                      const cur = stillSettingValue(set, shot.imageQuality, shot.imageOptions)
                      const on = cur === "true"
                      const Icon = set.key === "nb21WebSearch" ? Globe : on ? SquareCheck : Square
                      return (
                        <div key={set.key} title={set.hint} className="min-w-0">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-0.5 truncate">{set.label}{set.admin ? " · admin" : ""}</p>
                          {set.as === "bool" ? (
                            <button
                              onClick={() => setOpt(set.key, on ? "false" : "true")}
                              className={`w-full flex items-center justify-center gap-1.5 py-[5px] rounded-lg border text-[11px] font-mono transition-colors ${on ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-white/10 bg-black/40 text-slate-400 hover:text-white hover:border-white/25"}`}
                            >
                              <Icon size={11} /> {on ? "On" : "Off"}
                            </button>
                          ) : (
                            <Dropdown value={cur} options={set.options} onChange={v => setOpt(set.key, v)} className="w-full" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })() : (
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
              <Dropdown value={shot.videoModel} options={videoOptions(isAdmin, shot.videoModel)} onChange={v => { onChange({ videoModel: v }); setAdapt(a => ({ ...a, video: true })) }} className="w-full" />
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

/**
 * A scene's head: its number, name, slug line and summary, the assets cast in
 * it (their refs go with its stills), and everything that can be done to the
 * scene alone - make its stills, shoot it, play it, cut it, draft more of it.
 */
function SceneHeader({
  scene, n, shots, assets, refCount, collapsed, onToggle, onChange, onMove, first, last, prevName, canRemove, onRemove,
  missing, missingTickets, making, onMakeStills, toShoot, shootTickets, shootRes, onShoot, onPlay, onCut, cutBusy,
  room, drafting, draftLocked, onDraft,
}: {
  scene: StoryScene
  n: number
  shots: StoryboardShot[]
  assets: StoryAsset[]
  /** References its stills will get, before each model's limit. */
  refCount: number
  collapsed: boolean
  onToggle: () => void
  onChange: (patch: Partial<StoryScene>) => void
  onMove: (d: -1 | 1) => void
  first: boolean
  last: boolean
  /** Where its shots go if it is deleted ("scene 1"); null = it is the only scene. */
  prevName: string | null
  /** False for the only scene while it holds shots - shots always live in a scene. */
  canRemove: boolean
  onRemove: () => void
  missing: number
  missingTickets: number
  making: boolean
  onMakeStills: () => void
  toShoot: number
  shootTickets: number
  shootRes: string
  onShoot: () => void
  onPlay: () => void
  onCut: () => void
  cutBusy: boolean
  /** Shots the board still has room for. */
  room: number
  drafting: boolean
  draftLocked: boolean
  onDraft: (direction: string, count: number) => Promise<string | null>
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmShoot, setConfirmShoot] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [direction, setDirection] = useState("")
  const [count, setCount] = useState(4)
  const [err, setErr] = useState<string | null>(null)
  const secs = totalSeconds(shots)
  const stills = shots.filter(s => s.stillUrl).length
  const done = shots.filter(s => s.video?.status === "done").length
  const cast = new Set(scene.assetIds)
  const runDraft = async () => {
    setErr(null)
    const e = await onDraft(direction.trim(), Math.min(count, Math.max(1, room)))
    if (e) setErr(e)
    else { setDirection(""); setDraftOpen(false) }
  }

  return (
    <div className="silver-edge rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <button
          onClick={onToggle}
          title={collapsed ? "Show this scene's shots" : "Fold this scene away"}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.07] border border-white/10 text-[10px] font-mono font-bold tracking-[0.18em] text-slate-100 hover:bg-white/10"
        >
          <Layers size={11} className="text-slate-400" /> SCENE {pad2(n)}
          <ChevronDown size={11} className={`text-slate-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </button>
        <input
          value={scene.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Name the scene"
          className="min-w-[8rem] flex-1 bg-transparent text-[14px] font-bold text-white placeholder:text-slate-600 focus:outline-none border-b border-transparent focus:border-white/20"
        />
        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
          {shots.length} shot{shots.length === 1 ? "" : "s"} · {fmtRuntime(secs)} · {stills}/{shots.length} stills · {done}/{shots.length} shot
        </span>
        <div className="flex items-center gap-0.5">
          <IconBtn title="Move the scene earlier" onClick={() => onMove(-1)} disabled={first}><ChevronUp size={13} /></IconBtn>
          <IconBtn title="Move the scene later" onClick={() => onMove(1)} disabled={last}><ChevronDown size={13} /></IconBtn>
          <IconBtn
            title={!canRemove ? "The only scene can't go while it has shots - every shot lives in a scene" : confirmDel ? "Click again to delete" : prevName ? `Delete the scene - its shots move to ${prevName}` : "Delete the scene"}
            disabled={!canRemove}
            onClick={() => { if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); return } onRemove() }}
          >
            <Trash2 size={12} className={confirmDel ? "text-red-400" : undefined} />
          </IconBtn>
        </div>
      </div>
      {confirmDel && (
        <p className="mt-1 text-[10px] text-red-300">
          Click the bin again to delete scene {pad2(n)}{shots.length && prevName ? ` - its ${shots.length} shot${shots.length === 1 ? "" : "s"} move to ${prevName}` : ""}.
        </p>
      )}

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={scene.setting}
            onChange={e => onChange({ setting: e.target.value })}
            placeholder="INT. LIGHTHOUSE - NIGHT"
            className="w-full bg-transparent text-[10.5px] font-mono uppercase tracking-[0.12em] text-slate-300 placeholder:text-slate-600 focus:outline-none border-b border-transparent focus:border-white/20"
          />
          <AutoText
            value={scene.summary}
            onChange={v => onChange({ summary: v })}
            placeholder="What happens in this scene - Draft shots writes from this"
            className="w-full bg-transparent text-[11.5px] leading-relaxed text-slate-300 placeholder:text-slate-600 focus:outline-none rounded-md focus:bg-black/30 focus:ring-1 focus:ring-white/30 px-1 -mx-1"
          />

          {/* Cast: the assets in this scene - their refs go with its stills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500 mr-0.5">In this scene</span>
            {assets.length === 0 && <span className="text-[10px] text-slate-600">Add assets (characters, places, outfits) in the panel to cast them here</span>}
            {assets.map(a => {
              const on = cast.has(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => onChange({ assetIds: on ? scene.assetIds.filter(x => x !== a.id) : [...scene.assetIds, a.id] })}
                  title={`${on ? "Take out of" : "Put in"} this scene - ${a.refs.length} ref${a.refs.length === 1 ? "" : "s"}`}
                  className={`flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full border text-[10.5px] transition-colors ${on ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white hover:border-white/25"}`}
                >
                  {a.refs[0]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.refs[0].url} alt="" className="w-4 h-4 rounded-full object-cover" />
                    : <span className="w-4 h-4 rounded-full bg-white/10" />}
                  {a.name}
                  {on && <Check size={10} />}
                </button>
              )
            })}
          </div>
          {assets.length > 0 && (
            <p className="-mt-1 text-[9.5px] text-slate-500">
              {cast.size ? `${refCount} ref${refCount === 1 ? " from its cast goes" : "s from its cast go"} with this scene's stills` : "No one cast - each shot uses its own references (see its Details)"}
            </p>
          )}

          {/* the scene on its own */}
          <div className="flex flex-wrap items-center gap-1.5">
            <BrandButton onClick={onMakeStills} disabled={making || missing === 0} busy={making} size="xs" title="Make every still this scene is missing">
              {missing ? `Make ${missing} still${missing === 1 ? "" : "s"}` : "Stills made"}
              {missing > 0 && <Tix n={missingTickets} className="text-slate-300" />}
            </BrandButton>
            <BrandButton
              onClick={() => { if (!confirmShoot) { setConfirmShoot(true); return } setConfirmShoot(false); onShoot() }}
              onBlur={() => setConfirmShoot(false)}
              disabled={toShoot === 0}
              warn={confirmShoot}
              size="xs"
              title={toShoot ? `Shoot this scene's ${toShoot} shot${toShoot === 1 ? "" : "s"} at ${shootRes}` : "Nothing to shoot - make the stills first, or it is all shot"}
            >
              {confirmShoot ? `Shoot ${toShoot} for ${shootTickets} tickets?` : toShoot ? `Shoot ${toShoot}` : "Shoot"}
              {toShoot > 0 && !confirmShoot && <Tix n={shootTickets} className="text-slate-300" />}
            </BrandButton>
            <button onClick={onPlay} disabled={!shots.length} className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] font-semibold text-slate-300 hover:text-white hover:border-white/30 disabled:opacity-40">
              <Play size={11} /> Play
            </button>
            <button onClick={onCut} disabled={!shots.length || cutBusy} title="A Final Cut of this scene alone" className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] font-semibold text-slate-300 hover:text-white hover:border-white/30 disabled:opacity-40">
              <Scissors size={11} /> Final Cut
            </button>
            <button
              onClick={() => setDraftOpen(o => !o)}
              disabled={room <= 0}
              className={`ml-auto flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold transition-colors disabled:opacity-40 ${draftOpen ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-300 hover:text-white hover:border-white/30"}`}
            >
              <Sparkles size={11} /> Draft shots
            </button>
          </div>

          {draftOpen && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/25 p-2">
              <textarea
                value={direction}
                onChange={e => setDirection(e.target.value)}
                rows={2}
                placeholder={shots.length ? "What happens next in this scene (optional)…" : scene.summary ? "Any direction (optional) - it drafts from the summary above…" : "What happens in this scene…"}
                className="sb-input"
              />
              <div className="flex items-center gap-1.5">
                <NumberStepper value={Math.min(count, Math.max(1, room))} min={1} max={Math.max(1, Math.min(MAX_DRAFT_SHOTS, room))} prefix="+" onChange={setCount} className="w-[104px] shrink-0" />
                <BrandButton onClick={runDraft} disabled={draftLocked || (!direction.trim() && !scene.summary && !shots.length)} busy={drafting} primary size="xs" className="flex-1">
                  {drafting ? "Drafting…" : <>{`Draft ${Math.min(count, Math.max(1, room))} shot${count === 1 ? "" : "s"}`}<TicketChip n={storyboardDraftTickets("scene", Math.min(count, Math.max(1, room)))} /></>}
                </BrandButton>
              </div>
              <p className="text-[9.5px] text-slate-500 leading-snug">Written for this scene - its summary, its cast and the shots around it. Free (no tickets).</p>
              {err && <p className="text-[10px] text-red-400">{err}</p>}
            </div>
          )}
        </div>
      )}
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
  const thumb = useThumb()
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
              {s.stillUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={thumb(s.stillUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 bg-white/5" />}
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

/** A Draft-with-AI button's ticket price, after its label. */
function TicketChip({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 rounded-md bg-black/25 px-1 py-px align-middle font-mono text-[10px] opacity-80">
      <Ticket size={9} />{n}
    </span>
  )
}
