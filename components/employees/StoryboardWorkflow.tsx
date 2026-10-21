"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Check, ChevronLeft, ChevronRight, Loader2, Mic, Music, Pause, Play, Plus, RotateCcw, Sparkles, Ticket, Trash2, Wand2, X,
  ImageIcon, Clapperboard, ListChecks, ArrowRight,
} from "lucide-react"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { useThumb } from "@/components/employees/still-thumbs"
import {
  shotAspect, stillModelSpec, SHOT_ASPECTS, MAX_LINES_PER_SHOT, STORYBOARD_VOICE_MODELS, STORYBOARD_MUSIC_MODELS, cueKindOf,
  newVoiceLine, newMusicCue, musicSpanSeconds, liveAudio, lineStale, fmtRuntime,
  type StoryboardDoc, type StoryboardShot, type VoiceLine, type MusicCue, type FinalCutState, type FinalCutVersion, type ReviseDraft, type ReviseEdit,
} from "@/lib/storyboard"
import { STILL_TOOLS, STILL_EDIT_DEFAULT_MODEL, EXPAND_ZOOMS, stillToolTickets, CLIP_TOOLS, CLIP_TOOL_GROUPS, type StillToolId, type ClipTool } from "@/lib/storyboard-tools"
import { STUDIO_EDIT_MODELS, studioModelsFor, isAdminOnlyModel } from "@/lib/image-studio-ai"
import { ELEVEN_VOICES, getAudioStudioModel, audioTicketCost, spokenCharCount } from "@/lib/audio-studio"

/*
 * Storyboard Studio - the workflow's new phases (2026-10-19): the Still edits
 * and Shot edits tool panels that sit under each shot, the audio lane along
 * the board, and the Revise panel after a Final Cut. The routes do the work
 * (still-edit, clip-edit, audio, final-cut revise-plan); these only collect
 * the choice, show the price, and hand it to the workspace.
 */

const Tix = ({ n, approx }: { n: number; approx?: boolean }) => (
  <span className="inline-flex items-center gap-0.5 font-mono text-slate-300"><Ticket size={9} />{approx ? "~" : ""}{n}</span>
)
const chip = (on: boolean) => `px-2 py-1 rounded-lg border text-[10.5px] font-semibold transition-colors ${on ? "border-slate-200 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-white hover:border-white/25"}`

/** The board's cast pictures (asset refs), to pick as references. */
function CastPicker({ board, picked, max, onChange, exclude }: { board: StoryboardDoc; picked: string[]; max: number; onChange: (urls: string[]) => void; exclude?: string | null }) {
  const thumb = useThumb()
  const groups = board.assets.map(a => ({ a, refs: a.refs.filter(r => r.url !== exclude) })).filter(g => g.refs.length)
  if (!groups.length) return <p className="text-[10.5px] text-slate-500">No cast pictures yet - add characters, places and props in Assets (left) and they show here.</p>
  const toggle = (u: string) => onChange(picked.includes(u) ? picked.filter(x => x !== u) : picked.length >= max ? picked : [...picked, u])
  return (
    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
      {groups.map(({ a, refs }) => (
        <div key={a.id}>
          <div className="text-[9.5px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">{a.name}</div>
          <div className="flex flex-wrap gap-1">
            {refs.map(r => {
              const on = picked.includes(r.url)
              return (
                <button key={r.id} type="button" onClick={() => toggle(r.url)} title={r.caption || a.name}
                  className={`relative w-11 h-11 rounded-md overflow-hidden border ${on ? "border-slate-100 ring-1 ring-slate-100" : "border-white/10 opacity-70 hover:opacity-100"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb(r.url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {on && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-white text-black flex items-center justify-center"><Check size={9} strokeWidth={3} /></span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-[9.5px] text-slate-500">{picked.length}/{max} picked</p>
    </div>
  )
}

// ── Still edits ──────────────────────────────────────────────────────────────

export function StillEditTools({ board, shot, isAdmin, running, onRun, onStudio }: {
  board: StoryboardDoc
  shot: StoryboardShot
  isAdmin: boolean
  /** A still is being made / edited on this shot. */
  running: boolean
  onRun: (body: Record<string, unknown>) => Promise<string | null>
  onStudio: () => void
}) {
  const [tool, setTool] = useState<StillToolId | null>(null)
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState(STILL_EDIT_DEFAULT_MODEL)
  const [picks, setPicks] = useState<string[]>([])
  const [aspect, setAspect] = useState<string>("")
  const [zoom, setZoom] = useState("0.8")
  const [err, setErr] = useState<string | null>(null)
  const t = STILL_TOOLS.find(x => x.id === tool)
  const frame = shotAspect(shot, board.aspect)
  // Admin-only models show red in the menu (only an admin's list has them)
  const models = studioModelsFor(STUDIO_EDIT_MODELS, isAdmin).map(m => ({ value: m.id, label: m.label, admin: isAdminOnlyModel(m.id) }))
  const maxCast = Math.max(0, stillModelSpec(model).maxRefs - 1)
  const price = tool ? stillToolTickets(tool, { model, frame, refs: picks.length }) : 0
  const takes = (shot.stills ?? []).length
  if (!shot.stillUrl) return <p className="text-[10.5px] text-slate-500 px-1">Make the still first - the tools edit it.</p>
  const run = async () => {
    if (!tool) return
    setErr(null)
    const e = await onRun({ op: tool, prompt, model, refs: picks, aspect: aspect || frame, zoom: Number(zoom) })
    if (e) setErr(e); else { setPrompt(""); setTool(null) }
  }
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-2 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400">
        <ImageIcon size={11} /> Still edits <span className="ml-auto normal-case tracking-normal font-normal text-slate-500">{takes} take{takes === 1 ? "" : "s"} - the arrows on the still flip between them</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {STILL_TOOLS.map(x => (
          <button key={x.id} type="button" disabled={running} onClick={() => setTool(tool === x.id ? null : x.id)} className={chip(tool === x.id)}>{x.label}</button>
        ))}
        <button type="button" disabled={running} onClick={onStudio} className={chip(false)} title="The Image Studio popup - layers, selections, fill, erase, text">Image Studio</button>
      </div>
      {t && (
        <div className="space-y-2">
          <p className="text-[10.5px] text-slate-400 leading-snug">{t.blurb}</p>
          {t.prompt && (
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} placeholder={t.placeholder} className="sb-input" />
          )}
          {(tool === "edit" || tool === "background") && (
            <>
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                Model <Dropdown value={model} options={models} onChange={v => { setModel(v); setPicks(p => p.slice(0, Math.max(0, stillModelSpec(v).maxRefs - 1))) }} className="w-44 ml-auto" />
              </div>
              {maxCast > 0 && <CastPicker board={board} picked={picks} max={maxCast} onChange={setPicks} exclude={shot.stillUrl} />}
            </>
          )}
          {tool === "expand" && (
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
              <label className="space-y-0.5"><span className="block text-[9.5px] uppercase tracking-wider text-slate-500">Frame</span>
                <Dropdown value={aspect || frame} options={SHOT_ASPECTS.map(a => ({ value: a, label: a === board.aspect ? `${a} (board)` : a }))} onChange={setAspect} />
              </label>
              <label className="space-y-0.5"><span className="block text-[9.5px] uppercase tracking-wider text-slate-500">Zoom</span>
                <Dropdown value={zoom} options={EXPAND_ZOOMS.map(z => ({ value: z.value, label: z.label }))} onChange={setZoom} />
              </label>
            </div>
          )}
          {err && <p className="text-[10.5px] text-red-300">{err}</p>}
          <BrandButton primary size="xs" busy={running} disabled={running || (t.prompt === "required" && !prompt.trim())} onClick={run} className="w-full">
            {running ? "Working…" : <>{t.label} <Tix n={price} approx={tool === "upscale"} /></>}
          </BrandButton>
        </div>
      )}
    </div>
  )
}

// ── Shot edits ───────────────────────────────────────────────────────────────

export function ClipEditTools({ board, shot, running, onRun }: {
  board: StoryboardDoc
  shot: StoryboardShot
  running: boolean
  onRun: (body: Record<string, unknown>) => Promise<string | null>
}) {
  const [toolId, setToolId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [picks, setPicks] = useState<string[]>([])
  const [choice, setChoice] = useState("")
  const [adds, setAdds] = useState(0)
  const [lineId, setLineId] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const tool: ClipTool | undefined = CLIP_TOOLS.find(x => x.id === toolId)
  const v = shot.video
  const rendering = v?.status === "rendering"
  const lines = (shot.lines ?? []).filter(l => l.status === "done" && l.url)
  if (!v || (v.status !== "done" && !rendering)) return <p className="text-[10.5px] text-slate-500 px-1">Shoot this shot first - the tools work on its clip.</p>
  const pick = (t: ClipTool) => {
    setToolId(toolId === t.id ? null : t.id); setErr(null)
    setChoice(t.choice?.def ?? ""); setAdds(t.adds?.def ?? 0); setPicks([]); setLineId(lines[0]?.id ?? "")
  }
  const secs = v.seconds || shot.duration
  const fits = (t: ClipTool) => !(t.maxSec && secs > t.maxSec + 0.5) && !(t.minSec && secs < t.minSec - 0.2)
  const run = async () => {
    if (!tool) return
    setErr(null)
    const e = await onRun({ tool: tool.id, prompt, refs: picks, choice, adds, lineId })
    if (e) setErr(e); else { setPrompt(""); setToolId(null) }
  }
  const missingRefs = !!tool?.refs?.required && !picks.length
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-2 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400">
        <Clapperboard size={11} /> Shot edits
        <span className="ml-auto normal-case tracking-normal font-normal text-slate-500 truncate">
          {rendering ? (v.edit ? `${v.edit.label} rendering…` : "shooting…") : v.edit ? `this clip: ${v.edit.label}` : `${Math.max(1, (shot.videos ?? []).length)} clip take${Math.max(1, (shot.videos ?? []).length) === 1 ? "" : "s"}`}
        </span>
      </div>
      {v.error && v.status === "done" && <p className="text-[10.5px] text-amber-300">{v.error}</p>}
      <div className="space-y-1">
        {CLIP_TOOL_GROUPS.map(g => (
          <div key={g.key} className="flex flex-wrap items-center gap-1">
            <span className="w-14 shrink-0 text-[9.5px] uppercase tracking-wider text-slate-600 font-semibold">{g.label}</span>
            {CLIP_TOOLS.filter(t => t.group === g.key).map(t => (
              <button key={t.id} type="button" disabled={running || rendering || !fits(t)} onClick={() => pick(t)}
                title={fits(t) ? t.blurb : `Needs a clip of ${t.minSec ? `${t.minSec}` : "0"}-${t.maxSec ?? "∞"}s - this one is ${secs}s`}
                className={`${chip(toolId === t.id)} disabled:opacity-35`}>{t.label}</button>
            ))}
          </div>
        ))}
      </div>
      {tool && (
        <div className="space-y-2">
          <p className="text-[10.5px] text-slate-400 leading-snug">{tool.blurb} <span className="text-slate-500">Priced {tool.price}, measured from the clip.</span></p>
          {tool.prompt && <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} placeholder={tool.placeholder} className="sb-input" />}
          {tool.choice && (
            <div className="flex items-center gap-2 text-[11px] text-slate-300">{tool.choice.label}
              <Dropdown value={choice || tool.choice.def} options={tool.choice.options} onChange={setChoice} className="w-36 ml-auto" />
            </div>
          )}
          {tool.adds && (
            <div className="flex items-center gap-2 text-[11px] text-slate-300">Add
              <Dropdown value={String(adds || tool.adds.def)} options={Array.from({ length: tool.adds.max - tool.adds.min + 1 }, (_, k) => tool.adds!.min + k).map(n => ({ value: String(n), label: `${n}s` }))} onChange={x => setAdds(Number(x))} className="w-24 ml-auto" />
            </div>
          )}
          {tool.refs && (
            <div className="space-y-1">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500 font-semibold">{tool.refs.label}{tool.refs.required ? "" : " (optional)"}</div>
              <CastPicker board={board} picked={picks} max={tool.refs.max} onChange={setPicks} />
            </div>
          )}
          {tool.usesLine && (lines.length
            ? <div className="flex items-center gap-2 text-[11px] text-slate-300">Line
                <Dropdown value={lineId || lines[0].id} options={lines.map(l => ({ value: l.id, label: `${l.speaker}: ${l.text.slice(0, 40)}` }))} onChange={setLineId} className="flex-1 min-w-0" />
              </div>
            : <p className="text-[10.5px] text-amber-300">Record a voice line on this shot in the audio lane first.</p>)}
          {err && <p className="text-[10.5px] text-red-300">{err}</p>}
          <BrandButton primary size="xs" busy={running} onClick={run} className="w-full"
            disabled={running || (tool.prompt === "required" && !prompt.trim()) || missingRefs || (!!tool.usesLine && !lines.length)}>
            {running ? "Starting…" : `${tool.label} - new take`}
          </BrandButton>
        </div>
      )}
    </div>
  )
}

// ── The audio lane ───────────────────────────────────────────────────────────

const VOICE_OPTIONS = ELEVEN_VOICES.map(v => ({ value: v, label: v }))
const lineTickets = (l: Pick<VoiceLine, "model" | "text">) => {
  const m = getAudioStudioModel(l.model)
  return m && l.text.trim() ? audioTicketCost(m, { chars: l.text.length, spokenChars: spokenCharCount(l.text) }) : 0
}
const cueTickets = (c: Pick<MusicCue, "model" | "prompt">, seconds: number) => {
  const m = getAudioStudioModel(c.model)
  if (!m) return 0
  const s = m.duration ? Math.max(m.duration.min, Math.min(m.duration.max, seconds)) : seconds
  return audioTicketCost(m, { chars: Math.max(1, c.prompt.length), seconds: s })
}

/** Plays one recording (the lane's little play buttons). */
function PlayAudio({ url }: { url: string | null }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [on, setOn] = useState(false)
  useEffect(() => () => { ref.current?.pause() }, [])
  if (!url) return null
  return (
    <button type="button" title={on ? "Stop" : "Play"} onClick={() => {
      if (!ref.current) { ref.current = new Audio(url); ref.current.onended = () => setOn(false) }
      if (on) { ref.current.pause(); ref.current.currentTime = 0; setOn(false) } else { ref.current.play().catch(() => {}); setOn(true) }
    }} className="w-6 h-6 shrink-0 rounded-full border border-white/15 flex items-center justify-center text-slate-200 hover:bg-white/10">
      {on ? <Pause size={10} /> : <Play size={10} className="ml-px" />}
    </button>
  )
}

const statusText = (a: { status: VoiceLine["status"]; at: number; error?: string | null }) => {
  const s = liveAudio(a)
  return s === "making" ? "recording…" : s === "failed" ? (a.error || "failed") : s === "done" ? "" : "not recorded"
}

/**
 * The audio lane's Edit with AI (2026-10-19, owner: "edit them directly in the
 * audio lane with the edit AI, just like the stills and shots"): one shot's
 * voice lines and / or music cue rewritten from a direction ("warmer
 * narrator", "shorter line", "darker strings"), with an Undo. A line whose
 * words changed shows "edited since" so it is re-recorded; one that kept its
 * words keeps its recording.
 */
function AudioAiEdit({ shot, onAiEdit, onChangeShot }: {
  shot: StoryboardShot
  onAiEdit: (shotId: string, instruction: string, scope: "voice" | "music" | "audio") => Promise<{ patch?: Partial<StoryboardShot>; note?: string; error?: string }>
  onChangeShot: (id: string, patch: Partial<StoryboardShot>) => void
}) {
  const [text, setText] = useState("")
  const [scope, setScope] = useState<"voice" | "music" | "audio">("audio")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [undo, setUndo] = useState<Partial<StoryboardShot> | null>(null)
  const run = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setNote(null)
    const before = { lines: shot.lines, music: shot.music ?? null }
    const r = await onAiEdit(shot.id, text.trim(), scope)
    setBusy(false)
    if (r.error) { setNote({ ok: false, text: r.error }); return }
    setUndo(before)
    setNote({ ok: true, text: r.note || "Updated - record the changed lines" })
    setText("")
  }
  return (
    <div className="silver-edge rounded-xl p-2 space-y-1.5 lg:col-span-2">
      <BrandTitle title="Edit with AI" logo={16} size="sm" />
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className="sb-input"
        placeholder="e.g. make the narrator warmer and slower · shorten the line to five words · darker strings, no drums · add a reply from Mara" />
      <div className="flex items-center gap-1">
        {([["voice", "Voice lines"], ["music", "Music"], ["audio", "Both"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setScope(v)} className={`px-2 py-1 rounded-md border text-[10px] font-semibold ${scope === v ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>{l}</button>
        ))}
        <BrandButton onClick={() => void run()} disabled={busy || !text.trim()} busy={busy} primary size="xs" className="ml-auto">Apply <Tix n={1} /></BrandButton>
      </div>
      {note && (
        <div className={`flex items-start gap-1.5 text-[10px] leading-snug ${note.ok ? "text-emerald-300" : "text-red-300"}`}>
          <span className="flex-1">{note.text}</span>
          {note.ok && undo && <button onClick={() => { onChangeShot(shot.id, undo); setUndo(null); setNote({ ok: true, text: "Undone" }) }} className="shrink-0 underline text-slate-300 hover:text-white">Undo</button>}
        </div>
      )}
    </div>
  )
}

export function AudioLane({ board, onChangeShot, onRecordLine, onRecordCue, onPlay, recording, onAiEdit }: {
  board: StoryboardDoc
  /** Words, voice, offset, prompt - autosaved like any shot field. */
  onChangeShot: (id: string, patch: Partial<StoryboardShot>) => void
  onRecordLine: (shotId: string, line: VoiceLine) => Promise<string | null>
  onRecordCue: (shotId: string, cue: MusicCue) => Promise<string | null>
  /** Play the animatic (with the lane's sound) from a shot. */
  onPlay: (index: number) => void
  /** Line / cue ids being recorded by this page. */
  recording: Record<string, boolean>
  /** Edit this shot's lines / music with AI (the shot-edit route's audio scopes). */
  onAiEdit?: (shotId: string, instruction: string, scope: "voice" | "music" | "audio") => Promise<{ patch?: Partial<StoryboardShot>; note?: string; error?: string }>
}) {
  const thumb = useThumb()
  const [open, setOpen] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const shots = board.shots
  const shot = shots.find(s => s.id === sel) ?? null
  const lineCount = shots.reduce((n, s) => n + (s.lines?.length ?? 0), 0)
  const cueCount = shots.filter(s => s.music).length
  // Cue spans: each cue runs from its shot to the next cue
  const spans = useMemo(() => {
    const out: { cue: MusicCue; from: number; to: number }[] = []
    shots.forEach((s, i) => {
      if (s.music) out.push({ cue: s.music, from: i, to: i })
      else if (out.length) out[out.length - 1].to = i
    })
    return out
  }, [shots])
  const unit = 13 // px per second
  const setLine = (s: StoryboardShot, id: string, patch: Partial<VoiceLine>) => onChangeShot(s.id, { lines: (s.lines ?? []).map(l => (l.id === id ? { ...l, ...patch } : l)) })
  const rec = async (s: StoryboardShot, l: VoiceLine) => {
    setErr(e => ({ ...e, [l.id]: "" }))
    const e = await onRecordLine(s.id, l)
    if (e) setErr(x => ({ ...x, [l.id]: e }))
  }
  const recCue = async (s: StoryboardShot, c: MusicCue) => {
    setErr(e => ({ ...e, [c.id]: "" }))
    const e = await onRecordCue(s.id, c)
    if (e) setErr(x => ({ ...x, [c.id]: e }))
  }
  const speakers = useMemo(() => ["Narrator", ...board.assets.filter(a => a.kind === "character" || a.kind === "creature").map(a => a.name)], [board.assets])

  return (
    <section className="silver-edge rounded-2xl p-3 mb-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left">
          <Music size={14} className="text-slate-300" />
          <span className="text-[12px] font-bold text-white">Audio lane</span>
          <span className="text-[10.5px] text-slate-500">{lineCount} voice line{lineCount === 1 ? "" : "s"} · {cueCount} music / sound cue{cueCount === 1 ? "" : "s"} - plays in the animatic, used by the Final Cut</span>
        </button>
        <button onClick={() => onPlay(Math.max(0, shots.findIndex(s => s.id === sel)))} disabled={!shots.length} className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 text-[10.5px] font-semibold text-slate-300 hover:text-white disabled:opacity-40">
          <Play size={11} /> Play with sound
        </button>
        <button onClick={() => setOpen(o => !o)} className="text-slate-500 hover:text-white"><ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} /></button>
      </div>
      {open && (
        <>
          {/* the timeline: a column per shot (width = its planned length), music above, voices below */}
          <div className="mt-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <div className="relative w-full" style={{ minWidth: shots.reduce((w, s) => w + Math.max(56, (s.duration || 1) * unit) + 4, 0) }}>
              <div className="flex gap-1">
                {shots.map((s, i) => (
                  <button key={s.id} onClick={() => setSel(sel === s.id ? null : s.id)} style={{ flexGrow: s.duration || 1, flexBasis: 0, minWidth: Math.max(56, (s.duration || 1) * unit) }}
                    className={`rounded-lg border text-left overflow-hidden transition-colors ${sel === s.id ? "border-slate-100 bg-white/10" : "border-white/10 hover:border-white/30"}`}>
                    <div className="relative h-9 bg-white/[0.04]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.stillUrl && <img src={thumb(s.stillUrl)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" loading="lazy" />}
                      <span className="absolute left-1 top-0.5 text-[9px] font-mono font-bold text-white drop-shadow">{String(i + 1).padStart(2, "0")}</span>
                      <span className="absolute right-1 bottom-0.5 text-[8.5px] font-mono text-slate-200 drop-shadow">{s.duration}s</span>
                    </div>
                    {/* music row */}
                    <div className="h-4 relative">
                      {(() => {
                        const sp = spans.find(x => i >= x.from && i <= x.to)
                        if (!sp) return null
                        const st = liveAudio(sp.cue)
                        return <span className={`absolute inset-y-0.5 ${i === sp.from ? "left-0.5 rounded-l" : "left-0"} ${i === sp.to ? "right-0.5 rounded-r" : "-right-1"} ${st === "done" ? "bg-amber-400/40" : st === "making" ? "bg-amber-400/20 animate-pulse" : "bg-amber-400/10 border border-dashed border-amber-300/30"}`}>
                          {i === sp.from && <span className="absolute left-1 top-0 text-[8.5px] leading-4 text-amber-100 truncate max-w-full">♪ {sp.cue.prompt.slice(0, 30) || "cue"}</span>}
                        </span>
                      })()}
                    </div>
                    {/* voice row */}
                    <div className="h-5 px-0.5 flex items-center gap-0.5 overflow-hidden">
                      {(s.lines ?? []).map(l => {
                        const st = liveAudio(l)
                        return <span key={l.id} title={`${l.speaker}: ${l.text}`} className={`h-3.5 min-w-[10px] rounded-sm px-1 text-[8px] leading-[14px] truncate ${st === "done" ? (lineStale(l) ? "bg-amber-300/40 text-amber-50" : "bg-sky-400/40 text-sky-50") : st === "making" ? "bg-sky-400/20 animate-pulse text-sky-100" : st === "failed" ? "bg-red-400/30 text-red-100" : "bg-white/10 text-slate-300"}`}
                          style={{ flexGrow: Math.max(0.5, l.seconds || 1) }}>{l.speaker.slice(0, 8)}</span>
                      })}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {!shot && <p className="mt-1.5 text-[10.5px] text-slate-500">Tap a shot to write its voice lines or start music or ambience on it.</p>}

          {shot && (() => {
            const i = shots.indexOf(shot)
            const span = musicSpanSeconds(shots, shot.id)
            const cue = shot.music
            return (
              <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
                {/* voice lines */}
                <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    <Mic size={11} /> Shot {String(i + 1).padStart(2, "0")} · voice lines
                    <button onClick={() => setSel(shots[i - 1]?.id ?? sel)} disabled={i === 0} className="ml-auto text-slate-500 hover:text-white disabled:opacity-30"><ChevronLeft size={13} /></button>
                    <button onClick={() => setSel(shots[i + 1]?.id ?? sel)} disabled={i === shots.length - 1} className="text-slate-500 hover:text-white disabled:opacity-30"><ChevronRight size={13} /></button>
                  </div>
                  {(shot.lines ?? []).map(l => {
                    const busy = !!recording[l.id] || liveAudio(l) === "making"
                    const price = lineTickets(l)
                    return (
                      <div key={l.id} className="rounded-lg border border-white/[0.07] p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input value={l.speaker} onChange={e => setLine(shot, l.id, { speaker: e.target.value })} list={`sb-speakers-${board.id}`} className="sb-input !w-28 !py-1" placeholder="Speaker" />
                          <Dropdown value={l.voice} options={VOICE_OPTIONS} onChange={v => setLine(shot, l.id, { voice: v })} className="w-24" />
                          <label className="flex items-center gap-1 text-[10px] text-slate-400" title="Seconds into the shot it starts">
                            at +<input type="number" min={0} max={30} step={0.1} value={l.offset} onChange={e => setLine(shot, l.id, { offset: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} className="sb-input !w-14 !py-1" />s
                          </label>
                          <button onClick={() => onChangeShot(shot.id, { lines: (shot.lines ?? []).filter(x => x.id !== l.id) })} disabled={busy} className="ml-auto text-slate-500 hover:text-red-300 disabled:opacity-30" title="Remove the line"><Trash2 size={12} /></button>
                        </div>
                        <textarea value={l.text} onChange={e => setLine(shot, l.id, { text: e.target.value })} rows={2} className="sb-input" placeholder={l.model === "eleven-v3" ? "What they say - [whispers], [laughs] work here" : "What they say"} />
                        <div className="flex items-center gap-1.5">
                          <Dropdown value={l.model} options={STORYBOARD_VOICE_MODELS.map(m => ({ value: m.id, label: m.label }))} onChange={v => setLine(shot, l.id, { model: v })} className="w-44" />
                          <PlayAudio url={l.url} />
                          <span className={`text-[10px] truncate ${liveAudio(l) === "failed" ? "text-red-300" : "text-slate-500"}`}>{l.url ? `${l.seconds.toFixed(1)}s${lineStale(l) ? " · edited since" : ""}` : statusText(l)}</span>
                          <BrandButton size="xs" primary={!l.url || lineStale(l)} busy={busy} disabled={busy || !l.text.trim()} onClick={() => rec(shot, l)} className="ml-auto">
                            {busy ? "Recording" : l.url ? "Re-record" : "Record"} <Tix n={price} />
                          </BrandButton>
                        </div>
                        {err[l.id] && <p className="text-[10px] text-red-300">{err[l.id]}</p>}
                        {l.url && l.offset + l.seconds > shot.duration + 0.05 && <p className="text-[10px] text-amber-300">Runs {(l.offset + l.seconds - shot.duration).toFixed(1)}s past the shot&apos;s {shot.duration}s - the Final Cut keeps the shot longer if its clip allows.</p>}
                      </div>
                    )
                  })}
                  {(shot.lines?.length ?? 0) < MAX_LINES_PER_SHOT && (
                    <button onClick={() => onChangeShot(shot.id, { lines: [...(shot.lines ?? []), newVoiceLine({ offset: (shot.lines ?? []).reduce((m, l) => Math.max(m, l.offset + (l.seconds || 2) + 0.3), 0.3), speaker: shot.lines?.at(-1)?.speaker ?? "Narrator", voice: shot.lines?.at(-1)?.voice ?? "Brian" })] })}
                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-white/15 text-[10.5px] font-semibold text-slate-400 hover:text-white hover:border-white/35">
                      <Plus size={12} /> Add a line
                    </button>
                  )}
                  <datalist id={`sb-speakers-${board.id}`}>{speakers.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                {/* music cue */}
                <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400"><Music size={11} /> {cue && cueKindOf(cue.model) === "sound" ? "Ambience" : "Music"} from this shot</div>
                  {!cue ? (
                    <>
                      <p className="text-[10.5px] text-slate-500 leading-snug">
                        {spans.some(sp => i > sp.from && i <= sp.to) ? "The cue from an earlier shot plays here. Start a new cue to change the sound from this shot on." : "No music or ambience here yet."}
                      </p>
                      <button onClick={() => onChangeShot(shot.id, { music: newMusicCue() })} className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-amber-300/25 text-[10.5px] font-semibold text-amber-200/80 hover:text-amber-100 hover:border-amber-300/50">
                        <Plus size={12} /> Start music or ambience here
                      </button>
                    </>
                  ) : (() => {
                    const busy = !!recording[cue.id] || liveAudio(cue) === "making"
                    return (
                      <>
                        <textarea value={cue.prompt} onChange={e => onChangeShot(shot.id, { music: { ...cue, prompt: e.target.value } })} rows={3} className="sb-input" placeholder={cueKindOf(cue.model) === "sound" ? "e.g. rain on a tin roof, distant traffic, a dog barking far off" : "e.g. slow, tense strings and a low pulse, building into the chase"} />
                        <div className="flex items-center gap-2 text-[11px] text-slate-300">
                          <Dropdown value={cue.model} options={STORYBOARD_MUSIC_MODELS.map(m => ({ value: m.id, label: m.label }))} onChange={v => onChangeShot(shot.id, { music: { ...cue, model: v } })} className="w-44" />
                          <label className="ml-auto flex items-center gap-1 text-[10px] text-slate-400" title="How loud it sits under the picture (the Final Cut lowers it under speech by default)">
                            Level <input type="range" min={-24} max={0} step={1} value={cue.gainDb ?? -10} onChange={e => onChangeShot(shot.id, { music: { ...cue, gainDb: Number(e.target.value) } })} className="w-20 accent-slate-300" />
                            <span className="font-mono w-8">{cue.gainDb ?? -10}dB</span>
                          </label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <PlayAudio url={cue.url} />
                          <span className={`text-[10px] ${liveAudio(cue) === "failed" ? "text-red-300" : "text-slate-500"}`}>{cue.url ? `${fmtRuntime(cue.seconds)}${cue.madePrompt != null && cue.madePrompt !== cue.prompt ? " · edited since" : ""}` : statusText(cue)} · covers ~{span}s (to the next cue)</span>
                          <button onClick={() => onChangeShot(shot.id, { music: null })} disabled={busy} className="ml-auto text-slate-500 hover:text-red-300 disabled:opacity-30" title="Remove the cue"><Trash2 size={12} /></button>
                          <BrandButton size="xs" primary={!cue.url} busy={busy} disabled={busy || !cue.prompt.trim()} onClick={() => recCue(shot, cue)}>
                            {busy ? "Composing" : cue.url ? "Recompose" : "Compose"} <Tix n={cueTickets(cue, span)} />
                          </BrandButton>
                        </div>
                        {err[cue.id] && <p className="text-[10px] text-red-300">{err[cue.id]}</p>}
                      </>
                    )
                  })()}
                </div>
                {onAiEdit && <AudioAiEdit key={shot.id} shot={shot} onAiEdit={onAiEdit} onChangeShot={onChangeShot} />}
              </div>
            )
          })()}
        </>
      )}
    </section>
  )
}

// ── Revise ───────────────────────────────────────────────────────────────────

export function RevisePanel({ finalCut, version, onPickVersion, onWrite, onUpdate, onRun, onGoToShot, running, error, runTickets }: {
  finalCut: FinalCutState
  version: FinalCutVersion | null
  onPickVersion: (n: number) => void
  onWrite: (from: number, notes: string) => Promise<void>
  onUpdate: (r: ReviseDraft | null) => void
  onRun: (r: ReviseDraft) => Promise<void>
  onGoToShot: (n: number) => void
  running: boolean
  error: string | null
  /** About what the re-run costs (the cut's own work). */
  runTickets: (r: ReviseDraft) => number
}) {
  const [notes, setNotes] = useState("")
  const [writing, setWriting] = useState(false)
  const draft = finalCut.revision ?? null
  const fcRunning = finalCut.job?.status === "running"
  useEffect(() => { if (draft?.notes && !notes) setNotes(draft.notes) }, [draft?.notes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!finalCut.versions.length) return (
    <section className="silver-edge rounded-2xl p-4 mb-4 text-center">
      <ListChecks size={18} className="mx-auto text-slate-400" />
      <p className="mt-1 text-[12px] font-bold text-white">Revise</p>
      <p className="text-[11px] text-slate-500">Make a Final Cut first - then say what to change, and the edit AI writes the edits.</p>
    </section>
  )
  const from = draft?.from ?? version?.n ?? finalCut.versions.at(-1)!.n
  const setEdit = (id: string, patch: Partial<ReviseEdit>) => draft && onUpdate({ ...draft, edits: draft.edits.map(e => (e.id === id ? { ...e, ...patch } : e)) })
  const on = draft?.edits.filter(e => e.on && e.text.trim()) ?? []
  const boardTodo = on.filter(e => e.kind === "board")
  return (
    <section className="silver-edge rounded-2xl p-3 mb-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <ListChecks size={14} className="text-slate-300" />
        <span className="text-[12px] font-bold text-white">Revise</span>
        <span className="text-[10.5px] text-slate-500">say what to change - the edit AI writes the edits, then re-cut. Repeat until it&apos;s right.</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-300">
        Revising
        <Dropdown value={String(from)} onChange={v => { onPickVersion(Number(v)); if (draft && Number(v) !== draft.from) onUpdate(null) }} className="w-56"
          options={[...finalCut.versions].reverse().map(v => ({ value: String(v.n), label: `Final Cut ${v.n}${v.scene ? ` · ${v.scene}` : ""} · ${fmtRuntime(v.durationSec)}${v.revisedFrom ? ` (rev. of ${v.revisedFrom})` : ""}` }))} />
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="sb-input"
        placeholder="e.g. the opening drags - get to the chase faster; the music is too loud under her line in shot 3; the end card should say 'See you tomorrow'" />
      <div className="flex items-center gap-2">
        <BrandButton size="xs" primary={!draft} busy={writing} disabled={writing || !notes.trim() || fcRunning} icon={<Wand2 size={11} />}
          onClick={async () => { setWriting(true); try { await onWrite(from, notes.trim()) } finally { setWriting(false) } }}>
          {draft ? "Rewrite the edits" : "Write the edits"} <Tix n={1} />
        </BrandButton>
        {draft && <button onClick={() => onUpdate(null)} className="text-[10.5px] text-slate-500 hover:text-white flex items-center gap-1"><X size={11} /> Discard</button>}
      </div>
      {error && <p className="text-[10.5px] text-red-300">{error}</p>}
      {draft && (
        <div className="space-y-1.5">
          {draft.summary && <p className="text-[11px] text-slate-300"><Sparkles size={11} className="inline -mt-0.5 mr-1 text-slate-400" />{draft.summary}</p>}
          {draft.edits.map(e => (
            <div key={e.id} className={`flex items-start gap-2 rounded-lg border p-2 ${e.on ? "border-white/15 bg-white/[0.03]" : "border-white/[0.06] opacity-50"}`}>
              <input type="checkbox" checked={e.on} onChange={x => setEdit(e.id, { on: x.target.checked })} className="mt-1 accent-slate-300" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider ${e.kind === "cut" ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>{e.kind === "cut" ? "In the cut" : "On the board"}</span>
                  {e.shot ? <button onClick={() => onGoToShot(e.shot!)} className="text-[10px] font-mono text-slate-400 hover:text-white flex items-center gap-0.5">shot {e.shot} <ArrowRight size={9} /></button> : <span className="text-[10px] text-slate-500">whole film</span>}
                </div>
                <textarea value={e.text} onChange={x => setEdit(e.id, { text: x.target.value })} rows={2} className="sb-input !text-[11px]" />
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={draft.rescore} onChange={x => onUpdate({ ...draft, rescore: x.target.checked })} className="accent-slate-300" />
            Compose the music again <span className="text-slate-500">(off = keep the last score)</span>
          </label>
          {boardTodo.length > 0 && <p className="text-[10.5px] text-amber-200/90">{boardTodo.length} edit{boardTodo.length === 1 ? " needs" : "s need"} the board changed first (a reshoot, a new line...) - do {boardTodo.length === 1 ? "it" : "them"} on the shots, then re-run. The cut follows whatever the board holds.</p>}
          <BrandButton primary size="sm" className="w-full" busy={running || fcRunning} disabled={running || fcRunning || !on.length} icon={<RotateCcw size={12} />} onClick={() => onRun(draft)}>
            {fcRunning ? "Cutting…" : <>Re-run the Final Cut with {on.length} edit{on.length === 1 ? "" : "s"} <Tix n={runTickets(draft)} approx /></>}
          </BrandButton>
        </div>
      )}
      {version?.edits?.length ? (
        <div className="rounded-lg border border-white/[0.07] p-2 text-[10.5px] text-slate-400">
          <span className="font-semibold text-slate-300">Final Cut {version.n}</span> was a revision of {version.revisedFrom}: {version.edits.join(" · ")}
        </div>
      ) : null}
      {fcRunning && <p className="flex items-center gap-1.5 text-[10.5px] text-slate-400"><Loader2 size={11} className="animate-spin" />{finalCut.job?.message}</p>}
    </section>
  )
}
