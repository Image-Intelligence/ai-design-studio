"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, X, Loader2, Check, Lightbulb } from "lucide-react"
import {
  DEFAULT_LIGHTING, LIGHT_COLORS, LIGHT_LIMITS, MAX_STUDIO_LIGHTS, lightPosition, renderLighting, sanitizeLighting,
  type LightingScene, type StudioLight,
} from "@/lib/lighting-studio"

/*
 * Lighting studio (2026-10-11) for H3 Max Relight - the lights instead of a
 * photo of a lit sphere, as in fal's own playground:
 *   - a scene view: the sphere on its floor, the camera, and each light on
 *     its orbit; drag a light along the highlighted guide (round the sphere,
 *     up and down, nearer and further) or tap a guide marker for an exact angle
 *   - each light's colour, azimuth, elevation, distance, intensity and
 *     softness, and the room's ambient fill
 *   - the picture that goes to the model, previewed live (lib/lighting-studio
 *     renders it - the same code the server runs for the full-size picture)
 * "Use this lighting" has the server render it (/api/video/lighting-reference)
 * and hands back its link. The setup is remembered on this device.
 */

type Mode = "h" | "v" | "d"
type V3 = [number, number, number]
const STORE = "relight-lighting-v1"
const uid = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

// The scene view: from the front-right, a little above (the render's camera is straight ahead)
const VIEW_AZ = (35 * Math.PI) / 180
const VIEW_EL = (24 * Math.PI) / 180
const CAMERA_AT = { azimuth: 0, elevation: 14, distance: 3.6 }

export function LightingStudio({ current, onUse }: {
  /** the lighting picture in use, if any (shown under the preview) */
  current?: string | null
  onUse: (url: string) => void
}) {
  const [scene, setScene] = useState<LightingScene>(() => {
    try { const raw = localStorage.getItem(STORE); if (raw) { const s = sanitizeLighting(JSON.parse(raw)); if (s.lights.length) return s } } catch {}
    return DEFAULT_LIGHTING
  })
  const [sel, setSel] = useState(() => scene.lights[0]?.id ?? "")
  const [mode, setMode] = useState<Mode>("h")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [usedKey, setUsedKey] = useState<string | null>(null)
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(scene)) } catch {} }, [scene])
  const light = scene.lights.find(l => l.id === sel) ?? scene.lights[0]
  const sceneKey = JSON.stringify(scene)

  const patch = useCallback((id: string, p: Partial<StudioLight>) => setScene(s => ({ ...s, lights: s.lights.map(l => (l.id === id ? { ...l, ...p } : l)) })), [])
  const addLight = () => {
    if (scene.lights.length >= MAX_STUDIO_LIGHTS) return
    const id = uid()
    const used = new Set(scene.lights.map(l => l.color))
    const color = LIGHT_COLORS.find(c => !used.has(c)) ?? LIGHT_COLORS[0]
    setScene(s => ({ ...s, lights: [...s.lights, { id, color, azimuth: 180, elevation: 35, distance: 3, intensity: 1, softness: 0.3 }] }))
    setSel(id)
  }
  const removeLight = () => {
    if (scene.lights.length <= 1 || !light) return
    const rest = scene.lights.filter(l => l.id !== light.id)
    setScene(s => ({ ...s, lights: rest }))
    setSel(rest[0].id)
  }

  // ── the picture the model gets, previewed ──
  const previewRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = previewRef.current
    if (!c) return
    const raf = requestAnimationFrame(() => {
      const S = 192
      c.width = S; c.height = S
      const img = new ImageData(renderLighting(scene, S, S), S, S)
      c.getContext("2d")!.putImageData(img, 0, 0)
    })
    return () => cancelAnimationFrame(raf)
  }, [sceneKey])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── the scene view ──
  const viewRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState(320)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setVw(Math.max(220, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const VH = Math.round(Math.min(300, Math.max(200, vw * 0.62)))
  // Scale: the sphere big enough to read, lights at distance 3 inside the view (6 may reach its edge)
  const k = Math.min(vw, VH * 1.5) / 13
  const cx = vw / 2, cy = VH * 0.56
  const proj = useCallback((p: V3) => {
    const x1 = p[0] * Math.cos(VIEW_AZ) - p[2] * Math.sin(VIEW_AZ)
    const z1 = p[0] * Math.sin(VIEW_AZ) + p[2] * Math.cos(VIEW_AZ)
    const sy = p[1] * Math.cos(VIEW_EL) - z1 * Math.sin(VIEW_EL)
    return { x: cx + x1 * k, y: cy - sy * k, depth: z1 * Math.cos(VIEW_EL) + p[1] * Math.sin(VIEW_EL) }
  }, [cx, cy, k])

  /** The guide for the selected light in this mode: the path, and its snap markers. */
  const guide = useMemo(() => {
    if (!light) return { path: [] as V3[], marks: [] as { p: V3; v: number }[] }
    if (mode === "h") {
      const path = Array.from({ length: 73 }, (_, i) => lightPosition({ ...light, azimuth: -180 + i * 5 }))
      const marks = [-135, -90, -45, 0, 45, 90, 135, 180].map(v => ({ p: lightPosition({ ...light, azimuth: v }), v }))
      return { path, marks }
    }
    if (mode === "v") {
      const path = Array.from({ length: 41 }, (_, i) => lightPosition({ ...light, elevation: -10 + i * 2.5 }))
      const marks = [0, 45, 90].map(v => ({ p: lightPosition({ ...light, elevation: v }), v }))
      return { path, marks }
    }
    const path = [lightPosition({ ...light, distance: 1 }), lightPosition({ ...light, distance: 6 })]
    const marks = [1, 2, 3, 4, 5, 6].map(v => ({ p: lightPosition({ ...light, distance: v }), v }))
    return { path, marks }
  }, [light, mode])

  useEffect(() => {
    const c = viewRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(vw * dpr); c.height = Math.round(VH * dpr)
    const x = c.getContext("2d")!
    x.setTransform(dpr, 0, 0, dpr, 0, 0)
    x.clearRect(0, 0, vw, VH)
    // the floor and its grid
    const corner = (a: number, b: number) => proj([a, -1, b])
    const F = 6
    x.fillStyle = "rgba(255,255,255,0.035)"
    x.beginPath(); [corner(-F, -F), corner(F, -F), corner(F, F), corner(-F, F)].forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill()
    x.strokeStyle = "rgba(255,255,255,0.06)"; x.lineWidth = 1
    for (let g = -F; g <= F; g++) {
      let a = corner(g, -F), b = corner(g, F); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke()
      a = corner(-F, g); b = corner(F, g); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke()
    }
    // each light's shadow, away from it on the floor
    for (const l of scene.lights) {
      if (l.intensity <= 0 || l.elevation <= 0) continue
      const lp = lightPosition(l)
      const h = Math.hypot(lp[0], lp[2]) || 1
      const reach = Math.min(4, 1 / Math.tan((Math.max(5, l.elevation) * Math.PI) / 180))
      const pts: { x: number; y: number }[] = []
      for (let t = 0; t <= 24; t++) {
        const a = (t / 24) * Math.PI * 2
        const along = Math.cos(a) * (0.9 + reach * 0.5), across = Math.sin(a) * 0.95
        const dx = -lp[0] / h, dz = -lp[2] / h
        pts.push(proj([dx * (along + reach * 0.5) - dz * across, -1, dz * (along + reach * 0.5) + dx * across]))
      }
      x.fillStyle = `rgba(0,0,0,${0.18 + 0.12 * (1 - l.softness)})`
      x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill()
    }
    // the guide of the selected light
    if (guide.path.length) {
      x.strokeStyle = light ? `${light.color}cc` : "#fff"; x.lineWidth = 1.5; x.setLineDash(mode === "d" ? [4, 4] : [])
      x.beginPath(); guide.path.map(proj).forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); x.setLineDash([])
      for (const m of guide.marks) { const p = proj(m.p); x.fillStyle = "#0b0f19"; x.strokeStyle = "rgba(255,255,255,0.7)"; x.beginPath(); x.arc(p.x, p.y, 3.5, 0, 7); x.fill(); x.stroke() }
    }
    // the camera the picture is taken from
    const cam = proj(lightPosition(CAMERA_AT)), ctr = proj([0, 0, 0])
    x.strokeStyle = "rgba(167,139,250,0.55)"; x.setLineDash([3, 4]); x.beginPath(); x.moveTo(cam.x, cam.y); x.lineTo(ctr.x, ctr.y); x.stroke(); x.setLineDash([])
    x.save(); x.translate(cam.x, cam.y); x.rotate(Math.atan2(ctr.y - cam.y, ctr.x - cam.x))
    x.fillStyle = "#7c3aed"; x.beginPath(); x.moveTo(-9, -6); x.lineTo(5, -4); x.lineTo(10, -8); x.lineTo(10, 8); x.lineTo(5, 4); x.lineTo(-9, 6); x.closePath(); x.fill(); x.restore()
    // the sphere, shaded towards each light
    const R = k
    const base = x.createRadialGradient(ctr.x, ctr.y, R * 0.2, ctr.x, ctr.y, R)
    base.addColorStop(0, "#3a3f4b"); base.addColorStop(1, "#1d2129")
    x.fillStyle = base; x.beginPath(); x.arc(ctr.x, ctr.y, R, 0, 7); x.fill()
    x.save(); x.beginPath(); x.arc(ctr.x, ctr.y, R, 0, 7); x.clip()
    x.globalCompositeOperation = "lighter"
    for (const l of scene.lights) {
      const p = proj(lightPosition(l))
      const dx = p.x - ctr.x, dy = p.y - ctr.y, dd = Math.hypot(dx, dy) || 1
      const hx = ctr.x + (dx / dd) * R * 0.45, hy = ctr.y + (dy / dd) * R * 0.45
      const g = x.createRadialGradient(hx, hy, 0, hx, hy, R * (1.1 + l.softness * 0.6))
      const a = Math.min(0.85, 0.25 + l.intensity * 0.3)
      g.addColorStop(0, l.color + Math.round(a * 255).toString(16).padStart(2, "0")); g.addColorStop(1, l.color + "00")
      x.fillStyle = g; x.fillRect(ctr.x - R, ctr.y - R, R * 2, R * 2)
    }
    x.restore(); x.globalCompositeOperation = "source-over"
    // the lights, far ones first, each with its beam to the sphere
    const order = [...scene.lights].map(l => ({ l, p: proj(lightPosition(l)) })).sort((a, b) => a.p.depth - b.p.depth)
    for (const { l, p } of order) {
      const on = l.id === light?.id
      x.strokeStyle = l.color + (on ? "dd" : "77"); x.lineWidth = on ? 1.5 : 1; x.setLineDash([4, 4])
      x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(ctr.x, ctr.y); x.stroke(); x.setLineDash([])
      x.fillStyle = l.color; x.strokeStyle = on ? "#fff" : "rgba(255,255,255,0.4)"; x.lineWidth = on ? 2 : 1
      x.beginPath(); x.arc(p.x, p.y, on ? 7 : 6, 0, 7); x.fill(); x.stroke()
      const label = `Light ${scene.lights.indexOf(l) + 1}`
      x.font = "600 10px ui-sans-serif, system-ui"; const tw = x.measureText(label).width
      x.fillStyle = on ? "rgba(255,255,255,0.95)" : "rgba(15,20,32,0.9)"
      x.fillRect(p.x - tw / 2 - 5, p.y - 24, tw + 10, 15)
      x.fillStyle = on ? "#0b0f19" : "#e2e8f0"; x.fillText(label, p.x - tw / 2, p.y - 13)
    }
  }, [sceneKey, sel, mode, vw, VH, guide, proj, k])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── dragging a light along its guide; tapping a marker ──
  const drag = useRef<string | null>(null)
  // In the canvas's own coordinates: the portal's panels are CSS-zoomed (the
  // taskbar / panel size settings), so the on-screen box is scaled - divide it out
  const local = (e: React.PointerEvent) => {
    const r = viewRef.current!.getBoundingClientRect()
    const zx = r.width / vw || 1, zy = r.height / VH || 1
    return { x: (e.clientX - r.left) / zx, y: (e.clientY - r.top) / zy }
  }
  const moveTo = (id: string, m: { x: number; y: number }) => {
    const l = scene.lights.find(z => z.id === id)
    if (!l) return
    const dist2 = (p: V3) => { const s = proj(p); return (s.x - m.x) ** 2 + (s.y - m.y) ** 2 }
    let best = 0, bestD = Infinity
    if (mode === "h") for (let a = -180; a <= 180; a++) { const d = dist2(lightPosition({ ...l, azimuth: a })); if (d < bestD) { bestD = d; best = a } }
    if (mode === "v") for (let a = -10; a <= 90; a++) { const d = dist2(lightPosition({ ...l, elevation: a })); if (d < bestD) { bestD = d; best = a } }
    if (mode === "d") for (let a = 1; a <= 6.001; a += 0.05) { const d = dist2(lightPosition({ ...l, distance: a })); if (d < bestD) { bestD = d; best = Math.round(a * 20) / 20 } }
    patch(id, mode === "h" ? { azimuth: best } : mode === "v" ? { elevation: best } : { distance: best })
  }
  const onDown = (e: React.PointerEvent) => {
    const m = local(e)
    const hit = [...scene.lights].reverse().find(l => { const p = proj(lightPosition(l)); return (p.x - m.x) ** 2 + (p.y - m.y) ** 2 < 14 * 14 })
    if (hit) { setSel(hit.id); drag.current = hit.id; try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* the drag works without it */ } return }
    // A marker on the guide: that exact value
    const mk = guide.marks.find(g => { const p = proj(g.p); return (p.x - m.x) ** 2 + (p.y - m.y) ** 2 < 10 * 10 })
    if (mk && light) patch(light.id, mode === "h" ? { azimuth: mk.v } : mode === "v" ? { elevation: mk.v } : { distance: mk.v })
  }
  const onMove = (e: React.PointerEvent) => { if (drag.current) moveTo(drag.current, local(e)) }
  const onUp = () => { drag.current = null }

  const useIt = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch("/api/video/lighting-reference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scene) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || `Could not make the picture (${r.status})`)
      onUse(j.url)
      setUsedKey(sceneKey)
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally { setBusy(false) }
  }
  const inUse = usedKey === sceneKey && !!current

  const slider = (label: string, value: number, lim: readonly [number, number], step: number, unit: string, set: (v: number) => void) => (
    <label className="flex items-center gap-2 text-[10px] text-slate-400">
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={lim[0]} max={lim[1]} step={step} value={value} onChange={e => set(Number(e.target.value))} className="flex-1 min-w-0 accent-violet-400" />
      <span className="w-10 shrink-0 text-right font-mono text-slate-300">{step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : value}{unit}</span>
    </label>
  )

  return (
    <div className="space-y-2.5 rounded-xl border border-white/10 bg-black/25 p-2.5">
      {/* the lights */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-1">Lights</span>
        {scene.lights.map((l, i) => (
          <button key={l.id} onClick={() => setSel(l.id)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold ${l.id === light?.id ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> Light {i + 1}
          </button>
        ))}
        {scene.lights.length < MAX_STUDIO_LIGHTS && (
          <button onClick={addLight} title="Add a light" className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-white/20 text-slate-400 hover:text-white"><Plus size={11} /></button>
        )}
        {scene.lights.length > 1 && (
          <button onClick={removeLight} title="Remove this light" className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:text-red-300"><X size={12} /></button>
        )}
      </div>
      {light && (
        <label className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="w-14 shrink-0">Colour</span>
          <input type="color" value={light.color} onChange={e => patch(light.id, { color: e.target.value.toUpperCase() })} className="h-6 w-10 cursor-pointer rounded border border-white/15 bg-transparent" />
          <span className="font-mono text-slate-300">{light.color}</span>
        </label>
      )}

      {/* the scene, and how a drag moves the light */}
      <div className="flex gap-1">
        {([["h", "Horizontal orbit"], ["v", "Vertical orbit"], ["d", "Distance"]] as [Mode, string][]).map(([m, t]) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold ${mode === m ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}>{t}</button>
        ))}
      </div>
      <div ref={boxRef} className="w-full">
        <canvas ref={viewRef} style={{ width: vw, height: VH, touchAction: "none" }} className="block rounded-lg bg-[#070a12] cursor-grab active:cursor-grabbing"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      </div>
      <p className="text-[9.5px] leading-snug text-slate-600">Drag a light along the highlighted guide; tap a marker for an exact angle. Lights always point at the sphere; the camera is fixed (purple).</p>

      {/* the picture the model gets */}
      <div className="flex items-center gap-2.5">
        <canvas ref={previewRef} className="h-24 w-24 shrink-0 rounded-lg border border-white/10" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-200">Lighting reference</p>
          <p className="text-[10px] leading-snug text-slate-500">This is the picture sent to the model - the clip is re-lit to match it.</p>
          <button onClick={useIt} disabled={busy || inUse}
            className="flex items-center gap-1.5 rounded-lg border border-violet-300/40 bg-violet-500/20 px-2.5 py-1.5 text-[11px] font-bold text-violet-100 hover:bg-violet-500/30 disabled:opacity-60">
            {busy ? <Loader2 size={12} className="animate-spin" /> : inUse ? <Check size={12} /> : <Lightbulb size={12} />}
            {inUse ? "In use" : current ? "Use this lighting instead" : "Use this lighting"}
          </button>
          {err && <p className="text-[10px] text-red-300">{err}</p>}
        </div>
      </div>

      {/* the selected light's settings, and the room's fill */}
      {light && (
        <div className="space-y-1">
          {slider("Azimuth", light.azimuth, LIGHT_LIMITS.azimuth, 1, "°", v => patch(light.id, { azimuth: v }))}
          {slider("Elevation", light.elevation, LIGHT_LIMITS.elevation, 1, "°", v => patch(light.id, { elevation: v }))}
          {slider("Distance", light.distance, LIGHT_LIMITS.distance, 0.1, "", v => patch(light.id, { distance: v }))}
          {slider("Intensity", light.intensity, LIGHT_LIMITS.intensity, 0.1, "", v => patch(light.id, { intensity: v }))}
          {slider("Softness", light.softness, LIGHT_LIMITS.softness, 0.05, "", v => patch(light.id, { softness: v }))}
          {slider("Ambient", scene.ambient, LIGHT_LIMITS.ambient, 0.01, "", v => setScene(s => ({ ...s, ambient: v })))}
        </div>
      )}
      {current && !inUse && <p className="text-[9.5px] text-amber-200/80">A lighting picture is in use - press the button to replace it with this setup.</p>}
    </div>
  )
}
