"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X, Download, Check, LayoutTemplate } from "lucide-react"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { fmtRuntime, STILLS_CUT_TICKETS } from "@/lib/storyboard"

/**
 * The Stills cut: the board as a film of its stills (or its clips where a
 * shot has one) - push-ins and pans, wipes where a shot edits the one before
 * it, before -> after reveals, captions the AI places clear of faces and
 * subjects - in the board's frame or exported for a home card (4:3, silent,
 * light), social (9:16) or YouTube (16:9). A finished cut can go straight onto
 * a home-page card. See /api/employees/storyboards/[id]/stills-cut.
 */
const FORMATS = [
  { id: "board", label: "Board frame", hint: "The board's own shape" },
  { id: "card", label: "Home card", hint: "4:3 · 1280×960 · silent, light" },
  { id: "social", label: "Social", hint: "9:16 · Reels, TikTok, Shorts" },
  { id: "wide", label: "Wide", hint: "16:9 · YouTube" },
] as const
type Format = (typeof FORMATS)[number]["id"]
type Result = { url: string; durationSec: number; posterUrl: string; width: number; height: number; format: Format }

const KEY = "pv2-stills-cut"

export function StillsCutPanel({ boardId, sceneId, sceneName, hasClips, isAdmin = false, onClose }: {
  boardId: number
  /** Cut one scene only. */
  sceneId?: string | null
  sceneName?: string
  /** Some shots have a finished video - offer to use them. */
  hasClips: boolean
  /** Admins can put a cut on a home-page card. */
  isAdmin?: boolean
  onClose: () => void
}) {
  // The last choices, per browser
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} } })()
  const [format, setFormat] = useState<Format>(FORMATS.some(f => f.id === saved.format) ? saved.format : "board")
  const [captions, setCaptions] = useState<boolean>(saved.captions ?? true)
  const [tag, setTag] = useState<string>(saved.tag ?? "")
  const [clips, setClips] = useState<boolean>(saved.clips ?? true)
  const [loop, setLoop] = useState<boolean>(saved.loop ?? false)
  const [busy, setBusy] = useState(false)
  const [since, setSince] = useState(0)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Result | null>(null)
  const [cardKey, setCardKey] = useState<string>(saved.cardKey ?? "")
  const [carding, setCarding] = useState<"idle" | "busy" | "done" | "failed">("idle")
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ format, captions, tag, clips, loop, cardKey })) } catch { /* private window */ } }, [format, captions, tag, clips, loop, cardKey])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const h = setInterval(() => setSince(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(h)
  }, [busy])

  const run = async () => {
    setBusy(true); setError(""); setResult(null); setCarding("idle")
    try {
      const r = await fetch(`/api/employees/storyboards/${boardId}/stills-cut`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, captions, tag: tag.trim() || undefined, clips: hasClips && clips, loop, sceneId: sceneId || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || `The cut failed (${r.status})`)
      setResult({ ...j, format })
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }
  const toCard = async () => {
    if (!result || !cardKey.trim()) return
    setCarding("busy")
    const r = await fetch(`/api/employees/storyboards/${boardId}/stills-cut`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "home-card", url: result.url, key: cardKey.trim() }),
    }).catch(() => null)
    setCarding(r?.ok ? "done" : "failed")
  }

  const opt = (on: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="accent-slate-300 mt-0.5" />
      <span><span className="block text-[11.5px] font-semibold text-slate-100">{label}</span><span className="block text-[10px] text-slate-500 leading-snug">{hint}</span></span>
    </label>
  )

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="silver-edge relative w-full max-w-[560px] max-h-[92dvh] overflow-y-auto rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <BrandTitle title="Stills cut" eyebrow={sceneName ? `Scene · ${sceneName}` : "The board as a film of its pictures"} logo={22} size="sm" />
          <button onClick={onClose} disabled={busy} className="ml-auto p-1 rounded-md text-slate-400 hover:text-white disabled:opacity-30"><X size={16} /></button>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          Each still is held with a slow push-in (a panorama pans), a shot that <b className="text-slate-200">edits</b> the one before it wipes in, and a shot with a <b className="text-slate-200">before</b> picture plays before → after. No video model touches the pictures.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {FORMATS.map(f => (
            <button key={f.id} onClick={() => setFormat(f.id)} className={`rounded-xl border px-2 py-2 text-left ${format === f.id ? "border-white/60 bg-white/10" : "border-white/10 hover:border-white/30"}`}>
              <span className="block text-[11.5px] font-bold text-white">{f.label}</span>
              <span className="block text-[9.5px] text-slate-500 leading-snug">{f.hint}</span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {opt(captions, setCaptions, "Captions", "A caption on every shot - its own (Details) or one the AI writes from its title - placed where it covers no face, subject or text")}
          {captions && (
            <input value={tag} onChange={e => setTag(e.target.value)} maxLength={40} placeholder="Gold line over every caption (optional) - e.g. NANO BANANA 2.1" className="sb-input w-full" />
          )}
          {hasClips && opt(clips, setClips, "Use shot videos", "Where a shot has a finished clip, play it instead of the still - motion and stills in one cut")}
          {opt(loop, setLoop, "Open on the last shot", "The cut starts on its ending too, so a looping player (a home card) runs on seamlessly")}
        </div>

        {error && <p className="text-[11px] text-red-300">{error}</p>}
        {!result && (
          <BrandButton onClick={run} disabled={busy} busy={busy} primary size="sm" className="w-full">
            {busy ? `Cutting… ${fmtRuntime(since)}` : `Make the cut · ${STILLS_CUT_TICKETS} tickets`}
          </BrandButton>
        )}
        {busy && <p className="text-[10px] text-slate-500 text-center">About a minute for a dozen shots - captions add a look at every frame.</p>}

        {result && (
          <div className="space-y-2">
            <video src={result.url} poster={result.posterUrl} controls playsInline loop autoPlay muted className="w-full rounded-xl bg-black" style={{ aspectRatio: `${result.width}/${result.height}`, maxHeight: "56dvh" }} />
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] font-mono text-slate-400">{fmtRuntime(result.durationSec)} · {result.width}×{result.height} · saved to My Generations</span>
              <a href={result.url} download target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/20 text-[10.5px] font-semibold text-slate-100 hover:bg-white/10"><Download size={11} />Download</a>
              <button onClick={() => setResult(null)} className="px-2 py-1 rounded-md border border-white/10 text-[10.5px] text-slate-300 hover:text-white">New cut</button>
            </div>
            {isAdmin && <div className="rounded-xl border border-white/10 p-2 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100"><LayoutTemplate size={12} />Put it on a home-page card</p>
              <p className="text-[9.5px] text-slate-500 leading-snug">Goes live on the site at once - card-sized (long side 1280, ~3 Mbps, silent). The card key is the one its media uses, e.g. <span className="font-mono text-slate-300">image:NanoBanana 2.1</span>.</p>
              <div className="flex gap-1.5">
                <input value={cardKey} onChange={e => { setCardKey(e.target.value); setCarding("idle") }} placeholder="image:NanoBanana 2.1" className="sb-input flex-1" />
                <BrandButton onClick={toCard} disabled={!cardKey.trim() || carding === "busy" || carding === "done"} busy={carding === "busy"} size="xs">
                  {carding === "done" ? <><Check size={11} />On the card</> : carding === "failed" ? "Failed - retry" : "Use on card"}
                </BrandButton>
              </div>
            </div>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
