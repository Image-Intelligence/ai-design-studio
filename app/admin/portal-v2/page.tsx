"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import ChatWidget from "@/components/ChatWidget"
import { Image, Video, Type, ChevronDown, Ticket, User, BookMarked, ImagePlus, X, Plus, Check, Copy, Download, RotateCcw, ShoppingBag, SlidersHorizontal, Bell, AlertTriangle, CheckCircle, Info, Sparkles, Music, BookOpen, Star, Trash2, Loader2, Eye, RefreshCw, Upload, Pencil, Eraser, Crop, Undo2, Square, Circle, Droplets } from "lucide-react"

// --- TYPES ---
interface CNCondition {
  id: string
  mode: 'pose' | 'depth' | 'canny'
  scale: number
  mirror: boolean
  imgB64: string
  preview: string
}

interface UserData {
  id: number
  email: string
  ticketBalance: number
}

interface ImageItem {
  id: number
  imageUrl: string
  prompt: string
  model: string
  createdAt?: string
  referenceImageUrls?: string[]
  failed?: boolean
  failError?: string
  aspectRatio?: string
  quality?: string
  videoMetadata?: Record<string, any>
  loraUrl?: string | null
  loraName?: string | null
  r2Key?: string
}

type AspectRatio = "auto" | "1:1" | "2:3" | "3:2" | "4:5" | "5:4" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9"
  | "1024x768" | "1024x1024" | "1024x1536" | "1920x1080" | "2560x1440" | "3840x2160"
type Quality = "1k" | "2k" | "3k" | "4k" | "low" | "medium" | "high"

// --- IMAGE MODEL CONFIG ---
interface ImageModelConfig {
  id: string       // internal ID used by our UI
  apiId: string    // ID sent to /api/generate
  name: string
  aspectRatios: AspectRatio[]
  supportsQuality: boolean
  qualityOptions?: Quality[]       // custom quality options (defaults to ["2k","4k"])
  maxReferenceImages: number
  requiresReferenceImage?: boolean // if true, at least 1 ref image required
  supportsOutputFormat?: boolean   // shows png/jpeg/webp picker
  isFal: boolean   // true = async FAL queue; false = sync Gemini
  maxImages?: number               // if > 1, shows image count picker
  isUpscaler?: boolean             // special upscaler UI — takes image URL + params instead of prompt
  isLocalModel?: boolean           // admin-only: runs on local GPU via upscaler-server.py
  isCustomFlux?: boolean           // admin-only: custom Flux checkpoint + LoRA inference
}

const IMAGE_MODEL_CONFIGS: ImageModelConfig[] = [
  { id: "nano-banana-pro",      apiId: "nano-banana-pro",          name: "NanoBanana Pro",      aspectRatios: ["1:1", "2:3", "3:2", "4:5", "3:4", "4:3", "9:16", "16:9"], supportsQuality: true,  maxReferenceImages: 8,  isFal: true,  maxImages: 4 },
  { id: "nano-banana-pro-2",    apiId: "nano-banana-pro-2",        name: "NanoBanana Pro 2",    aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"], supportsQuality: true, supportsOutputFormat: true, maxReferenceImages: 14, isFal: false, maxImages: 4 },
  { id: "kling-v3-image",       apiId: "kling-v3-image",           name: "Kling V3",            aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"], supportsQuality: true, qualityOptions: ["1k", "2k"], maxReferenceImages: 1, isFal: false, maxImages: 4 },
  { id: "kling-o3-image",       apiId: "kling-o3-image",           name: "Kling O3",            aspectRatios: ["auto", "16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"], supportsQuality: true, qualityOptions: ["1k", "2k", "4k"], maxReferenceImages: 10, isFal: false, maxImages: 4 },
  { id: "seedream-4.5",         apiId: "seedream-4.5",             name: "SeeDream 4.5",        aspectRatios: ["1:1", "2:3", "3:2", "4:5", "3:4", "4:3", "9:16", "16:9"], supportsQuality: true,  maxReferenceImages: 8,  isFal: true,  maxImages: 4 },
  { id: "seedream-5-lite",      apiId: "seedream-5-lite",          name: "SeeDream 5.0 Lite",   aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5"],                     supportsQuality: true,  qualityOptions: ["2k", "3k"], maxReferenceImages: 10, isFal: false, maxImages: 4 },
  { id: "wan-2.7-pro",          apiId: "wan-2.7-pro",              name: "Wan 2.7 Pro",         aspectRatios: ["1:1", "4:3", "16:9", "3:4", "9:16"],                     supportsQuality: false, maxReferenceImages: 4,  isFal: false, maxImages: 4 },
  { id: "flux-1-dev",           apiId: "flux-1-dev",               name: "FLUX 1 Dev",          aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], supportsQuality: true, qualityOptions: ["1k", "2k", "4k"], maxReferenceImages: 1, isFal: true, maxImages: 1 },
  { id: "flux-2",               apiId: "flux-2",                   name: "FLUX 2",              aspectRatios: ["1:1", "4:5", "9:16", "16:9"],                            supportsQuality: false, maxReferenceImages: 4,  isFal: true  },
  { id: "pro-scanner-v3",       apiId: "gemini-3-pro-image",       name: "Pro Scanner v3",      aspectRatios: ["1:1", "2:3", "3:2", "4:5", "3:4", "4:3", "9:16", "16:9"], supportsQuality: true,  maxReferenceImages: 8,  isFal: false },
  { id: "flash-scanner-v2.5",   apiId: "gemini-2.5-flash-image",   name: "Flash Scanner v2.5",  aspectRatios: ["1:1", "4:5", "9:16", "16:9"],                            supportsQuality: false, maxReferenceImages: 4,  isFal: false },
  { id: "gpt-image-2",          apiId: "gpt-image-2",              name: "ChatGPT Images 2.0",  aspectRatios: ["1024x1024", "1024x768", "1024x1536", "1920x1080", "2560x1440", "3840x2160"], supportsQuality: true, qualityOptions: ["low", "medium", "high"], supportsOutputFormat: true, maxReferenceImages: 8, isFal: false, maxImages: 4 },
  { id: "z-image-base",         apiId: "z-image-base",             name: "Z-Image Base",        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5"], supportsQuality: true, qualityOptions: ["1k", "2k", "4k"], maxReferenceImages: 0, isFal: true, maxImages: 4 },
  { id: "z-image-turbo",        apiId: "z-image-turbo",            name: "Z-Image Turbo",       aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5"], supportsQuality: true, qualityOptions: ["1k", "2k", "4k"], maxReferenceImages: 1, isFal: true, maxImages: 4 },
  { id: "clarity-upscaler",     apiId: "clarity-upscaler",         name: "Clarity Upscaler",    aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: true,  isUpscaler: true },
  { id: "aura-sr",              apiId: "aura-sr",                  name: "AuraSR",              aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: true,  isUpscaler: true },
  { id: "esrgan",               apiId: "esrgan",                   name: "ESRGAN",              aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: true,  isUpscaler: true },
  { id: "drct",                 apiId: "drct",                     name: "DRCT",                aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: true,  isUpscaler: true },
  { id: "supir",                apiId: "supir",                    name: "SUPIR",               aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: false, isUpscaler: true },
  { id: "local-realesrgan",    apiId: "local-realesrgan",         name: "Real-ESRGAN (Local)",  aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: false, isUpscaler: true, isLocalModel: true },
  { id: "local-neosr",         apiId: "local-neosr",              name: "DAT-2 (Local)",         aspectRatios: ["1:1"], supportsQuality: false, maxReferenceImages: 0, isFal: false, isUpscaler: true, isLocalModel: true },
  { id: "custom-flux-lora",    apiId: "custom-flux-lora",         name: "Custom Flux LoRA",      aspectRatios: ["1:1", "9:16", "16:9", "4:3", "3:4"], supportsQuality: false, maxReferenceImages: 3, isFal: false, isCustomFlux: true },
]

// --- HELPERS ---
function calcTicketCost(modelId: string, quality: Quality, aspectRatio?: AspectRatio, loraActive?: boolean, hasRefImages?: boolean): number {
  if (modelId === "nano-banana-pro")     return quality === "4k" ? 14 : 7
  if (modelId === "nano-banana-pro-2")   return quality === "4k" ? 12 : 7
  if (modelId === "seedream-4.5")        return quality === "4k" ? 4 : 2
  if (modelId === "seedream-5-lite")     return quality === "3k" ? 4 : 2
  if (modelId === "flux-1-dev") {
    if (hasRefImages) return quality === "4k" ? 8 : quality === "2k" ? 6 : 3  // i2i
    return quality === "4k" ? 6 : quality === "2k" ? 5 : 2                    // t2i
  }
  if (modelId === "flux-2") {
    if (loraActive && hasRefImages) return 3  // i2i+LoRA (1024×1024 tier)
    if (loraActive) return 2                  // t2i+LoRA (0-2 GB tier)
    return 1
  }
  if (modelId === "z-image-base")        return quality === "4k" ? 15 : quality === "2k" ? 4 : 1
  if (modelId === "z-image-turbo")       return loraActive ? (quality === "4k" ? 17 : quality === "2k" ? 5 : 1) : (quality === "4k" ? 8 : quality === "2k" ? 2 : 1)
  if (modelId === "clarity-upscaler")    return 7 // base; upscaler uses upscaleFactor-dependent cost computed separately
  if (modelId === "aura-sr")             return 1
  if (modelId === "esrgan")              return 1
  if (modelId === "drct")               return 1 // minimum; actual cost computed server-side from output MP
  if (modelId === "supir")              return 8
  if (modelId === "kling-v3-image")     return 2
  if (modelId === "kling-o3-image")     return quality === "4k" ? 4 : 2
  if (modelId === "wan-2.7-pro")        return 4
  if (modelId === "pro-scanner-v3")     return quality === "4k" ? 15 : 7
  if (modelId === "flash-scanner-v2.5") return 1
  if (modelId === "gpt-image-2") {
    if (quality === "low") return 1
    if (quality === "medium") {
      if (aspectRatio === "1024x1024" || aspectRatio === "2560x1440") return 3
      if (aspectRatio === "3840x2160") return 4
      return 2  // 1024x768, 1024x1536, 1920x1080
    }
    if (quality === "high") {
      if (aspectRatio === "1024x1024") return 8
      if (aspectRatio === "2560x1440") return 9
      if (aspectRatio === "3840x2160") return 15
      return 6  // 1024x768, 1024x1536, 1920x1080
    }
    return 1
  }
  return 1
}

// Human-readable aspect ratio label for pixel-dimension tokens (e.g. "1920x1080" → "16:9")
const PIXEL_DIM_RATIO: Record<string, string> = {
  "1024x1024": "1:1",
  "1024x768":  "4:3",
  "1024x1536": "2:3",
  "1920x1080": "16:9",
  "2560x1440": "16:9",
  "3840x2160": "16:9",
}

// SeeDream 5.0 Lite: combines quality + aspect ratio into image_size params.
// Returns fields to spread directly into the API request body.
function seedream5LiteImageSize(quality: Quality, aspectRatio: AspectRatio): Record<string, string | number> {
  const base = quality === "3k" ? 3072 : 2048
  if (aspectRatio === "1:1") {
    return { image_size: quality === "3k" ? "auto_3K" : "auto_2K" }
  }
  const [wStr, hStr] = aspectRatio.split(":")
  const wRatio = parseInt(wStr)
  const hRatio = parseInt(hStr)
  let width: number, height: number
  if (wRatio >= hRatio) { // landscape
    width = base
    height = Math.round((base * hRatio) / wRatio)
  } else { // portrait
    height = base
    width = Math.round((base * wRatio) / hRatio)
  }
  return { image_size: "custom", custom_width: width, custom_height: height }
}

function getModelDisplayName(apiId: string): string {
  return IMAGE_MODEL_CONFIGS.find((m) => m.apiId === apiId)?.name ?? apiId
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  // iOS Safari fallback
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("execCommand failed"))
    } catch (e) { reject(e) }
    finally { document.body.removeChild(ta) }
  })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Compress a File to a persistent data URL (survives page refresh, storable in localStorage)
async function compressFileToDataUrl(file: File, maxSize = 800, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new window.Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = (h / w) * maxSize; w = maxSize } else { w = (w / h) * maxSize; h = maxSize }
        }
        const canvas = document.createElement("canvas")
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("Canvas unavailable")); return }
        ctx.drawImage(img, 0, 0, w, h)
        const result = canvas.toDataURL("image/jpeg", quality)
        // Release image src and canvas to help mobile browsers free memory sooner
        img.src = ""
        canvas.width = 0; canvas.height = 0
        resolve(result)
      }
      img.onerror = () => reject(new Error("Failed to load image"))
      img.src = ev.target?.result as string
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

async function compressBlobToDataUrl(blob: Blob, maxSize = 1920, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = (h / w) * maxSize; w = maxSize } else { w = (w / h) * maxSize; h = maxSize }
      }
      const canvas = document.createElement("canvas")
      canvas.width = w; canvas.height = h
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL("image/jpeg", quality))
    }
    img.onerror = () => reject(new Error("Failed to load image"))
    img.src = dataUrl
  })
}

// Calculate optimal Flux base dimensions from a reference image's natural size.
// Targets ~1MP total (1024×1024 = Flux sweet spot), snapped to multiples of 64.
function calcImg2ImgDims(nw: number, nh: number): { w: number; h: number } {
  const ratio = nw / nh
  let h = Math.round(Math.sqrt(1024 * 1024 / ratio) / 64) * 64
  let w = Math.round(h * ratio / 64) * 64
  w = Math.max(512, Math.min(2048, w))
  h = Math.max(512, Math.min(2048, h))
  return { w, h }
}

async function refImageToBase64(img: RefImage): Promise<string> {
  if (img.file) return compressFileToDataUrl(img.file, 1920, 0.85)
  // Data URLs are already base64 — no network fetch needed
  if (img.url.startsWith("data:")) return img.url
  // Route through our proxy to avoid CORS issues on Safari when fetching cross-origin R2 URLs
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(img.url)}`
  const res = await fetch(proxyUrl)
  if (!res.ok) throw new Error(`Failed to load reference image (${res.status})`)
  const blob = await res.blob()
  return compressBlobToDataUrl(blob, 1920, 0.85)
}

// --- PENDING SLOT ---
interface PendingSlot {
  slotId: string
  status: "loading" | "failed"
  prompt: string
  error?: string
  queueId?: number       // FAL queue job ID — stored so polling can resume after a page refresh
  queueJobId?: number    // GenerationQueue DB ID — set when the job was queued (capacity exceeded)
  nb2RequestId?: string  // FAL queue request ID for any async image model (NB2, Kling V3/O3, etc.)
  nb2FalEndpoint?: string
  nb2OutputFormat?: string
  nb2AspectRatio?: string
  nb2StatusUrl?: string  // Which status route to poll — defaults to /api/admin/nb2-status
  nb2Quality?: string    // Quality value passed through to the status route (e.g. for Kling O3 ticket cost)
  nb2TicketCost?: number // Per-slot ticket cost, used to refund on failure
  streamDataUrl?: string // Partial or final image URL from SSE streaming (gpt-image-2)
  // Config stored at creation time so failed tiles can show full details in the modal
  modelId?: string
  aspectRatio?: string
  quality?: string
  referenceImageUrls?: string[]
}

// --- VIDEO TYPES ---
interface VideoModelConfig {
  id: string
  name: string
  durations: string[]
  aspectRatios?: string[]          // Kling / SeeDance
  resolutions?: string[]           // Wan / SeeDance
  supportsEndFrame: boolean
  supportsMotionControl?: boolean  // Motion Control only
  characterOrientations?: string[] // Motion Control only
  audioType: "toggle" | "upload" | "none"
  textToVideo?: boolean            // image is optional (supports text-to-video)
  supportsReferenceVideo?: boolean // SeeDance 2.0 r2v — accepts image_urls[], video_urls[], audio_urls[]
  supportsSD20Modes?: boolean      // SeeDance 2.0 — shows T2V/I2V/Ref mode switcher inside panel
  supportsLipsync?: boolean        // Lipsync v3 — takes video + audio, no prompt
  startFrameLocksAspect?: boolean  // when a start frame is provided, aspect ratio is ignored by the model
}

interface VideoItem {
  id: string
  dbId?: number           // DB GeneratedImage id — set on completion from status route
  videoUrl: string
  prompt: string
  model: string
  duration: string
  resolution?: string
  aspectRatio?: string
  createdAt: string
  failed?: boolean
  failError?: string
  audioEnabled?: boolean
  startFrameUrl?: string
  endFrameUrl?: string
  motionVideoUrl?: string
  keepOriginalSound?: boolean
  characterOrientation?: "image" | "video"
}

interface VideoPendingSlot {
  slotId: string
  requestId: string
  falEndpoint: string
  prompt: string
  model: string
  duration: string
  resolution?: string
  ticketCost: number
  startedAt?: number
  aspectRatio?: string
  audioEnabled?: boolean
  startFrameUrl?: string
  endFrameUrl?: string
  motionVideoUrl?: string
  keepOriginalSound?: boolean
  characterOrientation?: "image" | "video"
  queueJobId?: number    // GenerationQueue DB ID — set when the job was queued (capacity exceeded)
}

interface VideoDetailData {
  id?: number             // DB GeneratedImage id for rating
  videoUrl: string
  prompt: string
  model: string
  duration?: string
  resolution?: string
  aspectRatio?: string
  createdAt?: string
  failed?: boolean
  failError?: string
  audioEnabled?: boolean
  startFrameUrl?: string
  endFrameUrl?: string
  motionVideoUrl?: string
  keepOriginalSound?: boolean
  characterOrientation?: "image" | "video"
}

const VIDEO_MODEL_CONFIGS: VideoModelConfig[] = [
  {
    id: "kling-v3",
    name: "Kling 3.0",
    durations: ["3","4","5","6","7","8","9","10","11","12","13","14","15"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsEndFrame: true,
    audioType: "toggle",
    startFrameLocksAspect: true,
  },
  {
    id: "wan-2.5",
    name: "Wan 2.5",
    durations: ["5", "10"],
    resolutions: ["480p", "720p", "1080p"],
    supportsEndFrame: false,
    audioType: "upload",
  },
  {
    id: "kling-v3-motion",
    name: "Kling V3 Motion",
    durations: [],
    supportsEndFrame: false,
    supportsMotionControl: true,
    characterOrientations: ["image", "video"],
    audioType: "none",
  },
  {
    id: "seedance-1.5",
    name: "SeeDance 1.5",
    durations: ["4","5","6","7","8","9","10","11","12"],
    resolutions: ["480p","720p","1080p"],
    aspectRatios: ["16:9","9:16","1:1","4:3","3:4","21:9","auto"],
    supportsEndFrame: true,
    audioType: "toggle",
    textToVideo: true,
  },
  {
    id: "seedance-2.0",
    name: "SeeDance 2.0",
    durations: ["auto","5","6","7","8","9","10"],
    resolutions: ["480p","720p","1080p"],
    aspectRatios: ["auto","21:9","16:9","4:3","1:1","3:4","9:16"],
    supportsEndFrame: true,
    audioType: "toggle",
    textToVideo: true,
  },
  {
    id: "seedance-2.0-fast",
    name: "SeeDance 2.0 Fast",
    durations: ["auto","4","5","6","7","8","9","10","11","12","13","14","15"],
    resolutions: ["480p","720p"],
    aspectRatios: ["auto","21:9","16:9","4:3","1:1","3:4","9:16"],
    supportsEndFrame: true,
    audioType: "toggle",
    textToVideo: true,
  },
  {
    id: "lipsync-v3",
    name: "Lipsync v3",
    durations: [],
    supportsEndFrame: false,
    audioType: "none",
    supportsLipsync: true,
  },
  {
    id: "happy-horse",
    name: "Happy Horse",
    durations: ["3","4","5","6","7","8","9","10","11","12","13","14","15"],
    resolutions: ["720p", "1080p"],
    supportsEndFrame: false,
    audioType: "none",
  },
]
const VIDEO_MODELS = VIDEO_MODEL_CONFIGS.map(m => m.name)

// Cost tier indicators — $ cheap · $$ mid · $$$ expensive
const IMAGE_MODEL_COST: Record<string, "$" | "$$" | "$$$" | "$$$+"> = {
  "flash-scanner-v2.5": "$",
  "seedream-4.5":        "$",
  "seedream-5-lite":     "$",
  "flux-2":              "$",
  "flux-1-dev":          "$$",
  "kling-v3-image":      "$",
  "kling-o3-image":      "$$",
  "wan-2.7-pro":         "$$",
  "nano-banana-pro-2":   "$$",
  "pro-scanner-v3":      "$$$",
  "nano-banana-pro":     "$$$",
  "gpt-image-2":         "$$",
  "z-image-base":        "$$",
  "z-image-turbo":       "$",
  "clarity-upscaler":    "$$",
  "aura-sr":             "$",
  "esrgan":              "$",
  "drct":                "$",
  "supir":               "$$",
  "local-realesrgan":    "$",
  "local-neosr":         "$",
}
const VIDEO_MODEL_COST: Record<string, "$" | "$$" | "$$$" | "$$$+"> = {
  "lipsync-v3":         "$",
  "seedance-1.5":       "$$",
  "wan-2.5":            "$$",
  "kling-v3-motion":    "$$$",
  "seedance-2.0-fast":  "$$$+",
  "seedance-2.0":       "$$$+",
  "kling-v3":           "$$$",
  "happy-horse":        "$$",
  "flux-1-dev":         "$$",
  "z-image-base":       "$$",
  "z-image-turbo":      "$",
}
function CostBadge({ tier }: { tier: "$" | "$$" | "$$$" | "$$$+" }) {
  const color = tier === "$"    ? "text-green-400"
              : tier === "$$"   ? "text-amber-400"
              : tier === "$$$+" ? "text-rose-300"
              :                   "text-rose-400"
  return (
    <span className={`font-mono text-[10px] font-bold shrink-0 ${color}`}>{tier}</span>
  )
}
// Name-keyed versions for the taskbar (which works with model names, not IDs)
const IMAGE_MODEL_COST_BY_NAME: Record<string, "$" | "$$" | "$$$" | "$$$+"> = Object.fromEntries(
  IMAGE_MODEL_CONFIGS.map(m => [m.name, IMAGE_MODEL_COST[m.id] ?? "$"])
)
const IMAGE_MODEL_GROUPS = [
  { label: "Gemini",            type: "text to image",             accent: "text-blue-400",    dot: "bg-blue-400",    items: ["NanoBanana Pro", "NanoBanana Pro 2", "Flash Scanner v2.5", "Pro Scanner v3"] },
  { label: "Kling",             type: "text to image",             accent: "text-orange-400",  dot: "bg-orange-400",  items: ["Kling V3", "Kling O3"] },
  { label: "ByteDance",         type: "text to image",             accent: "text-emerald-400", dot: "bg-emerald-400", items: ["SeeDream 4.5", "SeeDream 5.0 Lite"] },
  { label: "Wan",               type: "text to image",             accent: "text-violet-400",  dot: "bg-violet-400",  items: ["Wan 2.7 Pro"] },
  { label: "Black Forest Labs", type: "text to image",             accent: "text-amber-400",   dot: "bg-amber-400",   items: ["FLUX 1 Dev", "FLUX 2"] },
  { label: "OpenAI",            type: "text to image",             accent: "text-green-400",   dot: "bg-green-400",   items: ["ChatGPT Images 2.0"] },
  { label: "Z-Image",           type: "text to image",             accent: "text-cyan-400",    dot: "bg-cyan-400",    items: ["Z-Image Base", "Z-Image Turbo"] },
]
const ADMIN_IMAGE_MODEL_GROUPS = [
  { label: "RunPod",    type: "local · PC must be running", accent: "text-cyan-400",  dot: "bg-cyan-500",  items: ["Real-ESRGAN (Local)", "DAT-2 (Local)", "Custom Flux LoRA"] },
  { label: "Upscalers", type: "enhance & enlarge images",   accent: "text-slate-400", dot: "bg-slate-500", items: ["Clarity Upscaler", "AuraSR", "ESRGAN", "DRCT", "SUPIR"] },
]
const VIDEO_MODEL_COST_BY_NAME: Record<string, "$" | "$$" | "$$$" | "$$$+"> = Object.fromEntries(
  VIDEO_MODEL_CONFIGS.map(m => [m.name, VIDEO_MODEL_COST[m.id] ?? "$$"])
)
const VIDEO_MODEL_GROUPS = [
  { label: "Kling",       type: "image to video",        accent: "text-orange-400",  dot: "bg-orange-400",  items: ["Kling 3.0", "Kling V3 Motion"] },
  { label: "ByteDance",   type: "image & text to video", accent: "text-emerald-400", dot: "bg-emerald-400", items: ["SeeDance 1.5", "SeeDance 2.0", "SeeDance 2.0 Fast"] },
  { label: "Wan",         type: "image to video",        accent: "text-violet-400",  dot: "bg-violet-400",  items: ["Wan 2.5"] },
  { label: "Lipsync",     type: "lip sync video",        accent: "text-pink-400",    dot: "bg-pink-400",    items: ["Lipsync v3"] },
  { label: "Alibaba",     type: "image to video",        accent: "text-yellow-400",  dot: "bg-yellow-400",  items: ["Happy Horse"] },
]

const PROMPT_MODELS = [
  { id: "gemini-3-flash",       label: "Gemini 3 Flash" },
  { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp" },
  { id: "gemini-3-pro",         label: "Gemini 3 Pro" },
  { id: "gemini-exp-1206",      label: "Gemini Exp 1206" },
]
const SAVED_PROMPTS_KEY = "pv2-saved-prompts"
const TEXT_STATE_KEY = "pv2-text-state"

// --- TASKBAR DROPDOWN ---
function TaskbarDropdown({
  label,
  icon: Icon,
  items,
  open,
  onToggle,
  onSelect,
  activeItem,
  itemCosts,
}: {
  label: string
  icon: React.ElementType
  items: string[]
  open: boolean
  onToggle: () => void
  onSelect?: (item: string) => void
  activeItem?: string
  itemCosts?: Record<string, "$" | "$$" | "$$$" | "$$$+">
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const activeCost = activeItem && itemCosts ? itemCosts[activeItem] : undefined

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 216) })
    }
  }, [open])

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Icon size={15} />
        {label}
        {activeCost && <CostBadge tier={activeCost} />}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-52 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-[9999]" style={{ top: menuPos.top, left: menuPos.left }}>
          {items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 italic">Coming soon</div>
          ) : (
            items.map((item) => (
              <button
                key={item}
                onClick={() => { onSelect?.(item); onToggle() }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                  activeItem === item
                    ? "text-white bg-white/8"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{item}</span>
                {itemCosts?.[item] && <CostBadge tier={itemCosts[item]} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// --- GROUPED TASKBAR DROPDOWN (Image model picker — 2-column company cards) ---
function GroupedTaskbarDropdown({
  label,
  icon: Icon,
  groups,
  adminGroups,
  open,
  onToggle,
  onSelect,
  activeItem,
  itemCosts,
  menuTitle,
  menuDescription,
}: {
  label: string
  icon: React.ElementType
  groups: { label: string; type: string; accent: string; dot: string; items: string[] }[]
  adminGroups?: { label: string; type: string; accent: string; dot: string; items: string[] }[]
  open: boolean
  onToggle: () => void
  onSelect?: (item: string) => void
  activeItem?: string
  itemCosts?: Record<string, "$" | "$$" | "$$$" | "$$$+">
  menuTitle?: string
  menuDescription?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const activeCost = activeItem && itemCosts ? itemCosts[activeItem] : undefined

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 444) })
    }
  }, [open])

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Icon size={15} />
        {label}
        {activeCost && <CostBadge tier={activeCost} />}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="fixed rounded-xl border border-white/10 bg-[#080c18] backdrop-blur-md shadow-2xl z-[9999] overflow-hidden"
          style={{ top: menuPos.top, left: menuPos.left, width: 428 }}
        >
          {/* Header — tells the user exactly what this is and what to do */}
          <div className="px-4 pt-3 pb-2.5 border-b border-white/5">
            <p className="text-[12px] font-semibold text-white/85 leading-none">{menuTitle ?? label}</p>
            <p className="text-[10px] text-slate-500 mt-1 leading-snug">
              {menuDescription ?? "Select a model. Models are grouped by company."}{" "}
              <span className="text-slate-600">Active: <span className="text-slate-400">{activeItem ?? "none"}</span></span>
            </p>
          </div>

          {/* 2-col grid of company sections */}
          <div
            className="p-2.5 grid grid-cols-2 gap-x-2 gap-y-2 overflow-y-auto"
            style={{ maxHeight: `calc(100vh - ${menuPos.top + 100}px)` }}
          >
            {groups.map((group) => (
              <div key={group.label}>
                {/* Company label + what type of model it is */}
                <div className="flex items-center gap-1.5 px-1.5 pb-1">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${group.dot}`} />
                  <span className={`text-[9px] font-bold tracking-widest uppercase leading-none ${group.accent}`}>{group.label}</span>
                  <span className="text-[8px] text-slate-600 leading-none truncate">· {group.type}</span>
                </div>
                {/* Model rows */}
                <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                  {group.items.map((item) => (
                    <button
                      key={item}
                      onClick={() => { onSelect?.(item); onToggle() }}
                      className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-1 border-b border-white/[0.04] last:border-0 ${
                        activeItem === item
                          ? "bg-white/8 text-white font-medium"
                          : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="truncate leading-tight">{item}</span>
                      <span className="shrink-0 flex items-center gap-1">
                        {activeItem === item && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                        {itemCosts?.[item] && <CostBadge tier={itemCosts[item]} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Admin Models — full-width block containing subsections */}
            {adminGroups && adminGroups.length > 0 && (
              <div className="col-span-2 mt-0.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] overflow-hidden">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-cyan-500/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
                  <span className="text-[9px] font-bold tracking-widest uppercase text-cyan-400">Admin Models</span>
                  <span className="text-[8px] text-slate-600">· admin only</span>
                </div>
                <div className="p-2 grid grid-cols-2 gap-x-2">
                  {adminGroups.map((sub) => (
                    <div key={sub.label}>
                      <div className="flex items-center gap-1.5 px-1.5 pb-1">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sub.dot}`} />
                        <span className={`text-[9px] font-bold tracking-widest uppercase leading-none ${sub.accent}`}>{sub.label}</span>
                        <span className="text-[8px] text-slate-600 leading-none truncate">· {sub.type}</span>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                        {sub.items.map((item) => (
                          <button
                            key={item}
                            onClick={() => { onSelect?.(item); onToggle() }}
                            className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-1 border-b border-white/[0.04] last:border-0 ${
                              activeItem === item
                                ? "bg-white/8 text-white font-medium"
                                : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                            }`}
                          >
                            <span className="truncate leading-tight">{item}</span>
                            <span className="shrink-0 flex items-center gap-1">
                              {activeItem === item && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                              {itemCosts?.[item] && <CostBadge tier={itemCosts[item]} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer — explains the cost symbols plainly */}
          <div className="px-4 py-2 border-t border-white/5 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-slate-600">Ticket cost:</span>
            <span className="text-[9px] text-slate-500"><span className="text-green-400 font-bold font-mono">$</span> budget</span>
            <span className="text-[9px] text-slate-600">·</span>
            <span className="text-[9px] text-slate-500"><span className="text-amber-400 font-bold font-mono">$$</span> standard</span>
            <span className="text-[9px] text-slate-600">·</span>
            <span className="text-[9px] text-slate-500"><span className="text-rose-400 font-bold font-mono">$$$</span> premium</span>
            <span className="text-[9px] text-slate-600">·</span>
            <span className="text-[9px] text-slate-500"><span className="text-rose-300 font-bold font-mono">$$$+</span> expensive</span>
          </div>
        </div>
      )}
    </div>
  )
}

// --- SELECT DROPDOWN ---
function SelectDropdown({
  open,
  onToggle,
  selectMode,
  onToggleSelectMode,
  selectedCount,
  onDownloadAll,
  onDeleteAll,
  downloading,
  deleting,
  downloadProgress,
  downloadError,
}: {
  open: boolean
  onToggle: () => void
  selectMode: boolean
  onToggleSelectMode: () => void
  selectedCount: number
  onDownloadAll: () => void
  onDeleteAll: () => void
  downloading: boolean
  deleting: boolean
  downloadProgress?: { done: number; total: number } | null
  downloadError?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset confirmation when dropdown closes or selection changes
  useEffect(() => { if (!open) setConfirmDelete(false) }, [open])
  useEffect(() => { setConfirmDelete(false) }, [selectedCount])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 240) })
    }
  }, [open])

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open || selectMode ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <SlidersHorizontal size={15} />
        Select
        {selectMode && selectedCount > 0 && (
          <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full leading-none">{selectedCount}</span>
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-60 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl z-[9999] p-3 space-y-2" style={{ top: menuPos.top, left: menuPos.left }}>
          {/* Toggle select mode */}
          <button
            onClick={() => { onToggleSelectMode(); onToggle() }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
              selectMode
                ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-300"
                : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Check size={13} className={selectMode ? "text-cyan-400" : "text-slate-500"} />
            {selectMode ? "Exit Select Mode" : "Enter Select Mode"}
          </button>

          {/* Bulk actions — only shown in select mode */}
          {selectMode && (
            <>
              <div className="border-t border-white/8 pt-2 space-y-1.5">
                <p className="text-[10px] font-mono text-slate-600 px-1 uppercase tracking-wider">
                  {selectedCount === 0 ? "Select images to act" : `${selectedCount} selected`}
                </p>
                <button
                  onClick={() => { if (selectedCount > 0) onDownloadAll() }}
                  disabled={selectedCount === 0 || downloading}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {downloading
                    ? <div className="w-3 h-3 rounded-full border-2 border-slate-500 border-t-slate-200 animate-spin shrink-0" />
                    : <Download size={13} className="shrink-0" />}
                  <span className="flex-1 text-left">
                    {downloading && downloadProgress
                      ? downloadProgress.total > 1
                        ? `Fetching ${downloadProgress.done} / ${downloadProgress.total}…`
                        : "Downloading…"
                      : downloading
                        ? "Starting…"
                        : "Download All"}
                  </span>
                  {downloading && downloadProgress && downloadProgress.total > 1 && (
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      {Math.round((downloadProgress.done / downloadProgress.total) * 100)}%
                    </span>
                  )}
                </button>
                {downloadError && (
                  <p className="text-[11px] text-red-400 px-1 leading-snug">{downloadError}</p>
                )}
                {confirmDelete ? (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/8 p-2.5 space-y-2">
                    <p className="text-[11px] text-red-300 leading-snug">
                      Permanently delete {selectedCount} image{selectedCount !== 1 ? "s" : ""}? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { onDeleteAll(); setConfirmDelete(false) }}
                        disabled={deleting}
                        className="flex-1 py-1.5 rounded-md bg-red-500 hover:bg-red-400 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Yes, Delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { if (selectedCount > 0) setConfirmDelete(true) }}
                    disabled={selectedCount === 0 || deleting}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <X size={13} />
                    Delete Selected
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const ADMIN_EMAILS = ["dirtysecretai@gmail.com", "promptandprotocol@gmail.com"]

// --- PROFILE BUBBLE ---
function ProfileBubble({ user, onSignOut }: { user: UserData | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isAdmin = user !== null && ADMIN_EMAILS.includes(user.email)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
          open
            ? "border-cyan-400 bg-cyan-500/20 text-cyan-400"
            : "border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-400 hover:text-white"
        }`}
      >
        <User size={14} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl p-4 z-50">
          {user !== null ? (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">Email</p>
                <p className="text-sm text-white break-all">{user.email}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">User ID</p>
                <p className="text-sm text-white font-mono">#{user.id}</p>
              </div>
              <div className="pt-1 border-t border-white/10">
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">Tickets</p>
                <div className="flex items-center gap-2">
                  <Ticket size={14} className="text-cyan-400" />
                  <p className="text-lg font-bold text-cyan-400">{user.ticketBalance.toLocaleString()}</p>
                </div>
              </div>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="block w-full py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/40 text-sm text-cyan-400 hover:text-cyan-300 text-center transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Admin Portal →
                </Link>
              )}
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" })
                  setOpen(false)
                  onSignOut()
                }}
                className="w-full py-2 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-sm text-slate-400 hover:text-red-400 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm text-slate-500 mb-3">Not signed in</p>
              <Link
                href="/login"
                className="block w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white text-center transition-colors"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- REF IMAGE DROPDOWN ---
function RefDropdown({
  open,
  onToggle,
  library,
  activeIds,
  modelMaxRefs,
  onUpload,
  onDelete,
  onDeleteMultiple,
  onClearAll,
  onActivate,
  onDeactivate,
  disabled = false,
  libraryLimit = 50,
}: {
  open: boolean
  onToggle: () => void
  library: RefImage[]
  activeIds: string[]
  modelMaxRefs: number
  onUpload: (items: RefImage[]) => void
  onDelete: (id: string) => void
  onDeleteMultiple: (ids: string[]) => void
  onClearAll: () => void
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
  disabled?: boolean
  libraryLimit?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const activeCount = disabled ? 0 : activeIds.filter((id) => library.some((img) => img.id === id)).length
  const atLimit = !disabled && modelMaxRefs > 0 && activeCount >= modelMaxRefs

  // Exit select mode + clear errors when dropdown closes
  useEffect(() => {
    if (!open) {
      setSelectMode(false)
      setSelectedForDelete(new Set())
      setUploadError(null)
    }
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 328) })
    }
  }, [open])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ""
    if (!files.length) return
    const slots = libraryLimit - library.length
    if (slots <= 0) {
      setUploadError(`Library is full (${libraryLimit}/${libraryLimit})`)
      return
    }
    const toProcess = files.slice(0, slots)
    setUploadError(null)
    setUploading(true)
    try {
      const items: RefImage[] = await Promise.all(
        toProcess.map(async (file) => ({
          id: `lib-${Date.now()}-${Math.random()}`,
          url: await compressFileToDataUrl(file),
        }))
      )
      onUpload(items)
    } catch (err) {
      console.error("Ref upload failed:", err)
      setUploadError("Upload failed — try again or use a smaller image")
    } finally {
      setUploading(false)
    }
  }

  const handleToggle = (img: RefImage) => {
    if (disabled) return
    if (activeIds.includes(img.id)) {
      onDeactivate(img.id)
    } else if (!atLimit) {
      onActivate(img.id)
    }
  }

  const toggleSelectForDelete = (id: string) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleDeleteSelected = () => {
    onDeleteMultiple([...selectedForDelete])
    setSelectedForDelete(new Set())
    setSelectMode(false)
  }

  const handleClearAll = () => {
    onClearAll()
    setSelectMode(false)
    setSelectedForDelete(new Set())
  }

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <ImagePlus size={15} />
        Refs
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold leading-none">
            {activeCount}
          </span>
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-80 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-[9999]" style={{ top: menuPos.top, left: menuPos.left }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-sm font-semibold text-white">Reference Images</span>
            <div className="flex items-center gap-2">
              {/* Stacked Total / Active pills */}
              <div className="flex flex-col gap-1">
                {/* Library slots pill */}
                <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-md border border-white/10 bg-black/60" title="Total images saved in your library">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Total</span>
                  <span className={`text-xs font-mono font-bold ${library.length >= libraryLimit ? "text-amber-400" : "text-slate-300"}`}>
                    {library.length}/{libraryLimit}
                  </span>
                </div>
                {/* Active refs pill */}
                <div className={`flex items-center justify-between gap-2 px-2.5 py-1 rounded-md border ${
                  atLimit
                    ? "border-amber-500/30 bg-amber-500/10"
                    : activeCount > 0
                    ? "border-cyan-500/25 bg-black/60"
                    : "border-white/8 bg-black/40"
                }`} title={modelMaxRefs > 0 ? `Images currently sent with your generation — max ${modelMaxRefs} for this model` : "Images currently sent with your generation"}>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Active</span>
                  <span className={`text-xs font-mono font-bold ${atLimit ? "text-amber-400" : activeCount > 0 ? "text-cyan-400" : "text-slate-500"}`}>
                    {activeCount}{modelMaxRefs > 0 ? `/${modelMaxRefs}` : ""}
                  </span>
                </div>
              </div>
              {library.length > 0 && !selectMode && (
                <button
                  onClick={() => setSelectMode(true)}
                  className="text-[10px] font-bold text-slate-300 hover:text-white transition-all h-7 px-3 rounded-md border border-white/15 bg-white/6 hover:bg-white/10 hover:border-white/25 whitespace-nowrap flex items-center justify-center"
                >
                  Select
                </button>
              )}
              {library.length > 0 && !selectMode && (
                <button
                  onClick={handleClearAll}
                  className="text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-all h-7 px-3 rounded-md border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 hover:border-rose-500/50 whitespace-nowrap flex items-center justify-center"
                >
                  Clear all
                </button>
              )}
              {selectMode && (
                <button
                  onClick={() => { setSelectMode(false); setSelectedForDelete(new Set()) }}
                  className="text-[10px] text-slate-400 hover:text-white transition-colors px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          {!selectMode && (
            <div className="px-4 py-2.5 border-b border-white/5 bg-white/2">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Upload images here to use as visual references. <span className="text-white">Tap an image to toggle it on/off</span> — only <span className="text-cyan-400">active</span> images are sent with your generation. Your library is saved between sessions.
              </p>
            </div>
          )}

          {/* Upload button — hidden in select mode */}
          {!selectMode && (
            <div className="px-3 py-2 border-b border-white/5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => { if (!uploading && library.length < libraryLimit) { setUploadError(null); fileInputRef.current?.click() } }}
                disabled={library.length >= libraryLimit || uploading}
                className="w-full py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-slate-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {uploading
                  ? <><div className="w-2.5 h-2.5 rounded-full border border-slate-500 border-t-slate-200 animate-spin" />Compressing…</>
                  : <><Plus size={11} />{library.length >= libraryLimit ? `Library full (${libraryLimit}/${libraryLimit})` : `Upload Images · ${libraryLimit - library.length} slots left`}</>
                }
              </button>
              {uploadError && (
                <p className="text-[10px] text-red-400 mt-1.5 px-1 leading-snug">{uploadError}</p>
              )}
            </div>
          )}

          {/* Select mode hint */}
          {selectMode && (
            <div className="px-4 py-2 border-b border-white/5 bg-rose-500/5">
              <p className="text-[10px] text-rose-400/80">Tap images to select them for deletion</p>
            </div>
          )}

          {/* Disabled notice for video mode */}
          {!selectMode && disabled && (
            <div className="px-4 py-2 border-b border-white/5 bg-slate-800/60">
              <p className="text-[10px] text-slate-400">Reference images are not used by video models. Upload start/end frames through the video configuration panel instead.</p>
            </div>
          )}

          {/* Model support notice */}
          {!selectMode && !disabled && modelMaxRefs === 0 && (
            <div className="px-4 py-2 border-b border-white/5 bg-amber-500/5">
              <p className="text-[10px] text-amber-400/70">Current model doesn't support reference images.</p>
            </div>
          )}

          {/* Thumbnail grid */}
          <div className="p-3 max-h-72 overflow-y-auto">
            {library.length === 0 ? (
              <p className="text-center text-slate-600 text-[11px] py-8">No images in library yet</p>
            ) : (
              <div className="grid grid-cols-5 gap-1.5">
                {library.map((img) => {
                  const isActive = !selectMode && activeIds.includes(img.id)
                  const isDisabled = !selectMode && !isActive && atLimit
                  const isSelectedForDelete = selectMode && selectedForDelete.has(img.id)
                  return (
                    <div key={img.id} className="relative group aspect-square">
                      <button
                        onClick={() => selectMode ? toggleSelectForDelete(img.id) : handleToggle(img)}
                        disabled={!selectMode && (isDisabled || disabled)}
                        title={
                          selectMode
                            ? isSelectedForDelete ? "Click to deselect" : "Click to select for deletion"
                            : disabled ? "Not available for video models"
                            : isDisabled ? `Limit reached (${modelMaxRefs})`
                            : isActive ? "Click to deactivate" : "Click to activate"
                        }
                        className={`w-full h-full rounded-md overflow-hidden border-2 transition-all ${
                          selectMode
                            ? isSelectedForDelete
                              ? "border-rose-400 ring-1 ring-rose-400/30"
                              : "border-transparent hover:border-white/30"
                            : disabled
                            ? "border-transparent opacity-30 cursor-not-allowed"
                            : isActive
                            ? "border-cyan-400 ring-1 ring-cyan-400/30"
                            : isDisabled
                            ? "border-transparent opacity-25 cursor-not-allowed"
                            : "border-transparent hover:border-white/30"
                        }`}
                      >
                        <img src={img.url} alt="" className={`w-full h-full object-cover transition-opacity ${isSelectedForDelete ? "opacity-60" : ""}`} />
                      </button>

                      {/* Active checkmark (normal mode) */}
                      {!selectMode && isActive && (
                        <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-cyan-400 flex items-center justify-center pointer-events-none">
                          <Check size={9} className="text-black" />
                        </div>
                      )}

                      {/* Selected-for-delete indicator (select mode) */}
                      {selectMode && (
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center pointer-events-none transition-all ${
                          isSelectedForDelete ? "bg-rose-500 border-rose-400" : "bg-black/50 border-white/40"
                        }`}>
                          {isSelectedForDelete && <Check size={8} className="text-white" />}
                        </div>
                      )}

                      {/* Delete on hover (normal mode only) */}
                      {!selectMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(img.id) }}
                          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        >
                          <X size={8} className="text-white" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Select mode action bar */}
          {selectMode && (
            <div className="px-3 py-2.5 border-t border-white/5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                {selectedForDelete.size > 0 ? `${selectedForDelete.size} selected` : "None selected"}
              </span>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedForDelete.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[11px] font-medium hover:bg-rose-500/25 hover:border-rose-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Trash2 size={11} />
                Delete ({selectedForDelete.size})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- TEXT DROPDOWN ---
function TextDropdown({
  open,
  onToggle,
  hasDevAccess,
  imageModelName,
  onUsePrompt,
  signedIn,
}: {
  open: boolean
  onToggle: () => void
  hasDevAccess: boolean
  imageModelName: string
  onUsePrompt: (text: string) => void
  signedIn: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  // AI Prompting state
  const [promptModel, setPromptModel] = useState<string>(PROMPT_MODELS[0].id)
  const [names, setNames] = useState<string[]>([""])
  const [enhancements, setEnhancements] = useState<string[]>([""])
  const [generatedPrompt, setGeneratedPrompt] = useState<string>("")
  const [generating, setGenerating] = useState(false)
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const [genError, setGenError] = useState<string | null>(null)
  const [copiedGen, setCopiedGen] = useState(false)

  // Saved prompts
  const [savedPrompts, setSavedPrompts] = useState<string[]>(Array(16).fill(""))
  const [copiedSavedIdx, setCopiedSavedIdx] = useState<number | null>(null)
  const savedPromptsInitialized = useRef(false)
  const savedPromptsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore AI prompting state from localStorage after mount
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(TEXT_STATE_KEY) || "{}")
      if (s.promptModel && PROMPT_MODELS.some((m) => m.id === s.promptModel)) setPromptModel(s.promptModel)
      if (Array.isArray(s.names) && s.names.length > 0) setNames(s.names)
      if (Array.isArray(s.enhancements) && s.enhancements.length > 0) setEnhancements(s.enhancements)
      if (s.generatedPrompt) setGeneratedPrompt(s.generatedPrompt)
    } catch {}
  }, [])

  // Persist text state (AI prompting) to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TEXT_STATE_KEY, JSON.stringify({ promptModel, names, enhancements, generatedPrompt }))
    } catch {}
  }, [promptModel, names, enhancements, generatedPrompt])

  // Single effect: first run = restore (localStorage + DB), subsequent runs = save.
  // Using the same pattern as model settings to prevent overwriting stored data with defaults.
  useEffect(() => {
    if (!savedPromptsInitialized.current) {
      savedPromptsInitialized.current = true
      // Always load from localStorage first (synchronous, instant)
      try {
        const arr = JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY) || "[]")
        if (Array.isArray(arr) && arr.length > 0) {
          setSavedPrompts([...arr.slice(0, 16), ...Array(Math.max(0, 16 - arr.length)).fill("")])
        }
      } catch {}
      // Then sync from DB in background (overwrites localStorage if DB has data)
      if (signedIn) {
        fetch('/api/user/preferences')
          .then(r => r.json())
          .then(({ preferences }) => {
            if (Array.isArray(preferences?.savedPrompts) && preferences.savedPrompts.some((p: string) => p)) {
              const arr = preferences.savedPrompts as string[]
              setSavedPrompts([...arr.slice(0, 16), ...Array(Math.max(0, 16 - arr.length)).fill("")])
            }
          })
          .catch(() => {})
      }
      return // Do not save on the restore run
    }
    // Subsequent runs: save to localStorage immediately, DB debounced
    try { localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(savedPrompts)) } catch {}
    if (signedIn) {
      if (savedPromptsSaveTimer.current) clearTimeout(savedPromptsSaveTimer.current)
      savedPromptsSaveTimer.current = setTimeout(() => {
        fetch('/api/user/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ savedPrompts }),
        }).catch(() => {})
      }, 1500)
    }
  }, [savedPrompts, signedIn])

  // Cooldown countdown
  useEffect(() => {
    if (!cooldownEnd) return
    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000))
      setCooldownLeft(left)
      if (left === 0) { setCooldownEnd(null); clearInterval(tick) }
    }, 250)
    return () => clearInterval(tick)
  }, [cooldownEnd])

  // Outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const panelW = Math.min(1080, window.innerWidth - 8)
      setMenuPos({ top: rect.bottom + 8, left: Math.max(4, Math.min(rect.left, window.innerWidth - panelW - 4)) })
    }
  }, [open])

  const isFlash = promptModel === "gemini-3-flash" || promptModel === "gemini-2.0-flash-exp"
  const canGenerate = !generating && !cooldownEnd && hasDevAccess

  const handleGenerate = async () => {
    if (!canGenerate) return
    const celebrity = names.filter((n) => n.trim()).join(", ")
    const baseStyle = enhancements.filter((e) => e.trim()).join(", ")
    if (!celebrity && !baseStyle) { setGenError("Enter at least one name or enhancement."); return }
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch("/api/prompting-studio/generate-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ celebrity, baseStyle, model: imageModelName, promptModel }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setGenError(data.error || "Generation failed.")
      } else {
        setGeneratedPrompt(data.prompt || data.result || "")
        if (!isFlash) { setCooldownEnd(Date.now() + 10000); setCooldownLeft(10) }
      }
    } catch (err: any) {
      setGenError(err.message || "Network error.")
    } finally {
      setGenerating(false)
    }
  }

  const handleUseGenerated = () => {
    if (!generatedPrompt) return
    onUsePrompt(generatedPrompt)
    onToggle()
  }

  const handleCopyGenerated = () => {
    copyToClipboard(generatedPrompt).then(() => {
      setCopiedGen(true)
      setTimeout(() => setCopiedGen(false), 2000)
    })
  }

  const handleCopySaved = (idx: number) => {
    if (!savedPrompts[idx]) return
    copyToClipboard(savedPrompts[idx]).then(() => {
      setCopiedSavedIdx(idx)
      setTimeout(() => setCopiedSavedIdx(null), 2000)
    })
  }

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Type size={15} />
        Text
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed rounded-xl border border-white/10 bg-[#080c18] backdrop-blur-md shadow-2xl z-[9999] overflow-hidden" style={{ top: menuPos.top, left: menuPos.left, width: Math.min(1080, window.innerWidth - 8) }}>
          {/* Header */}
          <div className="px-4 pt-3 pb-2.5 border-b border-white/5">
            <p className="text-[12px] font-semibold text-white/85 leading-none">Text Tools</p>
            <p className="text-[10px] text-slate-500 mt-1 leading-snug">Generate a prompt with AI, or load from 16 saved slots.</p>
          </div>
          <div className="grid grid-cols-[2fr_3fr] divide-x divide-white/5">

            {/* LEFT: AI Prompting */}
            <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <p className="text-[10px] font-bold text-cyan-400/70 uppercase tracking-widest font-mono">AI Prompting</p>
              </div>

              {!hasDevAccess ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm text-slate-500">Dev tier required</p>
                  <a href="/prompting-studio/subscribe" className="text-[11px] text-cyan-400 hover:underline">Upgrade →</a>
                </div>
              ) : (
                <>
                  {/* AI Model */}
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">AI Model</label>
                    <select
                      value={promptModel}
                      onChange={(e) => setPromptModel(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md bg-slate-800 border border-white/10 text-xs text-white focus:outline-none focus:border-white/20"
                    >
                      {PROMPT_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Names */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] text-slate-500">Names ({names.length}/5)</label>
                      {names.length < 5 && (
                        <button onClick={() => setNames((p) => [...p, ""])} className="text-[10px] text-cyan-400 hover:text-cyan-300">+ Add</button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {names.map((name, i) => (
                        <div key={i} className="flex gap-1 items-center">
                          <input
                            value={name}
                            onChange={(e) => setNames((p) => p.map((n, idx) => idx === i ? e.target.value : n))}
                            placeholder={`Name ${i + 1}`}
                            className="flex-1 px-2 py-1 rounded-md bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-white/20"
                          />
                          {names.length > 1 && (
                            <button onClick={() => setNames((p) => p.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Enhancements */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] text-slate-500">Enhancements ({enhancements.length}/10)</label>
                      {enhancements.length < 10 && (
                        <button onClick={() => setEnhancements((p) => [...p, ""])} className="text-[10px] text-cyan-400 hover:text-cyan-300">+ Add</button>
                      )}
                    </div>
                    <div className="space-y-1.5 max-h-28 overflow-y-auto">
                      {enhancements.map((enh, i) => (
                        <div key={i} className="flex gap-1 items-center">
                          <input
                            value={enh}
                            onChange={(e) => setEnhancements((p) => p.map((en, idx) => idx === i ? e.target.value : en))}
                            placeholder={`Enhancement ${i + 1}`}
                            className="flex-1 px-2 py-1 rounded-md bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-white/20"
                          />
                          {enhancements.length > 1 && (
                            <button onClick={() => setEnhancements((p) => p.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Generate */}
                  {genError && <p className="text-[10px] text-red-400">{genError}</p>}
                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className={`w-full py-1.5 rounded-md text-xs font-semibold transition-all ${
                      canGenerate
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black hover:opacity-90"
                        : "bg-white/5 text-slate-600 cursor-not-allowed"
                    }`}
                  >
                    {generating ? "Generating…" : cooldownEnd ? `Wait ${cooldownLeft}s` : "Generate Prompt"}
                  </button>

                  {/* Output */}
                  {generatedPrompt && (
                    <div className="space-y-1.5">
                      <textarea
                        value={generatedPrompt}
                        onChange={(e) => setGeneratedPrompt(e.target.value)}
                        rows={4}
                        className="w-full px-2 py-1.5 rounded-md bg-slate-800 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-white/20 resize-none leading-relaxed"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopyGenerated}
                          className="flex-1 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                        >
                          {copiedGen ? "Copied!" : "Copy"}
                        </button>
                        <button
                          onClick={handleUseGenerated}
                          className="flex-1 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px] text-white font-medium transition-all"
                        >
                          Use →
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* RIGHT: Saved Prompts */}
            <div className="p-4 max-h-[520px] overflow-y-auto">
              <div className="flex items-center gap-1.5 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 shrink-0" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Saved Prompts</p>
                <span className="text-[9px] text-slate-600 font-mono">· 16 slots</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {savedPrompts.map((p, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <textarea
                      value={p}
                      onChange={(e) => setSavedPrompts((prev) => prev.map((sp, idx) => idx === i ? e.target.value : sp))}
                      placeholder={`Prompt ${i + 1}`}
                      rows={3}
                      className="w-full px-2 py-1.5 rounded-md bg-slate-800 border border-white/10 text-[11px] text-slate-200 placeholder-slate-700 focus:outline-none focus:border-white/20 resize-none leading-relaxed"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleCopySaved(i)}
                        title="Copy"
                        className="flex-1 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-1"
                      >
                        {copiedSavedIdx === i ? <Check size={10} /> : <Copy size={9} />}
                        <span>{copiedSavedIdx === i ? "Copied!" : "Copy"}</span>
                      </button>
                      <button
                        onClick={() => { if (p) { onUsePrompt(p); onToggle() } }}
                        disabled={!p}
                        title="Load into prompt"
                        className="flex-1 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px] text-white font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Use →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// --- QUEUE DISPLAY ---
function QueueDisplay({ active, max, label = "queue" }: { active: number; max: number; label?: string }) {
  const unlimited = max === Infinity
  const full = !unlimited && active >= max
  const busy = active > 0

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-mono transition-colors ${
      full
        ? "border-red-500/30 bg-red-500/10 text-red-400"
        : busy
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-white/10 bg-white/5 text-slate-500"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
        full ? "bg-red-400 animate-pulse" : busy ? "bg-amber-400 animate-pulse" : "bg-slate-600"
      }`} />
      <span className="tabular-nums">{active}/{unlimited ? "∞" : max}</span>
      <span className="text-[10px] hidden sm:inline opacity-70">{label}</span>
    </div>
  )
}

// --- GRID IMAGE CELL ---
function GridImage({ src, alt, onClick, imageId, directUrl, selectMode, selected, onSelect }: {
  src: string; alt: string; onClick?: () => void; imageId?: number; directUrl?: string
  selectMode?: boolean; selected?: boolean; onSelect?: (id: number) => void
}) {
  const [loaded, setLoaded] = useState(false)
  // directUrl: skip the proxy and load directly (used for just-completed images where the
  // blob URL is already known — avoids the DB-auth → blob-fetch → sharp chain adding delay)
  const thumbSrc = directUrl || (imageId ? `/api/images/${imageId}?thumb=1` : src)
  const handleClick = () => {
    if (selectMode && imageId !== undefined) { onSelect?.(imageId); return }
    onClick?.()
  }
  return (
    <div
      className={`aspect-square bg-slate-800 overflow-hidden relative ${onClick || selectMode ? "cursor-pointer group" : ""} ${selected ? "ring-2 ring-cyan-400 ring-inset" : ""}`}
      onClick={handleClick}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 animate-pulse" />
      )}
      <img
        src={thumbSrc}
        alt={alt}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-80 transition-opacity" : ""} ${selected ? "opacity-80" : ""}`}
      />
      {selectMode && (
        <div className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${selected ? "bg-cyan-400 border-cyan-400" : "border-white/60 bg-black/40"}`}>
          {selected && <Check size={9} className="text-black" />}
        </div>
      )}
    </div>
  )
}

// --- FEED PLACEHOLDERS ---
function LoadingSlot({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square w-full bg-slate-800 flex flex-col items-center justify-center gap-2 hover:bg-slate-700 transition-colors"
    >
      <div className="w-6 h-6 rounded-full border-2 border-slate-600 border-t-slate-300 animate-spin" />
    </button>
  )
}

function StreamingSlot({ dataUrl, onClick }: { dataUrl: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square w-full relative overflow-hidden bg-slate-900 hover:opacity-90 transition-opacity"
    >
      <img
        src={dataUrl}
        alt="Generating..."
        className="absolute inset-0 w-full h-full object-cover"
        style={{ animation: "blurReveal 1.2s ease-out forwards" }}
      />
      <style>{`
        @keyframes blurReveal {
          from { filter: blur(24px) brightness(0.7); opacity: 0.6; transform: scale(1.05); }
          to   { filter: blur(0px)  brightness(1);   opacity: 1;   transform: scale(1); }
        }
      `}</style>
      <div className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full bg-black/60 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full border border-cyan-400 border-t-transparent animate-spin" />
      </div>
    </button>
  )
}

function QueuedSlot({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square w-full bg-slate-900 border border-amber-500/20 hover:border-amber-500/40 flex flex-col items-center justify-center gap-2 transition-colors"
    >
      <div className="w-5 h-5 rounded-full border-2 border-amber-500/50 border-t-amber-400 animate-spin" />
      <p className="text-[9px] text-amber-400/60 font-mono tracking-wide">QUEUED</p>
    </button>
  )
}

function FailedSlot({ prompt, error, onClick }: { prompt: string; error: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square w-full bg-slate-900 border border-red-500/20 hover:border-red-500/40 flex flex-col items-center justify-center p-3 gap-2 transition-colors cursor-pointer"
    >
      <div className="w-5 h-5 rounded-full border-2 border-red-500/60 flex items-center justify-center shrink-0">
        <X size={10} className="text-red-400" />
      </div>
      <p className="text-[9px] text-red-400/70 text-center leading-tight line-clamp-1">{error}</p>
      <p className="text-[9px] text-slate-600 text-center leading-tight line-clamp-2 italic">"{prompt}"</p>
    </button>
  )
}

// --- PENDING DETAIL MODAL ---
function PendingDetailModal({
  prompt,
  model,
  quality,
  aspectRatio,
  referenceImageUrls,
  isVideoSlot,
  startFrameUrl,
  endFrameUrl,
  isQueued,
  onClose,
  onUsePrompt,
  onDismiss,
}: {
  prompt: string
  model: string
  quality?: string
  aspectRatio?: string
  referenceImageUrls?: string[]
  isVideoSlot?: boolean
  startFrameUrl?: string
  endFrameUrl?: string
  isQueued?: boolean
  onClose: () => void
  onUsePrompt: (text: string) => void
  onDismiss?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const modelName = getModelDisplayName(model)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const handleCopy = () => {
    copyToClipboard(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] sm:rounded-2xl border-0 sm:border border-white/10 bg-slate-950 sm:bg-slate-950/95 shadow-2xl overflow-hidden flex flex-col sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        >
          <X size={13} />
        </button>

        {/* Left: animated spinner */}
        <div className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
          <div className="flex flex-col items-center gap-4">
            <div className={`w-16 h-16 rounded-full border-2 animate-spin ${isQueued ? "border-amber-500/30 border-t-amber-400" : "border-slate-600 border-t-slate-300"}`} />
            <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color: isQueued ? "rgb(251 191 36 / 0.6)" : "rgb(100 116 139)" }}>
              {isQueued ? "Queued" : "Generating..."}
            </p>
          </div>
        </div>

        {/* Info panel */}
        <div className="sm:w-72 flex flex-col border-t border-white/8 sm:border-t-0 sm:border-l sm:border-white/8 shrink-0">
          {/* Desktop: full scrollable info */}
          <div className="hidden sm:block flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Prompt</p>
              <p className="text-[12px] text-slate-200 leading-relaxed">{prompt}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Model</p>
              <span className="inline-block px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] font-mono">
                {modelName}
              </span>
            </div>
            {(aspectRatio || quality) && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Settings</p>
                <div className="flex flex-wrap gap-1.5">
                  {aspectRatio && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                      {aspectRatio}
                    </span>
                  )}
                  {quality && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                      {quality.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            )}
            {isVideoSlot ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Start Frame</p>
                  {startFrameUrl ? (
                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                      <img src={startFrameUrl} alt="Start frame" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-600 italic">No reference</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">End Frame</p>
                  {endFrameUrl ? (
                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                      <img src={endFrameUrl} alt="End frame" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-600 italic">No reference</p>
                  )}
                </div>
              </div>
            ) : (referenceImageUrls && referenceImageUrls.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">
                  References ({referenceImageUrls.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {referenceImageUrls.map((url, i) => (
                    <div key={i} className="w-11 h-11 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile: compact */}
          <div className="sm:hidden px-4 pt-3 pb-2">
            <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-2">{prompt}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono">{modelName}</span>
              {aspectRatio && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{aspectRatio}</span>}
              {quality && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{quality.toUpperCase()}</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="p-3 sm:p-4 border-t border-white/8 space-y-2 shrink-0">
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy Prompt"}
              </button>
              <button
                onClick={() => { onUsePrompt(prompt); onClose() }}
                className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/8 hover:bg-white/12 text-[11px] text-white font-medium transition-all flex items-center justify-center gap-1.5"
              >
                Use Prompt
              </button>
            </div>
            {onDismiss && (
              <button
                onClick={() => { onDismiss(); onClose() }}
                className="w-full py-1.5 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-[11px] text-red-400 hover:text-red-300 transition-all flex items-center justify-center gap-1.5"
              >
                <X size={11} /> Dismiss Generation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- STAR RATING WIDGET ---
function StarRatingWidget({ generationId }: { generationId: number }) {
  const storageKey = `rated-gen-${generationId}`
  const [rating, setRating] = useState<number | null>(() => {
    try { const v = localStorage.getItem(storageKey); return v ? parseInt(v) : null } catch { return null }
  })
  const [hover, setHover] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const submit = async (score: number) => {
    if (rating !== null || saving) return
    setSaving(true)
    try {
      await fetch('/api/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatedImageId: generationId, score }),
      })
      try { localStorage.setItem(storageKey, String(score)) } catch {}
      setRating(score)
      setSaved(true)
    } catch {}
    setSaving(false)
  }

  if (rating !== null) {
    return (
      <div>
        <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-2">Your Rating</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(s => (
            <Star
              key={s}
              size={15}
              className={s <= rating ? "text-amber-400 fill-amber-400" : "text-slate-700 fill-slate-800"}
            />
          ))}
          {saved && <span className="ml-2 text-[10px] text-slate-500">Thanks!</span>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">How close is this to your vision?</p>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(s => (
          <button
            key={s}
            disabled={saving}
            onClick={() => submit(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="p-1 rounded transition-transform hover:scale-110 disabled:opacity-40"
          >
            <Star
              size={16}
              className={s <= hover ? "text-amber-400 fill-amber-400" : "text-slate-600 fill-transparent"}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

// --- IMAGE DETAIL MODAL ---
function ImageDetailModal({
  image,
  onClose,
  onRescan,
  onUsePrompt,
  onAddRef,
}: {
  image: ImageItem
  onClose: () => void
  onRescan: (image: ImageItem) => void
  onUsePrompt: (text: string) => void
  onAddRef: (url: string, r2Key?: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [addedRef, setAddedRef] = useState(false)

  const modelName = getModelDisplayName(image.model)
  const modelConfig = IMAGE_MODEL_CONFIGS.find(m => m.apiId === image.model)
  const isUpscalerImage = modelConfig?.isUpscaler
  const showSettings = !!(isUpscalerImage || modelConfig?.isCustomFlux || image.aspectRatio || image.quality || modelConfig?.supportsQuality)
  const formattedDate = image.createdAt
    ? new Date(image.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null

  const handleCopy = () => {
    copyToClipboard(image.prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] sm:rounded-2xl border-0 sm:border border-white/10 bg-slate-950 sm:bg-slate-950/95 shadow-2xl overflow-hidden flex flex-col sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        >
          <X size={13} />
        </button>

        {/* Image — or failed state */}
        <div className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
          {image.failed ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="w-14 h-14 rounded-full border-2 border-red-500/50 flex items-center justify-center">
                <X size={22} className="text-red-400" />
              </div>
              <p className="text-sm text-red-400 font-semibold tracking-wide">Generation Failed</p>
              <div className="w-full max-w-sm max-h-48 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-left">
                <p className="text-[11px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap break-all select-all">{image.failError || "The generation did not complete."}</p>
              </div>
            </div>
          ) : (
            <img
              src={image.imageUrl}
              alt={image.prompt}
              className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
              title="Open full size"
              onClick={() => window.open(image.imageUrl, "_blank")}
            />
          )}
        </div>

        {/* Info panel */}
        <div className="sm:w-72 flex flex-col border-t border-white/8 sm:border-t-0 sm:border-l sm:border-white/8 shrink-0">

          {/* Desktop: full scrollable info */}
          <div className="hidden sm:block flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Prompt</p>
              <p className="text-[12px] text-slate-200 leading-relaxed">{image.prompt}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Model</p>
              <span className="inline-block px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] font-mono">
                {modelName}
              </span>
            </div>
            {formattedDate && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Generated</p>
                <p className="text-[11px] text-slate-400">{formattedDate}</p>
              </div>
            )}
            {showSettings && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Settings</p>
                <div className="flex flex-wrap gap-1.5">
                  {isUpscalerImage ? (
                    <>
                      {image.videoMetadata?.upscaleFactor != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-mono">
                          {image.videoMetadata.upscaleFactor}x upscale
                        </span>
                      )}
                      {/* Clarity-specific */}
                      {image.videoMetadata?.upscaleCreativity != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          creativity {Number(image.videoMetadata.upscaleCreativity).toFixed(2)}
                        </span>
                      )}
                      {image.videoMetadata?.upscaleResemblance != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          resemblance {Number(image.videoMetadata.upscaleResemblance).toFixed(2)}
                        </span>
                      )}
                      {image.videoMetadata?.upscaleGuidance != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          CFG {Number(image.videoMetadata.upscaleGuidance).toFixed(1)}
                        </span>
                      )}
                      {image.videoMetadata?.upscaleSteps != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {image.videoMetadata.upscaleSteps} steps
                        </span>
                      )}
                      {/* AuraSR-specific */}
                      {image.videoMetadata?.auraSrCheckpoint != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {image.videoMetadata.auraSrCheckpoint}
                        </span>
                      )}
                      {image.videoMetadata?.auraSrOverlappingTiles != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          tiles {image.videoMetadata.auraSrOverlappingTiles ? "overlap" : "no overlap"}
                        </span>
                      )}
                      {/* DRCT-specific */}
                      {image.model === "drct" && image.videoMetadata?.drctTicketCost != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {image.videoMetadata.drctTicketCost} ticket{image.videoMetadata.drctTicketCost !== 1 ? "s" : ""}
                        </span>
                      )}
                      {/* ESRGAN-specific */}
                      {image.videoMetadata?.esrganModel && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {String(image.videoMetadata.esrganModel).replace("RealESRGAN_", "")}
                        </span>
                      )}
                      {image.videoMetadata?.esrganFace && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          face mode
                        </span>
                      )}
                      {!image.videoMetadata?.upscaleFactor && (
                        <span className="text-[11px] text-slate-600 font-mono">Not recorded</span>
                      )}
                    </>
                  ) : modelConfig?.isCustomFlux ? (
                    <>
                      {image.videoMetadata?.fluxWidth && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {String(image.videoMetadata.fluxWidth)}×{String(image.videoMetadata.fluxHeight)}
                        </span>
                      )}
                      {image.videoMetadata?.fluxSteps && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-500/10 border border-slate-500/20 text-slate-300 text-[11px] font-mono">
                          {String(image.videoMetadata.fluxSteps)} steps
                        </span>
                      )}
                      {image.videoMetadata?.fluxGuidance && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-500/10 border border-slate-500/20 text-slate-300 text-[11px] font-mono">
                          cfg {String(image.videoMetadata.fluxGuidance)}
                        </span>
                      )}
                      {image.videoMetadata?.fluxUpscale && image.videoMetadata.fluxUpscale !== 'none' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-mono">
                          {image.videoMetadata.fluxUpscale === 'combo'
                            ? `combo ${image.videoMetadata.fluxComboOrder === 'flux-first' ? 'flux→esrgan' : 'esrgan→flux'}`
                            : image.videoMetadata.fluxUpscale === 'pipeline'
                            ? `pipeline (${Array.isArray(image.videoMetadata.fluxPipelineSteps) ? (image.videoMetadata.fluxPipelineSteps as Array<{type:string}>).map(s => s.type).join('→') : '?'})`
                            : String(image.videoMetadata.fluxUpscale)}
                        </span>
                      )}
                      {image.videoMetadata?.fluxEsrganModel && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-500/10 border border-slate-500/20 text-slate-300 text-[11px] font-mono">
                          {String(image.videoMetadata.fluxEsrganModel)}
                        </span>
                      )}
                      {image.videoMetadata?.fluxRefine && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-mono">refine</span>
                      )}
                      {image.videoMetadata?.fluxGfpgan && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-mono">
                          gfpgan {image.videoMetadata.fluxGfpganWeight ? Number(image.videoMetadata.fluxGfpganWeight).toFixed(1) : ''}
                        </span>
                      )}
                      {image.videoMetadata?.fluxAdetailer && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-mono">adetailer</span>
                      )}
                      {image.videoMetadata?.fluxImg2img && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-mono">
                          i2i {image.videoMetadata.fluxImg2imgStr ? Number(image.videoMetadata.fluxImg2imgStr).toFixed(2) : ''}
                        </span>
                      )}
                      {image.videoMetadata?.fluxSeed && image.videoMetadata.fluxSeed !== 'random' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[11px] font-mono">
                          seed {String(image.videoMetadata.fluxSeed)}
                        </span>
                      )}
                      {image.videoMetadata?.fluxCheckpoint && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-mono">
                          {String(image.videoMetadata.fluxCheckpoint)}
                        </span>
                      )}
                      {!image.videoMetadata?.fluxWidth && (
                        <span className="text-[11px] text-slate-600 font-mono">Not recorded</span>
                      )}
                    </>
                  ) : (
                    <>
                      {image.aspectRatio && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {image.aspectRatio}
                        </span>
                      )}
                      {image.quality && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                          {image.quality.toUpperCase()}
                        </span>
                      )}
                      {!image.aspectRatio && !image.quality && (
                        <span className="text-[11px] text-slate-600 font-mono">Not recorded</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {image.loraUrl && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">LoRA</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-mono">
                  <Sparkles size={9} />
                  {image.loraName || "Custom LoRA"}
                </span>
              </div>
            )}
            {image.referenceImageUrls && image.referenceImageUrls.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">
                  References ({image.referenceImageUrls.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {image.referenceImageUrls.map((url, i) => (
                    <div key={i} className="w-11 h-11 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!image.failed && image.id > 0 && (
              <div className="pt-1 border-t border-white/[0.06]">
                <StarRatingWidget generationId={image.id} />
              </div>
            )}
          </div>

          {/* Mobile: compact prompt + model only */}
          <div className="sm:hidden px-4 pt-3 pb-3">
            <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-2">{image.prompt}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono">{modelName}</span>
              {isUpscalerImage && image.videoMetadata?.upscaleFactor != null && <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] font-mono">{image.videoMetadata.upscaleFactor}x upscale</span>}
              {!isUpscalerImage && image.aspectRatio && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{image.aspectRatio}</span>}
              {!isUpscalerImage && image.quality && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{image.quality.toUpperCase()}</span>}
              {image.loraUrl && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-mono"><Sparkles size={8} />{image.loraName || "LoRA"}</span>}
              {formattedDate && <span className="text-[10px] text-slate-600">{formattedDate}</span>}
            </div>
            {!image.failed && image.id > 0 && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <StarRatingWidget generationId={image.id} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-3 sm:p-4 border-t border-white/8 space-y-2 shrink-0">
            <button
              onClick={() => { onRescan(image); onClose() }}
              className="w-full py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={12} />
              {image.failed ? "Try Again" : "Rescan"}
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy Prompt"}
              </button>
              <button
                onClick={() => { onUsePrompt(image.prompt); onClose() }}
                className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/8 hover:bg-white/12 text-[11px] text-white font-medium transition-all flex items-center justify-center gap-1.5"
              >
                <span className="hidden sm:inline">Use Prompt</span>
                <span className="sm:hidden">Use</span>
              </button>
              {!image.failed && (
                <>
                  <button
                    onClick={() => {
                      onAddRef(image.imageUrl, image.r2Key)
                      setAddedRef(true)
                      setTimeout(() => setAddedRef(false), 2000)
                    }}
                    className={`flex-1 py-1.5 rounded-lg border text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                      addedRef
                        ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                        : "border-white/10 bg-white/5 hover:bg-cyan-500/10 hover:border-cyan-500/30 hover:text-cyan-400 text-slate-300"
                    }`}
                  >
                    <ImagePlus size={11} />
                    {addedRef ? "Added!" : "Ref"}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/images/${image.id}?download=1`)
                        if (!res.ok) throw new Error()
                        const blob = await res.blob()
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a")
                        a.href = url
                        const ext = blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") ? "jpg" : blob.type.includes("png") ? "png" : "img"
                        a.download = `${image.prompt.substring(0, 40).replace(/[^a-z0-9]/gi, "_")}.${ext}`
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        URL.revokeObjectURL(url)
                      } catch {}
                    }}
                    className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download size={11} />
                    Download
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- VIDEO DETAIL MODAL ---
function VideoDetailModal({
  video,
  onClose,
  onRescan,
  onUsePrompt,
}: {
  video: VideoDetailData
  onClose: () => void
  onRescan: (video: VideoDetailData) => void
  onUsePrompt: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const modelName = getModelDisplayName(video.model)
  const formattedDate = video.createdAt
    ? new Date(video.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const handleCopy = () => {
    copyToClipboard(video.prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const fetchUrl = video.id ? `/api/images/${video.id}?download=1` : video.videoUrl
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${video.prompt.substring(0, 40).replace(/[^a-z0-9]/gi, "_")}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("Download failed:", e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] sm:rounded-2xl border-0 sm:border border-white/10 bg-slate-950 sm:bg-slate-950/95 shadow-2xl overflow-hidden flex flex-col sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        >
          <X size={13} />
        </button>

        {/* Video player — or error state */}
        <div className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
          {video.failed ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="w-12 h-12 rounded-full border-2 border-red-500/60 flex items-center justify-center">
                <X size={20} className="text-red-400" />
              </div>
              <p className="text-sm text-red-400 font-medium">Generation Failed</p>
              <div className="w-full max-w-sm max-h-48 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-left">
                <p className="text-[11px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap break-all select-all">{video.failError || "The video generation did not complete."}</p>
              </div>
            </div>
          ) : (
            <video
              src={video.videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>

        {/* Info + actions panel */}
        <div className="sm:w-72 flex flex-col border-t border-white/8 sm:border-t-0 sm:border-l sm:border-white/8 shrink-0">

          {/* Desktop: full info */}
          <div className="hidden sm:block flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Prompt</p>
              <p className="text-[12px] text-slate-200 leading-relaxed">{video.prompt}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Model</p>
              <span className="inline-block px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px] font-mono">
                {modelName}
              </span>
            </div>
            {(video.duration || video.resolution || video.aspectRatio) && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Settings</p>
                <div className="flex flex-wrap gap-1.5">
                  {video.aspectRatio && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                      {video.aspectRatio}
                    </span>
                  )}
                  {video.resolution && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                      {video.resolution}
                    </span>
                  )}
                  {video.duration && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-mono">
                      {video.duration}s
                    </span>
                  )}
                </div>
              </div>
            )}
            {(video.startFrameUrl || video.endFrameUrl) && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">
                  Frames
                </p>
                <div className="flex gap-2">
                  {video.startFrameUrl && (
                    <div className="flex flex-col gap-1">
                      <p className="text-[9px] text-slate-600 font-mono">START</p>
                      <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                        <img src={video.startFrameUrl} alt="start frame" className="w-full h-full object-cover" />
                      </div>
                    </div>
                  )}
                  {video.endFrameUrl && (
                    <div className="flex flex-col gap-1">
                      <p className="text-[9px] text-slate-600 font-mono">END</p>
                      <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 bg-slate-800">
                        <img src={video.endFrameUrl} alt="end frame" className="w-full h-full object-cover" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {formattedDate && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-1.5">Generated</p>
                <p className="text-[11px] text-slate-400">{formattedDate}</p>
              </div>
            )}
            {!video.failed && video.id !== undefined && (
              <div className="pt-1 border-t border-white/[0.06]">
                <StarRatingWidget generationId={video.id} />
              </div>
            )}
          </div>

          {/* Mobile: compact info */}
          <div className="sm:hidden px-4 pt-3 pb-3">
            <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-2">{video.prompt}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-mono">{modelName}</span>
              {video.aspectRatio && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{video.aspectRatio}</span>}
              {video.resolution && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{video.resolution}</span>}
              {video.duration && <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono">{video.duration}s</span>}
              {formattedDate && <span className="text-[10px] text-slate-600">{formattedDate}</span>}
            </div>
            {!video.failed && video.id !== undefined && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <StarRatingWidget generationId={video.id} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-3 sm:p-4 border-t border-white/8 space-y-2 shrink-0">
            <button
              onClick={() => { onRescan(video); onClose() }}
              className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={12} />
              {video.failed ? "Try Again" : "Use This Prompt"}
            </button>
            {!video.failed && (
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => { onUsePrompt(video.prompt); onClose() }}
                  className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/8 hover:bg-white/12 text-[11px] text-white font-medium transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="hidden sm:inline">Use Prompt</span>
                  <span className="sm:hidden">Use</span>
                </button>
                {isIOS ? (
                  <a
                    href={video.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download size={11} />
                    Download
                  </a>
                ) : (
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Download size={11} />
                    {downloading ? "..." : "Download"}
                  </button>
                )}
                <a
                  href={video.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
                >
                  Open
                </a>
              </div>
            )}
            {video.failed && (
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/8 text-[11px] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied Prompt" : "Copy Prompt"}
                </button>
                <button
                  onClick={() => { onUsePrompt(video.prompt); onClose() }}
                  className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/8 hover:bg-white/12 text-[11px] text-white font-medium transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="hidden sm:inline">Use Prompt</span>
                  <span className="sm:hidden">Use</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- IMAGE GRID ---
function ImageGrid({
  signedIn,
  pendingSlots,
  freshImages,
  savedFails,
  onImageClick,
  onPendingClick,
  selectMode,
  selectedIds,
  onSelectToggle,
}: {
  signedIn: boolean
  pendingSlots: PendingSlot[]
  freshImages: ImageItem[]
  savedFails: ImageItem[]
  onImageClick: (img: ImageItem) => void
  onPendingClick?: (slot: PendingSlot) => void
  selectMode?: boolean
  selectedIds?: Set<number>
  onSelectToggle?: (id: number) => void
}) {
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const pageRef = useRef(1)
  const hasMoreRef = useRef(true)
  const pageLimitRef = useRef(typeof window !== "undefined" && window.innerWidth < 640 ? 8 : 24)

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await fetch(`/api/my-images?page=${pageRef.current}&limit=${pageLimitRef.current}&type=image`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.success) return
      setImages((prev) => {
        const existingIds = new Set(prev.map(i => i.id))
        const newItems = data.images
          .filter((img: any) => !existingIds.has(img.id))
          .map((img: any) => ({
            id: img.id,
            imageUrl: img.imageUrl,
            prompt: img.prompt,
            model: img.model,
            createdAt: img.createdAt,
            referenceImageUrls: img.referenceImageUrls ?? [],
            aspectRatio: img.aspectRatio ?? undefined,
            quality: img.quality ?? undefined,
            videoMetadata: img.videoMetadata ?? undefined,
          }))
        return [...prev, ...newItems]
      })
      hasMoreRef.current = pageRef.current < data.pagination.totalPages
      pageRef.current += 1
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  const checkSentinel = useCallback(() => {
    if (!sentinelRef.current || !hasMoreRef.current) return
    const rect = sentinelRef.current.getBoundingClientRect()
    if (rect.top < window.innerHeight + 1200) loadNext()
  }, [loadNext])

  useEffect(() => { if (signedIn) loadNext() }, [signedIn, loadNext])
  useEffect(() => { if (!loading) checkSentinel() }, [loading, checkSentinel])

  useEffect(() => {
    if (!signedIn) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadNext() },
      { rootMargin: "1200px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [signedIn, loadNext])

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4">
        <div className="w-full max-w-sm text-center">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <User size={28} className="text-slate-400" />
          </div>

          <h2 className="text-lg font-bold text-white mb-1">Sign in to get started</h2>
          <p className="text-sm text-slate-500 mb-6">Your generations and saved work will appear here.</p>

          <div className="flex flex-col gap-2">
            <Link href="/login" className="block">
              <button className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black text-sm font-bold hover:opacity-90 transition-opacity">
                Sign In
              </button>
            </Link>
            <Link href="/signup" className="block">
              <button className="w-full py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all">
                Create Account
              </button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!loading && images.length === 0 && !hasMoreRef.current) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-600 text-sm">
        No generations yet
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0.5">
        {/* Pending: loading and failed slots appear at the top */}
        {pendingSlots.map((slot) =>
          slot.status === "loading"
            ? (slot.streamDataUrl
                ? <StreamingSlot key={slot.slotId} dataUrl={slot.streamDataUrl} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />
                : slot.queueJobId && !slot.nb2RequestId
                  ? <QueuedSlot key={slot.slotId} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />
                  : <LoadingSlot key={slot.slotId} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />)
            : <FailedSlot key={slot.slotId} prompt={slot.prompt} error={slot.error || "Generation failed"} />
        )}
        {/* Fresh: just-completed images and failed tiles, in completion order */}
        {freshImages.map((img) =>
          img.failed
            ? <FailedSlot key={`fresh-${img.id}`} prompt={img.prompt} error={img.failError || "Generation failed"} onClick={selectMode ? undefined : () => onImageClick(img)} />
            : <GridImage key={`fresh-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} directUrl={img.imageUrl} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} />
        )}
        {/* DB images merged with restored fails, sorted by createdAt so fails land in the right spot */}
        {(() => {
          const freshIds = new Set(freshImages.map(i => i.id))
          const liveFailIds = new Set(freshImages.filter(i => i.failed).map(i => i.id))
          const dbFiltered = images.filter(img => !freshIds.has(img.id))
          // Only include savedFails not already shown in the live freshImages section
          const failsToMerge = savedFails.filter(f => !liveFailIds.has(f.id))
          const merged = [...dbFiltered, ...failsToMerge].sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
            return bTime - aTime
          })
          return merged.map(img =>
            img.failed
              ? <FailedSlot key={`sf-${img.id}`} prompt={img.prompt} error={img.failError || "Generation failed"} onClick={selectMode ? undefined : () => onImageClick(img)} />
              : <GridImage key={`db-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} />
          )
        })()}
      </div>
      <div ref={sentinelRef} className="h-1" />
      {loading && (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-slate-400 animate-spin" />
        </div>
      )}
    </div>
  )
}

// --- TYPES ---
interface UserPreset {
  id: number
  name: string
  referenceImageUrls: string[]
  createdAt: string
}

interface RefImage {
  id: string
  url: string      // blob URL for uploads, permanent URL for preset-loaded
  file?: File      // undefined when loaded from a preset
}

// --- PRESETS PANEL ---
function PresetsPanel({
  open,
  onClose,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  onLoad: (urls: string[]) => void
}) {
  const [presets, setPresets] = useState<UserPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  // Create form
  const [newName, setNewName] = useState("")
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [newPreviews, setNewPreviews] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  const createFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch("/api/user/models")
      .then((r) => r.json())
      .then((d) => setPresets(d.models || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onClose])

  if (!open) return null

  const handleLoad = (preset: UserPreset) => {
    onLoad(preset.referenceImageUrls)
    onClose()
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await fetch(`/api/user/models?id=${id}`, { method: "DELETE" })
      setPresets((prev) => prev.filter((p) => p.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const toAdd = files.slice(0, 8 - newFiles.length)
    setNewFiles((prev) => [...prev, ...toAdd])
    setNewPreviews((prev) => [...prev, ...toAdd.map((f) => URL.createObjectURL(f))])
    e.target.value = ""
  }

  const removeNewImage = (i: number) => {
    URL.revokeObjectURL(newPreviews[i])
    setNewFiles((prev) => prev.filter((_, idx) => idx !== i))
    setNewPreviews((prev) => prev.filter((_, idx) => idx !== i))
  }

  const compressImage = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const img = new window.Image()
        img.onload = () => {
          const MAX = 1920
          let w = img.width, h = img.height
          if (w > MAX || h > MAX) {
            if (w > h) { h = (h / w) * MAX; w = MAX } else { w = (w / h) * MAX; h = MAX }
          }
          const canvas = document.createElement("canvas")
          canvas.width = w; canvas.height = h
          canvas.getContext("2d")?.drawImage(img, 0, 0, w, h)
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
            "image/jpeg", 0.85
          )
        }
        img.onerror = () => reject(new Error("Failed to load image"))
        img.src = ev.target?.result as string
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })

  const handleCreate = async () => {
    if (!newName.trim()) { setCreateError("Enter a preset name."); return }
    if (newFiles.length === 0) { setCreateError("Upload at least one image."); return }
    setCreating(true)
    setCreateError(null)
    try {
      const urls: string[] = []
      for (const file of newFiles) {
        const blob = await compressImage(file)
        const form = new FormData()
        form.append("file", blob, "reference.jpg")
        const res = await fetch("/api/upload-reference", { method: "POST", body: form })
        if (!res.ok) throw new Error(`Upload failed (${res.status})`)
        const data = await res.json()
        if (!data.url) throw new Error("No URL returned")
        urls.push(data.url)
      }
      const res = await fetch("/api/user/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), referenceImageUrls: urls }),
      })
      const data = await res.json()
      if (data.success) {
        setPresets((prev) => [data.model, ...prev])
        setNewName("")
        newPreviews.forEach((u) => URL.revokeObjectURL(u))
        setNewFiles([])
        setNewPreviews([])
      } else {
        setCreateError(data.error || "Failed to save preset.")
      }
    } catch (err: any) {
      setCreateError(err.message || "Something went wrong.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-44 px-6 pointer-events-auto">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        ref={ref}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <span className="text-sm font-semibold text-white">Presets</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {/* Saved presets list */}
          <div>
            {loading && (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-slate-400 animate-spin" />
              </div>
            )}
            {!loading && presets.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">No presets yet</div>
            )}
            {!loading && presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors"
              >
                <div className="flex gap-0.5 shrink-0">
                  {preset.referenceImageUrls.slice(0, 3).map((url, i) => (
                    <div key={i} className="w-8 h-8 rounded overflow-hidden bg-slate-800">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{preset.name}</p>
                  <p className="text-[11px] text-slate-500">{preset.referenceImageUrls.length} image{preset.referenceImageUrls.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleLoad(preset)} className="text-[11px] text-slate-400 hover:text-white transition-colors">
                    Load
                  </button>
                  <button
                    onClick={() => handleDelete(preset.id)}
                    disabled={deleting === preset.id}
                    className="text-[11px] text-slate-600 hover:text-red-400 transition-colors"
                  >
                    {deleting === preset.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Create new preset */}
          <div className="px-4 py-4 border-t border-white/5 space-y-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Create New Preset</p>

            {/* Image upload grid */}
            <div className="flex flex-wrap gap-2">
              {newFiles.length < 8 && (
                <>
                  <input ref={createFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  <button
                    onClick={() => createFileInputRef.current?.click()}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-white/10 hover:border-white/25 bg-white/3 hover:bg-white/5 flex flex-col items-center justify-center gap-1 transition-all text-slate-500 hover:text-slate-300"
                  >
                    <Plus size={14} />
                    <span className="text-[9px]">Upload</span>
                  </button>
                </>
              )}
              {newPreviews.map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeNewImage(i)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={8} className="text-white" />
                  </button>
                </div>
              ))}
            </div>

            {/* Name + save */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Preset name"
                className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-white/20 transition-colors"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim() || newFiles.length === 0}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/10 hover:bg-white/15 text-white shrink-0 flex items-center gap-1.5"
              >
                {creating && <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
                {creating ? "Saving…" : "Save"}
              </button>
            </div>

            {createError && <p className="text-[11px] text-red-400">{createError}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- ASPECT RATIO PICKER ---
function AspectRatioPicker({
  ratios,
  value,
  onChange,
}: {
  ratios: AspectRatio[]
  value: AspectRatio
  onChange: (ar: AspectRatio) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono transition-all ${
          open
            ? "border-white/20 bg-white/10 text-white"
            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
        }`}
      >
        {PIXEL_DIM_RATIO[value] ?? value}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-40 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-50">
          {ratios.map((ar) => (
            <button
              key={ar}
              onClick={() => { onChange(ar); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[12px] font-mono transition-colors ${
                ar === value
                  ? "text-white bg-white/8"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {PIXEL_DIM_RATIO[ar] ? `${PIXEL_DIM_RATIO[ar]} (${ar})` : ar}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- DOWNLOAD TO R2 PANEL ---

function DownloadToR2Panel() {
  const [url, setUrl]                   = useState('')
  const [ckptSection, setCkptSection]   = useState<'dev' | 'fill' | 'kontext' | 'esrgan'>('dev')
  const [modelName, setModelName]       = useState('')
  const [civitaiToken, setCivitaiToken] = useState('')
  const [jobId, setJobId]               = useState<string | null>(null)
  const [status, setStatus]             = useState<'idle' | 'submitting' | 'running' | 'done' | 'error'>('idle')
  const [resultR2Key, setResultR2Key]   = useState<string | null>(null)
  const [sizeMb, setSizeMb]             = useState<number | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-build R2 key from section + name
  const computedR2Key = (() => {
    const name = modelName.trim()
    if (!name) return ''
    const defaultExt = ckptSection === 'esrgan' ? '.pth' : '.safetensors'
    const fname = name.includes('.') ? name : `${name}${defaultExt}`
    if (ckptSection === 'fill')    return `training/checkpoints/flux-fill-${fname}`
    if (ckptSection === 'kontext') return `training/checkpoints/flux-kontext-${fname}`
    if (ckptSection === 'esrgan')  return `training/models/esrgan/${fname}`
    return `training/checkpoints/${fname}`
  })()

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPolling(), [])

  const startPolling = (id: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/admin/r2/download?job_id=${id}`)
        const data = await res.json() as { status: string; r2Key?: string; sizeMb?: number; error?: string }
        if (data.status === 'done') {
          stopPolling()
          setStatus('done')
          setResultR2Key(data.r2Key ?? null)
          setSizeMb(data.sizeMb ?? null)
        } else if (data.status === 'error') {
          stopPolling()
          setStatus('error')
          setError(data.error ?? 'Worker reported an error')
        }
      } catch { /* keep polling */ }
    }, 4000)
  }

  const handleSubmit = async () => {
    if (!url.trim() || !computedR2Key) return
    setStatus('submitting')
    setError(null)
    setResultR2Key(null)
    setSizeMb(null)
    setJobId(null)
    try {
      const res  = await fetch('/api/admin/r2/download', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), r2Key: computedR2Key, civitaiToken: civitaiToken.trim() || undefined }),
      })
      const data = await res.json() as { job_id?: string; error?: string }
      if (!res.ok || !data.job_id) throw new Error(data.error ?? 'Failed to submit job')
      setJobId(data.job_id)
      setStatus('running')
      startPolling(data.job_id)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const handleReset = () => {
    stopPolling()
    setStatus('idle')
    setJobId(null)
    setResultR2Key(null)
    setSizeMb(null)
    setError(null)
  }

  const isRunning = status === 'submitting' || status === 'running'

  const SECTIONS = [
    { id: 'dev'     as const, label: 'Flux 1 Dev',    accent: 'amber',   desc: 'Base dev checkpoints' },
    { id: 'fill'    as const, label: 'Flux Fill',      accent: 'emerald', desc: 'Inpainting / fill' },
    { id: 'kontext' as const, label: 'Flux 1 Kontext', accent: 'violet',  desc: 'Context-aware' },
    { id: 'esrgan'  as const, label: 'ESRGAN',         accent: 'orange',  desc: 'Upscale models' },
  ]

  const activeSection = SECTIONS.find(s => s.id === ckptSection)!

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
          <Download size={14} className="text-sky-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white leading-none">Download Model to R2</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Worker downloads at ~245 MB/s directly into your R2 bucket</p>
        </div>
      </div>

      {/* URL */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Download URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://civitai.com/api/download/models/..."
          disabled={isRunning}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
        />
      </div>

      {/* Destination section */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Destination</label>
        <div className="grid grid-cols-4 gap-1.5">
          {SECTIONS.map(s => {
            const isActive = ckptSection === s.id
            const colorMap: Record<string, string> = {
              amber:   isActive ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'   : 'border-white/[0.08] text-slate-500 hover:border-white/[0.15] hover:text-slate-300',
              emerald: isActive ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] text-slate-500 hover:border-white/[0.15] hover:text-slate-300',
              violet:  isActive ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'  : 'border-white/[0.08] text-slate-500 hover:border-white/[0.15] hover:text-slate-300',
              orange:  isActive ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'  : 'border-white/[0.08] text-slate-500 hover:border-white/[0.15] hover:text-slate-300',
            }
            return (
              <button
                key={s.id}
                onClick={() => setCkptSection(s.id)}
                disabled={isRunning}
                className={`flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-xl border transition-all text-left disabled:opacity-50 ${colorMap[s.accent]}`}
              >
                <span className="text-[11px] font-semibold leading-tight">{s.label}</span>
                <span className="text-[9px] text-slate-600 leading-tight">{s.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Model name */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Model Filename</label>
        <input
          value={modelName}
          onChange={e => setModelName(e.target.value)}
          placeholder={ckptSection === 'esrgan' ? 'my-upscaler.pth' : 'my-checkpoint.safetensors'}
          disabled={isRunning}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
        />
        {computedR2Key && (
          <p className="text-[10px] text-slate-600 font-mono break-all">
            → <span className={`${
              ckptSection === 'fill'    ? 'text-emerald-400/70' :
              ckptSection === 'kontext' ? 'text-violet-400/70'  :
              ckptSection === 'esrgan'  ? 'text-orange-400/70'  :
                                          'text-amber-400/70'
            }`}>{computedR2Key}</span>
          </p>
        )}
      </div>

      {/* Auth token */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Auth Token <span className="text-slate-600 normal-case">(optional)</span></label>
        <input
          type="password"
          value={civitaiToken}
          onChange={e => setCivitaiToken(e.target.value)}
          placeholder="HuggingFace token (hf_…) or CivitAI API key"
          disabled={isRunning}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
        />
        <p className="text-[10px] text-slate-600 leading-snug">
          HuggingFace gated models also require accepting the license at <span className="text-slate-500">huggingface.co</span> before the token will work.
        </p>
      </div>

      {/* Action */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSubmit}
          disabled={isRunning || !url.trim() || !computedR2Key}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-semibold text-black"
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {status === 'submitting' ? 'Submitting...' : status === 'running' ? 'Downloading...' : 'Start Download'}
        </button>
        {status !== 'idle' && (
          <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Reset
          </button>
        )}
      </div>

      {/* Status */}
      {status === 'running' && jobId && (
        <div className="flex items-center gap-2 text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-xl px-3 py-2.5">
          <Loader2 size={12} className="animate-spin shrink-0" />
          <span>Worker is downloading… Job ID: <span className="font-mono">{jobId}</span></span>
        </div>
      )}
      {status === 'done' && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
            <CheckCircle size={12} />
            Download complete{sizeMb ? ` — ${sizeMb.toFixed(0)} MB` : ''}
          </div>
          {resultR2Key && (
            <p className="text-[11px] text-slate-400 font-mono break-all">{resultR2Key}</p>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

// --- REF IMAGE EDITOR ---
type EditorTool = 'draw' | 'erase' | 'blur' | 'shape' | 'crop'
type ShapeKind  = 'rect' | 'circle'

function RefImageEditorModal({ image, onApply, onClose }: {
  image: RefImage
  onApply: (newUrl: string) => void
  onClose: () => void
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const historyRef  = useRef<string[]>([])
  const isDrawingRef = useRef(false)
  const lastPtRef    = useRef<{ x: number; y: number } | null>(null)
  const blurPtsRef   = useRef<{ x: number; y: number }[]>([])
  const startPtRef   = useRef<{ x: number; y: number } | null>(null)
  const cropRectRef  = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const [tool,       setTool]       = useState<EditorTool>('draw')
  const [brushSize,  setBrushSize]  = useState(20)
  const [drawColor,  setDrawColor]  = useState('#ffffff')
  const [blurRadius, setBlurRadius] = useState(10)
  const [shapeKind,  setShapeKind]  = useState<ShapeKind>('rect')
  const [shapeFill,  setShapeFill]  = useState(true)
  const [shapeColor, setShapeColor] = useState('#ffffff')
  const [hasCropSel, setHasCropSel] = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [histLen,    setHistLen]    = useState(1)

  // Load image into canvas on mount.
  // We don't set crossOrigin so the browser can load blob: and https: URLs freely.
  // On Apply we proxy the export through a white-background JPEG so canvas taint doesn't matter.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const img = document.createElement('img')
    img.onload = () => {
      const maxW = 720, maxH = 500
      const scale = Math.min(1, maxW / img.width, maxH / img.height)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      canvas.width = w; canvas.height = h
      const overlay = overlayRef.current!
      overlay.width = w; overlay.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      // Snapshot the initial state for reset/undo — use the img element directly
      // (avoids toDataURL taint issue on first load from remote URLs)
      const snap = document.createElement('canvas')
      snap.width = w; snap.height = h
      snap.getContext('2d')!.drawImage(img, 0, 0, w, h)
      historyRef.current = [snap.toDataURL('image/jpeg', 0.95)]
      setHistLen(1); setLoaded(true)
    }
    img.onerror = () => {
      // If direct load fails (e.g. CORS on remote URL), fetch as blob first
      fetch(image.url)
        .then(r => r.blob())
        .then(blob => { img.src = URL.createObjectURL(blob) })
        .catch(() => setLoaded(true)) // show empty canvas rather than hang
    }
    img.src = image.url
  }, [image.url])

  const getPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * canvas.width  / r.width,
      y: (e.clientY - r.top)  * canvas.height / r.height,
    }
  }

  const pushHistory = () => {
    const url = canvasRef.current!.toDataURL()
    historyRef.current = [...historyRef.current, url]
    setHistLen(historyRef.current.length)
  }

  const restoreFrame = (dataUrl: string) => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const img = document.createElement('img')
    // History frames are always JPEG data URLs (same-origin) — no CORS concern
    img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0) }
    img.src = dataUrl
  }

  const undo = () => {
    if (historyRef.current.length <= 1) return
    historyRef.current = historyRef.current.slice(0, -1)
    setHistLen(historyRef.current.length)
    restoreFrame(historyRef.current[historyRef.current.length - 1])
  }

  const reset = () => {
    if (historyRef.current.length === 0) return
    const orig = historyRef.current[0]
    historyRef.current = [orig]
    setHistLen(1)
    restoreFrame(orig)
    setHasCropSel(false)
    overlayRef.current && (overlayRef.current.getContext('2d')!.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height))
  }

  const clearOverlay = () => {
    const o = overlayRef.current; if (!o) return
    o.getContext('2d')!.clearRect(0, 0, o.width, o.height)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const pos = getPos(e)
    isDrawingRef.current = true
    lastPtRef.current = pos

    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    if (tool === 'draw') {
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
    } else if (tool === 'erase') {
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
    } else if (tool === 'blur') {
      blurPtsRef.current = [pos]
    } else if (tool === 'shape' || tool === 'crop') {
      startPtRef.current = pos
      setHasCropSel(false)
      cropRectRef.current = null
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    const pos = getPos(e)
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const overlay = overlayRef.current!
    const octx = overlay.getContext('2d')!

    if (tool === 'draw') {
      ctx.strokeStyle = drawColor
      ctx.lineWidth = brushSize
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineTo(pos.x, pos.y); ctx.stroke()
    } else if (tool === 'erase') {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = brushSize
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineTo(pos.x, pos.y); ctx.stroke()
    } else if (tool === 'blur') {
      blurPtsRef.current.push(pos)
      // Show a soft blue tint preview over brushed area
      octx.clearRect(0, 0, overlay.width, overlay.height)
      blurPtsRef.current.forEach(pt => {
        octx.beginPath(); octx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2)
        octx.fillStyle = 'rgba(100,160,255,0.12)'; octx.fill()
      })
    } else if (tool === 'crop' || tool === 'shape') {
      const sp = startPtRef.current; if (!sp) return
      octx.clearRect(0, 0, overlay.width, overlay.height)
      const x = Math.min(sp.x, pos.x), y = Math.min(sp.y, pos.y)
      const w = Math.abs(pos.x - sp.x),   h = Math.abs(pos.y - sp.y)

      if (tool === 'crop') {
        octx.fillStyle = 'rgba(0,0,0,0.5)'; octx.fillRect(0, 0, overlay.width, overlay.height)
        octx.clearRect(x, y, w, h)
        octx.strokeStyle = 'rgba(255,255,255,0.85)'; octx.lineWidth = 1.5
        octx.strokeRect(x, y, w, h)
        cropRectRef.current = { x, y, w, h }
      } else {
        octx.fillStyle = shapeColor; octx.strokeStyle = shapeColor; octx.lineWidth = 2.5
        if (shapeKind === 'rect') {
          shapeFill ? octx.fillRect(x, y, w, h) : octx.strokeRect(x, y, w, h)
        } else {
          octx.beginPath(); octx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
          shapeFill ? octx.fill() : octx.stroke()
        }
      }
    }
    lastPtRef.current = pos
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    if (tool === 'draw' || tool === 'erase') {
      pushHistory()
    } else if (tool === 'blur') {
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      // Render a blurred copy of the canvas, clip to brushed path, composite back
      const off = document.createElement('canvas')
      off.width = canvas.width; off.height = canvas.height
      const offCtx = off.getContext('2d')!
      offCtx.filter = `blur(${blurRadius}px)`
      offCtx.drawImage(canvas, 0, 0)
      ctx.save()
      ctx.beginPath()
      blurPtsRef.current.forEach(pt => { ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2) })
      ctx.clip(); ctx.drawImage(off, 0, 0); ctx.restore()
      clearOverlay(); blurPtsRef.current = []
      pushHistory()
    } else if (tool === 'shape') {
      // Commit shape overlay to main canvas
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(overlayRef.current!, 0, 0)
      clearOverlay(); pushHistory()
    } else if (tool === 'crop') {
      const r = cropRectRef.current
      setHasCropSel(!!(r && r.w > 2 && r.h > 2))
    }
  }

  const applyCrop = () => {
    const r = cropRectRef.current; if (!r || r.w < 2 || r.h < 2) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const data = ctx.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))
    canvas.width = Math.round(r.w); canvas.height = Math.round(r.h)
    const overlay = overlayRef.current!
    overlay.width = canvas.width; overlay.height = canvas.height
    ctx.putImageData(data, 0, 0)
    clearOverlay(); cropRectRef.current = null; setHasCropSel(false)
    pushHistory()
  }

  const applyEdit = () => {
    const canvas = canvasRef.current!
    // Export as JPEG with white background
    const exp = document.createElement('canvas')
    exp.width = canvas.width; exp.height = canvas.height
    const ectx = exp.getContext('2d')!
    ectx.fillStyle = '#ffffff'; ectx.fillRect(0, 0, exp.width, exp.height)
    ectx.drawImage(canvas, 0, 0)
    onApply(exp.toDataURL('image/jpeg', 0.92))
  }

  const toolBtn = (t: EditorTool, icon: React.ReactNode, label: string) => (
    <button
      key={t}
      onClick={() => { setTool(t); clearOverlay(); setHasCropSel(false) }}
      title={label}
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-[10px] font-medium transition-all ${
        tool === t
          ? 'bg-white/[0.12] text-white'
          : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-[#0a0d14] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[95vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] shrink-0">
          <span className="text-sm font-semibold text-white">Edit Reference</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] shrink-0">
          {toolBtn('draw',  <Pencil  size={15} />, 'Draw')}
          {toolBtn('erase', <Eraser  size={15} />, 'Erase')}
          {toolBtn('blur',  <Droplets size={15} />, 'Blur')}
          {toolBtn('shape', <Square  size={15} />, 'Shape')}
          {toolBtn('crop',  <Crop    size={15} />, 'Crop')}
        </div>

        {/* Tool options */}
        <div className="flex items-center gap-4 px-5 py-2 border-b border-white/[0.06] shrink-0 min-h-[44px]">
          {(tool === 'draw' || tool === 'erase') && (
            <>
              {tool === 'draw' && (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  Color
                  <input type="color" value={drawColor} onChange={e => setDrawColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                </label>
              )}
              <label className="flex items-center gap-2 text-[11px] text-slate-400 flex-1">
                Size <span className="text-slate-300 w-7 text-center">{brushSize}</span>
                <input type="range" min={4} max={80} value={brushSize} onChange={e => setBrushSize(+e.target.value)}
                  className="flex-1 accent-cyan-400" />
              </label>
            </>
          )}
          {tool === 'blur' && (
            <>
              <label className="flex items-center gap-2 text-[11px] text-slate-400 flex-1">
                Intensity <span className="text-slate-300 w-7 text-center">{blurRadius}</span>
                <input type="range" min={2} max={30} value={blurRadius} onChange={e => setBlurRadius(+e.target.value)}
                  className="flex-1 accent-cyan-400" />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-400 flex-1">
                Brush <span className="text-slate-300 w-7 text-center">{brushSize}</span>
                <input type="range" min={10} max={120} value={brushSize} onChange={e => setBrushSize(+e.target.value)}
                  className="flex-1 accent-cyan-400" />
              </label>
            </>
          )}
          {tool === 'shape' && (
            <>
              <div className="flex gap-1">
                {(['rect', 'circle'] as ShapeKind[]).map(k => (
                  <button key={k} onClick={() => setShapeKind(k)}
                    className={`p-1.5 rounded-lg transition-colors ${shapeKind === k ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {k === 'rect' ? <Square size={14} /> : <Circle size={14} />}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Color
                <input type="color" value={shapeColor} onChange={e => setShapeColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
              </label>
              <button onClick={() => setShapeFill(f => !f)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${shapeFill ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>
                {shapeFill ? 'Filled' : 'Outline'}
              </button>
            </>
          )}
          {tool === 'crop' && (
            <span className="text-[11px] text-slate-500">Drag to select crop area</span>
          )}
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-black/20">
          {!loaded ? (
            <div className="flex items-center gap-2 text-slate-600 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="relative inline-block rounded-lg overflow-hidden shadow-xl">
              <canvas ref={canvasRef} className="block max-w-full"
                style={{ cursor: tool === 'crop' ? 'crosshair' : tool === 'shape' ? 'crosshair' : 'cell', touchAction: 'none' }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
              <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none block" />
            </div>
          )}
        </div>

        {/* Crop apply banner */}
        {hasCropSel && (
          <div className="flex items-center justify-center gap-3 px-5 py-2 bg-amber-500/10 border-t border-amber-500/20 shrink-0">
            <span className="text-[11px] text-amber-300">Crop selection ready</span>
            <button onClick={applyCrop}
              className="text-[11px] px-3 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors">
              Apply Crop
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={histLen <= 1}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <Undo2 size={13} /> Undo
            </button>
            <button onClick={reset} disabled={histLen <= 1}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <RotateCcw size={13} /> Reset
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="text-[11px] px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all">
              Cancel
            </button>
            <button onClick={applyEdit}
              className="text-[11px] px-4 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition-all font-medium">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Builds a full-size mask canvas from a crop-sized mask + its position in the original image.
// The returned data URL has white only where the lasso region was, black everywhere else.
function buildFullSizeMask(
  cropMaskB64: string,
  cropX: number, cropY: number, cropW: number, cropH: number,
  fullW: number, fullH: number,
): Promise<string> {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width = fullW; canvas.height = fullH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, fullW, fullH)
    const img = document.createElement('img')
    img.onload = () => { ctx.drawImage(img, cropX, cropY, cropW, cropH); resolve(canvas.toDataURL('image/png')) }
    img.src = cropMaskB64
  })
}

// --- STENCIL MODAL ---
type StencilMode = 'crop' | 'inpaint'
type StencilSelMode = 'rect' | 'lasso'
type InpaintJobMeta = {
  image:  string   // base64 JPEG crop for this shape
  mask:   string   // base64 PNG mask (white = regenerate)
  cropX:  number   // rx — left edge of padded crop in original image pixels
  cropY:  number   // ry — top edge
  cropW:  number   // rw — width of padded crop in original pixels
  cropH:  number   // rh — height of padded crop in original pixels
  prompt: string   // per-shape content description (prepended to base prompt; empty = base only)
}
type StencilResult =
  | { mode: 'crop'; image: string }
  | { mode: 'inpaint'; image: string; mask: string }
  | { mode: 'inpaint-multi'; jobs: InpaintJobMeta[]; originalB64: string; imgW: number; imgH: number }

function StencilModal({
  onClose,
  onApply,
  targetW = 1024,
  targetH = 1024,
}: {
  onClose: () => void
  onApply: (result: StencilResult) => void
  targetW?: number
  targetH?: number
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const srcImgRef    = useRef<HTMLImageElement | null>(null)
  const origB64Ref   = useRef('')   // compressed original image for compositing

  const [imgLoaded, setImgLoaded] = useState(false)
  const [mode, setMode]           = useState<StencilMode>('crop')
  const [selMode, setSelMode]     = useState<StencilSelMode>('rect')
  const [padding, setPadding]     = useState(20)
  const [sel, setSel]             = useState({ x: 0, y: 0, w: 512, h: 512 })
  const [lassoDirty, setLassoDirty] = useState(0) // bumped when a lasso path is completed
  const [perShape, setPerShape]   = useState(false) // run a separate inpaint job per lasso shape

  // Refs readable inside draw / RAF without stale closures
  const selRef     = useRef(sel)
  const selModeRef = useRef<StencilSelMode>('rect')
  const perShapeRef = useRef(false)
  const lassoRef      = useRef<{ x: number; y: number }[]>([])
  const lassoPathsRef = useRef<{ x: number; y: number }[][]>([])
  const lassoDrawingRef = useRef(false)
  const rafRef     = useRef<number | null>(null)
  useEffect(() => { selRef.current = sel }, [sel])
  useEffect(() => { selModeRef.current = selMode }, [selMode])
  useEffect(() => { perShapeRef.current = perShape }, [perShape])

  const dtRef = useRef({ scale: 1, offX: 0, offY: 0, imgW: 0, imgH: 0 })

  type DragOp = 'none' | 'move' | 'new' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
  const dragRef = useRef<{ op: DragOp; cx0: number; cy0: number; sel0: typeof sel }>({
    op: 'none', cx0: 0, cy0: 0, sel0: { x: 0, y: 0, w: 0, h: 0 },
  })
  const HANDLE = 8

  const loadFile = (file: File) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      srcImgRef.current = img
      lassoRef.current = []
      lassoPathsRef.current = []
      setLassoDirty(0)
      // Store a compressed copy (max 1536px) for multi-shape compositing
      const ORIG_MAX = 1536
      const origSc = Math.min(1, ORIG_MAX / img.naturalWidth, ORIG_MAX / img.naturalHeight)
      const oc = document.createElement('canvas')
      oc.width  = Math.round(img.naturalWidth  * origSc)
      oc.height = Math.round(img.naturalHeight * origSc)
      oc.getContext('2d')!.drawImage(img, 0, 0, oc.width, oc.height)
      origB64Ref.current = oc.toDataURL('image/jpeg', 0.92)
      const sw = Math.round(Math.min(img.naturalWidth  * 0.6, 1024))
      const sh = Math.round(Math.min(img.naturalHeight * 0.6, 1024))
      setSel({ x: Math.round((img.naturalWidth - sw) / 2), y: Math.round((img.naturalHeight - sh) / 2), w: sw, h: sh })
      setImgLoaded(true)
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const i2c = (ix: number, iy: number) => {
    const d = dtRef.current
    return { x: d.offX + ix * d.scale, y: d.offY + iy * d.scale }
  }
  const c2i = (cx: number, cy: number) => {
    const d = dtRef.current
    return { x: (cx - d.offX) / d.scale, y: (cy - d.offY) / d.scale }
  }

  // Build a canvas 2D path from lasso points (image coords)
  const buildLassoPath = (ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], close: boolean) => {
    if (pts.length < 2) return
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const { x, y } = i2c(pts[i].x, pts[i].y)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    if (close) ctx.closePath()
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = srcImgRef.current
    if (!canvas || !img) return
    const ctx  = canvas.getContext('2d')!
    const cW   = canvas.width, cH = canvas.height
    const imgW = img.naturalWidth, imgH = img.naturalHeight
    const scale = Math.min(cW / imgW, cH / imgH)
    const offX  = (cW - imgW * scale) / 2
    const offY  = (cH - imgH * scale) / 2
    dtRef.current = { scale, offX, offY, imgW, imgH }

    ctx.clearRect(0, 0, cW, cH)
    ctx.drawImage(img, offX, offY, imgW * scale, imgH * scale)

    const isLasso     = selModeRef.current === 'lasso'
    const pts         = lassoRef.current         // in-progress stroke
    const committed   = lassoPathsRef.current    // completed shapes
    const hasAnyLasso = isLasso && (committed.length > 0 || pts.length > 1)
    const color       = mode === 'inpaint' ? '#f59e0b' : '#38bdf8'

    if (isLasso && hasAnyLasso) {
      // Dark overlay
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, cW, cH)

      // Clip to the union of ALL committed paths + in-progress path, then reveal image inside
      const allForClip = [...committed, ...(pts.length > 1 ? [pts] : [])]
      ctx.save()
      ctx.beginPath()
      for (const path of allForClip) {
        for (let i = 0; i < path.length; i++) {
          const { x, y } = i2c(path[i].x, path[i].y)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
      ctx.clip()
      ctx.drawImage(img, offX, offY, imgW * scale, imgH * scale)
      ctx.restore()

      // Outline each committed shape
      for (const path of committed) {
        if (path.length < 2) continue
        ctx.strokeStyle = color
        ctx.lineWidth   = 1.5
        ctx.setLineDash([5, 3])
        buildLassoPath(ctx, path, true)
        ctx.stroke()
        ctx.setLineDash([])
      }
      // Outline in-progress stroke
      if (pts.length > 1) {
        ctx.strokeStyle = color
        ctx.lineWidth   = 1.5
        ctx.setLineDash([5, 3])
        buildLassoPath(ctx, pts, !lassoDrawingRef.current)
        ctx.stroke()
        ctx.setLineDash([])
        if (lassoDrawingRef.current && pts.length > 2) {
          const first = i2c(pts[0].x, pts[0].y)
          const last  = i2c(pts[pts.length - 1].x, pts[pts.length - 1].y)
          ctx.strokeStyle = 'rgba(245,158,11,0.25)'
          ctx.lineWidth   = 1
          ctx.setLineDash([3, 4])
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(first.x, first.y); ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // Dimension label and padding outline using union bbox of committed paths
      if (committed.length > 0) {
        const allPts = committed.flat()
        const minX = Math.min(...allPts.map(p => p.x)), maxX = Math.max(...allPts.map(p => p.x))
        const minY = Math.min(...allPts.map(p => p.y)), maxY = Math.max(...allPts.map(p => p.y))
        const { x: lx, y: ly } = i2c(minX, minY)
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(lx, ly - 18, 110, 16)
        ctx.fillStyle = color
        ctx.font = '11px monospace'
        ctx.fillText(`${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}`, lx + 4, ly - 5)
        if (mode === 'inpaint' && padding > 0) {
          const pad = padding / 100
          if (perShapeRef.current && committed.length > 1) {
            // Individual context window per shape
            for (const path of committed) {
              const bx = Math.min(...path.map(p => p.x)), bX = Math.max(...path.map(p => p.x))
              const by = Math.min(...path.map(p => p.y)), bY = Math.max(...path.map(p => p.y))
              const bW = bX - bx, bH = bY - by
              const px = Math.max(0, bx - bW * pad), py = Math.max(0, by - bH * pad)
              const pw = Math.min(imgW - px, bW * (1 + 2 * pad)), ph = Math.min(imgH - py, bH * (1 + 2 * pad))
              const { x: cpx, y: cpy } = i2c(px, py)
              ctx.strokeStyle = 'rgba(245,158,11,0.6)'
              ctx.lineWidth = 1; ctx.setLineDash([3, 3])
              ctx.strokeRect(cpx, cpy, pw * scale, ph * scale)
              ctx.setLineDash([])
            }
          } else {
            const bW = maxX - minX, bH = maxY - minY
            const px = Math.max(0, minX - bW * pad), py = Math.max(0, minY - bH * pad)
            const pw = Math.min(imgW - px, bW * (1 + 2 * pad)), ph = Math.min(imgH - py, bH * (1 + 2 * pad))
            const { x: cpx, y: cpy } = i2c(px, py)
            ctx.strokeStyle = 'rgba(245,158,11,0.35)'
            ctx.lineWidth = 1; ctx.setLineDash([3, 3])
            ctx.strokeRect(cpx, cpy, pw * scale, ph * scale)
            ctx.setLineDash([])
          }
        }
      }
    } else if (!isLasso) {
      // Rect mode — existing 4-rect overlay + handles
      const s  = selRef.current
      const sx = offX + s.x * scale, sy = offY + s.y * scale
      const sw = s.w * scale,        sh = s.h * scale

      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, cW, sy)
      ctx.fillRect(0, sy + sh, cW, cH - sy - sh)
      ctx.fillRect(0, sy, sx, sh)
      ctx.fillRect(sx + sw, sy, cW - sx - sw, sh)

      ctx.strokeStyle = color
      ctx.lineWidth   = 1.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])

      const handles: [number, number][] = [
        [sx, sy], [sx + sw / 2, sy], [sx + sw, sy],
        [sx, sy + sh / 2], [sx + sw, sy + sh / 2],
        [sx, sy + sh], [sx + sw / 2, sy + sh], [sx + sw, sy + sh],
      ]
      ctx.fillStyle = color
      for (const [hx, hy] of handles) ctx.fillRect(hx - HANDLE, hy - HANDLE, HANDLE * 2, HANDLE * 2)

      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillRect(sx, sy - 18, 100, 16)
      ctx.fillStyle = color
      ctx.font = '11px monospace'
      ctx.fillText(`${Math.round(s.w)} × ${Math.round(s.h)}`, sx + 4, sy - 5)

      if (mode === 'inpaint' && padding > 0) {
        const pad = padding / 100
        const px = Math.max(0, s.x - s.w * pad), py = Math.max(0, s.y - s.h * pad)
        const pw = Math.min(imgW - px, s.w * (1 + 2 * pad)), ph = Math.min(imgH - py, s.h * (1 + 2 * pad))
        const { x: cpx, y: cpy } = i2c(px, py)
        ctx.strokeStyle = 'rgba(245,158,11,0.4)'
        ctx.lineWidth = 1; ctx.setLineDash([3, 3])
        ctx.strokeRect(cpx, cpy, pw * scale, ph * scale)
        ctx.setLineDash([])
      }
    }
  }, [mode, padding]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !srcImgRef.current) return
    const img  = srcImgRef.current
    const maxW = canvas.parentElement?.clientWidth ?? 600
    const maxH = Math.floor(window.innerHeight * 0.55)
    const sc   = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    canvas.width  = Math.round(img.naturalWidth  * sc)
    canvas.height = Math.round(img.naturalHeight * sc)
    draw()
  }, [imgLoaded, draw])

  useEffect(() => { if (imgLoaded) draw() }, [sel, selMode, lassoDirty, imgLoaded, draw, perShape])

  const getHandle = (cx: number, cy: number): DragOp => {
    const s = selRef.current
    const d = dtRef.current
    const sx = d.offX + s.x * d.scale, sy = d.offY + s.y * d.scale
    const sw = s.w * d.scale,          sh = s.h * d.scale
    const near = (a: number, b: number) => Math.abs(a - b) <= HANDLE + 2
    if (near(cx, sx) && near(cy, sy))           return 'nw'
    if (near(cx, sx + sw) && near(cy, sy))      return 'ne'
    if (near(cx, sx) && near(cy, sy + sh))      return 'sw'
    if (near(cx, sx + sw) && near(cy, sy + sh)) return 'se'
    if (near(cx, sx + sw / 2) && near(cy, sy))  return 'n'
    if (near(cx, sx + sw / 2) && near(cy, sy + sh)) return 's'
    if (near(cx, sx) && near(cy, sy + sh / 2))  return 'w'
    if (near(cx, sx + sw) && near(cy, sy + sh / 2)) return 'e'
    if (cx > sx && cx < sx + sw && cy > sy && cy < sy + sh) return 'move'
    return 'none'
  }

  const getCanvasXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return {
      cx: (e.clientX - r.left) * (canvas.width / r.width),
      cy: (e.clientY - r.top)  * (canvas.height / r.height),
    }
  }

  const scheduleDraw = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw() })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current!.setPointerCapture(e.pointerId)
    const { cx, cy } = getCanvasXY(e)

    if (selModeRef.current === 'lasso') {
      const pt = c2i(cx, cy)
      lassoRef.current = [{ x: Math.round(pt.x), y: Math.round(pt.y) }]
      lassoDrawingRef.current = true
      draw()
      return
    }

    const op = getHandle(cx, cy)
    dragRef.current = { op: op === 'none' ? 'new' : op, cx0: cx, cy0: cy, sel0: { ...selRef.current } }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (selModeRef.current === 'lasso') {
      if (!lassoDrawingRef.current) return
      const { cx, cy } = getCanvasXY(e)
      const pt = c2i(cx, cy)
      const last = lassoRef.current[lassoRef.current.length - 1]
      // Min distance in image px to avoid redundant points (improves perf + mask quality)
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return
      lassoRef.current.push({ x: Math.round(pt.x), y: Math.round(pt.y) })
      scheduleDraw()
      return
    }

    const d = dragRef.current
    if (d.op === 'none') return
    const { cx, cy } = getCanvasXY(e)
    const dt = dtRef.current
    const { imgW, imgH, scale } = dt
    const dx = (cx - d.cx0) / scale, dy = (cy - d.cy0) / scale
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const s0 = d.sel0
    const MIN = 32

    if (d.op === 'new') {
      const { x: ix, y: iy }   = c2i(cx, cy)
      const { x: ix0, y: iy0 } = c2i(d.cx0, d.cy0)
      setSel({
        x: Math.round(clamp(Math.min(ix, ix0), 0, imgW)),
        y: Math.round(clamp(Math.min(iy, iy0), 0, imgH)),
        w: Math.round(clamp(Math.abs(ix - ix0), MIN, imgW)),
        h: Math.round(clamp(Math.abs(iy - iy0), MIN, imgH)),
      })
      return
    }
    if (d.op === 'move') {
      setSel({ ...s0, x: Math.round(clamp(s0.x + dx, 0, imgW - s0.w)), y: Math.round(clamp(s0.y + dy, 0, imgH - s0.h)) })
      return
    }
    let { x, y, w, h } = s0
    if (d.op === 'nw' || d.op === 'w' || d.op === 'sw') { const nx = clamp(x + dx, 0, x + w - MIN); w -= nx - x; x = nx }
    if (d.op === 'ne' || d.op === 'e' || d.op === 'se') { w = clamp(w + dx, MIN, imgW - x) }
    if (d.op === 'nw' || d.op === 'n' || d.op === 'ne') { const ny = clamp(y + dy, 0, y + h - MIN); h -= ny - y; y = ny }
    if (d.op === 'sw' || d.op === 's' || d.op === 'se') { h = clamp(h + dy, MIN, imgH - y) }
    setSel({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
  }

  const onPointerUp = () => {
    if (selModeRef.current === 'lasso' && lassoDrawingRef.current) {
      lassoDrawingRef.current = false
      const pts = lassoRef.current
      if (pts.length > 2) {
        lassoPathsRef.current = [...lassoPathsRef.current, pts]
        lassoRef.current = []
        // sel = union bbox across all committed shapes (used for padding calc)
        const allPts = lassoPathsRef.current.flat()
        const minX = Math.min(...allPts.map(p => p.x)), maxX = Math.max(...allPts.map(p => p.x))
        const minY = Math.min(...allPts.map(p => p.y)), maxY = Math.max(...allPts.map(p => p.y))
        setSel({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })
        setLassoDirty(v => v + 1)
      }
      draw()
      return
    }
    dragRef.current.op = 'none'
  }

  const clearLasso = () => {
    lassoRef.current = []
    lassoPathsRef.current = []
    setLassoDirty(0)
    draw()
  }

  const undoLasso = () => {
    if (lassoPathsRef.current.length === 0) return
    lassoPathsRef.current = lassoPathsRef.current.slice(0, -1)
    if (lassoPathsRef.current.length > 0) {
      const allPts = lassoPathsRef.current.flat()
      const minX = Math.min(...allPts.map(p => p.x)), maxX = Math.max(...allPts.map(p => p.x))
      const minY = Math.min(...allPts.map(p => p.y)), maxY = Math.max(...allPts.map(p => p.y))
      setSel({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })
    }
    setLassoDirty(v => v - 1)
    draw()
  }

  const handleApply = () => {
    const img = srcImgRef.current
    if (!img) return
    const { x, y, w, h } = selRef.current
    const imgW = img.naturalWidth, imgH = img.naturalHeight

    if (mode === 'crop') {
      // Crop always uses rect selection
      const outW = Math.max(8, Math.round(w / 8) * 8)
      const outH = Math.max(8, Math.round(h / 8) * 8)
      const c = document.createElement('canvas')
      c.width = outW; c.height = outH
      c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, outW, outH)
      onApply({ mode: 'crop', image: c.toDataURL('image/jpeg', 0.92) })
      return
    }

    // Inpaint — compute padded region from bounding box (works for both rect and lasso)
    const pad = padding / 100
    const rx   = Math.max(0, x - w * pad), ry = Math.max(0, y - h * pad)
    const rw   = Math.min(imgW - rx, w * (1 + 2 * pad)), rh = Math.min(imgH - ry, h * (1 + 2 * pad))
    const sc   = Math.min(targetW / rw, targetH / rh)
    const outW = Math.max(8, Math.round(rw * sc / 8) * 8)
    const outH = Math.max(8, Math.round(rh * sc / 8) * 8)

    // Source image (the padded region scaled to output dims)
    const ic = document.createElement('canvas')
    ic.width = outW; ic.height = outH
    const ictx = ic.getContext('2d')!
    ictx.fillStyle = '#808080'; ictx.fillRect(0, 0, outW, outH)
    ictx.drawImage(img, rx, ry, rw, rh, 0, 0, outW, outH)

    // Mask canvas — white = regenerate, black = keep
    const mc = document.createElement('canvas')
    mc.width = outW; mc.height = outH
    const mctx = mc.getContext('2d')!
    mctx.fillStyle = 'black'; mctx.fillRect(0, 0, outW, outH)
    mctx.fillStyle = 'white'

    // Per-shape mode: generate a separate crop+mask per committed lasso path
    if (perShapeRef.current && selModeRef.current === 'lasso' && lassoPathsRef.current.length > 1) {
      const jobs: InpaintJobMeta[] = []
      for (const path of lassoPathsRef.current) {
        if (path.length < 3) continue
        const bx = Math.min(...path.map(p => p.x)), bX = Math.max(...path.map(p => p.x))
        const by = Math.min(...path.map(p => p.y)), bY = Math.max(...path.map(p => p.y))
        const bw = bX - bx, bh = bY - by
        const pad = padding / 100
        const jrx = Math.max(0, bx - bw * pad), jry = Math.max(0, by - bh * pad)
        const jrw = Math.min(imgW - jrx, bw * (1 + 2 * pad)), jrh = Math.min(imgH - jry, bh * (1 + 2 * pad))
        const jsc = Math.min(targetW / jrw, targetH / jrh)
        const jW  = Math.max(8, Math.round(jrw * jsc / 8) * 8)
        const jH  = Math.max(8, Math.round(jrh * jsc / 8) * 8)
        const jic = document.createElement('canvas')
        jic.width = jW; jic.height = jH
        const jictx = jic.getContext('2d')!
        jictx.fillStyle = '#808080'; jictx.fillRect(0, 0, jW, jH)
        jictx.drawImage(img, jrx, jry, jrw, jrh, 0, 0, jW, jH)
        const jmc = document.createElement('canvas')
        jmc.width = jW; jmc.height = jH
        const jmctx = jmc.getContext('2d')!
        jmctx.fillStyle = 'black'; jmctx.fillRect(0, 0, jW, jH)
        jmctx.fillStyle = 'white'
        jmctx.beginPath()
        for (let i = 0; i < path.length; i++) {
          const mx = (path[i].x - jrx) * jsc
          const my = (path[i].y - jry) * jsc
          if (i === 0) jmctx.moveTo(mx, my)
          else jmctx.lineTo(mx, my)
        }
        jmctx.closePath(); jmctx.fill()
        jobs.push({ image: jic.toDataURL('image/jpeg', 0.92), mask: jmc.toDataURL('image/png'), cropX: jrx, cropY: jry, cropW: jrw, cropH: jrh, prompt: '' })
      }
      onApply({ mode: 'inpaint-multi', jobs, originalB64: origB64Ref.current, imgW, imgH })
      return
    }

    if (selModeRef.current === 'lasso' && lassoPathsRef.current.length > 0) {
      // Fill each committed lasso shape onto the mask
      for (const path of lassoPathsRef.current) {
        if (path.length < 3) continue
        mctx.beginPath()
        for (let i = 0; i < path.length; i++) {
          const mx = (path[i].x - rx) * sc
          const my = (path[i].y - ry) * sc
          if (i === 0) mctx.moveTo(mx, my)
          else mctx.lineTo(mx, my)
        }
        mctx.closePath()
        mctx.fill()
      }
    } else {
      // Rectangle mask
      mctx.fillRect(Math.floor((x - rx) * sc), Math.floor((y - ry) * sc), Math.ceil(w * sc), Math.ceil(h * sc))
    }

    // Always emit inpaint-multi (even for a single shape) so the client composites
    // the result back onto the original image at the correct crop position.
    onApply({
      mode: 'inpaint-multi',
      jobs: [{ image: ic.toDataURL('image/jpeg', 0.92), mask: mc.toDataURL('image/png'), cropX: rx, cropY: ry, cropW: rw, cropH: rh, prompt: '' }],
      originalB64: origB64Ref.current,
      imgW,
      imgH,
    })
  }

  const canApply = imgLoaded && (mode === 'crop' || selMode === 'rect' || lassoDirty > 0)

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-[#0a0d14] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-white">Stencil</span>
            {/* Crop / Inpaint */}
            <div className="flex rounded-md overflow-hidden border border-white/10">
              {(['crop', 'inpaint'] as StencilMode[]).map(m => (
                <button key={m} onClick={() => { setMode(m); if (m === 'crop') setSelMode('rect') }}
                  className={`px-3 py-1 text-[11px] font-medium transition-colors ${mode === m ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                  {m === 'crop' ? '✂ Crop' : '◻ Inpaint'}
                </button>
              ))}
            </div>
            {/* Rect / Lasso — only in inpaint mode */}
            {mode === 'inpaint' && (
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(['rect', 'lasso'] as StencilSelMode[]).map(sm => (
                  <button key={sm}
                    onClick={() => { setSelMode(sm); lassoRef.current = []; lassoPathsRef.current = []; setLassoDirty(0); draw() }}
                    className={`px-3 py-1 text-[11px] font-medium transition-colors ${selMode === sm ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}>
                    {sm === 'rect' ? '▭ Rect' : '✏ Lasso'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors shrink-0 ml-2"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {!imgLoaded ? (
            <div onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 h-48 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-white/20 transition-colors">
              <Upload size={24} className="text-slate-600" />
              <span className="text-sm text-slate-500">Click to load image</span>
              <span className="text-[10px] text-slate-700">Any size — canvas scales to fit</span>
            </div>
          ) : (
            <div className="relative w-full rounded-xl overflow-hidden border border-white/10 bg-black/30 cursor-crosshair select-none flex items-center justify-center">
              <canvas ref={canvasRef} className="block max-w-full" style={{ touchAction: 'none' }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              {imgLoaded && lassoDirty > 0 && (
                <span className="text-[11px] font-mono text-slate-500">{sel.w} × {sel.h} px</span>
              )}
              {imgLoaded && selMode === 'rect' && (
                <span className="text-[11px] font-mono text-slate-500">{sel.w} × {sel.h} px</span>
              )}
              {mode === 'inpaint' && imgLoaded && (
                <label className="flex items-center gap-1.5 text-[11px] text-amber-400/70">
                  Context
                  <input type="range" min={0} max={80} step={5} value={padding}
                    onChange={e => setPadding(+e.target.value)} className="w-20 accent-amber-400" />
                  {padding}%
                </label>
              )}
              {mode === 'inpaint' && selMode === 'lasso' && lassoDirty > 1 && (
                <label className="flex items-center gap-1.5 text-[11px] text-amber-400/70 cursor-pointer select-none">
                  <input type="checkbox" checked={perShape} onChange={e => setPerShape(e.target.checked)}
                    className="accent-amber-400" />
                  Per-shape context
                  <span className="text-slate-600">({lassoDirty} jobs)</span>
                </label>
              )}
              {selMode === 'lasso' && lassoDirty > 0 && (
                <span className="text-[11px] text-amber-400/60">{lassoDirty} shape{lassoDirty !== 1 ? 's' : ''}</span>
              )}
              {selMode === 'lasso' && lassoDirty > 1 && (
                <button onClick={undoLasso}
                  className="text-[10px] text-slate-600 hover:text-amber-400 transition-colors">
                  ↩ Undo last
                </button>
              )}
              {selMode === 'lasso' && lassoDirty > 0 && (
                <button onClick={clearLasso}
                  className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">
                  ✕ Clear all
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {imgLoaded && (
                <button onClick={() => { setImgLoaded(false); srcImgRef.current = null; lassoRef.current = []; setLassoDirty(0) }}
                  className="px-3 py-1.5 text-[11px] rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white transition-all">
                  Change image
                </button>
              )}
              <button onClick={handleApply} disabled={!canApply}
                className={`px-4 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${canApply
                  ? mode === 'crop' ? 'bg-sky-500 hover:bg-sky-400 text-black' : 'bg-amber-500 hover:bg-amber-400 text-black'
                  : 'bg-white/5 text-slate-600 cursor-not-allowed border border-white/10'}`}>
                {mode === 'crop' ? '✂ Cut' : '◻ Apply Mask'}
              </button>
            </div>
          </div>

          <p className="text-[10px] text-slate-600">
            {mode === 'crop'
              ? 'Crop: the selected region is extracted and used as the img2img source. Drag the box or pull handles to adjust.'
              : selMode === 'lasso'
                ? 'Lasso: hold and drag to trace any shape — a silhouette, a face, an object. Release to close the path. FLUX regenerates only the traced region.'
                : 'Rect: FLUX regenerates only the bright selected rectangle. The padded context area helps with blending at the edges.'}
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

// --- CUSTOM FLUX LORA PANEL ---

type FluxLoraEntry = { id: string; name: string; key: string; strength: number }
type FluxMode = 'local' | 'runpod'

function CustomFluxPanel({
  onAddPending,
  onUpdatePending,
  onRemovePending,
  onStartNb2Polling,
  onPrependImage,
  activeRefImages = [],
  promptOverride,
}: {
  onAddPending:      (slot: PendingSlot) => void
  onUpdatePending:   (slotId: string, update: Partial<PendingSlot>) => void
  onRemovePending:   (slotId: string) => void
  onStartNb2Polling: (requestId: string, falEndpoint: string, slotIds: string[], prompt: string, outputFormat: string, aspectRatio: string, statusUrl?: string, quality?: string, ticketCost?: number, referenceImageUrls?: string[], videoMetadata?: Record<string, unknown>) => void
  onPrependImage:    (img: ImageItem) => void
  activeRefImages?:  RefImage[]
  promptOverride?:   { text: string; version: number }
}) {
  const [mode, setMode]               = useState<FluxMode>('runpod')
  const [checkpoint, setCheckpoint]   = useState('')
  const isFluxFill = /fill/i.test(checkpoint)
  const [loras, setLoras]             = useState<FluxLoraEntry[]>([{ id: `lora-${Date.now()}`, name: '', key: '', strength: 1.0 }])
  const [prompt, setPrompt]           = useState('')
  const _promptOverrideVersion = promptOverride?.version ?? 0
  useEffect(() => {
    if (_promptOverrideVersion > 0 && promptOverride?.text) setPrompt(promptOverride.text)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_promptOverrideVersion])
  const [steps, setSteps]             = useState(20)
  const [guidance, setGuidance]       = useState(3.5)
  const [seed, setSeed]               = useState(-1)
  const [width, setWidth]             = useState(1024)
  const [height, setHeight]           = useState(1024)
  const [generating, setGenerating]   = useState(false)
  const [jobId, setJobId]             = useState<string | null>(null)
  const [resultUrl, setResultUrl]     = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [status, setStatus]           = useState('')
  // Post-processing
  const [refine, setRefine]                     = useState(false)
  const [refineStrength, setRefineStrength]     = useState(0.3)
  // Upscaling
  const [upscaleEnabled, setUpscaleEnabled]     = useState(false)
  const [upscaleMethod, setUpscaleMethod]       = useState<'flux'|'esrgan'|'combo'|'pipeline'>('esrgan')
  const [upscaleScale, setUpscaleScale]         = useState<2|4>(2)
  const [fluxTarget,   setFluxTarget]           = useState<'2k'|'4k'|'5k'|'6k'|'8k'>('2k')
  const [esrganModel, setEsrganModel]           = useState<'ultrasharp'|'x4plus'>('ultrasharp')
  const [comboOrder, setComboOrder]             = useState<'flux-first'|'esrgan-first'>('flux-first')
  const [fluxTileStrength, setFluxTileStrength] = useState(0.3)
  // Custom pipeline steps
  type PipelineStep = { type: 'flux' | 'esrgan'; upscaleFactor?: 1|2|3|4; strength?: number; model?: string; targetPx?: number }
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([
    { type: 'flux',   upscaleFactor: 2, strength: 0.35 },
    { type: 'esrgan', model: 'ultrasharp', targetPx: 4096 },
  ])
  const updatePipelineStep = (i: number, patch: Partial<PipelineStep>) =>
    setPipelineSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const removePipelineStep = (i: number) =>
    setPipelineSteps(prev => prev.filter((_, idx) => idx !== i))
  const addPipelineStep = (type: 'flux' | 'esrgan') =>
    setPipelineSteps(prev => prev.length < 10
      ? [...prev, type === 'flux'
          ? { type: 'flux',   upscaleFactor: 2, strength: 0.35 }
          : { type: 'esrgan', model: 'ultrasharp', targetPx: 4096 }]
      : prev)
  // Post-processing
  const [adetailer, setAdetailer]               = useState(false)
  const [adetailerStrength, setAdetailerStrength] = useState(0.35)
  const [gfpgan, setGfpgan]                     = useState(false)
  const [gfpganWeight, setGfpganWeight]         = useState(0.8)
  const [ipAdapter, setIpAdapter]               = useState(false)
  const [ipScale, setIpScale]                   = useState(0.6)
  const [img2img, setImg2img]                   = useState(false)
  const [img2imgStrength, setImg2imgStrength]   = useState(0.65)
  // Stencil / inpaint
  const [stencilOpen,       setStencilOpen]       = useState(false)
  const [stencilCropB64,    setStencilCropB64]    = useState('')
  const [inpaintMode,       setInpaintMode]       = useState(false)
  const [inpaintImageB64,   setInpaintImageB64]   = useState('')
  const [inpaintMaskB64,    setInpaintMaskB64]    = useState('')
  const [inpaintStrength,   setInpaintStrength]   = useState(0.85)
  // Multi-shape inpaint queue (per-shape context mode)
  const [inpaintJobs,       setInpaintJobs]       = useState<InpaintJobMeta[] | null>(null)
  const [inpaintOriginalB64, setInpaintOriginalB64] = useState('')
  const [inpaintImgDims,    setInpaintImgDims]    = useState<{ w: number; h: number } | null>(null)
  const updateJobPrompt = (i: number, text: string) =>
    setInpaintJobs(prev => prev ? prev.map((j, idx) => idx === i ? { ...j, prompt: text } : j) : prev)
  // ControlNet — up to 3 conditions, each with own mode/scale/image
  const [controlnet, setControlnet]   = useState(false)
  const [cnConditions, setCnConditions] = useState<CNCondition[]>([
    { id: 'cn-0', mode: 'pose', scale: 0.35, mirror: false, imgB64: '', preview: '' },
  ])
  const cnRefsMap = useRef<Record<string, HTMLInputElement | null>>({})
  const updateCn  = useCallback((id: string, patch: Partial<CNCondition>) =>
    setCnConditions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)), [])
  const removeCn  = (id: string) =>
    setCnConditions(prev => prev.filter(c => c.id !== id))
  const addCn     = () => {
    if (cnConditions.length >= 3) return
    const modes: Array<'pose' | 'depth' | 'canny'> = ['pose', 'depth', 'canny']
    const used = cnConditions.map(c => c.mode)
    const next  = modes.find(m => !used.includes(m)) ?? 'pose'
    setCnConditions(prev => [...prev, { id: `cn-${Date.now()}`, mode: next, scale: 0.35, mirror: false, imgB64: '', preview: '' }])
  }
  const [autoBaseDims, setAutoBaseDims]         = useState<{ w: number; h: number } | null>(null)

  // Derived upscale param sent to the API
  const upscaleParam = !upscaleEnabled ? 'none'
    : upscaleMethod === 'flux'     ? fluxTarget
    : upscaleMethod === 'esrgan'   ? (upscaleScale === 2 ? '2k-esrgan' : '4k-esrgan')
    : upscaleMethod === 'pipeline' ? 'pipeline'
    : 'combo'

  // Auto-detect aspect ratio from first active ref image (always, not just when img2img is on)
  const firstRefId  = activeRefImages[0]?.id  ?? ''
  const firstRefUrl = activeRefImages[0]?.url ?? ''
  useEffect(() => {
    if (!firstRefId || !firstRefUrl) { setAutoBaseDims(null); return }
    const imgEl = new window.Image()
    imgEl.onload = () => {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) return
      const dims = calcImg2ImgDims(imgEl.naturalWidth, imgEl.naturalHeight)
      setAutoBaseDims(dims)
      setWidth(dims.w)
      setHeight(dims.h)
    }
    imgEl.onerror = () => setAutoBaseDims(null)
    imgEl.src = firstRefUrl
  }, [firstRefId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Available models
  const [comfyCheckpoints, setComfyCheckpoints] = useState<string[]>([])
  const [comfyLoras, setComfyLoras]             = useState<string[]>([])
  const [r2Checkpoints, setR2Checkpoints]       = useState<Array<{key:string;name:string}>>([])
  const [r2Loras, setR2Loras]                   = useState<Array<{key:string;name:string}>>([])
  const [modelsLoaded, setModelsLoaded]         = useState(false)

  const [modelsError, setModelsError] = useState<string | null>(null)

  // Custom ESRGAN models in R2 (for pipeline steps)
  const [r2EsrganModels, setR2EsrganModels] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/admin/flux-inference/esrgan-models')
      .then(r => r.json())
      .then((d: { models: string[] }) => setR2EsrganModels(d.models ?? []))
      .catch(() => {})
  }, [])

  const refreshModels = useCallback(() => {
    setModelsLoaded(false)
    setModelsError(null)
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 12000)
    fetch('/api/admin/flux-inference/models', { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { comfy: { checkpoints: string[]; loras: string[] }; r2: { checkpoints: Array<{key:string;name:string}>; loras: Array<{key:string;name:string}>; missingEnv?: string[] } }) => {
        setComfyCheckpoints(d.comfy?.checkpoints ?? [])
        setComfyLoras(d.comfy?.loras ?? [])
        setR2Checkpoints(d.r2?.checkpoints ?? [])
        setR2Loras(d.r2?.loras ?? [])
        if (d.r2?.missingEnv?.length) setModelsError(`Missing env: ${d.r2.missingEnv.join(', ')}`)
        setModelsLoaded(true)
      })
      .catch((e: unknown) => {
        setModelsError(e instanceof Error && e.name === 'AbortError' ? 'Request timed out' : String(e))
        setModelsLoaded(true)
      })
      .finally(() => clearTimeout(tid))
  }, [])

  // Load available models on mount
  useEffect(() => { refreshModels() }, [refreshModels])

  // RunPod polling is handled by the parent via onStartNb2Polling

  const [loraUploading, setLoraUploading] = useState(false)
  const [loraUploadProgress, setLoraUploadProgress] = useState(0)
  const loraFileInputRef = useRef<HTMLInputElement>(null)

  const addLora = () => {
    setLoras(prev => [...prev, { id: `lora-${Date.now()}`, name: '', key: '', strength: 1.0 }])
  }
  const removeLora = (id: string) => setLoras(prev => prev.filter(l => l.id !== id))
  const updateLora = (id: string, patch: Partial<FluxLoraEntry>) =>
    setLoras(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))

  const handleLoraUpload = async (file: File) => {
    setLoraUploading(true)
    setLoraUploadProgress(0)
    const pass = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('admin-password') ?? '') : ''
    const uploadAuthHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) }
    try {
      // Get presigned URL
      const presignRes = await fetch('/api/admin/onetrainer/cloud/upload', {
        method: 'POST',
        headers: uploadAuthHeaders,
        body: JSON.stringify({ type: 'lora', filename: file.name, contentType: 'application/octet-stream' }),
      })
      if (!presignRes.ok) { setError('Failed to get upload URL'); return }
      const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }

      // Upload directly to R2
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.upload.onprogress = e => { if (e.lengthComputable) setLoraUploadProgress(Math.round(e.loaded / e.total * 100)) }
        xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`))
        xhr.onerror = () => reject(new Error('Upload error'))
        xhr.send(file)
      })

      // Fill first empty slot, or append if all slots are filled
      setLoras(prev => {
        const emptyIdx = prev.findIndex(l => !l.key)
        if (emptyIdx !== -1) {
          const next = [...prev]
          next[emptyIdx] = { ...next[emptyIdx], name: file.name, key }
          return next
        }
        return [...prev, { id: `lora-${Date.now()}`, name: file.name, key, strength: 1.0 }]
      })
      refreshModels()
    } catch (e) {
      setError(`LoRA upload failed: ${String(e)}`)
    } finally {
      setLoraUploading(false)
      setLoraUploadProgress(0)
    }
  }

  const checkpoints = mode === 'local' ? comfyCheckpoints.map(n => ({ key: n, name: n })) : r2Checkpoints
  const loraOptions = mode === 'local' ? comfyLoras.map(n => ({ key: n, name: n }))     : r2Loras

  const canGenerate = !generating && !!checkpoint && prompt.trim().length > 0

  const handleStencilApply = useCallback((result: StencilResult) => {
    setStencilOpen(false)
    if (result.mode === 'crop') {
      setStencilCropB64(result.image)
      setInpaintMode(false); setInpaintImageB64(''); setInpaintMaskB64('')
      setInpaintJobs(null); setInpaintOriginalB64(''); setInpaintImgDims(null)
      setImg2img(true)
    } else if (result.mode === 'inpaint-multi') {
      setInpaintMode(true)
      setInpaintJobs(result.jobs)
      setInpaintOriginalB64(result.originalB64)
      setInpaintImgDims({ w: result.imgW, h: result.imgH })
      setInpaintImageB64(result.jobs[0].image)
      setInpaintMaskB64(result.jobs[0].mask)
      setStencilCropB64('')
    } else {
      setInpaintMode(true)
      setInpaintImageB64(result.image)
      setInpaintMaskB64(result.mask)
      setInpaintJobs(null); setInpaintOriginalB64(''); setInpaintImgDims(null)
      setStencilCropB64('')
    }
  }, [])

  const runMultiInpaint = async () => {
    const jobs = inpaintJobs!
    const reqWidth  = autoBaseDims?.w ?? width
    const reqHeight = autoBaseDims?.h ?? height
    const pass = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('admin-password') ?? '') : ''
    const baseBody = {
      mode, prompt: prompt.trim(), checkpoint,
      loras: loras.filter(l => l.key).map(l => ({ name: l.name, key: l.key, r2_key: l.key, strength: l.strength })),
      width: reqWidth, height: reqHeight, steps, guidance,
      seed: seed === -1 ? null : seed,
      refine: mode === 'runpod' ? refine : false, refine_strength: refineStrength,
      upscale: 'none', upscale_strength: fluxTileStrength,
      adetailer: false, adetailer_strength: adetailerStrength,
      gfpgan: false, gfpgan_weight: gfpganWeight,
      ip_adapter_images: [] as string[], ip_adapter_scale: ipScale,
      img2img_image: '', img2img_strength: img2imgStrength,
      controlnet: false, controlnet_conditions: [] as unknown[],
      inpaint_strength: inpaintStrength,
    }

    setGenerating(true); setError(null); setResultUrl(null); setStatus('submitting')

    // ── Single shape: submit then hand off to parent polling (non-blocking) ──
    if (jobs.length === 1) {
      const job = jobs[0]
      const shapePrompt = job.prompt.trim()
      const fullPrompt  = shapePrompt ? `${shapePrompt}, ${baseBody.prompt}` : baseBody.prompt

      // For FluxFill (and standard inpaint), the model needs the full original image so it has
      // surrounding context. Build a full-size mask with the lasso region in white.
      const dims = inpaintImgDims!
      const fullMask = await buildFullSizeMask(job.mask, job.cropX, job.cropY, job.cropW, job.cropH, dims.w, dims.h)
      const fullW = Math.round(dims.w / 8) * 8
      const fullH = Math.round(dims.h / 8) * 8

      const res = await fetch('/api/admin/flux-inference/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) },
        body: JSON.stringify({ ...baseBody, width: fullW, height: fullH, prompt: fullPrompt, inpaint_image: inpaintOriginalB64, inpaint_mask: fullMask, use_flux_fill: isFluxFill }),
      })
      const data = await res.json() as { mode: string; job_id?: string; error?: string }
      if (!res.ok || data.error || !data.job_id) {
        setError(data.error ?? 'Submission failed'); setGenerating(false); setStatus(''); return
      }
      // Add a real pending slot and start parent polling — non-blocking
      const inpaintSlotId = `flux-inpaint-${Date.now()}`
      onAddPending({
        slotId:         inpaintSlotId,
        status:         'loading',
        prompt:         fullPrompt,
        modelId:        'custom-flux-lora',
        nb2RequestId:   data.job_id,
        nb2FalEndpoint: '',
        nb2StatusUrl:   '/api/admin/flux-inference/nb2-status',
      })
      onStartNb2Polling(data.job_id, '', [inpaintSlotId], fullPrompt, 'png', `${fullW}x${fullH}`, '/api/admin/flux-inference/nb2-status', undefined, 0, [], {})
      setGenerating(false); setStatus('')
      return
    }

    // ── Multi-shape: must run sequentially to composite each result ──
    const dims = inpaintImgDims!
    const inpaintSlotId = `inpaint-${Date.now()}`
    onAddPending({ slotId: inpaintSlotId, status: 'loading', prompt: prompt.trim() || 'Inpainting…', modelId: 'custom-flux-lora' })
    let compositeB64 = inpaintOriginalB64
    const compScale = Math.min(1, 1536 / dims.w, 1536 / dims.h)
    const compW = Math.round(dims.w * compScale), compH = Math.round(dims.h * compScale)
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      setStatus(`Inpainting shape ${i + 1} / ${jobs.length}`)
      const shapePrompt = job.prompt.trim()
      const fullPrompt  = shapePrompt ? `${shapePrompt}, ${baseBody.prompt}` : baseBody.prompt
      const res = await fetch('/api/admin/flux-inference/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) },
        body: JSON.stringify({ ...baseBody, prompt: fullPrompt, inpaint_image: job.image, inpaint_mask: job.mask, use_flux_fill: isFluxFill }),
      })
      const data = await res.json() as { mode: string; job_id?: string; error?: string }
      if (!res.ok || data.error || !data.job_id) {
        const errMsg = `Shape ${i + 1}: ${data.error ?? 'Submission failed'}`
        onUpdatePending(inpaintSlotId, { status: 'failed', error: errMsg })
        setError(errMsg); setGenerating(false); return
      }
      let resultUrl: string | null = null
      for (let a = 0; a < 240; a++) {
        await new Promise(r => setTimeout(r, 3000))
        const pr = await fetch('/api/admin/flux-inference/nb2-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: data.job_id }),
        })
        const pd = await pr.json() as { status: string; images?: { url: string }[]; error?: string; notFound?: boolean }
        if (pd.status === 'completed' && pd.images?.[0]?.url) { resultUrl = pd.images[0].url; break }
        if (pd.status === 'failed') {
          const errMsg = `Shape ${i + 1}: ${pd.error ?? 'Job failed'}`
          onUpdatePending(inpaintSlotId, { status: 'failed', error: errMsg })
          setError(errMsg); setGenerating(false); return
        }
      }
      if (!resultUrl) {
        const errMsg = `Shape ${i + 1}: timed out`
        onUpdatePending(inpaintSlotId, { status: 'failed', error: errMsg })
        setError(errMsg); setGenerating(false); return
      }
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(resultUrl)}`
      const blob = await fetch(proxyUrl).then(r => r.blob())
      const blobUrl = URL.createObjectURL(blob)
      await new Promise<void>((resolve, reject) => {
        const baseImg = new window.Image()
        baseImg.onload = () => {
          const c = document.createElement('canvas'); c.width = compW; c.height = compH
          const ctx = c.getContext('2d')!; ctx.drawImage(baseImg, 0, 0)
          const patchImg = new window.Image()
          patchImg.onload = () => {
            const px = Math.round(job.cropX * compScale), py = Math.round(job.cropY * compScale)
            const pw = Math.round(job.cropW * compScale), ph = Math.round(job.cropH * compScale)
            ctx.drawImage(patchImg, px, py, pw, ph)
            compositeB64 = c.toDataURL('image/jpeg', 0.93)
            URL.revokeObjectURL(blobUrl); resolve()
          }
          patchImg.onerror = reject; patchImg.src = blobUrl
        }
        baseImg.onerror = reject; baseImg.src = compositeB64
      })
    }
    const ckptShort = checkpoint.split('/').pop()?.replace(/\.[^.]+$/, '') ?? checkpoint
    onRemovePending(inpaintSlotId)
    setResultUrl(compositeB64)
    onPrependImage({ id: Date.now(), imageUrl: compositeB64, prompt: prompt.trim(), model: 'custom-flux-lora', createdAt: new Date().toISOString(),
      videoMetadata: { fluxCheckpoint: ckptShort, fluxWidth: reqWidth, fluxHeight: reqHeight, fluxSteps: steps, fluxGuidance: guidance, fluxSeed: seed === -1 ? 'random' : seed, fluxLoras: loras.filter(l => l.key).map(l => l.name || l.key.split('/').pop() || ''), fluxInpaintShapes: jobs.length } as Record<string, unknown> })
    setGenerating(false); setStatus('')
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    if (inpaintJobs && inpaintJobs.length >= 1) return runMultiInpaint()
    setGenerating(true)
    setError(null)
    setResultUrl(null)
    setStatus('submitting')

    // Use auto-detected dims from ref image whenever available — ref always sets aspect ratio.
    const reqWidth  = autoBaseDims?.w ?? width
    const reqHeight = autoBaseDims?.h ?? height

    const body = {
      mode,
      prompt:     prompt.trim(),
      checkpoint: mode === 'runpod' ? checkpoint : checkpoint,
      loras:      loras
        .filter(l => l.key)
        .map(l => ({ name: l.name, key: l.key, r2_key: l.key, strength: l.strength })),
      width: reqWidth, height: reqHeight, steps, guidance,
      seed: seed === -1 ? null : seed,
      // Post-processing (RunPod only)
      refine:             mode === 'runpod' ? refine         : false,
      refine_strength:    refineStrength,
      upscale:            mode === 'runpod' ? upscaleParam   : 'none',
      upscale_strength:   fluxTileStrength,
      esrgan_model:       upscaleEnabled ? esrganModel : undefined,
      combo_order:        comboOrder,
      pipeline_steps:     upscaleParam === 'pipeline' ? pipelineSteps.map(s => ({
        type:          s.type,
        upscale_factor: s.upscaleFactor,
        strength:      s.strength,
        model:         s.model,
        target_px:     s.targetPx,
      })) : undefined,
      adetailer:          mode === 'runpod' ? adetailer      : false,
      adetailer_strength: adetailerStrength,
      gfpgan:             mode === 'runpod' ? gfpgan         : false,
      gfpgan_weight:      gfpganWeight,
      ip_adapter_images:  [] as string[],  // filled below
      ip_adapter_scale:   ipScale,
      img2img_image:      '',              // filled below
      img2img_strength:   img2imgStrength,
      inpaint_image:    mode === 'runpod' && inpaintMode ? inpaintImageB64 : '',
      inpaint_mask:     mode === 'runpod' && inpaintMode ? inpaintMaskB64  : '',
      inpaint_strength: inpaintStrength,
      use_flux_fill:    isFluxFill,
      controlnet:            mode === 'runpod' && controlnet && cnConditions.some(c => !!c.imgB64),
      controlnet_conditions: mode === 'runpod' && controlnet
        ? cnConditions.filter(c => !!c.imgB64).map(c => ({ mode: c.mode, scale: c.scale, mirror: c.mirror, image: c.imgB64 }))
        : [],
    }

    // img2img source: encode first active ref at 1024px (higher than IP-Adapter needs for structure preservation)
    if (mode === 'runpod' && !inpaintMode) {
      if (stencilCropB64) {
        body.img2img_image = stencilCropB64
      } else if (img2img && activeRefImages.length > 0) {
        try {
          const ref = activeRefImages[0]
          let encoded: string
          if (ref.file) {
            encoded = await compressFileToDataUrl(ref.file, 1024, 0.92)
          } else if (ref.url.startsWith('data:')) {
            const r = await fetch(ref.url)
            encoded = await compressBlobToDataUrl(await r.blob(), 1024, 0.92)
          } else {
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(ref.url)}`
            const r = await fetch(proxyUrl)
            if (!r.ok) throw new Error(`Failed to load ref image (${r.status})`)
            encoded = await compressBlobToDataUrl(await r.blob(), 1024, 0.92)
          }
          body.img2img_image = encoded
          console.log('[img2img] encoded source image, size:', `${Math.round(encoded.length / 1024)}KB`)
        } catch (e) {
          setError(`img2img: failed to encode source image — ${String(e)}`)
          setGenerating(false)
          return
        }
      }
    }

    // Convert active ref images to base64 (max 512px — keeps payload small for RunPod)
    if (mode === 'runpod' && ipAdapter && activeRefImages.length > 0) {
      try {
        body.ip_adapter_images = await Promise.all(
          activeRefImages.slice(0, 3).map(async ref => {
            // Use File directly if available (avoids CORS, no network round-trip)
            if (ref.file) return compressFileToDataUrl(ref.file, 512, 0.85)
            // Data URL — re-encode at 512px
            if (ref.url.startsWith('data:')) {
              const r = await fetch(ref.url)
              return compressBlobToDataUrl(await r.blob(), 512, 0.85)
            }
            // External / R2 URL — proxy to avoid CORS then compress
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(ref.url)}`
            const r = await fetch(proxyUrl)
            if (!r.ok) throw new Error(`Failed to load ref image (${r.status})`)
            return compressBlobToDataUrl(await r.blob(), 512, 0.85)
          })
        )
        console.log('[ip-adapter] encoded', body.ip_adapter_images.length, 'ref images, sizes:', body.ip_adapter_images.map(s => `${Math.round(s.length / 1024)}KB`))
      } catch (e) {
        setError(`IP-Adapter: failed to encode reference image — ${String(e)}`)
        setGenerating(false)
        return
      }
    }

    try {
      const pass = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('admin-password') ?? '') : ''
      const res  = await fetch('/api/admin/flux-inference/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { mode: string; job_id?: string; image_data_url?: string; error?: string; seed?: number }
      if (!res.ok || data.error) { setError(data.error ?? 'Generation failed'); setGenerating(false); return }

      const ckptShort = checkpoint.split('/').pop()?.replace(/\.[^.]+$/, '') ?? checkpoint
      const fluxMeta: Record<string, unknown> = {
        fluxCheckpoint:   ckptShort,
        fluxWidth:        reqWidth,
        fluxHeight:       reqHeight,
        fluxSteps:        steps,
        fluxGuidance:     guidance,
        fluxSeed:         seed === -1 ? 'random' : seed,
        fluxUpscale:         upscaleParam,
        fluxEsrganModel:     (upscaleParam.includes('esrgan') || upscaleParam === 'combo') ? esrganModel : undefined,
        fluxComboOrder:      upscaleParam === 'combo' ? comboOrder : undefined,
        fluxTileStrength:    upscaleParam !== 'none' && !upscaleParam.endsWith('-esrgan') && upscaleParam !== 'pipeline' ? fluxTileStrength : undefined,
        fluxPipelineSteps:   upscaleParam === 'pipeline' ? pipelineSteps : undefined,
        fluxRefine:       refine || undefined,
        fluxAdetailer:    adetailer || undefined,
        fluxGfpgan:       gfpgan || undefined,
        fluxGfpganWeight: gfpgan ? gfpganWeight : undefined,
        fluxImg2img:      img2img || undefined,
        fluxImg2imgStr:   img2img ? img2imgStrength : undefined,
        fluxLoras:        loras.filter(l => l.key).map(l => l.name || l.key.split('/').pop() || ''),
      }

      if (data.mode === 'local' && data.image_data_url) {
        // Local: show inline and also add to session feed
        setResultUrl(data.image_data_url)
        onPrependImage({ id: Date.now(), imageUrl: data.image_data_url, prompt: prompt.trim(), model: 'custom-flux-lora', createdAt: new Date().toISOString(), videoMetadata: fluxMeta as Record<string, any> })
        setGenerating(false)
      } else if (data.mode === 'runpod' && data.job_id) {
        // RunPod: hand off to parent's polling → image appears in feed when done
        const slotId = `flux-${Date.now()}`
        const slot: PendingSlot = {
          slotId,
          status:         'loading',
          prompt:         prompt.trim(),
          modelId:        'custom-flux-lora',
          nb2RequestId:   data.job_id,
          nb2FalEndpoint: '',
          nb2StatusUrl:   '/api/admin/flux-inference/nb2-status',
        }
        onAddPending(slot)
        // Persist so polling survives a page refresh
        try {
          const stored = JSON.parse(localStorage.getItem('pv2-pending-slots') || '[]')
          stored.unshift(slot)
          localStorage.setItem('pv2-pending-slots', JSON.stringify(stored))
        } catch {}
        onStartNb2Polling(data.job_id, '', [slotId], prompt.trim(), 'png', `${reqWidth}x${reqHeight}`, '/api/admin/flux-inference/nb2-status', undefined, 0, [], fluxMeta)
        setGenerating(false)
        setStatus('')
      }
    } catch (e) {
      setError(String(e))
      setGenerating(false)
    }
  }

  const [configOpen, setConfigOpen]     = useState(false)
  const [loraOpen, setLoraOpen]         = useState(false)
  const [ckptOpen, setCkptOpen]         = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const ckptRef      = useRef<HTMLDivElement>(null)
  const loraRef      = useRef<HTMLDivElement>(null)  // button
  const loraPanelRef = useRef<HTMLDivElement>(null)  // panel

  // Close checkpoint dropdown on outside click; LoRA panel stays open until explicitly closed
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ckptRef.current && !ckptRef.current.contains(e.target as Node)) setCkptOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const checkpointLabel = checkpoint
    ? (checkpoints.find(c => c.key === checkpoint)?.name ?? checkpoint.split('/').pop() ?? checkpoint)
    : 'Checkpoint'
  const activeLoras = loras.filter(l => l.key)

  return (
    <div className="fixed bottom-0 left-0 right-0 px-6 pb-6 pt-3 bg-gradient-to-t from-[#050810] via-[#050810]/80 to-transparent pointer-events-none">
      <div className="max-w-3xl mx-auto pointer-events-auto space-y-2">

        {/* Result image — floats above the card */}
        {resultUrl && (
          <div className="flex items-end gap-3 px-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="Generated" className="rounded-xl max-h-56 border border-white/10 object-contain shadow-2xl" />
            <div className="flex flex-col gap-1.5 pb-1">
              <a href={resultUrl} download="flux-output.png" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:text-white hover:border-white/20 transition-all">
                <Download size={10} /> Save
              </a>
              <button onClick={() => setResultUrl(null)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:text-white hover:border-white/20 transition-all">
                <X size={10} /> Clear
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-[11px] text-red-400">
            <AlertTriangle size={11} className="shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500/60 hover:text-red-400"><X size={10} /></button>
          </div>
        )}

        {/* Download to R2 panel — collapsible */}
        {downloadOpen && <DownloadToR2Panel />}

        {/* Config panel — collapsible */}
        {configOpen && (
          <div className="rounded-xl border border-white/[0.08] bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono text-cyan-400/60 uppercase tracking-widest">Config</span>
              <button onClick={() => { setSteps(20); setGuidance(3.5); setWidth(1024); setHeight(1024); setSeed(-1); setRefineStrength(0.3); setFluxTileStrength(0.3); setAdetailerStrength(0.35); setIpScale(0.6); setGfpganWeight(0.8) }}
                className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors">reset</button>
            </div>
            {[
              { label: 'Steps',    value: steps,    min: 1,   max: 50,   step: 1,    set: setSteps,    fmt: (v: number) => String(v) },
              { label: 'Guidance', value: guidance, min: 0.5, max: 10,   step: 0.5,  set: setGuidance, fmt: (v: number) => v.toFixed(1) },
              { label: 'Width',    value: width,    min: 512, max: 2048, step: 64,   set: setWidth,    fmt: (v: number) => String(v) },
              { label: 'Height',   value: height,   min: 512, max: 2048, step: 64,   set: setHeight,   fmt: (v: number) => String(v) },
            ].map(({ label, value, min, max, step, set, fmt }) => (
              <div key={label} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3">
                <span className={`text-[10px] font-mono ${img2img && autoBaseDims && (label === 'Width' || label === 'Height') ? 'text-indigo-400/80' : 'text-slate-500'}`}>{label}</span>
                <input type="range" min={min} max={max} step={step} value={value}
                  onChange={e => set(parseFloat(e.target.value) as never)}
                  className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{fmt(value)}</span>
              </div>
            ))}
            {img2img && autoBaseDims && (
              <p className="text-[10px] text-indigo-400/50 -mt-1">Width &amp; Height auto-set from reference aspect ratio — drag to override</p>
            )}
            <div className="grid grid-cols-[5rem_1fr] items-center gap-3 pt-0.5">
              <span className="text-[10px] font-mono text-slate-500">Seed</span>
              <input type="number" value={seed === -1 ? '' : seed} placeholder="random"
                onChange={e => setSeed(e.target.value === '' ? -1 : parseInt(e.target.value))}
                className="w-32 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white placeholder-slate-600 focus:outline-none focus:border-white/20" />
            </div>
            {/* Refine + upscale strength — only shown when RunPod mode and relevant toggle is on */}
            {mode === 'runpod' && refine && (
              <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-emerald-400/70">Refine str</span>
                <input type="range" min={0.1} max={0.6} step={0.05} value={refineStrength}
                  onChange={e => setRefineStrength(parseFloat(e.target.value))}
                  className="w-full accent-emerald-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-emerald-300 tabular-nums text-right">{refineStrength.toFixed(2)}</span>
              </div>
            )}
            {mode === 'runpod' && adetailer && (
              <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-rose-400/70">Faces str</span>
                <input type="range" min={0.2} max={0.6} step={0.05} value={adetailerStrength}
                  onChange={e => setAdetailerStrength(parseFloat(e.target.value))}
                  className="w-full accent-rose-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-rose-300 tabular-nums text-right">{adetailerStrength.toFixed(2)}</span>
              </div>
            )}
            {mode === 'runpod' && ipAdapter && (
              <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-teal-400/70">IP scale</span>
                <input type="range" min={0.1} max={1.0} step={0.05} value={ipScale}
                  onChange={e => setIpScale(parseFloat(e.target.value))}
                  className="w-full accent-teal-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-teal-300 tabular-nums text-right">{ipScale.toFixed(2)}</span>
              </div>
            )}
            {mode === 'runpod' && gfpgan && (
              <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-purple-400/70">GFPGAN wt</span>
                <input type="range" min={0.1} max={1.0} step={0.05} value={gfpganWeight}
                  onChange={e => setGfpganWeight(parseFloat(e.target.value))}
                  className="w-full accent-purple-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-purple-300 tabular-nums text-right">{gfpganWeight.toFixed(2)}</span>
              </div>
            )}
            {mode === 'runpod' && img2img && (
              <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-indigo-400/70">i2i str</span>
                <input type="range" min={0.1} max={1.0} step={0.05} value={img2imgStrength}
                  onChange={e => setImg2imgStrength(parseFloat(e.target.value))}
                  className="w-full accent-indigo-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-indigo-300 tabular-nums text-right">{img2imgStrength.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        {/* ControlNet configuration panel — up to 3 conditions */}
        {mode === 'runpod' && controlnet && (
          <div className="rounded-xl border border-sky-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-sky-400/60 uppercase tracking-widest">ControlNet</span>
              {cnConditions.length < 3 && (
                <button onClick={addCn}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-sky-400 border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 transition-colors">
                  <Plus size={9} /> Add condition
                </button>
              )}
            </div>

            {cnConditions.map((cond, idx) => (
              <div key={cond.id} className={`space-y-2.5 ${idx > 0 ? 'border-t border-white/5 pt-2.5' : ''}`}>
                {/* Row: index + mode buttons + remove */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-600 shrink-0 w-4">#{idx + 1}</span>
                  <div className="flex gap-1 flex-1">
                    {(['pose', 'depth', 'canny'] as const).map(m => (
                      <button key={m} onClick={() => updateCn(cond.id, { mode: m })}
                        title={m === 'pose' ? 'DWPose skeleton' : m === 'depth' ? 'MiDaS depth map' : 'Canny edge map'}
                        className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                          cond.mode === m
                            ? 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                        }`}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                  {cnConditions.length > 1 && (
                    <button onClick={() => removeCn(cond.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                      <X size={11} />
                    </button>
                  )}
                </div>

                {/* Scale slider + Mirror toggle */}
                <div className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500">Scale</span>
                  <input type="range" min={0.1} max={1.0} step={0.05} value={cond.scale}
                    onChange={e => updateCn(cond.id, { scale: parseFloat(e.target.value) })}
                    className="w-full accent-sky-400 cursor-pointer h-0.5" />
                  <span className="text-[11px] font-mono text-sky-300 tabular-nums text-right">{cond.scale.toFixed(2)}</span>
                </div>
                {cond.mode === 'pose' && (
                  <button
                    onClick={() => updateCn(cond.id, { mirror: !cond.mirror })}
                    title="Mirror the reference image horizontally — use if the generated pose is flipped (e.g. selfie photos)"
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border transition-colors ${
                      cond.mirror
                        ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                        : 'border-white/10 bg-white/5 text-slate-500 hover:text-white hover:border-white/20'
                    }`}>
                    ↔ Mirror reference
                  </button>
                )}

                {/* Image upload row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => cnRefsMap.current[cond.id]?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-300 text-[11px] hover:bg-sky-500/20 transition-all shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    {cond.imgB64 ? 'Replace' : 'Upload photo'}
                  </button>
                  {cond.preview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cond.preview} alt={`ctrl-${idx}`} className="h-10 w-10 rounded object-cover border border-sky-500/20 shrink-0" />
                      <button onClick={() => updateCn(cond.id, { imgB64: '', preview: '' })}
                        className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">✕ Clear</button>
                    </>
                  ) : (
                    <span className="text-[10px] text-amber-400/50">⚠ No image</span>
                  )}
                  <input ref={el => { cnRefsMap.current[cond.id] = el }} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const dataUrl = ev.target?.result as string
                        updateCn(cond.id, { preview: dataUrl, imgB64: dataUrl.split(',')[1] ?? '' })
                      }
                      reader.readAsDataURL(file)
                      e.target.value = ''
                    }}
                  />
                </div>

                {/* Mode hint */}
                <p className="text-[10px] text-slate-700">
                  {cond.mode === 'pose'  && 'Pose: DWPose skeleton — locks body stance and hand positions. Scale 0.6–0.8.'}
                  {cond.mode === 'depth' && 'Depth: MiDaS depth map — locks 3D composition and perspective. Scale 0.5–0.7.'}
                  {cond.mode === 'canny' && 'Canny: edge map — locks hard outlines and silhouettes. Scale 0.4–0.6.'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* LoRA panel — collapsible */}
        {loraOpen && (
          <div ref={loraPanelRef} className="rounded-xl border border-white/[0.08] bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400/60 uppercase tracking-widest">LoRAs</span>
              <button onClick={() => setLoraOpen(false)} className="text-slate-600 hover:text-slate-300 transition-colors p-0.5">
                <X size={11} />
              </button>
            </div>

            {/* LoRA entries */}
            {loras.map(lora => (
              <div key={lora.id} className="flex items-center gap-2">
                <select value={lora.key}
                  onChange={e => {
                    const opt = loraOptions.find(o => o.key === e.target.value)
                    updateLora(lora.id, { key: e.target.value, name: opt?.name ?? e.target.value })
                  }}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none cursor-pointer">
                  <option value="" className="bg-slate-800 text-slate-400">— select LoRA —</option>
                  {loraOptions.map(o => <option key={o.key} value={o.key} className="bg-slate-800 text-white">{o.name}</option>)}
                </select>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-cyan-300 tabular-nums w-8 text-right">{lora.strength.toFixed(2)}</span>
                  <input type="range" min={0} max={2} step={0.05} value={lora.strength}
                    onChange={e => updateLora(lora.id, { strength: parseFloat(e.target.value) })}
                    className="w-20 accent-cyan-400 cursor-pointer h-0.5" />
                </div>
                <button onClick={() => removeLora(lora.id)}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0"><X size={10} /></button>
              </div>
            ))}

            {/* Upload progress */}
            {loraUploading && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Uploading…</span>
                  <span>{loraUploadProgress}%</span>
                </div>
                <div className="h-0.5 w-full rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-violet-500 transition-all duration-150 rounded-full" style={{ width: `${loraUploadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
              <button onClick={addLora} disabled={loras.length >= 4}
                className="text-[11px] text-slate-500 hover:text-cyan-400 transition-colors flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed">
                <Plus size={10} /> Add LoRA {loras.length < 4 ? `(${loras.length}/4)` : '(max 4)'}
              </button>
              <span className="text-slate-700 text-[10px]">·</span>
              <button onClick={() => loraFileInputRef.current?.click()} disabled={loraUploading}
                className="text-[11px] text-slate-500 hover:text-violet-400 transition-colors flex items-center gap-1 disabled:opacity-40">
                <Upload size={10} /> Upload .safetensors
              </button>
            </div>

            {/* Hidden file input */}
            <input ref={loraFileInputRef} type="file" accept=".safetensors,.ckpt,.pt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLoraUpload(f); e.target.value = '' }} />
          </div>
        )}

        {/* Upscaling configuration panel */}
        {mode === 'runpod' && upscaleEnabled && (
          <div className="rounded-xl border border-violet-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-3">
            <span className="text-[10px] font-mono text-violet-400/60 uppercase tracking-widest">Upscaling</span>

            {/* Method */}
            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
              <span className="text-[10px] font-mono text-slate-500">Method</span>
              <div className="flex gap-1 flex-wrap">
                {([
                  { val: 'flux'     as const, label: 'Flux Tiling' },
                  { val: 'esrgan'   as const, label: 'ESRGAN'      },
                  { val: 'combo'    as const, label: 'Combo'       },
                  { val: 'pipeline' as const, label: 'Pipeline'    },
                ]).map(({ val, label }) => (
                  <button key={val} onClick={() => setUpscaleMethod(val)}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      upscaleMethod === val
                        ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scale (hidden for combo and pipeline) */}
            {upscaleMethod !== 'combo' && upscaleMethod !== 'pipeline' && (
              <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">
                  {upscaleMethod === 'flux' ? 'Target' : 'Scale'}
                </span>
                <div className="flex gap-1 flex-wrap">
                  {upscaleMethod === 'flux' ? (
                    ([
                      { key: '2k' as const, label: '2×',  sub: '2048px long side' },
                      { key: '4k' as const, label: '4×',  sub: '4096px long side' },
                      { key: '5k' as const, label: '5K',  sub: '5120px long side' },
                      { key: '6k' as const, label: '6K',  sub: '6144px long side' },
                      { key: '8k' as const, label: '8K',  sub: '8192px long side' },
                    ]).map(({ key, label, sub }) => (
                      <button key={key} onClick={() => setFluxTarget(key)}
                        title={sub}
                        className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                          fluxTarget === key
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                        }`}>
                        {label}
                      </button>
                    ))
                  ) : (
                    ([2, 4] as const).map(s => (
                      <button key={s} onClick={() => setUpscaleScale(s)}
                        className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                          upscaleScale === s
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                        }`}>
                        {s}×
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ESRGAN model (ESRGAN or Combo — not pipeline, which has per-step model) */}
            {(upscaleMethod === 'esrgan' || upscaleMethod === 'combo') && (
              <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Model</span>
                <div className="flex gap-1">
                  <button onClick={() => setEsrganModel('ultrasharp')}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      esrganModel === 'ultrasharp'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}>
                    4x-UltraSharp
                  </button>
                  <button onClick={() => setEsrganModel('x4plus')}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      esrganModel === 'x4plus'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}>
                    RealESRGAN
                  </button>
                </div>
              </div>
            )}

            {/* Combo order */}
            {upscaleMethod === 'combo' && (
              <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Order</span>
                <div className="flex gap-1">
                  <button onClick={() => setComboOrder('flux-first')}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      comboOrder === 'flux-first'
                        ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}>
                    Flux → ESRGAN
                  </button>
                  <button onClick={() => setComboOrder('esrgan-first')}
                    className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                      comboOrder === 'esrgan-first'
                        ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}>
                    ESRGAN → Flux
                  </button>
                </div>
              </div>
            )}

            {/* Flux tile strength (Flux or Combo — pipeline has per-step strength) */}
            {(upscaleMethod === 'flux' || upscaleMethod === 'combo') && (
              <div className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-3 border-t border-white/5 pt-2">
                <span className="text-[10px] font-mono text-violet-400/70">Tile str</span>
                <input type="range" min={0.1} max={0.5} step={0.05} value={fluxTileStrength}
                  onChange={e => setFluxTileStrength(parseFloat(e.target.value))}
                  className="w-full accent-violet-400 cursor-pointer h-0.5" />
                <span className="text-[11px] font-mono text-violet-300 tabular-nums text-right">{fluxTileStrength.toFixed(2)}</span>
              </div>
            )}

            {/* Pipeline step builder */}
            {upscaleMethod === 'pipeline' && (
              <div className="space-y-2 border-t border-white/5 pt-2">
                {pipelineSteps.map((step, i) => {
                  // Compute the resolution entering this step so we can grey out downscale options
                  let inputRes = Math.max(width, height)
                  for (let j = 0; j < i; j++) {
                    const s = pipelineSteps[j]
                    if (s.type === 'flux') {
                      inputRes *= (s.upscaleFactor ?? 2)
                    } else {
                      const tp = s.targetPx ?? 0
                      inputRes = tp > 0 ? Math.max(inputRes, tp) : inputRes * (s.model === 'x2plus' ? 2 : 4)
                    }
                  }
                  return (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">Step {i + 1}</span>
                      <div className="flex items-center gap-1.5">
                        {/* Type toggle */}
                        {(['flux', 'esrgan'] as const).map(t => (
                          <button key={t} onClick={() => updatePipelineStep(i, { type: t })}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                              step.type === t
                                ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                                : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                            }`}>
                            {t === 'flux' ? 'Flux' : 'ESRGAN'}
                          </button>
                        ))}
                        {pipelineSteps.length > 1 && (
                          <button onClick={() => removePipelineStep(i)}
                            className="text-[10px] text-slate-600 hover:text-red-400 transition-colors px-1">✕</button>
                        )}
                      </div>
                    </div>
                    {step.type === 'flux' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[9px] font-mono text-slate-600 block mb-0.5">Scale</span>
                          <div className="flex gap-1">
                            {([1, 2, 3, 4] as const).map(f => (
                              <button key={f} onClick={() => updatePipelineStep(i, { upscaleFactor: f })}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                                  step.upscaleFactor === f
                                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                                    : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                                }`}>
                                {f}×
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] font-mono text-slate-600 block mb-0.5">Strength {(step.strength ?? 0.35).toFixed(2)}</span>
                          <input type="range" min={0.1} max={0.9} step={0.05}
                            value={step.strength ?? 0.35}
                            onChange={e => updatePipelineStep(i, { strength: parseFloat(e.target.value) })}
                            className="w-full accent-violet-400 cursor-pointer h-0.5" />
                        </div>
                      </div>
                    )}
                    {step.type === 'esrgan' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[9px] font-mono text-slate-600 block mb-0.5">Model</span>
                          <div className="flex gap-1 flex-wrap">
                            {([
                              { v: 'ultrasharp', l: 'UltraSharp' },
                              { v: 'x4plus',     l: 'RealESRGAN' },
                              { v: 'x2plus',     l: 'x2plus'     },
                            ]).map(({ v, l }) => (
                              <button key={v} onClick={() => updatePipelineStep(i, { model: v })}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                                  step.model === v
                                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                                    : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                                }`}>
                                {l}
                              </button>
                            ))}
                            {r2EsrganModels.map(m => (
                              <button key={m} onClick={() => updatePipelineStep(i, { model: m })}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                                  step.model === m
                                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                                    : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                                }`}>
                                {m.replace(/\.pth$/i, '')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] font-mono text-slate-600 block mb-0.5">
                            Target px <span className="text-slate-700">(must exceed {Math.round(inputRes)}px)</span>
                          </span>
                          <div className="flex gap-1 flex-wrap">
                            {([0, 2048, 3072, 4096, 6144, 8192] as const).map(px => {
                              const tooSmall = px > 0 && px <= inputRes
                              return (
                                <button key={px}
                                  onClick={() => !tooSmall && updatePipelineStep(i, { targetPx: px })}
                                  disabled={tooSmall}
                                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                                    tooSmall
                                      ? 'opacity-25 cursor-not-allowed bg-white/[0.02] border-white/5 text-slate-600'
                                      : step.targetPx === px
                                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                                      : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                                  }`}>
                                  {px === 0 ? 'native' : `${px}`}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )
                })}
                {pipelineSteps.length < 10 && (
                  <div className="flex gap-1.5 pt-0.5">
                    <button onClick={() => addPipelineStep('flux')}
                      className="px-2.5 py-1 text-[10px] rounded border border-dashed border-violet-500/30 text-violet-400/60 hover:border-violet-500/60 hover:text-violet-300 transition-colors">
                      + Flux step
                    </button>
                    <button onClick={() => addPipelineStep('esrgan')}
                      className="px-2.5 py-1 text-[10px] rounded border border-dashed border-amber-500/30 text-amber-400/60 hover:border-amber-500/60 hover:text-amber-300 transition-colors">
                      + ESRGAN step
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Informational footer */}
            <p className="text-[10px] text-slate-600 border-t border-white/5 pt-2">
              {upscaleMethod === 'pipeline'
                ? `${pipelineSteps.length}-step custom pipeline: ${pipelineSteps.map(s => s.type === 'flux' ? `Flux ${s.upscaleFactor ?? 2}×` : `ESRGAN (${s.model ?? 'ultrasharp'})`).join(' → ')}`
                : upscaleMethod === 'combo'
                ? `Flux 2× tiling → ESRGAN 2× (${esrganModel === 'ultrasharp' ? '4x-UltraSharp' : 'RealESRGAN'}) = effective 4× — faithful structure + GAN texture`
                : upscaleMethod === 'flux'
                ? `Flux diffusion tiling → ${fluxTarget.toUpperCase()} long side — accurate, prompt-guided detail, slower`
                : `${esrganModel === 'ultrasharp' ? '4x-UltraSharp' : 'RealESRGAN'} ${upscaleScale}× — fast, adds high-freq texture, no diffusion`
              }
            </p>
          </div>
        )}

        {/* IP-Adapter: shows which active refs will be used — no separate upload */}
        {mode === 'runpod' && ipAdapter && (
          <div className="rounded-xl border border-teal-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-teal-400/60 uppercase tracking-widest">IP Reference Images</span>
              <span className="text-[10px] text-slate-600">activate images in the Refs panel above</span>
            </div>
            {activeRefImages.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                {activeRefImages.slice(0, 3).map((img, i) => (
                  <div key={img.id} className="relative w-14 h-14 rounded-md overflow-hidden border border-teal-500/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                    {i === 0 && activeRefImages.length > 3 && (
                      <span className="absolute bottom-0 right-0 text-[9px] bg-black/70 text-teal-300 px-1">+{activeRefImages.length - 3}</span>
                    )}
                  </div>
                ))}
                <span className="text-[10px] text-slate-500">{Math.min(activeRefImages.length, 3)} image{activeRefImages.length !== 1 ? 's' : ''} will guide style &amp; appearance</span>
              </div>
            ) : (
              <p className="text-[11px] text-slate-600 italic">No active reference images — activate some in the Refs panel to use IP-Adapter</p>
            )}
          </div>
        )}

        {/* Flux Fill hint — shown when fill checkpoint is selected but no mask is active */}
        {mode === 'runpod' && isFluxFill && !inpaintMode && !stencilCropB64 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-start gap-3">
            <span className="text-emerald-400 text-base leading-none mt-0.5">◻</span>
            <div>
              <p className="text-[11px] font-semibold text-emerald-300 leading-none mb-1">Flux Fill selected</p>
              <p className="text-[10px] text-slate-500 leading-snug">
                Use the <span className="text-sky-400">✂ Stencil</span> tool in <span className="text-white">Inpaint</span> mode to upload an image and paint the region you want to fill. Without a mask, Flux Fill will generate onto a blank canvas.
              </p>
            </div>
          </div>
        )}

        {/* Stencil crop result preview */}
        {mode === 'runpod' && stencilCropB64 && (
          <div className="rounded-xl border border-sky-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-sky-400/60 uppercase tracking-widest">Stencil Crop · img2img Source</span>
              <button onClick={() => { setStencilCropB64(''); setImg2img(false) }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-slate-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-all">
                <X size={9} /> Clear
              </button>
            </div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stencilCropB64} alt="crop" className="w-14 h-14 rounded-md object-cover border border-sky-500/30 shrink-0" />
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="text-[10px] text-slate-400">Cropped region will seed img2img diffusion</span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  Strength
                  <input type="range" min={0.1} max={1} step={0.05} value={img2imgStrength}
                    onChange={e => setImg2imgStrength(+e.target.value)} className="w-24 accent-sky-400" />
                  <span className="font-mono text-sky-300">{img2imgStrength.toFixed(2)}</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Stencil inpaint preview */}
        {mode === 'runpod' && inpaintMode && (
          <div className="rounded-xl border border-amber-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-amber-400/60 uppercase tracking-widest">
                  {inpaintJobs && inpaintJobs.length > 1 ? `Inpaint · ${inpaintJobs.length} shapes (per-shape jobs)` : 'Inpaint Mask Active'}
                </span>
                {isFluxFill && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Flux Fill</span>
                )}
              </div>
              <button onClick={() => { setInpaintMode(false); setInpaintImageB64(''); setInpaintMaskB64(''); setInpaintJobs(null); setInpaintOriginalB64(''); setInpaintImgDims(null) }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-slate-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-all">
                <X size={9} /> Clear
              </button>
            </div>
            {inpaintJobs && inpaintJobs.length > 1 ? (
              // Multi-shape: show a row per job
              <div className="space-y-2">
                {inpaintJobs.map((job, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-amber-400/50 w-12 shrink-0">Shape {i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.image} alt={`shape ${i + 1}`} className="w-10 h-10 rounded object-cover border border-amber-500/30 shrink-0" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.mask}  alt={`mask ${i + 1}`}  className="w-10 h-10 rounded object-cover border border-amber-500/20 shrink-0 bg-black" />
                    <input type="text" value={job.prompt} onChange={e => updateJobPrompt(i, e.target.value)}
                      placeholder="describe this region… (prepends to base prompt)"
                      className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/40" />
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-0.5">
                  {isFluxFill ? (
                    <span className="text-[10px] text-emerald-400/60">Flux Fill — no strength needed, model handles context natively</span>
                  ) : (
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      Strength
                      <input type="range" min={0.1} max={1} step={0.05} value={inpaintStrength}
                        onChange={e => setInpaintStrength(+e.target.value)} className="w-24 accent-amber-400" />
                      <span className="font-mono text-amber-300">{inpaintStrength.toFixed(2)}</span>
                    </label>
                  )}
                  <span className="text-[10px] text-slate-600">base prompt applies to all shapes</span>
                </div>
              </div>
            ) : (
              // Single shape (or no jobs yet)
              <div className="flex items-center gap-3">
                {inpaintJobs?.[0] && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inpaintJobs[0].image} alt="source" className="w-14 h-14 rounded-md object-cover border border-amber-500/30 shrink-0" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inpaintJobs[0].mask}  alt="mask"   className="w-14 h-14 rounded-md object-cover border border-amber-500/20 shrink-0 bg-black" />
                  </>
                )}
                <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                  <span className="text-[10px] text-slate-400">
                    {isFluxFill
                      ? 'Flux Fill — the model sees context around the mask and fills it coherently'
                      : 'Generates inside the selected region, composited back onto your original image'}
                  </span>
                  {!isFluxFill && (
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      Strength
                      <input type="range" min={0.1} max={1} step={0.05} value={inpaintStrength}
                        onChange={e => setInpaintStrength(+e.target.value)} className="w-24 accent-amber-400" />
                      <span className="font-mono text-amber-300">{inpaintStrength.toFixed(2)}</span>
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* img2img: shows which ref will be used as the starting image */}
        {mode === 'runpod' && img2img && (
          <div className="rounded-xl border border-indigo-500/20 bg-slate-900/90 backdrop-blur-md px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-indigo-400/60 uppercase tracking-widest">img2img Source</span>
              <span className="text-[10px] text-slate-600">first active ref · activate in the Refs panel above</span>
            </div>
            {activeRefImages.length > 0 ? (() => {
              const baseW = autoBaseDims?.w ?? width
              const baseH = autoBaseDims?.h ?? height
              let finalW = baseW, finalH = baseH
              if (upscaleEnabled) {
                if (upscaleMethod === 'pipeline') {
                  // Simulate each step to get the true final resolution
                  for (const s of pipelineSteps) {
                    if (s.type === 'flux') {
                      const f = s.upscaleFactor ?? 2
                      finalW *= f; finalH *= f
                    } else {
                      const tp = s.targetPx ?? 0
                      if (tp > 0) {
                        const scale = Math.max(1, tp / Math.max(finalW, finalH))
                        finalW = Math.round(finalW * scale)
                        finalH = Math.round(finalH * scale)
                      } else {
                        const ns = s.model === 'x2plus' ? 2 : 4
                        finalW *= ns; finalH *= ns
                      }
                    }
                  }
                } else if (upscaleMethod === 'combo') {
                  finalW *= 4; finalH *= 4
                } else if (upscaleMethod === 'flux') {
                  const fluxTargetPx = { '2k': 2048, '4k': 4096, '5k': 5120, '6k': 6144, '8k': 8192 }[fluxTarget] ?? 2048
                  const longSide = Math.max(finalW, finalH)
                  const scale = fluxTargetPx / longSide
                  finalW = Math.round(finalW * scale)
                  finalH = Math.round(finalH * scale)
                } else {
                  finalW *= upscaleScale; finalH *= upscaleScale
                }
              }
              const upscaleLabel = !upscaleEnabled ? null
                : upscaleMethod === 'flux'     ? `Flux Tiling → ${fluxTarget.toUpperCase()}`
                : upscaleMethod === 'esrgan'   ? `${upscaleScale}× ${esrganModel === 'ultrasharp' ? 'UltraSharp' : 'RealESRGAN'}`
                : upscaleMethod === 'pipeline' ? `Pipeline (${pipelineSteps.map(s => s.type === 'flux' ? `Flux ${s.upscaleFactor ?? 2}×` : 'ESRGAN').join('→')})`
                : `4× Combo (${comboOrder === 'flux-first' ? 'Flux→ESRGAN' : 'ESRGAN→Flux'})`
              return (
                <div className="flex items-start gap-3 flex-wrap">
                  {/* Thumbnail at natural aspect ratio */}
                  <div className="relative shrink-0 max-w-[56px] max-h-[56px] rounded-md overflow-hidden border border-indigo-500/30 flex items-center justify-center bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={activeRefImages[0].url} alt="" className="max-w-[56px] max-h-[56px] object-contain" />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] text-slate-400">Diffusion starts from this image · strength {img2imgStrength.toFixed(2)}</span>
                    {autoBaseDims ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-mono text-indigo-300">
                          Base: {baseW}×{baseH}
                          {upscaleLabel && <span className="text-slate-500"> → Final: <span className="text-indigo-200">{finalW.toLocaleString()}×{finalH.toLocaleString()}</span> <span className="text-slate-600">({upscaleLabel})</span></span>}
                        </span>
                        {!upscaleLabel && <span className="text-[10px] text-slate-600">No upscale selected — output will be {baseW}×{baseH}</span>}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-600 italic">Detecting dimensions…</span>
                    )}
                    {ipAdapter && <span className="text-[10px] text-teal-400/70">+ IP-Adapter appearance guidance active</span>}
                  </div>
                </div>
              )
            })() : (
              <p className="text-[11px] text-slate-600 italic">No active reference images — activate one in the Refs panel to use as the img2img source</p>
            )}
          </div>
        )}

        {/* Main card */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-md shadow-2xl">

          {/* Textarea */}
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
            placeholder="Describe what you want to create..."
            rows={1}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 160) + 'px'
            }}
            className="w-full resize-none bg-transparent px-5 pt-4 pb-3 text-sm text-white placeholder-slate-500 focus:outline-none leading-relaxed"
          />

          {/* Controls strip */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-3 pt-1 border-t border-white/5">

            {/* Mode toggle */}
            <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
              {(['local', 'runpod'] as FluxMode[]).map(m => (
                <button key={m}
                  onClick={() => { setMode(m); setCheckpoint(''); setLoras([{ id: `lora-${Date.now()}`, name: '', key: '', strength: 1.0 }]); setResultUrl(null); setError(null) }}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === m ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                  {m === 'local' ? 'Local' : 'RunPod'}
                </button>
              ))}
            </div>

            <div className="w-px h-3 bg-white/10 shrink-0" />

            {/* Checkpoint picker */}
            <div ref={ckptRef} className="relative shrink-0 flex items-center gap-1">
              <button onClick={() => setCkptOpen(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${
                  checkpoint
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                }`}>
                {checkpointLabel}
                <ChevronDown size={10} className={`transition-transform ${ckptOpen ? 'rotate-180' : ''}`} />
              </button>
              <button onClick={refreshModels} title="Refresh model list from R2"
                className="p-1 rounded border border-white/10 bg-white/5 text-slate-500 hover:text-white hover:border-white/20 transition-all">
                <RefreshCw size={10} className={!modelsLoaded ? 'animate-spin' : ''} />
              </button>
              {ckptOpen && (
                <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[280px] rounded-xl bg-[#0e1018] border border-white/10 shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
                  {!modelsLoaded ? (
                    <div className="px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2">
                      <Loader2 size={11} className="animate-spin shrink-0" />Loading...
                    </div>
                  ) : modelsError ? (
                    <div className="px-3 py-2 space-y-1">
                      <div className="text-[11px] text-red-400 break-all">{modelsError}</div>
                      <button onClick={refreshModels} className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"><RefreshCw size={10} />Retry</button>
                    </div>
                  ) : (() => {
                    const fillCkpts    = checkpoints.filter(c => /fill/i.test(c.key))
                    const kontextCkpts = checkpoints.filter(c => /kontext/i.test(c.key))
                    const devCkpts     = checkpoints.filter(c => !/fill/i.test(c.key) && !/kontext/i.test(c.key))
                    const Section = ({ label, accent, items }: { label: string; accent: string; items: typeof checkpoints }) => (
                      <div>
                        <div className={`px-3 py-1.5 flex items-center gap-1.5 border-b border-white/5 ${accent}`}>
                          <span className="text-[9px] font-bold tracking-widest uppercase">{label}</span>
                        </div>
                        {items.length === 0 ? (
                          <div className="px-3 py-2 text-[11px] text-slate-600 italic">No models yet</div>
                        ) : items.map(c => (
                          <button key={c.key} onClick={() => { setCheckpoint(c.key); setCkptOpen(false) }}
                            className={`w-full text-left px-3 py-2 text-[11px] transition-colors truncate ${
                              checkpoint === c.key ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                            }`}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )
                    return (
                      <>
                        <Section label="Flux 1 Dev" accent="text-amber-400/70" items={devCkpts} />
                        <div className="border-t border-white/5" />
                        <Section label="Flux Fill" accent="text-emerald-400/70" items={fillCkpts} />
                        <div className="border-t border-white/5" />
                        <Section label="Flux 1 Kontext" accent="text-violet-400/70" items={kontextCkpts} />
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

            <div className="w-px h-3 bg-white/10 shrink-0" />

            {/* LoRA toggle */}
            <div ref={loraRef} className="relative shrink-0">
              <button onClick={() => setLoraOpen(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all ${
                  activeLoras.length > 0
                    ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                }`}>
                <Sparkles size={11} />
                {activeLoras.length > 0 ? `${activeLoras.length} LoRA${activeLoras.length > 1 ? 's' : ''}` : 'LoRA'}
              </button>
            </div>

            <div className="w-px h-3 bg-white/10 shrink-0" />

            {/* Config toggle */}
            <button onClick={() => setConfigOpen(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                configOpen ? 'border-white/20 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
              }`}>
              <SlidersHorizontal size={11} />
              <span className="font-mono">{steps}s · {guidance.toFixed(1)}g · {width}×{height}</span>
            </button>

            {/* RunPod-only: Refine toggle + Quality selector */}
            {mode === 'runpod' && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0" />
                {/* Refine toggle */}
                <button onClick={() => setRefine(v => !v)}
                  title="Run an img2img detail pass at the same resolution after generation"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    refine
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  Refine
                </button>
                {/* ADetailer face fix toggle */}
                <button onClick={() => setAdetailer(v => !v)}
                  title="Detect faces and run a targeted detail pass on each one (ADetailer)"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    adetailer
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  Faces
                </button>
                {/* GFPGAN face restoration toggle */}
                <button onClick={() => setGfpgan(v => !v)}
                  title="GFPGAN v1.4 — restore realistic skin pores and micro-texture to faces"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    gfpgan
                      ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  GFPGAN
                </button>
                {/* IP-Adapter toggle */}
                <button onClick={() => setIpAdapter(v => !v)}
                  title="Use reference images to guide style and appearance (IP-Adapter)"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    ipAdapter
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  IP
                </button>
                {/* img2img toggle */}
                <button onClick={() => setImg2img(v => !v)}
                  title="Start diffusion from your reference image instead of noise (img2img)"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    img2img
                      ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  i2i
                </button>
                {/* Stencil tool */}
                <button onClick={() => setStencilOpen(true)}
                  title="Stencil — crop a region for img2img, or paint an inpaint mask"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    (stencilCropB64 || inpaintMode)
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  ✂ Stencil
                </button>
                {/* Upscaling toggle */}
                <button onClick={() => setUpscaleEnabled(v => !v)}
                  title="Configure upscaling pipeline"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    upscaleEnabled
                      ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  Upscale
                </button>
                {/* ControlNet toggle */}
                <button onClick={() => setControlnet(v => !v)}
                  title="ControlNet — lock pose or depth structure from a reference image"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    controlnet
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  ControlNet
                </button>
                {/* Download to R2 toggle */}
                <button onClick={() => setDownloadOpen(v => !v)}
                  title="Download a model URL directly into R2 via the RunPod worker"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                    downloadOpen
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}>
                  <Download size={11} />
                  DL→R2
                </button>
              </>
            )}

            {/* Spacer */}
            <div className="hidden sm:block sm:flex-1" />

            {/* Generate */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {!checkpoint && (
                <span className="text-[10px] text-amber-400/80 shrink-0">Select a checkpoint</span>
              )}
              <button onClick={handleGenerate} disabled={!canGenerate}
                className={`flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all flex-1 sm:flex-none ${
                  canGenerate
                    ? 'bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black hover:opacity-90'
                    : 'bg-white/5 text-slate-600 cursor-not-allowed border border-white/10'
                }`}>
                {generating ? (
                  <div className="w-3 h-3 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                {generating
                  ? (mode === 'runpod' ? (status || 'Queued') + '…' : 'Generating…')
                  : 'Generate'}
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Stencil modal */}
      {stencilOpen && (
        <StencilModal
          onClose={() => setStencilOpen(false)}
          onApply={handleStencilApply}
          targetW={width}
          targetH={height}
        />
      )}
    </div>
  )
}

// --- PROMPT BOX ---

function PromptBox({
  model,
  onModelChange,
  userId,
  onAddPending,
  onUpdatePending,
  onRemovePending,
  onPrependImage,
  onBalanceChange,
  activeRefImages,
  refLibrary,
  onDeactivateRef,
  onEditRef,
  onLoadPreset,
  onUploadRef,
  onStartPolling,
  onStartNb2Polling,
  onCancelNb2Polling,
  onTicketsChanged,
  onDeductTickets,
  activeJobCount,
  maxConcurrent,
  promptOverride,
  configOverride,
  isGenerationMaintenance = false,
  isAdminAccount = false,
  ticketBalance = 0,
}: {
  model: ImageModelConfig
  onModelChange: (m: ImageModelConfig) => void
  userId: number | null
  onAddPending: (slot: PendingSlot) => void
  onUpdatePending: (slotId: string, update: Partial<PendingSlot>) => void
  onRemovePending: (slotId: string) => void
  onPrependImage: (img: ImageItem) => void
  onBalanceChange: (balance: number) => void
  activeRefImages: RefImage[]
  refLibrary: RefImage[]
  onDeactivateRef: (id: string) => void
  onEditRef: (id: string, newUrl: string) => void
  onLoadPreset: (urls: string[]) => void
  onUploadRef: (items: RefImage[]) => void
  onStartPolling: (slotId: string, queueId: number, prompt: string) => void
  onStartNb2Polling: (requestId: string, falEndpoint: string, slotIds: string[], prompt: string, outputFormat: string, aspectRatio: string, statusUrl?: string, quality?: string, ticketCost?: number, referenceImageUrls?: string[]) => void
  onCancelNb2Polling: (requestId: string) => void
  onTicketsChanged?: (newBalance: number) => void
  onDeductTickets?: (amount: number) => void
  activeJobCount: number
  maxConcurrent: number
  promptOverride?: { text: string; version: number }
  configOverride?: { aspectRatio?: string; quality?: string; outputFormat?: string; imageCount?: number; version: number }
  isGenerationMaintenance?: boolean
  isAdminAccount?: boolean
  ticketBalance?: number
}) {
  const PROMPT_STORAGE_KEY = "pv2-prompt-state"
  const [editingRefImage, setEditingRefImage] = useState<RefImage | null>(null)
  const [prompt, setPrompt] = useState<string>("")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(model.aspectRatios[0])
  const [quality, setQuality] = useState<Quality>("2k")
  const [outputFormat, setOutputFormat] = useState<"png" | "jpeg" | "webp">("png")
  const [imageCount, setImageCount] = useState<number>(1)
  const [seedreamSafetyChecker, setSeedreamSafetyChecker] = useState(false)
  const [wanSafetyChecker, setWanSafetyChecker] = useState(false)
  const [fluxDevSafetyChecker, setFluxDevSafetyChecker] = useState(false)
  const [showSafetyModal, setShowSafetyModal] = useState(false)
  const [safetyAgeConfirmed, setSafetyAgeConfirmed] = useState(false)
  const [safetyConfirmCallback, setSafetyConfirmCallback] = useState<(() => void) | null>(null)
  const [loraJobs, setLoraJobs] = useState<Array<{ id: number; name: string; loraUrl: string; custom?: boolean; triggerWord?: string }>>([])
  const [selectedLoraUrl, setSelectedLoraUrl] = useState<string | null>(null)
  const [loraScale, setLoraScale] = useState(1.0)
  const [loraGuidanceScale, setLoraGuidanceScale] = useState(3.5)
  const [loraSteps, setLoraSteps] = useState(28)
  const [loraPickerOpen, setLoraPickerOpen] = useState(false)
  const [showAddLora, setShowAddLora] = useState(false)
  const [newLoraName, setNewLoraName] = useState("")
  const [newLoraUrl, setNewLoraUrl] = useState("")
  const [loraUploading, setLoraUploading] = useState(false)
  const loraFileInputRef = useRef<HTMLInputElement>(null)
  const loraPickerRef = useRef<HTMLDivElement>(null)
  // Upscaler state
  const [upscaleSourceUrl, setUpscaleSourceUrl] = useState("")
  const [upscaleUploading, setUpscaleUploading] = useState(false)
  const [upscaleUploadError, setUpscaleUploadError] = useState<string | null>(null)
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null)
  const upscaleFileInputRef = useRef<HTMLInputElement>(null)
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 4>(2)
  const [upscaleCreativity, setUpscaleCreativity] = useState(0.35)
  const [upscaleResemblance, setUpscaleResemblance] = useState(0.6)
  const [upscaleGuidance, setUpscaleGuidance] = useState(4)
  const [upscaleSteps, setUpscaleSteps] = useState(18)
  const [clarityConfigOpen, setClarityConfigOpen] = useState(false)
  // AuraSR-specific state
  const [auraSrCheckpoint, setAuraSrCheckpoint] = useState<"v1" | "v2">("v2")
  const [auraSrOverlappingTiles, setAuraSrOverlappingTiles] = useState(false)
  // ESRGAN-specific state
  type EsrganModel = "RealESRGAN_x4plus" | "RealESRGAN_x2plus" | "RealESRGAN_x4plus_anime_6B" | "RealESRGAN_x4_v3" | "RealESRGAN_x4_wdn_v3" | "RealESRGAN_x4_anime_v3"
  const ESRGAN_MODELS: { id: EsrganModel; label: string; desc: string }[] = [
    { id: "RealESRGAN_x4plus",          label: "x4plus",      desc: "General purpose 4x" },
    { id: "RealESRGAN_x2plus",          label: "x2plus",      desc: "General purpose 2x" },
    { id: "RealESRGAN_x4plus_anime_6B", label: "Anime 6B",    desc: "Anime / illustration" },
    { id: "RealESRGAN_x4_v3",           label: "x4 v3",       desc: "General v3" },
    { id: "RealESRGAN_x4_wdn_v3",       label: "WDN v3",      desc: "v3 + denoising" },
    { id: "RealESRGAN_x4_anime_v3",     label: "Anime v3",    desc: "Anime v3" },
  ]
  const [esrganModel, setEsrganModel] = useState<EsrganModel>("RealESRGAN_x4plus")
  const [esrganFace, setEsrganFace] = useState(false)
  const [esrganOutputFormat, setEsrganOutputFormat] = useState<"png" | "jpeg">("png")
  const [supirModelName, setSupirModelName] = useState<"SUPIR-v0F" | "SUPIR-v0Q">("SUPIR-v0F")
  const [supirSteps, setSupirSteps] = useState(20)
  const [supirUseLlava, setSupirUseLlava] = useState(false)
  const [supirCfg, setSupirCfg] = useState(4.0)
  const [supirColorFix, setSupirColorFix] = useState<"Wavelet" | "AdaIn" | "None">("Wavelet")
  const [supirNegPrompt, setSupirNegPrompt] = useState("blurry, noisy, low quality, oversmoothed, jpeg artifacts, deformed")
  const [supirConfigOpen, setSupirConfigOpen] = useState(false)
  // Local admin model state
  const [localCheckpoints, setLocalCheckpoints] = useState<{ name: string; path: string; iter: number; experiment: string; arch: string }[]>([])
  const [selectedLocalCheckpoint, setSelectedLocalCheckpoint] = useState<string>("")
  const [checkpointLoading, setCheckpointLoading] = useState(false)
  const [showCheckpointPicker, setShowCheckpointPicker] = useState(false)
  const checkpointPickerRef = useRef<HTMLDivElement>(null)
  const localJobPollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const LOCAL_JOBS_KEY = "pv2-local-esrgan-jobs"

  const stopLocalJobPoll = useCallback((jobId: string) => {
    const iv = localJobPollRefs.current.get(jobId)
    if (iv) { clearInterval(iv); localJobPollRefs.current.delete(jobId) }
    try {
      const stored: { jobId: string; slotId: string; label: string }[] = JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || "[]")
      localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(stored.filter(j => j.jobId !== jobId)))
    } catch { /* ignore */ }
  }, [])

  const startLocalJobPoll = useCallback((jobId: string, slotId: string, label: string) => {
    const iv = setInterval(async () => {
      try {
        const res  = await fetch(`/api/admin/upscaler/infer?jobId=${jobId}`)
        const data = await res.json()
        if (data.status === 'done' && data.imageUrl) {
          stopLocalJobPoll(jobId)
          onRemovePending(slotId)
          onPrependImage({ id: data.dbId ?? Date.now(), imageUrl: data.imageUrl, prompt: label, model: "local-realesrgan" })
        } else if (data.status === 'error' || data.status === 'not_found') {
          stopLocalJobPoll(jobId)
          onUpdatePending(slotId, { status: "failed", error: data.error || "Inference failed" })
        }
      } catch { /* keep polling */ }
    }, 3000)
    localJobPollRefs.current.set(jobId, iv)
  }, [onRemovePending, onPrependImage, onUpdatePending, stopLocalJobPoll])

  // Restore pending local jobs on mount
  useEffect(() => {
    try {
      const stored: { jobId: string; slotId: string; label: string }[] = JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || "[]")
      for (const { jobId, slotId, label } of stored) {
        onAddPending({ slotId, status: "loading", prompt: label, modelId: "local-realesrgan", aspectRatio: "1:1", quality: "4x" as Quality })
        startLocalJobPoll(jobId, slotId, label)
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const refreshCheckpoints = useCallback(async () => {
    setCheckpointLoading(true)
    try {
        const r  = await fetch("/api/admin/upscaler/scan-checkpoints")
      const data = await r.json()
      if (Array.isArray(data)) {
        setLocalCheckpoints(data)
        if (data.length > 0) setSelectedLocalCheckpoint(prev => prev || data[data.length - 1].path)
      }
    } catch { /* ignore */ }
    finally { setCheckpointLoading(false) }
  }, [])
  useEffect(() => {
    if (model.isLocalModel) refreshCheckpoints()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.isLocalModel])

  // When switching between local models, auto-select the best checkpoint for that arch
  useEffect(() => {
    if (!model.isLocalModel) return
    const arch = model.id === 'local-neosr' ? 'neosr' : 'esrgan'
    const filtered = localCheckpoints.filter(c => c.arch === arch)
    setSelectedLocalCheckpoint(filtered.length > 0 ? filtered[filtered.length - 1].path : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id])
  // Restore saved prompt state after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(PROMPT_STORAGE_KEY) || "{}")
      if (s.prompt) setPrompt(s.prompt)
      if (s.aspectRatio) setAspectRatio(s.aspectRatio as AspectRatio)
      if (s.quality) setQuality(s.quality as Quality)
      if (s.outputFormat) setOutputFormat(s.outputFormat)
      if (s.imageCount) setImageCount(Math.min(Math.max(1, s.imageCount), model.maxImages ?? 1))
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [showPresets, setShowPresets] = useState(false)
  const [generating, setGenerating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ""
    if (!files.length) return
    const items: RefImage[] = await Promise.all(
      files.map(async (file) => ({
        id: `upload-${Date.now()}-${Math.random()}`,
        url: await compressFileToDataUrl(file),
      }))
    )
    onUploadRef(items)
  }

  // Save prompt box settings whenever they change
  useEffect(() => {
    try {
      sessionStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify({ prompt, aspectRatio, quality, outputFormat, imageCount }))
    } catch {}
  }, [prompt, aspectRatio, quality, outputFormat, imageCount])

  // Reset imageCount to 1 when model changes (avoids stale count from a previous model inflating the price)
  const prevModelIdRef = useRef(model.id)
  useEffect(() => {
    if (prevModelIdRef.current !== model.id) {
      prevModelIdRef.current = model.id
      setImageCount(1)
    }
  }, [model.id])

  // Sync external prompt injection (from TextDropdown "Use →")
  useEffect(() => {
    if (promptOverride && promptOverride.text) {
      setPrompt(promptOverride.text)
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px"
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptOverride?.version])

  // Sync external config injection (from Rescan — restores aspect ratio, quality, count, format)
  useEffect(() => {
    if (!configOverride) return
    if (configOverride.aspectRatio && (model.aspectRatios as string[]).includes(configOverride.aspectRatio)) {
      setAspectRatio(configOverride.aspectRatio as AspectRatio)
    }
    if (configOverride.quality) setQuality(configOverride.quality as Quality)
    if (configOverride.outputFormat) setOutputFormat(configOverride.outputFormat as "png" | "jpeg" | "webp")
    if (configOverride.imageCount) {
      setImageCount(Math.min(Math.max(1, configOverride.imageCount), model.maxImages ?? 1))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configOverride?.version])

  const supportsLora = model.id === "z-image-base" || model.id === "z-image-turbo" || model.id === "flux-2" || model.id === "flux-1-dev"
  const upscaleTicketCost = (model.id === "aura-sr" || model.id === "esrgan" || model.id === "drct") ? 1 : (upscaleFactor === 4 ? 26 : 7)
  const ticketCost = model.isUpscaler
    ? upscaleTicketCost
    : calcTicketCost(model.id, quality, aspectRatio, supportsLora && !!selectedLoraUrl, activeRefImages.length > 0)
  const totalCost = ticketCost * (model.maxImages ? imageCount : 1)
  const needsRefImage = !!model.requiresReferenceImage && activeRefImages.length === 0
  const slotsNeeded = (model.isFal || model.id === "nano-banana-pro-2" || model.id === "gpt-image-2") ? imageCount : 1
  const queueFull = activeJobCount + slotsNeeded > maxConcurrent
  const hasEnoughTickets = isAdminAccount || ticketBalance >= totalCost
  const canGenerate = model.isUpscaler
    ? !isGenerationMaintenance && !!userId && upscaleSourceUrl.trim().startsWith("http") && !generating && !queueFull && (!model.isLocalModel || !!selectedLocalCheckpoint) && hasEnoughTickets
    : !isGenerationMaintenance && !!userId && prompt.trim().length > 0 && !generating && !needsRefImage && !queueFull && hasEnoughTickets

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerating(true)
    const selectedLoraJob = loraJobs.find(j => j.loraUrl === selectedLoraUrl)
    const triggerWord = selectedLoraJob?.triggerWord?.trim()
    const rawPrompt = prompt.trim()
    // Auto-prepend trigger word for FLUX LoRAs if not already present
    const currentPrompt = (triggerWord && !rawPrompt.toLowerCase().includes(triggerWord.toLowerCase()))
      ? `${triggerWord} ${rawPrompt}`
      : rawPrompt
    const count = model.maxImages ? imageCount : 1

    // --- Local admin models: submit to background job, poll for result ---
    if (model.isLocalModel) {
      const slotId = `slot-${Date.now()}-0`
      const ckName = localCheckpoints.find(c => c.path === selectedLocalCheckpoint)
      const ckLabel = ckName
        ? ckName.experiment === 'pretrained'
          ? ckName.name.replace(/\.(pth|safetensors)$/, '')
          : `${(ckName.iter / 1000).toFixed(0)}k`
        : 'local'
      const label  = `${upscaleFactor}x ${model.name.replace(' (Local)', '')} · ${ckLabel}`
      onAddPending({ slotId, status: "loading", prompt: label, modelId: model.apiId, aspectRatio: "1:1", quality: `${upscaleFactor}x` as Quality })
      setGenerating(false)
      try {
        const res  = await fetch("/api/admin/upscaler/infer", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ imageUrl: upscaleSourceUrl, modelPath: selectedLocalCheckpoint, scale: upscaleFactor, prompt: label }),
        })
        const data = await res.json()
        if (!res.ok || !data.jobId) {
          onUpdatePending(slotId, { status: "failed", error: data.error || "Failed to start job" })
          return
        }
        // Persist so page refresh can resume polling
        const stored: { jobId: string; slotId: string; label: string }[] = JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || "[]")
        localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify([...stored, { jobId: data.jobId, slotId, label }]))
        startLocalJobPoll(data.jobId, slotId, label)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Network error"
        onUpdatePending(slotId, { status: "failed", error: msg })
      }
      return
    }

    // --- Upscaler models: completely different flow ---
    if (model.isUpscaler) {
      const upscalePrompt = prompt.trim() || "masterpiece, best quality, highres"
      const slotId = `slot-${Date.now()}-0`
      const pendingLabel = model.id === "aura-sr" ? `${upscaleFactor}x AuraSR` : model.id === "esrgan" ? `${upscaleFactor}x ESRGAN` : model.id === "drct" ? `${upscaleFactor}x DRCT` : model.id === "supir" ? `${upscaleFactor}x SUPIR` : `${upscaleFactor}x upscale`
      onAddPending({ slotId, status: "loading", prompt: pendingLabel, modelId: model.apiId, aspectRatio: "1:1", quality: `${upscaleFactor}x` as Quality })
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.apiId,
            adminMode: true,
            upscaleImageUrl: upscaleSourceUrl,
            upscaleFactor,
            ...(model.id === "clarity-upscaler"
              ? { prompt: upscalePrompt, upscaleCreativity, upscaleResemblance, upscaleGuidance, upscaleSteps }
              : model.id === "aura-sr"
                ? { auraSrCheckpoint, auraSrOverlappingTiles }
                : model.id === "esrgan"
                  ? { esrganModel, esrganFace, esrganOutputFormat }
                  : model.id === "supir"
                    ? { supirModelName, supirSteps, supirUseLlava, supirCfg, supirColorFix, supirNegPrompt }
                    : {} // drct: no extra params
            ),
          }),
        })
        const data = await res.json()
        if (!res.ok) { onUpdatePending(slotId, { status: "failed", error: data.error || "Generation failed" }); return }
        if (data.newBalance !== undefined) onBalanceChange(data.newBalance)
        onUpdatePending(slotId, { queueId: data.queueId })
        onStartPolling(slotId, data.queueId, upscalePrompt)
      } catch (err: any) {
        onUpdatePending(slotId, { status: "failed", error: err.message || "Network error" })
      } finally {
        setGenerating(false)
      }
      return
    }

    // Create N slots upfront — one per image
    // Permanent (Vercel Blob) URLs for storing in DB — data URIs are ephemeral and excluded
    const permanentRefUrls = activeRefImages.map(r => r.url).filter(u => u.startsWith("https://"))
    const slotIds = Array.from({ length: count }, (_, i) => `slot-${Date.now()}-${i}`)
    slotIds.forEach(sid => onAddPending({ slotId: sid, status: "loading", prompt: currentPrompt, modelId: model.apiId, aspectRatio, quality, referenceImageUrls: permanentRefUrls }))
    const slotId = slotIds[0] // alias for single-image paths

    try {
      // Convert ref images to base64
      const referenceImages = await Promise.all(activeRefImages.map(refImageToBase64))

      // --- SeeDream 5.0 Lite: async FAL queue ---
      if (model.id === "seedream-5-lite") {
        const images_base64 = referenceImages.map((b) => b.split(",")[1] || b)
        const sizeParams = seedream5LiteImageSize(quality, aspectRatio)
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/seedream-5-lite-submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                images_base64,
                ...sizeParams,
                enable_safety_checker: false,
                quality,
                aspectRatio,
                referenceImageUrls: permanentRefUrls,
              }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
              onUpdatePending(sid, { status: "failed", error: data.error || "Generation failed" })
              return
            }
            if (data.newBalance !== undefined) onBalanceChange(data.newBalance)
            onUpdatePending(sid, { queueId: data.queueId })
            onStartPolling(sid, data.queueId, currentPrompt)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- NanoBanana Pro 2: one FAL job per slot so each can succeed/fail independently ---
      if (model.id === "nano-banana-pro-2") {
        const resolution = quality === "4k" ? "4K" : "2K"
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/nano-banana-2-live", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                aspect_ratio: aspectRatio,
                resolution,
                num_images: 1,
                output_format: outputFormat,
                safety_tolerance: "6",
                enable_web_search: true,
                image_urls: referenceImages.length > 0 ? referenceImages : undefined,
              }),
            })
            const submitData = await res.json()
            if (!res.ok || !submitData.success) {
              onUpdatePending(sid, { status: "failed", error: submitData.error || "Submission failed" })
              return
            }
            const nb2Cost = calcTicketCost("nano-banana-pro-2", quality)
            const nb2RefUrls = submitData.permanentReferenceUrls?.length ? submitData.permanentReferenceUrls : permanentRefUrls
            // Deduct tickets immediately — whether queued or submitted directly
            onDeductTickets?.(nb2Cost)
            // Queued (at capacity): store context so the outer component can resume after promotion
            if (submitData.queued) {
              onUpdatePending(sid, {
                queueJobId: submitData.queueId,
                nb2StatusUrl: "/api/admin/nb2-status",
                nb2AspectRatio: aspectRatio,
                nb2OutputFormat: outputFormat,
                nb2TicketCost: nb2Cost,
                referenceImageUrls: nb2RefUrls,
              })
              return
            }
            const { requestId, falEndpoint } = submitData
            onUpdatePending(sid, {
              nb2RequestId: requestId,
              nb2FalEndpoint: falEndpoint,
              nb2OutputFormat: outputFormat,
              nb2AspectRatio: aspectRatio,
              nb2Quality: quality,
              nb2TicketCost: nb2Cost,
              referenceImageUrls: nb2RefUrls,
            })
            onStartNb2Polling(requestId, falEndpoint, [sid], currentPrompt, outputFormat, aspectRatio, "/api/admin/nb2-status", quality, nb2Cost, nb2RefUrls)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- Kling V3 Image: one FAL job per slot ---
      if (model.id === "kling-v3-image") {
        const resolution = quality === "2k" ? "2K" : "1K"
        const imageUrl = referenceImages.length > 0 ? referenceImages[0] : undefined
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/kling-image-submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                image_url: imageUrl,
                num_images: 1,
                aspect_ratio: aspectRatio,
                output_format: outputFormat,
                resolution,
              }),
            })
            const submitData = await res.json()
            if (!res.ok || !submitData.success) {
              onUpdatePending(sid, { status: "failed", error: submitData.error || "Submission failed" })
              return
            }
            const klingV3Cost = calcTicketCost("kling-v3-image", quality)
            const klingV3RefUrls = submitData.permanentReferenceUrls?.length ? submitData.permanentReferenceUrls : permanentRefUrls
            onDeductTickets?.(klingV3Cost)
            if (submitData.queued) {
              onUpdatePending(sid, {
                queueJobId: submitData.queueId,
                nb2StatusUrl: "/api/admin/kling-image-status",
                nb2AspectRatio: aspectRatio,
                nb2OutputFormat: outputFormat,
                nb2TicketCost: klingV3Cost,
                referenceImageUrls: klingV3RefUrls,
              })
              return
            }
            const { requestId, falEndpoint } = submitData
            onUpdatePending(sid, {
              nb2RequestId: requestId,
              nb2FalEndpoint: falEndpoint,
              nb2OutputFormat: outputFormat,
              nb2AspectRatio: aspectRatio,
              nb2StatusUrl: "/api/admin/kling-image-status",
              nb2TicketCost: klingV3Cost,
              referenceImageUrls: klingV3RefUrls,
            })
            onStartNb2Polling(requestId, falEndpoint, [sid], currentPrompt, outputFormat, aspectRatio, "/api/admin/kling-image-status", undefined, klingV3Cost, klingV3RefUrls)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- Kling O3 (Omni Image): one FAL job per slot ---
      if (model.id === "kling-o3-image") {
        const resolution = quality === "4k" ? "4K" : quality === "2k" ? "2K" : "1K"
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/kling-o3-submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                image_urls: referenceImages.length > 0 ? referenceImages : undefined,
                num_images: 1,
                aspect_ratio: aspectRatio,
                output_format: outputFormat,
                resolution,
              }),
            })
            const submitData = await res.json()
            if (!res.ok || !submitData.success) {
              onUpdatePending(sid, { status: "failed", error: submitData.error || "Submission failed" })
              return
            }
            const klingO3Cost = calcTicketCost("kling-o3-image", quality)
            const klingO3RefUrls = submitData.permanentReferenceUrls?.length ? submitData.permanentReferenceUrls : permanentRefUrls
            onDeductTickets?.(klingO3Cost)
            if (submitData.queued) {
              onUpdatePending(sid, {
                queueJobId: submitData.queueId,
                nb2StatusUrl: "/api/admin/kling-o3-status",
                nb2AspectRatio: aspectRatio,
                nb2OutputFormat: outputFormat,
                nb2Quality: quality,
                nb2TicketCost: klingO3Cost,
                referenceImageUrls: klingO3RefUrls,
              })
              return
            }
            const { requestId, falEndpoint } = submitData
            onUpdatePending(sid, {
              nb2RequestId: requestId,
              nb2FalEndpoint: falEndpoint,
              nb2OutputFormat: outputFormat,
              nb2AspectRatio: aspectRatio,
              nb2StatusUrl: "/api/admin/kling-o3-status",
              nb2Quality: quality,
              nb2TicketCost: klingO3Cost,
              referenceImageUrls: klingO3RefUrls,
            })
            onStartNb2Polling(requestId, falEndpoint, [sid], currentPrompt, outputFormat, aspectRatio, "/api/admin/kling-o3-status", quality, klingO3Cost, klingO3RefUrls)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- Wan 2.7 Pro: one FAL job per slot ---
      if (model.id === "wan-2.7-pro") {
        const imageUrls = referenceImages.length > 0 ? referenceImages : undefined
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/wan-27-pro-submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                image_urls: imageUrls,
                aspect_ratio: aspectRatio,
                num_images: 1,
                enable_safety_checker: wanSafetyChecker,
              }),
            })
            const submitData = await res.json()
            if (!res.ok || !submitData.success) {
              onUpdatePending(sid, { status: "failed", error: submitData.error || "Submission failed" })
              return
            }
            const wan27Cost = calcTicketCost("wan-2.7-pro", quality)
            const wan27RefUrls = submitData.permanentReferenceUrls?.length ? submitData.permanentReferenceUrls : permanentRefUrls
            onDeductTickets?.(wan27Cost)
            if (submitData.queued) {
              onUpdatePending(sid, {
                queueJobId: submitData.queueId,
                nb2StatusUrl: "/api/admin/wan-27-pro-status",
                nb2AspectRatio: aspectRatio,
                nb2TicketCost: wan27Cost,
                referenceImageUrls: wan27RefUrls,
              })
              return
            }
            const { requestId, falEndpoint } = submitData
            onUpdatePending(sid, {
              nb2RequestId: requestId,
              nb2FalEndpoint: falEndpoint,
              nb2AspectRatio: aspectRatio,
              nb2StatusUrl: "/api/admin/wan-27-pro-status",
              nb2TicketCost: wan27Cost,
              referenceImageUrls: wan27RefUrls,
            })
            onStartNb2Polling(requestId, falEndpoint, [sid], currentPrompt, outputFormat, aspectRatio, "/api/admin/wan-27-pro-status", undefined, wan27Cost, wan27RefUrls)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- ChatGPT Images 2.0: streaming with submit+poll fallback ---
      // Single reader loop with a Promise-based button unlock so no SSE lines are ever dropped.
      // Button waits until the 'submitted' event (same timing as other models' queue submit).
      // requestId stored in slot immediately → survives refresh via polling fallback.
      if (model.id === "gpt-image-2") {
        const gptCost = calcTicketCost("gpt-image-2", quality, aspectRatio)
        await Promise.all(slotIds.map(async (sid) => {
          // Pre-write slot to sessionStorage immediately so it's guaranteed present
          // when the 'submitted' SSE event arrives, regardless of useEffect timing.
          try {
            const stored = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
            if (!stored.find((s: any) => s.slotId === sid)) {
              stored.unshift({ slotId: sid, status: "loading", prompt: currentPrompt, nb2StatusUrl: "/api/admin/gpt-image-2-status", nb2AspectRatio: aspectRatio, nb2Quality: quality, nb2TicketCost: gptCost, referenceImageUrls: permanentRefUrls })
              localStorage.setItem("pv2-pending-slots", JSON.stringify(stored))
            }
          } catch {}
          try {
            const res = await fetch("/api/admin/gpt-image-2-stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                quality,
                size: aspectRatio,
                outputFormat,
                referenceImages,
                referenceImageUrls: permanentRefUrls,
                ticketCost: gptCost,
              }),
            })
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}))
              onUpdatePending(sid, { status: "failed", error: errData.error || "Submission failed" })
              // Remove the pre-written slot from sessionStorage — no requestId, can't poll
              try {
                const stored = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
                localStorage.setItem("pv2-pending-slots", JSON.stringify(stored.filter((s: any) => s.slotId !== sid)))
              } catch {}
              return
            }
            // tickets are deducted inside the 'submitted' handler — AFTER the slot is
            // written to sessionStorage with nb2RequestId. This guarantees:
            // "if tickets are deducted → slot has nb2RequestId in sessionStorage → survives refresh"
            let ticketsCharged = false

            // unlockButton() is called when we get 'submitted' (or on error/stream-end).
            // The outer await resolves then, unlocking the generate button.
            let unlockButton = () => {}
            const buttonUnlocked = new Promise<void>(r => { unlockButton = r })

            // Single background loop — reads every SSE event without dropping any lines.
            void (async () => {
              const reader = res.body!.getReader()
              const decoder = new TextDecoder()
              let buffer = ""
              let gptRefUrls = permanentRefUrls
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split("\n")
                  buffer = lines.pop() ?? ""
                  for (const line of lines) {
                    if (!line.startsWith("data: ")) continue
                    try {
                      const event = JSON.parse(line.slice(6))
                      if (event.type === "submitted") {
                        gptRefUrls = event.permanentReferenceUrls?.length ? event.permanentReferenceUrls : permanentRefUrls
                        onUpdatePending(sid, {
                          nb2RequestId:   event.requestId,
                          nb2FalEndpoint: event.falEndpoint,
                          nb2AspectRatio: aspectRatio,
                          nb2Quality:     quality,
                          nb2StatusUrl:   "/api/admin/gpt-image-2-status",
                          nb2TicketCost:  gptCost,
                          referenceImageUrls: gptRefUrls,
                        })
                        // Write slot to sessionStorage FIRST (with nb2RequestId),
                        // THEN charge tickets — so "tickets charged" always means "slot persisted".
                        if (event.requestId) {
                          try {
                            const stored = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
                            const slotData = {
                              slotId:         sid,
                              status:         "loading",
                              prompt:         currentPrompt,
                              nb2RequestId:   event.requestId,
                              nb2FalEndpoint: event.falEndpoint,
                              nb2StatusUrl:   "/api/admin/gpt-image-2-status",
                              nb2AspectRatio: aspectRatio,
                              nb2Quality:     quality,
                              nb2TicketCost:  gptCost,
                              referenceImageUrls: gptRefUrls,
                            }
                            const idx = stored.findIndex((s: any) => s.slotId === sid)
                            if (idx >= 0) {
                              stored[idx] = { ...stored[idx], ...slotData }
                            } else {
                              stored.unshift(slotData)
                            }
                            localStorage.setItem("pv2-pending-slots", JSON.stringify(stored))
                          } catch {}
                          // Charge tickets only after slot is persisted
                          ticketsCharged = true
                          onDeductTickets?.(gptCost)
                          onStartNb2Polling(event.requestId, event.falEndpoint, [sid], currentPrompt, "png", aspectRatio, "/api/admin/gpt-image-2-status", quality, gptCost, gptRefUrls)
                        }
                        unlockButton()
                      } else if (event.type === "partial" && event.url) {
                        onUpdatePending(sid, { streamDataUrl: event.url })
                      } else if (event.type === "complete") {
                        const reqId = event.requestId
                        if (reqId) {
                          // Cancel nb2 polling immediately so it can't also prepend the image
                          onCancelNb2Polling(reqId)
                          try {
                            const done = JSON.parse(localStorage.getItem("pv2-nb2-done") || "[]") as string[]
                            if (!done.includes(reqId)) localStorage.setItem("pv2-nb2-done", JSON.stringify([...done.slice(-20), reqId]))
                          } catch {}
                        }
                        const imgs = (event.images || []) as { url: string; dbId?: number | null }[]
                        imgs.forEach((img, i) =>
                          onPrependImage({
                            id: img.dbId ?? (Date.now() + i),
                            imageUrl: img.url,
                            prompt: currentPrompt,
                            model: "gpt-image-2",
                            createdAt: new Date().toISOString(),
                            aspectRatio,
                            quality,
                            referenceImageUrls: (event.permanentReferenceUrls?.length ? event.permanentReferenceUrls : gptRefUrls) || [],
                          })
                        )
                        onRemovePending(sid)
                      } else if (event.type === "error") {
                        onUpdatePending(sid, { status: "failed", error: event.error || "Generation failed" })
                        if (ticketsCharged) {
                          fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: gptCost }) })
                            .then(r => r.json()).then(d => { if (d.newBalance !== undefined) onBalanceChange(d.newBalance) }).catch(() => {})
                        }
                        unlockButton()
                      }
                    } catch {}
                  }
                }
              } catch {}
              // If stream died before 'submitted' (no tickets charged), clean up the ghost slot
              if (!ticketsCharged) {
                try {
                  const stored = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
                  localStorage.setItem("pv2-pending-slots", JSON.stringify(stored.filter((s: any) => s.slotId !== sid)))
                } catch {}
              }
              unlockButton() // ensure button unlocks even if stream dies unexpectedly
            })()

            await buttonUnlocked
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- Gemini image models: async submit so the button unlocks immediately ---
      if (model.id === "pro-scanner-v3" || model.id === "flash-scanner-v2.5") {
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/admin/gemini-submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: currentPrompt,
                model: model.apiId,
                quality,
                aspectRatio,
                referenceImages,
                referenceImageUrls: permanentRefUrls,
              }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
              onUpdatePending(sid, { status: "failed", error: data.error || "Generation failed" })
              return
            }
            if (data.newBalance !== undefined) onBalanceChange(data.newBalance)
            onUpdatePending(sid, { queueId: data.queueId })
            onStartPolling(sid, data.queueId, currentPrompt)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
        return
      }

      // --- FAL async (NB Pro, SeeDream 4.5, FLUX 2 multi-image) ---
      if (model.isFal && count > 1) {
        // Submit N separate jobs concurrently — each gets its own queue entry and slot
        await Promise.all(slotIds.map(async (sid) => {
          try {
            const res = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: currentPrompt, model: model.apiId, quality, aspectRatio, referenceImages, loraUrl: selectedLoraUrl || undefined, loraName: selectedLoraUrl ? (loraJobs.find(j => j.loraUrl === selectedLoraUrl)?.name || undefined) : undefined, loraScale: selectedLoraUrl ? loraScale : undefined, loraGuidanceScale: selectedLoraUrl ? loraGuidanceScale : undefined, loraSteps: selectedLoraUrl ? loraSteps : undefined, ...(model.id === "seedream-4.5" ? { seedreamSafetyChecker } : {}), ...(model.id === "flux-1-dev" ? { fluxDevSafetyChecker } : {}) }),
            })
            const data = await res.json()
            if (!res.ok) { onUpdatePending(sid, { status: "failed", error: data.error || "Generation failed" }); return }
            if (data.newBalance !== undefined) onBalanceChange(data.newBalance)
            onUpdatePending(sid, { queueId: data.queueId })
            onStartPolling(sid, data.queueId, currentPrompt)
          } catch (err: any) {
            onUpdatePending(sid, { status: "failed", error: err.message || "Network error" })
          }
        }))
      } else {
        // Single FAL request (count=1)
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: currentPrompt, model: model.apiId, quality, aspectRatio, referenceImages, loraUrl: selectedLoraUrl || undefined, loraName: selectedLoraUrl ? (loraJobs.find(j => j.loraUrl === selectedLoraUrl)?.name || undefined) : undefined, loraScale: selectedLoraUrl ? loraScale : undefined, loraGuidanceScale: selectedLoraUrl ? loraGuidanceScale : undefined, loraSteps: selectedLoraUrl ? loraSteps : undefined, ...(model.id === "seedream-4.5" ? { seedreamSafetyChecker } : {}), ...(model.id === "flux-1-dev" ? { fluxDevSafetyChecker } : {}) }),
        })
        const data = await res.json()
        if (!res.ok) {
          onUpdatePending(slotId, { status: "failed", error: data.error || "Generation failed" })
          return
        }
        if (data.newBalance !== undefined) onBalanceChange(data.newBalance)
        onUpdatePending(slotId, { queueId: data.queueId })
        onStartPolling(slotId, data.queueId, currentPrompt)
      }
    } catch (err: any) {
      slotIds.forEach(sid => onUpdatePending(sid, { status: "failed", error: err.message || "Network error" }))
    } finally {
      setGenerating(false)
    }
  }

  const handleLoadPreset = (urls: string[]) => onLoadPreset(urls)

  // Reset aspect ratio, quality, and image count when model changes
  useEffect(() => {
    if (!model.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(model.aspectRatios[0])
    }
    const availableQualities = model.qualityOptions ?? (["2k", "4k"] as Quality[])
    if (!availableQualities.includes(quality)) {
      setQuality(availableQualities[0])
    }
    if (imageCount > (model.maxImages ?? 1)) {
      setImageCount(1)
    }
  }, [model])

  const CUSTOM_LORAS_KEY = "portal-v2-custom-loras"

  function loadCustomLoras(): Array<{ id: number; name: string; loraUrl: string; custom: true }> {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_LORAS_KEY) ?? "[]")
    } catch { return [] }
  }

  function saveCustomLoras(loras: Array<{ id: number; name: string; loraUrl: string; custom: true }>) {
    localStorage.setItem(CUSTOM_LORAS_KEY, JSON.stringify(loras))
  }

  // Which training model IDs produce LoRAs compatible with each portal model
  const LORA_TRAINER_COMPAT: Record<string, string[]> = {
    "flux-1-dev":   ["fal-ai/flux-lora-fast-training"],
    "flux-2":       ["fal-ai/flux-2-trainer"],
    "z-image-turbo":["fal-ai/z-image-turbo-trainer-v2"],
    "z-image-base": [], // no dedicated trainer yet — custom uploads only
  }

  // Fetch completed LoRA jobs when a LoRA-capable model is selected
  const isZImageModel = model.id === "z-image-base" || model.id === "z-image-turbo" || model.id === "flux-2" || model.id === "flux-1-dev"
  useEffect(() => {
    if (!isZImageModel) { setSelectedLoraUrl(null); setLoraJobs([]); return }
    const customLoras = loadCustomLoras()
    const compatTrainers = LORA_TRAINER_COMPAT[model.id] ?? []
    const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
    fetch("/api/admin/lora-training/jobs", { headers: pass ? { "x-admin-password": pass } : {} })
      .then(r => r.json())
      .then((data: { jobs: Array<{ id: number; name: string; loraUrl: string | null; status: string; modelId: string; config: Record<string, unknown> }> }) => {
        const completed = (data.jobs ?? []).filter(j =>
          j.status === "completed" && j.loraUrl &&
          (compatTrainers.length === 0 || compatTrainers.includes(j.modelId))
        )
        setLoraJobs([
          ...completed.map(j => ({
            id: j.id,
            name: j.name,
            loraUrl: j.loraUrl!,
            triggerWord: j.config?.trigger_word as string | undefined,
          })),
          ...customLoras,
        ])
      })
      .catch(() => { setLoraJobs(customLoras) })
  }, [model.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset LoRA config to model-appropriate defaults when model changes
  useEffect(() => {
    setLoraScale(1.0)
    setLoraGuidanceScale(model.id === 'flux-2' ? 2.5 : 3.5)
    setLoraSteps(model.id === 'flux-2' ? 28 : model.id === 'flux-1-dev' ? 28 : 30)
  }, [model.id])

  // Close lora picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (loraPickerRef.current && !loraPickerRef.current.contains(e.target as Node)) setLoraPickerOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Upload a local file through our server to R2 (avoids browser CORS on direct PUT)
  async function uploadUpscaleSource(file: File) {
    setUpscaleUploading(true)
    setUpscaleUploadError(null)
    try {
      const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/admin/upload-upscale-source", {
        method: "POST",
        headers: { ...(pass ? { "x-admin-password": pass } : {}) },
        body: form,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed: ${res.status}`)
      }
      const { publicUrl } = await res.json() as { publicUrl: string }
      setUpscaleSourceUrl(publicUrl)
    } catch (e) {
      setUpscaleUploadError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUpscaleUploading(false)
    }
  }

  async function selectRefAsUpscaleSource(img: RefImage) {
    setUpscaleUploadError(null)
    setSelectedRefId(img.id)
    if (img.url.startsWith("http")) {
      setUpscaleSourceUrl(img.url)
    } else {
      // data URL → convert to blob → upload to R2
      try {
        const res = await fetch(img.url)
        const blob = await res.blob()
        const file = new File([blob], "ref.jpg", { type: blob.type || "image/jpeg" })
        await uploadUpscaleSource(file)
      } catch {
        setUpscaleUploadError("Failed to use this image — try again")
        setSelectedRefId(null)
      }
    }
  }

  const [showModelPicker, setShowModelPicker] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showModelPicker) return
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showModelPicker])

  useEffect(() => {
    if (!showCheckpointPicker) return
    function handleClick(e: MouseEvent) {
      if (checkpointPickerRef.current && !checkpointPickerRef.current.contains(e.target as Node)) {
        setShowCheckpointPicker(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showCheckpointPicker])

  return (
    <div className="fixed bottom-0 left-0 right-0 px-6 pb-6 pt-3 bg-gradient-to-t from-[#050810] via-[#050810]/80 to-transparent pointer-events-none">
      <div className="max-w-3xl mx-auto pointer-events-auto space-y-2">

        {/* Active reference image previews — click to edit */}
        {activeRefImages.length > 0 && (
          <div className="flex items-center gap-2 px-1 flex-wrap">
            {activeRefImages.map((img) => (
              <div key={img.id} className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-cyan-500/30 group cursor-pointer"
                onClick={() => setEditingRefImage(img)}
                title="Click to edit">
                <img src={img.url} alt="reference" className="w-full h-full object-cover" />
                {/* Edit hint overlay */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Pencil size={14} className="text-white" />
                </div>
                {/* Deactivate button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onDeactivateRef(img.id) }}
                  title="Remove"
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <X size={9} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Ref image editor modal */}
        {editingRefImage && (
          <RefImageEditorModal
            image={editingRefImage}
            onApply={(newUrl) => {
              onEditRef(editingRefImage.id, newUrl)
              setEditingRefImage(null)
            }}
            onClose={() => setEditingRefImage(null)}
          />
        )}

        {/* Hidden file input for upscaler upload */}
        <input
          ref={upscaleFileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) { setSelectedRefId(null); uploadUpscaleSource(f) }
          }}
        />

        {/* Prompt card */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-md shadow-2xl">

          {/* Upscaler source picker — unified for all 5 upscaler models */}
          {model.isUpscaler && (
            <div className="px-4 pt-4 pb-3 space-y-2.5 border-b border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-cyan-400/60 uppercase tracking-widest">Source Image</span>
                {upscaleSourceUrl && (
                  <button
                    onClick={() => { setUpscaleSourceUrl(""); setSelectedRefId(null) }}
                    className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors"
                  >clear</button>
                )}
              </div>

              {refLibrary.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {refLibrary.map(img => {
                    const isSelected = selectedRefId === img.id || (img.url.startsWith("http") && upscaleSourceUrl === img.url)
                    const isUploading = upscaleUploading && selectedRefId === img.id
                    return (
                      <button
                        key={img.id}
                        onClick={() => selectRefAsUpscaleSource(img)}
                        disabled={upscaleUploading}
                        title="Use as upscale source"
                        className={`relative w-12 h-12 rounded-lg overflow-hidden border shrink-0 transition-all disabled:opacity-50 ${
                          isSelected ? "border-cyan-400 ring-1 ring-cyan-400/40" : "border-white/10 hover:border-cyan-400/50"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                        {isUploading && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <Loader2 size={14} className="animate-spin text-cyan-400" />
                          </div>
                        )}
                        {isSelected && !isUploading && (
                          <div className="absolute inset-0 bg-cyan-500/10 flex items-center justify-center">
                            <Check size={14} className="text-cyan-400" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">No images in your Refs library yet — add some via the <span className="text-slate-400">Refs</span> section above.</p>
              )}

              {/* URL paste + upload */}
              <div className="flex items-center gap-2">
                {upscaleSourceUrl.startsWith("http") && !upscaleUploading && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={upscaleSourceUrl}
                    alt="source preview"
                    className="w-8 h-8 rounded-md object-cover border border-white/10 shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
                    onLoad={e => { (e.target as HTMLImageElement).style.display = "block" }}
                  />
                )}
                <input
                  type="text"
                  value={upscaleSourceUrl}
                  onChange={e => { setUpscaleSourceUrl(e.target.value); setUpscaleUploadError(null); setSelectedRefId(null) }}
                  placeholder="Or paste an image URL…"
                  className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none min-w-0"
                />
                <button
                  onClick={() => upscaleFileInputRef.current?.click()}
                  disabled={upscaleUploading}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[11px] text-slate-300 hover:text-white transition-all disabled:opacity-50 shrink-0"
                >
                  {upscaleUploading && !selectedRefId
                    ? <><Loader2 size={11} className="animate-spin" />Uploading…</>
                    : <><ImagePlus size={11} />Upload</>
                  }
                </button>
              </div>
              {upscaleUploadError && <p className="text-[11px] text-red-400">{upscaleUploadError}</p>}
            </div>
          )}

          {/* Textarea — hidden for upscaler (prompt not used) */}
          {!model.isUpscaler && (
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate() }}
              placeholder="Describe what you want to create..."
              rows={1}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 160) + "px"
              }}
              className="w-full resize-none bg-transparent px-5 pt-4 pb-3 text-sm text-white placeholder-slate-500 focus:outline-none leading-relaxed"
            />
          )}

          {/* LoRA config row — visible when a LoRA is active */}
          {isZImageModel && selectedLoraUrl && (
            <div className="px-4 py-3 border-t border-violet-500/10 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-violet-400/50 uppercase tracking-wider">LoRA Config</span>
                <button
                  onClick={() => {
                    setLoraScale(1.0)
                    setLoraGuidanceScale(model.id === 'flux-2' ? 2.5 : 3.5)
                    setLoraSteps(28)
                  }}
                  className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors"
                >reset</button>
              </div>

              {/* Scale */}
              <div className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Scale</span>
                <input
                  type="range" min="0" max="2" step="0.05" value={loraScale}
                  onChange={e => setLoraScale(parseFloat(e.target.value))}
                  className="w-full accent-violet-400 cursor-pointer h-0.5"
                />
                <span className="text-[11px] font-mono text-violet-300 tabular-nums text-right">{loraScale.toFixed(2)}</span>
              </div>

              {/* CFG */}
              <div className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">CFG</span>
                <input
                  type="range" min="1" max="15" step="0.5" value={loraGuidanceScale}
                  onChange={e => setLoraGuidanceScale(parseFloat(e.target.value))}
                  className="w-full accent-violet-400 cursor-pointer h-0.5"
                />
                <span className="text-[11px] font-mono text-violet-300 tabular-nums text-right">{loraGuidanceScale.toFixed(1)}</span>
              </div>

              {/* Steps */}
              <div className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Steps</span>
                <input
                  type="range" min="10" max="60" step="1" value={loraSteps}
                  onChange={e => setLoraSteps(parseInt(e.target.value))}
                  className="w-full accent-violet-400 cursor-pointer h-0.5"
                />
                <span className="text-[11px] font-mono text-violet-300 tabular-nums text-right">{loraSteps}</span>
              </div>
            </div>
          )}

          {/* AuraSR config — checkpoint + overlapping tiles */}
          {model.id === "aura-sr" && (
            <div className="px-4 py-3 border-t border-cyan-500/10 space-y-2.5">
              <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">AuraSR</span>
              {/* Checkpoint */}
              <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Checkpoint</span>
                <div className="flex rounded-md overflow-hidden border border-white/10 w-fit">
                  {(["v1", "v2"] as const).map(v => (
                    <button key={v} onClick={() => setAuraSrCheckpoint(v)}
                      className={`px-3 py-1 text-[11px] font-mono transition-colors ${auraSrCheckpoint === v ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              {/* Overlapping tiles */}
              <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500">Overlap Tiles</span>
                <button
                  onClick={() => setAuraSrOverlappingTiles(v => !v)}
                  className={`flex items-center gap-1.5 w-fit px-3 py-1 rounded-md border text-[11px] font-mono transition-all ${
                    auraSrOverlappingTiles
                      ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                      : "border-white/10 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {auraSrOverlappingTiles ? "On · 2× slower" : "Off"}
                </button>
              </div>
            </div>
          )}

          {/* DRCT info — no config params, just pricing note */}
          {model.id === "drct" && (
            <div className="px-4 py-3 border-t border-cyan-500/10 flex items-start gap-2">
              <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider shrink-0 mt-0.5">DRCT</span>
              <p className="text-[11px] text-slate-500 leading-relaxed">Transformer upscaler — no extra settings. Tickets scale with output size: 1 ticket per 2 MP (1 ticket at 1024², up to 9 at 4096²).</p>
            </div>
          )}

          {/* ESRGAN config — model picker, face toggle, output format */}
          {model.id === "esrgan" && (
            <div className="px-4 py-3 border-t border-cyan-500/10 space-y-2.5">
              <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">ESRGAN</span>
              {/* Model picker */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-mono text-slate-500">Model</span>
                <div className="flex flex-wrap gap-1.5">
                  {ESRGAN_MODELS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setEsrganModel(m.id)}
                      title={m.desc}
                      className={`px-2.5 py-1 rounded-md border text-[11px] font-mono transition-all ${
                        esrganModel === m.id
                          ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                          : "border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Face + format row */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                  <span className="text-[10px] font-mono text-slate-500">Face Mode</span>
                  <button
                    onClick={() => setEsrganFace(v => !v)}
                    className={`flex items-center gap-1.5 w-fit px-3 py-1 rounded-md border text-[11px] font-mono transition-all ${
                      esrganFace
                        ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                        : "border-white/10 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {esrganFace ? "On" : "Off"}
                  </button>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                  <span className="text-[10px] font-mono text-slate-500">Format</span>
                  <div className="flex rounded-md overflow-hidden border border-white/10 w-fit">
                    {(["png", "jpeg"] as const).map(f => (
                      <button key={f} onClick={() => setEsrganOutputFormat(f)}
                        className={`px-3 py-1 text-[11px] font-mono transition-colors ${esrganOutputFormat === f ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUPIR config — collapsible settings */}
          {model.id === "supir" && (
            <div className="border-t border-cyan-500/10">
              {/* Always-visible row: label + config toggle */}
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">SUPIR</span>
                <button onClick={() => setSupirConfigOpen(v => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] text-[10px] font-mono text-slate-500 hover:text-white hover:border-white/20 transition-all">
                  <SlidersHorizontal size={9} />
                  <span>{supirModelName === "SUPIR-v0F" ? "v0F" : "v0Q"} · {supirSteps}s</span>
                  <ChevronDown size={9} className={`transition-transform ${supirConfigOpen ? "rotate-180" : ""}`} />
                </button>
              </div>

              {/* Collapsible settings panel */}
              {supirConfigOpen && (
                <div className="px-4 pb-3 space-y-2.5 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">Config</span>
                    <button onClick={() => { setSupirModelName("SUPIR-v0F"); setSupirSteps(20); setSupirUseLlava(false); setSupirCfg(4.0); setSupirColorFix("Wavelet"); setSupirNegPrompt("blurry, noisy, low quality, oversmoothed, jpeg artifacts, deformed") }}
                      className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors">reset</button>
                  </div>
                  {/* Variant */}
                  <div className="grid grid-cols-[5rem_1fr] items-start gap-3">
                    <span className="text-[10px] font-mono text-slate-500 mt-1">Variant</span>
                    <div className="flex gap-1">
                      {([
                        { id: "SUPIR-v0F" as const, label: "v0F", desc: "General" },
                        { id: "SUPIR-v0Q" as const, label: "v0Q", desc: "Faithful" },
                      ]).map(v => (
                        <button key={v.id} onClick={() => setSupirModelName(v.id)}
                          className={`flex-1 flex flex-col items-center px-2 py-1.5 rounded-md border text-center transition-all ${
                            supirModelName === v.id
                              ? "bg-cyan-500/15 border-cyan-500/30"
                              : "border-white/[0.06] hover:border-white/20"
                          }`}>
                          <span className={`text-[11px] font-mono font-bold ${supirModelName === v.id ? "text-cyan-300" : "text-slate-400"}`}>{v.label}</span>
                          <span className="text-[9px] text-slate-600">{v.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Steps */}
                  <div className="grid grid-cols-[5rem_1fr_2rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Steps</span>
                    <input type="range" min={10} max={50} step={5} value={supirSteps}
                      onChange={e => setSupirSteps(parseInt(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{supirSteps}</span>
                  </div>
                  {/* Guidance */}
                  <div className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Guidance</span>
                    <input type="range" min={1} max={12} step={0.5} value={supirCfg}
                      onChange={e => setSupirCfg(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{supirCfg.toFixed(1)}</span>
                  </div>
                  {/* Color fix */}
                  <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Color fix</span>
                    <div className="flex gap-1">
                      {(["Wavelet", "AdaIn", "None"] as const).map(opt => (
                        <button key={opt} onClick={() => setSupirColorFix(opt)}
                          className={`flex-1 px-2 py-1 rounded-md border text-[10px] font-mono transition-all ${
                            supirColorFix === opt
                              ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
                              : "border-white/[0.06] text-slate-500 hover:text-white hover:border-white/20"
                          }`}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Caption */}
                  <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Caption</span>
                    <button onClick={() => setSupirUseLlava(v => !v)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all ${
                        supirUseLlava ? "bg-cyan-500/15 border-cyan-500/30" : "border-white/[0.06] hover:border-white/20"
                      }`}>
                      <span className={`text-[11px] font-mono font-bold ${supirUseLlava ? "text-cyan-300" : "text-slate-500"}`}>
                        {supirUseLlava ? "LLaVA ON" : "LLaVA OFF"}
                      </span>
                      {supirUseLlava && <span className="text-[9px] text-amber-400/70">may OOM on 4x</span>}
                    </button>
                  </div>
                  {/* Negative prompt */}
                  <div className="grid grid-cols-[5rem_1fr] items-start gap-3">
                    <span className="text-[10px] font-mono text-slate-500 mt-1.5">Negative</span>
                    <textarea value={supirNegPrompt} onChange={e => setSupirNegPrompt(e.target.value)} rows={2}
                      placeholder="What to suppress…"
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/30 resize-none leading-relaxed" />
                  </div>
                  <p className="text-[10px] text-slate-600">
                    {upscaleFactor === 4 ? "4x: keep steps ≤ 20, caption OFF." : "2x: any step count works."} 8 tickets flat.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Clarity Upscaler config — collapsible */}
          {model.id === "clarity-upscaler" && (
            <div className="border-t border-cyan-500/10">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">Enhance</span>
                <button onClick={() => setClarityConfigOpen(v => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] text-[10px] font-mono text-slate-500 hover:text-white hover:border-white/20 transition-all">
                  <SlidersHorizontal size={9} />
                  <span>cr:{upscaleCreativity.toFixed(2)} · re:{upscaleResemblance.toFixed(2)} · {upscaleSteps}s</span>
                  <ChevronDown size={9} className={`transition-transform ${clarityConfigOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              {clarityConfigOpen && (
                <div className="px-4 pb-3 space-y-2 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[10px] font-mono text-cyan-400/50 uppercase tracking-wider">Config</span>
                    <button onClick={() => { setUpscaleCreativity(0.35); setUpscaleResemblance(0.6); setUpscaleGuidance(4); setUpscaleSteps(18) }}
                      className="text-[10px] font-mono text-slate-600 hover:text-slate-400 transition-colors">reset</button>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Creativity</span>
                    <input type="range" min="0" max="1" step="0.05" value={upscaleCreativity}
                      onChange={e => setUpscaleCreativity(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{upscaleCreativity.toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Resemblance</span>
                    <input type="range" min="0" max="1" step="0.05" value={upscaleResemblance}
                      onChange={e => setUpscaleResemblance(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{upscaleResemblance.toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">CFG</span>
                    <input type="range" min="1" max="10" step="0.5" value={upscaleGuidance}
                      onChange={e => setUpscaleGuidance(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{upscaleGuidance.toFixed(1)}</span>
                  </div>
                  <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
                    <span className="text-[10px] font-mono text-slate-500">Steps</span>
                    <input type="range" min="10" max="30" step="1" value={upscaleSteps}
                      onChange={e => setUpscaleSteps(parseInt(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-0.5" />
                    <span className="text-[11px] font-mono text-cyan-300 tabular-nums text-right">{upscaleSteps}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Controls strip */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-3 pt-1 border-t border-white/5">
            {/* Model picker badge */}
            <div className="relative shrink-0" ref={modelPickerRef}>
              <button
                onClick={() => setShowModelPicker((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${
                  showModelPicker
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
                }`}
              >
                {model.name}
                <ChevronDown size={10} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
              </button>

              {showModelPicker && (
                <div className="absolute bottom-full left-0 mb-2 w-[428px] rounded-xl border border-white/10 bg-[#080c18] backdrop-blur-md shadow-2xl overflow-hidden z-50">
                  {/* Header */}
                  <div className="px-4 pt-3 pb-2.5 border-b border-white/5">
                    <p className="text-[12px] font-semibold text-white/85 leading-none">Image Generation Model</p>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Models are grouped by company.{" "}
                      <span className="text-slate-600">Active: <span className="text-slate-400">{model.name}</span></span>
                    </p>
                  </div>

                  {/* 2-col grid of company sections */}
                  <div className="p-2.5 grid grid-cols-2 gap-x-2 gap-y-2 overflow-y-auto max-h-[360px]">
                    {IMAGE_MODEL_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="flex items-center gap-1.5 px-1.5 pb-1">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${group.dot}`} />
                          <span className={`text-[9px] font-bold tracking-widest uppercase leading-none ${group.accent}`}>{group.label}</span>
                          <span className="text-[8px] text-slate-600 leading-none truncate">· {group.type}</span>
                        </div>
                        <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                          {group.items.map((item) => {
                            const cfg = IMAGE_MODEL_CONFIGS.find((m) => m.name === item)
                            const isActive = model.name === item
                            return (
                              <button
                                key={item}
                                onClick={() => { if (cfg) { onModelChange(cfg); setShowModelPicker(false) } }}
                                className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-1 border-b border-white/[0.04] last:border-0 ${
                                  isActive
                                    ? "bg-white/8 text-white font-medium"
                                    : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                                }`}
                              >
                                <span className="truncate leading-tight">{item}</span>
                                <span className="shrink-0 flex items-center gap-1">
                                  {isActive && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                                  {IMAGE_MODEL_COST_BY_NAME[item] && <CostBadge tier={IMAGE_MODEL_COST_BY_NAME[item]} />}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Admin Models — full-width block with RunPod + Upscalers subsections */}
                    {isAdminAccount && (
                      <div className="col-span-2 mt-0.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] overflow-hidden">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-cyan-500/10">
                          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
                          <span className="text-[9px] font-bold tracking-widest uppercase text-cyan-400">Admin Models</span>
                          <span className="text-[8px] text-slate-600">· admin only</span>
                        </div>
                        <div className="p-2 grid grid-cols-2 gap-x-2">
                          {ADMIN_IMAGE_MODEL_GROUPS.map((sub) => (
                            <div key={sub.label}>
                              <div className="flex items-center gap-1.5 px-1.5 pb-1">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sub.dot}`} />
                                <span className={`text-[9px] font-bold tracking-widest uppercase leading-none ${sub.accent}`}>{sub.label}</span>
                                <span className="text-[8px] text-slate-600 leading-none truncate">· {sub.type}</span>
                              </div>
                              <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                                {sub.items.map((item) => {
                                  const cfg = IMAGE_MODEL_CONFIGS.find((m) => m.name === item)
                                  const isActive = model.name === item
                                  return (
                                    <button
                                      key={item}
                                      onClick={() => { if (cfg) { onModelChange(cfg); setShowModelPicker(false) } }}
                                      className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-1 border-b border-white/[0.04] last:border-0 ${
                                        isActive
                                          ? "bg-white/8 text-white font-medium"
                                          : "text-slate-400 hover:text-white hover:bg-white/[0.05]"
                                      }`}
                                    >
                                      <span className="truncate leading-tight">{item}</span>
                                      <span className="shrink-0 flex items-center gap-1">
                                        {isActive && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                                        {IMAGE_MODEL_COST_BY_NAME[item] && <CostBadge tier={IMAGE_MODEL_COST_BY_NAME[item]} />}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-2 border-t border-white/5 flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] text-slate-600">Ticket cost:</span>
                    <span className="text-[9px] text-slate-500"><span className="text-green-400 font-bold font-mono">$</span> budget</span>
                    <span className="text-[9px] text-slate-600">·</span>
                    <span className="text-[9px] text-slate-500"><span className="text-amber-400 font-bold font-mono">$$</span> standard</span>
                    <span className="text-[9px] text-slate-600">·</span>
                    <span className="text-[9px] text-slate-500"><span className="text-rose-400 font-bold font-mono">$$$</span> premium</span>
                    <span className="text-[9px] text-slate-600">·</span>
                    <span className="text-[9px] text-slate-500"><span className="text-rose-300 font-bold font-mono">$$$+</span> expensive</span>
                  </div>
                </div>
              )}
            </div>

            {!model.isUpscaler && <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />}

            {/* Aspect ratio picker badge — hidden for upscaler */}
            {!model.isUpscaler && (
              <AspectRatioPicker
                ratios={model.aspectRatios}
                value={aspectRatio}
                onChange={setAspectRatio}
              />
            )}

            {/* Quality toggle — hidden for upscaler */}
            {model.supportsQuality && !model.isUpscaler && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <div className="flex items-center rounded-md overflow-hidden border border-white/10 shrink-0">
                  {(model.qualityOptions ?? (["2k", "4k"] as Quality[])).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className={`px-2.5 py-1 text-[11px] font-mono uppercase transition-colors ${
                        quality === q ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Upscale factor toggle — upscaler only */}
            {model.isUpscaler && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <div className="flex items-center rounded-md overflow-hidden border border-white/10 shrink-0">
                  {([2, 4] as (2 | 4)[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setUpscaleFactor(f)}
                      className={`px-2.5 py-1 text-[11px] font-mono transition-colors ${
                        upscaleFactor === f ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {f}x
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Checkpoint selector — local admin models only */}
            {model.isLocalModel && (() => {
              const visibleCheckpoints = localCheckpoints.filter(c => model.id === 'local-neosr' ? c.arch === 'neosr' : c.arch === 'esrgan')
              const ckLabel = visibleCheckpoints.find(c => c.path === selectedLocalCheckpoint)
              const [ckOpen, setCkOpen] = [showCheckpointPicker, setShowCheckpointPicker]
              return (
                <>
                  <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                  <div className="relative shrink-0" ref={checkpointPickerRef}>
                    <button
                      onClick={() => setCkOpen(v => !v)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/[0.06] text-[11px] text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all max-w-[160px]"
                    >
                      <span className="truncate">
                        {visibleCheckpoints.length === 0
                          ? "No checkpoints"
                          : ckLabel ? `${ckLabel.experiment} · ${(ckLabel.iter / 1000).toFixed(0)}k` : "Select checkpoint"}
                      </span>
                      <ChevronDown size={10} className={`shrink-0 transition-transform ${ckOpen ? "rotate-180" : ""}`} />
                    </button>
                    {ckOpen && visibleCheckpoints.length > 0 && (() => {
                      const pretrained = visibleCheckpoints.filter(c => c.experiment === 'pretrained')
                      const trained    = visibleCheckpoints.filter(c => c.experiment !== 'pretrained')
                      const renderCk = (ck: typeof visibleCheckpoints[0]) => (
                        <button
                          key={ck.path}
                          onClick={() => { setSelectedLocalCheckpoint(ck.path); setCkOpen(false) }}
                          className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-2 ${
                            selectedLocalCheckpoint === ck.path
                              ? "bg-cyan-500/10 text-cyan-300"
                              : "text-slate-400 hover:text-white hover:bg-white/5"
                          }`}
                        >
                          <span className="truncate">
                            {ck.experiment === 'pretrained'
                              ? ck.name.replace(/\.(pth|safetensors)$/, '')
                              : ck.experiment}
                          </span>
                          {ck.experiment !== 'pretrained' && (
                            <span className="font-mono text-[10px] shrink-0 text-slate-500">{(ck.iter / 1000).toFixed(0)}k</span>
                          )}
                        </button>
                      )
                      return (
                        <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[220px] rounded-xl bg-[#0e1018] border border-white/10 shadow-2xl overflow-hidden py-1">
                          {pretrained.length > 0 && (
                            <>
                              <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-500 uppercase tracking-wider">Pre-trained</div>
                              {pretrained.map(renderCk)}
                            </>
                          )}
                          {trained.length > 0 && (
                            <>
                              {pretrained.length > 0 && <div className="my-1 border-t border-white/5" />}
                              <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-slate-500 uppercase tracking-wider">Your checkpoints</div>
                              {trained.map(renderCk)}
                            </>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  <button
                    onClick={refreshCheckpoints}
                    disabled={checkpointLoading}
                    title="Refresh checkpoint list"
                    className="flex items-center justify-center w-6 h-6 rounded border border-white/10 bg-white/5 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors disabled:opacity-40 shrink-0"
                  >
                    <RefreshCw size={10} className={checkpointLoading ? "animate-spin" : ""} />
                  </button>
                </>
              )
            })()}

            {/* LoRA picker — z-image-base / z-image-turbo only */}
            {isZImageModel && !model.isUpscaler && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <div ref={loraPickerRef} className="relative shrink-0">
                  <button
                    onClick={() => { setLoraPickerOpen(v => !v); setShowAddLora(false) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all ${
                      selectedLoraUrl
                        ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                        : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <Sparkles size={11} />
                    {(() => {
                      if (!selectedLoraUrl) return "LoRA"
                      const job = loraJobs.find(j => j.loraUrl === selectedLoraUrl)
                      if (!job) return "LoRA"
                      return job.triggerWord ? `${job.name} · ${job.triggerWord}` : job.name
                    })()}
                  </button>
                  {loraPickerOpen && (
                    <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[220px] rounded-xl bg-[#131320] border border-white/[0.1] shadow-2xl overflow-hidden py-1">
                      <button
                        onClick={() => { setSelectedLoraUrl(null); setLoraPickerOpen(false) }}
                        className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${!selectedLoraUrl ? "text-violet-300 bg-violet-500/10" : "text-slate-400 hover:text-white hover:bg-white/[0.06]"}`}
                      >
                        No LoRA
                      </button>
                      {loraJobs.map(j => (
                        <div key={j.id} className="flex items-center group">
                          <button
                            onClick={() => { setSelectedLoraUrl(j.loraUrl); setLoraPickerOpen(false) }}
                            className={`flex-1 text-left px-3 py-2 text-[11px] transition-colors ${selectedLoraUrl === j.loraUrl ? "text-violet-300 bg-violet-500/10" : "text-slate-400 hover:text-white hover:bg-white/[0.06]"}`}
                          >
                            <div className="truncate">{j.name}{j.custom && <span className="ml-1 text-slate-600">·custom</span>}</div>
                            {j.triggerWord && <div className="text-[10px] text-amber-400/70 mt-0.5">trigger: <span className="font-mono">{j.triggerWord}</span></div>}
                          </button>
                          {j.custom && (
                            <button
                              onClick={() => {
                                const updated = loadCustomLoras().filter(c => c.loraUrl !== j.loraUrl)
                                saveCustomLoras(updated)
                                if (selectedLoraUrl === j.loraUrl) setSelectedLoraUrl(null)
                                setLoraJobs(prev => prev.filter(p => p.loraUrl !== j.loraUrl))
                              }}
                              className="px-2 py-2 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="border-t border-white/[0.06] mt-1 pt-1">
                        {!showAddLora ? (
                          <button
                            onClick={() => { setShowAddLora(true); setNewLoraName(""); setNewLoraUrl("") }}
                            className="w-full text-left px-3 py-2 text-[11px] text-slate-500 hover:text-violet-300 transition-colors"
                          >
                            + Add LoRA
                          </button>
                        ) : (
                          <div className="px-3 py-2 space-y-1.5">
                            <input
                              autoFocus
                              placeholder="Name"
                              value={newLoraName}
                              onChange={e => setNewLoraName(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
                            />
                            <input
                              placeholder="Paste URL  (or upload file below)"
                              value={newLoraUrl}
                              onChange={e => setNewLoraUrl(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
                            />
                            {/* File upload */}
                            <input
                              ref={loraFileInputRef}
                              type="file"
                              accept="*/*"
                              className="hidden"
                              onChange={async e => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                setLoraUploading(true)
                                try {
                                  // Step 1: get a presigned R2 PUT URL (bypasses Vercel 4.5 MB limit)
                                  const presignRes = await fetch('/api/admin/upload-lora', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ filename: file.name }),
                                  })
                                  const presignData = await presignRes.json()
                                  if (!presignData.uploadUrl) throw new Error(presignData.error || 'Failed to get upload URL')

                                  // Step 2: PUT file directly to R2 (no Vercel size limit)
                                  const putRes = await fetch(presignData.uploadUrl, {
                                    method: 'PUT',
                                    body: file,
                                    headers: { 'Content-Type': 'application/octet-stream' },
                                  })
                                  if (!putRes.ok) throw new Error(`R2 upload failed: ${putRes.status}`)

                                  setNewLoraUrl(presignData.publicUrl)
                                  if (!newLoraName) setNewLoraName(file.name.replace(/\.[^.]+$/, ''))
                                } catch (err) {
                                  console.error('[lora-upload]', err)
                                }
                                setLoraUploading(false)
                                e.target.value = ''
                              }}
                            />
                            <button
                              onClick={() => loraFileInputRef.current?.click()}
                              disabled={loraUploading}
                              className="w-full py-1 rounded border border-dashed border-white/10 text-[11px] text-slate-500 hover:text-violet-300 hover:border-violet-500/30 transition-colors disabled:opacity-50"
                            >
                              {loraUploading ? "Uploading…" : "Upload .safetensors"}
                            </button>
                            <div className="flex gap-1.5 pt-0.5">
                              <button
                                onClick={() => {
                                  const name = newLoraName.trim()
                                  const url = newLoraUrl.trim()
                                  if (!name || !url) return
                                  const existing = loadCustomLoras()
                                  const entry = { id: Date.now(), name, loraUrl: url, custom: true as const }
                                  saveCustomLoras([...existing, entry])
                                  setLoraJobs(prev => [...prev, entry])
                                  setSelectedLoraUrl(url)
                                  setShowAddLora(false)
                                  setLoraPickerOpen(false)
                                }}
                                disabled={!newLoraName.trim() || !newLoraUrl.trim()}
                                className="flex-1 py-1 rounded bg-violet-500/20 border border-violet-500/30 text-[11px] text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setShowAddLora(false)}
                                className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[11px] text-slate-400 hover:text-white transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Output format picker — models with supportsOutputFormat */}
            {model.supportsOutputFormat && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <div className="flex items-center rounded-md overflow-hidden border border-white/10 shrink-0">
                  {(["png", "jpeg", "webp"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setOutputFormat(fmt)}
                      className={`px-2.5 py-1 text-[11px] font-mono transition-colors ${
                        outputFormat === fmt ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Upload reference image from prompt box */}
            {model.maxReferenceImages > 0 && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:border-white/20 hover:text-white transition-all shrink-0"
                >
                  <ImagePlus size={11} />
                  {activeRefImages.length > 0 ? `${activeRefImages.length}/${model.maxReferenceImages}` : "Ref"}
                </button>
              </>
            )}

            {/* Presets */}
            <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
            <button
              onClick={() => setShowPresets(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:border-white/20 hover:text-white transition-all shrink-0"
            >
              <BookMarked size={11} />
              Presets
            </button>

            {/* Image count picker — only for models that support multi-image */}
            {(model.maxImages ?? 1) > 1 && (
              <>
                <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setImageCount(c => Math.max(1, c - 1))}
                    disabled={imageCount <= 1}
                    className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm leading-none font-bold"
                  >−</button>
                  <span className="text-[11px] font-mono text-slate-300 w-3.5 text-center tabular-nums select-none">{imageCount}</span>
                  <button
                    onClick={() => setImageCount(c => Math.min(model.maxImages ?? 1, c + 1))}
                    disabled={imageCount >= (model.maxImages ?? 1)}
                    className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm leading-none font-bold"
                  >+</button>
                </div>
              </>
            )}

            {/* Safety Checker toggle — SeeDream 4.5, WAN 2.7 Pro, FLUX 1 Dev */}
            {(model.id === "seedream-4.5" || model.id === "wan-2.7-pro" || model.id === "flux-1-dev") && (() => {
              const safetyOn = isAdminAccount
                ? (model.id === "seedream-4.5" ? seedreamSafetyChecker : model.id === "wan-2.7-pro" ? wanSafetyChecker : fluxDevSafetyChecker)
                : true
              const setSafety = model.id === "seedream-4.5" ? setSeedreamSafetyChecker : model.id === "wan-2.7-pro" ? setWanSafetyChecker : setFluxDevSafetyChecker
              return (
                <>
                  <div className="w-px h-3 bg-white/10 shrink-0 hidden sm:block" />
                  <button
                    disabled={!isAdminAccount}
                    onClick={() => {
                      if (!isAdminAccount) return
                      if (safetyOn) {
                        setSafetyAgeConfirmed(false)
                        setSafetyConfirmCallback(() => () => setSafety(false))
                        setShowSafetyModal(true)
                      } else {
                        setSafety(true)
                      }
                    }}
                    title={isAdminAccount ? undefined : "Content safety filtering is required for all generations. This helps ensure the platform remains safe and compliant."}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 ${
                      safetyOn
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "border-red-500/20 bg-red-500/[0.06] text-red-400 hover:bg-red-500/10"
                    } ${!isAdminAccount ? "cursor-default opacity-70" : ""}`}
                  >
                    <Eye size={11} />
                    Safety {safetyOn ? "ON" : "OFF"}
                    {!isAdminAccount && <span className="text-[9px] text-emerald-400/50 font-mono">· required</span>}
                  </button>
                </>
              )
            })()}

            {/* Generate button — own row on mobile, pushed right on desktop */}
            <div className="hidden sm:block sm:flex-1" />
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {needsRefImage && !queueFull && (
                <span className="text-[10px] text-amber-400/80 shrink-0">Requires ≥1 ref image</span>
              )}
              {queueFull && (
                <span className="text-[10px] text-red-400/80 shrink-0">Queue full ({activeJobCount}/{maxConcurrent === Infinity ? "∞" : maxConcurrent})</span>
              )}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all flex-1 sm:flex-none ${
                  canGenerate
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black hover:opacity-90"
                    : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
                }`}
              >
                {generating ? (
                  <div className="w-3 h-3 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                ) : (
                  <Ticket size={12} />
                )}
                {isGenerationMaintenance ? "Temporarily Offline" : queueFull ? "Queue Full" : "Generate"}
                {!isGenerationMaintenance && !queueFull && !model.isLocalModel && <span className="opacity-70">{totalCost}</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <PresetsPanel
        open={showPresets}
        onClose={() => setShowPresets(false)}
        onLoad={handleLoadPreset}
      />

      {/* Age verification modal — rendered at document.body via portal to escape any ancestor stacking context */}
      {showSafetyModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSafetyModal(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0e0e1a] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header stripe */}
            <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-red-500" />
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle size={16} className="text-orange-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white leading-tight">Age Verification Required</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Disabling the safety checker</p>
                </div>
              </div>

              <p className="text-[12px] text-slate-400 leading-relaxed mb-4">
                Turning off the safety checker may allow the generation of content that is not suitable for minors. You must be at least <span className="text-white font-semibold">18 years of age</span> to disable this setting.
              </p>

              <label className="flex items-start gap-3 mb-5 cursor-pointer group">
                <div
                  onClick={() => setSafetyAgeConfirmed(v => !v)}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    safetyAgeConfirmed
                      ? "bg-orange-500 border-orange-500"
                      : "border-white/20 bg-white/[0.04] group-hover:border-white/40"
                  }`}
                >
                  {safetyAgeConfirmed && <Check size={10} className="text-white" />}
                </div>
                <span className="text-[12px] text-slate-300 leading-relaxed">
                  I confirm that I am <span className="text-white font-semibold">18 years of age or older</span> and I understand that disabling the safety checker may expose adult or sensitive content.
                </span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowSafetyModal(false)}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold border border-white/10 bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={!safetyAgeConfirmed}
                  onClick={() => {
                    safetyConfirmCallback?.()
                    setShowSafetyModal(false)
                  }}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  I Agree — Disable Safety
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// --- VIDEO COMPONENTS ---

function FrameUploadArea({
  preview, uploading, onSelect, onClear, label, optional, inputRef,
}: {
  preview: string | null
  uploading: boolean
  onSelect: (f: File) => void
  onClear: () => void
  label: string
  optional?: boolean
  inputRef: React.RefObject<HTMLInputElement>
}) {
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onSelect(f) } }}
      />
      {preview ? (
        <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
          <img src={preview} alt="frame" className="w-full h-full object-contain" />
          {uploading && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />
            </div>
          )}
          <button
            onClick={onClear}
            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-black flex items-center justify-center transition-all"
          >
            <X size={10} className="text-white" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed border-orange-500/30 hover:border-orange-500/50 flex flex-col items-center justify-center gap-1.5 transition-all py-6"
        >
          <ImagePlus size={16} className="text-orange-400/60" />
          <span className="text-[10px] text-slate-500">{label}</span>
        </button>
      )}
    </div>
  )
}

// SeeDance 2.0 Reference-to-Video multi-asset panel
function SD20RefPanel({
  videoRefImagePreviews, onAddRefImage, onRemoveRefImage,
  videoRefVideoFilenames, videoRefVideoUrls, onAddRefVideo, onRemoveRefVideo,
  videoRefAudioFilenames, onAddRefAudio, onRemoveRefAudio,
}: {
  videoRefImagePreviews: string[]
  onAddRefImage: (f: File) => void
  onRemoveRefImage: (i: number) => void
  videoRefVideoFilenames: string[]
  videoRefVideoUrls: (string | null)[]
  onAddRefVideo: (f: File, duration: number) => void
  onRemoveRefVideo: (i: number, duration: number) => void
  videoRefAudioFilenames: string[]
  onAddRefAudio: (f: File) => void
  onRemoveRefAudio: (i: number) => void
}) {
  const imgInputRef  = useRef<HTMLInputElement>(null)
  const vidInputRef  = useRef<HTMLInputElement>(null)
  const audInputRef  = useRef<HTMLInputElement>(null)
  // Store per-video duration so we can subtract it on remove
  const videoDurations = useRef<number[]>([])

  function handleVideoFile(file: File) {
    const objUrl = URL.createObjectURL(file)
    const vid = document.createElement("video")
    vid.preload = "metadata"
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(objUrl)
      const dur = vid.duration
      videoDurations.current.push(dur)
      onAddRefVideo(file, dur)
    }
    vid.onerror = () => { URL.revokeObjectURL(objUrl); videoDurations.current.push(0); onAddRefVideo(file, 0) }
    vid.src = objUrl
  }

  return (
    <div className="space-y-4">
      {/* Reference Images */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Reference Images <span className="text-slate-600 normal-case font-normal">(optional)</span>
          </p>
          {videoRefImagePreviews.length < 5 && (
            <button onClick={() => imgInputRef.current?.click()}
              className="text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors flex items-center gap-0.5">
              <Plus size={10} />Add
            </button>
          )}
        </div>
        <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onAddRefImage(f) } }} />
        {videoRefImagePreviews.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5">
            {videoRefImagePreviews.map((preview, i) => (
              <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-black border border-white/10 group">
                <img src={preview} alt="" className="w-full h-full object-cover" />
                <button onClick={() => onRemoveRefImage(i)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={8} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button onClick={() => imgInputRef.current?.click()}
            className="w-full py-4 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[10px] text-slate-600 hover:text-slate-400 transition-all flex items-center justify-center gap-1.5">
            <ImagePlus size={12} />Upload reference images
          </button>
        )}
      </div>

      {/* Reference Videos */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Reference Videos <span className="text-slate-600 normal-case font-normal">(optional)</span>
          </p>
          {videoRefVideoFilenames.length < 3 && (
            <button onClick={() => vidInputRef.current?.click()}
              className="text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors flex items-center gap-0.5">
              <Plus size={10} />Add
            </button>
          )}
        </div>
        <input ref={vidInputRef} type="file" accept="video/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; handleVideoFile(f) } }} />
        {videoRefVideoFilenames.length > 0 ? (
          <div className="space-y-1">
            {videoRefVideoFilenames.map((name, i) => (
              <div key={i} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] ${videoRefVideoUrls[i] ? "bg-white/5 border-white/10 text-slate-300" : "bg-slate-900/80 border-white/5 text-slate-500"}`}>
                {videoRefVideoUrls[i]
                  ? <Check size={11} className="text-green-400 shrink-0" />
                  : <div className="w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin shrink-0" />}
                <span className="truncate flex-1">{name.length > 22 ? name.slice(0, 20) + "…" : name}</span>
                <button onClick={() => { const dur = videoDurations.current[i] || 0; onRemoveRefVideo(i, dur) }}
                  className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"><X size={11} /></button>
              </div>
            ))}
          </div>
        ) : (
          <button onClick={() => vidInputRef.current?.click()}
            className="w-full py-4 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[10px] text-slate-600 hover:text-slate-400 transition-all flex items-center justify-center gap-1.5">
            <Video size={12} />Upload reference videos
          </button>
        )}
      </div>

      {/* Reference Audio */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Reference Audio <span className="text-slate-600 normal-case font-normal">(optional)</span>
          </p>
          {videoRefAudioFilenames.length < 2 && (
            <button onClick={() => audInputRef.current?.click()}
              className="text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors flex items-center gap-0.5">
              <Plus size={10} />Add
            </button>
          )}
        </div>
        <input ref={audInputRef} type="file" accept="audio/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onAddRefAudio(f) } }} />
        {videoRefAudioFilenames.length > 0 ? (
          <div className="space-y-1">
            {videoRefAudioFilenames.map((name, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300">
                <Check size={11} className="text-green-400 shrink-0" />
                <span className="truncate flex-1">{name.length > 22 ? name.slice(0, 20) + "…" : name}</span>
                <button onClick={() => onRemoveRefAudio(i)} className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"><X size={11} /></button>
              </div>
            ))}
          </div>
        ) : (
          <button onClick={() => audInputRef.current?.click()}
            className="w-full py-4 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[10px] text-slate-600 hover:text-slate-400 transition-all flex items-center justify-center gap-1.5">
            <Plus size={12} />Upload reference audio
          </button>
        )}
      </div>
    </div>
  )
}

function VideoCustomizationPanel({
  model,
  duration, onDurationChange,
  aspectRatio, onAspectRatioChange,
  resolution, onResolutionChange,
  audioEnabled, onAudioToggle,
  audioFile, onAudioFileChange,
  startFramePreview, onStartFrameSelect, onClearStartFrame,
  endFramePreview, onEndFrameSelect, onClearEndFrame,
  startFrameUploading, endFrameUploading, audioUploading,
  motionVideoFilename, onMotionVideoSelect, onClearMotionVideo, motionVideoUploading,
  motionVideoDuration, onMotionVideoDurationChange,
  characterOrientation, onCharacterOrientationChange,
  keepOriginalSound, onKeepOriginalSoundToggle,
  videoRefImagePreviews = [], onAddRefImage, onRemoveRefImage,
  videoRefVideoFilenames = [], videoRefVideoUrls = [], onAddRefVideo, onRemoveRefVideo,
  videoRefAudioFilenames = [], onAddRefAudio, onRemoveRefAudio,
  videoRefVideoDuration = 0,
  sd20Mode = "t2v" as "t2v" | "i2v" | "r2v",
  onSD20ModeChange,
  lipsyncVideoFilename,
  lipsyncVideoUploading,
  lipsyncVideoDuration,
  onLipsyncVideoSelect,
  onClearLipsyncVideo,
  lipsyncAudioFilename,
  lipsyncAudioUploading,
  onLipsyncAudioSelect,
  onClearLipsyncAudio,
  lipsyncSyncMode = "cut_off",
  onLipsyncSyncModeChange,
  safetyChecker,
  setSafetyChecker,
  isAdminAccount = false,
}: {
  model: VideoModelConfig
  duration: string; onDurationChange: (d: string) => void
  aspectRatio: string; onAspectRatioChange: (r: string) => void
  resolution: string; onResolutionChange: (r: string) => void
  audioEnabled: boolean; onAudioToggle: (v: boolean) => void
  audioFile: File | null; onAudioFileChange: (f: File) => void
  startFramePreview: string | null; onStartFrameSelect: (f: File) => void; onClearStartFrame: () => void
  endFramePreview: string | null; onEndFrameSelect: (f: File) => void; onClearEndFrame: () => void
  startFrameUploading: boolean; endFrameUploading: boolean; audioUploading: boolean
  motionVideoFilename: string | null; onMotionVideoSelect: (f: File) => void; onClearMotionVideo: () => void; motionVideoUploading: boolean
  motionVideoDuration: number | null; onMotionVideoDurationChange: (d: number) => void
  characterOrientation: string; onCharacterOrientationChange: (o: string) => void
  keepOriginalSound: boolean; onKeepOriginalSoundToggle: (v: boolean) => void
  // SeeDance 2.0 r2v
  videoRefImagePreviews?: string[]
  onAddRefImage?: (f: File) => void
  onRemoveRefImage?: (i: number) => void
  videoRefVideoFilenames?: string[]
  videoRefVideoUrls?: (string | null)[]
  onAddRefVideo?: (f: File, duration: number) => void
  onRemoveRefVideo?: (i: number, duration: number) => void
  videoRefAudioFilenames?: string[]
  onAddRefAudio?: (f: File) => void
  onRemoveRefAudio?: (i: number) => void
  videoRefVideoDuration?: number
  // SeeDance 2.0 mode switcher
  sd20Mode?: "t2v" | "i2v" | "r2v"
  onSD20ModeChange?: (m: "t2v" | "i2v" | "r2v") => void
  // Lipsync v3
  lipsyncVideoFilename?: string | null
  lipsyncVideoUploading?: boolean
  lipsyncVideoDuration?: number
  onLipsyncVideoSelect?: (f: File, duration: number, aspectRatio?: string) => void
  onClearLipsyncVideo?: () => void
  lipsyncAudioFilename?: string | null
  lipsyncAudioUploading?: boolean
  onLipsyncAudioSelect?: (f: File) => void
  onClearLipsyncAudio?: () => void
  lipsyncSyncMode?: string
  onLipsyncSyncModeChange?: (m: string) => void
  safetyChecker?: boolean
  setSafetyChecker?: (v: boolean) => void
  isAdminAccount?: boolean
}) {
  const startRef      = useRef<HTMLInputElement>(null!)
  const [showSafetyModal, setShowSafetyModal] = useState(false)
  const [safetyAgeConfirmed, setSafetyAgeConfirmed] = useState(false)
  const endRef        = useRef<HTMLInputElement>(null!)
  const audioRef      = useRef<HTMLInputElement>(null)
  const lipsyncVidRef = useRef<HTMLInputElement>(null)
  const lipsyncAudRef = useRef<HTMLInputElement>(null)
  const [motionVideoError, setMotionVideoError] = useState<string | null>(null)
  const [lipsyncVideoError, setLipsyncVideoError] = useState<string | null>(null)

  function handleMotionVideoFile(file: File) {
    setMotionVideoError(null)
    const objectUrl = URL.createObjectURL(file)
    const vid = document.createElement("video")
    vid.preload = "metadata"
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl)
      const dur = vid.duration
      if (dur < 3) {
        setMotionVideoError(`Video is too short (${dur.toFixed(1)}s) — minimum 3 seconds`)
      } else if (dur > 30) {
        setMotionVideoError(`Video is too long (${dur.toFixed(1)}s) — maximum 30 seconds`)
      } else {
        onMotionVideoDurationChange(dur)
        onMotionVideoSelect(file)
      }
    }
    vid.onerror = () => { URL.revokeObjectURL(objectUrl); setMotionVideoError("Could not read video file") }
    vid.src = objectUrl
  }

  function handleLipsyncVideoFile(file: File) {
    setLipsyncVideoError(null)
    const objectUrl = URL.createObjectURL(file)
    const vid = document.createElement("video")
    vid.preload = "metadata"
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl)
      const w = vid.videoWidth
      const h = vid.videoHeight
      let detectedRatio: string | undefined
      if (w && h) {
        const r = w / h
        const standards: { label: string; ratio: number }[] = [
          { label: "1:1",  ratio: 1 },
          { label: "16:9", ratio: 16 / 9 },
          { label: "9:16", ratio: 9 / 16 },
          { label: "4:3",  ratio: 4 / 3 },
          { label: "3:4",  ratio: 3 / 4 },
          { label: "3:2",  ratio: 3 / 2 },
          { label: "2:3",  ratio: 2 / 3 },
          { label: "4:5",  ratio: 4 / 5 },
          { label: "5:4",  ratio: 5 / 4 },
          { label: "21:9", ratio: 21 / 9 },
        ]
        let closest = standards[0]
        let minDiff = Math.abs(r - closest.ratio)
        for (const s of standards) {
          const diff = Math.abs(r - s.ratio)
          if (diff < minDiff) { minDiff = diff; closest = s }
        }
        detectedRatio = closest.label
      }
      onLipsyncVideoSelect?.(file, vid.duration, detectedRatio)
    }
    vid.onerror = () => { URL.revokeObjectURL(objectUrl); setLipsyncVideoError("Could not read video file") }
    vid.src = objectUrl
  }

  const motionMaxSec = characterOrientation === "video" ? 30 : 10
  const sd20ResMultiplier = resolution === "1080p" ? 2.25 : resolution === "480p" ? 0.5 : 1.0
  const isSD20Family = model.id === "seedance-2.0" || model.id === "seedance-2.0-fast"
  const isLipsync = !!model.supportsLipsync
  const ticketCost = isLipsync
    ? Math.max(10, Math.ceil((lipsyncVideoDuration ?? 0) * 6))
    : model.id === "kling-v3-motion"
    ? Math.ceil(motionVideoDuration ?? motionMaxSec) * 6
    : model.id === "kling-v3"
    ? parseInt(duration) * (audioEnabled ? 8 : 6)
    : model.id === "seedance-1.5"
    ? Math.ceil(parseInt(duration) * 2.0 * (resolution === "1080p" ? 2.25 : resolution === "480p" ? 0.5 : 1.0) * (audioEnabled ? 1.0 : 0.5)) + 1
    : isSD20Family
    ? Math.ceil(parseInt(duration === "auto" ? "5" : duration) * (model.id === "seedance-2.0-fast" ? 12 : 15) * sd20ResMultiplier)
    : model.id === "happy-horse"
    ? parseInt(duration) * (resolution === "1080p" ? 12 : 7)
    : ({ "480p": { "5": 7, "10": 14 }, "720p": { "5": 13, "10": 26 }, "1080p": { "5": 20, "10": 40 } } as any)[resolution]?.[duration] ?? 20

  const btnBase   = "py-1.5 rounded text-[11px] font-mono transition-all border"
  const btnActive = "bg-orange-500/15 text-orange-400 border-orange-500/40"
  const btnIdle   = "bg-white/5 text-slate-400 border-white/8 hover:border-white/15"

  return (
    <>
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-white/5">
        <Video size={13} className="text-orange-400 shrink-0" />
        <span className="text-sm font-semibold text-white">{model.name}</span>
        <span className="ml-auto text-[10px] font-mono text-orange-400/70 flex items-center gap-0.5">
          <Ticket size={9} />{ticketCost}{(isSD20Family && duration === "auto") || (isLipsync && !lipsyncVideoDuration) ? "~" : ""}
        </span>
      </div>

      {/* ── Lipsync v3 panel ── */}
      {isLipsync && (
        <>
          {/* Hidden file inputs */}
          <input ref={lipsyncVidRef} type="file" accept="video/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; handleLipsyncVideoFile(f) }}} />
          <input ref={lipsyncAudRef} type="file" accept="audio/*,audio/mpeg,audio/mp3,audio/wav,audio/aac,audio/ogg,audio/flac,audio/x-m4a,.mp3,.wav,.aac,.ogg,.flac,.m4a,.aiff,.aif" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onLipsyncAudioSelect?.(f) }}} />

          {/* Video upload */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Source Video <span className="text-orange-400/70">*</span>
            </p>
            <p className="text-[10px] text-slate-600 leading-snug">The video whose lips will be synced to the audio</p>
            {lipsyncVideoFilename ? (
              <div className={`relative rounded-lg overflow-hidden flex items-center gap-3 px-3 py-3 border ${lipsyncVideoUploading ? "bg-slate-900/80 border-white/10" : "bg-white/5 border-white/10"}`}>
                <div className="w-8 h-8 rounded bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                  {lipsyncVideoUploading
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />
                    : <Check size={13} className="text-green-400" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-200 truncate font-medium">{lipsyncVideoFilename}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {lipsyncVideoUploading ? "Uploading…" : lipsyncVideoDuration ? `${lipsyncVideoDuration.toFixed(1)}s · Ready` : "Ready"}
                  </p>
                </div>
                <button onClick={() => { onClearLipsyncVideo?.(); setLipsyncVideoError(null) }}
                  className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-white/5 transition-all">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button onClick={() => lipsyncVidRef.current?.click()}
                className={`w-full rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5 transition-all py-6 ${
                  lipsyncVideoError ? "border-red-500/40 hover:border-red-500/60" : "border-orange-500/30 hover:border-orange-500/50"
                }`}>
                <Video size={16} className={lipsyncVideoError ? "text-red-400/60" : "text-orange-400/60"} />
                <span className="text-[10px] text-slate-500">Click to upload source video</span>
              </button>
            )}
            {lipsyncVideoError && (
              <p className="text-[10px] text-red-400 flex items-center gap-1"><X size={10} className="shrink-0" />{lipsyncVideoError}</p>
            )}
          </div>

          {/* Audio upload */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Audio Track <span className="text-orange-400/70">*</span>
            </p>
            <p className="text-[10px] text-slate-600 leading-snug">The audio to sync the lips to (WAV, MP3, etc.)</p>
            {lipsyncAudioFilename ? (
              <div className={`relative rounded-lg overflow-hidden flex items-center gap-3 px-3 py-3 border ${lipsyncAudioUploading ? "bg-slate-900/80 border-white/10" : "bg-white/5 border-white/10"}`}>
                <div className="w-8 h-8 rounded bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                  {lipsyncAudioUploading
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />
                    : <Check size={13} className="text-green-400" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-200 truncate font-medium">{lipsyncAudioFilename}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{lipsyncAudioUploading ? "Uploading…" : "Ready"}</p>
                </div>
                <button onClick={() => onClearLipsyncAudio?.()}
                  className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-white/5 transition-all">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button onClick={() => lipsyncAudRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-orange-500/30 hover:border-orange-500/50 flex flex-col items-center justify-center gap-1.5 transition-all py-6">
                <Music size={16} className="text-orange-400/60" />
                <span className="text-[10px] text-slate-500">Click to upload audio track</span>
              </button>
            )}
          </div>

          {/* Sync mode */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Sync Mode</p>
            <p className="text-[10px] text-slate-600 leading-snug">How to handle duration mismatch between video and audio</p>
            <div className="grid grid-cols-3 gap-1">
              {(["cut_off", "loop", "bounce", "silence", "remap"] as const).map(m => (
                <button key={m} onClick={() => onLipsyncSyncModeChange?.(m)}
                  className={`${btnBase} ${lipsyncSyncMode === m ? btnActive : btnIdle} text-[10px]`}>
                  {m === "cut_off" ? "Cut Off" : m === "loop" ? "Loop" : m === "bounce" ? "Bounce" : m === "silence" ? "Silence" : "Remap"}
                </button>
              ))}
            </div>
          </div>

          {/* Ticket estimate note */}
          {lipsyncVideoDuration ? (
            <p className="text-[10px] text-slate-600 leading-snug">
              Cost based on video duration: {lipsyncVideoDuration.toFixed(1)}s × 6 = <span className="text-orange-400/70 font-mono">{Math.max(10, Math.ceil(lipsyncVideoDuration * 6))} tickets</span>
            </p>
          ) : (
            <p className="text-[10px] text-slate-600 leading-snug">
              Min charge: <span className="text-orange-400/70 font-mono">10 tickets</span>. Final cost calculated after video upload.
            </p>
          )}
        </>
      )}

      {/* Reference Image / Start Frame — hidden for r2v models, hidden for lipsync */}
      {!isLipsync && !model.supportsReferenceVideo && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            {model.supportsMotionControl ? "Character Image" : model.textToVideo ? "Reference Image" : "Start Frame"}
            {!model.textToVideo && !model.supportsMotionControl && <span className="text-orange-400/70"> *</span>}
            {model.textToVideo && !model.supportsMotionControl && <span className="text-slate-600 normal-case font-normal"> (optional)</span>}
          </p>
          {model.supportsMotionControl && (
            <p className="text-[10px] text-slate-600 leading-snug">The character's appearance and background will be sourced from this image</p>
          )}
          {model.textToVideo && !model.supportsMotionControl && (
            <p className="text-[10px] text-slate-600 leading-snug">Provide a reference image to guide the video, or leave empty for text-only generation</p>
          )}
          <FrameUploadArea
            preview={startFramePreview}
            uploading={startFrameUploading}
            onSelect={onStartFrameSelect}
            onClear={onClearStartFrame}
            label={model.supportsMotionControl ? "Click to upload character image" : model.textToVideo ? "Click to upload reference image (optional)" : "Click to upload start frame"}
            optional={!!model.textToVideo}
            inputRef={startRef}
          />
        </div>
      )}

      {/* Motion Control / SD20 / standard UI — hidden for lipsync */}
      {!isLipsync && model.supportsMotionControl ? (
        <>
          {/* Motion reference video */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Motion Reference Video <span className="text-orange-400/70">*</span>
            </p>
            <p className="text-[10px] text-slate-600 leading-snug">The character's movements in the output will follow this video</p>
            <input ref={endRef} type="file" accept="video/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; setMotionVideoError(null); handleMotionVideoFile(f) }}} />
            {motionVideoFilename ? (
              <div className={`relative rounded-lg overflow-hidden flex items-center gap-3 px-3 py-3 border ${motionVideoUploading ? "bg-slate-900/80 border-white/10" : "bg-white/5 border-white/10"}`}>
                <div className="w-8 h-8 rounded bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                  {motionVideoUploading
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />
                    : <Check size={13} className="text-green-400" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-200 truncate font-medium">{motionVideoFilename}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{motionVideoUploading ? "Uploading…" : "Ready"}</p>
                </div>
                <button onClick={() => { onClearMotionVideo(); setMotionVideoError(null) }}
                  className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-white/5 transition-all">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button onClick={() => endRef.current.click()}
                className={`w-full rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5 transition-all py-6 ${
                  motionVideoError ? "border-red-500/40 hover:border-red-500/60" : "border-orange-500/30 hover:border-orange-500/50"
                }`}>
                <Video size={16} className={motionVideoError ? "text-red-400/60" : "text-orange-400/60"} />
                <span className="text-[10px] text-slate-500">Click to upload motion reference video</span>
                <span className="text-[9px] text-slate-600">Must be between 3–30 seconds long</span>
              </button>
            )}
            {motionVideoError && (
              <p className="text-[10px] text-red-400 flex items-center gap-1">
                <X size={10} className="shrink-0" />{motionVideoError}
              </p>
            )}
          </div>

          {/* Background Control */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Background Control</p>
            <p className="text-[10px] text-slate-600 leading-snug">Choose where you want the background of the video to come from</p>
            <div className="flex gap-1.5">
              <button onClick={() => onCharacterOrientationChange("image")}
                className={`flex-1 ${btnBase} ${characterOrientation === "image" ? btnActive : btnIdle}`}>
                Image
              </button>
              <button onClick={() => onCharacterOrientationChange("video")}
                className={`flex-1 ${btnBase} ${characterOrientation === "video" ? btnActive : btnIdle}`}>
                Video
              </button>
            </div>
            <p className="text-[10px] text-slate-600 leading-snug">
              {characterOrientation === "video"
                ? "Background follows the reference video (max 30s output)"
                : "Background follows the character image (max 10s output)"}
            </p>
          </div>

          {/* Keep Original Sound */}
          <div className="flex items-start justify-between gap-3 py-1">
            <div>
              <p className="text-[12px] text-slate-300 font-medium">Keep Original Sound</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                Preserve audio from the reference video
              </p>
            </div>
            <button
              onClick={() => onKeepOriginalSoundToggle(!keepOriginalSound)}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 mt-0.5 ${keepOriginalSound ? "bg-orange-500" : "bg-slate-700"}`}
            >
              <span className={`block w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${keepOriginalSound ? "right-[3px]" : "left-[3px]"}`} />
            </button>
          </div>
        </>
      ) : model.supportsReferenceVideo ? (
        /* ── SeeDance 2.0 Reference-to-Video ── */
        <SD20RefPanel
          videoRefImagePreviews={videoRefImagePreviews}
          onAddRefImage={onAddRefImage!}
          onRemoveRefImage={onRemoveRefImage!}
          videoRefVideoFilenames={videoRefVideoFilenames}
          videoRefVideoUrls={videoRefVideoUrls}
          onAddRefVideo={onAddRefVideo!}
          onRemoveRefVideo={onRemoveRefVideo!}
          videoRefAudioFilenames={videoRefAudioFilenames}
          onAddRefAudio={onAddRefAudio!}
          onRemoveRefAudio={onRemoveRefAudio!}
        />
      ) : (
        <>
          {/* End frame */}
          {model.supportsEndFrame && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                End Frame <span className="text-slate-600 normal-case font-normal">(optional)</span>
              </p>
              <FrameUploadArea
                preview={endFramePreview}
                uploading={endFrameUploading}
                onSelect={onEndFrameSelect}
                onClear={onClearEndFrame}
                label="Click to upload end frame"
                optional
                inputRef={endRef}
              />
            </div>
          )}

          {/* Duration */}
          {model.durations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Duration</p>
              {model.durations.length > 4 ? (
                <div className="grid grid-cols-5 gap-1">
                  {model.durations.map(d => (
                    <button key={d} onClick={() => onDurationChange(d)}
                      className={`${btnBase} ${duration === d ? btnActive : btnIdle}`}>{d === "auto" ? "auto" : `${d}s`}</button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-1.5">
                  {model.durations.map(d => (
                    <button key={d} onClick={() => onDurationChange(d)}
                      className={`flex-1 ${btnBase} ${duration === d ? btnActive : btnIdle}`}>{d === "auto" ? "auto" : `${d}s`}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aspect ratio — Kling 3.0 / SeeDance */}
          {model.aspectRatios && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Aspect Ratio</p>
              {model.startFrameLocksAspect && startFramePreview ? (
                <div className="px-3 py-2 rounded-lg bg-white/4 border border-white/8 text-[11px] text-slate-400 italic">
                  Matches start frame
                </div>
              ) : model.aspectRatios.length > 4 ? (
                <div className="grid grid-cols-4 gap-1">
                  {model.aspectRatios.map(r => {
                    const ratioLabel = PIXEL_DIM_RATIO[r]
                    const label = ratioLabel ? `${ratioLabel} (${r})` : r
                    return (
                      <button key={r} onClick={() => onAspectRatioChange(r)}
                        className={`${btnBase} ${aspectRatio === r ? btnActive : btnIdle}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex gap-1.5">
                  {model.aspectRatios.map(r => {
                    const ratioLabel = PIXEL_DIM_RATIO[r]
                    const label = ratioLabel ? `${ratioLabel} (${r})` : r
                    return (
                      <button key={r} onClick={() => onAspectRatioChange(r)}
                        className={`flex-1 ${btnBase} ${aspectRatio === r ? btnActive : btnIdle}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Resolution — Wan 2.5 only */}
          {model.resolutions && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Resolution</p>
              <div className="flex gap-1.5">
                {model.resolutions.map(r => (
                  <button key={r} onClick={() => onResolutionChange(r)}
                    className={`flex-1 ${btnBase} ${resolution === r ? btnActive : btnIdle}`}>{r}</button>
                ))}
              </div>
            </div>
          )}

          {/* Audio toggle — Kling 3.0 / SeeDance */}
          {model.audioType === "toggle" && (
            <div className="flex items-start justify-between gap-3 py-1">
              <div>
                <p className="text-[12px] text-slate-300 font-medium">Generate Audio</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                  AI-generated ambient audio based on video context
                </p>
              </div>
              <button
                onClick={() => onAudioToggle(!audioEnabled)}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 mt-0.5 ${audioEnabled ? "bg-orange-500" : "bg-slate-700"}`}
              >
                <span className={`block w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${audioEnabled ? "right-[3px]" : "left-[3px]"}`} />
              </button>
            </div>
          )}

          {/* Audio upload — Wan 2.5 */}
          {model.audioType === "upload" && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                Background Audio <span className="text-slate-600 normal-case font-normal">(optional)</span>
              </p>
              <input
                ref={audioRef}
                type="file"
                accept="audio/wav,audio/mp3,audio/mpeg"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onAudioFileChange(f) } }}
              />
              <button
                onClick={() => audioRef.current?.click()}
                className="w-full py-2.5 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[11px] text-slate-500 hover:text-slate-300 flex items-center justify-center gap-2 transition-all"
              >
                {audioUploading ? (
                  <><div className="w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />Uploading...</>
                ) : audioFile ? (
                  <><Check size={11} className="text-green-400" />{audioFile.name.length > 24 ? audioFile.name.slice(0, 22) + "…" : audioFile.name}</>
                ) : (
                  <>+ Upload WAV / MP3 (3–30s)</>
                )}
              </button>
            </div>
          )}

          {/* Content Safety — WAN 2.5 and SeeDance 1.5 */}
          {(model.id === "wan-2.5" || model.id === "seedance-1.5") && setSafetyChecker !== undefined && (() => {
            const safetyOn = isAdminAccount ? (safetyChecker ?? true) : true
            return (
              <div className="flex items-start justify-between gap-3 pt-4 border-t border-white/5">
                <div>
                  <p className="text-[12px] text-slate-300 font-medium">Content Safety</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                    {isAdminAccount
                      ? "Filters explicit content from generation output."
                      : "Required — filters explicit content from all generations to keep the platform safe and compliant."}
                  </p>
                </div>
                <button
                  disabled={!isAdminAccount}
                  onClick={() => {
                    if (!isAdminAccount) return
                    if (safetyOn) {
                      setSafetyAgeConfirmed(false)
                      setShowSafetyModal(true)
                    } else {
                      setSafetyChecker(true)
                    }
                  }}
                  title={!isAdminAccount ? "Content safety filtering is required for all generations." : undefined}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-all shrink-0 mt-0.5 ${
                    safetyOn
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "border-red-500/20 bg-red-500/[0.06] text-red-400 hover:bg-red-500/10"
                  } ${!isAdminAccount ? "cursor-default opacity-70" : ""}`}
                >
                  <Eye size={11} />
                  {safetyOn ? "ON" : "OFF"}
                  {!isAdminAccount && <span className="text-[9px] text-emerald-400/50 font-mono">· required</span>}
                </button>
              </div>
            )
          })()}
        </>
      )}
    </div>

    {/* Age verification modal for admin safety toggle */}
    {showSafetyModal && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSafetyModal(false)} />
        <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0e0e1a] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="h-1 w-full bg-gradient-to-r from-orange-500 to-red-500" />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-orange-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Age Verification Required</h3>
                <p className="text-[11px] text-white/40 mt-0.5">Safety filter controls</p>
              </div>
            </div>
            <p className="text-[12px] text-white/60 leading-relaxed mb-5">
              Disabling the safety checker may allow the generation of content intended for mature audiences only. This feature is restricted to users 18 years of age or older.
            </p>
            <label className="flex items-start gap-2.5 mb-5 cursor-pointer group">
              <div
                onClick={() => setSafetyAgeConfirmed(v => !v)}
                className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                  safetyAgeConfirmed ? "bg-orange-500 border-orange-500" : "border-white/20 bg-white/5 group-hover:border-white/40"
                }`}
              >
                {safetyAgeConfirmed && <Check size={10} className="text-white" />}
              </div>
              <span className="text-[12px] text-white/70 leading-snug">I am 18 years of age or older and understand the implications of disabling the safety checker.</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSafetyModal(false)}
                className="flex-1 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/60 hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                disabled={!safetyAgeConfirmed}
                onClick={() => { setSafetyChecker?.(false); setShowSafetyModal(false) }}
                className={`flex-1 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all ${
                  safetyAgeConfirmed
                    ? "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:opacity-90"
                    : "bg-white/5 border border-white/10 text-white/25 cursor-not-allowed"
                }`}
              >
                I Agree — Disable Safety
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

function VideoFeed({
  pendingSlots,
  items,
  savedFails,
  onVideoClick,
  onPendingClick,
  selectMode,
  selectedIds,
  onSelectToggle,
}: {
  pendingSlots: VideoPendingSlot[]
  items: VideoItem[]
  savedFails: VideoItem[]
  onVideoClick: (data: VideoDetailData) => void
  onPendingClick?: (slot: VideoPendingSlot) => void
  selectMode?: boolean
  selectedIds?: Set<number>
  onSelectToggle?: (id: number) => void
}) {
  // Pull the same historical feed as the image scanner — with infinite scroll
  const [dbImages, setDbImages] = useState<ImageItem[]>([])
  const [dbLoading, setDbLoading] = useState(false)
  const videoSentinelRef = useRef<HTMLDivElement>(null)
  const videoLoadingRef = useRef(false)
  const videoPageRef = useRef(1)
  const videoHasMoreRef = useRef(true)
  const videoPagLimitRef = useRef(typeof window !== "undefined" && window.innerWidth < 640 ? 8 : 24)

  const loadNextVideos = useCallback(async () => {
    if (videoLoadingRef.current || !videoHasMoreRef.current) return
    videoLoadingRef.current = true
    setDbLoading(true)
    try {
      const res = await fetch(`/api/my-images?page=${videoPageRef.current}&limit=${videoPagLimitRef.current}&type=video`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.images) return
      setDbImages(prev => {
        const existingIds = new Set(prev.map(i => i.id))
        const newItems = (data.images as any[]).filter(img => !existingIds.has(img.id))
        return [...prev, ...newItems]
      })
      videoHasMoreRef.current = videoPageRef.current < (data.pagination?.totalPages ?? 1)
      videoPageRef.current += 1
    } finally {
      videoLoadingRef.current = false
      setDbLoading(false)
    }
  }, [])

  useEffect(() => { loadNextVideos() }, [loadNextVideos])
  useEffect(() => { if (!dbLoading) {
    if (!videoSentinelRef.current || !videoHasMoreRef.current) return
    const rect = videoSentinelRef.current.getBoundingClientRect()
    if (rect.top < window.innerHeight + 1200) loadNextVideos()
  } }, [dbLoading, loadNextVideos])

  useEffect(() => {
    const sentinel = videoSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadNextVideos() },
      { rootMargin: "1200px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadNextVideos])

  // IDs already shown as session items — skip them in the DB section.
  // Session VideoItem.id is a FAL request ID string, which never matches a numeric
  // DB id. Use dbId (set when the video completes) for correct dedup.
  const sessionDbIds = new Set(items.map(i => i.dbId).filter((id): id is number => id !== undefined))

  const isVideoUrl = (url: string) =>
    /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ||
    url.includes("video") ||
    url.includes("fal.media/files/video")

  // Convert "16:9" → "16/9" for CSS aspect-ratio; falls back to "16/9"
  const toAspectRatioCss = (ar?: string) => {
    if (!ar || ar === "auto") return "16/9"
    return ar.replace(":", "/")
  }

  // Append #t=0.001 so iOS Safari decodes the first frame instead of showing black
  const iosSrc = (url: string) => (url.includes("#") ? url : `${url}#t=0.001`)

  const hasContent = pendingSlots.length > 0 || items.length > 0 || dbImages.length > 0 || savedFails.length > 0 || dbLoading || videoHasMoreRef.current

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-700">
        <Video size={28} strokeWidth={1.5} />
        <p className="text-sm">Generated videos will appear here</p>
      </div>
    )
  }

  return (
    <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 auto-rows-max">
      {/* Loading / queued slots */}
      {pendingSlots.map(slot => (
        <button
          key={slot.slotId}
          onClick={onPendingClick ? () => onPendingClick(slot) : undefined}
          className={`rounded-lg border flex flex-col items-center justify-center gap-2 p-4 w-full transition-colors ${slot.queueJobId && !slot.requestId ? "bg-slate-900 border-amber-500/20 hover:border-amber-500/40" : "bg-slate-900 border-white/5 hover:border-white/10"}`}
          style={{ aspectRatio: "16/9" }}
        >
          <div className={`w-5 h-5 rounded-full border-2 animate-spin ${slot.queueJobId && !slot.requestId ? "border-amber-500/30 border-t-amber-400" : "border-orange-400/30 border-t-orange-400"}`} />
          {slot.queueJobId && !slot.requestId && <p className="text-[9px] text-amber-400/60 font-mono tracking-wide">QUEUED</p>}
          <p className="text-[10px] text-slate-500 text-center line-clamp-2 italic">"{slot.prompt}"</p>
          <p className="text-[9px] text-orange-400/50 font-mono">{slot.model}</p>
        </button>
      ))}

      {/* Session items (new this session) */}
      {items.map(item =>
        item.failed ? (
          <div
            key={item.id}
            className="rounded-lg bg-slate-900 border border-red-500/20 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:border-red-500/40 transition-colors"
            style={{ aspectRatio: "16/9" }}
            onClick={() => onVideoClick({ videoUrl: "", prompt: item.prompt, model: item.model, duration: item.duration, createdAt: item.createdAt, failed: true, failError: item.failError })}
          >
            <div className="w-5 h-5 rounded-full border-2 border-red-500/60 flex items-center justify-center shrink-0">
              <X size={10} className="text-red-400" />
            </div>
            <p className="text-[10px] text-red-400/80 text-center line-clamp-2">{item.failError}</p>
            <p className="text-[9px] text-slate-600 italic line-clamp-1">"{item.prompt}"</p>
          </div>
        ) : (
          <div
            key={item.id}
            className={`rounded-lg bg-black overflow-hidden relative group cursor-pointer transition-colors ${
              selectMode && selectedIds?.has(parseInt(item.id))
                ? "border-2 border-cyan-400 ring-2 ring-cyan-400 ring-inset"
                : "border border-white/5 hover:border-orange-500/30"
            }`}
            style={{ aspectRatio: "16/9" }}
            onClick={() => selectMode ? onSelectToggle?.(parseInt(item.id)) : onVideoClick({ id: item.dbId, videoUrl: item.videoUrl, prompt: item.prompt, model: item.model, duration: item.duration, resolution: item.resolution, aspectRatio: item.aspectRatio, audioEnabled: item.audioEnabled, startFrameUrl: item.startFrameUrl, endFrameUrl: item.endFrameUrl, motionVideoUrl: item.motionVideoUrl, keepOriginalSound: item.keepOriginalSound, characterOrientation: item.characterOrientation, createdAt: item.createdAt })}
          >
            <video src={iosSrc(item.videoUrl)} className={`w-full h-full pointer-events-none ${item.aspectRatio === "16:9" ? "object-cover" : "object-contain"}`} playsInline preload="metadata" muted />
            {/* Select mode checkmark */}
            {selectMode && (
              <div className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center z-10 transition-all ${
                selectedIds?.has(parseInt(item.id)) ? "bg-cyan-400 border-cyan-400" : "border-white/60 bg-black/40"
              }`}>
                {selectedIds?.has(parseInt(item.id)) && <Check size={9} className="text-black" />}
              </div>
            )}
            {/* Play overlay (hidden in select mode) */}
            {!selectMode && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
                  <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </div>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <p className="text-[10px] text-white/80 line-clamp-1">"{item.prompt}"</p>
              <p className="text-[9px] text-orange-400/70 font-mono mt-0.5">{item.model} · {item.duration}s</p>
            </div>
          </div>
        )
      )}

      {/* Historical feed from DB — same as image scanner */}
      {dbImages
        .filter(img => !sessionDbIds.has(img.id))
        .map(img => (
          isVideoUrl(img.imageUrl) ? (
            <div
              key={img.id}
              className={`rounded-lg bg-black overflow-hidden relative group cursor-pointer transition-colors ${
                selectMode && selectedIds?.has(img.id)
                  ? "border-2 border-cyan-400 ring-2 ring-cyan-400 ring-inset"
                  : "border border-white/5 hover:border-orange-500/30"
              }`}
              style={{ aspectRatio: "16/9" }}
              onClick={() => {
                if (selectMode) { onSelectToggle?.(img.id); return }
                const vm = img.videoMetadata || {}
                onVideoClick({ id: img.id, videoUrl: img.imageUrl, prompt: img.prompt, model: img.model, duration: vm.duration, resolution: vm.resolution || img.quality || undefined, aspectRatio: vm.aspectRatio || img.aspectRatio, audioEnabled: vm.audioEnabled, startFrameUrl: vm.startFrameUrl || undefined, endFrameUrl: vm.endFrameUrl || undefined, motionVideoUrl: vm.motionVideoUrl || undefined, keepOriginalSound: vm.keepOriginalSound, characterOrientation: vm.characterOrientation || undefined, createdAt: img.createdAt })
              }}
            >
              <video src={iosSrc(img.imageUrl)} className={`w-full h-full pointer-events-none ${(img.videoMetadata?.aspectRatio || img.aspectRatio) === "16:9" ? "object-cover" : "object-contain"}`} playsInline preload="metadata" muted />
              {selectMode && (
                <div className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center z-10 transition-all ${
                  selectedIds?.has(img.id) ? "bg-cyan-400 border-cyan-400" : "border-white/60 bg-black/40"
                }`}>
                  {selectedIds?.has(img.id) && <Check size={9} className="text-black" />}
                </div>
              )}
              {!selectMode && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                  <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
                    <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </div>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <p className="text-[10px] text-white/80 line-clamp-1">"{img.prompt}"</p>
                <p className="text-[9px] text-orange-400/70 font-mono mt-0.5">{img.model}</p>
              </div>
            </div>
          ) : (
            <div
              key={img.id}
              className="rounded-lg bg-black border border-white/5 overflow-hidden relative group cursor-pointer hover:border-white/15 transition-colors"
              style={{ aspectRatio: "16/9" }}
              onClick={() => { const vm = img.videoMetadata || {}; onVideoClick({ videoUrl: img.imageUrl, prompt: img.prompt, model: img.model, duration: vm.duration, resolution: vm.resolution || img.quality || undefined, aspectRatio: vm.aspectRatio || img.aspectRatio, audioEnabled: vm.audioEnabled, startFrameUrl: vm.startFrameUrl || undefined, endFrameUrl: vm.endFrameUrl || undefined, motionVideoUrl: vm.motionVideoUrl || undefined, keepOriginalSound: vm.keepOriginalSound, characterOrientation: vm.characterOrientation || undefined, createdAt: img.createdAt }) }}
            >
              <img src={img.imageUrl} alt={img.prompt} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <p className="text-[10px] text-white/80 line-clamp-1">"{img.prompt}"</p>
                <p className="text-[9px] text-slate-400/70 font-mono mt-0.5">{img.model}</p>
              </div>
            </div>
          )
        ))
      }

      {/* Persisted failed tiles from previous sessions — deduped against live session items */}
      {(() => {
        const liveFailIds = new Set(items.filter(i => i.failed).map(i => i.id))
        return savedFails
          .filter(f => !liveFailIds.has(f.id))
          .map(item => (
            <div
              key={`sf-${item.id}`}
              className="rounded-lg bg-slate-900 border border-red-500/20 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:border-red-500/40 transition-colors"
              style={{ aspectRatio: "16/9" }}
              onClick={() => onVideoClick({ videoUrl: "", prompt: item.prompt, model: item.model, duration: item.duration, createdAt: item.createdAt, failed: true, failError: item.failError })}
            >
              <div className="w-5 h-5 rounded-full border-2 border-red-500/60 flex items-center justify-center shrink-0">
                <X size={10} className="text-red-400" />
              </div>
              <p className="text-[10px] text-red-400/80 text-center line-clamp-2">{item.failError}</p>
              <p className="text-[9px] text-slate-600 italic line-clamp-1">"{item.prompt}"</p>
            </div>
          ))
      })()}

      {/* Infinite scroll sentinel — triggers next page load when scrolled into view */}
      <div ref={videoSentinelRef} className="col-span-full h-1" />
      {dbLoading && (
        <div className="col-span-full flex justify-center py-4">
          <div className="w-5 h-5 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin" />
        </div>
      )}
    </div>
  )
}

function VideoPromptBar({
  model, onGenerate, generating, canGenerate, queueFull, duration, resolution, aspectRatio, audioEnabled,
  onModelChange, promptOverride, characterOrientation, motionVideoDuration, onConfigOpen,
  startFramePreview, startFrameUploading, onStartFrameSelect,
  motionVideoFilename, motionVideoUploading, onMotionVideoSelect, onMotionVideoDurationChange,
  motionPromptText, lipsyncVideoDuration, isGenerationMaintenance = false,
}: {
  model: VideoModelConfig
  onGenerate: (prompt: string) => void
  generating: boolean
  canGenerate: boolean
  queueFull: boolean
  duration: string
  resolution: string
  aspectRatio: string
  audioEnabled: boolean
  onModelChange: (m: VideoModelConfig) => void
  promptOverride?: { text: string; version: number }
  characterOrientation: string
  motionVideoDuration: number | null
  onConfigOpen: () => void
  // Motion Control upload slots (mobile only)
  startFramePreview: string | null
  startFrameUploading: boolean
  onStartFrameSelect: (f: File) => void
  motionVideoFilename: string | null
  motionVideoUploading: boolean
  onMotionVideoSelect: (f: File) => void
  onMotionVideoDurationChange: (d: number) => void
  motionPromptText: string
  lipsyncVideoDuration?: number
  isGenerationMaintenance?: boolean
}) {
  const [prompt, setPrompt] = useState("")
  const [modelOpen, setModelOpen] = useState(false)
  const startFrameInputRef = useRef<HTMLInputElement>(null)
  const motionVideoInputRef = useRef<HTMLInputElement>(null)

  const modelRef = useRef<HTMLDivElement>(null)
  const overrideVersion = promptOverride?.version ?? 0
  useEffect(() => {
    if (overrideVersion > 0 && promptOverride?.text) setPrompt(promptOverride.text)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideVersion])

  useEffect(() => {
    if (!modelOpen) return
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [modelOpen])

  const motionMaxSec = characterOrientation === "video" ? 30 : 10
  const isSD20FamilyBar = model.id === "seedance-2.0" || model.id === "seedance-2.0-fast"
  const isLipsyncModel = !!model.supportsLipsync
  const ticketCost = isLipsyncModel
    ? Math.max(10, Math.ceil((lipsyncVideoDuration ?? 0) * 6))
    : model.id === "kling-v3-motion"
    ? Math.ceil(motionVideoDuration ?? motionMaxSec) * 6
    : model.id === "kling-v3"
    ? parseInt(duration) * (audioEnabled ? 8 : 6)
    : model.id === "seedance-1.5"
    ? Math.ceil(parseInt(duration) * 2.0 * (resolution === "1080p" ? 2.25 : resolution === "480p" ? 0.5 : 1.0) * (audioEnabled ? 1.0 : 0.5)) + 1
    : isSD20FamilyBar
    ? Math.ceil(parseInt(duration === "auto" ? "5" : duration) * (model.id === "seedance-2.0-fast" ? 12 : 15) * (resolution === "1080p" ? 2.25 : resolution === "480p" ? 0.5 : 1.0))
    : model.id === "happy-horse"
    ? parseInt(duration) * (resolution === "1080p" ? 12 : 7)
    : ({ "480p": { "5": 7, "10": 14 }, "720p": { "5": 13, "10": 26 }, "1080p": { "5": 20, "10": 40 } } as any)[resolution]?.[duration] ?? 20

  const metaLine = isLipsyncModel
    ? lipsyncVideoDuration ? `${lipsyncVideoDuration.toFixed(1)}s · 6/sec` : "upload video + audio"
    : model.id === "kling-v3-motion"
    ? motionVideoDuration ? `${motionVideoDuration.toFixed(1)}s · 6/sec` : `≤${motionMaxSec}s · 6/sec`
    : model.id === "kling-v3"
    ? `${duration}s${startFramePreview ? "" : ` · ${aspectRatio}`}${audioEnabled ? " · audio" : ""}`
    : model.id === "seedance-1.5"
    ? `${resolution} · ${duration}s · ${aspectRatio}${audioEnabled ? " · audio" : ""}`
    : isSD20FamilyBar
    ? `${resolution} · ${duration === "auto" ? "auto" : duration + "s"}${audioEnabled ? " · audio" : ""}`
    : `${resolution} · ${duration}s`

  const ready = !isGenerationMaintenance && ((model.id === "kling-v3-motion" || isLipsyncModel) ? canGenerate : canGenerate && !!prompt.trim())
  const promptPlaceholder = model.id === "kling-v3-motion"
    ? "Describe additional details (optional)..."
    : isLipsyncModel
    ? "No prompt needed — just upload video and audio above"
    : model.textToVideo
    ? "Describe the scene (required)..."
    : "Describe the motion..."

  return (
    <div className="fixed bottom-0 left-0 sm:left-72 right-0 z-30 border-t border-white/5 bg-[#050810]/95 backdrop-blur-md">

      {/* ── Mobile layout (< sm) ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:hidden">

        {model.id === "kling-v3-motion" ? (
          /* ── Motion Control: upload slots replace the prompt row ── */
          <>
            {/* Hidden file inputs */}
            <input
              ref={startFrameInputRef}
              type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; onStartFrameSelect(f) } }}
            />
            <input
              ref={motionVideoInputRef}
              type="file" accept="video/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (!f) return
                e.target.value = ""
                // Read actual duration before uploading so ticket cost is correct
                const objUrl = URL.createObjectURL(f)
                const vid = document.createElement("video")
                vid.preload = "metadata"
                vid.onloadedmetadata = () => {
                  URL.revokeObjectURL(objUrl)
                  onMotionVideoDurationChange(vid.duration)
                  onMotionVideoSelect(f)
                }
                vid.onerror = () => { URL.revokeObjectURL(objUrl); onMotionVideoSelect(f) }
                vid.src = objUrl
              }}
            />

            {/* Row 1: Side-by-side upload slots */}
            <div className="flex gap-2">
              {/* Reference image slot */}
              <button
                onClick={() => startFrameInputRef.current?.click()}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-xs font-medium ${
                  startFramePreview
                    ? "border-green-500/40 bg-green-500/8 text-green-400"
                    : "border-dashed border-white/15 bg-white/3 text-slate-500 hover:border-white/30 hover:text-slate-300"
                }`}
              >
                {startFrameUploading ? (
                  <><div className="w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin shrink-0" /><span className="truncate">Uploading…</span></>
                ) : startFramePreview ? (
                  <><Check size={12} className="shrink-0" /><span className="truncate">Image ready</span></>
                ) : (
                  <><Image size={12} className="shrink-0" /><span className="truncate">Reference Image</span></>
                )}
              </button>

              {/* Motion video slot */}
              <button
                onClick={() => motionVideoInputRef.current?.click()}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-xs font-medium ${
                  motionVideoFilename
                    ? "border-orange-500/40 bg-orange-500/8 text-orange-400"
                    : "border-dashed border-white/15 bg-white/3 text-slate-500 hover:border-white/30 hover:text-slate-300"
                }`}
              >
                {motionVideoUploading ? (
                  <><div className="w-3 h-3 rounded-full border-2 border-orange-400/30 border-t-orange-400 animate-spin shrink-0" /><span className="truncate">Uploading…</span></>
                ) : motionVideoFilename ? (
                  <><Check size={12} className="shrink-0" /><span className="truncate">Video ready</span></>
                ) : (
                  <><Video size={12} className="shrink-0" /><span className="truncate">Motion Video</span></>
                )}
              </button>
            </div>

            {/* Row 2: Config (with prompt inside) + meta + Generate */}
            <div className="flex items-center gap-2">
              <button
                onClick={onConfigOpen}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold shrink-0 transition-all ${
                  motionPromptText
                    ? "border-orange-500/30 bg-orange-500/10 text-orange-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/8"
                }`}
              >
                <SlidersHorizontal size={13} className="text-orange-400" />
                {motionPromptText ? "Config ✦" : "Config"}
              </button>
              <span className="flex-1 text-[10px] text-center font-mono truncate">
                {queueFull
                  ? <span className="text-red-400/80">Queue full</span>
                  : <span className="text-slate-500">{metaLine}</span>
                }
              </span>
              <button
                onClick={() => ready && onGenerate(motionPromptText)}
                disabled={!ready}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition-all ${
                  ready
                    ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:opacity-90"
                    : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
                }`}
              >
                {generating
                  ? <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  : !isGenerationMaintenance && <><Ticket size={11} />{ticketCost}</>
                }
                {isGenerationMaintenance ? "Temporarily Offline" : "Generate"}
              </button>
            </div>
          </>
        ) : (
          /* ── All other models: standard prompt row ── */
          <>
            {/* Row 1: Prompt — full width */}
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && ready) { e.preventDefault(); onGenerate(prompt) } }}
              placeholder={promptPlaceholder}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-orange-500/40 transition-all"
            />
            {/* Row 2: Configure + meta + Generate */}
            <div className="flex items-center gap-2">
              <button
                onClick={onConfigOpen}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 text-slate-300 text-xs font-semibold shrink-0 transition-all"
              >
                <SlidersHorizontal size={13} className="text-orange-400" />
                Config
              </button>
              <span className="flex-1 text-[10px] text-center font-mono truncate">
                {queueFull
                  ? <span className="text-red-400/80">Queue full</span>
                  : <span className="text-slate-500">{metaLine}</span>
                }
              </span>
              <button
                onClick={() => ready && onGenerate(prompt)}
                disabled={!ready}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition-all ${
                  ready
                    ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:opacity-90"
                    : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
                }`}
              >
                {generating
                  ? <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  : !isGenerationMaintenance && <><Ticket size={11} />{ticketCost}</>
                }
                {isGenerationMaintenance ? "Temporarily Offline" : "Generate"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Desktop layout (≥ sm) ─────────────────────────────────────────── */}
      <div className="hidden sm:flex gap-2 items-end px-4 py-3">

        {/* Model switcher */}
        <div className="relative shrink-0" ref={modelRef}>
          <button
            onClick={() => setModelOpen(v => !v)}
            className="flex items-center gap-1.5 h-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-all text-[11px] text-slate-300 font-medium whitespace-nowrap"
          >
            <Video size={11} className="text-orange-400 shrink-0" />
            {model.name}
            <ChevronDown size={10} className={`text-slate-500 transition-transform ${modelOpen ? "rotate-180" : ""}`} />
          </button>
          {modelOpen && (
            <div className="absolute bottom-full mb-1.5 left-0 bg-slate-900 border border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[180px]">
              {VIDEO_MODEL_CONFIGS.map(m => (
                <button
                  key={m.id}
                  onClick={() => { onModelChange(m); setModelOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 transition-colors ${
                    m.id === model.id
                      ? "bg-orange-500/15 text-orange-400"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {m.id === model.id && <span className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />}
                  <span className="flex-1">{m.name}</span>
                  {VIDEO_MODEL_COST[m.id] && <CostBadge tier={VIDEO_MODEL_COST[m.id]} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Prompt textarea */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && ready) { e.preventDefault(); onGenerate(prompt) } }}
          placeholder={promptPlaceholder}
          rows={2}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-orange-500/30 transition-all"
        />


        {/* Generate button + meta */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {queueFull
            ? <span className="text-[10px] text-red-400/80 font-mono">Queue full</span>
            : <span className="text-[10px] text-slate-500 font-mono">{metaLine}</span>
          }
          <button
            onClick={() => ready && onGenerate(prompt)}
            disabled={!ready}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-semibold transition-all ${
              ready
                ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:opacity-90"
                : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
            }`}
          >
            {generating
              ? <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              : !isGenerationMaintenance && <><Ticket size={11} />{ticketCost}</>
            }
            {isGenerationMaintenance ? "Temporarily Offline" : "Generate"}
          </button>
        </div>
      </div>

    </div>
  )
}

// --- NEWS DROPDOWN ---
const NEWS_TYPE_CONFIG = {
  info:     { text: "text-cyan-400",    dot: "bg-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    icon: Info         },
  warning:  { text: "text-amber-400",   dot: "bg-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   icon: AlertTriangle },
  success:  { text: "text-emerald-400", dot: "bg-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: CheckCircle   },
  update:   { text: "text-fuchsia-400", dot: "bg-fuchsia-400", bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", icon: Sparkles      },
  tutorial: { text: "text-violet-400",  dot: "bg-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30",  icon: BookOpen      },
} as const

interface PortalNotification {
  id: number
  message: string
  type: string
  locked: boolean
  createdAt: string
}

interface NewsArticlePreview {
  id: number
  title: string
  slug: string
  type: string
  summary: string
  previewImage: string | null
  createdAt: string
  publishedAt: string | null
}

// Parses [link text](url) syntax into clickable links
function parseNotifMessage(message: string) {
  const parts = message.split(/(\[[^\]]+\]\([^)]+\))/g)
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (match) {
      return (
        <a key={i} href={match[2]} target="_blank" rel="noopener noreferrer"
          className="underline font-bold hover:opacity-80 transition-opacity">
          {match[1]}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function NewsDropdown({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [articles, setArticles] = useState<NewsArticlePreview[]>([])
  const [dismissed, setDismissed] = useState<number[]>([])
  const [dismissedArticles, setDismissedArticles] = useState<number[]>([])

  // Load dismissed IDs from localStorage
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("dismissed-portal-news") || "[]")
    setDismissed(stored)
    const storedArticles = JSON.parse(localStorage.getItem("dismissed-portal-articles") || "[]")
    setDismissedArticles(storedArticles)
  }, [])

  // Fetch portal notifications
  const fetchNews = useCallback(async () => {
    try {
      const [notifRes, articleRes] = await Promise.all([
        fetch("/api/notifications?target=portal"),
        fetch("/api/news"),
      ])
      if (notifRes.ok) setNotifications(await notifRes.json())
      if (articleRes.ok) setArticles(await articleRes.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchNews()
    const interval = setInterval(fetchNews, 60000)
    return () => clearInterval(interval)
  }, [fetchNews])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, onToggle])

  // Position the dropdown below the button
  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 320) })
    }
  }, [open])

  const handleDismiss = (id: number) => {
    const next = [...dismissed, id]
    setDismissed(next)
    localStorage.setItem("dismissed-portal-news", JSON.stringify(next))
  }

  const handleDismissArticle = (id: number) => {
    const next = [...dismissedArticles, id]
    setDismissedArticles(next)
    localStorage.setItem("dismissed-portal-articles", JSON.stringify(next))
  }

  const handleDismissAll = () => {
    const dismissibleIds = visibleNotifs.filter(n => !n.locked).map(n => n.id)
    const nextNotifs = [...dismissed, ...dismissibleIds]
    setDismissed(nextNotifs)
    localStorage.setItem("dismissed-portal-news", JSON.stringify(nextNotifs))

    const nextArticles = [...dismissedArticles, ...visibleArticles.map(a => a.id)]
    setDismissedArticles(nextArticles)
    localStorage.setItem("dismissed-portal-articles", JSON.stringify(nextArticles))
  }

  const visibleNotifs = notifications.filter(n => !dismissed.includes(n.id))
  const visibleArticles = articles.filter(a => !dismissedArticles.includes(a.id))
  const unreadCount = visibleNotifs.length + visibleArticles.length

  function relativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`relative flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Bell size={15} />
        News
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-fuchsia-500 ring-1 ring-black" />
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="fixed w-80 rounded-xl border border-white/10 bg-slate-900/98 backdrop-blur-md shadow-2xl overflow-hidden z-[9999]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-slate-500" />
              <span className="text-[12px] font-semibold text-slate-300 tracking-wide">News & Updates</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 text-[10px] font-mono">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleDismissAll}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Dismiss all
              </button>
            )}
          </div>

          {/* Content */}
          <div className="max-h-[28rem] overflow-y-auto">
            {unreadCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
                <Bell size={20} strokeWidth={1.5} />
                <p className="text-[12px]">All caught up</p>
              </div>
            ) : (
              <>
                {/* News Article Previews */}
                {visibleArticles.length > 0 && (
                  <div>
                    {visibleArticles.length > 0 && visibleNotifs.length > 0 && (
                      <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Articles</p>
                    )}
                    {visibleArticles.map(a => {
                      const cfg = NEWS_TYPE_CONFIG[a.type as keyof typeof NEWS_TYPE_CONFIG] ?? NEWS_TYPE_CONFIG.update
                      const Icon = cfg.icon
                      return (
                        <div
                          key={`article-${a.id}`}
                          className="group px-3 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.04] transition-colors cursor-pointer"
                          onClick={() => { window.location.href = `/news/${a.slug}`; onToggle() }}
                        >
                          <div className="flex items-start gap-2.5">
                            {a.previewImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={a.previewImage}
                                alt=""
                                className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10"
                              />
                            ) : (
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} border ${cfg.border}`}>
                                <Icon size={16} className={cfg.text} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[10px] font-semibold ${cfg.text}`}>{a.type === 'success' ? 'Update' : a.type === 'update' ? 'Patch' : a.type === 'tutorial' ? 'Tutorial' : a.type.charAt(0).toUpperCase() + a.type.slice(1)}</span>
                                <span className="text-slate-700 text-[10px]">·</span>
                                <span className="text-[10px] text-slate-600">{relativeTime(a.publishedAt || a.createdAt)}</span>
                              </div>
                              <p className="text-[12px] text-slate-200 font-medium leading-snug truncate">{a.title}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{a.summary}</p>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); handleDismissArticle(a.id) }}
                              className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 hover:bg-white/8 transition-all opacity-0 group-hover:opacity-100 mt-0.5"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Notifications */}
                {visibleNotifs.length > 0 && (
                  <div>
                    {visibleArticles.length > 0 && (
                      <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Updates</p>
                    )}
                    {visibleNotifs.map((n) => {
                      const cfg = NEWS_TYPE_CONFIG[n.type as keyof typeof NEWS_TYPE_CONFIG] ?? NEWS_TYPE_CONFIG.info
                      const Icon = cfg.icon
                      return (
                        <div key={n.id} className="group px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${cfg.dot}/15`}>
                              <Icon size={11} className={cfg.text} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] text-slate-200 leading-relaxed">{parseNotifMessage(n.message)}</p>
                              <p className="text-[10px] text-slate-600 mt-1">{relativeTime(n.createdAt)}</p>
                            </div>
                            {n.locked ? (
                              <div className="shrink-0 w-5 h-5 flex items-center justify-center text-amber-500/50" title="Pinned">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleDismiss(n.id)}
                                className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 hover:bg-white/8 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// --- SHOP DROPDOWN ---
function ShopDropdown({
  open, onToggle, user,
}: {
  open: boolean
  onToggle: () => void
  user: UserData | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [loginPrompt, setLoginPrompt] = useState(false)

  useEffect(() => {
    if (!open) { setLoginPrompt(false); return }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 328) })
    }
  }, [open])

  function handleNav(path: string) {
    if (!user) { setLoginPrompt(true); return }
    window.location.href = path
    onToggle()
  }

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <ShoppingBag size={15} />
        Shop
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-80 rounded-2xl border border-white/10 bg-[#0a0f1e] backdrop-blur-xl shadow-2xl shadow-black/70 z-[9999] overflow-hidden" style={{ top: menuPos.top, left: menuPos.left }}>

          {/* ── Tickets card ── */}
          <div className="p-3">
            <button
              onClick={() => handleNav("/buy-tickets")}
              className="w-full rounded-xl border border-white/10 bg-slate-800/60 hover:bg-slate-700/50 hover:border-white/20 transition-all group overflow-hidden"
            >
              <div className="px-4 py-3.5 text-left">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-700 border border-white/10 flex items-center justify-center shrink-0">
                      <Ticket size={14} className="text-slate-200" />
                    </div>
                    <span className="text-[13px] font-bold text-white">Ticket Dispenser</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-300 transition-colors">Buy →</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Tickets power every generation. Each image or video costs tickets — the amount depends on the model. Packs are one-time purchases and never expire.
                </p>
              </div>
              <div className="px-4 py-2 border-t border-white/8 bg-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-medium">Packs from 25 → 1,000 tickets</span>
                <span className="text-[10px] font-bold text-slate-400 group-hover:text-white transition-colors">Shop now →</span>
              </div>
            </button>
          </div>

          <div className="mx-3 border-t border-white/6" />

          {/* ── Dev Tier card ── */}
          <div className="p-3">
            <button
              onClick={() => handleNav("/prompting-studio/subscribe")}
              className="w-full rounded-xl border border-white/10 bg-slate-800/60 hover:bg-slate-700/50 hover:border-white/20 transition-all group overflow-hidden"
            >
              <div className="px-4 py-3.5 text-left">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-700 border border-white/10 flex items-center justify-center shrink-0">
                      <Sparkles size={13} className="text-slate-200" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-white">Dev Tier</span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-700 border border-white/10 px-1.5 py-0.5 rounded-full">Subscription</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-300 transition-colors">View →</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  Unlock the full studio with a recurring plan — tickets auto-delivered every cycle, discounts on purchases, and more slots.
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {[
                    { label: "30% off all ticket purchases", bright: true },
                    { label: "250–500 tickets per cycle", bright: true },
                    { label: "8 concurrent generations", bright: true },
                    { label: "100 Refs slots (2× free tier)", bright: true },
                    { label: "AI prompt generation", bright: false },
                    { label: "Early feature access", bright: false },
                  ].map(({ label, bright }) => (
                    <div key={label} className="flex items-start gap-1.5">
                      <Check size={9} className={`shrink-0 mt-0.5 ${bright ? "text-slate-300" : "text-slate-600"}`} />
                      <span className={`text-[10px] leading-snug ${bright ? "text-slate-200" : "text-slate-500"}`}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 py-2 border-t border-white/8 bg-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-medium">Biweekly · Monthly · Yearly</span>
                <span className="text-[10px] font-bold text-slate-400 group-hover:text-white transition-colors">See plans →</span>
              </div>
            </button>
          </div>

          {loginPrompt && (
            <div className="mx-3 mb-3 px-3.5 py-3 rounded-xl border border-white/10 bg-slate-800/60 space-y-1">
              <p className="text-[11px] text-slate-200 font-semibold">Sign in required</p>
              <p className="text-[10px] text-slate-500">You need to be logged in to visit the shop.</p>
              <a href="/dashboard" className="text-[11px] text-slate-400 hover:text-white hover:underline transition-colors">
                Go to login →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- MAIN PAGE ---
export default function PortalV2Page() {
  const [user, setUser] = useState<UserData | null>(null)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ImageModelConfig>(
    () => IMAGE_MODEL_CONFIGS.find(m => m.id === "nano-banana-pro-2")!
  )
  const [pendingSlots, setPendingSlots] = useState<PendingSlot[]>([])
  const [freshImages, setFreshImages] = useState<ImageItem[]>([])
  // Restored failures from a previous session — kept separate so they can be
  // interleaved with DB images by timestamp instead of crowding the top of the feed.
  const [savedFails, setSavedFails] = useState<ImageItem[]>([])
  const [refLibrary, setRefLibrary] = useState<RefImage[]>([])
  const [activeRefIds, setActiveRefIds] = useState<string[]>([])
  const [hasPromptStudioDev, setHasPromptStudioDev] = useState(false)
  const [isAdminAccount, setIsAdminAccount] = useState(false)
  const [isAuditAccount, setIsAuditAccount] = useState(false)
  const [isGenerationMaintenance, setIsGenerationMaintenance] = useState(false)
  const [promptOverride, setPromptOverride] = useState<{ text: string; version: number }>({ text: "", version: 0 })
  const [videoPromptOverride, setVideoPromptOverride] = useState<{ text: string; version: number }>({ text: "", version: 0 })
  const [configOverride, setConfigOverride] = useState<{ aspectRatio?: string; quality?: string; outputFormat?: string; imageCount?: number; version: number }>({ version: 0 })
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<VideoDetailData | null>(null)
  const [pendingDetail, setPendingDetail] = useState<PendingSlot | null>(null)
  const [videoPendingDetail, setVideoPendingDetail] = useState<VideoPendingSlot | null>(null)

  // --- Select mode ---
  const [selectMode, setSelectMode] = useState(false)
  const [selectedImageIds, setSelectedImageIds] = useState<Set<number>>(new Set())
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleSelectToggle = (id: number) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleToggleSelectMode = () => {
    setSelectMode(v => !v)
    setSelectedImageIds(new Set())
  }

  const handleBulkDownload = async () => {
    if (selectedImageIds.size === 0) return
    const ids = Array.from(selectedImageIds)
    setBulkDownloading(true)
    setDownloadError(null)
    setDownloadProgress({ done: 0, total: ids.length })

    // Delay URL revocation — revoking immediately after a.click() causes silent
    // failures on iOS Safari before the browser has had a chance to initiate the
    // download fetch.
    const triggerDownload = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }

    try {
      if (ids.length === 1) {
        // Single file — direct proxy download
        const res = await fetch(`/api/images/${ids[0]}?download=1`)
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        const blob = await res.blob()
        const ext = blob.type.includes("mp4") || blob.type.includes("video") ? "mp4"
                  : blob.type.includes("webm") ? "webm"
                  : blob.type.includes("jpeg") ? "jpg"
                  : blob.type.includes("webp") ? "webp"
                  : "png"
        triggerDownload(blob, `file-${ids[0]}.${ext}`)
        setDownloadProgress({ done: 1, total: 1 })
      } else {
        // Multiple files — server builds the zip so the client never has to
        // hold every raw image blob in JS heap simultaneously (avoids the
        // iPad Safari memory crash that occurred with the old client-side
        // JSZip approach for large selections).
        const url = `/api/images/zip?ids=${ids.join(",")}`
        const res = await fetch(url)
        if (!res.ok) throw new Error("Zip generation failed")

        // Stream the response body so we can report download progress
        const contentLength = parseInt(res.headers.get("Content-Length") ?? "0")
        const reader = res.body!.getReader()
        const chunks: BlobPart[] = []
        let received = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.length
            if (contentLength > 0) {
              setDownloadProgress({
                done: Math.min(Math.round((received / contentLength) * ids.length), ids.length - 1),
                total: ids.length,
              })
            }
          }
        }

        const zipBlob = new Blob(chunks, { type: "application/zip" })
        setDownloadProgress({ done: ids.length, total: ids.length })
        triggerDownload(zipBlob, `selections-${Date.now()}.zip`)
      }
    } catch (err) {
      console.error("Bulk download failed:", err)
      const msg = err instanceof Error ? err.message : "Download failed"
      setDownloadError(msg.includes("storage") || msg.includes("quota") || msg.includes("QuotaExceededError")
        ? "Not enough storage space"
        : msg.includes("Network") || msg.includes("fetch")
          ? "Network error — check your connection"
          : "Download failed")
    } finally {
      setBulkDownloading(false)
      setTimeout(() => setDownloadProgress(null), 600)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedImageIds.size === 0) return
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/my-images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedImageIds) }),
      })
      if (res.ok) {
        setSelectedImageIds(new Set())
        setSelectMode(false)
        // Force image grid to reload by bumping a key
        setImageGridKey(k => k + 1)
      }
    } catch {}
    finally { setBulkDeleting(false) }
  }

  const [imageGridKey, setImageGridKey] = useState(0)

  // --- Video scanner state ---
  const [scannerMode, setScannerMode] = useState<"image" | "video">("image")
  const [selectedVideoModel, setSelectedVideoModel] = useState<VideoModelConfig>(() => VIDEO_MODEL_CONFIGS[0])
  const [videoDuration, setVideoDuration] = useState("5")
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9")
  const [videoResolution, setVideoResolution] = useState("1080p")
  const [videoAudioEnabled, setVideoAudioEnabled] = useState(false)
  const [videoAudioFile, setVideoAudioFile] = useState<File | null>(null)
  const [videoAudioUrl, setVideoAudioUrl] = useState<string | null>(null)
  const [videoStartFramePreview, setVideoStartFramePreview] = useState<string | null>(null)
  const [videoStartFrameUrl, setVideoStartFrameUrl] = useState<string | null>(null)
  const [videoEndFramePreview, setVideoEndFramePreview] = useState<string | null>(null)
  const [videoEndFrameUrl, setVideoEndFrameUrl] = useState<string | null>(null)
  const [videoItems, setVideoItems] = useState<VideoItem[]>([])
  const [videoPendingSlots, setVideoPendingSlots] = useState<VideoPendingSlot[]>([])
  const [savedVideoFails, setSavedVideoFails] = useState<VideoItem[]>([])
  const [videoGenerating, setVideoGenerating] = useState(false)
  const videoPollingIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const [videoConfigOpen, setVideoConfigOpen] = useState(false)
  // Motion Control state
  const [videoMotionPromptText, setVideoMotionPromptText] = useState("")
  const [videoMotionVideoPreview, setVideoMotionVideoPreview] = useState<string | null>(null)
  const [videoMotionVideoUrl, setVideoMotionVideoUrl] = useState<string | null>(null)
  const [videoMotionVideoDuration, setVideoMotionVideoDuration] = useState<number | null>(null)
  const [videoCharacterOrientation, setVideoCharacterOrientation] = useState<"image" | "video">("image")
  const [videoKeepOriginalSound, setVideoKeepOriginalSound] = useState(true)
  const [videoSD20Mode, setVideoSD20Mode] = useState<"t2v" | "i2v" | "r2v">("t2v")
  // SeeDance 2.0 reference-to-video state
  const [videoRefImagePreviews, setVideoRefImagePreviews] = useState<string[]>([])
  const [videoRefImageUrls, setVideoRefImageUrls] = useState<(string | null)[]>([])
  const [videoRefVideoFilenames, setVideoRefVideoFilenames] = useState<string[]>([])
  const [videoRefVideoUrls, setVideoRefVideoUrls] = useState<(string | null)[]>([])
  const [videoRefAudioFilenames, setVideoRefAudioFilenames] = useState<string[]>([])
  const [videoRefAudioUrls, setVideoRefAudioUrls] = useState<(string | null)[]>([])
  const [videoRefVideoDuration, setVideoRefVideoDuration] = useState<number>(0)
  // Lipsync v3 state
  const [videoLipsyncVideoFilename, setVideoLipsyncVideoFilename] = useState<string | null>(null)
  const [videoLipsyncVideoUrl, setVideoLipsyncVideoUrl] = useState<string | null>(null)
  const [videoLipsyncVideoDuration, setVideoLipsyncVideoDuration] = useState<number>(0)
  const [videoLipsyncAspectRatio, setVideoLipsyncAspectRatio] = useState<string | undefined>(undefined)
  const [videoLipsyncAudioFilename, setVideoLipsyncAudioFilename] = useState<string | null>(null)
  const [videoLipsyncAudioUrl, setVideoLipsyncAudioUrl] = useState<string | null>(null)
  const [videoLipsyncSyncMode, setVideoLipsyncSyncMode] = useState<string>("cut_off")
  const [wan25VideoSafetyChecker, setWan25VideoSafetyChecker] = useState(false)
  const [seedance15VideoSafetyChecker, setSeedance15VideoSafetyChecker] = useState(false)

  const handleAddPending    = useCallback((slot: PendingSlot) => setPendingSlots(p => [slot, ...p]), [])
  const handleUpdatePending = useCallback((slotId: string, update: Partial<PendingSlot>) => {
    if (update.status === "failed") {
      // Compute the ID outside the updater — React Strict Mode double-invokes updaters,
      // so creating it inside would produce two different timestamps and two duplicate tiles.
      const failId = -Date.now()
      const failedAt = new Date().toISOString()
      setPendingSlots(prev => {
        const slot = prev.find(s => s.slotId === slotId)
        if (slot) {
          const failedItem: ImageItem = {
            id: failId,
            imageUrl: '',
            prompt: slot.prompt,
            model: slot.modelId || '',
            failed: true,
            failError: update.error,
            createdAt: failedAt,
            aspectRatio: slot.nb2AspectRatio || slot.aspectRatio,
            quality: slot.nb2Quality || slot.quality,
            referenceImageUrls: slot.referenceImageUrls || [],
          }
          // Defer to avoid calling a setter inside another setter's updater
          setTimeout(() => {
            setFreshImages(fi => fi.some(i => i.id === failedItem.id) ? fi : [failedItem, ...fi])
            setSavedFails(sf => sf.some(i => i.id === failedItem.id) ? sf : [failedItem, ...sf])
          }, 0)
        }
        return prev.filter(s => s.slotId !== slotId)
      })
    } else {
      setPendingSlots(p => p.map(s => s.slotId === slotId ? { ...s, ...update } : s))
    }
  }, [])
  const handleRemovePending = useCallback((slotId: string) =>
    setPendingSlots(p => p.filter(s => s.slotId !== slotId)), [])
  // Deduplicate by ID and imageUrl — prevents same image appearing twice when
  // multiple polling intervals complete and each fetches /api/my-images
  const handlePrependImage = useCallback((img: ImageItem) =>
    setFreshImages(p => p.some(i => i.id === img.id || i.imageUrl === img.imageUrl) ? p : [img, ...p]), [])
  const handleBalanceChange = useCallback((balance: number) =>
    setUser(u => u ? { ...u, ticketBalance: balance } : u), [])

  // Clear stale pv2-flux-images localStorage key (written by old code before DB saving was added)
  useEffect(() => {
    localStorage.removeItem("pv2-flux-images")
  }, [])

  // --- Video handlers ---
  const uploadVideoFrame = useCallback(async (file: File): Promise<string | null> => {
    try {
      let uploadFile: File | Blob = file
      let mimeType = file.type || 'application/octet-stream'
      // Compress images before upload
      if (file.type.startsWith("image/")) {
        const dataUrl = await compressFileToDataUrl(file, 1920, 0.85)
        const res2 = await fetch(dataUrl)
        const blob = await res2.blob()
        uploadFile = new File([blob], file.name, { type: 'image/jpeg' })
        mimeType = 'image/jpeg'
      }

      // Get a presigned R2 URL — client uploads directly, bypassing Vercel's 4.5MB limit
      const presignRes = await fetch("/api/admin/upload-frame-presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType }),
      })
      if (!presignRes.ok) {
        console.error('Presign failed:', await presignRes.text().catch(() => ''))
        return null
      }
      const { uploadUrl, publicUrl } = await presignRes.json()

      // PUT directly to R2 — no Vercel body limit
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: uploadFile,
      })
      if (!putRes.ok) {
        console.error('R2 PUT failed:', putRes.status)
        return null
      }
      return publicUrl
    } catch (err) {
      console.error('uploadVideoFrame error:', err)
      return null
    }
  }, [])

  const handleVideoStartFrameSelect = useCallback(async (file: File) => {
    setVideoStartFramePreview(URL.createObjectURL(file))
    setVideoStartFrameUrl(null)
    const url = await uploadVideoFrame(file)
    setVideoStartFrameUrl(url)
  }, [uploadVideoFrame])

  const handleVideoEndFrameSelect = useCallback(async (file: File) => {
    setVideoEndFramePreview(URL.createObjectURL(file))
    setVideoEndFrameUrl(null)
    const url = await uploadVideoFrame(file)
    setVideoEndFrameUrl(url)
  }, [uploadVideoFrame])

  const handleVideoAudioSelect = useCallback(async (file: File) => {
    setVideoAudioFile(file)
    setVideoAudioUrl(null)
    const url = await uploadVideoFrame(file)
    setVideoAudioUrl(url)
  }, [uploadVideoFrame])

  const handleVideoMotionVideoSelect = useCallback(async (file: File) => {
    setVideoMotionVideoPreview(file.name)
    setVideoMotionVideoUrl(null)
    const url = await uploadVideoFrame(file)
    setVideoMotionVideoUrl(url)
  }, [uploadVideoFrame])

  // SeeDance 2.0 reference-to-video handlers
  const handleAddRefImage = useCallback(async (file: File) => {
    const preview = URL.createObjectURL(file)
    setVideoRefImagePreviews(p => [...p, preview])
    setVideoRefImageUrls(u => [...u, null])
    const idx = videoRefImagePreviews.length
    const url = await uploadVideoFrame(file)
    setVideoRefImageUrls(u => u.map((v, i) => i === idx ? url : v))
  }, [uploadVideoFrame, videoRefImagePreviews.length])

  const handleRemoveRefImage = useCallback((i: number) => {
    setVideoRefImagePreviews(p => p.filter((_, j) => j !== i))
    setVideoRefImageUrls(u => u.filter((_, j) => j !== i))
  }, [])

  const handleAddRefVideo = useCallback(async (file: File, duration: number) => {
    setVideoRefVideoFilenames(f => [...f, file.name])
    setVideoRefVideoUrls(u => [...u, null])
    setVideoRefVideoDuration(d => d + duration)
    const idx = videoRefVideoFilenames.length
    const url = await uploadVideoFrame(file)
    setVideoRefVideoUrls(u => u.map((v, i) => i === idx ? url : v))
  }, [uploadVideoFrame, videoRefVideoFilenames.length])

  const handleRemoveRefVideo = useCallback((i: number, duration: number) => {
    setVideoRefVideoFilenames(f => f.filter((_, j) => j !== i))
    setVideoRefVideoUrls(u => u.filter((_, j) => j !== i))
    setVideoRefVideoDuration(d => Math.max(0, d - duration))
  }, [])

  const handleAddRefAudio = useCallback(async (file: File) => {
    setVideoRefAudioFilenames(f => [...f, file.name])
    setVideoRefAudioUrls(u => [...u, null])
    const idx = videoRefAudioFilenames.length
    const url = await uploadVideoFrame(file)
    setVideoRefAudioUrls(u => u.map((v, i) => i === idx ? url : v))
  }, [uploadVideoFrame, videoRefAudioFilenames.length])

  const handleRemoveRefAudio = useCallback((i: number) => {
    setVideoRefAudioFilenames(f => f.filter((_, j) => j !== i))
    setVideoRefAudioUrls(u => u.filter((_, j) => j !== i))
  }, [])

  const handleLipsyncVideoSelect = useCallback(async (file: File, duration: number, aspectRatio?: string) => {
    setVideoLipsyncVideoFilename(file.name)
    setVideoLipsyncVideoUrl(null)
    setVideoLipsyncVideoDuration(duration)
    setVideoLipsyncAspectRatio(aspectRatio)
    const url = await uploadVideoFrame(file)
    if (!url) {
      setVideoLipsyncVideoFilename(null)
      setVideoLipsyncVideoDuration(0)
    }
    setVideoLipsyncVideoUrl(url)
  }, [uploadVideoFrame])

  const handleLipsyncAudioSelect = useCallback(async (file: File) => {
    setVideoLipsyncAudioFilename(file.name)
    setVideoLipsyncAudioUrl(null)
    const url = await uploadVideoFrame(file)
    setVideoLipsyncAudioUrl(url)
  }, [uploadVideoFrame])

  const startVideoPolling = useCallback((slot: VideoPendingSlot) => {
    // Skip slots that haven't been promoted from queue yet (no FAL requestId)
    if (!slot.requestId) return
    if (videoPollingIntervals.current[slot.slotId]) return

    // If the slot is already past its poll timeout (e.g. page was refreshed after it
    // expired), fail it immediately so a failed tile appears instead of silent disappearance.
    const POLL_TIMEOUT_MS = 80 * 15 * 1000 // 80 polls × 15s = 20 min (SeeDance 2.0 can be slow)
    if (slot.startedAt && Date.now() - slot.startedAt > POLL_TIMEOUT_MS) {
      setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
      const timedOutItem: VideoItem = {
        id: slot.requestId,
        videoUrl: "",
        prompt: slot.prompt,
        model: slot.model,
        duration: slot.duration,
        failed: true,
        failError: "Generation timed out",
        createdAt: new Date().toISOString(),
      }
      // Dedup guard — prevents duplicate tiles if this path is triggered more than once
      setVideoItems(prev => prev.some(i => i.id === timedOutItem.id) ? prev : [timedOutItem, ...prev])
      setSavedVideoFails(prev => prev.some(f => f.id === timedOutItem.id) ? prev : [timedOutItem, ...prev])
      if (slot.ticketCost > 0) {
        setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + slot.ticketCost } : prev)
        fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: slot.ticketCost }) }).catch(() => {})
      }
      return
    }

    let pollCount = 0
    let pollInFlight = false
    const interval = setInterval(async () => {
      // Guard: skip this tick if the previous fetch is still in-flight.
      // Without this, a device waking from sleep can queue multiple ticks simultaneously,
      // causing concurrent video-status calls that each save a duplicate DB row.
      if (pollInFlight) return
      pollInFlight = true
      pollCount++
      // Auto-fail after 80 polls (80 × 15s = 20 min)
      if (pollCount > 80) {
        clearInterval(interval)
        delete videoPollingIntervals.current[slot.slotId]
        setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
        const timedOutItem: VideoItem = {
          id: slot.requestId,
          videoUrl: "",
          prompt: slot.prompt,
          model: slot.model,
          duration: slot.duration,
          failed: true,
          failError: "Generation timed out",
          createdAt: new Date().toISOString(),
        }
        // Dedup guard — prevents duplicate tiles if two ticks slipped the pollInFlight guard
        setVideoItems(prev => prev.some(i => i.id === timedOutItem.id) ? prev : [timedOutItem, ...prev])
        setSavedVideoFails(prev => prev.some(f => f.id === timedOutItem.id) ? prev : [timedOutItem, ...prev])
        if (slot.ticketCost > 0) {
          setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + slot.ticketCost } : prev)
          fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: slot.ticketCost }) }).catch(() => {})
        }
        pollInFlight = false
        return
      }
      try {
        const res = await fetch("/api/admin/video-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId:            slot.requestId,
            falEndpoint:          slot.falEndpoint,
            prompt:               slot.prompt,
            model:                slot.model,
            duration:             slot.duration,
            resolution:           slot.resolution,
            ticketCost:           slot.ticketCost,
            aspectRatio:          slot.aspectRatio,
            audioEnabled:         slot.audioEnabled,
            startFrameUrl:        slot.startFrameUrl,
            endFrameUrl:          slot.endFrameUrl,
            motionVideoUrl:       slot.motionVideoUrl,
            keepOriginalSound:    slot.keepOriginalSound,
            characterOrientation: slot.characterOrientation,
          }),
        })
        const data = await res.json()
        if (data.status === "completed") {
          clearInterval(interval)
          delete videoPollingIntervals.current[slot.slotId]
          // Clear from sessionStorage immediately — don't wait for the React effect.
          // If the user refreshes before the effect fires, the slot would be restored
          // from sessionStorage and trigger a second poll that duplicates the DB row.
          try {
            const stored = sessionStorage.getItem("pv2-video-pending-slots")
            if (stored) {
              const slots = JSON.parse(stored)
              sessionStorage.setItem("pv2-video-pending-slots", JSON.stringify(slots.filter((s: any) => s.slotId !== slot.slotId)))
            }
          } catch {}
          setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
          // Dedup by requestId — prevents a double-add if two ticks slipped through
          setVideoItems(prev => prev.some(i => i.id === slot.requestId) ? prev : [{
            id:                   slot.requestId,
            dbId:                 data.videoId ?? undefined,
            videoUrl:             data.videoUrl,
            prompt:               slot.prompt,
            model:                slot.model,
            duration:             slot.duration,
            resolution:           slot.resolution,
            aspectRatio:          slot.aspectRatio,
            audioEnabled:         slot.audioEnabled,
            startFrameUrl:        slot.startFrameUrl,
            endFrameUrl:          slot.endFrameUrl,
            motionVideoUrl:       slot.motionVideoUrl,
            keepOriginalSound:    slot.keepOriginalSound,
            characterOrientation: slot.characterOrientation,
            createdAt:            new Date().toISOString(),
          }, ...prev])
        } else if (data.status === "failed") {
          clearInterval(interval)
          delete videoPollingIntervals.current[slot.slotId]
          setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
          const failedItem: VideoItem = {
            id: slot.requestId,
            videoUrl: "",
            prompt: slot.prompt,
            model: slot.model,
            duration: slot.duration,
            failed: true,
            failError: data.error || "Generation failed",
            createdAt: new Date().toISOString(),
          }
          setVideoItems(prev => [failedItem, ...prev])
          setSavedVideoFails(prev => prev.some(f => f.id === failedItem.id) ? prev : [failedItem, ...prev])
          if (slot.ticketCost > 0) {
            setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + slot.ticketCost } : prev)
            fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: slot.ticketCost }) }).catch(() => {})
          }
        }
      } catch { /* keep polling on transient error */ } finally { pollInFlight = false }
    }, 15000)
    videoPollingIntervals.current[slot.slotId] = interval
  }, [])

  const handleVideoGenerate = useCallback(async (promptText: string) => {
    const isMotion = selectedVideoModel.id === "kling-v3-motion"
    const isLipsync = !!selectedVideoModel.supportsLipsync
    const isSD20 = !!selectedVideoModel.supportsSD20Modes
    const sd20NeedsImage = isSD20 && videoSD20Mode === "i2v"
    const isTextToVideo = !!selectedVideoModel.textToVideo && !sd20NeedsImage
    if (!videoStartFrameUrl && !isTextToVideo && !isLipsync) return
    if (isMotion && !videoMotionVideoUrl) return
    if (isLipsync && (!videoLipsyncVideoUrl || !videoLipsyncAudioUrl)) return
    if (!isMotion && !isLipsync && !promptText.trim()) return
    if (isMotion && videoCharacterOrientation === "image" && videoMotionVideoDuration !== null && videoMotionVideoDuration > 10) {
      alert(`Reference video is ${Math.round(videoMotionVideoDuration)}s. For "Image" character orientation, FAL requires the video to be 10 seconds or shorter. Please upload a shorter clip or switch orientation to "Video".`)
      return
    }
    setVideoGenerating(true)
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:               promptText,
          imageUrl:             videoStartFrameUrl,
          endImageUrl:          videoEndFrameUrl || undefined,
          duration:             videoDuration,
          resolution:           videoResolution,
          klingAspectRatio:     videoAspectRatio,
          model:                selectedVideoModel.id,
          sd20Mode:             isSD20 ? videoSD20Mode : undefined,
          generateAudio:        videoAudioEnabled,
          audioUrl:             videoAudioUrl || undefined,
          adminMode:            userRef.current !== null && ADMIN_EMAILS.includes(userRef.current.email),
          userId:               (userRef.current !== null && !ADMIN_EMAILS.includes(userRef.current.email)) ? userRef.current.id : undefined,
          // Motion Control
          motionVideoUrl:          videoMotionVideoUrl || undefined,
          motionVideoDurationSec:  videoMotionVideoDuration ?? undefined,
          characterOrientation:    videoCharacterOrientation,
          keepOriginalSound:       videoKeepOriginalSound,
          // SeeDance 2.0 reference-to-video
          ...(isSD20 && videoSD20Mode === "r2v" && {
            referenceImageUrls:    videoRefImageUrls.filter(Boolean) as string[],
            referenceVideoUrls:    videoRefVideoUrls.filter(Boolean) as string[],
            referenceAudioUrls:    videoRefAudioUrls.filter(Boolean) as string[],
            referenceVideoDurationSec: videoRefVideoDuration,
          }),
          // Lipsync v3
          ...(isLipsync && {
            lipsyncVideoUrl:        videoLipsyncVideoUrl,
            lipsyncAudioUrl:        videoLipsyncAudioUrl,
            lipsyncSyncMode:        videoLipsyncSyncMode,
            lipsyncVideoDurationSec: videoLipsyncVideoDuration,
          }),
          ...(selectedVideoModel.id === "wan-2.5" ? { wan25SafetyChecker: wan25VideoSafetyChecker } : {}),
          ...(selectedVideoModel.id === "seedance-1.5" ? { seedance15SafetyChecker: seedance15VideoSafetyChecker } : {}),
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Generation failed")
      const slotBase = {
        slotId:               `video-${Date.now()}`,
        prompt:               promptText,
        model:                selectedVideoModel.id,
        duration:             data.duration || videoDuration,
        resolution:           videoResolution,
        ticketCost:           data.ticketCost,
        startedAt:            Date.now(),
        aspectRatio:          isLipsync ? videoLipsyncAspectRatio : (videoAspectRatio || undefined),
        audioEnabled:         videoAudioEnabled,
        startFrameUrl:        videoStartFrameUrl || undefined,
        endFrameUrl:          videoEndFrameUrl || undefined,
        motionVideoUrl:       videoMotionVideoUrl || undefined,
        keepOriginalSound:    videoKeepOriginalSound,
        characterOrientation: videoCharacterOrientation,
      }
      // Update UI balance immediately.
      // For admin users the generate route skips deduction, so we also persist via use-tickets.
      // For regular users the generate route already deducted server-side — UI update only.
      if (data.ticketCost > 0) {
        setUser(prev => prev ? { ...prev, ticketBalance: Math.max(0, prev.ticketBalance - data.ticketCost) } : prev)
        const currentUser = userRef.current
        const isAdminUser = currentUser !== null && ADMIN_EMAILS.includes(currentUser.email)
        if (isAdminUser) {
          fetch("/api/admin/use-tickets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deduct", amount: data.ticketCost }),
          }).catch(() => {})
        }
      }
      if (data.queued) {
        // At capacity — job is queued; slot has no FAL requestId yet
        const slot: VideoPendingSlot = {
          ...slotBase,
          requestId:   '',
          falEndpoint: data.falEndpoint || '',
          queueJobId:  data.queueId,
        }
        setVideoPendingSlots(prev => [slot, ...prev])
      } else {
        const slot: VideoPendingSlot = {
          ...slotBase,
          requestId:   data.requestId,
          falEndpoint: data.falEndpoint,
        }
        setVideoPendingSlots(prev => [slot, ...prev])
      }
    } catch (err: any) {
      console.error("Video generate error:", err)
      alert(err.message || "Video generation failed")
    } finally {
      setVideoGenerating(false)
    }
  }, [videoStartFrameUrl, videoEndFrameUrl, videoDuration, videoResolution, videoAspectRatio, videoAudioEnabled, videoAudioUrl, selectedVideoModel, videoMotionVideoUrl, videoCharacterOrientation, videoKeepOriginalSound, videoMotionVideoDuration, videoSD20Mode, videoRefImageUrls, videoRefVideoUrls, videoRefAudioUrls, videoRefVideoDuration, videoLipsyncVideoUrl, videoLipsyncAudioUrl, videoLipsyncSyncMode, videoLipsyncVideoDuration, wan25VideoSafetyChecker, seedance15VideoSafetyChecker])

  const applyVideoModel = useCallback((model: VideoModelConfig) => {
    setSelectedVideoModel(model)
    setScannerMode("video")
    setVideoDuration(model.durations[0] ?? "5")
    setVideoAspectRatio(model.aspectRatios?.[0] ?? "16:9")
    setVideoResolution(model.resolutions?.[1] ?? "1080p")
    setVideoAudioEnabled(false)
    setVideoAudioFile(null)
    setVideoAudioUrl(null)
    setVideoStartFramePreview(null)
    setVideoStartFrameUrl(null)
    setVideoEndFramePreview(null)
    setVideoEndFrameUrl(null)
    setVideoMotionVideoPreview(null)
    setVideoMotionVideoUrl(null)
    setVideoCharacterOrientation("image")
    setVideoKeepOriginalSound(true)
    setVideoSD20Mode("t2v")
    setVideoRefImagePreviews([])
    setVideoRefImageUrls([])
    setVideoRefVideoFilenames([])
    setVideoRefVideoUrls([])
    setVideoRefAudioFilenames([])
    setVideoRefAudioUrls([])
    setVideoRefVideoDuration(0)
    setVideoLipsyncVideoFilename(null)
    setVideoLipsyncVideoUrl(null)
    setVideoLipsyncVideoDuration(0)
    setVideoLipsyncAudioFilename(null)
    setVideoLipsyncAudioUrl(null)
    setVideoLipsyncSyncMode("cut_off")
  }, [])

  const handleSelectVideoModel = useCallback((name: string) => {
    const model = VIDEO_MODEL_CONFIGS.find(m => m.name === name)
    if (!model) return
    applyVideoModel(model)
  }, [applyVideoModel])

  // Always-current reference to user so startPolling can read userId without stale closure
  const userRef = useRef<UserData | null>(null)
  useEffect(() => { userRef.current = user }, [user])

  // Polling is keyed by queueId so the same DB job can never be double-polled
  const pollingIntervals = useRef<Record<number, ReturnType<typeof setInterval>>>({})
  const completedQueueIds = useRef<Set<number>>(new Set())
  useEffect(() => () => { Object.values(pollingIntervals.current).forEach(clearInterval) }, [])
  // NB2 polling keyed by requestId (not DB-backed) — same pattern as videoPollingIntervals
  const nb2PollingIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  useEffect(() => () => {
    Object.entries(nb2PollingIntervals.current).forEach(([id, interval]) => {
      clearInterval(interval)
      delete nb2PollingIntervals.current[id]
    })
  }, [])

  const startNb2SlotPolling = useCallback((
    requestId: string,
    falEndpoint: string,
    slotIds: string[],
    prompt: string,
    outputFormat: string,
    aspectRatio: string,
    statusUrl: string = "/api/admin/nb2-status",
    quality?: string,
    ticketCost: number = 0,
    referenceImageUrls: string[] = [],
    videoMetadata?: Record<string, unknown>,
  ) => {
    if (nb2PollingIntervals.current[requestId]) return
    let pollCount = 0
    let pollInFlight = false
    let notFoundStreak = 0  // consecutive RunPod-404 responses (job purged or not yet registered)
    const interval = setInterval(async () => {
      if (pollInFlight) return
      pollInFlight = true
      pollCount++
      if (pollCount > 360) {
        clearInterval(interval)
        delete nb2PollingIntervals.current[requestId]
        if (ticketCost > 0) {
          setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + ticketCost } : prev)
          fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: ticketCost }) }).catch(() => {})
        }
        slotIds.forEach(sid => handleUpdatePending(sid, { status: "failed", error: "Generation timed out" }))
        // Clear from sessionStorage so they don't come back on refresh
        try {
          const stored = localStorage.getItem("pv2-pending-slots")
          if (stored) {
            const slots = JSON.parse(stored) as PendingSlot[]
            localStorage.setItem("pv2-pending-slots", JSON.stringify(slots.filter(s => !slotIds.includes(s.slotId))))
          }
        } catch {}
        pollInFlight = false
        return
      }
      try {
        const statusRes = await fetch(statusUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, falEndpoint, prompt, outputFormat, aspectRatio, quality, referenceImageUrls, ticketCost }),
          signal: AbortSignal.timeout(15000),
        })
        const statusData = await statusRes.json()
        // Track RunPod 404s — after enough consecutive misses past the initial window, the job is purged
        if (statusData.notFound) {
          notFoundStreak++
          if (notFoundStreak >= 8 && pollCount > 24) {
            clearInterval(interval)
            delete nb2PollingIntervals.current[requestId]
            try {
              const stored = localStorage.getItem("pv2-pending-slots")
              if (stored) {
                const slots = JSON.parse(stored) as PendingSlot[]
                localStorage.setItem("pv2-pending-slots", JSON.stringify(slots.filter(s => !slotIds.includes(s.slotId))))
              }
            } catch {}
            slotIds.forEach(sid => handleUpdatePending(sid, { status: "failed", error: "RunPod job result expired — generation may have completed. Check the image in your R2 storage." }))
            pollInFlight = false
            return
          }
        } else {
          notFoundStreak = 0
        }
        if (statusData.status === "completed") {
          clearInterval(interval)
          delete nb2PollingIntervals.current[requestId]
          // Mark as processed so future page loads don't re-poll and duplicate DB records
          try {
            const done = JSON.parse(localStorage.getItem("pv2-nb2-done") || "[]") as string[]
            if (!done.includes(requestId)) {
              localStorage.setItem("pv2-nb2-done", JSON.stringify([...done.slice(-20), requestId]))
            }
          } catch {}
          // Remove slots from sessionStorage immediately before any async/unmount risk
          try {
            const stored = localStorage.getItem("pv2-pending-slots")
            if (stored) {
              const slots = JSON.parse(stored) as PendingSlot[]
              localStorage.setItem("pv2-pending-slots", JSON.stringify(slots.filter(s => !slotIds.includes(s.slotId))))
            }
          } catch {}
          // Use dbId returned by the status route directly — avoids race condition
          // where two concurrent pollers re-fetch /api/my-images and get the same record
          const completedImgs: { url: string; dbId?: number | null; r2Key?: string }[] = statusData.images || []
          const isFluxRunpod = statusUrl.includes("flux-inference")
          const modelId = isFluxRunpod ? "custom-flux-lora"
            : statusUrl.includes("kling-o3") ? "kling-o3-image"
            : statusUrl.includes("kling-image") ? "kling-v3-image"
            : statusUrl.includes("wan-27-pro") ? "wan-2.7-pro"
            : statusUrl.includes("gpt-image-2") ? "gpt-image-2"
            : "nano-banana-pro-2"
          const createdAt = new Date().toISOString()
          completedImgs.forEach((img, i) => {
            const tempId = img.dbId ?? (Date.now() + i)
            handlePrependImage({
              id: tempId,
              imageUrl: img.url,
              r2Key: img.r2Key,
              prompt,
              model: modelId,
              createdAt,
              aspectRatio,
              quality,
              referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
              videoMetadata: videoMetadata as Record<string, any> | undefined,
            })
            // Save custom-flux-lora images to DB for cross-device persistence
            if (isFluxRunpod && img.r2Key) {
              const pass = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('admin-password') ?? '') : ''
              fetch('/api/admin/flux-inference/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) },
                body: JSON.stringify({ r2Key: img.r2Key, prompt, videoMetadata }),
              }).then(r => r.json()).then((data: { id?: number }) => {
                if (data.id) {
                  setFreshImages(prev => prev.map(fi => fi.id === tempId ? { ...fi, id: data.id! } : fi))
                }
              }).catch(() => {})
            }
          })
          slotIds.forEach(sid => handleRemovePending(sid))
        } else if (statusData.status === "failed") {
          clearInterval(interval)
          delete nb2PollingIntervals.current[requestId]
          if (ticketCost > 0) {
            setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + ticketCost } : prev)
            fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: ticketCost }) }).catch(() => {})
          }
          try {
            const stored = localStorage.getItem("pv2-pending-slots")
            if (stored) {
              const slots = JSON.parse(stored) as PendingSlot[]
              localStorage.setItem("pv2-pending-slots", JSON.stringify(slots.filter(s => !slotIds.includes(s.slotId))))
            }
          } catch {}
          slotIds.forEach(sid => handleUpdatePending(sid, { status: "failed", error: statusData.error || "Generation failed" }))
        }
      } catch { /* keep polling on transient error */ } finally { pollInFlight = false }
    }, 5000)
    nb2PollingIntervals.current[requestId] = interval
  }, [handleUpdatePending, handlePrependImage, handleRemovePending, setUser, setFreshImages])

  const cancelNb2SlotPolling = useCallback((requestId: string) => {
    const interval = nb2PollingIntervals.current[requestId]
    if (interval) {
      clearInterval(interval)
      delete nb2PollingIntervals.current[requestId]
    }
  }, [])

  useEffect(() => () => {
    Object.entries(videoPollingIntervals.current).forEach(([id, interval]) => {
      clearInterval(interval)
      delete videoPollingIntervals.current[id]
    })
  }, [])

  // --- QUEUE JOB POLLING (capacity-queued image slots) ---
  // When global FAL limit is reached, submit routes return { queued: true, queueId }.
  // The outer component watches for PendingSlots with queueJobId but no nb2RequestId
  // and polls /api/admin/queue-job-status until the job is promoted and gets a falRequestId.
  const queuePollingIntervals = useRef<Record<number, ReturnType<typeof setInterval>>>({})
  const startedQueuePolls = useRef<Set<number>>(new Set())
  useEffect(() => () => {
    Object.values(queuePollingIntervals.current).forEach(clearInterval)
  }, [])

  const startQueuePollingForSlot = useCallback((slot: PendingSlot) => {
    const queueJobId = slot.queueJobId!
    if (queuePollingIntervals.current[queueJobId]) return
    let pollCount = 0
    const interval = setInterval(async () => {
      pollCount++
      // Timeout after 120 polls × 5s = 10 minutes (catches jobs stuck with no falRequestId)
      if (pollCount > 120) {
        clearInterval(interval)
        delete queuePollingIntervals.current[queueJobId]
        handleUpdatePending(slot.slotId, { status: 'failed', error: 'Queued job timed out waiting for promotion' })
        return
      }
      try {
        const res = await fetch(`/api/admin/queue-job-status?id=${queueJobId}`)
        const data = await res.json()
        if (data.status === 'processing' && data.falRequestId && data.falEndpoint) {
          clearInterval(interval)
          delete queuePollingIntervals.current[queueJobId]
          // Promote: update slot with FAL request info so future restores work
          handleUpdatePending(slot.slotId, {
            nb2RequestId:  data.falRequestId,
            nb2FalEndpoint: data.falEndpoint,
          })
          startNb2SlotPolling(
            data.falRequestId,
            data.falEndpoint,
            [slot.slotId],
            slot.prompt,
            slot.nb2OutputFormat || 'png',
            slot.nb2AspectRatio || slot.aspectRatio || 'auto',
            slot.nb2StatusUrl,
            slot.nb2Quality || slot.quality,
            slot.nb2TicketCost || 0,
            slot.referenceImageUrls || [],
          )
        } else if (data.status === 'failed') {
          clearInterval(interval)
          delete queuePollingIntervals.current[queueJobId]
          handleUpdatePending(slot.slotId, { status: 'failed', error: data.errorMessage || 'Queued job failed' })
        }
      } catch { /* keep polling on transient error */ }
    }, 5000)
    queuePollingIntervals.current[queueJobId] = interval
  }, [startNb2SlotPolling, handleUpdatePending])

  // Watch for new image slots with queueJobId but no nb2RequestId
  useEffect(() => {
    pendingSlots.forEach(slot => {
      if (slot.status !== 'loading' || !slot.queueJobId || slot.nb2RequestId) return
      if (startedQueuePolls.current.has(slot.queueJobId)) return
      startedQueuePolls.current.add(slot.queueJobId)
      startQueuePollingForSlot(slot)
    })
  }, [pendingSlots, startQueuePollingForSlot])

  // --- QUEUE JOB POLLING (capacity-queued video slots) ---
  const videoQueuePollingIntervals = useRef<Record<number, ReturnType<typeof setInterval>>>({})
  const startedVideoQueuePolls = useRef<Set<number>>(new Set())
  useEffect(() => () => {
    Object.values(videoQueuePollingIntervals.current).forEach(clearInterval)
  }, [])

  const startQueuePollingForVideoSlot = useCallback((slot: VideoPendingSlot) => {
    const queueJobId = slot.queueJobId!
    if (videoQueuePollingIntervals.current[queueJobId]) return
    let pollCount = 0
    const interval = setInterval(async () => {
      pollCount++
      // Timeout after 120 polls × 5s = 10 minutes (catches jobs stuck with no falRequestId)
      if (pollCount > 120) {
        clearInterval(interval)
        delete videoQueuePollingIntervals.current[queueJobId]
        setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
        if (slot.ticketCost > 0) {
          setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + slot.ticketCost } : prev)
          fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: slot.ticketCost }) }).catch(() => {})
        }
        const timedOutItem: VideoItem = {
          id: slot.slotId,
          videoUrl: '',
          prompt: slot.prompt,
          model: slot.model,
          duration: slot.duration,
          failed: true,
          failError: 'Queued job timed out waiting for promotion',
          createdAt: new Date().toISOString(),
        }
        setVideoItems(prev => [timedOutItem, ...prev])
        setSavedVideoFails(prev => prev.some(f => f.id === timedOutItem.id) ? prev : [timedOutItem, ...prev])
        return
      }
      try {
        const res = await fetch(`/api/admin/queue-job-status?id=${queueJobId}`)
        const data = await res.json()
        if (data.status === 'processing' && data.falRequestId && data.falEndpoint) {
          clearInterval(interval)
          delete videoQueuePollingIntervals.current[queueJobId]
          // Update slot with real requestId/falEndpoint so startVideoPolling can work
          const promotedSlot: VideoPendingSlot = {
            ...slot,
            requestId: data.falRequestId,
            falEndpoint: data.falEndpoint,
            startedAt: Date.now(),
          }
          setVideoPendingSlots(prev => prev.map(s => s.slotId === slot.slotId ? promotedSlot : s))
          startVideoPolling(promotedSlot)
        } else if (data.status === 'failed') {
          clearInterval(interval)
          delete videoQueuePollingIntervals.current[queueJobId]
          setVideoPendingSlots(prev => prev.filter(s => s.slotId !== slot.slotId))
          if (slot.ticketCost > 0) {
            setUser(prev => prev ? { ...prev, ticketBalance: prev.ticketBalance + slot.ticketCost } : prev)
            fetch("/api/admin/use-tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refund", amount: slot.ticketCost }) }).catch(() => {})
          }
          const failedItem: VideoItem = {
            id: slot.slotId,
            videoUrl: '',
            prompt: slot.prompt,
            model: slot.model,
            duration: slot.duration,
            failed: true,
            failError: data.errorMessage || 'Queued job failed',
            createdAt: new Date().toISOString(),
          }
          setVideoItems(prev => [failedItem, ...prev])
          setSavedVideoFails(prev => prev.some(f => f.id === failedItem.id) ? prev : [failedItem, ...prev])
        }
      } catch { /* keep polling on transient error */ }
    }, 5000)
    videoQueuePollingIntervals.current[queueJobId] = interval
  }, [startVideoPolling, setVideoPendingSlots, setVideoItems, setSavedVideoFails, setUser])

  // Watch for new video slots with queueJobId but no requestId
  useEffect(() => {
    videoPendingSlots.forEach(slot => {
      if (!slot.queueJobId || slot.requestId) return
      if (startedVideoQueuePolls.current.has(slot.queueJobId)) return
      startedVideoQueuePolls.current.add(slot.queueJobId)
      startQueuePollingForVideoSlot(slot)
    })
  }, [videoPendingSlots, startQueuePollingForVideoSlot])

  const startPolling = useCallback((slotId: string, queueId: number, prompt: string) => {
    if (pollingIntervals.current[queueId]) return // already watching this job
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/prompting-studio/jobs?source=main-scanner")
        const data = await res.json()
        const job = data.jobs?.find((j: any) => j.id === queueId)
        if (!job) return
        if (job.status === "completed") {
          clearInterval(interval)
          delete pollingIntervals.current[queueId]
          if (completedQueueIds.current.has(queueId)) return
          completedQueueIds.current.add(queueId)
          const imgRes = await fetch("/api/my-images?page=1&limit=1&type=image")
          const imgData = await imgRes.json()
          if (imgData.success && imgData.images?.[0]) handlePrependImage(imgData.images[0])
          handleRemovePending(slotId)
          const uid = userRef.current?.id
          if (uid) {
            const ticketRes = await fetch(`/api/user/tickets?userId=${uid}`)
            const ticketData = await ticketRes.json()
            if (ticketData.success) handleBalanceChange(ticketData.balance)
          }
        } else if (job.status === "failed") {
          clearInterval(interval)
          delete pollingIntervals.current[queueId]
          handleUpdatePending(slotId, { status: "failed", error: job.errorMessage || "Generation failed" })
          const uid = userRef.current?.id
          if (uid) {
            const ticketRes = await fetch(`/api/user/tickets?userId=${uid}`)
            const ticketData = await ticketRes.json()
            if (ticketData.success) handleBalanceChange(ticketData.balance)
          }
        }
      } catch { /* ignore transient polling errors */ }
    }, 3000)
    pollingIntervals.current[queueId] = interval
  }, [handlePrependImage, handleRemovePending, handleUpdatePending, handleBalanceChange])

  // Start/resume polling whenever pending slots change (handles new generations + page refresh restore).
  // Skip queued slots (no requestId yet) — startQueuePollingForVideoSlot handles those.
  useEffect(() => {
    videoPendingSlots.forEach(slot => { if (slot.requestId) startVideoPolling(slot) })
  }, [videoPendingSlots, startVideoPolling])

  // Queue limits — owner accounts: unlimited, dev tier: 6 image / 2 video, free: 2 image / 1 video
  const isOwner = user?.email === "dirtysecretai@gmail.com" || user?.email === "promptandprotocol@gmail.com"
  const hasEffectiveDevAccess = hasPromptStudioDev || isAdminAccount || isAuditAccount
  const refLibraryLimit = isAdminAccount ? 250 : hasEffectiveDevAccess ? 100 : 50
  const maxConcurrent = isOwner ? Infinity : hasEffectiveDevAccess ? 6 : 2
  const videoMaxConcurrent = isOwner ? Infinity : hasEffectiveDevAccess ? 2 : 1
  const videoActiveJobCount = videoPendingSlots.length

  // Server-authoritative active count — polled every 10s so the counter stays
  // accurate across devices/tabs. Takes the max of server and local counts so:
  // - a just-started local job locks the button before the server confirms
  // - a generation on another device/tab also locks the button
  const [serverActiveCount, setServerActiveCount] = useState<number | null>(null)
  const localActiveCount = user ? pendingSlots.filter((s) => s.status === "loading").length : 0
  const activeJobCount = serverActiveCount !== null ? Math.max(serverActiveCount, localActiveCount) : localActiveCount

  // Use a ref so the poll closure always sees the latest pendingSlots without re-registering the interval
  const pendingSlotsRef = useRef(pendingSlots)
  useEffect(() => { pendingSlotsRef.current = pendingSlots }, [pendingSlots])

  // When the tab becomes visible again (e.g. returning from a locked screen), immediately do a
  // one-shot status check for any Flux RunPod slots that are still loading so they aren't stuck.
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      const fluxSlots = pendingSlotsRef.current.filter(
        s => s.status === 'loading' && s.modelId === 'custom-flux-lora' && s.nb2RequestId
      )
      for (const slot of fluxSlots) {
        try {
          const res = await fetch('/api/admin/flux-inference/nb2-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: slot.nb2RequestId }),
            signal: AbortSignal.timeout(10000),
          })
          const data = await res.json()
          if (data.status === 'completed' && data.images?.length > 0) {
            // Let the existing polling interval handle the completion on its next tick —
            // just reset the interval so it fires immediately by clearing + restarting it.
            const old = nb2PollingIntervals.current[slot.nb2RequestId!]
            if (old) { clearInterval(old); delete nb2PollingIntervals.current[slot.nb2RequestId!] }
            startNb2SlotPolling(
              slot.nb2RequestId!, slot.nb2FalEndpoint ?? '', [slot.slotId],
              slot.prompt, slot.nb2OutputFormat ?? 'png', slot.nb2AspectRatio ?? 'auto',
              '/api/admin/flux-inference/nb2-status', slot.nb2Quality, slot.nb2TicketCost ?? 0,
              slot.referenceImageUrls ?? []
            )
          }
        } catch { /* non-fatal */ }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [startNb2SlotPolling])

  const MODEL_STATUS_URLS: Record<string, string> = {
    "nano-banana-pro-2": "/api/admin/nb2-status",
    "kling-v3-image":    "/api/admin/kling-image-status",
    "kling-o3-image":    "/api/admin/kling-o3-status",
    "wan-2.7-pro":       "/api/admin/wan-27-pro-status",
    "gpt-image-2":       "/api/admin/gpt-image-2-status",
  }

  useEffect(() => {
    if (!user) return
    const poll = async () => {
      try {
        // Update active count + ticket balance in parallel
        const [countRes, ticketRes] = await Promise.all([
          fetch("/api/admin/my-active-count"),
          fetch(`/api/user/tickets?userId=${user.id}`, { cache: "no-store" }),
        ])
        if (countRes.ok) {
          const d = await countRes.json()
          if (typeof d.activeCount === "number") setServerActiveCount(d.activeCount)
        }
        if (ticketRes.ok) {
          const t = await ticketRes.json()
          if (t.success && typeof t.balance === "number") {
            setUser(u => u ? { ...u, ticketBalance: t.balance } : u)
          }
        }
      } catch {}

      // Pick up new cross-device tiles (jobs started on another device/tab)
      try {
        const jobsRes = await fetch("/api/prompting-studio/jobs?source=main-scanner")
        if (!jobsRes.ok) return
        const { jobs } = await jobsRes.json()
        const inFlight: any[] = (jobs || []).filter((j: any) => j.status === "processing" || j.status === "queued")
        const nb2DbJobs = inFlight.filter((j: any) => j.falRequestId)
        if (nb2DbJobs.length === 0) return

        const currentSlots = pendingSlotsRef.current
        const trackedRequestIds = new Set(currentSlots.map((s) => s.nb2RequestId).filter(Boolean) as string[])
        // queueJobId = capacity-overflow DB queue ID; queueId = regular FAL async DB queue ID (SeeDream, FLUX 2 multi)
        // Both map to the same GenerationQueue.id that j.id comes from, so check both fields.
        const trackedDbJobIds = new Set(
          currentSlots.flatMap((s) => [s.queueJobId, s.queueId].filter((v): v is number => v != null))
        )
        const doneNb2Ids = new Set(JSON.parse(localStorage.getItem("pv2-nb2-done") || "[]") as string[])

        for (const j of nb2DbJobs) {
          // Skip if already tracked by requestId, by any DB queue job ID, or already completed
          if (trackedRequestIds.has(j.falRequestId) || trackedDbJobIds.has(j.id) || doneNb2Ids.has(j.falRequestId)) continue
          const params = j.parameters as any
          const newSlot: PendingSlot = {
            slotId:         `db-${j.id}-${j.falRequestId.slice(-6)}`,
            status:         "loading",
            prompt:         j.prompt,
            nb2RequestId:   j.falRequestId,
            nb2FalEndpoint: params?.falEndpoint || params?.falInput?.endpoint,
            nb2StatusUrl:   MODEL_STATUS_URLS[j.modelId] || "/api/admin/nb2-status",
            nb2AspectRatio: params?.size || params?.aspectRatio || params?.nb2AspectRatio,
            nb2Quality:     params?.quality || params?.nb2Quality,
            nb2TicketCost:  j.ticketCost ?? 0,
            referenceImageUrls: params?.permanentReferenceUrls || [],
          }
          handleAddPending(newSlot)
          startNb2SlotPolling(j.falRequestId, newSlot.nb2FalEndpoint!, [newSlot.slotId], j.prompt, "png", newSlot.nb2AspectRatio || "auto", newSlot.nb2StatusUrl, newSlot.nb2Quality, newSlot.nb2TicketCost ?? 0, newSlot.referenceImageUrls || [])
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 10000)
    return () => clearInterval(id)
  }, [user?.id])

  // Computed: active ref images limited to the current model's cap
  const activeRefImages = refLibrary
    .filter((img) => activeRefIds.includes(img.id))
    .slice(0, selectedModel.maxReferenceImages)

  const handleLibraryUpload = useCallback((items: RefImage[]) => {
    setRefLibrary((prev) => [...prev, ...items].slice(0, refLibraryLimit))
  }, [refLibraryLimit])

  // Upload from prompt box: add to library + auto-activate up to model limit
  const handleUploadRef = useCallback((items: RefImage[]) => {
    setRefLibrary((prev) => [...prev, ...items].slice(0, refLibraryLimit))
    setActiveRefIds((prev) => {
      const slots = Math.max(0, selectedModel.maxReferenceImages - prev.length)
      const toActivate = items.slice(0, slots).map((i) => i.id)
      return [...prev, ...toActivate]
    })
  }, [selectedModel.maxReferenceImages, refLibraryLimit])

  const handleLibraryDelete = useCallback((id: string) => {
    setRefLibrary((prev) => prev.filter((i) => i.id !== id))
    setActiveRefIds((prev) => prev.filter((rid) => rid !== id))
  }, [])

  const handleLibraryDeleteMultiple = useCallback((ids: string[]) => {
    const idSet = new Set(ids)
    setRefLibrary((prev) => prev.filter((i) => !idSet.has(i.id)))
    setActiveRefIds((prev) => prev.filter((rid) => !idSet.has(rid)))
  }, [])

  const handleLibraryClearAll = useCallback(() => {
    setRefLibrary([])
    setActiveRefIds([])
  }, [])

  const handleActivateRef   = useCallback((id: string) => setActiveRefIds((prev) => [...prev, id]), [])
  const handleDeactivateRef = useCallback((id: string) => setActiveRefIds((prev) => prev.filter((rid) => rid !== id)), [])
  const handleEditRef       = useCallback((id: string, newUrl: string) => {
    setRefLibrary(prev => prev.map(r => r.id === id ? { ...r, url: newUrl } : r))
  }, [])

  const handleLoadPreset = useCallback((urls: string[]) => {
    const newItems: RefImage[] = urls.map((url) => ({
      id: `preset-${Date.now()}-${Math.random()}`,
      url,
    }))
    setRefLibrary((prev) => [...prev, ...newItems].slice(0, refLibraryLimit))
    setActiveRefIds((prev) => {
      const slots = Math.max(0, selectedModel.maxReferenceImages - prev.length)
      const toActivate = newItems.slice(0, slots).map((i) => i.id)
      return [...prev, ...toActivate]
    })
  }, [selectedModel.maxReferenceImages, refLibraryLimit])

  // Storage keys
  const REF_STORAGE_KEY = "pv2-ref-library"
  const SETTINGS_STORAGE_KEY = "pv2-settings"

  // Single effect: first run = restore all session/local storage, subsequent runs = persist.
  // This prevents the "save empty defaults over stored values" race that occurs when
  // useState lazy-initialisers read storage on the client but return [] on the server,
  // causing a hydration mismatch. By initialising all six states as [] and loading here,
  // server and client always agree on the initial render.
  const storageInitialized = useRef(false)
  useEffect(() => {
    if (!storageInitialized.current) {
      storageInitialized.current = true
      // pendingSlots
      try {
        const stored = localStorage.getItem("pv2-pending-slots")
        if (stored) setPendingSlots(JSON.parse(stored) as PendingSlot[])
      } catch {}
      // savedFails
      try {
        const stored = sessionStorage.getItem("pv2-failed-images")
        if (stored) setSavedFails(JSON.parse(stored) as ImageItem[])
      } catch {}
      // videoPendingSlots (drop slots > 90 min old)
      try {
        const stored = localStorage.getItem("pv2-video-pending-slots")
        if (stored) {
          const slots = JSON.parse(stored) as VideoPendingSlot[]
          const cutoff = Date.now() - 90 * 60 * 1000
          setVideoPendingSlots(slots.filter(s => !s.startedAt || s.startedAt > cutoff))
        }
      } catch {}
      // savedVideoFails
      try {
        const stored = sessionStorage.getItem("pv2-video-failed-items")
        if (stored) setSavedVideoFails(JSON.parse(stored) as VideoItem[])
      } catch {}
      // ref library + active IDs
      try {
        const stored = localStorage.getItem(REF_STORAGE_KEY)
        if (stored) {
          const { library, activeIds } = JSON.parse(stored)
          if (Array.isArray(library)) setRefLibrary(library)
          if (Array.isArray(activeIds)) setActiveRefIds(activeIds)
        }
      } catch {}
      return // Don't save on the restore run
    }
    // Persist all storage-backed state
    try { localStorage.setItem("pv2-pending-slots", JSON.stringify(pendingSlots.filter(s => s.status !== "failed"))) } catch {}
    try { sessionStorage.setItem("pv2-failed-images", JSON.stringify(savedFails)) } catch {}
    try { localStorage.setItem("pv2-video-pending-slots", JSON.stringify(videoPendingSlots)) } catch {}
    try { sessionStorage.setItem("pv2-video-failed-items", JSON.stringify(savedVideoFails)) } catch {}
    try { localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ library: refLibrary, activeIds: activeRefIds })) } catch {}
  }, [pendingSlots, savedFails, videoPendingSlots, savedVideoFails, refLibrary, activeRefIds])

  // Single effect: first run = restore from localStorage, subsequent runs = save.
  // This prevents the "save default over stored value" race that separate restore/save effects cause.
  const settingsInitialized = useRef(false)
  useEffect(() => {
    if (!settingsInitialized.current) {
      settingsInitialized.current = true
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
        if (stored) {
          const { modelId, scannerMode: savedMode, videoModelId } = JSON.parse(stored)
          const found = IMAGE_MODEL_CONFIGS.find((m) => m.id === modelId)
          if (found) setSelectedModel(found)
          if (savedMode === "video") {
            setScannerMode("video")
            const vFound = VIDEO_MODEL_CONFIGS.find(m => m.id === videoModelId)
            if (vFound) setSelectedVideoModel(vFound)
          }
        }
      } catch {}
      return // Do not save on the restore run
    }
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        modelId: selectedModel.id,
        scannerMode,
        videoModelId: selectedVideoModel.id,
      }))
    } catch {}
  }, [selectedModel, scannerMode, selectedVideoModel])

  // Deactivate all ref images when switching to video mode — refs don't apply to video models
  useEffect(() => {
    if (scannerMode === "video") setActiveRefIds([])
  }, [scannerMode])

  // ?clearNB2=1 — clears stuck NB2 pending slots (useful when sessionStorage got stale on another device)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clearNB2") === "1") {
      localStorage.removeItem("pv2-pending-slots")
      localStorage.removeItem("pv2-nb2-done")
      // Remove the query param so it doesn't keep clearing on every navigation
      const url = new URL(window.location.href)
      url.searchParams.delete("clearNB2")
      window.history.replaceState({}, "", url.toString())
    }
  }, [])

  useEffect(() => {
    fetch("/api/admin/config").then(r => r.ok ? r.json() : null).then(data => {
      if (data) setIsGenerationMaintenance(!!data.aiGenerationMaintenance)
    }).catch(() => {})
  }, [])

  // Autofill watchdog — re-kick stuck caption jobs while user is on this page.
  // The cron already handles true background operation (every 60s), but this
  // provides faster <90s recovery when the user is actively generating images.
  useEffect(() => {
    const AUTOFILL_JOBS_KEY = 'dataset-autofill-jobs'
    const kick = async () => {
      try {
        const stored = JSON.parse(localStorage.getItem(AUTOFILL_JOBS_KEY) || '[]') as string[]
        if (!stored.length) return
        const adminPass = sessionStorage.getItem('admin-password')
        if (!adminPass) return
        const headers = { 'x-admin-password': adminPass }
        const now = Date.now()
        // Fetch status for each stored job and only kick those that are stuck
        // (running but not updated in 90s) to avoid racing an active processor.
        await Promise.all(stored.map(async (jobId) => {
          try {
            const res = await fetch(`/api/admin/auto-caption/jobs/${jobId}`, { headers })
            if (!res.ok) return
            const job = await res.json()
            if (job.status !== 'running') return
            const stale = !job.updatedAt || now - new Date(job.updatedAt).getTime() > 90_000
            if (!stale) return
            fetch(`/api/admin/auto-caption/jobs/${jobId}/continue`, { method: 'POST', headers }).catch(() => {})
          } catch {}
        }))
      } catch {}
    }
    kick() // Immediate check on mount — catches stalls that happened during navigation
    const interval = setInterval(kick, 45_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        const data = await res.json()
        if (data.authenticated) {
          const [ticketRes, subRes, jobsRes] = await Promise.all([
            fetch(`/api/user/tickets?userId=${data.user.id}`),
            fetch("/api/user/subscription"),
            fetch("/api/prompting-studio/jobs?source=main-scanner"),
          ])
          const ticketData = await ticketRes.json()
          const subData = await subRes.json()
          setUser({ id: data.user.id, email: data.user.email, ticketBalance: ticketData.success ? ticketData.balance : 0 })
          if (subData.hasPromptStudioDev) setHasPromptStudioDev(true)

          const verifyRes = await fetch("/api/admin/verify")
          const verifyData = await verifyRes.json()
          if (verifyData.isAdmin) setIsAdminAccount(true)
          if (verifyData.isAuditAccount) setIsAuditAccount(true)

          // Reconcile in-flight DB jobs with locally-persisted pending slots.
          // The DB is the authoritative source — this keeps the queue accurate
          // across page refreshes and across different devices.
          if (jobsRes.ok) {
            const jobsData = await jobsRes.json()
            const allDbJobs: any[] = jobsData.jobs || []
            const inFlight: any[] = allDbJobs.filter(
              (j: any) => j.status === "processing" || j.status === "queued"
            )
            const inFlightIds = new Set(inFlight.map((j: any) => j.id as number))

            const currentSlots: PendingSlot[] = (() => {
              try {
                const stored = localStorage.getItem("pv2-pending-slots")
                return stored ? JSON.parse(stored) as PendingSlot[] : []
              } catch { return [] }
            })()

            // Map from model ID → status URL for NB2-style polling
            const MODEL_STATUS_URLS: Record<string, string> = {
              "nano-banana-pro-2": "/api/admin/nb2-status",
              "kling-v3-image":    "/api/admin/kling-image-status",
              "kling-o3-image":    "/api/admin/kling-o3-status",
              "wan-2.7-pro":       "/api/admin/wan-27-pro-status",
              "gpt-image-2":       "/api/admin/gpt-image-2-status",
            }

            const doneNb2Ids = new Set(JSON.parse(localStorage.getItem("pv2-nb2-done") || "[]") as string[])

            // Split in-flight DB jobs: those with falRequestId use NB2-style polling (cross-device tiles),
            // those without use queue-ID polling (canvas-style).
            const nb2DbJobs = inFlight.filter((j: any) => j.falRequestId && !doneNb2Ids.has(j.falRequestId))
            const queueDbJobs = inFlight.filter((j: any) => !j.falRequestId)

            const byQueueId = new Map(currentSlots.filter(s => s.queueId).map(s => [s.queueId, s]))
            const slotAssignments = queueDbJobs.map((j: any) => ({
              slotId: byQueueId.get(j.id)?.slotId ?? `restored-${j.id}`,
              queueId: j.id as number,
              prompt: j.prompt as string,
            }))

            // Detect completed queue-backed slots (for recently-finished image fetching).
            // Only treat a slot as "completed" if its queueId appears in THIS user's DB jobs —
            // guards against cross-account bleed when two accounts share the same browser
            // and localStorage slots from account A are restored into account B's session.
            const allDbJobIds = new Set(allDbJobs.map((j: any) => j.id as number))
            const staleQueueSlots = currentSlots.filter(
              s => s.status === "loading" && s.queueId != null && !allDbJobIds.has(s.queueId)
            )
            if (staleQueueSlots.length > 0) {
              // Purge stale cross-account (or very old) slots from localStorage
              const staleIds = new Set(staleQueueSlots.map(s => s.slotId))
              try {
                const raw = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
                localStorage.setItem("pv2-pending-slots", JSON.stringify(raw.filter((s: any) => !staleIds.has(s.slotId))))
              } catch {}
            }
            const completedQueueSlotIds = new Set(
              currentSlots
                .filter(s => s.status === "loading" && s.queueId != null && !inFlightIds.has(s.queueId) && allDbJobIds.has(s.queueId))
                .map(s => s.slotId)
            )
            if (completedQueueSlotIds.size > 0) {
              try {
                const recentRes = await fetch(`/api/my-images?page=1&limit=${completedQueueSlotIds.size}&type=image`)
                const recentData = await recentRes.json()
                if (recentData.success && recentData.images?.length > 0) {
                  recentData.images.forEach((img: any) =>
                    handlePrependImage({ id: img.id, imageUrl: img.imageUrl, prompt: img.prompt, model: img.model })
                  )
                }
              } catch {}
            }

            // Local nb2 slots from localStorage (same device, across refreshes)
            const allLocalNb2Slots = currentSlots.filter(s => s.nb2RequestId && !doneNb2Ids.has(s.nb2RequestId))
            const localNb2RequestIds = new Set(allLocalNb2Slots.map(s => s.nb2RequestId!))

            // Build lookup maps for completed and failed DB jobs within the 2h window
            const completedDbByRequestId = new Map<string, any>()
            const failedDbRequestIds = new Set<string>()
            allDbJobs.forEach((j: any) => {
              if (!j.falRequestId || doneNb2Ids.has(j.falRequestId)) return
              if (j.status === 'completed') completedDbByRequestId.set(j.falRequestId, j)
              if (j.status === 'failed')    failedDbRequestIds.add(j.falRequestId)
            })

            // Also treat slots with no DB record at all as dead — they're either very old or
            // from a FAL request that expired before being written to the DB.
            const allDbRequestIds = new Set(allDbJobs.map((j: any) => j.falRequestId).filter(Boolean))
            const nb2SlotsCompletedWhileClosed = allLocalNb2Slots.filter(s => completedDbByRequestId.has(s.nb2RequestId!))
            const nb2SlotsDeadOrExpired = allLocalNb2Slots.filter(s => {
              // Flux RunPod jobs are admin-only and have no DB records — always resume polling
              if (s.modelId === 'custom-flux-lora') return false
              return failedDbRequestIds.has(s.nb2RequestId!) || !allDbRequestIds.has(s.nb2RequestId!)
            })
            const nb2SlotsStillLoading = allLocalNb2Slots.filter(
              s => !completedDbByRequestId.has(s.nb2RequestId!) && !nb2SlotsDeadOrExpired.some(d => d.slotId === s.slotId)
            )

            // For slots that finished while the app was closed, fetch their images and prepend them
            if (nb2SlotsCompletedWhileClosed.length > 0) {
              try {
                const requestIds = nb2SlotsCompletedWhileClosed.map(s => s.nb2RequestId!).join(',')
                const completedRes = await fetch(`/api/my-images?falRequestIds=${encodeURIComponent(requestIds)}`)
                const completedData = await completedRes.json()
                if (completedData.success && completedData.images?.length > 0) {
                  completedData.images.forEach((img: any) =>
                    handlePrependImage({ id: img.id, imageUrl: img.imageUrl, prompt: img.prompt, model: img.model })
                  )
                }
              } catch {}
            }

            // Purge completed + dead/expired slots from localStorage and mark as done
            const toPurge = [...nb2SlotsCompletedWhileClosed, ...nb2SlotsDeadOrExpired]
            if (toPurge.length > 0) {
              const purgeIds = new Set(toPurge.map(s => s.slotId))
              const purgeRequestIds = toPurge.map(s => s.nb2RequestId!)
              try {
                const stored = JSON.parse(localStorage.getItem("pv2-pending-slots") || "[]") as any[]
                localStorage.setItem("pv2-pending-slots", JSON.stringify(stored.filter((s: any) => !purgeIds.has(s.slotId))))
                const nowDoneIds = Array.from(new Set([...Array.from(doneNb2Ids), ...purgeRequestIds]))
                localStorage.setItem("pv2-nb2-done", JSON.stringify(nowDoneIds))
                purgeRequestIds.forEach(id => doneNb2Ids.add(id))
              } catch {}
            }

            // localNb2Slots = only those confirmed still in-flight in the DB
            const localNb2Slots = nb2SlotsStillLoading

            // Cross-device nb2 tiles: DB jobs with falRequestId not already in local slots
            const crossDeviceNb2Slots: PendingSlot[] = nb2DbJobs
              .filter((j: any) => !localNb2RequestIds.has(j.falRequestId))
              .map((j: any) => {
                const params = j.parameters as any
                return {
                  slotId:         `db-${j.id}`,
                  status:         "loading" as const,
                  prompt:         j.prompt,
                  nb2RequestId:   j.falRequestId,
                  nb2FalEndpoint: params?.falEndpoint || params?.falInput?.endpoint,
                  nb2StatusUrl:   MODEL_STATUS_URLS[j.modelId] || "/api/admin/nb2-status",
                  nb2AspectRatio: params?.size || params?.aspectRatio || params?.nb2AspectRatio,
                  nb2Quality:     params?.quality || params?.nb2Quality,
                  nb2TicketCost:  j.ticketCost ?? 0,
                  referenceImageUrls: params?.permanentReferenceUrls || [],
                }
              })

            const queuedImageSlots = currentSlots.filter(s => s.queueJobId && !s.nb2RequestId && !completedQueueSlotIds.has(s.slotId))

            // Rebuild: queue-backed + local nb2 + cross-device nb2 + queued slots
            setPendingSlots(() => [
              ...slotAssignments.map(sa => ({
                slotId: sa.slotId,
                status: "loading" as const,
                prompt: sa.prompt,
                queueId: sa.queueId,
              })),
              ...localNb2Slots,
              ...crossDeviceNb2Slots,
              ...queuedImageSlots,
            ])

            for (const sa of slotAssignments) {
              startPolling(sa.slotId, sa.queueId, sa.prompt)
            }

            // Resume polling for ALL nb2 slots (local + cross-device), grouped by requestId
            const allNb2Slots = [...localNb2Slots, ...crossDeviceNb2Slots]
            const nb2Groups = new Map<string, PendingSlot[]>()
            allNb2Slots.forEach(s => {
              const group = nb2Groups.get(s.nb2RequestId!) || []
              group.push(s)
              nb2Groups.set(s.nb2RequestId!, group)
            })
            nb2Groups.forEach((slots, requestId) => {
              const first = slots[0]
              startNb2SlotPolling(requestId, first.nb2FalEndpoint!, slots.map(s => s.slotId), first.prompt, first.nb2OutputFormat || 'png', first.nb2AspectRatio || 'auto', first.nb2StatusUrl, first.nb2Quality, first.nb2TicketCost ?? 0, first.referenceImageUrls || [])
            })
          }
        }
      } catch { /* silent */ }
    }
    fetchUser()
  }, [])

  const handleUsePrompt = useCallback((text: string) => {
    if (scannerMode === "video") {
      setVideoPromptOverride((prev) => ({ text, version: prev.version + 1 }))
    } else {
      setPromptOverride((prev) => ({ text, version: prev.version + 1 }))
    }
  }, [scannerMode])

  const handleRescan = useCallback((img: ImageItem) => {
    // Restore model — 'nano-banana-2' is the legacy DB value for NanoBanana Pro 2
    const resolvedModelId = img.model === 'nano-banana-2' ? 'nano-banana-pro-2' : img.model
    const modelConfig = IMAGE_MODEL_CONFIGS.find((m) => m.apiId === resolvedModelId)
    if (modelConfig) setSelectedModel(modelConfig)
    // Switch to image mode
    setScannerMode("image")
    // Inject prompt
    setPromptOverride((prev) => ({ text: img.prompt, version: prev.version + 1 }))
    // Restore aspect ratio, quality, and other config
    setConfigOverride((prev) => ({
      aspectRatio: img.aspectRatio,
      quality: img.quality,
      version: prev.version + 1,
    }))
    // Always clear active refs first — rescan is a clean slate regardless of what's currently loaded
    setActiveRefIds([])
    // Load reference images from the generation and activate them
    if (img.referenceImageUrls && img.referenceImageUrls.length > 0) {
      const newItems: RefImage[] = img.referenceImageUrls.map((url) => ({
        id: `rescan-${Date.now()}-${Math.random()}`,
        url,
      }))
      const limit = modelConfig?.maxReferenceImages ?? 8
      setRefLibrary((prev) => [...prev, ...newItems].slice(0, refLibraryLimit))
      setActiveRefIds(newItems.slice(0, limit).map((i) => i.id))
    }
  }, [])

  const handleSelectImageModel = (name: string) => {
    const config = IMAGE_MODEL_CONFIGS.find((m) => m.name === name)
    if (config) { setSelectedModel(config); setScannerMode("image") }
  }

  const toggle = (key: string) => setOpenDropdown((prev) => (prev === key ? null : key))

  return (
    <div className="bg-[#050810] text-white min-h-screen">
      {/* Taskbar */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-white/5">

        {/* Mobile-only top row: branding + queue + tickets + profile + dashboard */}
        <div className="flex sm:hidden items-center justify-between px-3 h-9 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <Sparkles size={11} className="text-white/50" />
            </div>
            <div className="w-px h-3 bg-white/10" />
            <QueueDisplay active={activeJobCount} max={maxConcurrent} label="img" />
            <QueueDisplay active={videoActiveJobCount} max={videoMaxConcurrent} label="vid" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-cyan-500/20 bg-black font-mono text-[10px]" style={{ boxShadow: "0 0 8px rgba(0,255,255,0.06), inset 0 0 12px rgba(0,0,0,0.6)" }}>
              <Ticket size={10} className="text-cyan-500/70" />
              <span className="text-cyan-400 tabular-nums">{user ? user.ticketBalance.toLocaleString() : "---"}</span>
            </div>
            <ProfileBubble user={user} onSignOut={() => setUser(null)} />
            <Link
              href="/dashboard"
              className="flex items-center px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[10px] text-slate-400 hover:border-white/20 hover:text-white transition-all"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Dropdown row + desktop-only right group */}
        <div className="flex items-center justify-between px-4 h-12">
          {/* Wordmark — desktop only */}
          <div className="hidden sm:flex items-center gap-2 shrink-0 mr-3">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                <Sparkles size={12} className="text-white/50" />
              </div>
              <div className="flex flex-col leading-none gap-0.5">
                <span className="text-[11px] font-black tracking-tight text-white/90">AI Design Studio</span>
                <div className="flex items-center gap-1.5">
                  <a href="/terms" target="_blank" className="text-[8px] text-white/25 hover:text-white/50 transition-colors">Terms</a>
                  <span className="text-[7px] text-white/10">·</span>
                  <a href="/privacy" target="_blank" className="text-[8px] text-white/25 hover:text-white/50 transition-colors">Privacy</a>
                  <span className="text-[7px] text-white/10">·</span>
                  <a href="/refund" target="_blank" className="text-[8px] text-white/25 hover:text-white/50 transition-colors">Refund</a>
                </div>
              </div>
            </div>
            <div className="w-px h-4 bg-white/8" />
          </div>
          <div className="flex items-center flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden mr-1">
            <GroupedTaskbarDropdown
              label="Image"
              icon={Image}
              groups={IMAGE_MODEL_GROUPS}
              adminGroups={isAdminAccount ? ADMIN_IMAGE_MODEL_GROUPS : undefined}
              open={openDropdown === "image"}
              onToggle={() => toggle("image")}
              onSelect={handleSelectImageModel}
              activeItem={selectedModel.name}
              itemCosts={IMAGE_MODEL_COST_BY_NAME}
              menuTitle="Image Generation Model"
              menuDescription="Select which AI model generates your image. Models are grouped by company."
            />
            <GroupedTaskbarDropdown
              label="Video"
              icon={Video}
              groups={VIDEO_MODEL_GROUPS}
              open={openDropdown === "video"}
              onToggle={() => toggle("video")}
              onSelect={handleSelectVideoModel}
              activeItem={selectedVideoModel.name}
              itemCosts={VIDEO_MODEL_COST_BY_NAME}
              menuTitle="Video Generation Model"
              menuDescription="Select which AI model generates your video. Models are grouped by company."
            />
            <TextDropdown
              open={openDropdown === "text"}
              onToggle={() => toggle("text")}
              hasDevAccess={hasEffectiveDevAccess}
              imageModelName={selectedModel.name}
              onUsePrompt={handleUsePrompt}
              signedIn={user !== null}
            />
            <RefDropdown
              open={openDropdown === "refs"}
              onToggle={() => toggle("refs")}
              library={refLibrary}
              activeIds={activeRefIds}
              modelMaxRefs={selectedModel.maxReferenceImages}
              onUpload={handleLibraryUpload}
              onDelete={handleLibraryDelete}
              onDeleteMultiple={handleLibraryDeleteMultiple}
              onClearAll={handleLibraryClearAll}
              onActivate={handleActivateRef}
              onDeactivate={handleDeactivateRef}
              disabled={scannerMode === "video"}
              libraryLimit={isAdminAccount ? 250 : hasEffectiveDevAccess ? 100 : 50}
            />
            <ShopDropdown
              open={openDropdown === "shop"}
              onToggle={() => toggle("shop")}
              user={user}
            />
            <SelectDropdown
              open={openDropdown === "select"}
              onToggle={() => toggle("select")}
              selectMode={selectMode}
              onToggleSelectMode={handleToggleSelectMode}
              selectedCount={selectedImageIds.size}
              onDownloadAll={handleBulkDownload}
              onDeleteAll={handleBulkDelete}
              downloading={bulkDownloading}
              deleting={bulkDeleting}
              downloadProgress={downloadProgress}
              downloadError={downloadError}
            />
            <NewsDropdown
              open={openDropdown === "news"}
              onToggle={() => toggle("news")}
            />
          </div>
          {/* Desktop-only right group */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <QueueDisplay active={activeJobCount} max={maxConcurrent} label="img" />
            <QueueDisplay active={videoActiveJobCount} max={videoMaxConcurrent} label="vid" />
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-cyan-500/20 bg-black font-mono text-xs" style={{ boxShadow: "0 0 8px rgba(0,255,255,0.06), inset 0 0 12px rgba(0,0,0,0.6)" }}>
              <Ticket size={11} className="text-cyan-500/70" />
              <span className="text-cyan-400 tabular-nums tracking-wider">
                {user ? user.ticketBalance.toLocaleString() : "---"}
              </span>
            </div>
            <ProfileBubble user={user} onSignOut={() => setUser(null)} />
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:border-white/20 hover:text-white transition-all"
            >
              Dashboard
            </Link>
          </div>
        </div>

      </div>

      {scannerMode === "image" ? (
        <>
          {/* Image grid */}
          <div className="pb-36">
            <ImageGrid
              key={imageGridKey}
              signedIn={user !== null}
              pendingSlots={pendingSlots}
              freshImages={freshImages}
              savedFails={savedFails}
              onImageClick={setSelectedImage}
              onPendingClick={setPendingDetail}
              selectMode={selectMode}
              selectedIds={selectedImageIds}
              onSelectToggle={handleSelectToggle}
            />
          </div>
          {/* Custom Flux LoRA panel — replaces PromptBox for that model */}
          {selectedModel.isCustomFlux ? (
            <CustomFluxPanel
              onAddPending={handleAddPending}
              onUpdatePending={handleUpdatePending}
              onRemovePending={handleRemovePending}
              onStartNb2Polling={startNb2SlotPolling}
              onPrependImage={handlePrependImage}
              activeRefImages={refLibrary.filter(img => activeRefIds.includes(img.id)).slice(0, 3)}
              promptOverride={promptOverride}
            />
          ) : (
          <PromptBox
            model={selectedModel}
            onModelChange={setSelectedModel}
            userId={user?.id ?? null}
            onAddPending={handleAddPending}
            onUpdatePending={handleUpdatePending}
            onRemovePending={handleRemovePending}
            onPrependImage={handlePrependImage}
            onBalanceChange={handleBalanceChange}
            activeRefImages={activeRefImages}
            refLibrary={refLibrary}
            onDeactivateRef={handleDeactivateRef}
            onEditRef={handleEditRef}
            onLoadPreset={handleLoadPreset}
            onUploadRef={handleUploadRef}
            onStartPolling={startPolling}
            onStartNb2Polling={startNb2SlotPolling}
            onCancelNb2Polling={cancelNb2SlotPolling}
            onDeductTickets={(amount) => {
              // UI-only update — server deducts atomically in the submit route before FAL
              setUser(prev => prev ? { ...prev, ticketBalance: Math.max(0, prev.ticketBalance - amount) } : prev)
            }}
            activeJobCount={activeJobCount}
            maxConcurrent={maxConcurrent}
            promptOverride={promptOverride}
            configOverride={configOverride}
            isGenerationMaintenance={isGenerationMaintenance && !isAdminAccount && !isAuditAccount}
            isAdminAccount={isAdminAccount}
            ticketBalance={user?.ticketBalance ?? 0}
          />
          )}
        </>
      ) : !user ? (
        /* Video — not signed in */
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-full max-w-sm text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center mx-auto mb-5">
              <User size={28} className="text-slate-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">Sign in to get started</h2>
            <p className="text-sm text-slate-500 mb-6">Your generations and saved work will appear here.</p>
            <div className="flex flex-col gap-2">
              <Link href="/login" className="block">
                <button className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black text-sm font-bold hover:opacity-90 transition-opacity">
                  Sign In
                </button>
              </Link>
              <Link href="/signup" className="block">
                <button className="w-full py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all">
                  Create Account
                </button>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        /* Video scanner — sidebar on desktop, drawer on mobile */
        <div style={{ height: "calc(100vh - 48px)" }} className="flex overflow-hidden relative">
          {/* Left: customization panel — desktop only */}
          <div className="hidden sm:block w-72 shrink-0 border-r border-white/5 overflow-y-auto pb-24">
            <VideoCustomizationPanel
              model={selectedVideoModel}
              safetyChecker={selectedVideoModel.id === "wan-2.5" ? wan25VideoSafetyChecker : selectedVideoModel.id === "seedance-1.5" ? seedance15VideoSafetyChecker : undefined}
              setSafetyChecker={selectedVideoModel.id === "wan-2.5" ? setWan25VideoSafetyChecker : selectedVideoModel.id === "seedance-1.5" ? setSeedance15VideoSafetyChecker : undefined}
              isAdminAccount={isAdminAccount}
              duration={videoDuration}
              onDurationChange={setVideoDuration}
              aspectRatio={videoAspectRatio}
              onAspectRatioChange={setVideoAspectRatio}
              resolution={videoResolution}
              onResolutionChange={setVideoResolution}
              audioEnabled={videoAudioEnabled}
              onAudioToggle={setVideoAudioEnabled}
              audioFile={videoAudioFile}
              onAudioFileChange={handleVideoAudioSelect}
              startFramePreview={videoStartFramePreview}
              onStartFrameSelect={handleVideoStartFrameSelect}
              onClearStartFrame={() => { setVideoStartFramePreview(null); setVideoStartFrameUrl(null) }}
              endFramePreview={videoEndFramePreview}
              onEndFrameSelect={handleVideoEndFrameSelect}
              onClearEndFrame={() => { setVideoEndFramePreview(null); setVideoEndFrameUrl(null) }}
              startFrameUploading={videoStartFramePreview !== null && videoStartFrameUrl === null}
              endFrameUploading={videoEndFramePreview !== null && videoEndFrameUrl === null}
              audioUploading={videoAudioFile !== null && videoAudioUrl === null}
              motionVideoFilename={videoMotionVideoPreview}
              onMotionVideoSelect={handleVideoMotionVideoSelect}
              onClearMotionVideo={() => { setVideoMotionVideoPreview(null); setVideoMotionVideoUrl(null); setVideoMotionVideoDuration(null) }}
              motionVideoUploading={videoMotionVideoPreview !== null && videoMotionVideoUrl === null}
              motionVideoDuration={videoMotionVideoDuration}
              onMotionVideoDurationChange={setVideoMotionVideoDuration}
              characterOrientation={videoCharacterOrientation}
              onCharacterOrientationChange={v => setVideoCharacterOrientation(v as "image" | "video")}
              keepOriginalSound={videoKeepOriginalSound}
              onKeepOriginalSoundToggle={setVideoKeepOriginalSound}
              videoRefImagePreviews={videoRefImagePreviews}
              onAddRefImage={handleAddRefImage}
              onRemoveRefImage={handleRemoveRefImage}
              videoRefVideoFilenames={videoRefVideoFilenames}
              videoRefVideoUrls={videoRefVideoUrls}
              onAddRefVideo={handleAddRefVideo}
              onRemoveRefVideo={handleRemoveRefVideo}
              videoRefAudioFilenames={videoRefAudioFilenames}
              onAddRefAudio={handleAddRefAudio}
              onRemoveRefAudio={handleRemoveRefAudio}
              videoRefVideoDuration={videoRefVideoDuration}
              sd20Mode={videoSD20Mode}
              onSD20ModeChange={setVideoSD20Mode}
              lipsyncVideoFilename={videoLipsyncVideoFilename}
              lipsyncVideoUploading={videoLipsyncVideoFilename !== null && videoLipsyncVideoUrl === null}
              lipsyncVideoDuration={videoLipsyncVideoDuration}
              onLipsyncVideoSelect={handleLipsyncVideoSelect}
              onClearLipsyncVideo={() => { setVideoLipsyncVideoFilename(null); setVideoLipsyncVideoUrl(null); setVideoLipsyncVideoDuration(0); setVideoLipsyncAspectRatio(undefined) }}
              lipsyncAudioFilename={videoLipsyncAudioFilename}
              lipsyncAudioUploading={videoLipsyncAudioFilename !== null && videoLipsyncAudioUrl === null}
              onLipsyncAudioSelect={handleLipsyncAudioSelect}
              onClearLipsyncAudio={() => { setVideoLipsyncAudioFilename(null); setVideoLipsyncAudioUrl(null) }}
              lipsyncSyncMode={videoLipsyncSyncMode}
              onLipsyncSyncModeChange={setVideoLipsyncSyncMode}
            />
          </div>

          {/* Feed — full width on mobile, flex-1 on desktop */}
          <div className="flex-1 overflow-y-auto pb-24">
            <VideoFeed
              pendingSlots={videoPendingSlots}
              items={videoItems}
              savedFails={savedVideoFails}
              onVideoClick={setSelectedVideo}
              onPendingClick={setVideoPendingDetail}
              selectMode={selectMode}
              selectedIds={selectedImageIds}
              onSelectToggle={handleSelectToggle}
            />
          </div>

          {/* Video prompt bar — fixed at bottom */}
          <VideoPromptBar
            model={selectedVideoModel}
            onGenerate={handleVideoGenerate}
            generating={videoGenerating}
            canGenerate={!videoGenerating && (selectedVideoModel.supportsLipsync ? (!!videoLipsyncVideoUrl && !!videoLipsyncAudioUrl) : (selectedVideoModel.textToVideo || !!videoStartFrameUrl)) && (selectedVideoModel.id !== "kling-v3-motion" || !!videoMotionVideoUrl) && videoActiveJobCount < videoMaxConcurrent}
            queueFull={videoActiveJobCount >= videoMaxConcurrent && videoMaxConcurrent !== Infinity}
            isGenerationMaintenance={isGenerationMaintenance && !isAdminAccount && !isAuditAccount}
            duration={videoDuration}
            resolution={videoResolution}
            aspectRatio={videoAspectRatio}
            audioEnabled={videoAudioEnabled}
            onModelChange={applyVideoModel}
            promptOverride={videoPromptOverride}
            characterOrientation={videoCharacterOrientation}
            motionVideoDuration={videoMotionVideoDuration}
            onConfigOpen={() => setVideoConfigOpen(true)}
            startFramePreview={videoStartFramePreview}
            startFrameUploading={videoStartFramePreview !== null && videoStartFrameUrl === null}
            onStartFrameSelect={handleVideoStartFrameSelect}
            motionVideoFilename={videoMotionVideoPreview}
            motionVideoUploading={videoMotionVideoPreview !== null && videoMotionVideoUrl === null}
            onMotionVideoSelect={handleVideoMotionVideoSelect}
            onMotionVideoDurationChange={setVideoMotionVideoDuration}
            motionPromptText={videoMotionPromptText}
            lipsyncVideoDuration={videoLipsyncVideoDuration}
          />

          {/* Mobile: Config bottom drawer */}
          {videoConfigOpen && (
            <div className="sm:hidden fixed inset-0 z-[9990] flex flex-col justify-end">
              {/* Backdrop */}
              <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setVideoConfigOpen(false)} />
              {/* Drawer */}
              <div className="bg-[#050810] border-t border-white/10 rounded-t-2xl max-h-[85vh] overflow-y-auto">
                {/* Drag handle + header */}
                <div className="sticky top-0 z-10 bg-[#050810] border-b border-white/5 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="text-orange-400" />
                    <span className="text-sm font-bold text-white">Video Configuration</span>
                  </div>
                  <button
                    onClick={() => setVideoConfigOpen(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
                {/* Motion Control: optional prompt at top of drawer */}
                {selectedVideoModel.id === "kling-v3-motion" && (
                  <div className="px-4 pt-4 pb-3 border-b border-white/5">
                    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">
                      Prompt <span className="normal-case text-slate-700 font-normal">(optional)</span>
                    </p>
                    <textarea
                      value={videoMotionPromptText}
                      onChange={e => setVideoMotionPromptText(e.target.value)}
                      placeholder="Describe additional motion details..."
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-orange-500/40 transition-all"
                    />
                  </div>
                )}
                {/* Config panel */}
                <VideoCustomizationPanel
                  model={selectedVideoModel}
                  safetyChecker={selectedVideoModel.id === "wan-2.5" ? wan25VideoSafetyChecker : selectedVideoModel.id === "seedance-1.5" ? seedance15VideoSafetyChecker : undefined}
                  setSafetyChecker={selectedVideoModel.id === "wan-2.5" ? setWan25VideoSafetyChecker : selectedVideoModel.id === "seedance-1.5" ? setSeedance15VideoSafetyChecker : undefined}
                  isAdminAccount={isAdminAccount}
                  duration={videoDuration}
                  onDurationChange={setVideoDuration}
                  aspectRatio={videoAspectRatio}
                  onAspectRatioChange={setVideoAspectRatio}
                  resolution={videoResolution}
                  onResolutionChange={setVideoResolution}
                  audioEnabled={videoAudioEnabled}
                  onAudioToggle={setVideoAudioEnabled}
                  audioFile={videoAudioFile}
                  onAudioFileChange={handleVideoAudioSelect}
                  startFramePreview={videoStartFramePreview}
                  onStartFrameSelect={handleVideoStartFrameSelect}
                  onClearStartFrame={() => { setVideoStartFramePreview(null); setVideoStartFrameUrl(null) }}
                  endFramePreview={videoEndFramePreview}
                  onEndFrameSelect={handleVideoEndFrameSelect}
                  onClearEndFrame={() => { setVideoEndFramePreview(null); setVideoEndFrameUrl(null) }}
                  startFrameUploading={videoStartFramePreview !== null && videoStartFrameUrl === null}
                  endFrameUploading={videoEndFramePreview !== null && videoEndFrameUrl === null}
                  audioUploading={videoAudioFile !== null && videoAudioUrl === null}
                  motionVideoFilename={videoMotionVideoPreview}
                  onMotionVideoSelect={handleVideoMotionVideoSelect}
                  onClearMotionVideo={() => { setVideoMotionVideoPreview(null); setVideoMotionVideoUrl(null); setVideoMotionVideoDuration(null) }}
                  motionVideoUploading={videoMotionVideoPreview !== null && videoMotionVideoUrl === null}
                  motionVideoDuration={videoMotionVideoDuration}
                  onMotionVideoDurationChange={setVideoMotionVideoDuration}
                  characterOrientation={videoCharacterOrientation}
                  onCharacterOrientationChange={v => setVideoCharacterOrientation(v as "image" | "video")}
                  keepOriginalSound={videoKeepOriginalSound}
                  onKeepOriginalSoundToggle={setVideoKeepOriginalSound}
                  videoRefImagePreviews={videoRefImagePreviews}
                  onAddRefImage={handleAddRefImage}
                  onRemoveRefImage={handleRemoveRefImage}
                  videoRefVideoFilenames={videoRefVideoFilenames}
                  videoRefVideoUrls={videoRefVideoUrls}
                  onAddRefVideo={handleAddRefVideo}
                  onRemoveRefVideo={handleRemoveRefVideo}
                  videoRefAudioFilenames={videoRefAudioFilenames}
                  onAddRefAudio={handleAddRefAudio}
                  onRemoveRefAudio={handleRemoveRefAudio}
                  videoRefVideoDuration={videoRefVideoDuration}
                  sd20Mode={videoSD20Mode}
                  onSD20ModeChange={setVideoSD20Mode}
                  lipsyncVideoFilename={videoLipsyncVideoFilename}
                  lipsyncVideoUploading={videoLipsyncVideoFilename !== null && videoLipsyncVideoUrl === null}
                  lipsyncVideoDuration={videoLipsyncVideoDuration}
                  onLipsyncVideoSelect={handleLipsyncVideoSelect}
                  onClearLipsyncVideo={() => { setVideoLipsyncVideoFilename(null); setVideoLipsyncVideoUrl(null); setVideoLipsyncVideoDuration(0); setVideoLipsyncAspectRatio(undefined) }}
                  lipsyncAudioFilename={videoLipsyncAudioFilename}
                  lipsyncAudioUploading={videoLipsyncAudioFilename !== null && videoLipsyncAudioUrl === null}
                  onLipsyncAudioSelect={handleLipsyncAudioSelect}
                  onClearLipsyncAudio={() => { setVideoLipsyncAudioFilename(null); setVideoLipsyncAudioUrl(null) }}
                  lipsyncSyncMode={videoLipsyncSyncMode}
                  onLipsyncSyncModeChange={setVideoLipsyncSyncMode}
                />
                {/* Extra bottom padding for safe area */}
                <div className="h-6" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image detail modal */}
      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onRescan={handleRescan}
          onUsePrompt={(text) => { handleUsePrompt(text); setSelectedImage(null) }}
          onAddRef={(url, r2Key) => {
            const addRef = (finalUrl: string) =>
              handleUploadRef([{ id: `ref-${Date.now()}-${Math.random()}`, url: finalUrl }])
            if (r2Key) {
              const pass = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem('admin-password') ?? '') : ''
              fetch(`/api/admin/onetrainer/cloud/download?key=${encodeURIComponent(r2Key)}`, {
                headers: pass ? { 'x-admin-password': pass } : {},
              })
                .then(r => r.json())
                .then((data: { url?: string }) => addRef(data.url || url))
                .catch(() => addRef(url))
            } else {
              addRef(url)
            }
          }}
        />
      )}

      {/* Video detail modal */}
      {selectedVideo && (
        <VideoDetailModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onRescan={(vid) => {
            setScannerMode("video")
            setVideoPromptOverride(prev => ({ text: vid.prompt, version: prev.version + 1 }))
            // Restore video model
            const vModel = VIDEO_MODEL_CONFIGS.find(m => m.id === vid.model)
            if (vModel) setSelectedVideoModel(vModel)
            // Restore video config
            if (vid.duration) setVideoDuration(vid.duration)
            if (vid.resolution) setVideoResolution(vid.resolution)
            if (vid.aspectRatio) setVideoAspectRatio(vid.aspectRatio)
            if (vid.audioEnabled !== undefined) setVideoAudioEnabled(vid.audioEnabled)
            if (vid.keepOriginalSound !== undefined) setVideoKeepOriginalSound(vid.keepOriginalSound)
            if (vid.characterOrientation) setVideoCharacterOrientation(vid.characterOrientation)
            // Restore reference frames (set preview + URL so the UI shows them loaded)
            if (vid.startFrameUrl) { setVideoStartFramePreview(vid.startFrameUrl); setVideoStartFrameUrl(vid.startFrameUrl) }
            if (vid.endFrameUrl) { setVideoEndFramePreview(vid.endFrameUrl); setVideoEndFrameUrl(vid.endFrameUrl) }
            if (vid.motionVideoUrl) { setVideoMotionVideoPreview(vid.motionVideoUrl); setVideoMotionVideoUrl(vid.motionVideoUrl) }
          }}
          onUsePrompt={(text) => { handleUsePrompt(text); setSelectedVideo(null) }}
        />
      )}

      {/* Pending image detail modal */}
      {pendingDetail && (
        <PendingDetailModal
          prompt={pendingDetail.prompt}
          model={pendingDetail.modelId || ""}
          quality={pendingDetail.quality}
          aspectRatio={pendingDetail.aspectRatio}
          referenceImageUrls={pendingDetail.referenceImageUrls}
          isQueued={!!(pendingDetail.queueJobId && !pendingDetail.nb2RequestId)}
          onClose={() => setPendingDetail(null)}
          onUsePrompt={(text) => { handleUsePrompt(text); setPendingDetail(null) }}
          onDismiss={() => {
            if (pendingDetail.nb2RequestId) cancelNb2SlotPolling(pendingDetail.nb2RequestId)
            handleRemovePending(pendingDetail.slotId)
          }}
        />
      )}

      {/* Pending video detail modal */}
      {videoPendingDetail && (
        <PendingDetailModal
          prompt={videoPendingDetail.prompt}
          model={videoPendingDetail.model}
          aspectRatio={videoPendingDetail.aspectRatio}
          isVideoSlot={true}
          startFrameUrl={videoPendingDetail.startFrameUrl}
          endFrameUrl={videoPendingDetail.endFrameUrl}
          isQueued={!!(videoPendingDetail.queueJobId && !videoPendingDetail.requestId)}
          onClose={() => setVideoPendingDetail(null)}
          onUsePrompt={(text) => { handleUsePrompt(text); setVideoPendingDetail(null) }}
          onDismiss={() => {
            const interval = videoPollingIntervals.current[videoPendingDetail.slotId]
            if (interval) { clearInterval(interval); delete videoPollingIntervals.current[videoPendingDetail.slotId] }
            setVideoPendingSlots(prev => prev.filter(s => s.slotId !== videoPendingDetail.slotId))
          }}
        />
      )}
      <ChatWidget sideTabOnly={scannerMode === "video"} />
    </div>
  )
}
