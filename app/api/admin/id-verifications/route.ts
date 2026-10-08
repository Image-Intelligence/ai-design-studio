import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { jsonPrivate } from '@/lib/api-json'
import { checkAdminRequest } from '@/lib/admin-check'
import { applyDiditDecision, fetchDiditDecision, idVerificationAvailable } from '@/lib/id-verification'

/**
 * Admin console for ID verification (Didit) - /admin/id-verifications.
 *
 * GET  ?filter=&q=&page=  -> { counts, rows, page, pages, config }
 * POST { action: 'refresh' | 'reset', userId }
 *
 * Buckets, from the columns lib/id-verification writes:
 *   verified     idVerifiedAt set (Approved + 18 or over)
 *   review       Didit's "In Review" - a Didit reviewer has it
 *   progress     started and not finished (Not Started / In Progress / Awaiting User / Resubmitted)
 *   declined     Declined, "Declined (age)" (our 18+ check) or Kyc Expired
 *   abandoned    Abandoned / Expired - they left the Didit page
 *   started      everyone who ever opened the popup (terms accepted or a session) - the default view
 *
 * "refresh" re-reads the account's current session from Didit and applies it
 * exactly as the return redirect / webhook would - the fix when a webhook was
 * missed (it can't reach localhost; Didit retries only twice). "reset" clears
 * the verification so the account must verify again (terms acceptance kept).
 * There is deliberately no "mark verified" - an approval only ever comes from
 * Didit, which is what the card-network rule asks for.
 */

const PAGE_SIZE = 50
const IN_PROGRESS = ['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted']
const ABANDONED = ['Abandoned', 'Expired']

function bucketWhere(filter: string): Prisma.Sql {
  switch (filter) {
    case 'verified': return Prisma.sql`"idVerifiedAt" IS NOT NULL`
    case 'review': return Prisma.sql`"idVerifiedAt" IS NULL AND "idVerificationStatus" = 'In Review'`
    case 'progress': return Prisma.sql`"idVerifiedAt" IS NULL AND "idVerificationStatus" IN (${Prisma.join(IN_PROGRESS)})`
    case 'declined': return Prisma.sql`"idVerifiedAt" IS NULL AND ("idVerificationStatus" LIKE 'Declined%' OR "idVerificationStatus" = 'Kyc Expired')`
    case 'abandoned': return Prisma.sql`"idVerifiedAt" IS NULL AND "idVerificationStatus" IN (${Prisma.join(ABANDONED)})`
    case 'all': return Prisma.sql`TRUE`
    default: return Prisma.sql`("idVerificationStatus" IS NOT NULL OR "idVerifiedAt" IS NOT NULL OR "contentTermsAcceptedAt" IS NOT NULL)`
  }
}

export async function GET(req: Request) {
  if (!(await checkAdminRequest(req))) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') ?? 'started'
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1)
  const search = q ? Prisma.sql`AND email ILIKE ${'%' + q + '%'}` : Prisma.empty

  try {
    const [c] = await prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT
        COUNT(*) FILTER (WHERE "idVerifiedAt" IS NOT NULL) AS verified,
        COUNT(*) FILTER (WHERE "idVerifiedAt" IS NULL AND "idVerificationStatus" = 'In Review') AS review,
        COUNT(*) FILTER (WHERE "idVerifiedAt" IS NULL AND "idVerificationStatus" IN (${Prisma.join(IN_PROGRESS)})) AS progress,
        COUNT(*) FILTER (WHERE "idVerifiedAt" IS NULL AND ("idVerificationStatus" LIKE 'Declined%' OR "idVerificationStatus" = 'Kyc Expired')) AS declined,
        COUNT(*) FILTER (WHERE "idVerifiedAt" IS NULL AND "idVerificationStatus" IN (${Prisma.join(ABANDONED)})) AS abandoned,
        COUNT(*) FILTER (WHERE "idVerificationStatus" IS NOT NULL OR "idVerifiedAt" IS NOT NULL OR "contentTermsAcceptedAt" IS NOT NULL) AS started,
        COUNT(*) AS "all"
      FROM "User"`
    const where = bucketWhere(filter)
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "User" WHERE ${where} ${search}`
    // Newest activity first: an approval's date, else the account's age
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, email, name, "createdAt", "idVerifiedAt", "idVerificationStatus", "idVerificationSessionId", "contentTermsAcceptedAt"
      FROM "User" WHERE ${where} ${search}
      ORDER BY COALESCE("idVerifiedAt", "contentTermsAcceptedAt", "createdAt") DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`
    return jsonPrivate({
      counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)])),
      rows,
      page,
      pages: Math.max(1, Math.ceil(Number(n) / PAGE_SIZE)),
      config: {
        available: idVerificationAvailable(),
        webhookSecret: !!process.env.DIDIT_WEBHOOK_SECRET,
        webhookUrl: `${process.env.APP_URL || 'https://prompt-protocol.vercel.app'}/api/id-verification/webhook`,
      },
    })
  } catch (e) {
    // The columns are added out of band (scratchpad DDL) - say so rather than 500 blind
    console.error('[admin/id-verifications] query failed:', e)
    return jsonPrivate({ error: 'Could not read verification data - are the ID verification columns on "User"?' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!(await checkAdminRequest(req))) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { action?: string; userId?: number }
  const userId = Number(body.userId)
  if (!Number.isInteger(userId) || userId <= 0) return jsonPrivate({ error: 'Pick an account' }, { status: 400 })

  if (body.action === 'reset') {
    await prisma.$executeRaw`UPDATE "User" SET "idVerifiedAt" = NULL, "idVerificationStatus" = NULL, "idVerificationSessionId" = NULL WHERE id = ${userId}`
    return jsonPrivate({ ok: true, status: null, verified: false })
  }

  if (body.action === 'refresh') {
    const [row] = await prisma.$queryRaw<{ idVerificationSessionId: string | null }[]>`SELECT "idVerificationSessionId" FROM "User" WHERE id = ${userId}`
    const sessionId = row?.idVerificationSessionId
    if (!sessionId) return jsonPrivate({ error: 'This account has no Didit session yet' }, { status: 400 })
    const decision = await fetchDiditDecision(sessionId).catch(() => null)
    if (!decision) return jsonPrivate({ error: "Didit didn't return this session - check the API key or the session in Didit's console" }, { status: 502 })
    // The same ownership rule as the return redirect: the session must be this account's
    if (String(decision.vendor_data ?? '') !== String(userId)) return jsonPrivate({ error: 'That session belongs to a different account' }, { status: 409 })
    const r = await applyDiditDecision(userId, sessionId, String(decision.status ?? 'In Progress'), decision)
    return jsonPrivate({ ok: true, ...r })
  }

  return jsonPrivate({ error: 'Unknown action' }, { status: 400 })
}
