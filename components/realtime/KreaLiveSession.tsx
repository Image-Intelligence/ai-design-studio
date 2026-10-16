"use client"

/**
 * KREA 3 REALTIME - live editing (2026-10-15, admin while under test).
 *
 * fal's krea/v3/realtime is a SESSION, not a request: the page opens a socket,
 * sends an image once and then just prompts (and seeds); each message comes
 * back as a new 768px frame in ~0.3s (the first one takes ~10s while the model
 * warms up). The picture stays for the whole session, so typing re-edits the
 * same picture as you go - "Turn <image-1> into a watercolor", then "...into
 * a neon night scene" - and a frame you like is saved to the feed.
 *
 * Billing follows fal's: every second the socket is open costs ($0.013/s).
 * The page pays in 30-second blocks (/api/realtime/krea/meter) before it
 * sends, and closes the socket after 20 seconds without a change - an idle
 * socket still bills - reopening it (and paying again) when you type.
 *
 * The socket is fal's own (@fal-ai/client realtime): /api/realtime/krea hands
 * out the short-lived token, so the account's key never reaches the page.
 *
 * The Live switch turns the session off by hand while you think: the socket
 * closes (the bill stops), the last frame stays on screen, and anything
 * changed meanwhile - prompt, seed, picture - waits and goes out as one frame
 * when Live is turned back on. Time already paid for isn't lost: resuming
 * inside the paid 30 seconds doesn't pay again.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createFalClient } from "@fal-ai/client"
import { X, Dice5, Save, Loader2, Eye, ImageIcon, Eraser, Radio, Pause, Check, Power } from "lucide-react"
import { KREA3_REALTIME_BLOCK_SEC, KREA3_REALTIME_BLOCK_TICKETS } from "@/lib/ticket-pricing"

/** Close the socket after this long without a change (an open socket bills). */
const IDLE_MS = 20_000
/** A frame is "settled" - and saved - once no newer frame has come for this long */
const SETTLE_MS = 2_500
/** ...except while a new socket waits for its first frame: a cold start can take
 *  well over 20s, and closing it then threw the warm-up away (and its payment) */
const WARMUP_MS = 90_000
/** Now and then fal routes a session somewhere that never replies: the socket
 *  opens, takes the message and stays silent (seen 2026-10-15 and -16 - a raw
 *  probe got one socket answering in 13s while its twin stayed silent for 40s).
 *  A cold start itself can take ~15s, so a slow socket is NOT killed (that threw
 *  away warm-ups that were about to answer): every HEDGE_MS without a first
 *  frame another socket is opened ALONGSIDE it, and the first to answer wins -
 *  the others close. At most MAX_COLD wait at once (the oldest gives way). */
const HEDGE_MS = 10_000
const MAX_COLD = 2
/** Extra sockets tried before giving up (~60s in all - and none of it is charged) */
const MAX_RECONNECTS = 4
/** Frames are 768px on fal's side; the source is sent no bigger. */
const FRAME_SIDE = 768

/** "paused" = closed itself when idle (typing resumes); "off" = the Live switch (only the switch resumes) */
type Status = "idle" | "connecting" | "live" | "paused" | "off" | "error"
type Conn = { send: (input: Record<string, unknown>) => void; close: () => void }

/** A picture as a JPEG data URL of at most 768px a side (fal resizes frames to 768 anyway). */
async function toFrame(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error("Could not load the picture")
  const bmp = await createImageBitmap(await r.blob())
  const k = Math.min(1, FRAME_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement("canvas")
  c.width = Math.max(16, Math.round(bmp.width * k)); c.height = Math.max(16, Math.round(bmp.height * k))
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL("image/jpeg", 0.9)
}

export function KreaLiveSession({ source, initialPrompt = "", onClose, onBalanceChange, onSaved }: {
  /** The picture to edit (a feed or reference URL), or null to start from words alone. */
  source: string | null
  initialPrompt?: string
  onClose: () => void
  onBalanceChange?: (balance: number) => void
  /** A frame was kept: the session's feed row, with every frame it holds so far (one tile per session). */
  onSaved?: (row: { id: number; url: string; prompt: string; aspectRatio?: string; frames: { url: string; prompt: string; seed: number | null; at: number }[] }) => void
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [seed, setSeed] = useState(35)
  const [src, setSrc] = useState<string | null>(null)
  const [srcLoading, setSrcLoading] = useState(!!source)
  const [frame, setFrame] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [frames, setFrames] = useState(0)
  const [latency, setLatency] = useState<number | null>(null)
  const [openSec, setOpenSec] = useState(0)
  const [tickets, setTickets] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  /** The Live switch: off = nothing is sent (or paid for) until it is turned back on */
  const [on, setOn] = useState(true)

  // The socket and what it has been sent live in refs: the fal client calls
  // back outside React, and a send must read the latest prompt / seed / source
  const client = useRef(createFalClient({ proxyUrl: "/api/realtime/krea" }))
  const conn = useRef<Conn | null>(null)
  const needImage = useRef(true)
  /** When the picture first went out since needImage was set (0 = not yet) - a frame
   *  arriving sooner than one frame-time later is from before it, so it doesn't count */
  const imageSentAt = useRef(0)
  /** The picture has to (re)reach the session: a new socket, or a new picture */
  const wantImage = () => { needImage.current = true; imageSentAt.current = 0 }
  const paidUntil = useRef(0)
  const paying = useRef<Promise<boolean> | null>(null)
  const lastSend = useRef(0)
  const sentAt = useRef(0)
  const stopped = useRef(false)
  /** Which socket is current: a closed socket can still report an error late,
   *  and that must not mark the next one (or a switched-off session) as dropped */
  const connId = useRef(0)
  /** The current socket has sent back a frame (it is warm) - the session has
   *  started on fal, and only from then on is it charged */
  const warm = useRef(false)
  /** Sockets still waiting for their first frame, oldest first (see HEDGE_MS).
   *  `conn` is only ever the warm one - a cold socket is promoted when it answers */
  const cold = useRef(new Map<number, Conn>())
  const nextId = useRef(0)
  /** When the newest cold socket was opened - the hedge clock */
  const hedgedAt = useRef(0)
  /** When the session's first message went out with no warm socket - the give-up clock */
  const coldSince = useRef(0)
  const reconnects = useRef(0)
  /** The same count for the screen ("Reconnecting 2/3") */
  const [retry, setRetry] = useState(0)
  const live = useRef({ prompt: initialPrompt, seed: 35, src: null as string | null, on: true })
  live.current = { prompt, seed, src, on }
  const statusNow = useRef(status)
  statusNow.current = status

  // The source picture, made into a frame once
  useEffect(() => {
    if (!source) { setSrcLoading(false); return }
    let gone = false
    toFrame(source)
      .then(f => { if (!gone) { setSrc(f); wantImage() } })
      .catch(e => { if (!gone) setError(String(e?.message || e)) })
      .finally(() => { if (!gone) setSrcLoading(false) })
    return () => { gone = true }
  }, [source])

  /** Pays for the next 30 seconds unless they are paid already. False = can't (the socket is closed). */
  const ensurePaid = useCallback(async (): Promise<boolean> => {
    if (Date.now() < paidUntil.current - 2_000) return true
    if (paying.current) return paying.current
    paying.current = (async () => {
      try {
        const r = await fetch("/api/realtime/krea/meter", { method: "POST" })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setError(j.error || "Could not pay for the session"); return false }
        paidUntil.current = Math.max(Date.now(), paidUntil.current) + (j.seconds ?? KREA3_REALTIME_BLOCK_SEC) * 1000
        setTickets(t => t + (j.tickets ?? 0))
        if (typeof j.balance === "number" && j.balance >= 0) onBalanceChange?.(j.balance)
        return true
      } catch {
        setError("Could not reach the server")
        return false
      } finally {
        paying.current = null
      }
    })()
    return paying.current
  }, [onBalanceChange])

  const closeSocket = useCallback((next: Status) => {
    // Forgotten BEFORE closing: a close can report an error at once, and that
    // must not read as the live socket (or a waiting one) dropping
    connId.current = 0
    const all = [conn.current, ...cold.current.values()]
    conn.current = null
    cold.current.clear()
    for (const c of all) c?.close()
    // The next socket is cold again: it is free until IT sends a frame (before
    // this, typing after an idle pause paid a block before fal had answered)
    warm.current = false
    coldSince.current = 0
    wantImage()
    // paidUntil is kept: reopening inside the paid 30 seconds uses what is left
    setStatus(next)
  }, [])

  /** What is on screen now, as a message: the prompt, the seed and - until a
   *  socket has it - the picture. It rides on EVERY message until a frame comes
   *  back: fal's client throttles sends and keeps only the latest, so a picture
   *  sent once with the first keystroke was dropped by the next. "" = words alone. */
  const message = () => {
    const { prompt: p, seed: s, src: img } = live.current
    const msg: Record<string, unknown> = { prompt: p.trim(), seed: s }
    if (needImage.current) {
      msg.image_url = img ?? ""
      if (!imageSentAt.current) imageSentAt.current = Date.now()
    }
    return msg
  }

  /** Opens a socket that waits (cold) for its first frame - it becomes THE
   *  socket only when it answers, and only then does the session start paying */
  const dial = useCallback(() => {
    if (!cold.current.size) { warm.current = false; coldSince.current = 0; wantImage() }
    const id = ++nextId.current
    setStatus("connecting")
    const c = client.current.realtime.connect("krea/v3", {
      // A fresh key per socket: hedged sockets run side by side
      connectionKey: `krea-live-${id}-${Date.now()}`,
      throttleInterval: 120,
      onResult: (r: any) => {
        const url = r?.images?.[0]?.url
        if (typeof url !== "string") return
        if (id !== connId.current) {
          // A frame from a closed socket (Live switched off, a race lost) doesn't replace the one on screen
          const won = cold.current.get(id)
          if (!won) return
          // The first socket to answer wins; the others waiting beside it close
          const losers = [...cold.current.values()].filter(o => o !== won)
          cold.current.clear()
          for (const o of losers) o.close()
          conn.current = won
          connId.current = id
          warm.current = true
          coldSince.current = 0
          reconnects.current = 0
          setRetry(0)
          // The session has started on fal: its time is paid from this first
          // frame - if fal never answers (it sometimes goes silent for hours)
          // nobody pays for the wait
          void ensurePaid().then(ok => { if (!ok) closeSocket("paused") })
        }
        setFrame(url)
        // The session has the picture now - later messages only change the prompt / seed
        if (needImage.current && imageSentAt.current && Date.now() - imageSentAt.current > 600) { needImage.current = false; imageSentAt.current = 0 }
        setFrames(n => n + 1)
        setLatency(sentAt.current ? Date.now() - sentAt.current : null)
        setStatus("live")
        setError(null)
      },
      onError: (e: any) => {
        if (cold.current.has(id)) {
          // A waiting socket failed: the others (or the next hedge) carry on
          cold.current.delete(id)
          if (cold.current.size) return
        } else if (id !== connId.current) return
        const msg = String(e?.message || "The live session dropped")
        // A dropped socket loses the picture: it is sent again on the next change
        wantImage()
        if (id === connId.current) { connId.current = 0; conn.current = null }
        warm.current = false
        coldSince.current = 0
        if (!stopped.current) { setError(msg.replace(/^Error closing the connection: ?/, "Connection closed ") || "The live session dropped"); setStatus("error") }
      },
    }) as Conn
    cold.current.set(id, c)
    hedgedAt.current = Date.now()
    return c
  }, [ensurePaid, closeSocket])

  /** Sends what is on screen now: the prompt, the seed and - once per socket - the picture. */
  const push = useCallback(async () => {
    if (stopped.current) return
    const { prompt: p, on: isOn } = live.current
    // Switched off: changes wait on screen and go out when Live is back on
    if (!isOn) return
    // Nothing is sent (or paid for) until there are words to send - opening the panel is free
    if (!p.trim()) return
    // A socket still warming up isn't paid yet - its first frame pays (onResult)
    if (warm.current && !(await ensurePaid())) { closeSocket("paused"); return }
    if (!conn.current && !cold.current.size) dial()
    const msg = message()
    lastSend.current = Date.now()
    sentAt.current = Date.now()
    if (!warm.current && !coldSince.current) coldSince.current = Date.now()
    if (conn.current) conn.current.send(msg)
    else for (const c of cold.current.values()) c.send(msg)
  }, [ensurePaid, dial, closeSocket])

  // Closing the panel closes the socket (the bill stops with it)
  // (Re-armed on mount: React's dev double-mount runs this cleanup once first.
  // It is declared BEFORE the send effect below - effects run in order, and a
  // send effect that ran first still saw stopped = true from that cleanup and
  // sent nothing: the panel sat on "Warming up" with no socket, 2026-10-16)
  useEffect(() => {
    stopped.current = false
    return () => {
      stopped.current = true
      connId.current = 0
      const all = [conn.current, ...cold.current.values()]
      conn.current = null
      cold.current.clear()
      for (const c of all) c?.close()
    }
  }, [])

  // Every change to the prompt, seed or picture is a new frame - and turning
  // Live back on sends whatever changed while it was off
  useEffect(() => {
    if (srcLoading) return
    void push()
  }, [prompt, seed, src, srcLoading, on, push])

  const toggleLive = () => {
    // Switching off ends that stretch of the session: its last frame is kept
    if (on) { keep("end"); setOn(false); closeSocket("off") }
    else { setOn(true); setError(null); setStatus(frame ? "paused" : "idle") }
  }

  // The meter: keep paying while in use, close the socket once idle
  useEffect(() => {
    const t = setInterval(() => {
      // "Warming up" with no socket behind it (lost without an error) would
      // spin forever - the watchdog below needs a socket - so open one
      if (!conn.current && !cold.current.size) { if (statusNow.current === "connecting" && live.current.on) void push(); return }
      // The clock runs only while fal is actually streaming (from its first frame) -
      // the same moment billing starts: warming up and a silent fal cost nothing
      if (warm.current) setOpenSec(n => n + 1)
      // Hedge: no first frame yet - another socket joins the wait (the slow one
      // keeps going: it may just be warming up), and the first to answer wins
      if (!warm.current && coldSince.current && Date.now() - hedgedAt.current > HEDGE_MS) {
        if (reconnects.current < MAX_RECONNECTS) {
          reconnects.current++
          setRetry(reconnects.current)
          // At most MAX_COLD wait at once: the oldest has had its chance
          while (cold.current.size >= MAX_COLD) {
            const [oid, oc] = cold.current.entries().next().value as [number, Conn]
            cold.current.delete(oid)
            oc.close()
          }
          dial().send(message())
          return
        }
        if (Date.now() - hedgedAt.current > 2 * HEDGE_MS) {
          reconnects.current = 0
          setRetry(0)
          closeSocket("error")
          setError("Krea 3 Realtime isn't answering - fal's service is down or overloaded right now. You were not charged for the wait. Type, or switch Live off and on, to try again.")
          return
        }
      }
      if (Date.now() - lastSend.current > (warm.current ? IDLE_MS : WARMUP_MS)) { closeSocket("paused"); return }
      if (warm.current && Date.now() > paidUntil.current - 1_500) void ensurePaid().then(ok => { if (!ok) closeSocket("paused") })
    }, 1000)
    return () => clearInterval(t)
  }, [ensurePaid, closeSocket, push, dial])

  /*
   * Saving (2026-10-16, owner: "it should automatically save"). Every frame a
   * session keeps goes into ONE feed tile (/api/realtime/krea/save, by this
   * panel's session key) that flips through them. What is kept:
   *   - each frame you SETTLE on: a new frame, then no change for SETTLE_MS -
   *     not every keystroke's frame (hundreds a minute, near-identical), and
   *     not a timer (which keeps repeats while you think and misses quick
   *     changes between ticks)
   *   - the last frame when the session ends (Live off, or the panel closes)
   *   - "Save this frame", any time
   * A frame already kept is never kept twice. Saves run one at a time, in order.
   */
  const sessionKey = useRef(`k3-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`)
  const lastKept = useRef<string | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const [keptCount, setKeptCount] = useState(0)
  const frameNow = useRef<string | null>(null)
  frameNow.current = frame
  const keep = useCallback((why: "settled" | "end" | "manual") => {
    const shot = frameNow.current
    if (!shot || shot === lastKept.current) return
    lastKept.current = shot
    const { prompt: p, seed: sd } = live.current
    if (why === "manual") setSaving(true)
    chain.current = chain.current.then(async () => {
      try {
        const r = await fetch("/api/realtime/krea/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: shot, prompt: p, seed: sd, session: sessionKey.current }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.id) throw new Error(j.error || "Could not save the frame")
        setKeptCount(j.count ?? 0)
        if (why === "manual") { setSaved(j.id); setTimeout(() => setSaved(null), 2500) }
        onSaved?.({ id: j.id, url: j.url, prompt: j.prompt ?? p, aspectRatio: j.aspectRatio, frames: j.frames ?? [] })
      } catch (e: any) {
        if (lastKept.current === shot) lastKept.current = null
        if (why !== "end") setError(String(e?.message || e))
      } finally {
        if (why === "manual") setSaving(false)
      }
    })
  }, [onSaved])
  const save = async () => keep("manual")

  // A frame you settle on (no newer frame for SETTLE_MS) is kept
  useEffect(() => {
    if (!frame || !on) return
    const t = setTimeout(() => keep("settled"), SETTLE_MS)
    return () => clearTimeout(t)
  }, [frame, on, keep])

  /** Closing keeps the last frame first (the save carries on after the panel is gone). */
  const close = () => { keep("end"); onClose() }

  const useFrameAsSource = () => { if (frame) { setSrc(frame); wantImage() } }
  const clearSource = () => { setSrc(null); wantImage() }
  const shown = comparing && src ? src : frame
  const mmss = `${Math.floor(openSec / 60)}:${String(openSec % 60).padStart(2, "0")}`

  // `short` is the phone's wording - the chip is shown at every size (on a
  // phone only the switch showed, so a stalled warm-up just read "Live")
  const starting = frames ? "Reconnecting" : "Starting on fal"
  const chip = status === "live" ? { icon: <Radio size={11} className="text-emerald-300" />, text: "Live", short: "Live", cls: "border-emerald-400/30 text-emerald-200" }
    : status === "connecting" ? { icon: <Loader2 size={11} className="animate-spin" />, text: `${retry ? `${starting} (try ${retry + 1})` : starting} · not charged`, short: frames ? "Reconnecting" : "Starting", cls: "border-sky-300/30 text-sky-100" }
    : status === "paused" ? { icon: <Pause size={11} />, text: "Paused - type to resume", short: "Paused", cls: "border-white/15 text-slate-400" }
    : status === "error" ? { icon: <X size={11} />, text: "Disconnected - type to retry", short: "Disconnected", cls: "border-rose-400/30 text-rose-200" }
    : { icon: <Radio size={11} />, text: "Ready", short: "Ready", cls: "border-white/15 text-slate-400" }
  /** The switch only reads "Live" (and goes green) once fal is actually
   *  streaming - while it starts it said "Live" over "Warming up" (owner, 2026-10-16) */
  const streaming = on && status === "live"
  const switchText = !on ? "Off" : streaming ? "Live" : "On"

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="relative w-full max-w-5xl max-h-full overflow-y-auto rounded-2xl border border-white/15 bg-[#070b14] shadow-2xl"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 0 40px rgba(160,180,210,0.08)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 leading-tight">Live edit</p>
            <p className="truncate text-[10px] font-mono text-slate-500 uppercase tracking-[0.18em]">Krea 3 Realtime · admin</p>
          </div>
          {/* The state chip - left out when it would only repeat the switch ("Live" / "Off") */}
          {status !== "live" && status !== "off" && <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 sm:px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap ${chip.cls}`}>{chip.icon}<span className="sm:hidden">{chip.short}</span><span className="hidden sm:inline">{chip.text}</span></span>}
          {/* The Live switch - off stops the session (and the bill) while you think */}
          <button
            role="switch" aria-checked={on} onClick={toggleLive}
            title={on ? "Turn Live off - the picture stays and nothing is billed until you turn it back on" : "Turn Live back on - sends what you changed"}
            className={`inline-flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 text-[11px] font-bold transition-colors ${streaming ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20" : on ? "border-white/25 bg-white/[0.06] text-slate-100 hover:bg-white/10" : "border-white/20 bg-white/[0.04] text-slate-300 hover:bg-white/10"}`}
          >
            <span className={`relative h-4 w-7 rounded-full transition-colors ${streaming ? "bg-emerald-400/80" : on ? "bg-slate-400/70" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left] ${on ? "left-[14px]" : "left-0.5"}`} />
            </span>
            <Power size={12} />
            {switchText}
          </button>
          <button onClick={close} className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/10" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_260px]">
          {/* The live frame */}
          <div className="min-w-0">
            <div className="relative mx-auto aspect-square w-full max-w-[min(100%,70vh)] overflow-hidden rounded-xl border border-white/10 bg-black/60">
              {shown
                ? <img src={shown} alt="Live frame" className="h-full w-full object-contain" draggable={false} />
                : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-slate-500">
                    {status === "connecting" || srcLoading ? <Loader2 size={22} className="animate-spin text-slate-300" /> : <ImageIcon size={22} />}
                    {srcLoading
                      ? <p className="text-[12px]">Loading the picture…</p>
                      : status === "connecting"
                        ? <>
                            <p className="text-[13px] font-semibold text-slate-200">{retry ? `fal is slow to answer - trying another connection (${retry}/${MAX_RECONNECTS})…` : "Starting your session on fal…"}</p>
                            <p className="text-[11.5px]">The first picture usually takes 10-15 seconds, then every change shows in a blink.</p>
                            <p className="mt-1 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-[11.5px] font-semibold text-sky-100">You are not being charged - billing starts with the first picture</p>
                          </>
                        : <p className="text-[12px]">{src ? "Describe the change below - each keystroke is a new frame." : "Describe a picture below to start from words alone."}</p>}
                  </div>}
              {comparing && src && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">Original</span>}
              {status === "connecting" && frame && (
                <span className="absolute inset-x-2 bottom-2 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-sky-300/25 bg-black/75 px-3 py-1 text-[10.5px] font-semibold text-sky-100">
                  <Loader2 size={11} className="animate-spin" /> Reconnecting to fal - not charged until pictures flow again
                </span>
              )}
              {!on && (
                <button onClick={toggleLive} className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 hover:bg-black/85">
                  <Pause size={11} /> Live off - tap to resume
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              autoFocus
              rows={2}
              maxLength={2000}
              placeholder={src ? "e.g. Turn <image-1> into a watercolor painting at dusk" : "e.g. A paper boat on a still lake at sunrise"}
              className="mt-3 w-full resize-none rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-[13px] text-white placeholder-slate-600 focus:outline-none focus:border-white/40"
            />
            {on
              ? <p className="mt-1 text-[10.5px] text-slate-500">Every change re-renders the same picture as you type. <span className="text-slate-400">&lt;image-1&gt;</span> is the picture you started from.</p>
              : <p className="mt-1 text-[10.5px] text-amber-200/80">Live is off - nothing is sent or billed. Edit freely; your changes go out as one frame when you turn Live back on.</p>}
            {error && <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">{error}</p>}
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-slate-500">Picture</p>
              <div className="mt-2 flex items-center gap-2.5">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/50">
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-600">words only</div>}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <button onClick={useFrameAsSource} disabled={!frame} className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40">Edit this frame next</button>
                  <button onClick={clearSource} disabled={!src} className="w-full flex items-center justify-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10.5px] text-slate-400 hover:text-white disabled:opacity-40"><Eraser size={10} /> Words only</button>
                </div>
              </div>
              {src && (
                <button
                  onPointerDown={() => setComparing(true)} onPointerUp={() => setComparing(false)} onPointerLeave={() => setComparing(false)}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[10.5px] text-slate-300 hover:bg-white/10 select-none"
                ><Eye size={11} /> Hold to see the original</button>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-slate-500">Seed</p>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" value={seed} onChange={e => setSeed(Math.max(0, Math.min(2147483647, Math.trunc(Number(e.target.value) || 0))))}
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-[12px] tabular-nums text-white focus:outline-none focus:border-white/40" />
                <button onClick={() => setSeed(Math.floor(Math.random() * 100000))} title="A new seed - a different take on the same prompt" className="rounded-md border border-white/15 p-1.5 text-slate-200 hover:bg-white/10"><Dice5 size={15} /></button>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">The same seed keeps frames consistent while you type.</p>
            </div>

            <button onClick={() => void save()} disabled={!frame || saving}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-white/25 bg-white/10 py-2.5 text-[12px] font-bold text-white hover:bg-white/15 disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
              {saved ? "Saved to your feed" : "Save this frame"}
            </button>
            <p className="-mt-1 text-center text-[10.5px] text-slate-500">
              {keptCount > 0 ? `${keptCount} frame${keptCount === 1 ? "" : "s"} kept in one feed tile` : "Frames you settle on save themselves - all in one feed tile"}
            </p>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-400 space-y-1">
              {/* Whether the session is being charged right now - it is only while fal streams */}
              <p className={`-mx-1 mb-1.5 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${streaming ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-sky-300/20 bg-sky-400/[0.07] text-sky-100"}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${streaming ? "bg-emerald-300 animate-pulse" : "bg-sky-200/70"}`} />
                {streaming ? "Session live on fal - billed per 30s" : status === "connecting" ? "Not charged - waiting for fal to start" : "Not charged right now"}
              </p>
              <p className="flex justify-between"><span>Live time</span><span className="tabular-nums text-slate-200">{mmss}</span></p>
              <p className="flex justify-between"><span>Frames</span><span className="tabular-nums text-slate-200">{frames}</span></p>
              {latency !== null && <p className="flex justify-between"><span>Last frame</span><span className="tabular-nums text-slate-200">{(latency / 1000).toFixed(1)}s</span></p>}
              <p className="flex justify-between"><span>Tickets</span><span className="tabular-nums text-slate-200">{tickets}</span></p>
              <p className="pt-1 text-[10px] leading-snug text-slate-500">{KREA3_REALTIME_BLOCK_TICKETS} tickets per {KREA3_REALTIME_BLOCK_SEC}s, charged from the first picture fal sends - warming up, retries and a silent fal cost nothing. It pauses itself after {IDLE_MS / 1000}s without a change and picks up when you type; switch Live off to stop it sooner. Admins are not charged.</p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
