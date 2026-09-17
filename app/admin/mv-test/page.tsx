"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A self-reporting test for the 3D viewer.
 *
 * The 3D Studio stage renders a black rectangle when model-viewer fails, and a
 * black rectangle looks identical whether the CDN was blocked, the custom
 * element never upgraded, the GLB 404'd, or the model loaded fine and is simply
 * off-camera. Guessing between those from a photograph of a dark panel is how
 * two fixes went out unverified.
 *
 * This page performs each step separately and prints the result as text, so one
 * screenshot says which step failed.
 *
 *   /admin/mv-test              — tests a known-good GLB
 *   /admin/mv-test?src=<url>    — tests a specific model
 */

const CDN = "https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js"
const FALLBACK_GLB =
  "https://v3b.fal.media/files/b/0aa94df3/XX5Hg0tYC8KGwlSA-sUyt_model.glb"

type Step = { label: string; state: "pending" | "ok" | "fail"; detail?: string }

export default function ModelViewerTest() {
  const [src, setSrc] = useState(FALLBACK_GLB)
  const [steps, setSteps] = useState<Step[]>([
    { label: "1. Script tag added to <head>", state: "pending" },
    { label: "2. Script downloaded (load event)", state: "pending" },
    { label: "3. <model-viewer> defined as a custom element", state: "pending" },
    { label: "4. GLB reachable from this browser (fetch HEAD)", state: "pending" },
    { label: "5. model-viewer fired its own 'load' event", state: "pending" },
  ])
  const hostRef = useRef<HTMLDivElement>(null)

  const set = (i: number, state: Step["state"], detail?: string) =>
    setSteps(s => s.map((v, n) => (n === i ? { ...v, state, detail } : v)))

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("src")
    if (q) setSrc(q)
  }, [])

  useEffect(() => {
    let cancelled = false

    // 1 + 2 — the script itself
    const existing = document.querySelector<HTMLScriptElement>("script[data-mv-test]")
    if (existing) {
      set(0, "ok", "already present from a previous mount")
      set(1, "ok", "(loaded earlier)")
    } else {
      const s = document.createElement("script")
      s.type = "module"
      s.dataset.mvTest = "1"
      s.src = CDN
      s.onload = () => { if (!cancelled) set(1, "ok", "load event fired") }
      s.onerror = () => { if (!cancelled) set(1, "fail", "the browser could not fetch " + CDN) }
      document.head.appendChild(s)
      set(0, "ok", CDN)
    }

    // 3 — the element actually upgrading, which is the step that matters
    void customElements.whenDefined("model-viewer").then(() => {
      if (!cancelled) set(2, "ok", "customElements.whenDefined resolved")
    })
    const t = setTimeout(() => {
      if (!cancelled && !customElements.get("model-viewer")) {
        set(2, "fail", "still not defined after 20s — the module never finished evaluating")
      }
    }, 20_000)

    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  // 4 — can this browser actually reach the model file?
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(src, { method: "GET", headers: { Range: "bytes=0-1023" } })
        if (cancelled) return
        if (r.ok || r.status === 206) {
          set(3, "ok", `HTTP ${r.status}, content-type ${r.headers.get("content-type") ?? "?"}`)
        } else {
          set(3, "fail", `HTTP ${r.status}`)
        }
      } catch (e) {
        if (!cancelled) set(3, "fail", `blocked or CORS: ${String((e as Error)?.message)}`)
      }
    })()
    return () => { cancelled = true }
  }, [src])

  // 5 — the viewer's own verdict on this file
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onLoad = () => set(4, "ok", "the model rendered")
    const onError = (e: Event) => set(4, "fail", `model-viewer error: ${(e as CustomEvent).detail?.type ?? "unknown"}`)
    host.addEventListener("load", onLoad)
    host.addEventListener("error", onError)
    return () => {
      host.removeEventListener("load", onLoad)
      host.removeEventListener("error", onError)
    }
  }, [src])

  return (
    <div className="min-h-screen bg-[#070b14] p-6 text-slate-200">
      <h1 className="text-lg font-bold">3D viewer diagnostic</h1>
      <p className="mt-1 text-[12px] text-slate-500">
        Each step is checked separately. Screenshot this whole page.
      </p>

      <ol className="mt-4 space-y-2">
        {steps.map(s => (
          <li key={s.label} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
            <span
              className={`mr-2 font-mono text-[11px] ${
                s.state === "ok" ? "text-emerald-400" : s.state === "fail" ? "text-red-400" : "text-slate-600"
              }`}
            >
              {s.state === "ok" ? "PASS" : s.state === "fail" ? "FAIL" : "…"}
            </span>
            <span className="text-[13px]">{s.label}</span>
            {s.detail && <div className="mt-0.5 break-all text-[11px] text-slate-500">{s.detail}</div>}
          </li>
        ))}
      </ol>

      <p className="mt-4 break-all text-[11px] text-slate-500">model: {src}</p>

      <div ref={hostRef} className="mt-2 h-[420px] w-full rounded-xl border border-white/15 bg-black">
        {/* @ts-expect-error — a custom element, not a React intrinsic */}
        <model-viewer
          src={src}
          camera-controls
          auto-rotate
          loading="eager"
          reveal="auto"
          style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
        />
      </div>
    </div>
  )
}
