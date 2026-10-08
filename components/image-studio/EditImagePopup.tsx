"use client"

/**
 * The Edit Image popup - the Image Studio's editor, in a popup, for every
 * account (2026-10-06). It replaced the portal's own RefImageEditorModal and
 * keeps its props, so all seven places that open it are unchanged:
 *
 *   image                the picture ({ id, url })
 *   onApply(dataUrl)     the edit, flattened (a JPEG data URL - the parent
 *                        uploads it: a re-created ref, a new ref, a frame...)
 *   canUseLayers         Dev Tier: layer management, and the layers are KEPT
 *   layerStack / onLayerStackChange
 *                        the old Dev-Tier layer format, which generation still
 *                        reads (composite-at-generation, auto-append)
 *
 * Keeping layers: Apply stores the layered document (ImageEditDoc) under the
 * SHA-256 of the flattened picture it hands over. That picture is stored byte
 * for byte wherever it goes (upload-reference does not re-encode), so opening
 * it again - whatever id or URL it now has - finds the layers.
 *
 * The old stack is kept consistent: before Apply it is set to "base in layer"
 * so the parent resets it to one layer holding the new picture (generation
 * then uses exactly that); generations that auto-append to it later are
 * brought in as layers on the next open. A ref layered in the OLD editor is
 * converted on open (images, positions, rotation, opacity; a layer with
 * several images becomes a group).
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2 } from "lucide-react"
import { type StudioDoc, type StudioLayer, MAX_CANVAS_SIDE, MAX_LAYERS, normalizeLayers } from "@/lib/image-studio"
import { Editor } from "./Editor"
import { loadToCanvas, newCanvas, ctx2d, toBlob } from "./engine"
import { holdCardVideos } from "@/components/home/card-video-scheduler"
import { openInImageStudio, useImageStudioAvailable } from "./bridge"
import { SiteLogoBox } from "@/components/SitePageHeader"
import { sha256Hex } from "@/lib/sha256"
import { useIdVerified, IdLockedPanel } from "@/components/id-verification/IdVerificationGate"

type OldItem = { id: string; url: string; x?: number; y?: number; w?: number; h?: number; r?: number }
type OldLayer = { id: string; name: string; visible: boolean; opacity: number; auto?: boolean; items: OldItem[] }
export type OldLayerStack = { enabled: boolean; layers: OldLayer[]; baseInLayer?: boolean; baseW?: number; baseH?: number }

export type EditImagePopupProps = {
  image: { id: string; url: string }
  onApply: (newUrl: string) => void
  onClose: () => void
  canUseLayers?: boolean
  layerStack?: OldLayerStack | null
  onLayerStackChange?: (stack: OldLayerStack | null) => void
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
// crypto.subtle is missing over plain http on the LAN (an iPad on the dev server) - lib/sha256 falls back to JS
const sha256 = sha256Hex
const frames = (n: number) => new Promise<void>(res => { const step = (k: number) => (k <= 0 ? setTimeout(res, 30) : requestAnimationFrame(() => step(k - 1))); step(n) })

function rasterLayer(name: string, pix: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }, extra: Partial<StudioLayer> = {}): StudioLayer {
  return { id: uid("l"), name, kind: "raster", visible: true, locked: false, opacity: 1, blend: "normal", ...box, rotation: 0, flipX: false, flipY: false, src: null, pw: pix.width, ph: pix.height, ...extra }
}

/** Old-format layers as studio layers (their pixels loaded into `seed`). A layer with several images becomes a group. */
async function importOldLayers(layers: OldLayer[], W: number, H: number, seed: Map<string, HTMLCanvasElement>): Promise<StudioLayer[]> {
  const out: StudioLayer[] = []
  for (const L of layers) {
    const items = (await Promise.all(L.items.map(async it => {
      try { return { it, pix: await loadToCanvas(it.url, MAX_CANVAS_SIDE) } } catch { return null }
    }))).filter((x): x is { it: OldItem; pix: HTMLCanvasElement } => !!x)
    if (!items.length) continue
    const made = items.map(({ it, pix }) => {
      // A rect is in canvas fractions; none = contain-fit, centred (the old editor's rule)
      let box
      if (it.w && it.h) box = { x: (it.x ?? 0) * W, y: (it.y ?? 0) * H, w: it.w * W, h: it.h * H }
      else { const k = Math.min(W / pix.width, H / pix.height); box = { x: (W - pix.width * k) / 2, y: (H - pix.height * k) / 2, w: pix.width * k, h: pix.height * k } }
      const layer = rasterLayer(items.length > 1 ? "Image" : L.name, pix, box, { rotation: it.r ?? 0 })
      seed.set(layer.id, pix)
      return layer
    })
    if (made.length === 1) out.push({ ...made[0], visible: L.visible, opacity: L.opacity })
    else {
      const gid = uid("g")
      out.push(...made.map(m => ({ ...m, parent: gid })))
      out.push({ id: gid, name: L.name, kind: "group", visible: L.visible, locked: false, opacity: L.opacity, blend: "normal", x: 0, y: 0, w: W, h: H, rotation: 0, flipX: false, flipY: false })
    }
  }
  return out
}

export function EditImagePopup({ image, onApply, onClose, canUseLayers = false, layerStack = null, onLayerStackChange }: EditImagePopupProps) {
  const [state, setState] = useState<{ doc: StudioDoc; seed: Map<string, HTMLCanvasElement>; key: string; restored: boolean } | { error: string } | null>(null)
  const studioOK = useImageStudioAvailable()
  // The editor saves pixels the browser uploads (the studio routes refuse
  // unverified accounts), so it asks for the ID check before it opens
  const idVerified = useIdVerified()
  // The feed's videos and rims rest behind the popup; the page does not scroll under it
  useEffect(() => holdCardVideos(), [])
  useEffect(() => {
    const el = document.documentElement, prev = el.style.overflow
    el.style.overflow = "hidden"
    return () => { el.style.overflow = prev }
  }, [])

  // The stack as it was when the picture opened (the parent may swap it in as we apply)
  const stackRef = useRef(layerStack)
  stackRef.current = layerStack

  // ── the document to edit ──
  useEffect(() => {
    let dead = false
    setState(null)
    ;(async () => {
      try {
        const pix = await loadToCanvas(image.url, MAX_CANVAS_SIDE)
        const W = pix.width, H = pix.height
        const seed = new Map<string, HTMLCanvasElement>()
        let doc: StudioDoc | null = null
        let restored = false
        if (canUseLayers) {
          // The layered version this picture came from, if Apply made it
          try {
            const buf = await (await fetch(image.url)).arrayBuffer()
            const hash = await sha256(buf)
            const r = await fetch(`/api/user/image-edit-doc?hash=${hash}`)
            const j = r.ok ? await r.json() : null
            if (j?.doc?.layers?.length) { doc = j.doc as StudioDoc; restored = true }
          } catch { /* no saved layers - start from the picture */ }
          const st = stackRef.current
          if (doc && st?.enabled) {
            // Generations appended to the ref since then (Dev Tier auto-append) come in on top
            const extra = await importOldLayers(st.layers.filter(l => l.auto), doc.width, doc.height, seed)
            if (extra.length) doc = { ...doc, layers: normalizeLayers([...doc.layers, ...extra]).slice(0, MAX_LAYERS) }
          } else if (!doc && st?.enabled && st.layers.some(l => l.items.length)) {
            // Layered in the old editor: its layers, converted
            const base = st.baseInLayer ? [] : [rasterLayer("Background", pix, { x: 0, y: 0, w: W, h: H })]
            if (base[0]) seed.set(base[0].id, pix)
            const layers = [...base, ...(await importOldLayers(st.layers, W, H, seed))]
            doc = { v: 1, width: W, height: H, background: null, layers: normalizeLayers(layers).slice(0, MAX_LAYERS) }
            restored = layers.length > 1
          }
        }
        if (!doc) {
          const base = rasterLayer("Background", pix, { x: 0, y: 0, w: W, h: H })
          seed.set(base.id, pix)
          doc = { v: 1, width: W, height: H, background: null, layers: [base] }
        }
        if (!dead) setState({ doc, seed, key: `${image.id}|${image.url}`, restored })
      } catch {
        if (!dead) setState({ error: "This picture could not be opened for editing." })
      }
    })()
    return () => { dead = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id, image.url, canUseLayers])

  // ── Apply ──
  const apply = async (flat: HTMLCanvasElement, serialize: () => Promise<StudioDoc>) => {
    // A JPEG like the old editor's: transparent parts on white
    const out = newCanvas(flat.width, flat.height), x = ctx2d(out)
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, out.width, out.height); x.drawImage(flat, 0, 0)
    const blob = await toBlob(out, "image/jpeg", 0.94)
    if (canUseLayers) {
      // The layered version, under the fingerprint of the picture handed over
      const [hash, doc] = await Promise.all([blob.arrayBuffer().then(sha256), serialize()])
      const r = await fetch("/api/user/image-edit-doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash, doc }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not keep the layers")
      // The old stack: "base in layer", so the parent resets it to one layer holding the new
      // picture (generation reads exactly that, nothing composited twice). Let that state land
      // in the parent before Apply reads it.
      if (onLayerStackChange) { onLayerStackChange({ enabled: true, baseInLayer: true, layers: [] }); await frames(2) }
    }
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Could not read the picture")); fr.readAsDataURL(blob) })
    onApply(dataUrl)
  }

  // Portalled to <body>: it opens from inside the header's dropdowns, whose
  // backdrop blur would otherwise trap a fixed overlay inside the header strip
  if (typeof document === "undefined") return null
  if (idVerified === false) return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }} onPointerDown={e => e.stopPropagation()}>
      <div className="relative w-full max-w-md">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-[12px] text-slate-400 hover:text-white">Close</button>
        <IdLockedPanel className="bg-[#0b0f17]" title="Verify your ID to edit pictures"
          label="The editor works on pictures you bring in, so it unlocks once your ID is verified." />
      </div>
    </div>,
    document.body,
  )
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-0 sm:p-3 lg:p-5" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <div className="relative w-full h-full max-w-[2400px] sm:rounded-2xl overflow-hidden border border-white/10 bg-[#060910] shadow-2xl">
        {!state ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[12px] text-slate-400">
            <SiteLogoBox size={40} rounded={11} />
            <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Opening the editor…</span>
          </div>
        ) : "error" in state ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[12px] text-slate-300">
            <p>{state.error}</p>
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5">Close</button>
          </div>
        ) : (
          <Editor
            key={state.key}
            inline={{ doc: state.doc, title: state.restored ? "Edit image · layers restored" : "Edit image" }}
            seed={state.seed}
            canUseLayers={canUseLayers}
            admin={studioOK}
            refLibrary={[]}
            onExit={onClose}
            onSaveToRefs={async () => {}}
            onApply={apply}
            extraActions={studioOK ? (
              <button
                onClick={() => { openInImageStudio({ url: image.url, refId: image.id, title: "Reference edit" }); onClose() }}
                title="Open the original in the full Image Studio (its own saved canvas) - edits made here are not carried over"
                className="hidden sm:flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg border border-white/15 bg-white/[0.06] text-[10.5px] font-semibold text-slate-100 hover:bg-white/10"
              >
                <SiteLogoBox size={14} rounded={4} /> Image Studio
              </button>
            ) : null}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
