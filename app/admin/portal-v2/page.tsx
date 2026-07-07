"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import ChatWidget from "@/components/ChatWidget"
import { Image, Video, Type, ChevronDown, ChevronLeft, ChevronRight, Ticket, User, BookMarked, ImagePlus, X, Plus, Check, Copy, Download, RotateCcw, ShoppingBag, SlidersHorizontal, Bell, AlertTriangle, CheckCircle, Info, Sparkles, Music, BookOpen, Star, Trash2, Loader2, Eye, RefreshCw, Upload, Pencil, Eraser, Crop, Undo2, Square, Circle, Droplets, Lock, FolderPlus, Layers, Search, PanelLeft, PanelRight, PanelTop, PanelBottom, EyeOff } from "lucide-react"
import { AddToBucketModal, type Bucket, type BucketFolder } from "@/components/AddToBucketModal"
import { NewsManager } from "@/components/NewsManager"

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
  thumbnailUrl?: string | null
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
      // Cap the menu to the viewport and clamp so it never hangs off either edge
      const menuW = Math.min(428, window.innerWidth - 16)
      setMenuPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8)) })
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
          style={{ top: menuPos.top, left: menuPos.left, width: "min(428px, calc(100vw - 16px))" }}
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
  isAdmin = false,
  onAddToBucket,
}: {
  open: boolean
  onToggle: () => void
  selectMode: boolean
  onToggleSelectMode: () => void
  selectedCount: number
  isAdmin?: boolean
  onAddToBucket?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

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

          {/* Admin only: add selection to a dataset bucket */}
          {selectMode && isAdmin && onAddToBucket && (
            <button
              onClick={() => { onAddToBucket(); onToggle() }}
              disabled={selectedCount === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-violet-500/10 border border-violet-500/25 text-violet-300 hover:bg-violet-500/20 hover:text-violet-200 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <FolderPlus size={13} />
              Add to Bucket
            </button>
          )}

          {/* Bulk controls live in the floating panel while select mode is on */}
          {selectMode && (
            <p className="text-[10px] text-slate-500 leading-snug px-1">
              Tap images to select them. Download and delete controls are in the panel at the top right of your screen.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// --- SELECT MODE FLOATING CONTROLS ---
// Pinned below the taskbar at the top right while select mode is active, so
// users can act on their selection without reopening the Select dropdown.
function SelectModeOverlay({
  selectedCount,
  onDownloadAll,
  onDeleteAll,
  onHideAll,
  onExit,
  downloading,
  deleting,
  hiding = false,
  hiddenView = false,
  downloadProgress,
  downloadError,
  isAdmin = false,
  onAddToBucket,
}: {
  selectedCount: number
  onDownloadAll: () => void
  onDeleteAll: () => void
  onHideAll?: () => void
  onExit: () => void
  downloading: boolean
  deleting: boolean
  hiding?: boolean
  hiddenView?: boolean
  downloadProgress?: { done: number; total: number } | null
  downloadError?: string | null
  isAdmin?: boolean
  onAddToBucket?: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset confirmation when the selection changes
  useEffect(() => { setConfirmDelete(false) }, [selectedCount])

  return createPortal(
    <div className="fixed right-3 top-[92px] sm:top-[60px] z-[9970] w-60 rounded-xl border border-cyan-500/25 bg-slate-900/95 backdrop-blur-md shadow-2xl p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-cyan-400/80 uppercase tracking-widest">Select Mode</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
            {selectedCount === 0 ? "Tap images" : `${selectedCount} selected`}
          </span>
          <button
            onClick={onExit}
            title="Exit select mode"
            className="w-5 h-5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
          >
            <X size={11} />
          </button>
        </div>
      </div>

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
      {/* Hide / Unhide — reversible, no confirm needed */}
      {onHideAll && (
        <button
          onClick={() => { if (selectedCount > 0) onHideAll() }}
          disabled={selectedCount === 0 || hiding}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            hiddenView
              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20"
              : "bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20"
          }`}
        >
          {hiding
            ? <div className="w-3 h-3 rounded-full border-2 border-slate-500 border-t-slate-200 animate-spin shrink-0" />
            : hiddenView ? <Eye size={13} className="shrink-0" /> : <EyeOff size={13} className="shrink-0" />}
          <span className="flex-1 text-left">
            {hiding ? (hiddenView ? "Unhiding…" : "Hiding…") : hiddenView ? "Unhide Selected" : "Hide Selected"}
          </span>
        </button>
      )}
      {/* Admin only: add selection to a dataset bucket */}
      {isAdmin && onAddToBucket && (
        <button
          onClick={() => { if (selectedCount > 0) onAddToBucket() }}
          disabled={selectedCount === 0}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-violet-500/10 border border-violet-500/25 text-violet-300 hover:bg-violet-500/20 hover:text-violet-200 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <FolderPlus size={13} />
          Add to Bucket
        </button>
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
    </div>,
    document.body
  )
}

// --- FEED WIDTH DROPDOWN ---
// Maps the user's column choice to a static Tailwind class (JIT needs literals)
const FEED_COL_CLASS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3",
  4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6",
}
// CSS multi-column classes for masonry "Flow" mode — packs variable-height images with
// no row gaps, flowing top-to-bottom per column.
const FEED_MASONRY_CLASS: Record<number, string> = {
  1: "columns-1", 2: "columns-2", 3: "columns-3",
  4: "columns-4", 5: "columns-5", 6: "columns-6",
}

// Masonry "Rows" mode helpers (JS packing) --------------------------------------------
// Estimate a tile's relative height from its known aspect ratio ("2:3" / "1024x1536" →
// height per unit column width). Lets us balance columns BEFORE images load, so tiles
// don't move as images fill in.
const arHeightWeight = (ar?: string): number => {
  if (!ar || ar === "auto") return 1
  const [w, h] = ar.replace(/x/i, ":").split(":").map(parseFloat)
  return w > 0 && h > 0 ? h / w : 1
}
// Deterministic shortest-column packing: assign each item, in order, to the currently
// shortest column. Because a given item's placement depends only on the items before it,
// appending new items never moves existing ones (no reflow/jump), and the first row fills
// left-to-right.
function distributeMasonry<T extends { weight: number }>(items: T[], n: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => [])
  const heights = new Array(n).fill(0)
  for (const item of items) {
    let min = 0
    for (let i = 1; i < n; i++) if (heights[i] < heights[min]) min = i
    cols[min].push(item)
    heights[min] += item.weight
  }
  return cols
}

// --- FEED DROPDOWN UI HELPERS ---
// Segmented pill control used throughout the Feed settings panel.
function FeedSeg<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; accent?: "cyan" | "amber" }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/20">
      {options.map((opt, i) => {
        const active = value === opt.value
        const activeCls = (opt.accent ?? "cyan") === "amber"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-cyan-500/20 text-cyan-300"
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${active ? activeCls : "text-slate-500 hover:text-white hover:bg-white/5"}`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Label + control row for the nested Full Size options.
function FeedOptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium text-slate-400">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ON/OFF toggle row (Full Size, View Hidden).
function FeedToggleRow({ label, icon, on, onChange, accent = "cyan" }: {
  label: string
  icon?: ReactNode
  on: boolean
  onChange: (v: boolean) => void
  accent?: "cyan" | "amber"
}) {
  const activeCls = accent === "amber"
    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
    : "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
  const pillCls = accent === "amber" ? "bg-amber-500/25 text-amber-300" : "bg-cyan-500/25 text-cyan-300"
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium transition-all ${on ? activeCls : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"}`}
    >
      <span className="flex items-center gap-1.5">{icon}{label}</span>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${on ? pillCls : "bg-white/10 text-slate-500"}`}>{on ? "ON" : "OFF"}</span>
    </button>
  )
}

function FeedDropdown({
  open,
  onToggle,
  cols,
  onColsChange,
  fullSize,
  onFullSizeChange,
  fullSizeLayout,
  onFullSizeLayoutChange,
  masonryMode,
  onMasonryModeChange,
  tileRes,
  onTileResChange,
  showHidden,
  onShowHiddenChange,
  isAdmin = false,
  adminFilterCount = 0,
  adminFilters = null,
  onApplyAdminFilters,
}: {
  open: boolean
  onToggle: () => void
  cols: number | null
  onColsChange: (n: number | null) => void
  fullSize: boolean
  onFullSizeChange: (on: boolean) => void
  fullSizeLayout: "grid" | "masonry"
  onFullSizeLayoutChange: (layout: "grid" | "masonry") => void
  masonryMode: "flow" | "rows"
  onMasonryModeChange: (mode: "flow" | "rows") => void
  tileRes: "thumb" | "full"
  onTileResChange: (res: "thumb" | "full") => void
  showHidden: boolean
  onShowHiddenChange: (on: boolean) => void
  isAdmin?: boolean
  adminFilterCount?: number
  adminFilters?: AdminFeedFilters | null
  onApplyAdminFilters?: (filters: AdminFeedFilters | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  // --- Inline admin feed filters (previously the AdminFeedFilterPanel modal) ---
  // Starts expanded — admins use it constantly
  const [adminOpen, setAdminOpen] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  const [draft, setDraft] = useState<AdminFeedFilters>(adminFilters ?? EMPTY_ADMIN_FEED_FILTERS)
  const [facets, setFacets] = useState<AdminFeedFacets | null>(null)
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [folders, setFolders] = useState<BucketFolder[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [browsePath, setBrowsePath] = useState<number[]>([])
  const [adminLoaded, setAdminLoaded] = useState(false)
  const [authNeeded, setAuthNeeded] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const el = e.target as HTMLElement
      // Ignore clicks inside portaled MultiFilterSelect menus — they live on <body>
      if (ref.current && !ref.current.contains(el) && !el.closest?.("[data-feed-filter-menu]")) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle])

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const panelW = Math.min(540, window.innerWidth - 16)
      setMenuPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8)) })
    }
  }, [open])

  // Whenever the panel opens, reset the filter draft to whatever is currently applied
  useEffect(() => {
    if (open) {
      const f = adminFilters ?? EMPTY_ADMIN_FEED_FILTERS
      setDraft(f)
      if (f.hasRefs || f.hasRating || f.hasCaption || f.hasTag || f.tagFilter || f.bucketId) setMoreOpen(true)
    }
  }, [open, adminFilters])

  // Same load pattern as AdminFeedFilterPanel: 401 on the protected endpoints → unlock needed
  const loadAdminData = useCallback(async () => {
    setLoadError(null)
    try {
      const headers = adminPasswordHeaders()
      const [dRes, bRes, fRes] = await Promise.all([
        fetch("/api/admin/dataset?page=1&limit=1", { headers }),
        fetch("/api/admin/buckets", { headers }),
        fetch("/api/admin/folders", { headers }),
      ])
      if (dRes.status === 401 || bRes.status === 401) {
        setAuthNeeded(true)
        return
      }
      setAuthNeeded(false)
      if (dRes.ok) { const d = await dRes.json(); setFacets(d.facets ?? null) }
      if (bRes.ok) setBuckets(await bRes.json())
      if (fRes.ok) setFolders(await fRes.json())
    } catch {
      setLoadError("Failed to load filter options — check your connection.")
    }
  }, [])

  // Check auth / load facets the first time the admin section is expanded
  useEffect(() => {
    if (open && isAdmin && adminOpen && !adminLoaded) {
      setAdminLoaded(true)
      loadAdminData()
    }
  }, [open, isAdmin, adminOpen, adminLoaded, loadAdminData])

  const handleUnlock = async () => {
    if (!passwordInput.trim() || verifying) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      if (res.ok) {
        try { sessionStorage.setItem("admin-password", passwordInput) } catch {}
        setPasswordInput("")
        setAuthNeeded(false)
        await loadAdminData()
      } else {
        const data = await res.json().catch(() => null)
        setVerifyError(data?.error || "Incorrect password")
      }
    } catch {
      setVerifyError("Verification failed — check your connection.")
    } finally {
      setVerifying(false)
    }
  }

  const setF = <K extends keyof AdminFeedFilters>(k: K, v: AdminFeedFilters[K]) => setDraft(d => ({ ...d, [k]: v }))
  const draftEmpty = JSON.stringify(draft) === JSON.stringify(EMPTY_ADMIN_FEED_FILTERS)
  const currentFolderId = browsePath.length > 0 ? browsePath[browsePath.length - 1] : null
  const visibleFolders = folders.filter(f => currentFolderId === null ? !f.parentId : f.parentId === currentFolderId)
  const visibleBuckets = buckets.filter(b => b.folderId === currentFolderId)
  const selectedBucket = draft.bucketId ? buckets.find(b => String(b.id) === draft.bucketId) : null
  const selectCls = "w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/40"
  const labelCls = "text-[9px] font-mono uppercase tracking-wider text-slate-600 mb-1 block"

  return (
    <div className="relative flex-none min-w-[90px] sm:flex-1" ref={ref}>
      <button
        ref={buttonRef}
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        <Layers size={15} />
        Feed
        {cols !== null && (
          <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full leading-none">{cols}</span>
        )}
        {showHidden && (
          <EyeOff size={11} className="text-amber-400 shrink-0" aria-label="Viewing hidden generations" />
        )}
        {adminFilterCount > 0 && (
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" title={`${adminFilterCount} feed filters active`} />
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="fixed w-[min(540px,calc(100vw-16px))] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl z-[9999] overflow-hidden" style={{ top: menuPos.top, left: menuPos.left }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
            <Layers size={13} className="text-cyan-400" />
            <span className="text-[12px] font-semibold text-white">Feed Settings</span>
          </div>

          <div className="p-3 space-y-3 max-h-[calc(100vh-140px)] overflow-y-auto">
            {/* Two-column layout: Columns + View | Display */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <div className="space-y-3">
                {/* COLUMNS */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Columns</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none border ${cols === null ? "border-white/10 text-slate-500" : "border-cyan-500/30 text-cyan-300"}`}>{cols ?? "Auto"}</span>
                  </div>
                  <div className="flex items-center rounded-lg border border-white/10 overflow-hidden bg-black/20">
                    <button onClick={() => onColsChange(null)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${cols === null ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>Auto</button>
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => onColsChange(n)} className={`flex-1 px-2 py-1.5 text-[11px] font-medium border-l border-white/10 transition-colors ${cols === n ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>{n}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5 px-0.5">
                    <span className="text-[10px] font-mono text-slate-600">1</span>
                    <input type="range" min={1} max={6} step={1} value={cols ?? 4} onChange={e => onColsChange(+e.target.value)} className="flex-1 accent-cyan-400 cursor-pointer" />
                    <span className="text-[10px] font-mono text-slate-600">6</span>
                  </div>
                  <p className="text-[9.5px] text-slate-600 leading-relaxed"><span className="text-slate-400">Auto</span> adapts to your screen size.</p>
                </section>

                {/* VIEW */}
                <section className="border-t border-white/5 pt-3 space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">View</span>
                  <FeedToggleRow label="View Hidden" icon={<EyeOff size={11} />} on={showHidden} onChange={onShowHiddenChange} accent="amber" />
                  {showHidden && <p className="text-[9.5px] text-slate-600 leading-relaxed px-0.5">Showing only hidden generations — select them to unhide.</p>}
                </section>
              </div>

              {/* DISPLAY */}
              <section className="space-y-2 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:border-white/5 sm:pl-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display</span>
                <FeedToggleRow label="Full Size" on={fullSize} onChange={onFullSizeChange} />
                {fullSize && (
                  <div className="rounded-lg bg-black/20 border border-white/10 p-2.5 space-y-2">
                    <FeedOptionRow label="Layout">
                      <FeedSeg value={fullSizeLayout} onChange={onFullSizeLayoutChange} options={[{ value: "grid", label: "Grid" }, { value: "masonry", label: "Masonry" }]} />
                    </FeedOptionRow>
                    {fullSizeLayout === "masonry" && (
                      <FeedOptionRow label="Packing">
                        <FeedSeg value={masonryMode} onChange={onMasonryModeChange} options={[{ value: "rows", label: "Rows" }, { value: "flow", label: "Flow" }]} />
                      </FeedOptionRow>
                    )}
                    <FeedOptionRow label="Quality">
                      <FeedSeg value={tileRes} onChange={onTileResChange} options={[{ value: "thumb", label: "Thumbnail" }, { value: "full", label: "Full size", accent: "amber" }]} />
                    </FeedOptionRow>
                    <p className="text-[9.5px] text-slate-600 leading-relaxed pt-0.5">
                      {tileRes === "full"
                        ? <><span className="text-amber-400">Full size</span> loads originals — sharper, but long scrolls may reload the page.</>
                        : fullSizeLayout === "masonry"
                          ? <><span className="text-white">Rows</span> stays put as images load; <span className="text-white">Flow</span> fills each column top-to-bottom.</>
                          : <>Whole images at their natural shape — nothing cropped. Tap any for full resolution.</>}
                    </p>
                  </div>
                )}
              </section>
            </div>

            {/* ADMIN — inline feed filters (replaces the old Feed Filters modal) */}
            {isAdmin && (
              <section className="border-t border-white/5 pt-3 space-y-2">
                <button onClick={() => setAdminOpen(v => !v)} className="w-full flex items-center justify-between gap-2 group">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400/70 group-hover:text-violet-300 transition-colors">
                    <SlidersHorizontal size={11} />
                    Admin · Feed Filters
                    {adminFilterCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-200 text-[9px] font-bold leading-none">{adminFilterCount}</span>}
                  </span>
                  <ChevronDown size={12} className={`text-violet-400/70 transition-transform ${adminOpen ? "rotate-180" : ""}`} />
                </button>

                {!adminOpen && (
                  <p className="text-[9px] text-slate-600 leading-relaxed">Filters the feed via the dataset system — models, buckets, tags, users and more.</p>
                )}

                {adminOpen && (
                  <div className="space-y-2.5">
                    {loadError && <p className="text-[10px] text-red-400">{loadError}</p>}

                    {authNeeded ? (
                      /* Locked: inline unlock — same flow as the dataset admin pages */
                      <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Lock size={11} className="text-violet-400" />
                          <p className="text-[11px] font-semibold text-white">Admin unlock required</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="password"
                            value={passwordInput}
                            onChange={e => { setPasswordInput(e.target.value); setVerifyError(null) }}
                            onKeyDown={e => e.key === "Enter" && handleUnlock()}
                            placeholder="Admin password"
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
                          />
                          <button
                            onClick={handleUnlock}
                            disabled={verifying || !passwordInput.trim()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[11px] font-medium hover:bg-violet-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {verifying && <Loader2 size={10} className="animate-spin" />}
                            Unlock
                          </button>
                        </div>
                        {verifyError && <p className="text-[10px] text-red-400">{verifyError}</p>}
                      </div>
                    ) : (
                      <>
                        {/* Search + sort */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className={labelCls}>Search prompt</span>
                            <input value={draft.search} onChange={e => setF("search", e.target.value)} placeholder="Contains…" className={selectCls} />
                          </div>
                          <div>
                            <span className={labelCls}>Sort</span>
                            <select value={draft.sort} onChange={e => setF("sort", e.target.value)} className={selectCls}>
                              <option value="newest">Newest first</option>
                              <option value="oldest">Oldest first</option>
                              <option value="rating">Top rated</option>
                              <option value="cost">Highest cost</option>
                            </select>
                          </div>
                        </div>

                        {/* Media + training */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className={labelCls}>Media</span>
                            <select value={draft.mediaType} onChange={e => setF("mediaType", e.target.value)} className={selectCls}>
                              <option value="">Images & videos</option>
                              <option value="image">Images only</option>
                              <option value="video">Videos only</option>
                            </select>
                          </div>
                          <div>
                            <span className={labelCls}>Training</span>
                            <button onClick={() => setF("markedOnly", !draft.markedOnly)}
                              className={`w-full px-2 py-1.5 rounded-lg border text-[11px] transition-colors ${draft.markedOnly ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-slate-950 border-white/10 text-slate-500 hover:text-slate-300"}`}>
                              {draft.markedOnly ? "Marked only ✓" : "Any"}
                            </button>
                          </div>
                        </div>

                        {/* Model / aspect / quality / user — same multi-selects as /admin/dataset */}
                        {facets && (
                          <div>
                            <span className={labelCls}>Filter by</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <MultiFilterSelect
                                values={draft.models}
                                onChange={v => setF("models", v)}
                                placeholder="Model: any"
                                options={facets.models.map(m => ({ value: m.value, label: `${m.value} (${m.count})` }))}
                              />
                              <MultiFilterSelect
                                values={draft.aspects}
                                onChange={v => setF("aspects", v)}
                                placeholder="Aspect: any"
                                options={facets.aspects.map(a => ({ value: a.value, label: `${a.value} (${a.count})` }))}
                              />
                              <MultiFilterSelect
                                values={draft.qualities}
                                onChange={v => setF("qualities", v)}
                                placeholder="Quality: any"
                                options={facets.qualities.filter(q => q.value).map(q => ({ value: q.value!, label: `${q.value} (${q.count})` }))}
                              />
                              <MultiFilterSelect
                                values={draft.users.map(String)}
                                onChange={v => setF("users", v.map(Number))}
                                placeholder="User: any"
                                searchable
                                options={facets.users.map(u => ({ value: String(u.id), label: `${u.email} (${u.count})` }))}
                              />
                            </div>
                          </div>
                        )}

                        {/* More filters — refs / rating / caption / tags / bucket browser */}
                        <button onClick={() => setMoreOpen(v => !v)} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-white transition-colors">
                          <ChevronDown size={10} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} />
                          More filters — refs, rating, caption, tags, buckets
                        </button>

                        {moreOpen && (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div>
                                <span className={labelCls}>Refs</span>
                                <select value={draft.hasRefs} onChange={e => setF("hasRefs", e.target.value)} className={selectCls}>
                                  <option value="">Any</option>
                                  <option value="false">No refs</option>
                                  <option value="true">Has refs</option>
                                  <option value="1">1 ref</option>
                                  <option value="2">2 refs</option>
                                  <option value="3">3 refs</option>
                                  <option value="4+">4+ refs</option>
                                </select>
                              </div>
                              <div>
                                <span className={labelCls}>Rating</span>
                                <select value={draft.hasRating} onChange={e => setF("hasRating", e.target.value)} className={selectCls}>
                                  <option value="">Any</option>
                                  <option value="true">Rated</option>
                                  <option value="false">Unrated</option>
                                </select>
                              </div>
                              <div>
                                <span className={labelCls}>Caption</span>
                                <select value={draft.hasCaption} onChange={e => setF("hasCaption", e.target.value)} className={selectCls}>
                                  <option value="">Any</option>
                                  <option value="true">Has caption</option>
                                  <option value="false">No caption</option>
                                </select>
                              </div>
                              <div>
                                <span className={labelCls}>Tags</span>
                                <select value={draft.hasTag} onChange={e => setF("hasTag", e.target.value)} className={selectCls}>
                                  <option value="">Any</option>
                                  <option value="true">Has tags</option>
                                  <option value="false">No tags</option>
                                </select>
                              </div>
                              <div className="col-span-2 sm:col-span-1">
                                <span className={labelCls}>Specific tag</span>
                                <select value={draft.tagFilter} onChange={e => setF("tagFilter", e.target.value)} className={selectCls}>
                                  <option value="">Any tag</option>
                                  {facets?.tags.map(t => <option key={t.value} value={t.value}>{t.value} ({t.count})</option>)}
                                </select>
                              </div>
                            </div>

                            {/* Bucket / folder browser */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className={labelCls}>Filter by bucket</span>
                                {selectedBucket && (
                                  <button onClick={() => setF("bucketId", "")}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 text-[10px]">
                                    {selectedBucket.name} <X size={9} />
                                  </button>
                                )}
                              </div>
                              <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  {browsePath.length > 0 && (
                                    <button onClick={() => setBrowsePath(p => p.slice(0, -1))}
                                      className="p-0.5 rounded hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
                                      <ChevronLeft size={12} />
                                    </button>
                                  )}
                                  <span className="text-[10px] text-slate-600 font-mono truncate">
                                    {browsePath.length === 0 ? "Root" : browsePath.map(id => folders.find(f => f.id === id)?.name ?? "…").join(" / ")}
                                  </span>
                                </div>
                                {visibleFolders.length === 0 && visibleBuckets.length === 0 ? (
                                  <p className="text-[10px] text-slate-700 text-center py-3">No buckets here</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                                    {visibleFolders.map(f => (
                                      <button key={`f-${f.id}`} onClick={() => setBrowsePath(p => [...p, f.id])}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md border border-amber-500/25 bg-amber-500/5 text-amber-400 text-[10px] hover:border-amber-500/50 transition-colors">
                                        <BookMarked size={9} /> {f.name}
                                      </button>
                                    ))}
                                    {visibleBuckets.map(b => (
                                      <button key={`b-${b.id}`} onClick={() => setF("bucketId", draft.bucketId === String(b.id) ? "" : String(b.id))}
                                        className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${draft.bucketId === String(b.id) ? "bg-violet-500/20 border-violet-500/50 text-violet-200" : "border-violet-500/25 bg-violet-500/5 text-violet-400 hover:border-violet-500/50"}`}>
                                        {b.name} <span className="opacity-50">{b.count}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        )}

                        {/* Apply / clear */}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button onClick={() => { setDraft(EMPTY_ADMIN_FEED_FILTERS); setBrowsePath([]); onApplyAdminFilters?.(null) }}
                            className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-500 hover:text-white transition-all">
                            Clear all
                          </button>
                          <button onClick={() => { onApplyAdminFilters?.(draftEmpty ? null : draft); onToggle() }}
                            className="px-3.5 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30 text-[11px] font-medium transition-all">
                            Apply Filters
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// --- ADMIN FEED FILTERS ---
// Mirrors the filter system on /admin/dataset — same query params, same API.
type AdminFeedFilters = {
  models: string[]
  aspects: string[]
  qualities: string[]
  users: number[]
  hasRefs: string      // '' | 'true' | 'false' | '1' | '2' | '3' | '4+'
  hasRating: string    // '' | 'true' | 'false'
  hasCaption: string   // '' | 'true' | 'false'
  hasTag: string       // '' | 'true' | 'false'
  tagFilter: string
  mediaType: string    // '' | 'image' | 'video'
  markedOnly: boolean
  bucketId: string
  search: string
  sort: string         // 'newest' | 'oldest' | 'rating' | 'cost'
}

const EMPTY_ADMIN_FEED_FILTERS: AdminFeedFilters = {
  models: [], aspects: [], qualities: [], users: [],
  hasRefs: "", hasRating: "", hasCaption: "", hasTag: "", tagFilter: "",
  mediaType: "", markedOnly: false, bucketId: "", search: "", sort: "newest",
}

function countActiveAdminFeedFilters(f: AdminFeedFilters | null): number {
  if (!f) return 0
  return [
    f.models.length > 0, f.aspects.length > 0, f.qualities.length > 0, f.users.length > 0,
    !!f.hasRefs, !!f.hasRating, !!f.hasCaption, !!f.hasTag, !!f.tagFilter,
    !!f.mediaType, f.markedOnly, !!f.bucketId, !!f.search, f.sort !== "newest",
  ].filter(Boolean).length
}

function buildAdminFeedParams(f: AdminFeedFilters, page: number, limit: number): URLSearchParams {
  const p = new URLSearchParams()
  p.set("page", String(page))
  p.set("limit", String(limit))
  f.models.forEach(m => p.append("model", m))
  f.aspects.forEach(a => p.append("aspectRatio", a))
  f.qualities.forEach(q => p.append("quality", q))
  f.users.forEach(u => p.append("userId", String(u)))
  if (f.hasRefs)    p.set("hasRefs", f.hasRefs)
  if (f.hasRating)  p.set("hasRating", f.hasRating)
  if (f.hasCaption) p.set("hasCaption", f.hasCaption)
  if (f.hasTag)     p.set("hasTag", f.hasTag)
  if (f.tagFilter)  p.set("tagFilter", f.tagFilter)
  if (f.mediaType)  p.set("mediaType", f.mediaType)
  if (f.markedOnly) p.set("markedOnly", "true")
  if (f.bucketId)   p.set("bucketId", f.bucketId)
  if (f.search)     p.set("search", f.search)
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort)
  return p
}

const adminPasswordHeaders = (): Record<string, string> => {
  const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
  return pass ? { "x-admin-password": pass } : {}
}

const isVideoUrl = (url: string) => /\.(mp4|webm|mov|avi|mkv)($|\?|#)/i.test(url)

interface AdminFeedFacets {
  models:    { value: string; count: number }[]
  aspects:   { value: string; count: number }[]
  qualities: { value: string | null; count: number }[]
  tags:      { value: string; count: number }[]
  users:     { id: number; email: string; name: string | null; count: number }[]
}

// Multi-select filter dropdown — same control as /admin/dataset's filter bar
function MultiFilterSelect({ values, onChange, options, placeholder, searchable = false }: {
  values:       string[]
  onChange:     (v: string[]) => void
  options:      { value: string; label: string }[]
  placeholder:  string
  searchable?:  boolean
}) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState("")
  const ref               = useRef<HTMLDivElement>(null)
  const menuRef           = useRef<HTMLDivElement>(null)
  const searchRef         = useRef<HTMLInputElement>(null)
  // Menu is portaled to <body> so it can't be clipped by scrollable/overflow
  // containers (e.g. the admin filter modal). Position is computed from the
  // button rect; the menu flips upward when there isn't enough room below.
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; maxH: number }>({ left: 0, maxH: 340 })

  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false); setQuery("")
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 12
      const left = Math.min(r.left, window.innerWidth - 272)
      if (below >= 240 || below >= above) {
        setMenuPos({ top: r.bottom + 4, left, maxH: Math.max(180, Math.min(340, below)) })
      } else {
        setMenuPos({ bottom: window.innerHeight - r.top + 4, left, maxH: Math.max(180, Math.min(340, above)) })
      }
    }
  }, [open])

  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, searchable])

  function toggleValue(v: string) {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  }

  const active   = values.length > 0
  const filtered = searchable && query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all whitespace-nowrap
          ${active
            ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
            : "bg-white/[0.05] border-white/[0.08] text-slate-300 hover:text-white hover:border-white/20"}`}
      >
        {active ? `${placeholder.split(":")[0]}: ${values.length}` : placeholder}
        {active && (
          <span
            onClick={e => { e.stopPropagation(); onChange([]) }}
            className="ml-0.5 text-cyan-500 hover:text-white cursor-pointer"
            title="Clear"
          >
            <X size={9} />
          </span>
        )}
        <ChevronDown size={10} className={`text-slate-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          data-feed-filter-menu=""
          className="fixed z-[10020] w-[260px] rounded-xl bg-[#131320] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col"
          style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, maxHeight: menuPos.maxH }}
        >
          {searchable && (
            <div className="p-2 border-b border-white/[0.06] shrink-0">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    <X size={9} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="overflow-y-auto py-1 flex-1 min-h-0">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-slate-600 text-center">No results</p>
            ) : filtered.map(opt => {
              const checked = values.includes(opt.value)
              return (
                <button key={opt.value} onClick={() => toggleValue(opt.value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left
                    ${checked ? "text-cyan-300 bg-cyan-500/10" : "text-slate-400 hover:text-white hover:bg-white/[0.06]"}`}>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border transition-colors
                    ${checked ? "bg-cyan-500 border-cyan-500" : "border-white/20"}`}>
                    {checked && <span className="text-black text-[8px] font-bold leading-none">✓</span>}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>
          {values.length > 0 && (
            <div className="border-t border-white/[0.06] p-1 shrink-0">
              <button onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors rounded-lg hover:bg-white/[0.04]">
                Clear {values.length} selected
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// (No longer rendered — admin filters now live inline in FeedDropdown)
function AdminFeedFilterPanel({ initial, onApply, onClose }: {
  initial: AdminFeedFilters | null
  onApply: (filters: AdminFeedFilters | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<AdminFeedFilters>(initial ?? EMPTY_ADMIN_FEED_FILTERS)
  const [facets, setFacets] = useState<AdminFeedFacets | null>(null)
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [folders, setFolders] = useState<BucketFolder[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [browsePath, setBrowsePath] = useState<number[]>([])
  // Inline admin unlock — shown when the session has no valid admin password yet
  const [authNeeded, setAuthNeeded] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoadError(null)
    try {
      const headers = adminPasswordHeaders()
      const [dRes, bRes, fRes] = await Promise.all([
        fetch("/api/admin/dataset?page=1&limit=1", { headers }),
        fetch("/api/admin/buckets", { headers }),
        fetch("/api/admin/folders", { headers }),
      ])
      if (dRes.status === 401 || bRes.status === 401) {
        setAuthNeeded(true)
        return
      }
      setAuthNeeded(false)
      if (dRes.ok) { const d = await dRes.json(); setFacets(d.facets ?? null) }
      if (bRes.ok) setBuckets(await bRes.json())
      if (fRes.ok) setFolders(await fRes.json())
    } catch {
      setLoadError("Failed to load filter options — check your connection.")
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleUnlock = async () => {
    if (!passwordInput.trim() || verifying) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      if (res.ok) {
        try { sessionStorage.setItem("admin-password", passwordInput) } catch {}
        setPasswordInput("")
        setAuthNeeded(false)
        await loadAll()
      } else {
        const data = await res.json().catch(() => null)
        setVerifyError(data?.error || "Incorrect password")
      }
    } catch {
      setVerifyError("Verification failed — check your connection.")
    } finally {
      setVerifying(false)
    }
  }

  const set = <K extends keyof AdminFeedFilters>(k: K, v: AdminFeedFilters[K]) => setDraft(d => ({ ...d, [k]: v }))

  const isEmpty = JSON.stringify(draft) === JSON.stringify(EMPTY_ADMIN_FEED_FILTERS)
  const currentFolderId = browsePath.length > 0 ? browsePath[browsePath.length - 1] : null
  const visibleFolders = folders.filter(f => currentFolderId === null ? !f.parentId : f.parentId === currentFolderId)
  const visibleBuckets = buckets.filter(b => b.folderId === currentFolderId)
  const selectedBucket = draft.bucketId ? buckets.find(b => String(b.id) === draft.bucketId) : null

  const selectCls = "w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-white/25"
  const labelCls = "text-[9px] font-mono uppercase tracking-wider text-slate-600 mb-1 block"

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-[#0f0f1a] border border-white/[0.1] shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">Feed Filters</p>
            <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[9px] font-bold uppercase tracking-wider">Admin</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {loadError && <p className="text-xs text-red-400">{loadError}</p>}

          {/* Inline admin unlock */}
          {authNeeded && (
            <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Lock size={13} className="text-violet-400" />
                <p className="text-xs font-semibold text-white">Admin unlock required</p>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Enter your admin password to unlock filters and other admin features for this browser session.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={passwordInput}
                  onChange={e => { setPasswordInput(e.target.value); setVerifyError(null) }}
                  onKeyDown={e => e.key === "Enter" && handleUnlock()}
                  placeholder="Admin password"
                  autoFocus
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
                />
                <button
                  onClick={handleUnlock}
                  disabled={verifying || !passwordInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {verifying && <Loader2 size={11} className="animate-spin" />}
                  Unlock
                </button>
              </div>
              {verifyError && <p className="text-[11px] text-red-400">{verifyError}</p>}
            </div>
          )}

          {/* Search + sort + media + marked */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="col-span-2 sm:col-span-1">
              <span className={labelCls}>Search prompt</span>
              <input value={draft.search} onChange={e => set("search", e.target.value)} placeholder="Contains…"
                className={selectCls} />
            </div>
            <div>
              <span className={labelCls}>Sort</span>
              <select value={draft.sort} onChange={e => set("sort", e.target.value)} className={selectCls}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="rating">Top rated</option>
                <option value="cost">Highest cost</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Media</span>
              <select value={draft.mediaType} onChange={e => set("mediaType", e.target.value)} className={selectCls}>
                <option value="">Images & videos</option>
                <option value="image">Images only</option>
                <option value="video">Videos only</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Training</span>
              <button onClick={() => set("markedOnly", !draft.markedOnly)}
                className={`w-full px-2 py-1.5 rounded-lg border text-xs transition-colors ${draft.markedOnly ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-slate-950 border-white/10 text-slate-500 hover:text-slate-300"}`}>
                {draft.markedOnly ? "Marked only ✓" : "Any"}
              </button>
            </div>
          </div>

          {/* Refs / rating / caption / tags */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div>
              <span className={labelCls}>Refs</span>
              <select value={draft.hasRefs} onChange={e => set("hasRefs", e.target.value)} className={selectCls}>
                <option value="">Any</option>
                <option value="false">No refs</option>
                <option value="true">Has refs</option>
                <option value="1">1 ref</option>
                <option value="2">2 refs</option>
                <option value="3">3 refs</option>
                <option value="4+">4+ refs</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Rating</span>
              <select value={draft.hasRating} onChange={e => set("hasRating", e.target.value)} className={selectCls}>
                <option value="">Any</option>
                <option value="true">Rated</option>
                <option value="false">Unrated</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Caption</span>
              <select value={draft.hasCaption} onChange={e => set("hasCaption", e.target.value)} className={selectCls}>
                <option value="">Any</option>
                <option value="true">Has caption</option>
                <option value="false">No caption</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Tags</span>
              <select value={draft.hasTag} onChange={e => set("hasTag", e.target.value)} className={selectCls}>
                <option value="">Any</option>
                <option value="true">Has tags</option>
                <option value="false">No tags</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Specific tag</span>
              <select value={draft.tagFilter} onChange={e => set("tagFilter", e.target.value)} className={selectCls}>
                <option value="">Any tag</option>
                {facets?.tags.map(t => <option key={t.value} value={t.value}>{t.value} ({t.count})</option>)}
              </select>
            </div>
          </div>

          {/* Model / aspect / quality / user — dropdown multi-selects, same as /admin/dataset */}
          {facets && (
            <div>
              <span className={labelCls}>Filter by</span>
              <div className="flex flex-wrap items-center gap-2">
                <MultiFilterSelect
                  values={draft.models}
                  onChange={v => set("models", v)}
                  placeholder="Model: any"
                  options={facets.models.map(m => ({ value: m.value, label: `${m.value} (${m.count})` }))}
                />
                <MultiFilterSelect
                  values={draft.aspects}
                  onChange={v => set("aspects", v)}
                  placeholder="Aspect: any"
                  options={facets.aspects.map(a => ({ value: a.value, label: `${a.value} (${a.count})` }))}
                />
                <MultiFilterSelect
                  values={draft.qualities}
                  onChange={v => set("qualities", v)}
                  placeholder="Quality: any"
                  options={facets.qualities.filter(q => q.value).map(q => ({ value: q.value!, label: `${q.value} (${q.count})` }))}
                />
                <MultiFilterSelect
                  values={draft.users.map(String)}
                  onChange={v => set("users", v.map(Number))}
                  placeholder="User: any"
                  searchable
                  options={facets.users.map(u => ({ value: String(u.id), label: `${u.email} (${u.count})` }))}
                />
              </div>
            </div>
          )}

          {/* Bucket / folder browser */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={labelCls}>Filter by bucket</span>
              {selectedBucket && (
                <button onClick={() => set("bucketId", "")}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 text-[10px]">
                  {selectedBucket.name} <X size={9} />
                </button>
              )}
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                {browsePath.length > 0 && (
                  <button onClick={() => setBrowsePath(p => p.slice(0, -1))}
                    className="p-0.5 rounded hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
                    <ChevronLeft size={12} />
                  </button>
                )}
                <span className="text-[10px] text-slate-600 font-mono truncate">
                  {browsePath.length === 0 ? "Root" : browsePath.map(id => folders.find(f => f.id === id)?.name ?? "…").join(" / ")}
                </span>
              </div>
              {visibleFolders.length === 0 && visibleBuckets.length === 0 ? (
                <p className="text-[10px] text-slate-700 text-center py-3">No buckets here</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {visibleFolders.map(f => (
                    <button key={`f-${f.id}`} onClick={() => setBrowsePath(p => [...p, f.id])}
                      className="flex items-center gap-1 px-2 py-1 rounded-md border border-amber-500/25 bg-amber-500/5 text-amber-400 text-[10px] hover:border-amber-500/50 transition-colors">
                      <BookMarked size={9} /> {f.name}
                    </button>
                  ))}
                  {visibleBuckets.map(b => (
                    <button key={`b-${b.id}`} onClick={() => set("bucketId", draft.bucketId === String(b.id) ? "" : String(b.id))}
                      className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${draft.bucketId === String(b.id) ? "bg-violet-500/20 border-violet-500/50 text-violet-200" : "border-violet-500/25 bg-violet-500/5 text-violet-400 hover:border-violet-500/50"}`}>
                      {b.name} <span className="opacity-50">{b.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.07] flex items-center justify-between gap-2 shrink-0">
          <button onClick={() => { setDraft(EMPTY_ADMIN_FEED_FILTERS); setBrowsePath([]) }}
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-500 hover:text-white text-xs transition-all">
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] text-xs transition-all">
              Cancel
            </button>
            <button onClick={() => { onApply(isEmpty ? null : draft); onClose() }}
              className="px-4 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30 text-xs font-medium transition-all">
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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

// --- SHARED REF CONSENT MODAL ---
// Renders into document.body via portal so it escapes any parent stacking context
// (backdrop-filter / transform on ancestor elements trap position:fixed children).
function RefConsentModal({ onAgree, onDecline }: { onAgree: () => void; onDecline: () => void }) {
  const [checked, setChecked] = useState(false)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" onClick={onDecline}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0e0e18] shadow-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Lock size={16} className="text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">Before You Upload</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Please read and confirm the following</p>
          </div>
        </div>
        <div className="space-y-3 mb-5">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
            <p className="text-[12px] text-slate-300 leading-relaxed">
              I own the rights to any images I upload here, or have explicit permission to use them as references for AI generation.
            </p>
          </div>
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
            <p className="text-[12px] text-slate-300 leading-relaxed">
              If any image contains the likeness of a real person, I have obtained their consent to use it online.
            </p>
          </div>
        </div>

        {/* Checkbox — must be checked to enable I Agree */}
        <label className="flex items-start gap-2.5 mb-4 cursor-pointer group" onClick={e => e.stopPropagation()}>
          <div
            onClick={() => setChecked(c => !c)}
            className={`w-4 h-4 rounded shrink-0 mt-0.5 border flex items-center justify-center transition-all ${
              checked
                ? "bg-cyan-500 border-cyan-500"
                : "bg-white/[0.04] border-white/20 group-hover:border-white/40"
            }`}
          >
            {checked && <Check size={10} className="text-white" strokeWidth={3} />}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            I have read and agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-cyan-400 hover:underline">Terms of Service</a>,{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-cyan-400 hover:underline">Privacy Policy</a>, and{" "}
            <a href="/refund" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-cyan-400 hover:underline">Refund Policy</a>.
          </p>
        </label>

        <p className="text-[10px] text-slate-600 mb-4 leading-relaxed">
          This confirmation is required each session. Agreeing now unlocks the Refs section for the rest of your current session.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onDecline}
            className="flex-1 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (checked) onAgree() }}
            disabled={!checked}
            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all ${
              checked
                ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 cursor-pointer"
                : "bg-white/[0.03] border border-white/10 text-slate-600 cursor-not-allowed"
            }`}
          >
            I Agree
          </button>
        </div>
      </div>
    </div>,
    document.body
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
  onEditSave,
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
  onEditSave: (id: string, newUrl: string) => void
  disabled?: boolean
  libraryLimit?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [editMode, setEditMode] = useState(false)
  const [editingImage, setEditingImage] = useState<RefImage | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)
  const [showConsentModal, setShowConsentModal] = useState(false)
  const activeCount = disabled ? 0 : activeIds.filter((id) => library.some((img) => img.id === id)).length
  const atLimit = !disabled && modelMaxRefs > 0 && activeCount >= modelMaxRefs

  useEffect(() => {
    setConsentGiven(sessionStorage.getItem("ref-rights-consent") === "true")
  }, [])

  // Exit select/edit mode + clear errors when dropdown closes
  useEffect(() => {
    if (!open) {
      setSelectMode(false)
      setSelectedForDelete(new Set())
      setEditMode(false)
      setUploadError(null)
    }
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // The ref editor modal is portaled to document.body, so clicks inside it
      // register as "outside" the dropdown — don't close the dropdown under it
      if (editingImage) return
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open) onToggle()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, onToggle, editingImage])

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

  const handleButtonClick = () => {
    if (consentGiven) {
      onToggle()
    } else {
      setShowConsentModal(true)
    }
  }

  const handleConsentAgree = () => {
    sessionStorage.setItem("ref-rights-consent", "true")
    setConsentGiven(true)
    setShowConsentModal(false)
    onToggle()
  }

  const handleConsentDecline = () => {
    setShowConsentModal(false)
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
        onClick={handleButtonClick}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all ${
          open ? "bg-white/10 text-white" : consentGiven ? "text-slate-400 hover:text-white hover:bg-white/5" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
        }`}
      >
        {consentGiven ? <ImagePlus size={15} /> : <Lock size={13} className="text-slate-600" />}
        Refs
        {consentGiven && activeCount > 0 && (
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
            </div>
          </div>

          {/* Action buttons row */}
          {library.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5">
              {!selectMode && !editMode && (
                <>
                  <button
                    onClick={() => setSelectMode(true)}
                    className="flex-1 text-[10px] font-bold text-slate-300 hover:text-white transition-all h-7 rounded-md border border-white/15 bg-white/6 hover:bg-white/10 hover:border-white/25 whitespace-nowrap flex items-center justify-center"
                  >
                    Select
                  </button>
                  <button
                    onClick={() => setEditMode(true)}
                    className="flex-1 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-all h-7 rounded-md border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 hover:border-cyan-500/50 whitespace-nowrap flex items-center justify-center"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="flex-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-all h-7 rounded-md border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 hover:border-rose-500/50 whitespace-nowrap flex items-center justify-center"
                  >
                    Clear all
                  </button>
                </>
              )}
              {(selectMode || editMode) && (
                <button
                  onClick={() => { setSelectMode(false); setSelectedForDelete(new Set()); setEditMode(false) }}
                  className="flex-1 text-[10px] font-bold text-slate-400 hover:text-white transition-all h-7 rounded-md border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] flex items-center justify-center"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Description */}
          {!selectMode && !editMode && (
            <div className="px-4 py-2.5 border-b border-white/5 bg-white/2">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Upload images here to use as visual references. <span className="text-white">Tap an image to toggle it on/off</span> — only <span className="text-cyan-400">active</span> images are sent with your generation. Your library is saved between sessions.
              </p>
            </div>
          )}

          {/* Upload button — hidden in select/edit mode */}
          {!selectMode && !editMode && (
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

          {/* Edit mode hint */}
          {editMode && (
            <div className="px-4 py-2 border-b border-white/5 bg-cyan-500/5">
              <p className="text-[10px] text-cyan-400/80">Tap an image to open the editor — crop, draw, blur and more</p>
            </div>
          )}

          {/* Disabled notice for video mode */}
          {!selectMode && !editMode && disabled && (
            <div className="px-4 py-2 border-b border-white/5 bg-slate-800/60">
              <p className="text-[10px] text-slate-400">Reference images are not used by video models. Upload start/end frames through the video configuration panel instead.</p>
            </div>
          )}

          {/* Model support notice */}
          {!selectMode && !editMode && !disabled && modelMaxRefs === 0 && (
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
                  const isActive = !selectMode && !editMode && activeIds.includes(img.id)
                  const isDisabled = !selectMode && !editMode && !isActive && atLimit
                  const isSelectedForDelete = selectMode && selectedForDelete.has(img.id)
                  return (
                    <div key={img.id} className="relative group aspect-square">
                      <button
                        onClick={() => editMode ? setEditingImage(img) : selectMode ? toggleSelectForDelete(img.id) : handleToggle(img)}
                        disabled={!selectMode && !editMode && (isDisabled || disabled)}
                        title={
                          editMode ? "Click to edit"
                            : selectMode
                            ? isSelectedForDelete ? "Click to deselect" : "Click to select for deletion"
                            : disabled ? "Not available for video models"
                            : isDisabled ? `Limit reached (${modelMaxRefs})`
                            : isActive ? "Click to deactivate" : "Click to activate"
                        }
                        className={`w-full h-full rounded-md overflow-hidden border-2 transition-all ${
                          editMode
                            ? "border-transparent hover:border-cyan-400/70"
                            : selectMode
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
                        {/* Edit hint overlay (edit mode) */}
                        {editMode && (
                          <div className="absolute inset-0 rounded-md bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <Pencil size={12} className="text-white" />
                          </div>
                        )}
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
                      {!selectMode && !editMode && (
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

      {showConsentModal && (
        <RefConsentModal onAgree={handleConsentAgree} onDecline={handleConsentDecline} />
      )}

      {/* Ref image editor — opened from edit mode */}
      {editingImage && (
        <RefImageEditorModal
          image={editingImage}
          onApply={(newUrl) => {
            onEditSave(editingImage.id, newUrl)
            setEditingImage(null)
          }}
          onClose={() => setEditingImage(null)}
        />
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
          {/* Mobile: panes stack and the whole body scrolls; sm+: side-by-side with per-pane scroll */}
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] divide-y sm:divide-y-0 sm:divide-x divide-white/5 max-h-[calc(100vh-170px)] overflow-y-auto sm:max-h-none sm:overflow-visible">

            {/* LEFT: AI Prompting */}
            <div className="p-4 space-y-3 sm:max-h-[520px] sm:overflow-y-auto">
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
            <div className="p-4 sm:max-h-[520px] sm:overflow-y-auto">
              <div className="flex items-center gap-1.5 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 shrink-0" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Saved Prompts</p>
                <span className="text-[9px] text-slate-600 font-mono">· 16 slots</span>
              </div>
              {/* 2 columns on phones so the Copy/Use buttons fit inside each slot */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
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
function GridImage({ src, alt, onClick, imageId, directUrl, thumbUrl, aspectRatio, fullRes = false, selectMode, selected, onSelect, fullWidth = false, isVideo = false, adminThumb = false }: {
  src: string; alt: string; onClick?: () => void; imageId?: number; directUrl?: string
  // thumbUrl: a pre-generated thumbnail on public R2 (CDN-cached) — used directly so
  // the feed skips the per-request resize + full-image download
  thumbUrl?: string | null
  // aspectRatio: the image's known ratio ("2:3", "16:9", "1024x1536"…). In Full Size
  // mode it's applied to the tile up front so the correct height is reserved before the
  // image loads — no layout jump — and the tile keeps its height even when windowed out.
  aspectRatio?: string
  // fullRes: in Full Size mode, load the full-resolution original instead of the
  // lightweight thumbnail (sharper but heavy — can reload the tab on long scrolls)
  fullRes?: boolean
  selectMode?: boolean; selected?: boolean; onSelect?: (id: number) => void
  // fullWidth (Full Size mode): show the entire image at its natural aspect ratio,
  // loading the full-resolution file instead of the square-cropped thumbnail
  fullWidth?: boolean
  // isVideo: render a muted <video> frame instead of <img> (admin-filtered feed can include videos)
  isVideo?: boolean
  // adminThumb (admin-filtered feed): /api/images/[id] only serves the signed-in user's own
  // images, so cross-user thumbnails 404 — use the admin dataset thumb route instead
  adminThumb?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  // directUrl: skip the proxy and load directly (used for just-completed images where the
  // blob URL is already known — avoids the DB-auth → blob-fetch → sharp chain adding delay)
  const thumbSrc = thumbUrl
    ? thumbUrl
    : adminThumb && imageId
    ? `/api/admin/dataset/thumb/${imageId}`
    : directUrl || (imageId ? `/api/images/${imageId}?thumb=1` : src)
  const fullSrc = directUrl || src
  // Full Size mode: reserve the tile's height from the known ratio ("2:3" → "2/3",
  // "1024x1536" → "1024/1536") so images don't shove the layout when they pop in.
  // Null → natural height.
  const arCss = fullWidth && aspectRatio && aspectRatio !== "auto"
    ? aspectRatio.replace(":", "/").replace("x", "/")
    : null
  const handleClick = () => {
    if (selectMode && imageId !== undefined) { onSelect?.(imageId); return }
    onClick?.()
  }
  return (
    <div
      className={`${fullWidth ? "" : "aspect-square"} bg-slate-800 overflow-hidden relative ${fullWidth && !loaded && !arCss ? "min-h-40" : ""} ${onClick || selectMode ? "cursor-pointer group" : ""} ${selected ? "ring-2 ring-cyan-400 ring-inset" : ""}`}
      style={arCss ? { aspectRatio: arCss } : undefined}
      onClick={handleClick}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 animate-pulse" />
      )}
      {/* Tiles are never unmounted; native lazy-loading defers the fetch until the
          tile nears the viewport, and once loaded the image stays put — so scrolling
          back never tears the layout apart. */}
      {isVideo ? (
        <video
          src={`${fullSrc}${fullSrc.includes("#") ? "" : "#t=0.001"}`}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          className={`${fullWidth ? (arCss ? "w-full h-full object-cover" : "w-full h-auto block") : "w-full h-full object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-80 transition-opacity" : ""} ${selected ? "opacity-80" : ""}`}
        />
      ) : (
        <img
          // Feed tiles always use the lightweight thumbnail (shows the whole image at its
          // natural shape). Loading full-resolution originals into every mounted tile
          // exhausts iPad Safari's memory on long scrolls and reloads the tab, so the
          // default is the thumbnail; Full Size + fullRes opts into the originals.
          src={fullWidth && fullRes ? fullSrc : thumbSrc}
          alt={alt}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`${fullWidth ? (arCss ? "w-full h-full object-cover" : "w-full h-auto block") : "w-full h-full object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${(onClick && !selectMode) ? "group-hover:opacity-80 transition-opacity" : ""} ${selected ? "opacity-80" : ""}`}
        />
      )}
      {isVideo && loaded && (
        <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-[8px] font-mono text-white/70 pointer-events-none">VID</div>
      )}
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

// --- AI DISCLAIMER ---
function AIDisclaimer() {
  return (
    <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-amber-500/[0.05] border border-amber-500/[0.15]">
      <Sparkles size={10} className="text-amber-400/60 shrink-0 mt-0.5" />
      <p className="text-[10px] text-amber-400/60 leading-relaxed">
        <span className="font-semibold text-amber-400/80">AI-Generated Content</span> — This content was produced by artificial intelligence and may not represent real people, places, or events.
      </p>
    </div>
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
            <AIDisclaimer />
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
// --- DETAIL MODAL LAYOUT (info panel position) ---
type InfoPos = "left" | "right" | "top" | "bottom" | "hidden"

// Card flex direction per position. Left/right apply from sm: up (side-by-side
// is too cramped on phones — they fall back to the stacked layout); top/bottom
// work at every size. Column modes pin the card height so the media pane
// (flex-1) has a real height to fill.
const INFO_POS_CARD_CLS: Record<InfoPos, string> = {
  right:  "sm:h-auto sm:max-h-[90vh] flex-col sm:flex-row",
  left:   "sm:h-auto sm:max-h-[90vh] flex-col sm:flex-row-reverse",
  bottom: "sm:h-[90vh] flex-col",
  top:    "sm:h-[90vh] flex-col-reverse",
  // Pinned height so the media pane has a real box to contain the image —
  // with h-auto the image renders unbounded and gets clipped at 90vh
  hidden: "sm:h-[90vh] flex-col",
}
const INFO_POS_PANEL_CLS: Record<InfoPos, string> = {
  right:  "sm:w-72 border-t border-white/8 sm:border-t-0 sm:border-l sm:border-white/8",
  left:   "sm:w-72 border-t border-white/8 sm:border-t-0 sm:border-r sm:border-white/8",
  // Compact bands — the media keeps priority; info content scrolls within the band
  bottom: "border-t border-white/8 sm:max-h-[280px]",
  top:    "border-b border-white/8 max-h-[45vh] sm:max-h-[280px]",
  hidden: "", // panel is not rendered
}

function useInfoPanelPos(): [InfoPos, (p: InfoPos) => void, () => void] {
  const [pos, setPos] = useState<InfoPos>("right")
  useEffect(() => {
    try {
      const v = localStorage.getItem("pv2-detail-info-pos") as InfoPos | null
      if (v && ["left", "right", "top", "bottom", "hidden"].includes(v)) setPos(v)
    } catch {}
  }, [])
  const update = (p: InfoPos) => {
    setPos(prev => {
      // Remember the last visible position so "show again" restores it
      if (p === "hidden" && prev !== "hidden") {
        try { localStorage.setItem("pv2-detail-info-pos-last", prev) } catch {}
      }
      return p
    })
    try { localStorage.setItem("pv2-detail-info-pos", p) } catch {}
  }
  const restore = () => {
    let last: InfoPos = "right"
    try {
      const v = localStorage.getItem("pv2-detail-info-pos-last") as InfoPos | null
      if (v && ["left", "right", "top", "bottom"].includes(v)) last = v
    } catch {}
    update(last)
  }
  return [pos, update, restore]
}

function InfoPosSwitcher({ pos, onChange }: { pos: InfoPos; onChange: (p: InfoPos) => void }) {
  const options: [InfoPos, React.ComponentType<{ size?: number | string }>][] = [
    ["left", PanelLeft], ["right", PanelRight], ["top", PanelTop], ["bottom", PanelBottom], ["hidden", EyeOff],
  ]
  // pr-12 reserves room for the card's absolute close ✕ whenever this row
  // sits in the card's top-right corner (info on top, or info on the right)
  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0 ${pos === "top" ? "pr-12" : pos === "right" ? "sm:pr-12" : ""}`}>
      <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">Info Panel</span>
      <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
        {options.map(([p, Icon]) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            title={p === "hidden" ? "Hide info panel" : `Show info panel ${p === "left" ? "on the left" : p === "right" ? "on the right" : p === "top" ? "above the image" : "below the image"}`}
            className={`px-2 py-1 transition-colors ${pos === p ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}

// --- MODAL TOUCH GESTURES ---
const SWIPE_NAV_THRESHOLD = 50 // px of horizontal travel required to navigate

// Swipe-to-navigate for the detail modals. Multi-touch-safe: any gesture that
// ever involves 2+ fingers (a pinch) is ignored entirely, and swipes only fire
// when the motion is clearly horizontal — vertical/diagonal scrolls never
// navigate. Returns a live dragX so the card can follow the finger.
function useModalSwipeNav({ hasPrev, hasNext, onPrev, onNext, disabled = false }: {
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
}) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const multiTouchRef = useRef(false)
  const axisLockRef = useRef<"h" | "v" | null>(null)
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (animTimerRef.current) clearTimeout(animTimerRef.current) }, [])

  const resetGesture = () => {
    startRef.current = null
    axisLockRef.current = null
    multiTouchRef.current = false
    setDragging(false)
    setDragX(0)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      // Second finger landed — this is a pinch, not a swipe
      multiTouchRef.current = true
      setDragX(0)
      setDragging(false)
      return
    }
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    multiTouchRef.current = false
    axisLockRef.current = null
    setDragging(true)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      multiTouchRef.current = true
      setDragX(0)
      return
    }
    if (multiTouchRef.current || disabled || !startRef.current) return
    const dx = e.touches[0].clientX - startRef.current.x
    const dy = e.touches[0].clientY - startRef.current.y
    if (!axisLockRef.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      // Decide once per gesture: clearly horizontal, or locked out as vertical
      axisLockRef.current = Math.abs(dx) > Math.abs(dy) * 1.5 ? "h" : "v"
    }
    if (axisLockRef.current !== "h") return
    // Rubber-band resistance when there's nothing to navigate to in that direction
    const hasTarget = dx < 0 ? hasNext : hasPrev
    setDragX(hasTarget ? dx : dx / 3)
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length > 0) return // wait for the last finger to lift
    const start = startRef.current
    const wasMulti = multiTouchRef.current
    const lock = axisLockRef.current
    startRef.current = null
    multiTouchRef.current = false
    axisLockRef.current = null
    setDragging(false)
    if (wasMulti || disabled || !start || lock !== "h") { setDragX(0); return }
    const dx = e.changedTouches[0].clientX - start.x
    if (Math.abs(dx) < SWIPE_NAV_THRESHOLD) { setDragX(0); return }
    const goNext = dx < 0
    if ((goNext && !hasNext) || (!goNext && !hasPrev)) { setDragX(0); return }
    // Two-phase slide: finish the slide out, swap content, slide in from the other side
    const w = typeof window !== "undefined" ? window.innerWidth : 800
    setDragX(goNext ? -w : w)
    animTimerRef.current = setTimeout(() => {
      if (goNext) onNext(); else onPrev()
      setDragging(true) // kills the transition for the off-screen jump
      setDragX(goNext ? w * 0.35 : -w * 0.35)
      animTimerRef.current = setTimeout(() => {
        setDragging(false)
        setDragX(0)
      }, 30)
    }, 160)
  }

  return {
    swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: resetGesture },
    cardStyle: {
      transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
      transition: dragging ? "none" : "transform 200ms ease-out",
      touchAction: "pan-y" as const,
    },
  }
}

// Pinch-to-zoom + pan + double-tap for the image detail modal. Applied to the
// media pane (which gets touch-action: none so iOS doesn't page-zoom there).
// While zoomed (scale > 1) the caller should disable swipe navigation.
function usePinchZoom(resetKey: unknown) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [smooth, setSmooth] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number; offX: number; offY: number } | null>(null)
  const panRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null)
  const tapStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastTouchEndRef = useRef(0)

  // New image (or navigation) — reset zoom
  useEffect(() => { setScale(1); setOffset({ x: 0, y: 0 }); setSmooth(false) }, [resetKey])

  const clampOffset = (ox: number, oy: number, s: number) => {
    const pane = paneRef.current
    const maxX = pane ? (pane.clientWidth * (s - 1)) / 2 : 0
    const maxY = pane ? (pane.clientHeight * (s - 1)) / 2 : 0
    return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) }
  }
  const touchDist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const touchMid = (t: React.TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

  const onTouchStart = (e: React.TouchEvent) => {
    setSmooth(false)
    if (e.touches.length === 2) {
      const m = touchMid(e.touches)
      pinchRef.current = { dist: touchDist(e.touches), scale, midX: m.x, midY: m.y, offX: offset.x, offY: offset.y }
      panRef.current = null
      tapStartRef.current = null
    } else if (e.touches.length === 1) {
      tapStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      if (scale > 1) {
        panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, offX: offset.x, offY: offset.y }
      }
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const p = pinchRef.current
      const s = Math.max(1, Math.min(4, p.scale * (touchDist(e.touches) / p.dist)))
      const m = touchMid(e.touches)
      setScale(s)
      setOffset(clampOffset(p.offX + (m.x - p.midX), p.offY + (m.y - p.midY), s))
    } else if (e.touches.length === 1 && panRef.current && scale > 1) {
      const p = panRef.current
      setOffset(clampOffset(p.offX + (e.touches[0].clientX - p.x), p.offY + (e.touches[0].clientY - p.y), scale))
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null
    if (e.touches.length > 0) return
    panRef.current = null
    lastTouchEndRef.current = Date.now()
    // Snap back to 1 if the pinch ended barely zoomed
    if (scale !== 1 && scale < 1.05) {
      setSmooth(true); setScale(1); setOffset({ x: 0, y: 0 })
    }
    // Double-tap: two quick stationary taps → toggle zoom around the tap point
    const t = e.changedTouches[0]
    const wasTap = tapStartRef.current &&
      Math.abs(t.clientX - tapStartRef.current.x) < 10 &&
      Math.abs(t.clientY - tapStartRef.current.y) < 10
    tapStartRef.current = null
    if (!wasTap) { lastTapRef.current = null; return }
    const now = Date.now()
    const last = lastTapRef.current
    if (last && now - last.t < 300 && Math.abs(t.clientX - last.x) < 30 && Math.abs(t.clientY - last.y) < 30) {
      lastTapRef.current = null
      setSmooth(true)
      if (scale > 1) {
        setScale(1); setOffset({ x: 0, y: 0 })
      } else {
        const pane = paneRef.current
        const s = 2.5
        setScale(s)
        if (pane) {
          const r = pane.getBoundingClientRect()
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2
          setOffset(clampOffset((cx - t.clientX) * (s - 1), (cy - t.clientY) * (s - 1), s))
        }
      }
    } else {
      lastTapRef.current = { t: now, x: t.clientX, y: t.clientY }
    }
  }

  const onTouchCancel = () => {
    pinchRef.current = null
    panRef.current = null
    tapStartRef.current = null
  }

  // Touch taps should never trigger the desktop click action (open in new tab) —
  // on touch, tapping is part of the double-tap zoom gesture instead
  const shouldSuppressClick = () => Date.now() - lastTouchEndRef.current < 500

  return {
    scale,
    paneRef,
    shouldSuppressClick,
    zoomHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    paneStyle: { touchAction: "none" as const },
    imgStyle: {
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
      transition: smooth ? "transform 200ms ease-out" : "none",
    },
  }
}

function ImageDetailModal({
  image,
  onClose,
  onRescan,
  onUsePrompt,
  onAddRef,
  navList,
  navIndex,
  onNavigate,
}: {
  image: ImageItem
  onClose: () => void
  onRescan: (image: ImageItem) => void
  onUsePrompt: (text: string) => void
  onAddRef: (url: string, r2Key?: string) => void
  navList?: ImageItem[]
  navIndex?: number
  onNavigate?: (item: ImageItem) => void
}) {
  const [copied, setCopied] = useState(false)
  const [addedRef, setAddedRef] = useState(false)
  const [showRefConsent, setShowRefConsent] = useState(false)
  const [consentGiven, setConsentGiven] = useState(() =>
    typeof window !== 'undefined' && sessionStorage.getItem("ref-rights-consent") === "true"
  )

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

  // Close on Escape; navigate on arrow keys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "ArrowLeft" && navList && navIndex !== undefined && navIndex > 0) {
        onNavigate?.(navList[navIndex - 1])
      }
      if (e.key === "ArrowRight" && navList && navIndex !== undefined && navIndex < navList.length - 1) {
        onNavigate?.(navList[navIndex + 1])
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, navList, navIndex, onNavigate])

  const hasPrev = navList && navIndex !== undefined && navIndex > 0
  const hasNext = navList && navIndex !== undefined && navIndex >= 0 && navIndex < navList.length - 1

  const [infoPos, setInfoPos, restoreInfoPos] = useInfoPanelPos()
  // Top/bottom modes render the info as a compact horizontal band so the image keeps priority
  const horiz = infoPos === "top" || infoPos === "bottom"

  // Pinch zoom on the image; swipe nav pauses while zoomed
  const zoom = usePinchZoom(image.imageUrl)
  const { swipeHandlers, cardStyle } = useModalSwipeNav({
    hasPrev: !!hasPrev,
    hasNext: !!hasNext,
    onPrev: () => onNavigate?.(navList![navIndex! - 1]),
    onNext: () => onNavigate?.(navList![navIndex! + 1]),
    disabled: zoom.scale > 1,
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Desktop prev/next arrows — outside the card, in the backdrop margins */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate?.(navList![navIndex! - 1]) }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-9 h-9 rounded-full bg-black/60 items-center justify-center text-slate-400 hover:text-white hover:bg-black/80 transition-all border border-white/10"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate?.(navList![navIndex! + 1]) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-9 h-9 rounded-full bg-black/60 items-center justify-center text-slate-400 hover:text-white hover:bg-black/80 transition-all border border-white/10"
        >
          <ChevronRight size={18} />
        </button>
      )}
      <div
        className={`relative w-full h-full sm:max-w-4xl sm:rounded-2xl border-0 sm:border border-white/10 bg-slate-950 sm:bg-slate-950/95 shadow-2xl overflow-hidden flex ${INFO_POS_CARD_CLS[infoPos]}`}
        onClick={(e) => e.stopPropagation()}
        style={cardStyle}
        {...swipeHandlers}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        >
          <X size={13} />
        </button>

        {/* Restore info panel — shown only while it's hidden */}
        {infoPos === "hidden" && (
          <button
            onClick={restoreInfoPos}
            title="Show info panel"
            className="absolute top-3 right-12 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
          >
            <Eye size={13} />
          </button>
        )}

        {/* Image — or failed state */}
        <div
          ref={zoom.paneRef}
          className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0"
          {...(!image.failed ? { ...zoom.zoomHandlers, style: zoom.paneStyle } : {})}
        >
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
              className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90"
              title="Open full size"
              style={zoom.imgStyle}
              onClick={() => { if (zoom.shouldSuppressClick()) return; window.open(image.imageUrl, "_blank") }}
            />
          )}
        </div>

        {/* Info panel */}
        {infoPos !== "hidden" && (
        <div className={`flex flex-col shrink-0 ${INFO_POS_PANEL_CLS[infoPos]}`}>

          {/* Layout switcher */}
          <InfoPosSwitcher pos={infoPos} onChange={setInfoPos} />

          {/* Top/bottom band: info sections + actions sit side-by-side (sm+) */}
          <div className={horiz ? "contents sm:flex sm:flex-row sm:flex-1 sm:min-h-0" : "contents"}>

          {/* Desktop: full scrollable info */}
          <div className={horiz
            ? "hidden sm:flex flex-wrap content-start gap-x-8 gap-y-3 flex-1 overflow-y-auto p-4 min-h-0"
            : "hidden sm:block flex-1 overflow-y-auto p-4 space-y-4 min-h-0"}>
            <div className={horiz ? "flex-1 min-w-[240px] max-w-xl" : ""}>
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
          <div className={horiz
            ? "p-3 sm:p-4 border-t sm:border-t-0 sm:border-l border-white/8 space-y-2 shrink-0 sm:w-64 sm:overflow-y-auto"
            : "p-3 sm:p-4 border-t border-white/8 space-y-2 shrink-0"}>
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
                      if (!consentGiven) { setShowRefConsent(true); return }
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
            <AIDisclaimer />
          </div>

          </div>{/* end top/bottom band wrapper */}
        </div>
        )}
      </div>
      {showRefConsent && (
        <RefConsentModal
          onAgree={() => {
            sessionStorage.setItem("ref-rights-consent", "true")
            setConsentGiven(true)
            setShowRefConsent(false)
            onAddRef(image.imageUrl, image.r2Key)
            setAddedRef(true)
            setTimeout(() => setAddedRef(false), 2000)
          }}
          onDecline={() => setShowRefConsent(false)}
        />
      )}
    </div>
  )
}

// --- VIDEO DETAIL MODAL ---
function VideoDetailModal({
  video,
  onClose,
  onRescan,
  onUsePrompt,
  navList,
  navIndex,
  onNavigate,
}: {
  video: VideoDetailData
  onClose: () => void
  onRescan: (video: VideoDetailData) => void
  onUsePrompt: (text: string) => void
  navList?: VideoDetailData[]
  navIndex?: number
  onNavigate?: (item: VideoDetailData) => void
}) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const modelName = getModelDisplayName(video.model)
  const formattedDate = video.createdAt
    ? new Date(video.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "ArrowLeft" && navList && navIndex !== undefined && navIndex > 0) {
        onNavigate?.(navList[navIndex - 1])
      }
      if (e.key === "ArrowRight" && navList && navIndex !== undefined && navIndex < navList.length - 1) {
        onNavigate?.(navList[navIndex + 1])
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, navList, navIndex, onNavigate])

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

  const hasPrev = navList && navIndex !== undefined && navIndex > 0
  const hasNext = navList && navIndex !== undefined && navIndex >= 0 && navIndex < navList.length - 1

  const [infoPos, setInfoPos, restoreInfoPos] = useInfoPanelPos()
  // Top/bottom modes render the info as a compact horizontal band so the video keeps priority
  const horiz = infoPos === "top" || infoPos === "bottom"

  const { swipeHandlers, cardStyle } = useModalSwipeNav({
    hasPrev: !!hasPrev,
    hasNext: !!hasNext,
    onPrev: () => onNavigate?.(navList![navIndex! - 1]),
    onNext: () => onNavigate?.(navList![navIndex! + 1]),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Desktop prev/next arrows */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate?.(navList![navIndex! - 1]) }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-9 h-9 rounded-full bg-black/60 items-center justify-center text-slate-400 hover:text-white hover:bg-black/80 transition-all border border-white/10"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate?.(navList![navIndex! + 1]) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-9 h-9 rounded-full bg-black/60 items-center justify-center text-slate-400 hover:text-white hover:bg-black/80 transition-all border border-white/10"
        >
          <ChevronRight size={18} />
        </button>
      )}
      <div
        className={`relative w-full h-full sm:max-w-4xl sm:rounded-2xl border-0 sm:border border-white/10 bg-slate-950 sm:bg-slate-950/95 shadow-2xl overflow-hidden flex ${INFO_POS_CARD_CLS[infoPos]}`}
        onClick={(e) => e.stopPropagation()}
        style={cardStyle}
        {...swipeHandlers}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        >
          <X size={13} />
        </button>

        {/* Restore info panel — shown only while it's hidden */}
        {infoPos === "hidden" && (
          <button
            onClick={restoreInfoPos}
            title="Show info panel"
            className="absolute top-3 right-12 z-10 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
          >
            <Eye size={13} />
          </button>
        )}

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
        {infoPos !== "hidden" && (
        <div className={`flex flex-col shrink-0 ${INFO_POS_PANEL_CLS[infoPos]}`}>

          {/* Layout switcher */}
          <InfoPosSwitcher pos={infoPos} onChange={setInfoPos} />

          {/* Top/bottom band: info sections + actions sit side-by-side (sm+) */}
          <div className={horiz ? "contents sm:flex sm:flex-row sm:flex-1 sm:min-h-0" : "contents"}>

          {/* Desktop: full info */}
          <div className={horiz
            ? "hidden sm:flex flex-wrap content-start gap-x-8 gap-y-3 flex-1 overflow-y-auto p-4 min-h-0"
            : "hidden sm:block flex-1 overflow-y-auto p-4 space-y-4 min-h-0"}>
            <div className={horiz ? "flex-1 min-w-[240px] max-w-xl" : ""}>
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
          <div className={horiz
            ? "p-3 sm:p-4 border-t sm:border-t-0 sm:border-l border-white/8 space-y-2 shrink-0 sm:w-64 sm:overflow-y-auto"
            : "p-3 sm:p-4 border-t border-white/8 space-y-2 shrink-0"}>
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
            <AIDisclaimer />
          </div>

          </div>{/* end top/bottom band wrapper */}
        </div>
        )}
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
  onNavListChange,
  cols = null,
  fullSize = false,
  fullSizeLayout = "grid",
  masonryMode = "rows",
  tileRes = "thumb",
  adminFilters = null,
  showHidden = false,
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
  onNavListChange?: (list: ImageItem[]) => void
  cols?: number | null
  fullSize?: boolean
  fullSizeLayout?: "grid" | "masonry"
  masonryMode?: "flow" | "rows"
  tileRes?: "thumb" | "full"
  adminFilters?: AdminFeedFilters | null
  showHidden?: boolean
}) {
  const fullRes = tileRes === "full"
  // Responsive column count for JS "Rows" masonry (auto = 2 on mobile, 4 on desktop)
  const [autoCols, setAutoCols] = useState(4)
  useEffect(() => {
    const compute = () => setAutoCols(window.innerWidth < 640 ? 2 : 4)
    compute()
    window.addEventListener("resize", compute)
    return () => window.removeEventListener("resize", compute)
  }, [])
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const pageRef = useRef(1) // still used by the admin-filters (dataset) path
  // Cursor for keyset pagination of the my-images feed — constant-speed at any depth
  const cursorRef = useRef<{ before: string; beforeId: number } | null>(null)
  const hasMoreRef = useRef(true)
  const pageLimitRef = useRef(typeof window !== "undefined" && window.innerWidth < 640 ? 8 : 24)
  // Bumped whenever the filter set changes — in-flight responses from the old
  // filter set are discarded instead of being appended to the fresh list
  const epochRef = useRef(0)

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return
    loadingRef.current = true
    setLoading(true)
    const epoch = epochRef.current
    try {
      let res: Response
      if (adminFilters) {
        // Admin feed filters — same API + params as /admin/dataset (page-based)
        const params = buildAdminFeedParams(adminFilters, pageRef.current, pageLimitRef.current)
        res = await fetch(`/api/admin/dataset?${params}`, { headers: adminPasswordHeaders() })
      } else {
        // Cursor pagination: send the last item we have so the server reads straight
        // from there instead of skipping — same speed at page 500 as at page 1.
        const c = cursorRef.current
        const cursorQs = c ? `&before=${encodeURIComponent(c.before)}&beforeId=${c.beforeId}` : ""
        res = await fetch(`/api/my-images?limit=${pageLimitRef.current}&type=image&cursor=1${showHidden ? "&hidden=true" : ""}${cursorQs}`)
      }
      if (!res.ok) { hasMoreRef.current = false; return }
      const data = await res.json()
      if (!adminFilters && !data.success) return
      if (epoch !== epochRef.current) return // filters changed mid-flight — discard
      setImages((prev) => {
        const existingIds = new Set(prev.map(i => i.id))
        const newItems = data.images
          .filter((img: any) => !existingIds.has(img.id))
          .map((img: any) => ({
            id: img.id,
            imageUrl: img.imageUrl,
            thumbnailUrl: img.thumbnailUrl ?? undefined,
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
      if (adminFilters) {
        hasMoreRef.current = pageRef.current < data.pagination.totalPages
        pageRef.current += 1
      } else {
        // Cursor mode: advance the cursor to the last row and stop when a page isn't full
        hasMoreRef.current = !!data.hasMore
        if (data.nextCursor) cursorRef.current = data.nextCursor
      }
    } finally {
      if (epoch === epochRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [adminFilters, showHidden])

  const checkSentinel = useCallback(() => {
    if (!sentinelRef.current || !hasMoreRef.current) return
    const rect = sentinelRef.current.getBoundingClientRect()
    if (rect.top < window.innerHeight + 1200) loadNext()
  }, [loadNext])

  // Initial load + full reset whenever the filter set changes
  useEffect(() => {
    epochRef.current += 1
    setImages([])
    pageRef.current = 1
    cursorRef.current = null
    hasMoreRef.current = true
    loadingRef.current = false
    setLoading(false)
    if (signedIn) loadNext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, loadNext])
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

  // Emit ordered nav list whenever visible images change
  useEffect(() => {
    if (!onNavListChange) return
    if (adminFilters || showHidden) {
      // Admin-filtered and hidden views show exactly the API results, in API order
      onNavListChange(images)
      return
    }
    const freshIds = new Set(freshImages.map(i => i.id))
    const liveFailIds = new Set(freshImages.filter(i => i.failed).map(i => i.id))
    const dbFiltered = images.filter(img => !freshIds.has(img.id))
    const failsToMerge = savedFails.filter(f => !liveFailIds.has(f.id))
    const merged = [...dbFiltered, ...failsToMerge].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
    onNavListChange([...freshImages, ...merged])
  }, [images, freshImages, savedFails, onNavListChange, adminFilters, showHidden])

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

  if (!loading && images.length === 0 && !hasMoreRef.current && (adminFilters || showHidden || (pendingSlots.length === 0 && freshImages.length === 0))) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-600 text-sm">
        {adminFilters ? "No generations match these filters" : showHidden ? "No hidden generations" : "No generations yet"}
      </div>
    )
  }

  return (
    <div>
      {(() => {
        // Build the ordered feed nodes once; all three layouts render from this single
        // list so grid / masonry-flow / masonry-rows stay perfectly in sync.
        const nodes: { weight: number; node: ReactNode }[] = []

        // Pending + fresh (top of feed) — only in the normal (non-admin, non-hidden) view
        if (!adminFilters && !showHidden) {
          pendingSlots.forEach((slot) => {
            const node = slot.status === "loading"
              ? (slot.streamDataUrl
                  ? <StreamingSlot key={slot.slotId} dataUrl={slot.streamDataUrl} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />
                  : slot.queueJobId && !slot.nb2RequestId
                    ? <QueuedSlot key={slot.slotId} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />
                    : <LoadingSlot key={slot.slotId} onClick={onPendingClick ? () => onPendingClick(slot) : undefined} />)
              : <FailedSlot key={slot.slotId} prompt={slot.prompt} error={slot.error || "Generation failed"} />
            nodes.push({ weight: 1, node })
          })
          freshImages.forEach((img) => {
            const node = img.failed
              ? <FailedSlot key={`fresh-${img.id}`} prompt={img.prompt} error={img.failError || "Generation failed"} onClick={selectMode ? undefined : () => onImageClick(img)} />
              : <GridImage key={`fresh-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} directUrl={img.imageUrl} aspectRatio={img.aspectRatio} fullRes={fullRes} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} fullWidth={fullSize} />
            nodes.push({ weight: img.failed ? 1 : arHeightWeight(img.aspectRatio), node })
          })
        }

        if (adminFilters) {
          // Admin-filtered view: exactly the API results, in API order
          images.forEach((img) => nodes.push({
            weight: arHeightWeight(img.aspectRatio),
            node: <GridImage key={`af-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} aspectRatio={img.aspectRatio} fullRes={fullRes} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} fullWidth={fullSize} isVideo={!!img.videoMetadata || isVideoUrl(img.imageUrl)} adminThumb />,
          }))
        } else if (showHidden) {
          // Hidden view: exactly the API results (user's hidden items)
          images.forEach((img) => nodes.push({
            weight: arHeightWeight(img.aspectRatio),
            node: <GridImage key={`h-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} thumbUrl={img.thumbnailUrl} aspectRatio={img.aspectRatio} fullRes={fullRes} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} fullWidth={fullSize} />,
          }))
        } else {
          // DB images merged with restored fails, sorted by createdAt so fails land in place
          const freshIds = new Set(freshImages.map(i => i.id))
          const liveFailIds = new Set(freshImages.filter(i => i.failed).map(i => i.id))
          const dbFiltered = images.filter(img => !freshIds.has(img.id))
          const failsToMerge = savedFails.filter(f => !liveFailIds.has(f.id))
          const merged = [...dbFiltered, ...failsToMerge].sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
            return bTime - aTime
          })
          merged.forEach((img) => {
            const node = img.failed
              ? <FailedSlot key={`sf-${img.id}`} prompt={img.prompt} error={img.failError || "Generation failed"} onClick={selectMode ? undefined : () => onImageClick(img)} />
              : <GridImage key={`db-${img.id}`} src={img.imageUrl} alt={img.prompt} onClick={selectMode ? undefined : () => onImageClick(img)} imageId={img.id} thumbUrl={img.thumbnailUrl} aspectRatio={img.aspectRatio} fullRes={fullRes} selectMode={selectMode} selected={selectedIds?.has(img.id)} onSelect={onSelectToggle} fullWidth={fullSize} />
            nodes.push({ weight: img.failed ? 1 : arHeightWeight(img.aspectRatio), node })
          })
        }

        // Masonry "Rows": JS shortest-column packing — left-to-right, and tiles never move
        // as more load in (stable, no reflow/jump).
        if (fullSize && fullSizeLayout === "masonry" && masonryMode === "rows") {
          const columns = distributeMasonry(nodes, cols ?? autoCols)
          return (
            <div className="flex gap-2 items-start">
              {columns.map((colItems, i) => (
                <div key={i} className="flex-1 min-w-0 flex flex-col gap-2">
                  {colItems.map(it => it.node)}
                </div>
              ))}
            </div>
          )
        }

        // Masonry "Flow": CSS multi-column — packs top-to-bottom down each column.
        if (fullSize && fullSizeLayout === "masonry") {
          return (
            <div className={`${cols ? FEED_MASONRY_CLASS[cols] ?? "columns-2 sm:columns-4" : "columns-2 sm:columns-4"} gap-2 [&>*]:mb-2 [&>*]:break-inside-avoid`}>
              {nodes.map(it => it.node)}
            </div>
          )
        }

        // Grid / normal
        return (
          <div className={`grid ${fullSize ? "gap-2 items-start" : "gap-0.5"} ${cols ? FEED_COL_CLASS[cols] ?? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
            {nodes.map(it => it.node)}
          </div>
        )
      })()}
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
type CropMode   = 'frame' | 'drag'
type FrameHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type CropRect = { x: number; y: number; w: number; h: number }

// Corners listed first so they win hit-testing over edge midpoints
const FRAME_HANDLES: FrameHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']
const FRAME_CURSORS: Record<FrameHandle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
}
const frameHandlePoints = (r: CropRect): Record<FrameHandle, [number, number]> => ({
  nw: [r.x, r.y],                 n: [r.x + r.w / 2, r.y],           ne: [r.x + r.w, r.y],
  w:  [r.x, r.y + r.h / 2],                                          e:  [r.x + r.w, r.y + r.h / 2],
  sw: [r.x, r.y + r.h],           s: [r.x + r.w / 2, r.y + r.h],     se: [r.x + r.w, r.y + r.h],
})
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
  const blurSnapRef  = useRef<HTMLCanvasElement | null>(null)  // snapshot at blur stroke start
  const startPtRef   = useRef<{ x: number; y: number } | null>(null)
  const cropRectRef  = useRef<CropRect | null>(null)
  const frameDragRef = useRef<{ kind: FrameHandle | 'move'; start: { x: number; y: number }; orig: CropRect } | null>(null)

  const [tool,       setTool]       = useState<EditorTool>('draw')
  const [cropMode,   setCropMode]   = useState<CropMode>('frame')
  const [brushSize,  setBrushSize]  = useState(20)
  const [drawColor,  setDrawColor]  = useState('#ffffff')
  const [blurRadius, setBlurRadius] = useState(10)
  const [shapeKind,  setShapeKind]  = useState<ShapeKind>('rect')
  const [shapeFill,  setShapeFill]  = useState(true)
  const [shapeColor, setShapeColor] = useState('#ffffff')
  const [hasCropSel, setHasCropSel] = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [histLen,    setHistLen]    = useState(1)
  const [fitMode,    setFitMode]    = useState<'fit' | 'native'>('fit')

  // Load image into canvas on mount.
  // HTTPS images (Vercel Blob, R2, etc.) taint the canvas when drawn directly, which causes
  // toDataURL() to throw a SecurityError — silently killing onload before setLoaded(true) runs.
  // Fix: fetch HTTPS URLs as a blob first → create a same-origin blob URL → no canvas taint.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return

    const drawToCanvas = (src: string) => {
      const img = document.createElement('img')
      img.onload = () => {
        // Use full native resolution (capped at 4096 to prevent OOM on huge images).
        // CSS scales the canvas to fit the modal; getPos() corrects for the ratio.
        const maxRes = 4096
        const scale = Math.min(1, maxRes / img.width, maxRes / img.height)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        canvas.width = w; canvas.height = h
        overlayRef.current!.width = w; overlayRef.current!.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        try {
          const snap = document.createElement('canvas')
          snap.width = w; snap.height = h
          snap.getContext('2d')!.drawImage(img, 0, 0, w, h)
          historyRef.current = [snap.toDataURL('image/jpeg', 0.97)]
          setHistLen(1)
        } catch {
          historyRef.current = []
          setHistLen(0)
        }
        setLoaded(true)
      }
      img.onerror = () => setLoaded(true)
      img.src = src
    }

    if (image.url.startsWith('http')) {
      // Use the server-side proxy URL directly as img.src.
      // Same-origin URLs (/api/...) never taint a canvas — no fetch/blob step needed.
      drawToCanvas(`/api/admin/image-proxy?url=${encodeURIComponent(image.url)}`)
    } else {
      // blob: or data: — already same-origin, no taint risk
      drawToCanvas(image.url)
    }
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
    try {
      const url = canvasRef.current!.toDataURL('image/jpeg', 0.97)
      historyRef.current = [...historyRef.current, url]
      setHistLen(historyRef.current.length)
    } catch { /* tainted canvas — skip snapshot */ }
  }

  const restoreFrame = (dataUrl: string) => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const img = document.createElement('img')
    // History frames are always JPEG data URLs (same-origin) — no CORS concern
    img.onload = () => {
      // Frames can differ in size after a crop — resize canvases to match (resizing also clears)
      canvas.width = img.width; canvas.height = img.height
      const overlay = overlayRef.current
      if (overlay) { overlay.width = img.width; overlay.height = img.height }
      ctx.drawImage(img, 0, 0)
      if (tool === 'crop' && cropMode === 'frame') initCropFrame()
    }
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

  // Canvas px per CSS px — the canvas is native resolution but displayed scaled down,
  // so handle sizes / hit tolerances must be scaled to look consistent on screen
  const displayScale = () => {
    const c = canvasRef.current; if (!c) return 1
    const r = c.getBoundingClientRect()
    return r.width > 0 ? c.width / r.width : 1
  }

  const drawFrameOverlay = () => {
    const overlay = overlayRef.current; if (!overlay) return
    const octx = overlay.getContext('2d')!
    octx.clearRect(0, 0, overlay.width, overlay.height)
    const r = cropRectRef.current; if (!r) return
    const s = displayScale()
    // Dim everything outside the crop frame
    octx.fillStyle = 'rgba(0,0,0,0.55)'
    octx.fillRect(0, 0, overlay.width, overlay.height)
    octx.clearRect(r.x, r.y, r.w, r.h)
    // Rule-of-thirds grid
    octx.strokeStyle = 'rgba(255,255,255,0.25)'
    octx.lineWidth = 1 * s
    octx.beginPath()
    for (let i = 1; i <= 2; i++) {
      octx.moveTo(r.x + (r.w * i) / 3, r.y); octx.lineTo(r.x + (r.w * i) / 3, r.y + r.h)
      octx.moveTo(r.x, r.y + (r.h * i) / 3); octx.lineTo(r.x + r.w, r.y + (r.h * i) / 3)
    }
    octx.stroke()
    // Frame border
    octx.strokeStyle = 'rgba(255,255,255,0.9)'
    octx.lineWidth = 1.5 * s
    octx.strokeRect(r.x, r.y, r.w, r.h)
    // Corner + edge handles
    const hs = 10 * s
    const pts = frameHandlePoints(r)
    octx.fillStyle = '#ffffff'
    octx.strokeStyle = 'rgba(0,0,0,0.5)'
    octx.lineWidth = 1 * s
    for (const h of FRAME_HANDLES) {
      const [hx, hy] = pts[h]
      octx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
      octx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs)
    }
  }

  const initCropFrame = () => {
    const canvas = canvasRef.current; if (!canvas) return
    cropRectRef.current = { x: 0, y: 0, w: canvas.width, h: canvas.height }
    setHasCropSel(true)
    drawFrameOverlay()
  }

  const hitTestFrame = (pos: { x: number; y: number }): FrameHandle | 'move' | null => {
    const r = cropRectRef.current; if (!r) return null
    const tol = 12 * displayScale()
    const pts = frameHandlePoints(r)
    for (const h of FRAME_HANDLES) {
      const [hx, hy] = pts[h]
      if (Math.abs(pos.x - hx) <= tol && Math.abs(pos.y - hy) <= tol) return h
    }
    if (pos.x > r.x && pos.x < r.x + r.w && pos.y > r.y && pos.y < r.y + r.h) return 'move'
    return null
  }

  // Initialize / tear down the crop frame when the tool or crop mode changes
  useEffect(() => {
    if (!loaded) return
    if (tool === 'crop' && cropMode === 'frame') {
      initCropFrame()
    } else {
      frameDragRef.current = null
      cropRectRef.current = null
      setHasCropSel(false)
      clearOverlay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, cropMode, loaded])

  // Fit/Full toggle changes the display scale — redraw handles at the new size after layout
  useEffect(() => {
    if (tool === 'crop' && cropMode === 'frame' && cropRectRef.current) {
      const id = requestAnimationFrame(() => drawFrameOverlay())
      return () => cancelAnimationFrame(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode])

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
      // Snapshot the canvas at stroke start — all blur is applied relative to this
      const snap = document.createElement('canvas')
      snap.width = canvas.width; snap.height = canvas.height
      snap.getContext('2d')!.drawImage(canvas, 0, 0)
      blurSnapRef.current = snap
    } else if (tool === 'crop' && cropMode === 'frame') {
      // Grab a handle to resize, or the frame interior to move it
      if (!cropRectRef.current) initCropFrame()
      const hit = hitTestFrame(pos)
      frameDragRef.current = hit ? { kind: hit, start: pos, orig: { ...cropRectRef.current! } } : null
    } else if (tool === 'shape' || tool === 'crop') {
      startPtRef.current = pos
      setHasCropSel(false)
      cropRectRef.current = null
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) {
      // Hover feedback for crop frame handles
      if (tool === 'crop' && cropMode === 'frame' && loaded) {
        const hit = hitTestFrame(getPos(e))
        const c = canvasRef.current
        if (c) c.style.cursor = hit === 'move' ? 'move' : hit ? FRAME_CURSORS[hit] : 'default'
      }
      return
    }
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
      // Real-time blur: restore snapshot, then apply scale-down→up blur clipped to stroke path.
      // Works on all browsers including old iOS Safari (no ctx.filter needed).
      const snap = blurSnapRef.current; if (!snap) return
      const pts = blurPtsRef.current; const br = brushSize / 2
      // Compute bounding box of stroke + brush radius
      const bx1 = Math.max(0, Math.min(...pts.map(p => p.x)) - br)
      const by1 = Math.max(0, Math.min(...pts.map(p => p.y)) - br)
      const bx2 = Math.min(canvas.width,  Math.max(...pts.map(p => p.x)) + br)
      const by2 = Math.min(canvas.height, Math.max(...pts.map(p => p.y)) + br)
      const bw = bx2 - bx1, bh = by2 - by1
      if (bw < 1 || bh < 1) return
      // Restore only the bounding-box region from the snapshot (fast)
      ctx.drawImage(snap, bx1, by1, bw, bh, bx1, by1, bw, bh)
      // Scale down → up: downscale factor controls blur strength
      const factor = Math.max(3, blurRadius)
      const sw = Math.max(1, Math.round(bw / factor))
      const sh = Math.max(1, Math.round(bh / factor))
      const tiny = document.createElement('canvas')
      tiny.width = sw; tiny.height = sh
      const tctx = tiny.getContext('2d')!
      tctx.imageSmoothingEnabled = true
      tctx.drawImage(snap, bx1, by1, bw, bh, 0, 0, sw, sh)
      // Second pass: downscale again for a smoother result
      const tiny2 = document.createElement('canvas')
      tiny2.width = sw; tiny2.height = sh
      const tctx2 = tiny2.getContext('2d')!
      tctx2.imageSmoothingEnabled = true
      tctx2.drawImage(tiny, 0, 0, sw, sh, 0, 0, sw, sh)
      // Clip to brush path and upscale back onto the main canvas
      ctx.save()
      ctx.beginPath()
      pts.forEach(p => { ctx.arc(p.x, p.y, br, 0, Math.PI * 2) })
      ctx.clip()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tiny2, 0, 0, sw, sh, bx1, by1, bw, bh)
      ctx.restore()
    } else if (tool === 'crop' && cropMode === 'frame') {
      const d = frameDragRef.current; if (!d) return
      const dx = pos.x - d.start.x, dy = pos.y - d.start.y
      const minSz = Math.min(20 * displayScale(), canvas.width / 2, canvas.height / 2)
      let { x, y, w, h } = d.orig
      if (d.kind === 'move') {
        x = clampNum(d.orig.x + dx, 0, canvas.width - d.orig.w)
        y = clampNum(d.orig.y + dy, 0, canvas.height - d.orig.h)
      } else {
        // Handle names encode which edges they move: 'nw' moves the north + west edges, etc.
        let x1 = d.orig.x, y1 = d.orig.y, x2 = d.orig.x + d.orig.w, y2 = d.orig.y + d.orig.h
        if (d.kind.includes('w')) x1 = clampNum(d.orig.x + dx, 0, x2 - minSz)
        if (d.kind.includes('e')) x2 = clampNum(d.orig.x + d.orig.w + dx, x1 + minSz, canvas.width)
        if (d.kind.includes('n')) y1 = clampNum(d.orig.y + dy, 0, y2 - minSz)
        if (d.kind.includes('s')) y2 = clampNum(d.orig.y + d.orig.h + dy, y1 + minSz, canvas.height)
        x = x1; y = y1; w = x2 - x1; h = y2 - y1
      }
      cropRectRef.current = { x, y, w, h }
      drawFrameOverlay()
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
      // Blur was already applied live in onPointerMove — just commit and clean up
      blurPtsRef.current = []
      blurSnapRef.current = null
      pushHistory()
    } else if (tool === 'shape') {
      // Commit shape overlay to main canvas
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(overlayRef.current!, 0, 0)
      clearOverlay(); pushHistory()
    } else if (tool === 'crop') {
      if (cropMode === 'frame') {
        frameDragRef.current = null
      } else {
        const r = cropRectRef.current
        setHasCropSel(!!(r && r.w > 2 && r.h > 2))
      }
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
    // Frame mode: rebuild the frame around the newly cropped image so the user can keep refining
    if (cropMode === 'frame') initCropFrame()
  }

  const applyEdit = () => {
    // Commit any pending crop selection first — users adjust the frame and hit Apply
    // directly, expecting the crop to be included (without clicking "Apply Crop")
    const r = cropRectRef.current
    if (tool === 'crop' && r && r.w > 2 && r.h > 2) {
      const c = canvasRef.current!
      const isFullFrame = r.x < 0.5 && r.y < 0.5 && r.w > c.width - 0.5 && r.h > c.height - 0.5
      if (!isFullFrame) applyCrop()
    }
    const canvas = canvasRef.current!
    try {
      const exp = document.createElement('canvas')
      exp.width = canvas.width; exp.height = canvas.height
      const ectx = exp.getContext('2d')!
      ectx.fillStyle = '#ffffff'; ectx.fillRect(0, 0, exp.width, exp.height)
      ectx.drawImage(canvas, 0, 0)
      onApply(exp.toDataURL('image/jpeg', 0.92))
    } catch {
      // Canvas tainted (cross-origin image loaded without CORS) — shouldn't happen
      // because we fetch HTTPS images as blobs, but guard just in case
      alert('Could not export this image. Try re-uploading it to the ref library.')
    }
  }

  const toolBtn = (t: EditorTool, icon: React.ReactNode, label: string) => (
    <button
      key={t}
      onClick={() => { if (t === tool) return; setTool(t); clearOverlay(); setHasCropSel(false) }}
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl bg-[#0a0d14] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[95vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] shrink-0">
          <span className="text-sm font-semibold text-white">Edit Reference</span>
          <div className="flex items-center gap-2">
            {/* Fit / Full-size toggle */}
            <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
              <button
                onClick={() => setFitMode('fit')}
                title="Fit to window"
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${fitMode === 'fit' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Fit
              </button>
              <button
                onClick={() => setFitMode('native')}
                title="Full resolution (scroll to pan)"
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${fitMode === 'native' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Full
              </button>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={16} /></button>
          </div>
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
            <>
              {/* shrink-0 keeps the toggle intact on narrow screens — without it the
                  overflow-hidden segmented control gets squeezed and clips "Drag" */}
              <div className="flex rounded-lg overflow-hidden border border-white/[0.08] shrink-0">
                <button
                  onClick={() => setCropMode('frame')}
                  title="Crop frame with draggable corners and edges"
                  className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${cropMode === 'frame' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                  Frame
                </button>
                <button
                  onClick={() => setCropMode('drag')}
                  title="Drag to draw a crop selection"
                  className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${cropMode === 'drag' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                  Drag
                </button>
              </div>
              <span className="flex-1 min-w-0 text-[11px] text-slate-500 leading-snug">
                {cropMode === 'frame'
                  ? 'Drag corners or edges to resize the frame — drag inside it to move'
                  : 'Drag to select crop area'}
              </span>
            </>
          )}
        </div>

        {/* Canvas area — canvas is always in the DOM so the load useEffect can find canvasRef */}
        <div className={`flex-1 p-4 bg-black/20 relative ${fitMode === 'fit' ? 'flex items-center justify-center overflow-hidden' : 'overflow-auto'}`}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-600 text-sm z-10">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}
          <div className={`relative inline-block rounded-lg overflow-hidden shadow-xl transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}>
            <canvas ref={canvasRef}
              style={{
                display: 'block',
                touchAction: 'none',
                cursor: tool === 'shape' || (tool === 'crop' && cropMode === 'drag') ? 'crosshair' : tool === 'crop' ? 'default' : 'cell',
                // Fit mode: shrink to fit container while preserving aspect ratio
                ...(fitMode === 'fit' ? { maxWidth: '100%', maxHeight: 'calc(95vh - 260px)', objectFit: 'contain' } : {}),
              }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
            <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none block"
              style={fitMode === 'fit' ? { maxWidth: '100%', maxHeight: 'calc(95vh - 260px)' } : {}} />
          </div>
        </div>

        {/* Crop apply banner */}
        {hasCropSel && (
          <div className="flex items-center justify-center gap-3 px-5 py-2 bg-amber-500/10 border-t border-amber-500/20 shrink-0">
            <span className="text-[11px] text-amber-300">{tool === 'crop' && cropMode === 'frame' ? 'Adjust the crop frame, then apply' : 'Crop selection ready'}</span>
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
  const [showRefConsent, setShowRefConsent] = useState(false)
  // Start false and sync after mount — reading sessionStorage during the initial
  // render makes server and client HTML disagree (hydration error on the Ref button)
  const [refConsentGiven, setRefConsentGiven] = useState(false)
  useEffect(() => {
    setRefConsentGiven(sessionStorage.getItem("ref-rights-consent") === "true")
  }, [])
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
                  onClick={() => { if (refConsentGiven) { fileInputRef.current?.click() } else { setShowRefConsent(true) } }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-300 hover:border-white/20 hover:text-white transition-all shrink-0"
                >
                  {refConsentGiven ? <ImagePlus size={11} /> : <Lock size={11} className="text-slate-500" />}
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
      {showRefConsent && (
        <RefConsentModal
          onAgree={() => {
            sessionStorage.setItem("ref-rights-consent", "true")
            setRefConsentGiven(true)
            setShowRefConsent(false)
            fileInputRef.current?.click()
          }}
          onDecline={() => setShowRefConsent(false)}
        />
      )}
    </div>
  )
}

// --- VIDEO COMPONENTS ---

function useRefConsent() {
  const [showModal, setShowModal] = useState(false)
  const pendingRef = useRef<(() => void) | null>(null)
  // Start false and sync after mount — see refConsentGiven above (hydration safety)
  const [consented, setConsented] = useState(false)
  useEffect(() => {
    setConsented(sessionStorage.getItem("ref-rights-consent") === "true")
  }, [])
  const request = (action: () => void) => {
    if (consented) { action() }
    else { pendingRef.current = action; setShowModal(true) }
  }
  const modal = showModal ? (
    <RefConsentModal
      onAgree={() => {
        sessionStorage.setItem("ref-rights-consent", "true")
        setConsented(true)
        setShowModal(false)
        pendingRef.current?.()
        pendingRef.current = null
      }}
      onDecline={() => { setShowModal(false); pendingRef.current = null }}
    />
  ) : null
  return { request, modal }
}

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
  const { request: requestConsent, modal: consentModal } = useRefConsent()
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
          onClick={() => requestConsent(() => inputRef.current?.click())}
          className="w-full rounded-lg border border-dashed border-orange-500/30 hover:border-orange-500/50 flex flex-col items-center justify-center gap-1.5 transition-all py-6"
        >
          <ImagePlus size={16} className="text-orange-400/60" />
          <span className="text-[10px] text-slate-500">{label}</span>
        </button>
      )}
      {consentModal}
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
  const { request: requestConsent, modal: consentModal } = useRefConsent()
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
            <button onClick={() => requestConsent(() => imgInputRef.current?.click())}
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
          <button onClick={() => requestConsent(() => imgInputRef.current?.click())}
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
            <button onClick={() => requestConsent(() => vidInputRef.current?.click())}
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
          <button onClick={() => requestConsent(() => vidInputRef.current?.click())}
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
            <button onClick={() => requestConsent(() => audInputRef.current?.click())}
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
          <button onClick={() => requestConsent(() => audInputRef.current?.click())}
            className="w-full py-4 rounded-lg border border-dashed border-white/10 hover:border-white/20 text-[10px] text-slate-600 hover:text-slate-400 transition-all flex items-center justify-center gap-1.5">
            <Plus size={12} />Upload reference audio
          </button>
        )}
      </div>
      {consentModal}
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
  const { request: requestConsent, modal: consentModal } = useRefConsent()

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
              <button onClick={() => requestConsent(() => lipsyncVidRef.current?.click())}
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
              <button onClick={() => requestConsent(() => lipsyncAudRef.current?.click())}
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
              <button onClick={() => requestConsent(() => endRef.current.click())}
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
    {consentModal}
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
  onNavListChange,
  cols = null,
  showHidden = false,
}: {
  pendingSlots: VideoPendingSlot[]
  items: VideoItem[]
  savedFails: VideoItem[]
  onVideoClick: (data: VideoDetailData) => void
  onPendingClick?: (slot: VideoPendingSlot) => void
  selectMode?: boolean
  selectedIds?: Set<number>
  onSelectToggle?: (id: number) => void
  onNavListChange?: (list: VideoDetailData[]) => void
  cols?: number | null
  showHidden?: boolean
}) {
  // Pull the same historical feed as the image scanner — with infinite scroll
  const [dbImages, setDbImages] = useState<ImageItem[]>([])
  const [dbLoading, setDbLoading] = useState(false)
  const videoSentinelRef = useRef<HTMLDivElement>(null)
  const videoLoadingRef = useRef(false)
  const videoPageRef = useRef(1)
  // Cursor for keyset pagination of the video feed — constant-speed at any depth
  const videoCursorRef = useRef<{ before: string; beforeId: number } | null>(null)
  const videoHasMoreRef = useRef(true)
  const videoPagLimitRef = useRef(typeof window !== "undefined" && window.innerWidth < 640 ? 8 : 24)
  // Discard in-flight responses when the hidden toggle flips mid-request
  const videoEpochRef = useRef(0)

  const loadNextVideos = useCallback(async () => {
    if (videoLoadingRef.current || !videoHasMoreRef.current) return
    videoLoadingRef.current = true
    setDbLoading(true)
    const epoch = videoEpochRef.current
    try {
      const c = videoCursorRef.current
      const cursorQs = c ? `&before=${encodeURIComponent(c.before)}&beforeId=${c.beforeId}` : ""
      const res = await fetch(`/api/my-images?limit=${videoPagLimitRef.current}&type=video&cursor=1${showHidden ? "&hidden=true" : ""}${cursorQs}`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.images) return
      if (epoch !== videoEpochRef.current) return
      setDbImages(prev => {
        const existingIds = new Set(prev.map(i => i.id))
        const newItems = (data.images as any[]).filter(img => !existingIds.has(img.id))
        return [...prev, ...newItems]
      })
      videoHasMoreRef.current = !!data.hasMore
      if (data.nextCursor) videoCursorRef.current = data.nextCursor
    } finally {
      if (epoch === videoEpochRef.current) {
        videoLoadingRef.current = false
        setDbLoading(false)
      }
    }
  }, [showHidden])

  // Initial load + full reset when the hidden toggle changes
  useEffect(() => {
    videoEpochRef.current += 1
    setDbImages([])
    videoPageRef.current = 1
    videoCursorRef.current = null
    videoHasMoreRef.current = true
    videoLoadingRef.current = false
    setDbLoading(false)
    loadNextVideos()
  }, [loadNextVideos])
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

  // Emit ordered nav list whenever visible videos change
  useEffect(() => {
    if (!onNavListChange) return
    const sDbIds = new Set(items.map(i => i.dbId).filter((id): id is number => id !== undefined))
    const liveFailIds = new Set(items.filter(i => i.failed).map(i => i.id))
    const sessionList: VideoDetailData[] = items.map(item => ({
      id: item.dbId,
      videoUrl: item.videoUrl,
      prompt: item.prompt,
      model: item.model,
      duration: item.duration,
      resolution: item.resolution,
      aspectRatio: item.aspectRatio,
      audioEnabled: item.audioEnabled,
      startFrameUrl: item.startFrameUrl,
      endFrameUrl: item.endFrameUrl,
      motionVideoUrl: item.motionVideoUrl,
      keepOriginalSound: item.keepOriginalSound,
      characterOrientation: item.characterOrientation,
      createdAt: item.createdAt,
      failed: item.failed,
      failError: item.failError,
    }))
    const dbList: VideoDetailData[] = dbImages
      .filter(img => !sDbIds.has(img.id))
      .map(img => {
        const vm = img.videoMetadata || {}
        return {
          id: img.id,
          videoUrl: img.imageUrl,
          prompt: img.prompt,
          model: img.model,
          duration: vm.duration,
          resolution: vm.resolution || img.quality || undefined,
          aspectRatio: vm.aspectRatio || img.aspectRatio,
          audioEnabled: vm.audioEnabled,
          startFrameUrl: vm.startFrameUrl || undefined,
          endFrameUrl: vm.endFrameUrl || undefined,
          motionVideoUrl: vm.motionVideoUrl || undefined,
          keepOriginalSound: vm.keepOriginalSound,
          characterOrientation: vm.characterOrientation || undefined,
          createdAt: img.createdAt,
        }
      })
    const failsList: VideoDetailData[] = savedFails
      .filter(f => !liveFailIds.has(f.id))
      .map(f => ({
        videoUrl: '',
        prompt: f.prompt,
        model: f.model,
        duration: f.duration,
        createdAt: f.createdAt,
        failed: true,
        failError: f.failError,
      }))
    // Hidden view: only the API results — session items are never hidden
    onNavListChange(showHidden ? dbList : [...sessionList, ...dbList, ...failsList])
  }, [items, dbImages, savedFails, onNavListChange, showHidden])

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

  const hasContent = showHidden
    ? dbImages.length > 0 || dbLoading || videoHasMoreRef.current
    : pendingSlots.length > 0 || items.length > 0 || dbImages.length > 0 || savedFails.length > 0 || dbLoading || videoHasMoreRef.current

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-700">
        <Video size={28} strokeWidth={1.5} />
        <p className="text-sm">{showHidden ? "No hidden videos" : "Generated videos will appear here"}</p>
      </div>
    )
  }

  return (
    <div className={`p-3 grid gap-2 auto-rows-max ${cols ? FEED_COL_CLASS[cols] ?? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
      {/* Loading / queued slots (hidden view shows only DB results) */}
      {!showHidden && pendingSlots.map(slot => (
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
      {!showHidden && items.map(item =>
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
      {!showHidden && (() => {
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
  const { request: requestConsent, modal: consentModal } = useRefConsent()

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
                onClick={() => requestConsent(() => startFrameInputRef.current?.click())}
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
                onClick={() => requestConsent(() => motionVideoInputRef.current?.click())}
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
      {consentModal}
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

function NewsDropdown({
  open,
  onToggle,
  isAdmin = false,
  onManage,
}: {
  open: boolean
  onToggle: () => void
  isAdmin?: boolean
  onManage?: (target?: { section: "articles" | "notifications"; articleId?: number }) => void
}) {
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
      setMenuPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 408)) })
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

  // --- Admin quick edit (inline, in the dropdown) ---
  const [editingNotifId, setEditingNotifId] = useState<number | null>(null)
  const [editingArticleId, setEditingArticleId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editText, setEditText] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const startEditNotif = (n: PortalNotification) => {
    setEditingArticleId(null)
    setEditingNotifId(n.id)
    setEditText(n.message)
    setEditError(null)
  }
  const startEditArticle = (a: NewsArticlePreview) => {
    setEditingNotifId(null)
    setEditingArticleId(a.id)
    setEditTitle(a.title)
    setEditText(a.summary)
    setEditError(null)
  }
  const cancelQuickEdit = () => {
    setEditingNotifId(null)
    setEditingArticleId(null)
    setEditError(null)
  }
  const saveNotifEdit = async () => {
    if (editingNotifId === null || !editText.trim() || editSaving) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminPasswordHeaders() },
        body: JSON.stringify({ id: editingNotifId, message: editText.trim() }),
      })
      if (!res.ok) {
        setEditError(res.status === 401 ? "Admin unlock required — open Manage and enter your password first." : "Save failed — try again.")
        return
      }
      cancelQuickEdit()
      await fetchNews()
    } catch {
      setEditError("Save failed — check your connection.")
    } finally {
      setEditSaving(false)
    }
  }
  const saveArticleEdit = async () => {
    if (editingArticleId === null || !editTitle.trim() || editSaving) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch("/api/news", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminPasswordHeaders() },
        body: JSON.stringify({ id: editingArticleId, title: editTitle.trim(), summary: editText }),
      })
      if (!res.ok) {
        setEditError(res.status === 401 ? "Admin unlock required — open Manage and enter your password first." : "Save failed — try again.")
        return
      }
      cancelQuickEdit()
      await fetchNews()
    } catch {
      setEditError("Save failed — check your connection.")
    } finally {
      setEditSaving(false)
    }
  }

  // Shared quick-edit UI (admin only)
  const articleQuickEditor = (a: NewsArticlePreview) => (
    <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
      <input
        value={editTitle}
        onChange={e => setEditTitle(e.target.value)}
        placeholder="Title"
        autoFocus
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-[12px] text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
      />
      <textarea
        value={editText}
        onChange={e => setEditText(e.target.value)}
        placeholder="Summary"
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 resize-none"
      />
      {editError && <p className="text-[10px] text-red-400">{editError}</p>}
      <div className="flex items-center gap-1.5">
        <button
          onClick={saveArticleEdit}
          disabled={editSaving || !editTitle.trim()}
          className="flex-1 py-1.5 rounded-md bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-semibold hover:bg-violet-500/30 disabled:opacity-40 transition-all"
        >
          {editSaving ? "Saving…" : "Confirm"}
        </button>
        <button
          onClick={cancelQuickEdit}
          className="flex-1 py-1.5 rounded-md border border-white/10 bg-white/5 text-slate-400 text-[10px] hover:text-white transition-all"
        >
          Cancel
        </button>
        <button
          onClick={() => { onManage?.({ section: "articles", articleId: a.id }); onToggle() }}
          title="Open the full editor (content blocks, publish, delete)"
          className="px-2.5 py-1.5 rounded-md border border-white/10 text-slate-500 text-[10px] hover:text-white transition-all whitespace-nowrap"
        >
          Full editor
        </button>
      </div>
    </div>
  )

  const notifQuickEditor = (
    <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
      <textarea
        value={editText}
        onChange={e => setEditText(e.target.value)}
        placeholder="Notification message… supports [label](url) links"
        rows={3}
        autoFocus
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 resize-none"
      />
      {editError && <p className="text-[10px] text-red-400">{editError}</p>}
      <div className="flex items-center gap-1.5">
        <button
          onClick={saveNotifEdit}
          disabled={editSaving || !editText.trim()}
          className="flex-1 py-1.5 rounded-md bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-semibold hover:bg-violet-500/30 disabled:opacity-40 transition-all"
        >
          {editSaving ? "Saving…" : "Confirm"}
        </button>
        <button
          onClick={cancelQuickEdit}
          className="flex-1 py-1.5 rounded-md border border-white/10 bg-white/5 text-slate-400 text-[10px] hover:text-white transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  const visibleNotifs = notifications.filter(n => !dismissed.includes(n.id))
  const visibleArticles = articles.filter(a => !dismissedArticles.includes(a.id))
  const unreadCount = visibleNotifs.length + visibleArticles.length

  // Pinned (locked) notifications sort to the top
  const sortedNotifs = [...visibleNotifs].sort((a, b) => Number(b.locked) - Number(a.locked))
  // Featured card: the newest visible article that has a preview image
  const featured = visibleArticles.find(a => a.previewImage) ?? null
  const restArticles = visibleArticles.filter(a => a !== featured)

  const isNewItem = (dateStr: string) => Date.now() - new Date(dateStr).getTime() < 48 * 3600000

  const articleTypeLabel = (t: string) =>
    t === "success" ? "Update" : t === "update" ? "Patch" : t === "tutorial" ? "Tutorial" : t.charAt(0).toUpperCase() + t.slice(1)

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
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-fuchsia-500 text-black text-[9px] font-bold flex items-center justify-center ring-1 ring-black leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="fixed w-[400px] max-w-[calc(100vw-16px)] rounded-xl border border-white/10 bg-slate-900/98 backdrop-blur-md shadow-2xl overflow-hidden z-[9999]"
          style={{ top: menuPos.top, left: menuPos.left, animation: "pv2NewsIn 150ms ease-out" }}
        >
          <style>{`@keyframes pv2NewsIn { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }`}</style>
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
            <div className="flex items-center gap-2.5">
              {isAdmin && (
                <button
                  onClick={() => { onManage?.(); onToggle() }}
                  title="Manage news & notifications (admin)"
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 text-[10px] font-medium transition-all"
                >
                  <Pencil size={9} />
                  Manage
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={handleDismissAll}
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Dismiss all
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="max-h-[32rem] overflow-y-auto">
            {unreadCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2.5 text-slate-600">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-fuchsia-500/10 border border-white/8 flex items-center justify-center">
                  <Sparkles size={17} className="text-slate-500" />
                </div>
                <p className="text-[12px] text-slate-500">You're all caught up</p>
              </div>
            ) : (
              <>
                {/* Featured article — newest with a preview image */}
                {featured && (() => {
                  const cfg = NEWS_TYPE_CONFIG[featured.type as keyof typeof NEWS_TYPE_CONFIG] ?? NEWS_TYPE_CONFIG.update
                  return (
                    <div
                      className="group relative m-2 rounded-xl overflow-hidden cursor-pointer border border-white/10 hover:border-white/25 transition-colors"
                      onClick={() => { if (editingArticleId === featured.id) return; window.location.href = `/news/${featured.slug}`; onToggle() }}
                    >
                      <div className="aspect-video w-full bg-slate-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={featured.previewImage!} alt="" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                      {/* Type chip + NEW badge */}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${cfg.bg} border ${cfg.border} ${cfg.text} backdrop-blur-sm`}>
                          {articleTypeLabel(featured.type)}
                        </span>
                        {isNewItem(featured.publishedAt || featured.createdAt) && (
                          <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-fuchsia-500 text-black">NEW</span>
                        )}
                      </div>
                      {/* Admin quick edit + dismiss (admin buttons always visible — no hover on touch) */}
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {isAdmin && (
                          <button
                            onClick={e => { e.stopPropagation(); startEditArticle(featured) }}
                            title="Quick edit (admin)"
                            className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-violet-300 hover:bg-violet-500/40 hover:text-white transition-all"
                          >
                            <Pencil size={10} />
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleDismissArticle(featured.id) }}
                          className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-slate-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </div>
                      {/* Title over gradient — or admin quick editor */}
                      {editingArticleId === featured.id ? (
                        <div className="absolute bottom-0 left-0 right-0 p-3 bg-slate-950/90 backdrop-blur-sm border-t border-violet-500/30 cursor-default">
                          {articleQuickEditor(featured)}
                        </div>
                      ) : (
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <p className="text-[13px] text-white font-semibold leading-snug line-clamp-2">{featured.title}</p>
                          {featured.summary && (
                            <p className="text-[11px] text-slate-300/90 mt-0.5 truncate">{featured.summary}</p>
                          )}
                          <p className="text-[10px] text-slate-400/80 mt-1">{relativeTime(featured.publishedAt || featured.createdAt)}</p>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Remaining articles — compact rows with type accent */}
                {restArticles.length > 0 && (
                  <div>
                    <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Articles</p>
                    {restArticles.map(a => {
                      const cfg = NEWS_TYPE_CONFIG[a.type as keyof typeof NEWS_TYPE_CONFIG] ?? NEWS_TYPE_CONFIG.update
                      const Icon = cfg.icon
                      return (
                        <div
                          key={`article-${a.id}`}
                          className="group relative px-3 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.04] transition-colors cursor-pointer"
                          onClick={() => { if (editingArticleId === a.id) return; window.location.href = `/news/${a.slug}`; onToggle() }}
                        >
                          <div className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r ${cfg.dot}`} />
                          <div className="flex items-start gap-2.5 pl-1.5">
                            {a.previewImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={a.previewImage}
                                alt=""
                                className="w-12 h-12 rounded-lg object-cover shrink-0 border border-white/10"
                              />
                            ) : (
                              <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} border ${cfg.border}`}>
                                <Icon size={17} className={cfg.text} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[10px] font-semibold ${cfg.text}`}>{articleTypeLabel(a.type)}</span>
                                {isNewItem(a.publishedAt || a.createdAt) && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 leading-none">NEW</span>
                                )}
                                <span className="text-slate-700 text-[10px]">·</span>
                                <span className="text-[10px] text-slate-600">{relativeTime(a.publishedAt || a.createdAt)}</span>
                              </div>
                              {editingArticleId === a.id ? (
                                <div className="mt-1">{articleQuickEditor(a)}</div>
                              ) : (
                                <>
                                  <p className="text-[12px] text-slate-200 font-medium leading-snug truncate">{a.title}</p>
                                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{a.summary}</p>
                                </>
                              )}
                            </div>
                            <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                              {isAdmin && editingArticleId !== a.id && (
                                <button
                                  onClick={e => { e.stopPropagation(); startEditArticle(a) }}
                                  title="Quick edit (admin)"
                                  className="w-5 h-5 flex items-center justify-center rounded-full text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/15 transition-all"
                                >
                                  <Pencil size={10} />
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); handleDismissArticle(a.id) }}
                                className="w-5 h-5 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 hover:bg-white/8 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Notifications — pinned first, type accent */}
                {sortedNotifs.length > 0 && (
                  <div>
                    <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Updates</p>
                    {sortedNotifs.map((n) => {
                      const cfg = NEWS_TYPE_CONFIG[n.type as keyof typeof NEWS_TYPE_CONFIG] ?? NEWS_TYPE_CONFIG.info
                      const Icon = cfg.icon
                      return (
                        <div key={n.id} className="group relative px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                          <div className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r ${cfg.dot}`} />
                          <div className="flex items-start gap-3 pl-1">
                            <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${cfg.bg} border ${cfg.border}`}>
                              <Icon size={12} className={cfg.text} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {editingNotifId === n.id ? (
                                <div className="mt-0.5">{notifQuickEditor}</div>
                              ) : (
                                <>
                                  <p className="text-[12px] text-slate-200 leading-relaxed">{parseNotifMessage(n.message)}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    {isNewItem(n.createdAt) && (
                                      <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 leading-none">NEW</span>
                                    )}
                                    <p className="text-[10px] text-slate-600">{relativeTime(n.createdAt)}</p>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="flex flex-col items-center gap-1 shrink-0">
                              {isAdmin && editingNotifId !== n.id && (
                                <button
                                  onClick={() => startEditNotif(n)}
                                  title="Quick edit (admin)"
                                  className="w-5 h-5 flex items-center justify-center rounded-full text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/15 transition-all"
                                >
                                  <Pencil size={10} />
                                </button>
                              )}
                              {n.locked ? (
                                <div className="w-5 h-5 flex items-center justify-center text-amber-500/60" title="Pinned">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleDismiss(n.id)}
                                  className="w-5 h-5 flex items-center justify-center rounded-full text-slate-600 hover:text-slate-300 hover:bg-white/8 transition-all opacity-0 group-hover:opacity-100"
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Admin footer note */}
          {isAdmin && (
            <div className="px-4 py-2 border-t border-white/5 bg-violet-500/[0.04]">
              <p className="text-[9px] text-slate-600 leading-relaxed">
                Admin section — create, edit and delete news & notifications via <span className="text-violet-400">Manage</span>. Only visible to admin accounts.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- NEWS MANAGER MODAL (admin only) ---
// Hosts the shared NewsManager (same editor as /admin/news) in a full-screen
// portal modal, with the inline admin unlock used by other portal admin tools.
function NewsManagerModal({ initialSection, initialArticleId, onClose }: {
  initialSection?: "articles" | "notifications"
  initialArticleId?: number
  onClose: () => void
}) {
  const [authNeeded, setAuthNeeded] = useState<boolean | null>(null) // null = probing
  const [passwordInput, setPasswordInput] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/news?all=true", { headers: adminPasswordHeaders() })
        setAuthNeeded(res.status === 401)
      } catch {
        setAuthNeeded(false)
      }
    })()
  }, [])

  const handleUnlock = async () => {
    if (!passwordInput.trim() || verifying) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      if (res.ok) {
        try { sessionStorage.setItem("admin-password", passwordInput) } catch {}
        setPasswordInput("")
        setAuthNeeded(false)
      } else {
        const data = await res.json().catch(() => null)
        setVerifyError(data?.error || "Incorrect password")
      }
    } catch {
      setVerifyError("Verification failed — check your connection.")
    } finally {
      setVerifying(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl h-[90vh] rounded-2xl bg-[#09090f] border border-white/[0.1] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-fuchsia-400" />
            <p className="text-sm font-semibold text-white">Manage News & Notifications</p>
            <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[9px] font-bold uppercase tracking-wider">Admin</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {authNeeded === null ? (
            <div className="flex items-center justify-center h-full gap-2 text-slate-500 text-xs">
              <Loader2 size={14} className="animate-spin" /> Checking admin session…
            </div>
          ) : authNeeded ? (
            <div className="flex items-center justify-center h-full p-6">
              <div className="w-full max-w-sm rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Lock size={13} className="text-violet-400" />
                  <p className="text-xs font-semibold text-white">Admin unlock required</p>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Enter your admin password to manage news & notifications for this browser session.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={e => { setPasswordInput(e.target.value); setVerifyError(null) }}
                    onKeyDown={e => e.key === "Enter" && handleUnlock()}
                    placeholder="Admin password"
                    autoFocus
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
                  />
                  <button
                    onClick={handleUnlock}
                    disabled={verifying || !passwordInput.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {verifying && <Loader2 size={11} className="animate-spin" />}
                    Unlock
                  </button>
                </div>
                {verifyError && <p className="text-[11px] text-red-400">{verifyError}</p>}
              </div>
            </div>
          ) : (
            <NewsManager embedded initialSection={initialSection} initialArticleId={initialArticleId} />
          )}
        </div>
      </div>
    </div>,
    document.body
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
  const [imageNavList, setImageNavList] = useState<ImageItem[]>([])
  const [videoNavList, setVideoNavList] = useState<VideoDetailData[]>([])

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

  // --- Feed width (columns) — null = auto (responsive default) ---
  const [feedCols, setFeedCols] = useState<number | null>(null)
  // Full Size mode — show entire images at natural aspect instead of square thumbnails.
  // Defaults ON: the feed's default view is Full Size → Masonry → Rows.
  const [feedFullSize, setFeedFullSize] = useState(true)
  // Full Size sub-layout: "grid" (uniform rows) or "masonry" (packed columns, no gaps). Default masonry.
  const [feedFullSizeLayout, setFeedFullSizeLayout] = useState<"grid" | "masonry">("masonry")
  // Masonry packing method: "rows" (JS, left-to-right, stable) or "flow" (CSS columns, top-to-bottom)
  const [feedMasonryMode, setFeedMasonryMode] = useState<"flow" | "rows">("rows")
  // Full Size tile resolution: "thumb" (light, memory-safe) or "full" (full-res originals —
  // heavier, may reload the tab on very long scrolls)
  const [feedTileRes, setFeedTileRes] = useState<"thumb" | "full">("thumb")

  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem("pv2-feed-cols") || "")
      if (v >= 1 && v <= 6) setFeedCols(v)
      // Only override the default when the user has an explicit stored choice
      const fs = localStorage.getItem("pv2-feed-fullsize")
      if (fs !== null) setFeedFullSize(fs === "true")
      const layout = localStorage.getItem("pv2-feed-fullsize-layout")
      if (layout === "masonry" || layout === "grid") setFeedFullSizeLayout(layout)
      const mm = localStorage.getItem("pv2-feed-masonry-mode")
      if (mm === "flow" || mm === "rows") setFeedMasonryMode(mm)
      const tr = localStorage.getItem("pv2-feed-tile-res")
      if (tr === "thumb" || tr === "full") setFeedTileRes(tr)
    } catch {}
  }, [])

  const handleFeedColsChange = (n: number | null) => {
    setFeedCols(n)
    try {
      if (n) localStorage.setItem("pv2-feed-cols", String(n))
      else localStorage.removeItem("pv2-feed-cols")
    } catch {}
  }

  const handleFeedFullSizeChange = (on: boolean) => {
    setFeedFullSize(on)
    // Store the explicit value (not remove-on-off) so turning it off persists against
    // the new default-on behavior.
    try { localStorage.setItem("pv2-feed-fullsize", on ? "true" : "false") } catch {}
  }

  const handleFeedFullSizeLayoutChange = (layout: "grid" | "masonry") => {
    setFeedFullSizeLayout(layout)
    try { localStorage.setItem("pv2-feed-fullsize-layout", layout) } catch {}
  }

  const handleFeedMasonryModeChange = (mode: "flow" | "rows") => {
    setFeedMasonryMode(mode)
    try { localStorage.setItem("pv2-feed-masonry-mode", mode) } catch {}
  }

  const handleFeedTileResChange = (res: "thumb" | "full") => {
    setFeedTileRes(res)
    try { localStorage.setItem("pv2-feed-tile-res", res) } catch {}
  }

  // --- Hidden generations view — session-only (always back to normal feed on refresh) ---
  const [feedShowHidden, setFeedShowHidden] = useState(false)
  const [bulkHiding, setBulkHiding] = useState(false)

  const handleBulkHide = async () => {
    if (selectedImageIds.size === 0 || bulkHiding) return
    setBulkHiding(true)
    try {
      const res = await fetch("/api/my-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedImageIds), hidden: !feedShowHidden }),
      })
      if (res.ok) {
        setSelectedImageIds(new Set())
        setSelectMode(false)
        // Force both feeds to reload so the (un)hidden items move between views
        setImageGridKey(k => k + 1)
      }
    } catch {}
    finally { setBulkHiding(false) }
  }

  // --- Admin only: feed filters (mirrors /admin/dataset) ---
  // Persisted account-scoped via /api/user/preferences (portalPreferences JSON), so the
  // configuration survives refresh AND follows the account across devices.
  const [adminFeedFilters, setAdminFeedFilters] = useState<AdminFeedFilters | null>(null)
  const adminFeedFilterCount = countActiveAdminFeedFilters(adminFeedFilters)
  const adminFiltersRestoredRef = useRef(false)

  // Restore saved filters once the account is known to be admin
  useEffect(() => {
    if (!isAdminAccount || adminFiltersRestoredRef.current) return
    adminFiltersRestoredRef.current = true
    fetch("/api/user/preferences")
      .then(r => r.json())
      .then(({ preferences }) => {
        const stored = preferences?.adminFeedFilters
        if (stored && typeof stored === "object" && Array.isArray(stored.models)) {
          // Merge over EMPTY so newly added filter fields get sane defaults
          setAdminFeedFilters({ ...EMPTY_ADMIN_FEED_FILTERS, ...stored })
        }
      })
      .catch(() => {})
  }, [isAdminAccount])

  // Apply + persist (shallow-merge PUT; null clears the saved config too)
  const applyAdminFeedFilters = useCallback((f: AdminFeedFilters | null) => {
    setAdminFeedFilters(f)
    fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminFeedFilters: f }),
    }).catch(() => {})
  }, [])

  // --- Admin only: news manager modal (opened from the News dropdown) ---
  const [newsManagerTarget, setNewsManagerTarget] = useState<{ section: "articles" | "notifications"; articleId?: number } | null>(null)

  // --- Admin: add selected generations to dataset buckets ---
  const [addToBucketOpen, setAddToBucketOpen] = useState(false)
  const [datasetBuckets, setDatasetBuckets] = useState<Bucket[]>([])
  const [datasetFolders, setDatasetFolders] = useState<BucketFolder[]>([])
  const [bucketsLoading, setBucketsLoading] = useState(false)
  const [bucketLoadError, setBucketLoadError] = useState<string | null>(null)
  const [recentBucketIds, setRecentBucketIds] = useState<number[]>([])

  useEffect(() => {
    try { setRecentBucketIds(JSON.parse(localStorage.getItem("pv2-recent-buckets") || "[]")) } catch {}
  }, [])

  const datasetAuthHeaders = (): Record<string, string> => {
    const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
    return pass ? { "x-admin-password": pass } : {}
  }

  const handleOpenAddToBucket = async () => {
    if (!isAdminAccount || selectedImageIds.size === 0) return
    setAddToBucketOpen(true)
    setBucketsLoading(true)
    setBucketLoadError(null)
    try {
      const headers = datasetAuthHeaders()
      const [bRes, fRes] = await Promise.all([
        fetch("/api/admin/buckets", { headers }),
        fetch("/api/admin/folders", { headers }),
      ])
      if (bRes.status === 401 || fRes.status === 401) {
        setBucketLoadError("Admin unlock required — open Feed → Feed Filters, enter your admin password, then retry.")
      } else if (!bRes.ok || !fRes.ok) {
        setBucketLoadError("Failed to load buckets — try again.")
      } else {
        setDatasetBuckets(await bRes.json())
        setDatasetFolders(await fRes.json())
      }
    } catch {
      setBucketLoadError("Failed to load buckets — check your connection.")
    } finally {
      setBucketsLoading(false)
    }
  }

  const handleAddToBucket = async (bucketId: number) => {
    const ids = Array.from(selectedImageIds)
    const res = await fetch(`/api/admin/buckets/${bucketId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...datasetAuthHeaders() },
      body: JSON.stringify({ imageIds: ids }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setRecentBucketIds(prev => {
      const next = [bucketId, ...prev.filter(id => id !== bucketId)].slice(0, 20)
      try { localStorage.setItem("pv2-recent-buckets", JSON.stringify(next)) } catch {}
      return next
    })
    // Keep select mode on so more can be selected, but clear the handled selection
    setSelectedImageIds(new Set())
  }

  const handleCreateAndAddToBucket = async (name: string) => {
    const res = await fetch("/api/admin/buckets", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...datasetAuthHeaders() },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bucket = await res.json()
    await handleAddToBucket(bucket.id)
  }

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
            <ProfileBubble user={user} onSignOut={() => { sessionStorage.removeItem("ref-rights-consent"); setUser(null) }} />
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
              onEditSave={handleEditRef}
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
              isAdmin={isAdminAccount}
              onAddToBucket={handleOpenAddToBucket}
            />
            <NewsDropdown
              open={openDropdown === "news"}
              onToggle={() => toggle("news")}
              isAdmin={isAdminAccount}
              onManage={(t) => setNewsManagerTarget(t ?? { section: "articles" })}
            />
            <FeedDropdown
              open={openDropdown === "feed"}
              onToggle={() => toggle("feed")}
              cols={feedCols}
              onColsChange={handleFeedColsChange}
              fullSize={feedFullSize}
              onFullSizeChange={handleFeedFullSizeChange}
              fullSizeLayout={feedFullSizeLayout}
              onFullSizeLayoutChange={handleFeedFullSizeLayoutChange}
              masonryMode={feedMasonryMode}
              onMasonryModeChange={handleFeedMasonryModeChange}
              tileRes={feedTileRes}
              onTileResChange={handleFeedTileResChange}
              showHidden={feedShowHidden}
              onShowHiddenChange={setFeedShowHidden}
              isAdmin={isAdminAccount}
              adminFilterCount={adminFeedFilterCount}
              adminFilters={adminFeedFilters}
              onApplyAdminFilters={applyAdminFeedFilters}
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
            <ProfileBubble user={user} onSignOut={() => { sessionStorage.removeItem("ref-rights-consent"); setUser(null) }} />
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:border-white/20 hover:text-white transition-all"
            >
              Dashboard
            </Link>
          </div>
        </div>

      </div>

      {/* Floating select-mode controls — visible whenever select mode is on */}
      {selectMode && (
        <SelectModeOverlay
          selectedCount={selectedImageIds.size}
          onDownloadAll={handleBulkDownload}
          onDeleteAll={handleBulkDelete}
          onHideAll={handleBulkHide}
          onExit={handleToggleSelectMode}
          downloading={bulkDownloading}
          deleting={bulkDeleting}
          hiding={bulkHiding}
          hiddenView={feedShowHidden}
          downloadProgress={downloadProgress}
          downloadError={downloadError}
          isAdmin={isAdminAccount}
          onAddToBucket={handleOpenAddToBucket}
        />
      )}

      {/* Admin only: news & notifications manager (same editor as /admin/news) */}
      {newsManagerTarget && isAdminAccount && (
        <NewsManagerModal
          initialSection={newsManagerTarget.section}
          initialArticleId={newsManagerTarget.articleId}
          onClose={() => setNewsManagerTarget(null)}
        />
      )}

      {/* Admin only: shared Add to Bucket modal (same one as /admin/dataset) */}
      {addToBucketOpen && isAdminAccount && (
        <AddToBucketModal
          count={selectedImageIds.size}
          buckets={datasetBuckets}
          folders={datasetFolders}
          recentBucketIds={recentBucketIds}
          loading={bucketsLoading}
          error={bucketLoadError}
          onClose={() => setAddToBucketOpen(false)}
          onAdd={handleAddToBucket}
          onCreateAndAdd={handleCreateAndAddToBucket}
        />
      )}

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
              onNavListChange={setImageNavList}
              cols={feedCols}
              fullSize={feedFullSize}
              fullSizeLayout={feedFullSizeLayout}
              masonryMode={feedMasonryMode}
              tileRes={feedTileRes}
              adminFilters={isAdminAccount ? adminFeedFilters : null}
              showHidden={feedShowHidden}
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
              key={`vf-${imageGridKey}`}
              selectMode={selectMode}
              selectedIds={selectedImageIds}
              onSelectToggle={handleSelectToggle}
              onNavListChange={setVideoNavList}
              cols={feedCols}
              showHidden={feedShowHidden}
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
          navList={imageNavList}
          navIndex={imageNavList.findIndex(img => img.id === selectedImage.id)}
          onNavigate={setSelectedImage}
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
          navList={videoNavList}
          navIndex={videoNavList.findIndex(v => v.videoUrl === selectedVideo.videoUrl && v.prompt === selectedVideo.prompt && v.createdAt === selectedVideo.createdAt)}
          onNavigate={setSelectedVideo}
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
          onDismiss={isAdminAccount ? () => {
            if (pendingDetail.nb2RequestId) cancelNb2SlotPolling(pendingDetail.nb2RequestId)
            handleRemovePending(pendingDetail.slotId)
          } : undefined}
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
          onDismiss={isAdminAccount ? () => {
            const interval = videoPollingIntervals.current[videoPendingDetail.slotId]
            if (interval) { clearInterval(interval); delete videoPollingIntervals.current[videoPendingDetail.slotId] }
            setVideoPendingSlots(prev => prev.filter(s => s.slotId !== videoPendingDetail.slotId))
          } : undefined}
        />
      )}
      <ChatWidget sideTabOnly={scannerMode === "video"} />
    </div>
  )
}
