"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

/**
 * A 360° look-around for a Hunyuan World panorama (the Worlds studio's "Build a
 * world" mode, 2026-10-16). The world comes back as an equirectangular
 * panorama plus a layered package for game engines; this shows the panorama
 * from inside: drag (finger or mouse) to look around, wheel / pinch to zoom.
 * It turns slowly on its own until touched.
 *
 * three.js is imported on mount (the same library the 3D viewer uses), so it
 * costs nothing until a world is opened.
 */
export function PanoramaViewer({ url, className = "" }: { url: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let gone = false
    let cleanup = () => {}
    setLoading(true); setFailed(false)
    void import("three").then(THREE => {
      if (gone) return
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      el.appendChild(renderer.domElement)
      renderer.domElement.style.touchAction = "none"
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100)
      const geometry = new THREE.SphereGeometry(500, 64, 40)
      geometry.scale(-1, 1, 1) // seen from inside
      const material = new THREE.MeshBasicMaterial()
      scene.add(new THREE.Mesh(geometry, material))
      const loader = new THREE.TextureLoader()
      loader.setCrossOrigin("anonymous")
      loader.load(url, tex => {
        if (gone) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        material.map = tex
        material.needsUpdate = true
        setLoading(false)
      }, undefined, () => { if (!gone) { setLoading(false); setFailed(true) } })

      // Start facing away from the seam (where the panorama's left and right edges meet)
      let lon = 180, lat = 0, auto = true
      let drag: { x: number; y: number; lon: number; lat: number } | null = null
      const pointers = new Map<number, { x: number; y: number }>()
      let pinch = 0
      const size = () => {
        const w = el.clientWidth, h = el.clientHeight
        renderer.setSize(w, h, false)
        renderer.domElement.style.display = "block"
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
      }
      size()
      const ro = new ResizeObserver(size)
      ro.observe(el)
      const c = renderer.domElement
      const down = (e: PointerEvent) => {
        auto = false
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        try { c.setPointerCapture(e.pointerId) } catch {}
        if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, lon, lat }
        if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null }
      }
      const move = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (pinch) camera.fov = Math.min(100, Math.max(30, camera.fov * (pinch / d)))
          camera.updateProjectionMatrix()
          pinch = d
          return
        }
        if (!drag) return
        const k = camera.fov / Math.max(1, el.clientHeight)
        lon = drag.lon - (e.clientX - drag.x) * k
        lat = Math.max(-85, Math.min(85, drag.lat + (e.clientY - drag.y) * k))
      }
      const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (!pointers.size) drag = null }
      const wheel = (e: WheelEvent) => { e.preventDefault(); camera.fov = Math.min(100, Math.max(30, camera.fov + e.deltaY * 0.05)); camera.updateProjectionMatrix() }
      c.addEventListener("pointerdown", down)
      c.addEventListener("pointermove", move)
      c.addEventListener("pointerup", up)
      c.addEventListener("pointercancel", up)
      c.addEventListener("wheel", wheel, { passive: false })
      let raf = 0
      const loop = () => {
        raf = requestAnimationFrame(loop)
        if (auto) lon += 0.03
        const phi = THREE.MathUtils.degToRad(90 - lat), theta = THREE.MathUtils.degToRad(lon)
        camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta))
        renderer.render(scene, camera)
      }
      loop()
      cleanup = () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move)
        c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up); c.removeEventListener("wheel", wheel)
        material.map?.dispose(); material.dispose(); geometry.dispose(); renderer.dispose()
        c.remove()
      }
    })
    return () => { gone = true; cleanup() }
  }, [url])

  return (
    // Positioned by the caller ("absolute inset-0" fills a stage) - a fixed "relative"
    // here won over it and the canvas collapsed to a 150px strip
    <div ref={host} className={`overflow-hidden bg-black ${className || "relative"}`}>
      {loading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>}
      {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-slate-400">The panorama could not be loaded</div>}
    </div>
  )
}
