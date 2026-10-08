import { getTool, clipIds } from '@/lib/threed/catalog'
import type { ThreeDFile, ThreeDMeta } from '@/lib/threed/pipeline'

/**
 * A 3D asset as the studio page sees it - from either generation of storage:
 * v2 (lib/threed/pipeline: files on our storage, a viewer copy, a poster) or
 * the old suite's rows (videoMetadata.threed with fal links and `preview`).
 * The page upgrades an old one the first time it is opened ([id] 'prepare').
 */
export type AssetOut = {
  id: number
  prompt: string
  toolId: string
  toolLabel: string
  stage: string
  createdAt: Date
  tickets: number
  poster: string | null
  viewer: { url: string; bytes: number } | null
  files: ThreeDFile[]
  parentId: number | null
  partNames?: string[]
  layers?: ThreeDMeta['layers']
  archive?: ThreeDMeta['archive']
  /** "Animation clips": the library ids asked for, in the order fal returns the clips. */
  clipIds?: number[]
  /** An old-suite asset not yet copied to our storage. */
  legacy: boolean
}

const MESH = new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'usdz', 'ply', 'splat'])

export function assetOut(r: { id: number; prompt: string; model: string; imageUrl: string; createdAt: Date; videoMetadata: unknown; ticketCost: number }): AssetOut {
  const toolId = r.model.replace(/^3d:/, '')
  const tool = getTool(toolId)
  const t = ((r.videoMetadata as any)?.threed ?? {}) as Partial<ThreeDMeta> & { preview?: string | null; files?: { url: string; kind?: string; name?: string }[] }
  const v2 = t.v === 2
  const files: ThreeDFile[] = v2 ? (t.files ?? []) : (t.files ?? []).map((f: any, k: number) => {
    const ext = (String(f.url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (f.kind === 'preview' ? 'png' : 'glb')).toLowerCase()
    return { url: f.url, name: f.kind ? String(f.kind) : `file${k}`, ext, kind: MESH.has(ext) ? 'mesh' : f.kind === 'preview' ? 'image' : ext === 'zip' ? 'archive' : 'other' } as ThreeDFile
  })
  return {
    id: r.id,
    prompt: r.prompt,
    toolId,
    toolLabel: tool?.label ?? toolId.replace(/-/g, ' '),
    stage: tool?.stage ?? 'model',
    createdAt: r.createdAt,
    tickets: r.ticketCost,
    poster: v2 ? (t.poster ?? null) : (t.preview ?? null),
    viewer: v2 ? (t.viewer ?? null) : null,
    files,
    parentId: v2 ? (t.parentId ?? null) : null,
    ...(t.partNames ? { partNames: t.partNames } : {}),
    layers: t.layers ?? null,
    archive: t.archive ?? null,
    ...(toolId === 'meshy-animate' && t.options?.animation_action_ids !== undefined ? { clipIds: clipIds(t.options.animation_action_ids) } : {}),
    legacy: !v2,
  }
}
