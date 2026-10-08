import { createHmac, timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { checkIsAdmin } from '@/lib/admin-check'
import { canonicalMediaUrl } from '@/lib/media-url'

/**
 * ID verification for uploads (server only).
 *
 * CCBill (2026-10-08): uploads - reference pictures, start frames, source
 * clips, voice tracks - may only come from ID-verified accounts (the card
 * networks' rule for user-supplied content). Prompting, text-to-image/video
 * and re-using the account's OWN generations stay open to everyone. Each
 * account verifies once; admins never have to.
 *
 * The check is Didit's hosted flow (document + selfie liveness + face match).
 * We keep ONLY the outcome: when it was approved, the latest session id and
 * Didit's status, plus when the Content Provider terms (ToS §21) were agreed.
 * Names, dates of birth and the ID images stay with Didit - the date of birth
 * is read once, here, to refuse anyone under 18, and never stored.
 *
 * The User columns are added out of band (see prisma/schema.prisma), so every
 * read and write is raw SQL wrapped to FAIL CLOSED: before the DDL lands, or
 * on any database error, an account simply counts as not verified - uploads
 * stay locked for non-admins, nothing 500s. Missing Didit env does the same.
 *
 * Env: DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET.
 */

const DIDIT_BASE = 'https://verification.didit.me'

export type IdVerification = {
  verified: boolean
  /** Didit's latest session status, or ours ("Declined (age)"); null = never started */
  status: string | null
  termsAccepted: boolean
}

type SessionUser = { id: number; email: string }

/** Didit is configured: an API key and the workflow to send people through. */
export function idVerificationAvailable(): boolean {
  return !!process.env.DIDIT_API_KEY && !!process.env.DIDIT_WORKFLOW_ID
}

export async function getIdVerification(userId: number): Promise<IdVerification> {
  try {
    const rows = await prisma.$queryRaw<{ idVerifiedAt: Date | null; idVerificationStatus: string | null; contentTermsAcceptedAt: Date | null }[]>`
      SELECT "idVerifiedAt", "idVerificationStatus", "contentTermsAcceptedAt" FROM "User" WHERE id = ${userId}`
    const r = rows[0]
    return { verified: !!r?.idVerifiedAt, status: r?.idVerificationStatus ?? null, termsAccepted: !!r?.contentTermsAcceptedAt }
  } catch (e) {
    // Columns not there yet (or the database hiccuped): not verified
    console.warn('[id-verification] read failed - treating as unverified:', (e as Error).message)
    return { verified: false, status: null, termsAccepted: false }
  }
}

/** Admins skip the check; everyone else needs an approved verification. */
export async function isUploadAllowed(user: SessionUser): Promise<boolean> {
  if (await checkIsAdmin(user.email)) return true
  return (await getIdVerification(user.id)).verified
}

/**
 * The gate for a route that takes an upload: null when this account may
 * upload, else the 403 the page recognises (code ID_VERIFICATION_REQUIRED
 * opens the verification popup).
 */
export async function requireIdVerified(user: SessionUser) {
  if (await isUploadAllowed(user)) return null
  return jsonPrivate({ error: 'Verify your ID to upload pictures', code: 'ID_VERIFICATION_REQUIRED' }, { status: 403 })
}

/**
 * The gate for a GENERATION route: an unverified account may still pass media
 * links, but only its OWN generations (a GeneratedImage row it owns - what the
 * library picker hands out). Anything else - one of its uploads from before
 * the gate, a data: URI, a link from elsewhere - is refused. Text-only
 * requests carry no links and always pass.
 */
export async function requireOwnMediaUnlessVerified(user: SessionUser, links: unknown[]) {
  const urls = links.flatMap(v => (Array.isArray(v) ? v : [v]))
    .map(v => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string' ? (v as { url: string }).url : ''))
    .filter(u => u.trim().length > 0)
  if (!urls.length) return null
  if (await isUploadAllowed(user)) return null
  const refused = jsonPrivate({ error: 'Verify your ID to use your own pictures or clips - you can still pick from your generations', code: 'ID_VERIFICATION_REQUIRED' }, { status: 403 })
  if (urls.some(u => u.startsWith('data:') || u.startsWith('blob:'))) return refused
  const canon = [...new Set(urls.map(u => canonicalMediaUrl(u)))]
  try {
    const own = await prisma.generatedImage.findMany({
      where: { userId: user.id, OR: [{ imageUrl: { in: canon } }, { thumbnailUrl: { in: canon } }] },
      select: { imageUrl: true, thumbnailUrl: true },
    })
    const ok = new Set(own.flatMap(r => [r.imageUrl, r.thumbnailUrl].filter((x): x is string => !!x)))
    return canon.every(u => ok.has(u)) ? null : refused
  } catch {
    return refused
  }
}

/** Ticked "I agree" on the Content Provider terms (ToS §21). */
export async function acceptContentTerms(userId: number): Promise<boolean> {
  try {
    await prisma.$executeRaw`UPDATE "User" SET "contentTermsAcceptedAt" = COALESCE("contentTermsAcceptedAt", NOW()) WHERE id = ${userId}`
    return true
  } catch (e) {
    console.error('[id-verification] terms write failed:', (e as Error).message)
    return false
  }
}

async function saveSession(userId: number, sessionId: string, status: string) {
  await prisma.$executeRaw`UPDATE "User" SET "idVerificationSessionId" = ${sessionId}, "idVerificationStatus" = ${status} WHERE id = ${userId}`
}

// ── Didit ────────────────────────────────────────────────────────────────

/** Start a hosted verification. Didit sends the person back to `callback` with ?verificationSessionId=&status=. */
export async function createDiditSession(userId: number, callback: string): Promise<{ url: string; sessionId: string }> {
  const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.DIDIT_API_KEY ?? '' },
    body: JSON.stringify({ workflow_id: process.env.DIDIT_WORKFLOW_ID, callback, vendor_data: String(userId), language: 'en' }),
    signal: AbortSignal.timeout(20_000),
  })
  const j = await res.json().catch(() => ({})) as { session_id?: string; url?: string; status?: string }
  if (!res.ok || !j.session_id || !j.url) throw new Error(`Didit session failed (${res.status})`)
  await saveSession(userId, j.session_id, j.status || 'Not Started')
  return { url: j.url, sessionId: j.session_id }
}

/** The decision for a session, straight from Didit (never trust a redirect's query string). */
export async function fetchDiditDecision(sessionId: string): Promise<Record<string, any> | null> {
  if (!/^[0-9a-f-]{20,64}$/i.test(sessionId)) return null
  const res = await fetch(`${DIDIT_BASE}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
    headers: { 'x-api-key': process.env.DIDIT_API_KEY ?? '' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return null
  return await res.json().catch(() => null)
}

/** Age in whole years from an ISO date of birth (YYYY-MM-DD); null when unreadable. */
function ageFrom(dob: unknown): number | null {
  const m = typeof dob === 'string' ? dob.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const now = new Date()
  let age = now.getUTCFullYear() - y
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--
  return age >= 0 && age < 130 ? age : null
}

/** The age on the document - v3 plural arrays, the v2 singular as a fallback. */
function documentAge(decision: Record<string, any> | null | undefined): number | null {
  const d = decision?.decision ?? decision
  const ids: any[] = Array.isArray(d?.id_verifications) ? d.id_verifications : d?.id_verification ? [d.id_verification] : []
  for (const v of ids) {
    const a = ageFrom(v?.date_of_birth)
    if (a !== null) return a
    if (typeof v?.age === 'number' && v.age >= 0) return v.age
  }
  return null
}

/**
 * Record a session's outcome on its account. Only "Approved" with a document
 * showing 18 or over sets idVerifiedAt; an approval without a readable date of
 * birth, or under 18, is stored as "Declined (age)". A later Declined for the
 * account's CURRENT session (a reviewer overturning it) clears the approval; an
 * old session's update never touches a newer one. Idempotent - Didit retries.
 */
export async function applyDiditDecision(userId: number, sessionId: string, status: string, decision: Record<string, any> | null): Promise<{ verified: boolean; status: string }> {
  let current: string | null = null
  try {
    const rows = await prisma.$queryRaw<{ idVerificationSessionId: string | null }[]>`SELECT "idVerificationSessionId" FROM "User" WHERE id = ${userId}`
    current = rows[0]?.idVerificationSessionId ?? null
  } catch (e) {
    console.error('[id-verification] read failed:', (e as Error).message)
    return { verified: false, status }
  }
  if (status === 'Approved') {
    const age = documentAge(decision)
    if (age === null || age < 18) {
      if (current === sessionId || !current) {
        await prisma.$executeRaw`UPDATE "User" SET "idVerifiedAt" = NULL, "idVerificationStatus" = 'Declined (age)', "idVerificationSessionId" = ${sessionId} WHERE id = ${userId}`
      }
      return { verified: false, status: 'Declined (age)' }
    }
    // Any approved session of this account counts; it becomes the current one
    await prisma.$executeRaw`UPDATE "User" SET "idVerifiedAt" = COALESCE("idVerifiedAt", NOW()), "idVerificationStatus" = 'Approved', "idVerificationSessionId" = ${sessionId} WHERE id = ${userId}`
    return { verified: true, status: 'Approved' }
  }
  if (current && current !== sessionId) return { verified: false, status } // stale session: ignore
  if (status === 'Declined' || status === 'Kyc Expired') {
    await prisma.$executeRaw`UPDATE "User" SET "idVerifiedAt" = NULL, "idVerificationStatus" = ${status}, "idVerificationSessionId" = ${sessionId} WHERE id = ${userId}`
  } else {
    // In progress / in review / abandoned / expired: the status only (an
    // existing approval from this same session cannot be "in progress" again)
    await prisma.$executeRaw`UPDATE "User" SET "idVerificationStatus" = ${status}, "idVerificationSessionId" = ${sessionId} WHERE id = ${userId}`
  }
  return { verified: false, status }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.keys(v as object).sort().reduce((acc, k) => { (acc as any)[k] = sortKeys((v as any)[k]); return acc }, {} as Record<string, unknown>)
  return v
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * A Didit webhook is genuine: X-Signature-V2 (HMAC-SHA256 of the key-sorted,
 * compact JSON) or, failing that, X-Signature (HMAC of the exact raw bytes),
 * with X-Timestamp inside 5 minutes. No secret configured = nothing passes.
 */
export function verifyDiditWebhook(rawBody: string, headers: Headers): boolean {
  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret) return false
  const ts = parseInt(headers.get('x-timestamp') ?? '', 10)
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false
  const v2 = headers.get('x-signature-v2')
  if (v2) {
    try {
      const canonical = JSON.stringify(sortKeys(JSON.parse(rawBody)))
      if (safeEqualHex(createHmac('sha256', secret).update(canonical, 'utf8').digest('hex'), v2)) return true
    } catch { /* fall through to the raw-bytes signature */ }
  }
  const v1 = headers.get('x-signature')
  return !!v1 && safeEqualHex(createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'), v1)
}
