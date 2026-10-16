"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createFalClient } from "fal-realtime-alpha"
import { wma } from "fal-realtime-alpha/realtime/wma"
import { WMA_MODELS, type WmaModelId } from "@/lib/realtime-wma"

/**
 * One live-video session with a fal "WMA" model (lib/realtime-wma) - shared by
 * the Worlds studio and H3 Max Director's popup (2026-10-16).
 *
 * fal's alpha client (installed as `fal-realtime-alpha`, so the rest of the
 * site keeps the stable one) negotiates WebRTC through /api/realtime/wma and
 * hands back a MediaStream; control messages go over the session's data
 * channel as JSON. This hook adds what the site needs around it:
 *   - billing: nothing is paid while the model warms up; the first frame pays
 *     the first 30 seconds (/api/realtime/wma/meter) and each block is renewed
 *     before it runs out. The proxy refuses the heartbeat of an unpaid session,
 *     so this page can't run up time it hasn't paid for even if it tried
 *   - stopping: an idle session (no control from the user for `idleMs`) and a
 *     hidden tab end it - a world keeps streaming, and billing, on its own
 *   - recording: the stream (video, and sound where the model sends it) is
 *     recorded on demand and saved as a clip in the feed (./wma/clip)
 */

export type WmaStatus = "idle" | "connecting" | "live" | "ended" | "error"

export interface WmaSessionOptions {
  model: WmaModelId
  /** Sets the meter's price where it depends on size (H3 Max Director). */
  resolution?: string
  /** End the session after this long without a call to touch() (ms). */
  idleMs?: number
  /** Each JSON message the model sends. */
  onMessage?: (msg: any) => void
  onBalanceChange?: (balance: number) => void
  /** Save the WHOLE session, full quality, to the feed when it ends (every live model -
   *  the user paid for every second). `setup` is kept on the saved video. */
  autoSaveWhole?: { prompt: string; aspectRatio?: string; resolution?: string; setup?: Record<string, unknown> }
  /** Saved clips were swapped for fal's full-quality recording (or a whole session was saved). */
  onUpgraded?: (r: { upgraded: { id: number; url: string; thumbnailUrl: string | null }[]; added: { id: number; url: string; thumbnailUrl: string | null; durationSec: number }[] }) => void
}

export type WmaUpgrade = { state: "working" | "done" | "failed"; text: string } | null

/*
 * What the page asks to receive. The model's WebRTC stream is compressed live
 * (measured 2026-10-16: VP8, ~1.5 Mbit/s at 960x544 - fal's own recording of
 * the same session is far sharper). VP8 is the browser's default and the
 * weakest of the codecs it can take, so the video slot prefers AV1, then VP9,
 * then H.264 - more picture for the same bits. Only where the browser can
 * reorder codecs at all; elsewhere it keeps its defaults.
 */
function receiveTracks(withAudio: boolean): any[] {
  let canPrefer = false
  try { canPrefer = typeof RTCRtpTransceiver !== "undefined" && "setCodecPreferences" in RTCRtpTransceiver.prototype && !!RTCRtpReceiver.getCapabilities?.("video") } catch {}
  const video = canPrefer ? { kind: "video", codecPreferences: ["video/AV1", "video/VP9", "video/H264"] } : "video"
  return withAudio ? [video, { kind: "audio", opus: { stereo: true, maxAverageBitrate: 192000 } }] : [video]
}

const RECORD_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]

export function useWmaSession(opts: WmaSessionOptions) {
  const { model } = opts
  const [status, setStatus] = useState<WmaStatus>("idle")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tickets, setTickets] = useState(0)
  const [liveSec, setLiveSec] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)

  const client = useRef<ReturnType<typeof createFalClient> | null>(null)
  const handle = useRef<{ send: (m: object) => void; close: () => Promise<void> } | null>(null)
  /** Which session is current: a closed one's late callbacks are dropped */
  const sessionNo = useRef(0)
  const firstFrame = useRef(false)
  /** When the first frame showed (ms) - fal's own recording starts about then */
  const firstFrameAt = useRef(0)
  /** fal's id for the current session (its full-quality recording is filed under it) */
  const sessionId = useRef<string | null>(null)
  const paidUntil = useRef(0)
  const paying = useRef<Promise<boolean> | null>(null)
  const lastTouch = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const recordStart = useRef(0)
  /** Clips saved this session, with the stretch each covers - upgraded to fal's recording when it ends */
  const clips = useRef<{ id: number; from: number; to: number }[]>([])
  /** The last session that ran (a whole-session save after it ended) */
  const lastSession = useRef<string | null>(null)
  const [upgrade, setUpgrade] = useState<WmaUpgrade>(null)
  const [canSaveWhole, setCanSaveWhole] = useState(false)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const ensurePaid = useCallback(async (): Promise<boolean> => {
    if (Date.now() < paidUntil.current - 3_000) return true
    if (paying.current) return paying.current
    paying.current = (async () => {
      try {
        const r = await fetch("/api/realtime/wma/meter", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, resolution: optsRef.current.resolution }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setError(j.error || "Could not pay for the session"); return false }
        paidUntil.current = Number(j.paidUntil) || Date.now() + 30_000
        setTickets(t => t + (j.tickets ?? 0))
        if (typeof j.balance === "number" && j.balance >= 0) optsRef.current.onBalanceChange?.(j.balance)
        return true
      } catch {
        setError("Could not reach the server")
        return false
      } finally {
        paying.current = null
      }
    })()
    return paying.current
  }, [model])

  const stopRecorder = useCallback(() => {
    const rec = recorder.current
    if (rec && rec.state !== "inactive") rec.stop()
  }, [])

  /** Asks the server to swap clips for fal's full-quality recording (it waits for fal to publish it). */
  const runUpgrade = useCallback((sid: string, list: { id: number; from: number; to: number }[], whole: boolean) => {
    setUpgrade({ state: "working", text: whole ? "Saving the whole take in full quality - fal publishes it a little after the end…" : `Swapping ${list.length} clip${list.length === 1 ? "" : "s"} for the full-quality recording…` })
    const auto = optsRef.current.autoSaveWhole
    const ask = (clipsNow: typeof list) =>
      // keepalive: the save still goes out if the page (or the popup) is closing
      fetch("/api/realtime/wma/upgrade", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, clips: clipsNow, whole, ...(whole && auto ? auto : {}) }) })
        .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
    void (async () => {
      try {
        let { ok, j } = await ask(list)
        // A long session saves in rounds (the server stops near its time limit and picks up where it left off)
        for (let round = 0; ok && j.partial && round < 8; round++) {
          setUpgrade({ state: "working", text: `Saving the whole session in full quality - ${(j.added ?? []).length} part${(j.added ?? []).length === 1 ? "" : "s"} saved so far…` })
          ;({ ok, j } = await ask([]))
        }
        if (!ok) { setUpgrade({ state: "failed", text: j.error || "The full-quality copy is not available" }); return }
        const n = (j.upgraded?.length ?? 0) + (j.added?.length ?? 0)
        setUpgrade({ state: "done", text: n ? `${n} full-quality video${n === 1 ? "" : "s"} saved to your feed${j.note ? ` (${j.note})` : ""}` : (j.note || "Nothing was upgraded") })
        optsRef.current.onUpgraded?.({ upgraded: j.upgraded ?? [], added: j.added ?? [] })
      } catch {
        setUpgrade({ state: "failed", text: "Could not reach the server for the full-quality copy" })
      }
    })()
  }, [])

  /** The session is over: its saved clips go for their full-quality upgrade. */
  const sessionOver = useCallback(() => {
    const sid = sessionId.current
    sessionId.current = null
    if (!sid) return
    lastSession.current = sid
    const list = clips.current.splice(0)
    // A model that saves itself: the whole take goes to the feed, full quality
    if (optsRef.current.autoSaveWhole) { runUpgrade(sid, list, true); return }
    setCanSaveWhole(true)
    if (list.length) runUpgrade(sid, list, false)
  }, [runUpgrade])

  const stop = useCallback((next: WmaStatus = "ended") => {
    sessionOver()
    sessionNo.current++
    const h = handle.current
    handle.current = null
    if (h) {
      try { h.send({ type: "stop" }) } catch {}
      void h.close().catch(() => {})
    }
    stopRecorder()
    setStream(null)
    setStatus(s => (s === "idle" && next === "ended" ? "idle" : next))
  }, [stopRecorder, sessionOver])

  const start = useCallback(() => {
    if (handle.current) return
    const no = ++sessionNo.current
    firstFrame.current = false
    lastTouch.current = Date.now()
    setCanSaveWhole(false)
    setError(null)
    setLiveSec(0)
    setStatus("connecting")
    client.current ??= createFalClient({ proxyUrl: "/api/realtime/wma" })
    const kind = WMA_MODELS[model].kind
    const h = client.current.realtime.open(wma(WMA_MODELS[model].app), {
      receive: receiveTracks(kind === "director"),
      onMedia: (s: MediaStream) => { if (no === sessionNo.current) setStream(s) },
      onData: (raw: string) => {
        if (no !== sessionNo.current) return
        let msg: any
        try { msg = JSON.parse(raw) } catch { return }
        if (msg?.type === "stream_exhausted") { stop("ended"); setError("The model ended the session - start again to continue") }
        optsRef.current.onMessage?.(msg)
      },
      onState: (st: string) => {
        if (no !== sessionNo.current) return
        if (st === "closed") { handle.current = null; sessionOver(); setStream(null); setStatus(s => (s === "error" ? s : "ended")) }
      },
      onError: (e: unknown) => {
        if (no !== sessionNo.current) return
        handle.current = null
        sessionOver()
        setStream(null)
        const msg = String((e as any)?.message || e || "The live session failed")
        setError(/not paid/i.test(msg) || /heartbeat rejected/i.test(msg) ? "The session ended - its time was not paid for" : msg)
        setStatus("error")
      },
    }) as unknown as { send: (m: object) => void; close: () => Promise<void> }
    handle.current = h
  }, [model, stop, sessionOver])

  /** The page saw the stream's first frame: the session is live, and its first block is paid now. */
  const markFrame = useCallback(() => {
    if (firstFrame.current || !handle.current) return
    firstFrame.current = true
    firstFrameAt.current = Date.now()
    sessionId.current = (handle.current as any)?.session?.sessionId ?? null
    setStatus("live")
    void ensurePaid().then(ok => { if (!ok) stop("error") })
  }, [ensurePaid, stop])

  const send = useCallback((msg: object) => {
    lastTouch.current = Date.now()
    handle.current?.send(msg)
  }, [])

  /** The user did something - keeps an idle timeout from ending the session. */
  const touch = useCallback(() => { lastTouch.current = Date.now() }, [])

  // The meter: renew before the paid block runs out; end idle sessions
  useEffect(() => {
    const t = setInterval(() => {
      if (!handle.current) return
      if (firstFrame.current) setLiveSec(n => n + 1)
      if (recorder.current?.state === "recording") setRecordSec(Math.round((Date.now() - recordStart.current) / 1000))
      const idleMs = optsRef.current.idleMs
      if (idleMs && Date.now() - lastTouch.current > idleMs) {
        stop("ended")
        setError("Ended after a while without input - start again to carry on")
        return
      }
      if (firstFrame.current && Date.now() > paidUntil.current - 3_000) void ensurePaid().then(ok => { if (!ok) stop("error") })
    }, 1000)
    return () => clearInterval(t)
  }, [ensurePaid, stop])

  // A hidden tab ends the session (it would bill unseen)
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && handle.current) stop("ended") }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [stop])

  // Unmounting ends it too
  useEffect(() => () => {
    const sid = sessionId.current
    const list = clips.current.splice(0)
    const auto = optsRef.current.autoSaveWhole
    if (sid && (list.length || auto)) {
      void fetch("/api/realtime/wma/upgrade", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, clips: list, ...(auto ? { whole: true, ...auto } : {}) }) }).catch(() => {})
    }
    sessionNo.current++
    const h = handle.current
    handle.current = null
    if (h) { try { h.send({ type: "stop" }) } catch {}; void h.close().catch(() => {}) }
    const rec = recorder.current
    if (rec && rec.state !== "inactive") rec.stop()
  }, [])

  const startRecording = useCallback((): boolean => {
    if (!stream || typeof MediaRecorder === "undefined") return false
    const type = RECORD_TYPES.find(t => MediaRecorder.isTypeSupported(t))
    try {
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined)
      chunks.current = []
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      rec.start(1000)
      recorder.current = rec
      recordStart.current = Date.now()
      setRecordSec(0)
      setRecording(true)
      return true
    } catch {
      return false
    }
  }, [stream])

  /** Stops recording and resolves with the clip (null if nothing was recorded). */
  const finishRecording = useCallback((): Promise<{ blob: Blob; seconds: number } | null> => {
    const rec = recorder.current
    setRecording(false)
    if (!rec) return Promise.resolve(null)
    const seconds = (Date.now() - recordStart.current) / 1000
    return new Promise(resolve => {
      const done = () => {
        recorder.current = null
        const type = (rec.mimeType || "video/webm").split(";")[0]
        resolve(chunks.current.length ? { blob: new Blob(chunks.current, { type }), seconds } : null)
      }
      if (rec.state === "inactive") { done(); return }
      rec.onstop = done
      rec.stop()
    })
  }, [])

  /** A clip was saved: remember the stretch it covers for the upgrade at the end. */
  const noteClip = useCallback((id: number, from: number, to: number) => {
    if (sessionId.current && to > from) clips.current.push({ id, from, to })
  }, [])

  /** After a session: save all of it, full quality, from fal's recording. */
  const saveWhole = useCallback(() => {
    if (!lastSession.current) return
    setCanSaveWhole(false)
    runUpgrade(lastSession.current, [], true)
  }, [runUpgrade])

  /** Where the session stands in fal's recording: its id, and seconds since the first frame. */
  const position = useCallback(() => ({ sessionId: sessionId.current, at: firstFrameAt.current ? (Date.now() - firstFrameAt.current) / 1000 : 0 }), [])

  return { status, stream, error, setError, tickets, liveSec, recording, recordSec, start, stop, send, touch, markFrame, startRecording, finishRecording, position, noteClip, upgrade, setUpgrade, canSaveWhole, saveWhole }
}

/** A JPEG data URL of what a video element shows now (a saved clip's poster). */
export function grabPoster(video: HTMLVideoElement | null): string | null {
  if (!video || !video.videoWidth) return null
  const c = document.createElement("canvas")
  const scale = Math.min(1, 1280 / video.videoWidth)
  c.width = Math.round(video.videoWidth * scale)
  c.height = Math.round(video.videoHeight * scale)
  c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height)
  try { return c.toDataURL("image/jpeg", 0.85) } catch { return null }
}

/**
 * Saves a recorded clip to the feed: straight to storage when it can (no size
 * cap), through ./wma/clip when the browser can't reach storage (the phone on
 * the dev server over Tailscale).
 */
export async function saveLiveClip(clip: { blob: Blob; seconds: number }, meta: {
  model: WmaModelId; prompt: string; poster: string | null; aspectRatio?: string; resolution?: string
}): Promise<{ id: number; url: string; thumbnailUrl: string | null; prompt: string; aspectRatio: string; durationSec: number }> {
  const form = new FormData()
  form.set("model", meta.model)
  form.set("prompt", meta.prompt)
  form.set("durationSec", String(Math.round(clip.seconds)))
  if (meta.aspectRatio) form.set("aspectRatio", meta.aspectRatio)
  if (meta.resolution) form.set("resolution", meta.resolution)
  if (meta.poster) form.set("poster", meta.poster)
  let uploaded = false
  try {
    const p = await fetch("/api/upload-video-media/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: clip.blob.type || "video/webm", size: clip.blob.size }),
    })
    const pj = await p.json().catch(() => ({}))
    if (p.ok && pj.uploadUrl) {
      const put = await fetch(pj.uploadUrl, { method: "PUT", headers: { "Content-Type": pj.contentType }, body: clip.blob })
      if (put.ok) { form.set("videoUrl", pj.url); uploaded = true }
    }
  } catch {}
  if (!uploaded) form.set("video", clip.blob, `live.${clip.blob.type.includes("mp4") ? "mp4" : "webm"}`)
  const r = await fetch("/api/realtime/wma/clip", { method: "POST", body: form })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.id) throw new Error(j.error || "Could not save the clip")
  return j
}

/**
 * Uploads a picture or sound a live model will read (a world's starting
 * picture, a director's reference audio): straight to storage when it can,
 * through /api/upload-video-media when the browser can't reach storage (the
 * phone on the dev server over Tailscale). Resolves with a signed link fal can fetch.
 */
export async function uploadLiveMedia(file: File): Promise<string> {
  try {
    const p = await fetch("/api/upload-video-media/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type || "application/octet-stream", size: file.size }),
    })
    const pj = await p.json().catch(() => ({}))
    if (p.ok && pj.uploadUrl) {
      const put = await fetch(pj.uploadUrl, { method: "PUT", headers: { "Content-Type": pj.contentType }, body: file })
      if (put.ok && pj.url) return pj.url as string
    }
  } catch {}
  const form = new FormData()
  form.set("file", file)
  const r = await fetch("/api/upload-video-media", { method: "POST", body: form })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.url) throw new Error(j.error || "Upload failed")
  return j.url as string
}
