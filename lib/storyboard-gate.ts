import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { enforcePublicModeration } from '@/lib/public-moderation'
import { mediaKeeper, collectUrls } from '@/lib/media-ownership'

/**
 * Storyboard Studio for everyone (2026-10-07): who is asking, and the rules a
 * non-admin's generations run under. Every storyboard route scopes its rows
 * by the returned user's id; admins keep what they had (free, their own
 * safety settings, every model), everyone else pays tickets
 * (lib/ticket-gate - admins are skipped there too) and runs at the site's
 * public moderation.
 */
export async function requireStoryboardUser() {
  const user = await requireStudioUser()
  if (!user) return null
  return { ...user, isAdmin: await checkIsAdmin(user.email) }
}

/**
 * A board's shots and assets as a non-admin's page sends them, with every
 * link that is not the account's own (or already on the board) taken out -
 * a board hands its pictures back as SIGNED links, so a pasted link to
 * someone else's file must never be stored (lib/media-ownership). Raw JSON
 * in, raw JSON out (the routes sanitise it after). Admins: unchanged.
 */
export async function scrubBoardMedia(
  user: { id: number; isAdmin: boolean },
  body: { shots?: unknown; assets?: unknown },
  held: { shots?: unknown; assets?: unknown } = {},
): Promise<{ shots?: unknown; assets?: unknown }> {
  if (user.isAdmin) return body
  const keep = await mediaKeeper(user.id, collectUrls([body.shots, body.assets]), collectUrls([held.shots, held.assets]))
  const ok = (u: unknown) => typeof u === 'string' && keep(u)
  const out: { shots?: unknown; assets?: unknown } = { ...body }
  if (Array.isArray(body.shots)) {
    out.shots = (body.shots as any[]).map(s => !s || typeof s !== 'object' ? s : {
      ...s,
      stillUrl: s.stillUrl && ok(s.stillUrl) ? s.stillUrl : null,
      beforeUrl: s.beforeUrl && ok(s.beforeUrl) ? s.beforeUrl : undefined,
      stills: Array.isArray(s.stills) ? s.stills.filter((t: any) => ok(t?.url)) : s.stills,
      refs: Array.isArray(s.refs) ? s.refs.filter((r: any) => ok(r?.url)) : s.refs,
    })
  }
  if (Array.isArray(body.assets)) {
    out.assets = (body.assets as any[]).map(a => !a || typeof a !== 'object' ? a : { ...a, refs: Array.isArray(a.refs) ? a.refs.filter((r: any) => ok(r?.url)) : a.refs })
  }
  return out
}

/** The references a non-admin may send to a model: their own pictures only. */
export async function ownRefs(user: { id: number; isAdmin: boolean }, urls: string[]): Promise<string[]> {
  if (user.isAdmin || !urls.length) return urls
  const keep = await mediaKeeper(user.id, urls)
  return urls.filter(u => keep(u))
}

/**
 * A storyboard still's fal input at the moderation a non-admin gets: the
 * shared public rules (lib/public-moderation - NanoBanana 2.1's standard
 * tolerance, FLUX 3's default, the forced checkers), and fal's safety checker
 * ON for any model that has one. The studio's builders were written for
 * admins (checker off); the portal forces it on for non-admins model by model
 * (SeeDream 5 Pro, Recraft...) - here it is every model, the CCBill rule.
 * Changed in place.
 */
export function publicStillSafety(model: string, input: Record<string, unknown>, isAdmin: boolean): void {
  if (isAdmin) return
  enforcePublicModeration(model, input, false)
  if ('enable_safety_checker' in input) input.enable_safety_checker = true
}
