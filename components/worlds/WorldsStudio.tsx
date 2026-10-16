"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Circle, Globe2, ImageIcon, Loader2, Plus, Power, Radio,
  Library, RotateCcw, Save, Send, Shield, Shuffle, Sparkles, Trash2, Undo2, Upload, X,
} from "lucide-react"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { openLibraryPicker } from "@/components/feed/LibraryPicker"
import { useWorldBuilder, BuildStage, BuildBar, BuildRail, BUILD_TOOL_IDS, BUILD_NAMES, type BuildToolId } from "./WorldBuilder"
import { getTool, toolTickets } from "@/lib/threed/catalog"
import type { WorldExample } from "@/lib/world-examples"
import { WORLD_ACTIONS_TICKETS } from "@/lib/ai-text-pricing"
import { WMA_MODELS, WMA_BLOCK_SEC, wmaBlockTickets, type WmaModelId } from "@/lib/realtime-wma"
import { useWmaSession, grabPoster, saveLiveClip, uploadLiveMedia } from "@/components/realtime/useWmaSession"

/**
 * The Worlds studio (2026-10-16, ADMIN ONLY while under test): walk around a
 * world a model makes as you go - fal's live world models, Lingbot World 2 and
 * Abot World 0 (lib/realtime-wma).
 *
 * Start from a picture (the Refs library) or the model's own default world,
 * optionally with a description; press Go Live and the world streams in. Move
 * with WASD, look with the arrow keys or by dragging, and (Lingbot) hold 1-9
 * for the actions you set up. The description can be changed while you walk,
 * the world restarted from another picture or one of the model's presets, and
 * any stretch recorded into the feed as a clip.
 *
 * The session itself - billing from the first frame in 30-second blocks, the
 * hidden-tab / idle stop, recording - is components/realtime/useWmaSession.
 */

type Cmd = "forward" | "left" | "backward" | "right" | "look_up" | "look_left" | "look_down" | "look_right"
const MOVE_KEYS: Record<string, Cmd> = {
  KeyW: "forward", KeyA: "left", KeyS: "backward", KeyD: "right",
  ArrowUp: "look_up", ArrowLeft: "look_left", ArrowDown: "look_down", ArrowRight: "look_right",
}
const WORLD_MODELS: WmaModelId[] = ["lingbot-world-2", "abot-world-0"]
/** A world nobody steers is ended after this long (it bills while it streams). */
const WORLD_IDLE_MS = 90_000

interface QuickAction { title: string; description: string }

const MOVE_DIRS = ["forward", "left", "backward", "right"] as const
const LOOK_DIRS = ["look_up", "look_left", "look_down", "look_right"] as const

/** Keeps a finger's events on this element while it moves off it (some browsers refuse - the control still works). */
function capture(e: React.PointerEvent<HTMLElement>) {
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
}

/** Which of up / left / down / right an offset from a centre points at (8 ways, with a dead zone). */
function dirsFor(dx: number, dy: number, dead: number, dirs: readonly [string, string, string, string]): string[] {
  const on: string[] = []
  if (dy < -dead) on.push(dirs[0]); if (dy > dead) on.push(dirs[2])
  if (dx < -dead) on.push(dirs[1]); if (dx > dead) on.push(dirs[3])
  return on
}

/*
 * The touch controls live OUT HERE, at module level, on purpose. They used to
 * be declared inside WorldsStudio, which made each one a brand-new component
 * type on every render - so every press (it sets state) and the live clock's
 * tick every second remounted the button under the finger, which lost its
 * pointer capture and released the control. On the iPad a held "forward"
 * kept dropping out: the moves felt hugely delayed (2026-10-16).
 */

/** A thumbstick: drag the knob; it reports the directions it points (held until let go). */
function Stick({ label, dirs, onDirs }: { label: string; dirs: readonly [string, string, string, string]; onDirs: (on: string[]) => void }) {
  const base = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | null>(null)
  const last = useRef("")
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const R = 40
  const emit = (on: string[]) => { const k = on.join(","); if (k !== last.current) { last.current = k; onDirs(on) } }
  const track = (e: React.PointerEvent) => {
    const r = base.current?.getBoundingClientRect()
    if (!r) return
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(dx, dy)
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
    setKnob({ x: dx, y: dy })
    emit(dirsFor(dx, dy, R * 0.35, dirs))
  }
  const end = () => { pointer.current = null; setKnob({ x: 0, y: 0 }); emit([]) }
  return (
    <div ref={base} aria-label={label} role="group"
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); pointer.current = e.pointerId; capture(e); track(e) }}
      onPointerMove={e => { if (pointer.current === e.pointerId) track(e) }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { if (pointer.current !== null) end() }}
      className="relative h-[104px] w-[104px] touch-none select-none rounded-full border border-white/25 bg-black/40 backdrop-blur"
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1 text-center text-[9px] font-bold uppercase tracking-widest text-white/40">{label}</span>
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 rounded-full border border-white/50 bg-white/25 shadow-lg"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  )
}

/** A button that holds its command while pressed (a Lingbot action). */
function HoldButton({ label, active, onHold, children }: { label: string; active: boolean; onHold: (down: boolean) => void; children: React.ReactNode }) {
  const pointer = useRef<number | null>(null)
  const end = () => { if (pointer.current !== null) { pointer.current = null; onHold(false) } }
  return (
    <button type="button" aria-label={label} title={label}
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); pointer.current = e.pointerId; capture(e); onHold(true) }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onContextMenu={e => e.preventDefault()}
      className={`touch-none select-none rounded-xl border px-2.5 py-2 text-[11px] font-bold backdrop-blur transition-colors ${active ? "border-emerald-300/70 bg-emerald-400/30 text-white" : "border-white/25 bg-black/45 text-slate-100"}`}
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
    >{children}</button>
  )
}

export function WorldsStudio({ refLibrary, isAdmin = false, pick, onBalanceChange, onSaved, onUpgraded, onUploaded }: {
  /** A model picked on the Home page's Worlds models page (n changes per pick): a live world or a world builder */
  pick?: { id: string; n: number } | null
  /** Pictures a world can start from (the account's Refs library). */
  refLibrary: { id: string | number; url: string }[]
  /** Admins may switch Lingbot's safety checker off; everyone else has it on */
  isAdmin?: boolean
  onBalanceChange?: (balance: number) => void
  /** A recorded clip was saved (its new feed row). */
  onSaved?: (row: { id: number; url: string; thumbnailUrl: string | null; prompt: string; model: string; aspectRatio: string; durationSec: number }) => void
  /** Clips swapped for fal's full-quality recording / whole sessions saved */
  onUpgraded?: Parameters<typeof useWmaSession>[0]["onUpgraded"]
  /** A picture was uploaded to start a world from (also kept in the Refs library) */
  onUploaded?: (url: string) => void
}) {
  const [model, setModel] = useState<WmaModelId>(() => (pick && (WORLD_MODELS as string[]).includes(pick.id) ? pick.id as WmaModelId : "lingbot-world-2"))
  /** Live worlds (Lingbot, Abot - streamed, walked) or Build (Hunyuan World, Tripo splat - a job that makes a world to keep) */
  const [mode, setMode] = useState<"live" | "build">(() => (pick && (BUILD_TOOL_IDS as string[]).includes(pick.id) ? "build" : "live"))
  const [buildTool, setBuildTool] = useState<BuildToolId>(() => (pick && (BUILD_TOOL_IDS as string[]).includes(pick.id) ? pick.id as BuildToolId : "hunyuan-world"))
  const [picture, setPicture] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [actions, setActions] = useState<QuickAction[]>([])
  const [presets, setPresets] = useState<{ name: string; prompt: string }[]>([])
  const [effective, setEffective] = useState<string | null>(null)
  const [readyKeys, setReadyKeys] = useState<Record<number, boolean>>({})
  /** A world update in flight (configure / prompt / reset) - one at a time, never replayed */
  const [pending, setPending] = useState<null | "configure" | "prompt" | "reset">(null)
  const [nextPrompt, setNextPrompt] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [held, setHeld] = useState<string[]>([])
  const [fillCount, setFillCount] = useState(4)
  const [fillIdea, setFillIdea] = useState("")
  const [filling, setFilling] = useState(false)
  const [undoActions, setUndoActions] = useState<QuickAction[] | null>(null)
  /** Where a look-drag started on the picture (the ring shown under the finger) */
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null)
  /** fal's example worlds (loaded when the studio opens) and the one picked */
  const [examples, setExamples] = useState<Record<string, WorldExample[]> | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  /** Lingbot: rewrite descriptions / actions into detailed prompts (fal's default on) */
  const [expansion, setExpansion] = useState(true)
  /** Lingbot's safety checker: ON for everyone; only an admin can switch it off */
  const [safety, setSafety] = useState(true)
  const [uploading, setUploading] = useState(false)
  /** The start-from panel's tab: fal's examples, or your own pictures */
  const [startTab, setStartTab] = useState<"examples" | "mine">("examples")
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const recFrom = useRef(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isLingbot = model === "lingbot-world-2"
  const spec = WMA_MODELS[model]

  const onMessage = useCallback((msg: any) => {
    switch (msg?.type) {
      case "session_info":
        if (Array.isArray(msg.presets)) setPresets(msg.presets.filter((p: any) => p?.name).slice(0, 24))
        break
      case "configured": case "prompt_applied": case "reset_applied":
        setPending(null)
        if (typeof msg.prompt === "string") setEffective(msg.prompt)
        break
      case "quick_actions_state":
        if (Array.isArray(msg.actions)) setReadyKeys(Object.fromEntries(msg.actions.map((a: any) => [a.key, !!a.ready])))
        break
      case "error":
        setPending(null)
        if (msg.error) setNotice(String(msg.error))
        break
    }
  }, [])

  const s = useWmaSession({
    model, idleMs: WORLD_IDLE_MS, onMessage, onBalanceChange, onUpgraded,
    // Every walk is kept: the whole session, full quality, saves to the feed when it ends
    // (with the world's setup on record) - the user paid for every second of it
    autoSaveWhole: {
      prompt: (effective || description || "World walk").slice(0, 3000),
      aspectRatio: model === "abot-world-0" ? "20:11" : "26:15",
      setup: {
        model, picture, preset, template, description: description.trim() || null,
        actions: model === "lingbot-world-2" ? actions.filter(a => a.title.trim() && a.description.trim()) : [],
        ...(model === "lingbot-world-2" ? { promptExpansion: expansion } : {}),
      },
    },
  })

  useEffect(() => {
    let gone = false
    void import("@/lib/world-examples").then(m => { if (!gone) setExamples(m.WORLD_EXAMPLES) })
    return () => { gone = true }
  }, [])
  const modelExamples = examples?.[model] ?? []

  /** A template fills the form (or, live, restarts the world with it). */
  const applyTemplate = (ex: WorldExample) => {
    const p = ex.payload
    const img = typeof p.image_url === "string" ? p.image_url : null
    const pre = typeof p.preset === "string" ? p.preset : null
    const text = typeof p.prompt === "string" ? p.prompt.slice(0, 2000) : ""
    if (s.status === "live") {
      restart(img ? { image_url: img, ...(text ? { prompt: text } : {}) } : pre ? { preset: pre } : { ...(text ? { prompt: text } : {}) })
      setTemplate(ex.name)
      return
    }
    setTemplate(ex.name)
    setPicture(img)
    setPreset(img ? null : pre)
    setDescription(text)
    if (isLingbot && Array.isArray(p.quick_actions) && p.quick_actions.length) {
      setActions(p.quick_actions.slice(0, 9).map((a: any) => ({ title: String(a.title ?? ""), description: String(a.description ?? "") })))
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setNotice(null)
    try {
      const url = await uploadLiveMedia(file)
      setPicture(url)
      setPreset(null)
      setTemplate(null)
      onUploaded?.(url)
    } catch (e: any) {
      setNotice(String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }
  const live = s.status === "live" || s.status === "connecting"
  const b = useWorldBuilder(buildTool, picture, onBalanceChange)
  const building = mode === "build"

  // A later pick on the Home page (never mid-session)
  useEffect(() => {
    if (!pick || live) return
    if ((BUILD_TOOL_IDS as string[]).includes(pick.id)) { setMode("build"); setBuildTool(pick.id as BuildToolId); return }
    if (!(WORLD_MODELS as string[]).includes(pick.id)) return
    setMode("live"); setModel(pick.id as WmaModelId); setPresets([]); setPreset(null); setTemplate(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick?.id, pick?.n])

  // The stream goes on the video element as soon as it exists
  useEffect(() => {
    const v = videoRef.current
    if (v && v.srcObject !== s.stream) v.srcObject = s.stream
  }, [s.stream])

  // A world update that never answers stops blocking the next one
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setPending(null), 30_000)
    return () => clearTimeout(t)
  }, [pending])

  const actionList = useCallback(() => actions
    .map((a, i) => ({ key: i + 1, title: a.title.trim().slice(0, 40), description: a.description.trim().slice(0, 1000) }))
    .filter(a => a.title && a.description), [actions])

  const goLive = () => {
    setNotice(null)
    setEffective(null)
    setSavedId(null)
    setReadyKeys({})
    s.start()
    // Setup is optional and once per session: the picture, the description and
    // (Lingbot) the quick actions go out together - queued until the session is up
    const qa = isLingbot ? actionList() : []
    // Lingbot's switches: expansion as chosen; safety ON unless an admin switched it off
    const lingbotFlags = isLingbot ? { enable_prompt_expansion: expansion, enable_safety_checker: isAdmin ? safety : true } : {}
    if (picture || preset || description.trim() || qa.length || isLingbot) {
      setPending("configure")
      s.send({
        type: "configure",
        // fal: a picture wins over a preset
        ...(picture ? { image_url: picture } : preset ? { preset } : {}),
        ...(description.trim() ? { prompt: description.trim().slice(0, 2000) } : {}),
        ...(isLingbot && qa.length ? { quick_actions: qa } : {}),
        ...lingbotFlags,
      })
    }
  }

  // ── Controls: held commands in `active`, new presses in `activated` ──
  const heldSet = useRef(new Set<string>())
  const fresh = useRef(new Set<string>())
  const report = useCallback(() => {
    s.send({ type: "commands", active: [...heldSet.current], activated: [...fresh.current] })
    fresh.current.clear()
    setHeld([...heldSet.current])
  }, [s.send])
  const press = useCallback((c: string) => {
    if (heldSet.current.has(c)) return
    heldSet.current.add(c)
    fresh.current.add(c)
    report()
  }, [report])
  const release = useCallback((c: string) => {
    if (!heldSet.current.delete(c)) return
    report()
  }, [report])
  const releaseAll = useCallback(() => {
    if (!heldSet.current.size) return
    heldSet.current.clear()
    report()
  }, [report])

  useEffect(() => {
    if (s.status !== "live") { heldSet.current.clear(); fresh.current.clear(); setHeld([]); return }
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    }
    const cmdFor = (e: KeyboardEvent): string | null => {
      if (MOVE_KEYS[e.code]) return MOVE_KEYS[e.code]
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      return n && isLingbot ? `quick_action_${n}` : null
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const c = cmdFor(e)
      if (!c) return
      e.preventDefault()
      press(c)
    }
    const up = (e: KeyboardEvent) => { const c = cmdFor(e); if (c) release(c) }
    // Focus leaving the world releases everything (the docs ask for empty arrays then)
    const blur = () => releaseAll()
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur) }
  }, [s.status, isLingbot, press, release, releaseAll])

  // Holding a control keeps the session from timing out as idle
  useEffect(() => {
    if (!held.length) return
    const t = setInterval(() => s.touch(), 5_000)
    return () => clearInterval(t)
  }, [held.length, s.touch])

  /** Holds exactly `on` out of a group of commands (a stick, or the look-drag). */
  const setGroup = useCallback((group: readonly string[], on: string[]) => {
    let changed = false
    for (const c of group) {
      if (on.includes(c)) { if (!heldSet.current.has(c)) { heldSet.current.add(c); fresh.current.add(c); changed = true } }
      else if (heldSet.current.delete(c)) changed = true
    }
    if (changed) report()
  }, [report])

  // Dragging a finger (or the mouse) on the picture looks around: the further
  // from where the drag started, the more it turns - held until let go
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const onStageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (s.status !== "live" || drag.current) return
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    capture(e)
    setDragAt({ x: e.clientX - r.left, y: e.clientY - r.top })
  }
  const onStageMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || s.status !== "live") return
    setGroup(LOOK_DIRS, dirsFor(e.clientX - d.x, e.clientY - d.y, 18, LOOK_DIRS))
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    drag.current = null
    setDragAt(null)
    setGroup(LOOK_DIRS, [])
  }

  const autofill = async () => {
    if (filling) return
    setFilling(true)
    setNotice(null)
    try {
      const r = await fetch("/api/realtime/wma/actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: fillCount, idea: fillIdea.trim(), world: description.trim(), picture: picture ?? undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !Array.isArray(j.actions)) throw new Error(j.error || "Autofill failed")
      setUndoActions(actions)
      setActions(j.actions.slice(0, 9))
      if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
    } catch (e: any) {
      setNotice(String(e?.message || e))
    } finally {
      setFilling(false)
    }
  }

  const updateWorld = () => {
    const p = nextPrompt.trim()
    if (!p || pending || s.status !== "live") return
    setPending("prompt")
    s.send({ type: "prompt", prompt: p.slice(0, 2000) })
    setNextPrompt("")
  }
  const restart = (from: { preset?: string; image_url?: string; prompt?: string }) => {
    if (pending || s.status !== "live") return
    setPending("reset")
    s.send({ type: "reset", ...from })
  }
  const pushActions = () => {
    if (!isLingbot || s.status !== "live") return
    s.send({ type: "quick_actions", actions: actionList() })
  }

  const toggleRecord = async () => {
    if (!s.recording) {
      if (!s.startRecording()) setNotice("This browser can't record the stream")
      else recFrom.current = s.position().at
      return
    }
    const to = s.position().at
    const poster = grabPoster(videoRef.current)
    const clip = await s.finishRecording()
    if (!clip) return
    setSaving(true)
    try {
      const row = await saveLiveClip(clip, { model, prompt: effective || description || "World walk", poster, aspectRatio: model === "abot-world-0" ? "20:11" : "26:15" })
      setSavedId(row.id)
      // Swapped for fal's full-quality recording when the session ends
      s.noteClip(row.id, recFrom.current, to)
      onSaved?.({ ...row, model })
    } catch (e: any) {
      setNotice(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const rate = wmaBlockTickets(model)
  const pictures = useMemo(() => refLibrary.filter(r => !/\.(glb|gltf|fbx|obj|usdz|stl|mp4|webm|mov)(\?|$)/i.test(r.url)).slice(0, 60), [refLibrary])
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`

  // ── Starting points: an example, one of your pictures (Refs / My Generations / My Assets / upload), or the model's own world ──
  const startFrom = (url: string) => {
    if (s.status === "live") { restart({ image_url: url, ...(description.trim() ? { prompt: description.trim().slice(0, 2000) } : {}) }); return }
    setPicture(url); setPreset(null); setTemplate(null)
  }
  const fromLibrary = async () => {
    const [url] = await openLibraryPicker({ max: 1, title: s.status === "live" ? "Restart the world from…" : "Start the world from…" })
    if (url) startFrom(url)
  }
  const exampleNow = template ? modelExamples.find(e => e.name === template) : undefined
  const startingThumb = picture ?? exampleNow?.thumb ?? null
  const startingLabel = picture ? (exampleNow ? exampleNow.name : "Your picture") : exampleNow ? exampleNow.name : preset ? `fal's ${preset.replace(/[-_]/g, " ")} world` : mode === "build" ? "Pick a picture to build from" : "The model's own world"

  const label = "text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500"
  const panel = "relative rounded-2xl silver-edge bg-[#070b14]/80 p-3 sm:p-4"
  const ratio = mode === "build" ? 16 / 9 : model === "abot-world-0" ? 1280 / 704 : 1664 / 960

  /* The start-from panel: under the world on a laptop / tablet (wide grids),
     its own column on a big monitor, under the world on a phone */
  const startPanel = (
    <section className={panel}>
      <BrandTitle title={s.status === "live" ? "Restart from" : "Start from"} eyebrow="an example · your pictures · the model's world" logo={16} size="sm"
        right={modelExamples.length > 0 ? (
          <button onClick={() => applyTemplate(modelExamples[Math.floor(Math.random() * modelExamples.length)])} disabled={!!pending}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10.5px] text-slate-300 hover:bg-white/10 disabled:opacity-50"><Shuffle size={11} /> Surprise me</button>
        ) : undefined} />

      {/* What it starts from now */}
      {s.status !== "live" && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-2">
          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
            {startingThumb
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={startingThumb} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center"><Globe2 size={16} className="text-slate-500" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <p className={label}>Starting point</p>
            <p className="truncate text-[12.5px] font-semibold text-white">{startingLabel}</p>
          </div>
          {(picture || preset || template) && (
            <button onClick={() => { setPicture(null); setPreset(null); setTemplate(null) }} className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-white" aria-label="Use the model's own world"><X size={14} /></button>
          )}
        </div>
      )}

      {/* Tabs (Build starts from your own picture - fal's examples are live-world setups) */}
      {!building && <div className="mt-3 flex items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
        {([["examples", `Examples · ${modelExamples.length}`], ["mine", `Your Refs · ${pictures.length}`]] as const).map(([id, text]) => (
          <button key={id} onClick={() => setStartTab(id)}
            className={`relative flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-bold transition-colors ${startTab === id ? "bg-white/[0.12] text-white" : "text-slate-400 hover:text-white"}`}>{text}</button>
        ))}
      </div>}

      {startTab === "examples" && !building ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-2 min-[2600px]:grid-cols-3 2xl:max-h-[calc(100dvh-330px)] 2xl:overflow-y-auto 2xl:pr-1">
          {modelExamples.map(ex => (
            <button key={ex.name} onClick={() => applyTemplate(ex)} disabled={!!pending} title={ex.summary}
              className={`group relative overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-60 ${template === ex.name ? "border-white/60" : "border-white/10 hover:border-white/30"}`}>
              {template === ex.name && <SilverRimOverlay rounded="rounded-xl" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ex.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
              <span className="block px-2 py-1.5"><span className="block truncate text-[11.5px] font-semibold text-white">{ex.name}</span><span className="block truncate text-[10px] text-slate-500">{ex.category}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BrandButton onClick={() => void fromLibrary()} size="sm" className="w-full" title="Pick from My Generations or My Assets"><Library size={11} /> My Generations &amp; Assets</BrandButton>
            <BrandButton onClick={() => uploadInput.current?.click()} disabled={uploading || s.status === "live"} busy={uploading} size="sm" className="w-full" title="Upload a picture (kept in your Refs)"><Upload size={11} /> Upload</BrandButton>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-4 min-[2600px]:grid-cols-5 max-h-72 overflow-y-auto pr-0.5 2xl:max-h-[calc(100dvh-400px)]">
            {!building && <button onClick={() => (s.status === "live" ? restart({ prompt: description.trim() || undefined }) : (setPicture(null), setPreset(null), setTemplate(null)))}
              className={`aspect-square rounded-lg border text-[10px] font-semibold flex flex-col items-center justify-center gap-1 ${!picture && !preset && !template && s.status !== "live" ? "border-white/50 bg-white/[0.08] text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
              title={s.status === "live" ? "Restart in the model's own world" : "No picture - the model's own world"}
            ><Globe2 size={15} />Model&apos;s world</button>}
            {pictures.map(r => (
              <button key={r.id} onClick={() => startFrom(r.url)}
                className={`relative aspect-square overflow-hidden rounded-lg border ${picture === r.url && s.status !== "live" ? "border-white ring-2 ring-white/40" : "border-white/10 hover:border-white/30"}`}
                title={s.status === "live" ? "Restart the world from this picture" : "Start from this picture"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          {!pictures.length && <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-500"><ImageIcon size={12} /> Your Refs library is empty - upload, or pick from My Generations</p>}
        </>
      )}
      <input ref={uploadInput} type="file" accept="image/*" className="hidden" onChange={e => { void upload(e.target.files?.[0]); e.target.value = "" }} />
    </section>
  )

  const describePanel = (
    <section className={panel}>
      {s.status !== "live" ? (
        <>
          <p className={`${label} mb-2`}>World description <span className="normal-case tracking-normal">(optional)</span></p>
          <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, 2000))} rows={4}
            placeholder="e.g. A misty pine forest at dawn, a dirt trail winding toward a lake, third-person camera behind a hiker in a red jacket"
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
        </>
      ) : (
        <>
          <p className={`${label} mb-2`}>Change the world</p>
          <div className="flex gap-2">
            <textarea value={nextPrompt} onChange={e => { setNextPrompt(e.target.value.slice(0, 2000)); s.touch() }} rows={3}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); updateWorld() } }}
              placeholder="e.g. It starts to snow heavily"
              className="min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
            <BrandButton onClick={updateWorld} disabled={!nextPrompt.trim() || !!pending} busy={pending === "prompt"} size="sm" primary className="self-end" title="Apply"><Send size={11} /></BrandButton>
          </div>
          <button onClick={() => restart({ ...(picture ? { image_url: picture } : preset ? { preset } : {}), ...(description.trim() ? { prompt: description.trim().slice(0, 2000) } : {}) })} disabled={!!pending}
            className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-slate-400 hover:text-white disabled:opacity-40"
          ><RotateCcw size={12} /> Restart where it began</button>
        </>
      )}
    </section>
  )

  const actionsPanel = isLingbot ? (
    <section className={panel}>
      <BrandTitle title="Actions on 1-9" eyebrow="hold a key - or its button on the world" logo={16} size="sm"
        right={actions.length < 9 ? <button onClick={() => setActions(a => [...a, { title: "", description: "" }])} className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white"><Plus size={12} /> Add</button> : undefined} />
      {/* Autofill with AI: Gemini writes the actions from a few words (and the starting picture) */}
      <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-2.5">
        <div className="flex items-center gap-1.5">
          <input value={fillIdea} onChange={e => setFillIdea(e.target.value.slice(0, 1000))}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void autofill() } }}
            placeholder="e.g. jump, crouch, wave - or: knight fighting moves"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white placeholder:text-slate-600 focus:outline-none" />
          <select value={fillCount} onChange={e => setFillCount(Number(e.target.value))} aria-label="How many actions"
            className="rounded-lg border border-white/10 bg-black/40 px-1 py-1.5 text-[12px] text-white">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <BrandButton onClick={() => void autofill()} disabled={filling || (!fillIdea.trim() && !description.trim() && !picture)} busy={filling} size="sm" primary
            title={`Gemini writes ${fillCount} action${fillCount === 1 ? "" : "s"} that fit your world - ${WORLD_ACTIONS_TICKETS} ticket (your free daily AI actions are used first)`}
          >Autofill {fillCount} with AI · {WORLD_ACTIONS_TICKETS} ticket</BrandButton>
          {undoActions && !filling && <button onClick={() => { setActions(undoActions); setUndoActions(null) }} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"><Undo2 size={11} /> Undo</button>}
        </div>
        <p className="mt-1.5 text-[10.5px] text-slate-500">Uses your idea, the world description and the starting picture. Replaces the list below.</p>
      </div>
      {!actions.length && <p className="mt-2 text-[11.5px] text-slate-500">Or add them by hand: e.g. 1 = &quot;Jump - the character leaps into the air and lands on the path&quot;.</p>}
      <div className="mt-2 space-y-2">
        {actions.map((a, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-black/25 p-2">
            <div className="flex items-center gap-2">
              <button type="button" disabled={s.status !== "live"}
                onPointerDown={() => press(`quick_action_${i + 1}`)} onPointerUp={() => release(`quick_action_${i + 1}`)} onPointerLeave={() => release(`quick_action_${i + 1}`)}
                className={`h-6 w-6 shrink-0 rounded-md border text-[11px] font-black ${held.includes(`quick_action_${i + 1}`) ? "border-white bg-white/30 text-white" : readyKeys[i + 1] ? "border-emerald-400/40 text-emerald-200" : "border-white/20 text-slate-300"}`}
                title={s.status === "live" ? "Hold to do it" : undefined}
              >{i + 1}</button>
              <input value={a.title} onChange={e => setActions(x => x.map((y, j) => (j === i ? { ...y, title: e.target.value.slice(0, 40) } : y)))} placeholder="Name"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white placeholder:text-slate-600 focus:outline-none" />
              <button onClick={() => setActions(x => x.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300" aria-label="Remove"><Trash2 size={13} /></button>
            </div>
            <textarea value={a.description} onChange={e => setActions(x => x.map((y, j) => (j === i ? { ...y, description: e.target.value.slice(0, 1000) } : y)))} rows={2}
              placeholder="What happens while the key is held"
              className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11.5px] text-white placeholder:text-slate-600 focus:outline-none" />
          </div>
        ))}
      </div>
      {s.status === "live" && actions.length > 0 && <BrandButton onClick={pushActions} size="sm" className="mt-2 w-full">Send these actions to the world</BrandButton>}
    </section>
  ) : null

  const settingsPanel = (
    <section className={`${panel} space-y-2.5`}>
      <p className={label}>Settings</p>
      {isLingbot && (
        <>
          <label className="flex items-start gap-2 text-[12px] text-slate-300">
            <input type="checkbox" className="mt-0.5" checked={expansion} disabled={live} onChange={e => setExpansion(e.target.checked)} />
            <span>Prompt expansion <span className="block text-[10.5px] text-slate-500">An AI rewrites your description, changes and actions into detailed prompts. Off sends your words as written.</span></span>
          </label>
          <label className={`flex items-start gap-2 text-[12px] ${isAdmin ? "text-slate-300" : "text-slate-500"}`}>
            <input type="checkbox" className="mt-0.5" checked={isAdmin ? safety : true} disabled={live || !isAdmin} onChange={e => setSafety(e.target.checked)} />
            <span className="flex items-center gap-1"><Shield size={11} /> Safety checker {isAdmin ? <span className="text-[10.5px] text-slate-500">(admin can switch off)</span> : <span className="text-[10.5px]">- always on</span>}</span>
          </label>
        </>
      )}
      <div className="space-y-1 border-t border-white/[0.06] pt-2.5 text-[11.5px] text-slate-400">
        <p><span className="font-semibold text-slate-300">{spec.name}</span> - {spec.blurb}.</p>
        <p>{rate} tickets per {WMA_BLOCK_SEC} seconds, from the first frame (warming up is free). It ends when you leave the tab, or after {Math.round(WORLD_IDLE_MS / 1000)}s without moving. Admins are not charged.</p>
        <p className="text-slate-300">Every session is kept: when it ends, the whole walk saves to your video feed in full quality (with the world&apos;s setup). Record marks highlights to keep as separate clips.</p>
      </div>
    </section>
  )

  return (
    <div className="mx-auto w-full max-w-[3400px] px-3 sm:px-5 lg:px-8 2xl:px-10 py-4 sm:py-5">
      {/* Header: the brand, the model, the price */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <BrandTitle title="Worlds" eyebrow="World models · admin" logo={34} size="lg" />
          <p className="mt-1.5 max-w-2xl text-[12.5px] text-slate-400">{building ? "Turn one picture into a world you keep - a 360° environment or a photoreal splat." : "Walk around a world the model builds as you go. Billed only while it streams."}</p>
        </div>
        {/* Every world model: the live ones you walk, and the builders that make a world to keep */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-stretch">
          {([...WORLD_MODELS.map(id => ({ id: id as string, kind: "Live" as const, name: WMA_MODELS[id].name, sub: `${WMA_MODELS[id].maker} · ${wmaBlockTickets(id)} tickets / ${WMA_BLOCK_SEC}s` })),
            ...BUILD_TOOL_IDS.map(id => ({ id: id as string, kind: "Build" as const, name: BUILD_NAMES[id].name, sub: `${BUILD_NAMES[id].maker} · ${toolTickets(getTool(id)!, {}, 1)} tickets` }))]).map(m => {
            const on = m.kind === "Live" ? mode === "live" && model === m.id : mode === "build" && buildTool === m.id
            return (
              <button key={m.id} disabled={live}
                onClick={() => { if (m.kind === "Live") { setMode("live"); setModel(m.id as WmaModelId); setPresets([]); setPreset(null); setTemplate(null) } else { setMode("build"); setBuildTool(m.id as BuildToolId); setStartTab("mine"); setPreset(null); setTemplate(null) } }}
                className={`relative overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60 sm:min-w-[160px] ${on ? "border-white/40 bg-white/[0.10]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
                {on && <SilverRimOverlay rounded="rounded-xl" />}
                <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-slate-500">{m.kind === "Live" ? "Live world" : "Build a world"}</span>
                <span className="block text-[12.5px] font-black text-white">{m.name}</span>
                <span className="block text-[10.5px] text-slate-400">{m.sub}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] 2xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_minmax(320px,400px)] min-[2600px]:grid-cols-[460px_minmax(0,1fr)_460px] 2xl:gap-6">
        {/* The world - sized to the screen's height, so a wide monitor shows all of it */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 2xl:col-start-2">
          <div className="relative mx-auto w-full" style={{ maxWidth: `calc((100dvh - 260px) * ${ratio.toFixed(4)})`, minWidth: 0 }}>
            <div
              className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black ${s.status === "live" && !building ? "touch-none select-none cursor-grab" : ""}`}
              style={{ aspectRatio: String(ratio) }}
              onPointerDown={building ? undefined : onStageDown} onPointerMove={building ? undefined : onStageMove} onPointerUp={building ? undefined : endDrag} onPointerCancel={building ? undefined : endDrag}
            >
              {building ? <BuildStage b={b} /> : <>
              <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain"
                onPlaying={() => s.markFrame()} onLoadedData={() => s.markFrame()} />
              {s.status !== "live" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  {/* the chosen starting point, dimmed, behind the message */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {startingThumb && s.status === "idle" && <img src={startingThumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
                  <div className="relative"><SiteLogoBox size={s.status === "connecting" ? 56 : 48} rounded={14} /></div>
                  <p className="relative max-w-md text-[13px] text-slate-300">
                    {s.status === "connecting" ? "Building the world - the first frames can take a little while"
                      : s.status === "ended" || s.status === "error" ? "The session has ended"
                      : "Pick a starting point, then press Go Live"}
                  </p>
                </div>
              )}
              {/* Status + meter */}
              <div className="absolute left-3 top-3 z-40 flex flex-wrap items-center gap-1.5">
                {s.status === "live" && <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-black/50 px-2.5 py-1 text-[10.5px] font-bold text-emerald-200 backdrop-blur"><Radio size={11} /> Live {mmss(s.liveSec)}</span>}
                {s.recording && <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-black/50 px-2.5 py-1 text-[10.5px] font-bold text-rose-200 backdrop-blur"><Circle size={9} className="fill-rose-400 text-rose-400 animate-pulse" /> Rec {mmss(s.recordSec)}</span>}
                {pending && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 backdrop-blur"><Loader2 size={11} className="animate-spin" /> {pending === "configure" ? "Setting up your world" : pending === "reset" ? "Restarting" : "Updating the world"}</span>}
              </div>
              {/* Touch controls: move stick, look stick, drag anywhere to look, held actions */}
              {dragAt && <span className="pointer-events-none absolute z-40 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50" style={{ left: dragAt.x, top: dragAt.y }} />}
              {s.status === "live" && (
                <>
                  <div className="absolute bottom-3 left-3 z-40"><Stick label="Move" dirs={MOVE_DIRS} onDirs={on => setGroup(MOVE_DIRS, on)} /></div>
                  <div className="absolute bottom-3 right-3 z-40"><Stick label="Look" dirs={LOOK_DIRS} onDirs={on => setGroup(LOOK_DIRS, on)} /></div>
                  {isLingbot && actionList().length > 0 && (
                    <div className="absolute bottom-3 left-1/2 z-40 flex max-w-[calc(100%-260px)] -translate-x-1/2 flex-wrap justify-center gap-1.5">
                      {actionList().map(a => (
                        <HoldButton key={a.key} label={`Hold for: ${a.title}`} active={held.includes(`quick_action_${a.key}`)}
                          onHold={down => (down ? press : release)(`quick_action_${a.key}`)}
                        ><span className="mr-1 opacity-60">{a.key}</span>{a.title}</HoldButton>
                      ))}
                    </div>
                  )}
                </>
              )}
              </>}
            </div>
            {/* The page's one animated rim: the world itself */}
            <SilverRimOverlay rounded="rounded-2xl" />
          </div>

          {/* Live bar */}
          <div className="mx-auto mt-3 flex w-full flex-wrap items-center gap-2" style={{ maxWidth: `calc((100dvh - 260px) * ${ratio.toFixed(4)})` }}>
            {building ? <BuildBar b={b} /> : !live ? (
              <BrandButton onClick={goLive} primary size="lg" title={`Opens a live world - ${rate} tickets per ${WMA_BLOCK_SEC} seconds while it streams, from the first frame`}>
                Go Live <span className="text-[10.5px] font-semibold opacity-70">{rate} tickets / {WMA_BLOCK_SEC}s</span>
              </BrandButton>
            ) : (
              <BrandButton onClick={() => s.stop("ended")} size="lg" busy={s.status === "connecting"}>End session</BrandButton>
            )}
            {!building && s.status === "live" && (
              <BrandButton onClick={toggleRecord} disabled={saving} busy={saving} size="lg" warn={s.recording}
                icon={s.recording ? <Save size={14} /> : <Circle size={12} className="fill-rose-400 text-rose-400" />}
              >{s.recording ? "Stop & save clip" : "Record"}</BrandButton>
            )}
            {savedId && !saving && <span className="text-[12px] text-emerald-300">Saved to your feed</span>}
            {!building && <span className="w-full text-[11.5px] text-slate-500 sm:ml-auto sm:w-auto">
              {s.status === "live" && <>Saves to your feed when it ends · </>}{s.tickets > 0 && <>{s.tickets} tickets this session · </>}WASD or the left stick to move · arrows, the right stick or a drag to look{isLingbot ? " · hold 1-9 for actions" : ""}
            </span>}
            {building && <span className="w-full text-[11.5px] text-slate-500 sm:ml-auto sm:w-auto">{b.sel ? (b.sel.toolId === "hunyuan-world" ? "Drag to look around · scroll or pinch to zoom" : "Drag to orbit · scroll or pinch to zoom") : "Builds keep going if you leave"}</span>}
          </div>
          <div className="mx-auto w-full" style={{ maxWidth: `calc((100dvh - 260px) * ${ratio.toFixed(4)})` }}>
            {s.upgrade && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {s.upgrade && (
                  <p className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${s.upgrade.state === "failed" ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-white/15 bg-white/[0.05] text-slate-100"}`}>
                    {s.upgrade.state === "working" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}<span>{s.upgrade.text}</span>
                  </p>
                )}

              </div>
            )}
            {(s.error || notice) && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                <span className="flex-1">{s.error || notice}</span>
                <button onClick={() => { s.setError(null); setNotice(null) }} aria-label="Dismiss"><X size={13} /></button>
              </p>
            )}
            {effective && <p className="mt-2 line-clamp-2 text-[11.5px] text-slate-500"><span className="font-semibold text-slate-400">World now: </span>{effective}</p>}
          </div>
        </div>

        {/* Start from - under the world (laptop / tablet / phone), its own column on a big monitor */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 2xl:col-start-1 2xl:row-start-1">
          {startPanel}
        </div>

        {/* Describe, actions, settings */}
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 2xl:col-start-3 2xl:row-span-1">
          {building ? <BuildRail b={b} panel={panel} label={label} /> : <>
            {describePanel}
            {actionsPanel}
            {settingsPanel}
          </>}
        </div>
      </div>
    </div>
  )
}
