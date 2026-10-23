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
import { loadToCanvas, newCanvas, ctx2d, toBlob, deviceFit } from "./engine"
import { holdCardVideos } from "@/components/home/card-video-scheduler"
import { openInImageStudio, useImageStudioAvailable, useImageStudioAdmin } from "./bridge"
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

/*
 * Opening fast (2026-10-12). Finding a picture's saved layers needs the
 * SHA-256 of its file. Opening used to download the picture twice, one after
 * the other (once to show it, once to hash it), then ask for the doc - on a
 * phone over the LAN, where the hash runs in plain JS, that was most of the
 * wait. Now: one download feeds both, the doc lookup runs while the picture
 * decodes, and a file's hash is remembered by its address (an uploaded file
 * never changes), so the lookup can start before the download even ends.
 */
const HASHES_KEY = "pv2-edit-hashes"
const fileKey = (url: string) => {
  if (!/^https:\/\//.test(url)) return null
  try { const u = new URL(url); return u.origin + u.pathname } catch { return null }
}
function cachedHash(url: string): string | null {
  const k = fileKey(url)
  if (!k) return null
  try { return (JSON.parse(localStorage.getItem(HASHES_KEY) || "{}") as Record<string, string>)[k] ?? null } catch { return null }
}
function rememberHash(url: string, hash: string) {
  const k = fileKey(url)
  if (!k) return
  try {
    const m = JSON.parse(localStorage.getItem(HASHES_KEY) || "{}") as Record<string, string>
    delete m[k]; m[k] = hash
    const keys = Object.keys(m)
    for (const old of keys.slice(0, Math.max(0, keys.length - 400))) delete m[old]
    localStorage.setItem(HASHES_KEY, JSON.stringify(m))
  } catch {}
}
/** A downloaded picture into a canvas (the long side at most maxSide). */
async function blobToCanvas(blob: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob)
  // Held to what this device can draw too (an iPad's canvases stop at 16.7 MP - engine deviceFit)
  const s = deviceFit(bmp.width, bmp.height, maxSide)
  const c = newCanvas(s.w, s.h), x = ctx2d(c)
  x.imageSmoothingQuality = "high"
  x.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}
/**
 * Layered docs still being stored after an Apply (they are stored in the
 * background - see apply). Opening a picture waits for them first, so a quick
 * re-open still finds its layers.
 */
const pendingDocSaves = new Set<Promise<unknown>>()

/**
 * The applied picture as a JPEG that fits an upload (2026-10-09): the parent
 * sends it through a function capped at ~4.5MB on Vercel, and a 12MP edit at
 * quality 0.94 could pass that - the save failed. Lower quality first, then a
 * smaller size, until it is under 3.8MB. Transparent parts on white, like the
 * old editor's. The layered doc is stored under the hash of exactly this file.
 */
const MAX_APPLY_BYTES = 3.8 * 1024 * 1024
async function fitJpeg(flat: HTMLCanvasElement): Promise<Blob> {
  let src = flat
  for (let round = 0; round < 6; round++) {
    const out = newCanvas(src.width, src.height), x = ctx2d(out)
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, out.width, out.height); x.drawImage(src, 0, 0)
    for (const q of [0.94, 0.88, 0.82]) {
      const blob = await toBlob(out, "image/jpeg", q)
      if (blob.size <= MAX_APPLY_BYTES) return blob
    }
    // Still too big at 0.82: about 80% of the size each round
    const k = 0.8
    const smaller = newCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)))
    const sx = ctx2d(smaller); sx.imageSmoothingQuality = "high"; sx.drawImage(src, 0, 0, smaller.width, smaller.height)
    src = smaller
  }
  return toBlob(src, "image/jpeg", 0.8)
}

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
  const [state, setState] = useState<{ doc: StudioDoc; seed: Map<string, HTMLCanvasElement>; seedSrc: Map<string, string>; key: string; restored: boolean } | { error: string } | null>(null)
  // The parent could not save the applied edit (portal handleEditRef): said here
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSaveError(String((e as CustomEvent).detail || "Could not save the edit"))
    window.addEventListener("ref-edit-save-failed", on)
    return () => window.removeEventListener("ref-edit-save-failed", on)
  }, [])
  const studioOK = useImageStudioAvailable()
  // Admin-only image models in the AI tools: an admin account only (not "the studio is available")
  const studioAdmin = useImageStudioAdmin()
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

  // Set by our own Apply: the parent then swaps the saved picture in, and the
  // editor - already showing exactly that - carries on instead of re-opening
  const applied = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  // The edit went in, but its layers could not be stored (background save)
  const [layersNote, setLayersNote] = useState<string | null>(null)

  // ── the document to edit ──
  useEffect(() => {
    if (applied.current) return
    let dead = false
    setState(null)
    ;(async () => {
      try {
        let found: StudioDoc | null = null
        let pix: HTMLCanvasElement
        if (canUseLayers) {
          // The layered version this picture came from, if Apply made it
          const docFor = async (hash: string): Promise<StudioDoc | null> => {
            if (pendingDocSaves.size) await Promise.allSettled([...pendingDocSaves])
            const r = await fetch(`/api/user/image-edit-doc?hash=${hash}`)
            const j = r.ok ? await r.json() : null
            return j?.doc?.layers?.length ? j.doc as StudioDoc : null
          }
          const known = cachedHash(image.url)
          const early = known ? docFor(known).catch(() => null) : null
          const bytes = await fetch(image.url).then(r => (r.ok ? r.blob() : null)).catch(() => null)
          ;[pix, found] = await Promise.all([
            bytes ? blobToCanvas(bytes, MAX_CANVAS_SIDE).catch(() => loadToCanvas(image.url, MAX_CANVAS_SIDE)) : loadToCanvas(image.url, MAX_CANVAS_SIDE),
            early ?? (bytes
              ? bytes.arrayBuffer().then(sha256).then(h => { rememberHash(image.url, h); return docFor(h) }).catch(() => null)
              : Promise.resolve(null)),
          ])
        } else {
          pix = await loadToCanvas(image.url, MAX_CANVAS_SIDE)
        }
        const W = pix.width, H = pix.height
        const seed = new Map<string, HTMLCanvasElement>()
        let doc: StudioDoc | null = found
        let restored = !!found
        if (canUseLayers) {
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
        // The picture's own stored file stands in for an untouched Background
        // layer (Editor seedSrc) - only the user's uploads (/u/), as the
        // layered-doc route requires
        const seedSrc = new Map<string, string>()
        if (!doc) {
          const base = rasterLayer("Background", pix, { x: 0, y: 0, w: W, h: H })
          seed.set(base.id, pix)
          if (/^https:\/\//.test(image.url) && image.url.includes("/u/")) seedSrc.set(base.id, image.url)
          doc = { v: 1, width: W, height: H, background: null, layers: [base] }
        }
        if (!dead) setState({ doc, seed, seedSrc, key: `${image.id}|${image.url}`, restored })
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
    setSaveError(null)
    setLayersNote(null)
    const blob = await fitJpeg(flat)
    if (canUseLayers) {
      /*
       * The layered version, under the fingerprint of the picture handed over
       * - stored in the BACKGROUND (2026-10-12). Apply used to wait for every
       * edited layer to upload as a full-size PNG before the picture was
       * handed over; now the picture goes at once and the layers follow.
       * serialize() is started here, so it is this moment's document.
       */
      const docNow = serialize()
      const save = (async () => {
        const [hash, doc] = await Promise.all([blob.arrayBuffer().then(sha256), docNow])
        const r = await fetch("/api/user/image-edit-doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash, doc }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not keep the layers")
      })()
      pendingDocSaves.add(save)
      save.catch(e => {
        console.error("Layered doc not stored:", e)
        if (mounted.current) setLayersNote(String(e?.message || e || "Could not keep the layers"))
      }).finally(() => pendingDocSaves.delete(save))
      // The old stack: "base in layer", so the parent resets it to one layer holding the new
      // picture (generation reads exactly that, nothing composited twice). Let that state land
      // in the parent before Apply reads it.
      if (onLayerStackChange) { onLayerStackChange({ enabled: true, baseInLayer: true, layers: [] }); await frames(2) }
    }
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Could not read the picture")); fr.readAsDataURL(blob) })
    applied.current = true
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
        {saveError && (
          <div className="absolute left-1/2 top-12 z-50 -translate-x-1/2 flex max-w-[92%] items-start gap-2 rounded-xl border border-red-400/40 bg-[#1a0b0f]/95 px-3 py-2 text-[11.5px] text-red-100 shadow-2xl">
            <span><b>Your edit wasn&apos;t saved</b> ({saveError}). The original is still in your Refs - press Apply to try again.</span>
            <button onClick={() => setSaveError(null)} className="shrink-0 text-red-300 hover:text-white">×</button>
          </div>
        )}
        {layersNote && (
          <div className="absolute left-1/2 top-12 z-50 -translate-x-1/2 flex max-w-[92%] items-start gap-2 rounded-xl border border-amber-400/40 bg-[#1a140b]/95 px-3 py-2 text-[11.5px] text-amber-100 shadow-2xl">
            <span>Your edit was applied, but its layers weren&apos;t kept ({layersNote}) - press Apply again to keep them.</span>
            <button onClick={() => setLayersNote(null)} className="shrink-0 text-amber-300 hover:text-white">×</button>
          </div>
        )}
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
            seedSrc={state.seedSrc}
            canUseLayers={canUseLayers}
            admin={studioAdmin}
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
