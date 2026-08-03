// Personal API key permissions — shared by the settings UI and the server.
// Client-import-safe: no prisma / node built-ins here.

import { CHAT_CREATE_MODELS } from '@/lib/chat-hub-models'
import { AI_MODELS } from '@/config/ai-models.config'

export type ApiKeyPermissions = {
  scopes: string[]
  models: {
    image: '*' | string[]
    video: '*' | string[]
  }
}

export type ApiKeyScope = {
  id: string
  label: string
  description: string
  default: boolean
  adminOnly?: boolean
}

export const ALL_SCOPES: ApiKeyScope[] = [
  { id: 'tickets:read',     label: 'Read ticket balance',  description: 'Get and stream the live ticket balance', default: true },
  { id: 'tickets:spend',    label: 'Spend tickets',        description: 'Allow calls that deduct tickets (required for generations)', default: true },
  { id: 'generate:image',   label: 'Generate images',      description: 'Run image generations (per-model toggles below also apply)', default: true },
  { id: 'generate:video',   label: 'Generate videos',      description: 'Run video generations (per-model toggles below also apply)', default: true },
  { id: 'jobs:read',        label: 'Poll generation jobs', description: 'Check the status of queued generations', default: true },
  { id: 'feed:read',        label: 'Read session feed',    description: 'List generated images and videos', default: true },
  { id: 'references:read',  label: 'Read reference library', description: 'List reference images and folders', default: true },
  { id: 'references:write', label: 'Upload references',    description: 'Add images to the reference library', default: false },
  { id: 'feed:manage',      label: 'Manage feed items',    description: 'Hide, unhide, and delete feed items', default: false },
  { id: 'dataset:read',     label: 'Read admin dataset',   description: 'View dataset bucket and folder trees (admin accounts only)', default: false, adminOnly: true },
]

const SCOPE_IDS = new Set(ALL_SCOPES.map(s => s.id))

export const DEFAULT_PERMISSIONS: ApiKeyPermissions = {
  scopes: ALL_SCOPES.filter(s => s.default).map(s => s.id),
  models: { image: '*', video: '*' },
}

export type KeyModelEntry = { id: string; label: string; group: string; kind: 'image' | 'video' }

// Upscalers live only in config/ai-models.config.ts — surfaced here as an
// "Upscalers" group on the image side (they run through /api/generate too).
const UPSCALER_IDS = ['clarity-upscaler', 'aura-sr', 'esrgan', 'drct', 'supir']

export function modelCatalogForKeys(): { image: KeyModelEntry[]; video: KeyModelEntry[] } {
  const image: KeyModelEntry[] = []
  const video: KeyModelEntry[] = []
  for (const m of CHAT_CREATE_MODELS) {
    const entry: KeyModelEntry = { id: m.id, label: m.label, group: m.group, kind: m.kind }
    if (m.kind === 'image') image.push(entry)
    else video.push(entry)
  }
  for (const id of UPSCALER_IDS) {
    const cfg = AI_MODELS.find(m => m.id === id)
    if (cfg) image.push({ id: cfg.id, label: cfg.displayName, group: 'Upscalers', kind: 'image' })
  }
  return { image, video }
}

function sanitizeModelList(raw: unknown, valid: Set<string>): '*' | string[] {
  if (raw === '*') return '*'
  if (Array.isArray(raw)) return raw.filter(id => typeof id === 'string' && valid.has(id))
  return '*'
}

// Drops unknown scopes and model ids; strips admin-only scopes unless isAdmin.
// Fail-closed future-proofing for a non-admin rollout even though the whole
// settings panel is admin-gated today.
export function sanitizePermissions(raw: unknown, isAdmin: boolean): ApiKeyPermissions {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const catalog = modelCatalogForKeys()
  const imageIds = new Set(catalog.image.map(m => m.id))
  const videoIds = new Set(catalog.video.map(m => m.id))

  const scopes = Array.isArray(src.scopes)
    ? src.scopes.filter((s): s is string => {
        if (typeof s !== 'string' || !SCOPE_IDS.has(s)) return false
        const def = ALL_SCOPES.find(d => d.id === s)
        return !(def?.adminOnly && !isAdmin)
      })
    : [...DEFAULT_PERMISSIONS.scopes]

  const modelsSrc = (src.models && typeof src.models === 'object' ? src.models : {}) as Record<string, unknown>
  return {
    scopes: [...new Set(scopes)],
    models: {
      image: sanitizeModelList(modelsSrc.image, imageIds),
      video: sanitizeModelList(modelsSrc.video, videoIds),
    },
  }
}

export function permissionsFromJson(raw: unknown): ApiKeyPermissions {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const modelsSrc = (src.models && typeof src.models === 'object' ? src.models : {}) as Record<string, unknown>
  return {
    scopes: Array.isArray(src.scopes) ? src.scopes.filter((s): s is string => typeof s === 'string') : [],
    models: {
      image: modelsSrc.image === '*' || Array.isArray(modelsSrc.image) ? (modelsSrc.image as '*' | string[]) : [],
      video: modelsSrc.video === '*' || Array.isArray(modelsSrc.video) ? (modelsSrc.video as '*' | string[]) : [],
    },
  }
}
