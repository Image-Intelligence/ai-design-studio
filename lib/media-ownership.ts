import prisma from '@/lib/prisma'
import { canonicalMediaUrl, isOurMedia } from '@/lib/media-url'

/**
 * Which of these links an account may hold in something it saves.
 *
 * Our storage is private: every page gets SIGNED links, minted on the way out
 * (jsonPrivate). So anything a user can save - a storyboard's stills and
 * refs, an Image Studio canvas's layers, a reference sent to a model - must
 * point only at the user's OWN files, or saving someone else's stored link and
 * reading it back would hand them a working copy of a private picture (the
 * same rule as UserAsset's ownedImageUrls and the popup's ImageEditDoc).
 *
 * Owned: links outside our storage (fal's, a public site - nothing for us to
 * sign); anything under the account's upload prefix (/u/<id>/) or named with
 * its id (storyboard-<id>-, card-gen-<id>-, audio-<id>-); its generations
 * (GeneratedImage, videos included) and its Refs library (UserReference).
 * Returns the owned links in canonical form.
 */
export async function ownedMediaSet(userId: number, urls: string[]): Promise<Set<string>> {
  const canon = [...new Set(urls.filter(u => typeof u === 'string' && u).map(u => canonicalMediaUrl(u.trim())))]
  const mine = new Set<string>()
  const named = new RegExp(`/(?:storyboard|card-gen|home-card-gen|audio)-${userId}-`)
  const rest: string[] = []
  for (const u of canon) {
    if (!isOurMedia(u) || u.includes(`/u/${userId}/`) || named.test(u)) mine.add(u)
    else rest.push(u)
  }
  for (let i = 0; i < rest.length; i += 200) {
    const part = rest.slice(i, i + 200)
    const [gens, refs] = await Promise.all([
      prisma.generatedImage.findMany({ where: { userId, imageUrl: { in: part } }, select: { imageUrl: true } }),
      prisma.userReference.findMany({ where: { userId, url: { in: part } }, select: { url: true } }),
    ])
    for (const g of gens) mine.add(g.imageUrl)
    for (const r of refs) mine.add(r.url)
  }
  return mine
}

/**
 * A keep(url) test for one save: the account's own links, plus any the thing
 * being saved already held (accepted before - an old board, a canvas).
 */
export async function mediaKeeper(userId: number, incoming: string[], alreadyHeld: string[] = []): Promise<(url: string | null | undefined) => boolean> {
  const held = new Set(alreadyHeld.filter(Boolean).map(u => canonicalMediaUrl(u)))
  const own = await ownedMediaSet(userId, incoming.filter(u => u && !held.has(canonicalMediaUrl(u))))
  return (url) => {
    if (!url) return true
    const c = canonicalMediaUrl(url)
    return held.has(c) || own.has(c)
  }
}

/** Every string under any of these keys, anywhere in a JSON value - the links a document carries. */
export function collectUrls(value: unknown, keys = new Set(['url', 'src', 'stillUrl', 'beforeUrl', 'thumbUrl']), out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const v of value) collectUrls(v, keys, out); return out }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(k) && typeof v === 'string' && /^https:\/\//.test(v)) out.push(v)
      else if (v && typeof v === 'object') collectUrls(v, keys, out)
    }
  }
  return out
}
