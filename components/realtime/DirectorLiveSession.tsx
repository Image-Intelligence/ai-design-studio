"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronDown, Clapperboard, Dices, ImagePlus, Loader2, Music, Plus, Power, Radio, Send, Shuffle, Sparkles,
  Square, Trash2, Volume2, VolumeX, X,
} from "lucide-react"
import {
  WMA_BLOCK_SEC, wmaBlockTickets, DIRECTOR_RESOLUTIONS, DIRECTOR_ASPECTS, DIRECTOR_MAX_REFS,
} from "@/lib/realtime-wma"
import type { WorldExample } from "@/lib/world-examples"
import { useWmaSession, uploadLiveMedia } from "@/components/realtime/useWmaSession"
import { AdminTag } from "@/components/ui/admin-mark"

/**
 * H3 Max Director live (2026-10-16, ADMIN ONLY while under test) - opened by
 * Generate ("Go Live") with "H3 Max Director" picked in the video models.
 *
 * MiniMax's reference director plays ONE continuous film, with sound, that you
 * steer while it runs: a prompt and up to nine named references (a character
 * called "Nora" can be written into the prompt by name), then new directions
 * that take over at the next chunk.
 *
 * Every input fal's own playground offers is here (the owner asked for parity):
 * fal's example templates, named references with their detail level,
 * reference audio, size and shape, and the advanced settings - pin audio,
 * memory, audio bitrate, seed, steps, MXFP8 attention, forced cuts and
 * dialogue pace. They go out in the session's one configure message.
 *
 * NOTHING TO RECORD BY HAND: the user pays for every second, so the whole take
 * is kept - when it ends (End take, closing this, leaving the tab, idling out)
 * fal's own FULL-QUALITY recording of it is saved to the feed automatically
 * (/api/realtime/wma/upgrade, whole: true; owner's call 2026-10-16). The live
 * stream on screen is compressed for delivery; the saved film is not.
 *
 * The session (WebRTC through /api/realtime/wma, paid in 30-second blocks from
 * the first frame) is components/realtime/useWmaSession.
 */

const MODEL = "minimax-h3-max-director" as const
/** Ended after this long without a new direction (it keeps generating - and billing - on its own). */
const DIRECTOR_IDLE_MS = 120_000
const FIDELITY = ["high", "medium", "low"] as const

interface Ref { url: string; name: string; fidelity: (typeof FIDELITY)[number] }
interface AudioRef { url: string; name: string }

/** Advanced settings, as fal's configure message names them ("" = fal's default). */
interface Advanced {
  seed: string
  pinAudio: boolean
  memory: string
  audioBitrate: "" | "96000" | "128000" | "192000"
  steps: string
  mxfp8: boolean
  forcedCut: string
  wordsPerSecond: string
}
const DEFAULT_ADVANCED: Advanced = { seed: "", pinAudio: false, memory: "12", audioBitrate: "", steps: "10", mxfp8: false, forcedCut: "", wordsPerSecond: "2" }

const num = (v: string, min: number, max: number): number | undefined => {
  if (v.trim() === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

export function DirectorLiveSession({ initialPrompt, refs: initialRefs, resolution: initialRes, aspectRatio: initialAspect, refLibrary = [], onClose, onBalanceChange, onUpgraded }: {
  initialPrompt: string
  refs: string[]
  resolution?: string
  aspectRatio?: string
  /** The account's Refs library, to add references from */
  refLibrary?: { id: string | number; url: string }[]
  onClose: () => void
  onBalanceChange?: (balance: number) => void
  /** The take was saved to the feed (fal's full-quality recording) */
  onUpgraded?: Parameters<typeof useWmaSession>[0]["onUpgraded"]
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [refs, setRefs] = useState<Ref[]>(() => initialRefs.slice(0, DIRECTOR_MAX_REFS).map((url, i) => ({ url, name: `Ref ${i + 1}`, fidelity: "high" })))
  const [audio, setAudio] = useState<AudioRef[]>([])
  const [resolution, setResolution] = useState<string>(() => (DIRECTOR_RESOLUTIONS as readonly string[]).includes(initialRes ?? "") ? initialRes! : "768p")
  const [aspect, setAspect] = useState<string>(() => (DIRECTOR_ASPECTS as readonly string[]).includes(initialAspect ?? "") ? initialAspect! : "16:9")
  const [adv, setAdv] = useState<Advanced>(DEFAULT_ADVANCED)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [examples, setExamples] = useState<WorldExample[]>([])
  const [template, setTemplate] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [direction, setDirection] = useState("")
  const [version, setVersion] = useState(1)
  const [phase, setPhase] = useState<string | null>(null)
  const [played, setPlayed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [streamSize, setStreamSize] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioInput = useRef<HTMLInputElement | null>(null)

  // fal's example films (a big file - loaded only when this opens)
  useEffect(() => {
    let gone = false
    void import("@/lib/world-examples").then(m => { if (!gone) setExamples(m.WORLD_EXAMPLES[MODEL]) })
    return () => { gone = true }
  }, [])

  const onMessage = useCallback((msg: any) => {
    switch (msg?.type) {
      case "configured": setPhase("Shooting the opening"); break
      case "prompt_pending": setPhase("New direction queued"); break
      case "prompt_applied": setPhase("Direction taken"); break
      case "prompt_rejected": setPhase(null); setNotice(`Direction not taken: ${msg.error || msg.reason || "rejected"}`); break
      case "audio_rejected": setNotice(`Reference audio not used: ${msg.error || msg.reason || "rejected"}`); break
      case "chunk":
        if (typeof msg.playback_seconds === "number") setPlayed(Math.round(msg.playback_seconds))
        setPhase(p => (p === "Shooting the opening" ? null : p))
        break
      case "error": if (msg.error) setNotice(String(msg.error)); break
    }
  }, [])

  const s = useWmaSession({
    model: MODEL, resolution, idleMs: DIRECTOR_IDLE_MS, onMessage, onBalanceChange, onUpgraded,
    // The whole take goes to the feed, full quality, when it ends
    autoSaveWhole: { prompt: prompt.trim(), aspectRatio: aspect, resolution },
  })
  const live = s.status === "live" || s.status === "connecting"

  useEffect(() => {
    const v = videoRef.current
    if (!v || v.srcObject === s.stream) return
    v.srcObject = s.stream
    // Sound plays when the browser allows it (Go Live was a click); else the speaker button turns it on
    if (s.stream) v.play().catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => {}) })
  }, [s.stream])

  const refList = () => refs.filter(r => r.url).map((r, i) => ({ name: (r.name.trim() || `Ref ${i + 1}`).slice(0, 64), url: r.url, fidelity: r.fidelity }))
  const audioList = () => audio.filter(a => a.url).map((a, i) => ({ name: (a.name.trim() || `Sound ${i + 1}`).slice(0, 64), url: a.url }))

  const applyTemplate = (ex: WorldExample) => {
    const p = ex.payload
    setTemplate(ex.name)
    if (typeof p.prompt === "string") setPrompt(p.prompt)
    setRefs((Array.isArray(p.reference_images) ? p.reference_images : []).slice(0, DIRECTOR_MAX_REFS)
      .map((r: any, i: number) => ({ url: String(r.url), name: String(r.name ?? `Ref ${i + 1}`), fidelity: FIDELITY.includes(r.fidelity) ? r.fidelity : "high" })))
    setAudio((Array.isArray(p.reference_audio) ? p.reference_audio : []).slice(0, 3).map((a: any, i: number) => ({ url: String(a.url), name: String(a.name ?? `Sound ${i + 1}`) })))
    if ((DIRECTOR_RESOLUTIONS as readonly string[]).includes(p.resolution)) setResolution(p.resolution)
    if ((DIRECTOR_ASPECTS as readonly string[]).includes(p.aspect_ratio)) setAspect(p.aspect_ratio)
    setAdv({
      seed: p.seed != null ? String(p.seed) : "",
      pinAudio: !!p.pin_audio,
      memory: p.memory != null ? String(p.memory) : DEFAULT_ADVANCED.memory,
      audioBitrate: [96000, 128000, 192000].includes(p.audio_bitrate) ? String(p.audio_bitrate) as Advanced["audioBitrate"] : "",
      steps: p.num_inference_steps != null ? String(p.num_inference_steps) : DEFAULT_ADVANCED.steps,
      mxfp8: !!p.mxfp8_ref2va_attention,
      forcedCut: p.forced_cut_max_segments != null ? String(p.forced_cut_max_segments) : "",
      wordsPerSecond: p.dialogue_words_per_second != null ? String(p.dialogue_words_per_second) : DEFAULT_ADVANCED.wordsPerSecond,
    })
  }

  const goLive = () => {
    if (!prompt.trim()) { setNotice("Describe the film first"); return }
    setNotice(null)
    setPlayed(0)
    setVersion(1)
    setPhase("Casting and lighting")
    s.setUpgrade(null)
    s.start()
    const seed = num(adv.seed, 0, 2 ** 31 - 1)
    const memory = num(adv.memory, 1, 50)
    const steps = num(adv.steps, 1, 50)
    const forced = num(adv.forcedCut, 0, 64)
    const wps = num(adv.wordsPerSecond, 0.5, 6)
    s.send({
      type: "configure", protocol_version: 1, prompt_version: 1,
      prompt: prompt.trim().slice(0, 50000), resolution, aspect_ratio: aspect,
      reference_images: refList(),
      reference_audio: audioList(),
      pin_audio: adv.pinAudio,
      mxfp8_ref2va_attention: adv.mxfp8,
      ...(seed !== undefined ? { seed: Math.round(seed) } : {}),
      ...(memory !== undefined ? { memory: Math.round(memory) } : {}),
      ...(steps !== undefined ? { num_inference_steps: Math.round(steps) } : {}),
      ...(forced !== undefined ? { forced_cut_max_segments: Math.round(forced) } : {}),
      ...(wps !== undefined ? { dialogue_words_per_second: wps } : {}),
      ...(adv.audioBitrate ? { audio_bitrate: Number(adv.audioBitrate) } : {}),
    })
  }

  const direct = () => {
    const p = direction.trim()
    if (!p || s.status !== "live") return
    const v = version + 1
    setVersion(v)
    setPhase("Sending the direction")
    s.send({ type: "prompt", prompt_version: v, prompt: p.slice(0, 50000), replan: true, reference_images: refList(), reference_audio: audioList() })
    setDirection("")
  }

  const addAudio = async (file: File | undefined) => {
    if (!file || audio.length >= 3) return
    setUploading(true)
    try {
      const url = await uploadLiveMedia(file)
      setAudio(a => [...a, { url, name: file.name.replace(/\.[^.]+$/, "").slice(0, 64) || `Sound ${a.length + 1}` }].slice(0, 3))
    } catch (e: any) {
      setNotice(String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  const close = () => { s.stop("ended"); onClose() }
  const rate = wmaBlockTickets(MODEL, resolution)
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`
  const [aw, ah] = aspect.split(":").map(Number)
  const label = "mb-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500"
  const field = "w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white focus:border-white/30 focus:outline-none disabled:opacity-50"
  const libraryPics = refLibrary.filter(r => !/\.(glb|gltf|fbx|obj|usdz|stl|mp4|webm|mov|mp3|wav|m4a)(\?|$)/i.test(r.url)).slice(0, 48)

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="relative w-full max-w-6xl max-h-full overflow-y-auto rounded-2xl border border-white/15 bg-[#070b14] shadow-2xl"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 0 40px rgba(160,180,210,0.08)" }}>
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-[#070b14]/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            {/* H3 Max Director is admin-only (under test) */}
            <div className="flex items-center gap-1.5">
              <p className="whitespace-nowrap text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-tight">Live director</p>
              <AdminTag />
            </div>
            <p className="truncate text-[10px] font-mono text-slate-500 uppercase tracking-[0.18em]">MiniMax H3 Max Director · admin</p>
          </div>
          {s.status === "live" && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/30 px-2.5 py-1 text-[10.5px] font-bold text-emerald-200 whitespace-nowrap"><Radio size={11} /> Live {mmss(s.liveSec)}</span>}
          {s.status === "connecting" && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 whitespace-nowrap"><Loader2 size={11} className="animate-spin" /> Warming up</span>}
          <button onClick={close} className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/10" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-black" style={{ aspectRatio: `${aw} / ${ah}`, maxHeight: "62vh" }}>
              <video ref={videoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-contain"
                onPlaying={() => s.markFrame()} onLoadedData={() => s.markFrame()}
                onResize={e => { const v = e.currentTarget; if (v.videoWidth) setStreamSize(`${v.videoWidth}x${v.videoHeight}`) }} />
              {s.status !== "live" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  {s.status === "connecting" ? <><Loader2 className="animate-spin text-slate-300" size={26} /><p className="text-[13px] text-slate-300">{phase ?? "Starting"} - the first shot can take a little while</p></>
                    : <><Clapperboard className="text-slate-600" size={32} /><p className="text-[13px] text-slate-400">{s.status === "ended" || s.status === "error" ? "The take has ended" : "Pick a template or write the film, name your references, and press Go Live"}</p></>}
                </div>
              )}
              <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                {s.status === "live" && phase && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 backdrop-blur">{phase}</span>}
              </div>
              {s.status === "live" && (
                <button onClick={() => { const v = videoRef.current; if (v) { v.muted = !muted; setMuted(!muted); void v.play().catch(() => {}) } }}
                  className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/50 p-1.5 text-slate-200 backdrop-blur" aria-label={muted ? "Sound on" : "Sound off"}
                >{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
              )}
            </div>

            {s.status === "live" ? (
              <div className="mt-3 flex gap-2">
                <textarea value={direction} onChange={e => { setDirection(e.target.value); s.touch() }} rows={2}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); direct() } }}
                  placeholder="Direct the next moment - e.g. Nora stops and turns to Milo, laughing; the camera pushes in"
                  className="min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
                <button onClick={direct} disabled={!direction.trim()} className="self-end rounded-lg border border-white/15 p-2.5 text-slate-200 hover:bg-white/10 disabled:opacity-40" aria-label="Direct"><Send size={15} /></button>
              </div>
            ) : (
              <textarea value={prompt} onChange={e => { setPrompt(e.target.value.slice(0, 50000)); setTemplate(null) }} rows={5}
                placeholder="The film: the look, who is in it (by their reference names), where, and what happens - e.g. Photorealistic. Nora, in a burgundy jacket, jogs along a harbor at dawn toward a departing ferry."
                className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12.5px] text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none" />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!live ? (
                <button onClick={goLive} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-300 to-amber-200 px-4 py-2 text-[13px] font-black text-black shadow hover:brightness-110"
                  title={`Starts the film - ${rate} tickets per ${WMA_BLOCK_SEC} seconds while it plays, from the first frame`}
                ><Power size={14} /> Go Live <span className="text-[10.5px] font-bold opacity-70">{rate} tickets / {WMA_BLOCK_SEC}s</span></button>
              ) : (
                <button onClick={() => s.stop("ended")} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2 text-[13px] font-bold text-white hover:bg-white/10"><Square size={13} /> End take</button>
              )}
              {s.status === "live" && <span className="text-[11.5px] text-slate-400">The whole take saves to your feed in full quality when it ends</span>}
              {s.status === "live" && <span className="ml-auto text-[11.5px] text-slate-500">{played > 0 && <>{mmss(played)} of film · </>}{streamSize && <>stream {streamSize} · </>}{s.tickets} tickets</span>}
            </div>
            {s.upgrade && (
              <p className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${s.upgrade.state === "failed" ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-sky-400/25 bg-sky-500/10 text-sky-100"}`}>
                {s.upgrade.state === "working" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}<span className="flex-1">{s.upgrade.text}</span>
              </p>
            )}
            {(s.error || notice) && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                <span className="flex-1">{s.error || notice}</span>
                <button onClick={() => { s.setError(null); setNotice(null) }} aria-label="Dismiss"><X size={13} /></button>
              </p>
            )}

            {/* fal's example films */}
            {!live && examples.length > 0 && (
              <section className="mt-4">
                <div className="mb-2 flex items-center gap-2">
                  <p className={`${label} mb-0 flex-1`}>Start with an example</p>
                  <button onClick={() => applyTemplate(examples[Math.floor(Math.random() * examples.length)])} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"><Shuffle size={11} /> Surprise me</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {examples.map(ex => (
                    <button key={ex.name} onClick={() => applyTemplate(ex)} title={ex.summary}
                      className={`overflow-hidden rounded-lg border text-left transition-colors ${template === ex.name ? "border-amber-200/70 ring-2 ring-amber-200/30" : "border-white/10 hover:border-white/30"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ex.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                      <span className="block px-2 py-1.5"><span className="block truncate text-[11.5px] font-semibold text-white">{ex.name}</span><span className="block truncate text-[10px] text-slate-500">{ex.category}</span></span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-3">
            {/* References */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-1.5 flex items-center">
                <p className={`${label} mb-0 flex-1`}>Reference images ({refs.length}/{DIRECTOR_MAX_REFS})</p>
                {!live && refs.length > 0 && <button onClick={() => setRefs([])} className="text-[10.5px] text-slate-500 hover:text-white">Clear</button>}
              </div>
              {!refs.length && <p className="text-[11.5px] text-slate-500">Name each picture (e.g. "Nora") and use the names in the prompt.</p>}
              <div className="space-y-2">
                {refs.map((r, i) => (
                  <div key={`${r.url}-${i}`} className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" className="h-10 w-10 shrink-0 rounded-md border border-white/10 object-cover" />
                    <input value={r.name} onChange={e => setRefs(x => x.map((y, j) => (j === i ? { ...y, name: e.target.value.slice(0, 64) } : y)))}
                      className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white focus:outline-none" placeholder="Name" />
                    <select value={r.fidelity} onChange={e => setRefs(x => x.map((y, j) => (j === i ? { ...y, fidelity: e.target.value as Ref["fidelity"] } : y)))}
                      title="How much detail the model takes from this picture: high 768px, medium 512px, low 256px"
                      className="rounded-md border border-white/10 bg-black/40 px-1 py-1 text-[11px] text-white">
                      {FIDELITY.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button onClick={() => setRefs(x => x.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300" aria-label="Remove"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              {refs.length < DIRECTOR_MAX_REFS && libraryPics.length > 0 && (
                <>
                  <button onClick={() => setShowLibrary(v => !v)} className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-slate-300 hover:text-white"><ImagePlus size={12} /> Add from your Refs</button>
                  {showLibrary && (
                    <div className="mt-2 grid max-h-40 grid-cols-6 gap-1 overflow-y-auto">
                      {libraryPics.map(p => (
                        <button key={p.id} onClick={() => setRefs(x => (x.length >= DIRECTOR_MAX_REFS ? x : [...x, { url: p.url, name: `Ref ${x.length + 1}`, fidelity: "high" }]))}
                          className="aspect-square overflow-hidden rounded border border-white/10 hover:border-white/40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {live && refs.length > 0 && <p className="mt-2 text-[10.5px] text-slate-500">Changes go out with your next direction.</p>}
            </section>

            {/* Reference audio */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className={label}>Reference audio ({audio.length}/3)</p>
              <div className="space-y-1.5">
                {audio.map((a, i) => (
                  <div key={`${a.url}-${i}`} className="flex items-center gap-2">
                    <Music size={13} className="shrink-0 text-slate-400" />
                    <input value={a.name} onChange={e => setAudio(x => x.map((y, j) => (j === i ? { ...y, name: e.target.value.slice(0, 64) } : y)))}
                      className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white focus:outline-none" placeholder="Name (e.g. Nora's voice)" />
                    <button onClick={() => setAudio(x => x.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300" aria-label="Remove"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              {audio.length < 3 && (
                <button onClick={() => audioInput.current?.click()} disabled={uploading} className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-slate-300 hover:text-white disabled:opacity-50">
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add reference audio
                </button>
              )}
              <input ref={audioInput} type="file" accept="audio/*" className="hidden" onChange={e => { void addAudio(e.target.files?.[0]); e.target.value = "" }} />
              <p className="mt-1 text-[10.5px] text-slate-500">A voice or sound to match - name it like a reference and use the name in the prompt.</p>
            </section>

            {/* Size and shape */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className={label + " block"}>Resolution</span>
                  <select value={resolution} disabled={live} onChange={e => setResolution(e.target.value)} className={field}>
                    {DIRECTOR_RESOLUTIONS.map(r => <option key={r} value={r}>{r} · {wmaBlockTickets(MODEL, r)}/{WMA_BLOCK_SEC}s</option>)}
                  </select>
                </label>
                <label className="block"><span className={label + " block"}>Aspect ratio</span>
                  <select value={aspect} disabled={live} onChange={e => setAspect(e.target.value)} className={field}>
                    {DIRECTOR_ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>
            </section>

            {/* Advanced settings - fal's own, set once per take */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03]">
              <button onClick={() => setShowAdvanced(v => !v)} className="flex w-full items-center px-3 py-2.5 text-[12px] font-bold text-slate-200">
                <span className="flex-1 text-left">Advanced settings</span><ChevronDown size={14} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </button>
              {showAdvanced && (
                <div className="space-y-2.5 border-t border-white/10 p-3">
                  <label className="block"><span className={label + " block"}>Seed</span>
                    <div className="flex gap-1.5">
                      <input value={adv.seed} disabled={live} onChange={e => setAdv(a => ({ ...a, seed: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))} placeholder="Random" className={field} />
                      <button disabled={live} onClick={() => setAdv(a => ({ ...a, seed: String(Math.floor(Math.random() * 999999)) }))} className="rounded-md border border-white/10 px-2 text-slate-300 hover:bg-white/10 disabled:opacity-50" aria-label="Random seed"><Dices size={13} /></button>
                    </div>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className={label + " block"}>Steps</span>
                      <input type="number" min={1} max={50} value={adv.steps} disabled={live} onChange={e => setAdv(a => ({ ...a, steps: e.target.value }))} className={field} title="Denoising steps per chunk (1-50, default 10). More is slower - too many and it can fall behind live playback." />
                    </label>
                    <label className="block"><span className={label + " block"}>Memory</span>
                      <input type="number" min={1} max={50} value={adv.memory} disabled={live} onChange={e => setAdv(a => ({ ...a, memory: e.target.value }))} className={field} title="Earlier directions kept as context for new ones (1-50, default 12)" />
                    </label>
                    <label className="block"><span className={label + " block"}>Dialogue words / s</span>
                      <input type="number" min={0.5} max={6} step={0.5} value={adv.wordsPerSecond} disabled={live} onChange={e => setAdv(a => ({ ...a, wordsPerSecond: e.target.value }))} className={field} title="How fast people talk: lower for sparser dialogue, higher for fast talkers (0.5-6, default 2)" />
                    </label>
                    <label className="block"><span className={label + " block"}>Forced cut every</span>
                      <input type="number" min={0} max={64} value={adv.forcedCut} disabled={live} onChange={e => setAdv(a => ({ ...a, forcedCut: e.target.value }))} placeholder="Default" className={field} title="Most segments in one unbroken run before a hard cut opens a fresh shot (0 = never; empty = fal's default)" />
                    </label>
                  </div>
                  <label className="block"><span className={label + " block"}>Audio bitrate</span>
                    <select value={adv.audioBitrate} disabled={live} onChange={e => setAdv(a => ({ ...a, audioBitrate: e.target.value as Advanced["audioBitrate"] }))} className={field}>
                      <option value="">Default (96 kbit/s voice)</option>
                      <option value="96000">96 kbit/s music</option>
                      <option value="128000">128 kbit/s</option>
                      <option value="192000">192 kbit/s</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-slate-300">
                    <input type="checkbox" checked={adv.pinAudio} disabled={live} onChange={e => setAdv(a => ({ ...a, pinAudio: e.target.checked }))} /> Pin audio <span className="text-[10.5px] text-slate-500">(keep the reference audio's timing fixed)</span>
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-slate-300">
                    <input type="checkbox" checked={adv.mxfp8} disabled={live} onChange={e => setAdv(a => ({ ...a, mxfp8: e.target.checked }))} /> MXFP8 attention <span className="text-[10.5px] text-slate-500">(faster dense steps)</span>
                  </label>
                  <button disabled={live} onClick={() => setAdv(DEFAULT_ADVANCED)} className="text-[11px] text-slate-500 hover:text-white disabled:opacity-50">Reset to fal's defaults</button>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11.5px] text-slate-400 space-y-1">
              <p>{rate} tickets per {WMA_BLOCK_SEC} seconds while the film plays, from its first frame (warming up is free). A take runs up to 15 minutes; it ends when you close this, leave the tab, or give no direction for {Math.round(DIRECTOR_IDLE_MS / 60000)} minutes. Admins are not charged.</p>
              <p>Nothing to record: when the take ends, the whole film - full quality, with its sound - is saved to your video feed automatically. The picture here is the live preview (compressed for streaming); the saved film is sharper.</p>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
