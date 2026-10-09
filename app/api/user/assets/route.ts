import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalMediaUrl } from '@/lib/media-url'
import {
  MAX_USER_ASSETS, assetKind, assetName, assetNotes, assetsOut, ownedGenerationUrls, ownedImageUrls, storedRefs, withRefs, withCaptions,
  listAssets, countAssets, findAsset, insertAsset, updateAsset, deleteAsset,
} from '@/lib/user-assets'

/**
 * The account's saved assets (lib/user-assets) - made on My Generations,
 * used in Storyboard Studio boards.
 *
 *   GET                         every asset, newest first, pictures with thumbnails
 *   POST   { kind, name, notes?, imageIds?, urls? }        create
 *   PATCH  { id, kind?, name?, notes?,
 *            addImageIds?, addUrls?, removeRefIds?, refs? }  update; `refs` replaces the list
 *   DELETE ?id=                 remove the asset (its pictures are untouched)
 *
 * Pictures can carry a caption + tags (2026-10-08): POST / PATCH `refs` as
 * [{ url, caption?, tags? }] keep them (a board's asset, Make an asset from a
 * board); PATCH `captions` / `tags` ({ refId: ... }) and `order` (refIds) edit
 * them in place.
 *
 * Pictures arrive as generation ids (My Generations) or URLs (a board's
 * asset); either way only the account's own images are kept.
 */
async function authUser() {
  const token = (await cookies()).get('session')?.value
  return token ? getUserFromSession(token) : null
}

/** Caption + tags per picture link, as sent in a `refs` list, keyed canonical (the owned-URL check returns canonical links). */
function metaByUrl(list: unknown): Map<string, { caption?: string; tags?: string[] }> {
  const out = new Map<string, { caption?: string; tags?: string[] }>()
  if (!Array.isArray(list)) return out
  for (const r of list as { url?: unknown; caption?: unknown; tags?: unknown }[]) {
    if (typeof r?.url !== 'string') continue
    out.set(canonicalMediaUrl(r.url.trim()), { caption: typeof r.caption === 'string' ? r.caption : undefined, tags: Array.isArray(r.tags) ? r.tags as string[] : undefined })
  }
  return out
}
/** The pictures of a `refs` list the account owns, with their captions and tags. */
async function ownedRefsWithMeta(userId: number, list: unknown) {
  const meta = metaByUrl(list)
  const owned = await ownedImageUrls(userId, [...meta.keys()])
  const refs = withRefs([], owned, new Map(owned.map(u => [u, meta.get(u)?.caption ?? ''])))
  return withCaptions(refs, { tags: Object.fromEntries(refs.map(r => [r.id, meta.get(r.url)?.tags ?? []])) })
}

export async function GET() {
  const user = await authUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const rows = await listAssets(user.id)
  return jsonPrivate({ assets: await assetsOut(user.id, rows) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const user = await authUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (await countAssets(user.id) >= MAX_USER_ASSETS) {
    return jsonPrivate({ error: `You can keep up to ${MAX_USER_ASSETS} assets - delete one first` }, { status: 400 })
  }
  const urls = [
    ...(await ownedGenerationUrls(user.id, Array.isArray(body.imageIds) ? body.imageIds : [])),
    ...(await ownedImageUrls(user.id, Array.isArray(body.urls) ? body.urls : [])),
  ]
  // Pictures with their captions (Make an asset from a board) go first
  const withMeta = Array.isArray(body.refs) ? await ownedRefsWithMeta(user.id, body.refs) : []
  const row = await insertAsset(user.id, { kind: assetKind(body.kind), name: assetName(body.name), notes: assetNotes(body.notes), refs: withRefs(withMeta, urls) })
  const [asset] = await assetsOut(user.id, [row])
  return jsonPrivate({ asset })
}

export async function PATCH(req: Request) {
  const user = await authUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  const row = Number.isInteger(id) ? await findAsset(user.id, id) : null
  if (!row) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  let refs = storedRefs(row.refs)
  // A whole new list (a board saving over its library copy): only owned pictures survive
  if (Array.isArray(body.refs)) refs = await ownedRefsWithMeta(user.id, body.refs)
  if (Array.isArray(body.removeRefIds)) {
    const drop = new Set(body.removeRefIds.filter((x: unknown) => typeof x === 'string'))
    refs = refs.filter(r => !drop.has(r.id))
  }
  const adds = [
    ...(await ownedGenerationUrls(user.id, Array.isArray(body.addImageIds) ? body.addImageIds : [])),
    ...(await ownedImageUrls(user.id, Array.isArray(body.addUrls) ? body.addUrls : [])),
  ]
  refs = withRefs(refs, adds)
  // Captions / tags / order edited in place (the editors, Auto caption)
  if (body.captions || body.tags || body.order) refs = withCaptions(refs, { captions: body.captions, tags: body.tags, order: body.order })

  const updated = await updateAsset(user.id, row.id, {
    kind: 'kind' in body ? assetKind(body.kind) : row.kind,
    name: 'name' in body ? assetName(body.name) : row.name,
    notes: 'notes' in body ? assetNotes(body.notes) : row.notes,
    refs,
  })
  const [asset] = await assetsOut(user.id, [updated])
  return jsonPrivate({ asset, added: adds.length })
}

export async function DELETE(req: Request) {
  const user = await authUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = Number(new URL(req.url).searchParams.get('id'))
  const count = Number.isInteger(id) ? await deleteAsset(user.id, id) : 0
  return count ? jsonPrivate({ ok: true }) : jsonPrivate({ error: 'Not found' }, { status: 404 })
}
