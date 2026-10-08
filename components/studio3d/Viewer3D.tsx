"use client"

/**
 * The 3D Production Studio's viewer - three.js, bundled (the old studio pulled
 * <model-viewer> and its own three.js from unpkg on first open).
 *
 * Fast opens: the studio loads each model's VIEWER COPY (lib/threed/pipeline -
 * meshopt geometry, WebP textures), streams it with a progress bar, and keeps
 * it in the browser's Cache Storage, so a model seen before opens instantly.
 *
 * Also: auto-framing on a soft studio floor, turntable, wireframe, backgrounds,
 * animation clips (the model's own and extra ones, matched to its skeleton by
 * bone name - see retarget.ts), a snapshot for posters, turntable recording,
 * exports (GLB, STL in millimetres, OBJ, USDZ) and a 3D-print check.
 */
import { cn } from "@/lib/utils"
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import type * as THREE_NS from "three"
import { Loader2 } from "lucide-react"

export type ModelSrc = { url: string; ext: string; key?: string }
export type ClipSrc = { name: string; url: string; ext: string }
export type ModelInfo = {
  triangles: number; vertices: number; materials: number; textures: number
  skinned: boolean; bones: string[]; clips: string[]; size: { x: number; y: number; z: number }
}
export type PrintReport = { watertight: boolean; openEdges: number; nonManifoldEdges: number; triangles: number; sizeMm: { x: number; y: number; z: number } }
export type ViewerHandle = {
  snapshot: (size?: number) => string | null
  record: (seconds: number) => Promise<Blob | null>
  exportAs: (fmt: "glb" | "stl" | "obj" | "usdz", o?: { heightMm?: number }) => Promise<Blob | null>
  printCheck: (heightMm?: number) => Promise<PrintReport | null>
  playClip: (name: string | null) => void
}
export type Backdrop = "studio" | "grey" | "white" | "black"

const CACHE = "studio3d-models-v1"
const BACKDROP: Record<Backdrop, number> = { studio: 0x0b0f19, grey: 0x3a3f4a, white: 0xf4f5f7, black: 0x000000 }

/** The file, from the browser cache or the network (with progress), as bytes. */
async function loadBytes(src: ModelSrc, onProgress: (p: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const key = `https://studio3d.cache/${encodeURIComponent(src.key ?? src.url.split("?")[0])}`
  let cache: Cache | null = null
  try { cache = await caches.open(CACHE) } catch { /* private window */ }
  const hit = await cache?.match(key).catch(() => undefined)
  if (hit) { onProgress(1); return hit.arrayBuffer() }
  const res = await fetch(src.url, { signal })
  if (!res.ok || !res.body) throw new Error(`Could not load the model (${res.status})`)
  const total = Number(res.headers.get("content-length") ?? 0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); got += value.length
    if (total) onProgress(Math.min(0.99, got / total))
  }
  const bytes = new Uint8Array(got)
  let at = 0
  for (const p of parts) { bytes.set(p, at); at += p.length }
  // Keep it for next time (not the giant originals)
  if (cache && got < 90 * 1024 * 1024) cache.put(key, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {})
  onProgress(1)
  return bytes.buffer
}

type Three = typeof THREE_NS
type Loaded = { root: THREE_NS.Object3D; clips: THREE_NS.AnimationClip[] }

async function parseModel(T: Three, bytes: ArrayBuffer, ext: string): Promise<Loaded> {
  const e = ext.toLowerCase()
  if (e === "glb" || e === "gltf") {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ])
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const g = await loader.parseAsync(bytes, "")
    return { root: g.scene, clips: g.animations }
  }
  if (e === "fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js")
    const o = new FBXLoader().parse(bytes, "")
    return { root: o, clips: o.animations ?? [] }
  }
  if (e === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js")
    return { root: new OBJLoader().parse(new TextDecoder().decode(bytes)), clips: [] }
  }
  if (e === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js")
    const geo = new STLLoader().parse(bytes)
    geo.computeVertexNormals()
    return { root: new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.55, metalness: 0.05 })), clips: [] }
  }
  if (e === "ply" || e === "splat") {
    const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js")
    const geo = new PLYLoader().parse(bytes)
    if (geo.index) { geo.computeVertexNormals(); return { root: new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: geo.hasAttribute("color"), color: 0xffffff })), clips: [] } }
    // A Gaussian splat read as its centres: a point cloud preview
    return { root: new T.Points(geo, new T.PointsMaterial({ size: 0.004, vertexColors: geo.hasAttribute("color"), color: 0xffffff })), clips: [] }
  }
  throw new Error(`The viewer cannot open .${e} files - download it instead`)
}

function inspect(T: Three, root: THREE_NS.Object3D, clips: THREE_NS.AnimationClip[]): ModelInfo {
  let triangles = 0, vertices = 0, skinned = false
  const mats = new Set<string>(), texs = new Set<string>(), bones = new Set<string>()
  root.traverse(o => {
    const m = o as THREE_NS.Mesh
    if (m.isMesh || (o as THREE_NS.Points).isPoints) {
      const g = m.geometry as THREE_NS.BufferGeometry
      const pos = g.getAttribute("position")
      vertices += pos?.count ?? 0
      triangles += g.index ? g.index.count / 3 : (pos?.count ?? 0) / 3
      for (const mat of ([] as THREE_NS.Material[]).concat(m.material ?? [])) {
        mats.add(mat.uuid)
        for (const v of Object.values(mat)) if ((v as THREE_NS.Texture)?.isTexture) texs.add((v as THREE_NS.Texture).uuid)
      }
    }
    if ((o as THREE_NS.SkinnedMesh).isSkinnedMesh) skinned = true
    if ((o as THREE_NS.Bone).isBone) bones.add(o.name)
  })
  const box = new T.Box3().setFromObject(root)
  const s = box.getSize(new T.Vector3())
  return { triangles: Math.round(triangles), vertices, materials: mats.size, textures: texs.size, skinned, bones: [...bones], clips: clips.map(c => c.name || "clip"), size: { x: s.x, y: s.y, z: s.z } }
}

export const Viewer3D = forwardRef<ViewerHandle, {
  src: ModelSrc | null
  poster?: string | null
  extraClips?: ClipSrc[]
  backdrop?: Backdrop
  autoRotate?: boolean
  wireframe?: boolean
  className?: string
  onInfo?: (info: ModelInfo | null) => void
  onError?: (msg: string) => void
}>(function Viewer3D({ src, poster, extraClips = [], backdrop = "studio", autoRotate = false, wireframe = false, className = "", onInfo, onError }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{
    T: Three; renderer: THREE_NS.WebGLRenderer; scene: THREE_NS.Scene; camera: THREE_NS.PerspectiveCamera
    controls: any; floor: THREE_NS.Mesh; model: THREE_NS.Object3D | null; clips: THREE_NS.AnimationClip[]
    mixer: THREE_NS.AnimationMixer | null; action: THREE_NS.AnimationAction | null; clock: THREE_NS.Clock
  } | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // ── the stage: renderer, studio light, floor, camera, controls ──
  useEffect(() => {
    let dead = false
    let frame = 0
    let ro: ResizeObserver | null = null
    ;(async () => {
      const T = await import("three")
      const [{ OrbitControls }, { RoomEnvironment }] = await Promise.all([
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ])
      if (dead || !host.current) return
      const el = host.current
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(el.clientWidth, el.clientHeight)
      renderer.outputColorSpace = T.SRGBColorSpace
      renderer.toneMapping = T.ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = T.PCFSoftShadowMap
      el.appendChild(renderer.domElement)
      renderer.domElement.style.display = "block"
      const scene = new T.Scene()
      scene.background = new T.Color(BACKDROP.studio)
      const pmrem = new T.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      const key = new T.DirectionalLight(0xffffff, 1.6)
      key.position.set(3, 6, 4)
      key.castShadow = true
      key.shadow.mapSize.set(2048, 2048)
      scene.add(key, new T.HemisphereLight(0xdbe4ff, 0x1b1f2a, 0.5))
      const floor = new T.Mesh(new T.CircleGeometry(1, 64), new T.ShadowMaterial({ opacity: 0.32 }))
      floor.rotation.x = -Math.PI / 2
      floor.receiveShadow = true
      scene.add(floor)
      const camera = new T.PerspectiveCamera(35, el.clientWidth / Math.max(1, el.clientHeight), 0.01, 1000)
      camera.position.set(2, 1.4, 3)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      const clock = new T.Clock()
      ctx.current = { T, renderer, scene, camera, controls, floor, model: null, clips: [], mixer: null, action: null, clock }
      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      ro.observe(el)
      const tick = () => {
        frame = requestAnimationFrame(tick)
        if (document.hidden) return
        const c = ctx.current!
        const dt = c.clock.getDelta()
        c.mixer?.update(dt)
        c.controls.update()
        c.renderer.render(c.scene, c.camera)
      }
      tick()
      setReady(true)
    })()
    return () => {
      dead = true
      cancelAnimationFrame(frame)
      ro?.disconnect()
      const c = ctx.current
      if (c) { c.controls.dispose(); c.renderer.dispose(); c.renderer.domElement.remove() }
      ctx.current = null
    }
  }, [])

  useEffect(() => { const c = ctx.current; if (c) c.scene.background = new c.T.Color(BACKDROP[backdrop]) }, [backdrop, ready])
  useEffect(() => { const c = ctx.current; if (c) { c.controls.autoRotate = autoRotate; c.controls.autoRotateSpeed = 1.6 } }, [autoRotate, ready])
  useEffect(() => {
    const c = ctx.current
    c?.model?.traverse(o => { const m = o as THREE_NS.Mesh; if (m.isMesh) for (const mat of ([] as any[]).concat(m.material)) if ("wireframe" in mat) mat.wireframe = wireframe })
  }, [wireframe, ready, progress])

  // ── the model ──
  useEffect(() => {
    const c = ctx.current
    if (!ready || !c) return
    const ab = new AbortController()
    if (c.model) { c.scene.remove(c.model); c.model = null; c.mixer = null; c.action = null; c.clips = [] }
    setErr(null)
    onInfo?.(null)
    if (!src) { setProgress(null); return }
    setProgress(0)
    ;(async () => {
      try {
        const bytes = await loadBytes(src, setProgress, ab.signal)
        if (ab.signal.aborted) return
        const { root, clips } = await parseModel(c.T, bytes, src.ext)
        if (ab.signal.aborted) return
        const T = c.T
        root.traverse(o => { const m = o as THREE_NS.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false } })
        // On the floor, centred, framed
        const box = new T.Box3().setFromObject(root)
        const size = box.getSize(new T.Vector3()), centre = box.getCenter(new T.Vector3())
        root.position.sub(new T.Vector3(centre.x, box.min.y, centre.z))
        const radius = Math.max(size.x, size.y, size.z) || 1
        c.floor.scale.setScalar(radius * 1.6)
        c.scene.add(root)
        c.model = root
        c.clips = clips
        const fov = (c.camera.fov * Math.PI) / 180
        const dist = (radius / 2) / Math.tan(fov / 2) * 1.9
        c.camera.near = radius / 100; c.camera.far = radius * 100; c.camera.updateProjectionMatrix()
        c.camera.position.set(dist * 0.6, size.y * 0.55 + dist * 0.25, dist * 0.85)
        c.controls.target.set(0, size.y * 0.45, 0)
        c.controls.update()
        c.mixer = new T.AnimationMixer(root)
        if (clips[0]) { c.action = c.mixer.clipAction(clips[0]); c.action.play() }
        setProgress(null)
        onInfo?.(inspect(T, root, clips))
      } catch (e: any) {
        if (ab.signal.aborted) return
        setProgress(null)
        const msg = String(e?.message || e)
        setErr(msg)
        onError?.(msg)
      }
    })()
    return () => ab.abort()
  // onInfo/onError are the page's; the model is what matters
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.url, ready])

  // ── extra clips (the clip library's, text-to-motion's): matched onto this skeleton ──
  // Each clip file is fetched and parsed once per model: a clip already on it
  // is skipped before any download (a character's own clips are whole 14 MB
  // GLBs - re-parsing them all whenever a motion is ticked kept the motion
  // waiting behind them). Work in flight is kept as long as the same model is
  // on screen, so a re-render cannot throw away a parsed 17 MB motion.
  const clipJobs = useRef(new Set<string>())
  useEffect(() => {
    const c = ctx.current
    if (!c?.model) return
    const model = c.model
    // Unticked motions come off the model
    const want = new Set(extraClips.map(x => x.name))
    const kept = c.clips.filter(x => !x.name.startsWith("Motion: ") || want.has(x.name))
    if (kept.length !== c.clips.length) {
      if (c.action && !kept.includes(c.action.getClip())) { c.action.stop(); c.action = null }
      c.clips = kept
      onInfo?.(inspect(c.T, model, c.clips))
    }
    const todo = extraClips.filter(x => !c.clips.some(k => k.name === x.name) && !clipJobs.current.has(`${model.uuid}|${x.name}`))
    if (!todo.length) return
    ;(async () => {
      const { retargetOnto } = await import("./retarget")
      for (const clip of todo) {
        const job = `${model.uuid}|${clip.name}`
        if (c.model !== model || clipJobs.current.has(job)) continue
        clipJobs.current.add(job)
        try {
          const bytes = await loadBytes({ url: clip.url, ext: clip.ext, key: clip.url.split("?")[0] }, () => {}, new AbortController().signal)
          if (c.model !== model) return
          const loaded = await parseModel(c.T, bytes, clip.ext)
          const made = loaded.clips[0] ? retargetOnto(c.T, model, loaded.root, loaded.clips[0], clip.name) : null
          if (!made) console.warn("[studio3d] clip does not fit this skeleton:", clip.name)
          if (made && c.model === model && !c.clips.some(x => x.name === made.name)) {
            c.clips = [...c.clips, made]
            onInfo?.(inspect(c.T, model, c.clips))
          }
        } catch (e) { console.warn("[studio3d] clip skipped:", clip.name, e) /* a clip that will not load is skipped */ }
        finally { clipJobs.current.delete(job) }
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraClips.map(x => `${x.name}|${x.url.split("?")[0]}`).join("||"), progress === null && !!src])

  useImperativeHandle(ref, () => ({
    snapshot: (size = 640) => {
      const c = ctx.current
      if (!c?.model) return null
      c.renderer.render(c.scene, c.camera)
      const src = c.renderer.domElement
      const can = document.createElement("canvas")
      const k = Math.min(1, size / Math.max(src.width, src.height))
      can.width = Math.round(src.width * k); can.height = Math.round(src.height * k)
      can.getContext("2d")!.drawImage(src, 0, 0, can.width, can.height)
      return can.toDataURL("image/webp", 0.85)
    },
    record: async (seconds: number) => {
      const c = ctx.current
      if (!c?.model || typeof MediaRecorder === "undefined") return null
      const stream = c.renderer.domElement.captureStream(30)
      const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm"
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 })
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const was = c.controls.autoRotate
      c.controls.autoRotate = true
      c.controls.autoRotateSpeed = 60 / seconds // one full turn
      rec.start()
      await new Promise(r => setTimeout(r, seconds * 1000))
      await new Promise<void>(r => { rec.onstop = () => r(); rec.stop() })
      c.controls.autoRotate = was
      c.controls.autoRotateSpeed = 1.6
      return new Blob(chunks, { type: type.split(";")[0] })
    },
    exportAs: async (fmt, o = {}) => {
      const c = ctx.current
      if (!c?.model) return null
      const T = c.T
      if (fmt === "glb") {
        const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js")
        const out = await new GLTFExporter().parseAsync(c.model, { binary: true, animations: c.clips })
        return new Blob([out as ArrayBuffer], { type: "model/gltf-binary" })
      }
      if (fmt === "obj") {
        const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js")
        return new Blob([new OBJExporter().parse(c.model)], { type: "text/plain" })
      }
      if (fmt === "usdz") {
        const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js")
        const out = await new USDZExporter().parseAsync(c.model)
        return new Blob([out], { type: "model/vnd.usdz+zip" })
      }
      // STL in millimetres: scaled so the model stands heightMm tall
      const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js")
      const box = new T.Box3().setFromObject(c.model)
      const h = box.getSize(new T.Vector3()).y || 1
      const holder = new T.Group()
      const copy = c.model.clone(true)
      copy.scale.multiplyScalar((o.heightMm ?? 100) / h)
      holder.add(copy)
      holder.updateMatrixWorld(true)
      const out = new STLExporter().parse(holder, { binary: true }) as DataView
      return new Blob([out.buffer as ArrayBuffer], { type: "model/stl" })
    },
    printCheck: async (heightMm = 100) => {
      const c = ctx.current
      if (!c?.model) return null
      const T = c.T
      const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js")
      let open = 0, nonManifold = 0, tris = 0
      c.model.updateMatrixWorld(true)
      c.model.traverse(o => {
        const m = o as THREE_NS.Mesh
        if (!m.isMesh) return
        const g = new T.BufferGeometry()
        g.setAttribute("position", m.geometry.getAttribute("position").clone())
        if (m.geometry.index) g.setIndex(m.geometry.index.clone())
        const w = mergeVertices(g, 1e-5)
        const idx = w.index!
        const edges = new Map<string, number>()
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i), b = idx.getX(i + 1), d = idx.getX(i + 2)
          for (const [p, q] of [[a, b], [b, d], [d, a]]) {
            const k = p < q ? `${p}_${q}` : `${q}_${p}`
            edges.set(k, (edges.get(k) ?? 0) + 1)
          }
          tris++
        }
        for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++ }
      })
      const box = new T.Box3().setFromObject(c.model)
      const s = box.getSize(new T.Vector3())
      const k = heightMm / (s.y || 1)
      return { watertight: open === 0 && nonManifold === 0, openEdges: open, nonManifoldEdges: nonManifold, triangles: tris, sizeMm: { x: s.x * k, y: heightMm, z: s.z * k } }
    },
    playClip: (name: string | null) => {
      const c = ctx.current
      if (!c?.mixer) return
      c.action?.fadeOut(0.25)
      const clip = name ? c.clips.find(x => (x.name || "clip") === name) : null
      if (!clip) { c.action = null; return }
      c.action = c.mixer.clipAction(clip)
      c.action.reset().fadeIn(0.25).play()
    },
  }), [])

  return (
    // cn(): a caller's "absolute inset-0" must replace "relative", not lose to it (the canvas came out 0px tall)
    <div className={cn("relative overflow-hidden", className)}>
      <div ref={host} className="absolute inset-0" />
      {(progress !== null || (!ready && src)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0f19]/70 backdrop-blur-[2px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {poster && <img src={poster} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" />}
          <div className="relative flex flex-col items-center gap-2">
            <Loader2 size={22} className="animate-spin text-slate-200" />
            <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-slate-400 via-white to-slate-400 transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <span className="text-[10px] font-mono text-slate-400">{progress !== null && progress >= 0.99 ? "Building the scene…" : `Loading ${Math.round((progress ?? 0) * 100)}%`}</span>
          </div>
        </div>
      )}
      {err && <div className="absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] rounded-lg border border-red-400/30 bg-black/70 px-3 py-1.5 text-[11px] text-red-200">{err}</div>}
    </div>
  )
})
