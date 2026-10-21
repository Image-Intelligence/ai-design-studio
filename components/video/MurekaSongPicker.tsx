"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Music, Play, Pause, Loader2 } from "lucide-react"

/*
 * Mureka Lyrics Video in the VIDEO models (2026-10-21, owner: "sort all of
 * the models into their correct dropdown sections" - it makes an MP4, so it
 * lives with the video models, not as a button on audio cards). It turns one
 * of the account's own Mureka songs (with lyrics: a Song or a Song from a
 * Description - an instrumental has none to show) into a video with the
 * lyrics on screen. This picks the song; the page's submit reads
 * getMurekaSong() and sends it through /api/audio/generate.
 */

type Song = { id: number; prompt: string; model: string; imageUrl: string; createdAt: string; videoMetadata?: { murekaSongId?: string; durationMs?: number; label?: string | null } | null }

let picked: number | null = null
const listeners = new Set<() => void>()
const setPicked = (id: number | null) => { picked = id; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** The song the lyrics video is made from (a GeneratedImage id), or null. */
export const getMurekaSong = () => picked
// The songs last listed - so the generating tile can show which song it is
let listed: Song[] = []
/** The picked song's link and name (the generating tile's popup), or null. */
export const getMurekaSongItem = (): { id: number; url: string; name: string } | null => {
  const s = listed.find(x => x.id === picked)
  return s ? { id: s.id, url: s.imageUrl, name: nameOf(s) } : null
}

const LYRIC_MODELS = ["audio:mureka-song", "audio:mureka-song-prompt"]
const fmt = (ms?: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` : "")
/** A song's name: its label, or the start of its lyrics / description. */
const nameOf = (s: Song) => (s.videoMetadata?.label || s.prompt.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 70) || "Untitled song"

export function MurekaSongPicker() {
  const current = useSyncExternalStore(subscribe, () => picked, () => picked)
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let off = false
    fetch(`/api/my-images?type=audio&cursor=1&limit=60&models=${encodeURIComponent(LYRIC_MODELS.join(","))}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (off) return
        const list: Song[] = (Array.isArray(d?.images) ? d.images : []).filter((s: Song) => !!s.videoMetadata?.murekaSongId)
        setSongs(list)
        listed = list
        if (picked === null || !list.some(s => s.id === picked)) setPicked(list[0]?.id ?? null)
      })
      .catch(() => { if (!off) setSongs([]) })
    return () => { off = true; audio.current?.pause() }
  }, [])

  const toggle = (s: Song) => {
    if (playing === s.id) { audio.current?.pause(); setPlaying(null); return }
    audio.current?.pause()
    const a = new Audio(s.imageUrl)
    a.onended = () => setPlaying(null)
    audio.current = a
    void a.play().catch(() => setPlaying(null))
    setPlaying(s.id)
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">Song <span className="normal-case tracking-normal text-slate-600">(one of your Mureka songs)</span></span>
      {songs === null && <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500"><Loader2 size={11} className="animate-spin" /> Loading your songs…</p>}
      {songs && songs.length === 0 && (
        <p className="text-[10.5px] leading-snug text-slate-400">
          No Mureka songs yet - make one in the Audio models (Mureka 9.5 Song, or Song from a Description), then turn it into a lyrics video here.
        </p>
      )}
      {songs && songs.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
          {songs.map(s => {
            const on = s.id === current
            return (
              <div key={s.id} onClick={() => setPicked(s.id)} role="button"
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${on ? "border-white/60 bg-white/[0.08]" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
                <button onClick={e => { e.stopPropagation(); toggle(s) }} title={playing === s.id ? "Pause" : "Listen"}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/15">
                  {playing === s.id ? <Pause size={10} /> : <Play size={10} />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-slate-100">{nameOf(s)}</span>
                  <span className="flex items-center gap-1 text-[9.5px] text-slate-500"><Music size={9} />{s.model === "audio:mureka-song" ? "Song" : "Song from a description"}{fmt(s.videoMetadata?.durationMs) && ` · ${fmt(s.videoMetadata?.durationMs)}`}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
