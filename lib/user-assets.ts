import prisma from '@/lib/prisma'
import { canonicalMediaUrl } from '@/lib/media-url'
import { ASSET_KINDS, MAX_ASSET_REFS, cleanCaption, cleanTags, type AssetKind } from '@/lib/storyboard'

/*
 * The account's saved assets (UserAsset): a character, vehicle, prop, place,
 * outfit... and the pictures that show it. Made on My Generations from the
 * account's own generations; pulled into (and saved from) Storyboard Studio
 * boards, whose per-board assets are copies that remember their `libraryId`.
 *
 * PRIVACY. Asset pictures come back SIGNED (jsonPrivate), so the server must
 * never store a URL the account does not own - otherwise anyone could save
 * another account's private image URL into an asset and read it back signed.
 * Every URL is checked against the account's own generations, Refs library
 * and per-user uploads (/u/<id>/) before it is kept.
 */

export const MAX_USER_ASSETS = 200
/** `caption` / `tags`: what this picture shows (hand-written or Auto caption) - see lib/storyboard AssetRef. */
export type UserAssetRef = { id: string; url: string; thumb?: string | null; caption?: string; tags?: string[] }
export type UserAssetOut = { id: number; kind: AssetKind; name: string; notes: string; refs: UserAssetRef[]; updatedAt: Date }

const KIND_IDS = new Set<string>(ASSET_KINDS.map(k => k.id))
const VIDEO_RE = /\.(mp4|webm|mov|m4v|glb|gltf|zip|mp3|wav|flac|m4a|aac|ogg|opus)(\?|#|$)/i
const refId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const assetKind = (k: unknown): AssetKind => (typeof k === 'string' && KIND_IDS.has(k) ? k : 'other') as AssetKind
export const assetName = (n: unknown) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 80) : 'Untitled')
export const assetNotes = (n: unknown) => (typeof n === 'string' ? n.slice(0, 1000) : '')

/** A stored refs column, cleaned (the shape the client gets, before thumbnails are added). */
export function storedRefs(raw: unknown): UserAssetRef[] {
  if (!Array.isArray(raw)) return []
  const out: UserAssetRef[] = []
  for (const r of raw) {
    const url = typeof r?.url === 'string' ? r.url : ''
    if (!/^https:\/\//.test(url)) continue
    const caption = cleanCaption(r?.caption), tags = cleanTags(r?.tags)
    out.push({ id: typeof r?.id === 'string' && r.id ? r.id.slice(0, 40) : refId(), url, ...(caption ? { caption } : {}), ...(tags.length ? { tags } : {}) })
    if (out.length >= MAX_ASSET_REFS) break
  }
  return out
}

/**
 * Which of these URLs belong to the account: its generations (by stored URL),
 * its Refs library, or its own uploads. Returned canonical; videos and audio
 * never qualify (an asset's pictures are references for a still).
 */
export async function ownedImageUrls(userId: number, urls: unknown[]): Promise<string[]> {
  const canon = [...new Set(urls.filter((u): u is string => typeof u === 'string').map(u => canonicalMediaUrl(u.trim())))]
    .filter(u => /^https:\/\//.test(u) && !VIDEO_RE.test(u))
    .slice(0, 100)
  if (!canon.length) return []
  const mine = new Set(canon.filter(u => u.includes(`/u/${userId}/`)))
  const rest = canon.filter(u => !mine.has(u))
  if (rest.length) {
    const [gens, refs] = await Promise.all([
      prisma.generatedImage.findMany({ where: { userId, isDeleted: false, imageUrl: { in: rest } }, select: { imageUrl: true } }),
      prisma.userReference.findMany({ where: { userId, isCleared: false, url: { in: rest } }, select: { url: true } }),
    ])
    for (const g of gens) mine.add(g.imageUrl)
    for (const r of refs) mine.add(r.url)
  }
  return canon.filter(u => mine.has(u))
}

/** The stored URLs of the account's own (not deleted, not video) generations with these ids. */
export async function ownedGenerationUrls(userId: number, ids: unknown[]): Promise<string[]> {
  const nums = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100)
  if (!nums.length) return []
  const rows = await prisma.generatedImage.findMany({
    where: { userId, isDeleted: false, id: { in: nums } },
    select: { id: true, imageUrl: true, videoMetadata: true },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return nums.map(n => byId.get(n)).filter((r): r is NonNullable<typeof r> =>
    !!r && !VIDEO_RE.test(r.imageUrl) && (r.videoMetadata as { isVideo?: boolean } | null)?.isVideo !== true,
  ).map(r => r.imageUrl)
}

/** New refs appended (deduped by URL), capped. */
export function withRefs(current: UserAssetRef[], urls: string[], captions?: Map<string, string>): UserAssetRef[] {
  const have = new Set(current.map(r => r.url))
  const next = [...current]
  for (const url of urls) {
    if (next.length >= MAX_ASSET_REFS) break
    if (have.has(url)) continue
    have.add(url)
    const caption = cleanCaption(captions?.get(url))
    next.push({ id: refId(), url, ...(caption ? { caption } : {}) })
  }
  return next
}

/**
 * Captions / tags / order applied to an asset's pictures by id (the editors'
 * edits and Auto caption). Unknown ids are ignored; `order` puts the listed
 * ids first in that order, the rest after.
 */
export function withCaptions(refs: UserAssetRef[], o: { captions?: unknown; tags?: unknown; order?: unknown }): UserAssetRef[] {
  const caps = o.captions && typeof o.captions === 'object' ? o.captions as Record<string, unknown> : {}
  const tags = o.tags && typeof o.tags === 'object' ? o.tags as Record<string, unknown> : {}
  let out = refs.map(r => {
    const next = { ...r }
    if (r.id in caps) { const c = cleanCaption(caps[r.id]); if (c) next.caption = c; else delete next.caption }
    if (r.id in tags) { const t = cleanTags(tags[r.id]); if (t.length) next.tags = t; else delete next.tags }
    return next
  })
  if (Array.isArray(o.order)) {
    const pos = new Map((o.order as unknown[]).filter((x): x is string => typeof x === 'string').map((id, i) => [id, i]))
    out = [...out].sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6))
  }
  return out
}

/**
 * Rows as the client sees them, each picture with its library thumbnail where
 * there is one - an asset card is a few hundred pixels, and the originals are
 * 2-20MB each.
 */
export async function assetsOut(userId: number, rows: { id: number; kind: string; name: string; notes: string; refs: unknown; updatedAt: Date }[]): Promise<UserAssetOut[]> {
  const all = rows.map(r => ({ row: r, refs: storedRefs(r.refs) }))
  const urls = [...new Set(all.flatMap(a => a.refs.map(r => r.url)))]
  const thumbs = new Map<string, string>()
  if (urls.length) {
    const gens = await prisma.generatedImage.findMany({
      where: { userId, imageUrl: { in: urls }, thumbnailUrl: { not: null } },
      select: { imageUrl: true, thumbnailUrl: true },
    })
    for (const g of gens) thumbs.set(g.imageUrl, g.thumbnailUrl!)
  }
  return all.map(({ row, refs }) => ({
    id: row.id, kind: assetKind(row.kind), name: row.name, notes: row.notes, updatedAt: row.updatedAt,
    refs: refs.map(r => ({ ...r, thumb: thumbs.get(r.url) ?? null })),
  }))
}

/*
 * ── Storage (raw SQL) ──────────────────────────────────────────────────────
 * UserAsset was added out-of-band (2026-10-07). A dev server started before
 * `prisma generate` holds a client without the model, so these go through
 * $queryRaw - the same pattern as the project's other out-of-band columns -
 * and work whether or not the running client knows the table.
 */
type Row = { id: number; kind: string; name: string; notes: string; refs: unknown; updatedAt: Date }

export const listAssets = (userId: number) => prisma.$queryRaw<Row[]>`
  SELECT id, kind, name, notes, refs, "updatedAt" FROM "UserAsset"
  WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC`

export async function countAssets(userId: number): Promise<number> {
  const r = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "UserAsset" WHERE "userId" = ${userId}`
  return r[0]?.n ?? 0
}

export async function findAsset(userId: number, id: number): Promise<Row | null> {
  const r = await prisma.$queryRaw<Row[]>`
    SELECT id, kind, name, notes, refs, "updatedAt" FROM "UserAsset" WHERE id = ${id} AND "userId" = ${userId}`
  return r[0] ?? null
}

export async function insertAsset(userId: number, a: { kind: string; name: string; notes: string; refs: UserAssetRef[] }): Promise<Row> {
  const r = await prisma.$queryRaw<Row[]>`
    INSERT INTO "UserAsset" ("userId", kind, name, notes, refs, "createdAt", "updatedAt")
    VALUES (${userId}, ${a.kind}, ${a.name}, ${a.notes}, ${JSON.stringify(a.refs)}::jsonb, now(), now())
    RETURNING id, kind, name, notes, refs, "updatedAt"`
  return r[0]
}

export async function updateAsset(userId: number, id: number, a: { kind: string; name: string; notes: string; refs: UserAssetRef[] }): Promise<Row> {
  const r = await prisma.$queryRaw<Row[]>`
    UPDATE "UserAsset" SET kind = ${a.kind}, name = ${a.name}, notes = ${a.notes},
      refs = ${JSON.stringify(a.refs)}::jsonb, "updatedAt" = now()
    WHERE id = ${id} AND "userId" = ${userId}
    RETURNING id, kind, name, notes, refs, "updatedAt"`
  return r[0]
}

export async function deleteAsset(userId: number, id: number): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "UserAsset" WHERE id = ${id} AND "userId" = ${userId}`
}
