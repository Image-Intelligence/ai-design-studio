"use client"

/*
 * AUDIO STUDIO - portal-v2's audio mode (ADMIN ONLY while in development).
 *
 * Same shape as the video mode: a settings sidebar on the left (desktop) or a
 * drawer (mobile), the session feed in the middle, and the prompt bar fixed
 * to the bottom. Everything about a model - its controls, its price, how its
 * request is built - comes from lib/audio-studio, which the API routes read
 * too, so what this screen shows is what the server does.
 *
 * Runs go through /api/audio/generate and are settled by polling
 * /api/audio/status. Pending runs are kept in localStorage so a reload picks
 * them up again, and finished ones join the feed of past audio
 * (/api/my-images?type=audio).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2, Music, Pause, Play, SlidersHorizontal, Ticket, Trash2, Upload, Wand2, X } from "lucide-react"
import {
  AUDIO_GROUPS, AUDIO_MODEL_PREFIX, AUDIO_STUDIO_MODELS, audioPriceNote, audioTicketCost, getAudioStudioModel,
  type AudioStudioModel,
} from "@/lib/audio-studio"

type AudioItem = {
  id: number
  imageUrl: string
  prompt: string
  model: string
  createdAt: string
  videoMetadata?: { label?: string | null; modelName?: string; provider?: string; voice?: string | null } | null
}
type Pending = { requestId: string; modelId: string; name: string; prompt: string; startedAt: number; ticketCost: number }
type Failed = { key: string; name: string; prompt: string; error: string }

const PENDING_KEY = "pv2-audio-pending"
const groupOf = (m: AudioStudioModel) => AUDIO_GROUPS.find(g => g.key === m.group)!

function readPending(): Pending[] {
  try { const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writePending(p: Pending[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)) } catch {}
}

/** Decorative waveform: deterministic bars from a seed, so each clip has its own shape. */
function Waveform({ seed, playing, className = "" }: { seed: number; playing?: boolean; className?: string }) {
  const bars = useMemo(() => {
    let x = seed * 9301 + 49297
    return Array.from({ length: 48 }, (_, i) => {
      x = (x * 9301 + 49297) % 233280
      const env = Math.sin((i / 47) * Math.PI) * 0.6 + 0.4
      return 0.15 + (x / 233280) * 0.85 * env
    })
  }, [seed])
  return (
    <div className={`flex items-center gap-[2px] h-full ${className}`} aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full bg-current ${playing ? "animate-pulse" : ""}`}
          style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${(i % 8) * 90}ms` }}
        />
      ))}
    </div>
  )
}

/** One clip: its waveform, a play button, the prompt, model and a download. */
function AudioCard({ item, onUsePrompt }: { item: AudioItem; onUsePrompt?: (t: string) => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ cur: 0, dur: 0 })
  const m = getAudioStudioModel(item.model)
  const g = m ? groupOf(m) : AUDIO_GROUPS[0]
  const label = item.videoMetadata?.label
  const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00")
  const toggle = () => {
    const a = ref.current
    if (!a) return
    // One clip at a time across the feed
    document.querySelectorAll<HTMLAudioElement>("audio[data-studio]").forEach(o => { if (o !== a) o.pause() })
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }
  return (
    <div className="group rounded-2xl border border-white/10 bg-slate-900/70 hover:border-white/20 transition-colors overflow-hidden">
      <div className="relative h-24 px-4 pt-4 pb-3 bg-gradient-to-br from-white/[0.06] via-transparent to-black/40">
        <div className={`h-full ${g.accent} opacity-70`}>
          <Waveform seed={item.id} playing={playing} />
        </div>
        {/* progress */}
        <div className="absolute left-0 bottom-0 h-0.5 bg-white/70 transition-[width] duration-200" style={{ width: time.dur ? `${(time.cur / time.dur) * 100}%` : "0%" }} />
        <button
          onClick={toggle}
          className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/60 border border-white/25 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 hover:scale-105 transition-all"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} className="fill-white" /> : <Play size={18} className="fill-white ml-0.5" />}
        </button>
        {label && <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-bold uppercase tracking-wider text-white/90">{label}</span>}
        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-mono text-slate-300">{fmt(time.cur)} / {fmt(time.dur)}</span>
      </div>
      <audio
        ref={ref}
        data-studio
        src={item.imageUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        // Read the element NOW: React clears currentTarget once the handler
        // returns, so reading it inside a deferred state updater crashed.
        onLoadedMetadata={e => { const dur = e.currentTarget.duration; setTime(t => ({ ...t, dur })) }}
        onTimeUpdate={e => { const a = e.currentTarget; setTime({ cur: a.currentTime, dur: a.duration }) }}
      />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
          <span className="text-[11px] font-bold text-white truncate">{item.videoMetadata?.modelName ?? m?.name ?? item.model.replace(AUDIO_MODEL_PREFIX, "")}</span>
          {item.videoMetadata?.voice && <span className="text-[10px] text-slate-500 truncate">· {item.videoMetadata.voice}</span>}
        </div>
        <p className="text-[11px] text-slate-400 line-clamp-2 min-h-[2.2em]" title={item.prompt}>{item.prompt}</p>
        <div className="flex items-center gap-1.5 mt-2 opacity-70 group-hover:opacity-100 transition-opacity">
          <a href={`/api/images/${item.id}?download=1`} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-200 hover:bg-white/10">
            <Download size={11} /> Download
          </a>
          {onUsePrompt && item.prompt && (
            <button onClick={() => onUsePrompt(item.prompt)} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-200 hover:bg-white/10">
              <Wand2 size={11} /> Reuse text
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The model's controls: voices, language, length, style, lyrics, the input clip. */
function AudioSettings({
  model, onModelChange, voice, setVoice, voice2, setVoice2, language, setLanguage, duration, setDuration,
  instrumental, setInstrumental, style, setStyle, lyrics, setLyrics, audioFile, audioUploading, onAudioPick, onAudioClear,
}: {
  model: AudioStudioModel
  onModelChange: (id: string) => void
  voice: string; setVoice: (v: string) => void
  voice2: string; setVoice2: (v: string) => void
  language: string; setLanguage: (v: string) => void
  duration: number; setDuration: (v: number) => void
  instrumental: boolean; setInstrumental: (v: boolean) => void
  style: string; setStyle: (v: string) => void
  lyrics: string; setLyrics: (v: string) => void
  audioFile: { name: string; seconds: number } | null
  audioUploading: boolean
  onAudioPick: (f: File) => void
  onAudioClear: () => void
}) {
  const g = groupOf(model)
  const fileRef = useRef<HTMLInputElement>(null)
  const label = "block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1.5"
  const field = "w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-white/30"
  return (
    <div className="p-4 space-y-5">
      {/* Model */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-[9px] font-bold uppercase tracking-wider text-red-300">Admin only</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${g.accent}`}>{g.label}</span>
        </div>
        <select value={model.id} onChange={e => onModelChange(e.target.value)} className={`${field} font-bold text-sm`}>
          {AUDIO_GROUPS.map(gr => (
            <optgroup key={gr.key} label={gr.label}>
              {AUDIO_STUDIO_MODELS.filter(m => m.group === gr.key).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{model.blurb}</p>
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500"><Ticket size={10} /> {model.provider} · {audioPriceNote(model)}</p>
      </div>

      {model.voices && (
        <div>
          <span className={label}>{model.voices.label ?? (model.voice2 ? "First speaker" : "Voice")}</span>
          <select value={voice} onChange={e => setVoice(e.target.value)} className={field}>
            {model.voices.options.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}
      {model.voice2 && (
        <div>
          <span className={label}>Second speaker</span>
          <select value={voice2} onChange={e => setVoice2(e.target.value)} className={field}>
            {model.voice2.options.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}
      {model.languages && (
        <div>
          <span className={label}>Language</span>
          <select value={language} onChange={e => setLanguage(e.target.value)} className={field}>
            {model.languages.options.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}
      {model.duration && (
        <div>
          <span className={label}>Length</span>
          {model.duration.options ? (
            <div className="flex gap-1.5">
              {model.duration.options.map(o => (
                <button key={o} onClick={() => setDuration(o)} className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${duration === o ? "bg-white text-slate-900 border-white" : "bg-black/30 border-white/10 text-slate-300 hover:border-white/25"}`}>{o}s</button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input type="range" min={model.duration.min} max={model.duration.max} step={model.duration.step ?? 1} value={duration} onChange={e => setDuration(+e.target.value)} className="flex-1 accent-white" />
              <span className="w-14 text-right font-mono text-xs text-white">{duration >= 60 ? `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, "0")}` : `${duration}s`}</span>
            </div>
          )}
        </div>
      )}
      {model.instrumental && (
        <label className="flex items-center justify-between cursor-pointer">
          <span className={label + " mb-0"}>Instrumental only</span>
          <button onClick={() => setInstrumental(!instrumental)} className={`w-10 h-5 rounded-full transition-colors relative ${instrumental ? "bg-white" : "bg-white/15"}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${instrumental ? "left-5 bg-slate-900" : "left-0.5 bg-white"}`} />
          </button>
        </label>
      )}
      {model.style && (
        <div>
          <span className={label}>{model.style.label}</span>
          <textarea value={style} onChange={e => setStyle(e.target.value)} rows={2} placeholder={model.style.placeholder} className={`${field} resize-none`} />
        </div>
      )}
      {model.lyrics && !(model.instrumental && instrumental) && (
        <div>
          <span className={label}>Lyrics {model.lyrics.required ? "" : <span className="normal-case tracking-normal text-slate-600">(optional)</span>}</span>
          <textarea value={lyrics} onChange={e => setLyrics(e.target.value.slice(0, model.lyrics!.max))} rows={7} placeholder={model.lyrics.placeholder ?? "[verse]\n…\n[chorus]\n…"} className={`${field} resize-y font-mono text-[11px]`} />
          <p className="mt-1 text-right text-[9px] font-mono text-slate-600">{lyrics.length}/{model.lyrics.max}</p>
        </div>
      )}
      {model.audioIn && (
        <div>
          <span className={label}>{model.audioIn.label}</span>
          <input ref={fileRef} type="file" accept="audio/*,video/mp4" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAudioPick(f) }} />
          {audioFile ? (
            <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2">
              <Music size={13} className="text-slate-400 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-xs text-white">{audioFile.name}</span>
              <span className="text-[10px] font-mono text-slate-500">{Math.round(audioFile.seconds)}s</span>
              <button onClick={onAudioClear} className="text-slate-500 hover:text-red-300"><X size={13} /></button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onAudioPick(f) }}
              disabled={audioUploading}
              className="w-full flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-black/20 px-3 py-5 text-xs text-slate-300 hover:border-white/40 hover:bg-white/[0.03] transition-colors disabled:opacity-60"
            >
              {audioUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
              {audioUploading ? "Uploading…" : "Drop an audio file or click to upload"}
              <span className="text-[10px] text-slate-500">{model.audioIn.hint ?? `up to ${model.audioIn.maxMinutes} min`}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function AudioStudio({
  modelId, onModelChange, isAdmin, ticketBalance, onTicketsSpent, topOffsetPx = 49,
}: {
  /** The taskbar's height above this view. */
  topOffsetPx?: number
  modelId: string
  onModelChange: (id: string) => void
  isAdmin: boolean
  ticketBalance: number
  onTicketsSpent: (n: number) => void
}) {
  const model = getAudioStudioModel(modelId) ?? AUDIO_STUDIO_MODELS[0]

  // Controls, reset to the model's defaults when the model changes
  const [text, setText] = useState("")
  const [lyrics, setLyrics] = useState("")
  const [style, setStyle] = useState("")
  const [voice, setVoice] = useState(model.voices?.default ?? "")
  const [voice2, setVoice2] = useState(model.voice2?.default ?? "")
  const [language, setLanguage] = useState(model.languages?.default ?? "")
  const [duration, setDuration] = useState(model.duration?.default ?? 30)
  const [instrumental, setInstrumental] = useState(false)
  const [audio, setAudio] = useState<{ name: string; seconds: number; url: string } | null>(null)
  const [audioUploading, setAudioUploading] = useState(false)
  useEffect(() => {
    setVoice(model.voices?.default ?? "")
    setVoice2(model.voice2?.default ?? "")
    setLanguage(model.languages?.default ?? "")
    setDuration(model.duration?.default ?? 30)
    setInstrumental(false)
    if (!model.audioIn) setAudio(null)
  }, [model.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [drawer, setDrawer] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [failed, setFailed] = useState<Failed[]>([])
  const [session, setSession] = useState<AudioItem[]>([])
  const [past, setPast] = useState<AudioItem[]>([])
  const [cursor, setCursor] = useState<{ before: string; beforeId: number } | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingPast, setLoadingPast] = useState(false)

  const cost = audioTicketCost(model, { chars: text.length + (lyrics?.length ?? 0), seconds: model.duration ? duration : undefined, inputSeconds: audio?.seconds })
  const missing =
    (model.text?.required && !text.trim()) ? `Enter the ${model.text.label.toLowerCase()}` :
    (model.lyrics?.required && !lyrics.trim()) ? "Add lyrics" :
    (model.audioIn?.required && !audio) ? `Upload ${model.audioIn.label.toLowerCase()}` : null
  const canGenerate = !missing && !submitting && !audioUploading && (isAdmin || ticketBalance >= cost)

  // ── Past audio ──
  const loadPast = useCallback(async (reset = false) => {
    if (loadingPast) return
    setLoadingPast(true)
    try {
      const c = reset ? null : cursor
      const qs = c ? `&before=${encodeURIComponent(c.before)}&beforeId=${c.beforeId}` : ""
      const res = await fetch(`/api/my-images?type=audio&cursor=1&limit=24${qs}`)
      const d = await res.json()
      const rows: AudioItem[] = d.images ?? []
      setPast(p => (reset ? rows : [...p, ...rows]))
      setHasMore(!!d.hasMore)
      const last = rows[rows.length - 1]
      setCursor(d.nextCursor ?? (last ? { before: last.createdAt, beforeId: last.id } : null))
    } catch {} finally { setLoadingPast(false) }
  }, [cursor, loadingPast])
  useEffect(() => { loadPast(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending runs: restored on load, polled until settled ──
  useEffect(() => { setPending(readPending()) }, [])
  useEffect(() => {
    if (!pending.length) return
    let stop = false
    const tick = async () => {
      for (const p of pending) {
        if (stop) return
        try {
          const res = await fetch("/api/audio/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: p.requestId }) })
          if (res.status === 404) { drop(p.requestId); continue }
          const d = await res.json()
          if (d.status === "completed") {
            drop(p.requestId)
            const ids = new Set<number>()
            setSession(s => { s.forEach(x => ids.add(x.id)); return [...(d.items ?? []).filter((x: AudioItem) => !ids.has(x.id)), ...s] })
          } else if (d.status === "failed") {
            drop(p.requestId)
            setFailed(f => [{ key: p.requestId, name: p.name, prompt: p.prompt, error: d.error || "Generation failed" }, ...f])
          }
        } catch {}
      }
    }
    const drop = (id: string) => setPending(ps => { const next = ps.filter(x => x.requestId !== id); writePending(next); return next })
    tick()
    const iv = setInterval(tick, 4000)
    return () => { stop = true; clearInterval(iv) }
  }, [pending])

  // ── Upload the input clip (and read its length for the price) ──
  const onAudioPick = async (file: File) => {
    setError(null)
    setAudioUploading(true)
    try {
      const seconds = await new Promise<number>(resolve => {
        const a = document.createElement(file.type.startsWith("video/") ? "video" : "audio")
        a.preload = "metadata"
        a.onloadedmetadata = () => { resolve(a.duration || 0); URL.revokeObjectURL(a.src) }
        a.onerror = () => resolve(0)
        a.src = URL.createObjectURL(file)
      })
      if (model.audioIn && seconds > model.audioIn.maxMinutes * 60 + 1) throw new Error(`That file is ${Math.round(seconds)}s - this tool takes ${model.audioIn.maxMinutes} min at most`)
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/upload-video-media", { method: "POST", body: fd })
      if (!res.ok) throw new Error("Upload failed")
      const d = await res.json()
      if (!d?.url) throw new Error("Upload failed")
      setAudio({ name: file.name, seconds, url: d.url })
    } catch (e: any) {
      setError(e?.message || "Upload failed")
    } finally { setAudioUploading(false) }
  }

  // ── Generate ──
  const generate = async () => {
    if (!canGenerate) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/audio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Only what this model uses (text left from another model must not tag along)
          model: model.id,
          text: model.text ? text : undefined,
          lyrics: model.lyrics && lyrics ? lyrics : undefined,
          style: model.style && style ? style : undefined,
          audioName: audio?.name,
          voice: voice || undefined, voice2: voice2 || undefined, language: language || undefined,
          duration: model.duration ? duration : undefined, instrumental,
          audioUrl: audio?.url, inputSeconds: audio?.seconds,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) throw new Error(d.error || "Generation failed")
      if (d.charged) onTicketsSpent(d.charged)
      const shownPrompt = (model.text && text) || (model.lyrics && lyrics) || (audio ? `${model.name} · ${audio.name}` : model.name)
      const p: Pending = { requestId: d.requestId, modelId: model.id, name: model.name, prompt: shownPrompt, startedAt: Date.now(), ticketCost: d.ticketCost }
      setPending(ps => { const next = [p, ...ps]; writePending(next); return next })
    } catch (e: any) {
      setError(e?.message || "Generation failed")
    } finally { setSubmitting(false) }
  }

  const settingsProps = {
    model, onModelChange, voice, setVoice, voice2, setVoice2, language, setLanguage, duration, setDuration,
    instrumental, setInstrumental, style, setStyle, lyrics, setLyrics,
    audioFile: audio, audioUploading, onAudioPick, onAudioClear: () => setAudio(null),
  }
  const shown = [...session, ...past.filter(p => !session.some(s => s.id === p.id))]
  const g = groupOf(model)

  return (
    <div style={{ height: `calc(100dvh - ${topOffsetPx}px)` }} className="flex overflow-hidden relative">
      {/* Settings - desktop sidebar */}
      <div className="hidden sm:block w-72 shrink-0 border-r border-white/5 overflow-y-auto pb-24">
        <AudioSettings {...settingsProps} />
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto pb-44">
        <div className="p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-4">
            <Music size={16} className="text-red-300" />
            <h2 className="text-base font-black tracking-tight text-white">Audio Studio</h2>
            <span className="px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-[9px] font-bold uppercase tracking-wider text-red-300">Admin only</span>
            <button onClick={() => setDrawer(true)} className="sm:hidden ml-auto flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-slate-200">
              <SlidersHorizontal size={12} /> Settings
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {pending.map(p => (
              <div key={p.requestId} className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden">
                <div className="relative h-24 px-4 pt-4 pb-3 bg-gradient-to-br from-white/[0.06] via-transparent to-black/40">
                  <div className="h-full text-slate-500/60"><Waveform seed={p.startedAt % 997} playing /></div>
                  <Loader2 size={22} className="absolute inset-0 m-auto animate-spin text-white/80" />
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[11px] font-bold text-white">{p.name} <span className="font-normal text-slate-500">· generating</span></p>
                  <p className="text-[11px] text-slate-400 line-clamp-2 min-h-[2.2em]">{p.prompt}</p>
                </div>
              </div>
            ))}
            {failed.map(f => (
              <div key={f.key} className="rounded-2xl border border-red-500/30 bg-red-950/30 p-3">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[11px] font-bold text-red-200">{f.name} failed</p>
                  <button onClick={() => setFailed(x => x.filter(y => y.key !== f.key))} className="text-red-300/70 hover:text-red-200"><Trash2 size={12} /></button>
                </div>
                <p className="mt-1 text-[11px] text-red-200/80">{f.error}</p>
                <p className="mt-1 text-[10px] text-slate-500 line-clamp-2">{f.prompt}</p>
              </div>
            ))}
            {shown.map(item => <AudioCard key={item.id} item={item} onUsePrompt={t => setText(t)} />)}
          </div>

          {!shown.length && !pending.length && !loadingPast && (
            <div className="mt-16 text-center text-slate-500">
              <Music size={28} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">No audio yet. Pick a model, write something, and generate.</p>
            </div>
          )}
          {hasMore && shown.length > 0 && (
            <div className="mt-5 text-center">
              <button onClick={() => loadPast()} disabled={loadingPast} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50">
                {loadingPast ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Prompt bar */}
      <div className="fixed bottom-0 left-0 right-0 sm:left-72 z-30 p-3 sm:p-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent">
        <div className="max-w-4xl mx-auto rounded-2xl border border-white/15 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-black/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${g.dot}`} />
            <span className="text-xs font-bold text-white">{model.name}</span>
            <span className="text-[10px] text-slate-500 truncate">{model.provider} · {g.label}</span>
          </div>
          {model.text ? (
            <textarea
              value={text}
              onChange={e => setText(e.target.value.slice(0, model.text!.max))}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate() }}
              rows={model.group === "dialogue" ? 4 : 3}
              placeholder={model.text.placeholder}
              className="w-full resize-none bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          ) : (
            <p className="py-3 text-sm text-slate-400">{audio ? `Ready: ${audio.name}` : `Upload ${model.audioIn?.label.toLowerCase() ?? "a file"} in the settings panel, then generate.`}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {model.text && <span className="text-[10px] font-mono text-slate-600">{text.length.toLocaleString()}/{model.text.max.toLocaleString()}</span>}
            {error && <span className="text-[11px] text-red-300 truncate">{error}</span>}
            {!error && missing && <span className="text-[11px] text-slate-500 truncate">{missing}</span>}
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-slate-900 text-sm font-black hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              Generate
              <span className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-900/20 font-mono text-xs"><Ticket size={12} />{cost}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Settings - mobile drawer */}
      {drawer && (
        <div className="sm:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="relative ml-auto w-[85%] max-w-sm h-full bg-slate-950 border-l border-white/10 overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-4">
              <span className="text-sm font-bold text-white">Settings</span>
              <button onClick={() => setDrawer(false)} className="text-slate-400"><X size={18} /></button>
            </div>
            <AudioSettings {...settingsProps} />
          </div>
        </div>
      )}
    </div>
  )
}
