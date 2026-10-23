import prisma from '@/lib/prisma'
import { findPlan, packDiscountFor, packPriceAt } from '@/lib/dev-tier-plans'
import { findDevTierSubscription } from '@/lib/dev-tier'

/**
 * Plan tickets are a BAR that refills, not a pile (owner, 2026-10-13).
 *
 * A Creator / Pro / Max plan gives the account 250 / 650 / 1,350 tickets a
 * month. At each renewal the account is topped back UP to that number - a Max
 * user who used 500 gets 500 back, not another 1,350 - so unused plan tickets
 * never accumulate into a liability that shows up later as fal bills. Plan
 * tickets end with the plan.
 *
 * Ticket PACKS (and admin bonus tickets) are different: they were paid for
 * one by one and never expire.
 *
 * Both live in the ONE Ticket.balance every route already reads and deducts,
 * so nothing that spends tickets had to change. The split is bookkeeping on
 * the subscription: metadata.packTickets = how much of the balance is pack
 * tickets. Spending comes out of plan tickets first, which needs no code at
 * all - the pack share is simply clamped to the balance whenever we look:
 *
 *   pack = min(metadata.packTickets, balance)      plan = balance - pack
 *
 * (A failed generation's refund lands in the plan share; at worst that is a
 * ticket topped up at the next refill instead of kept - never a loss of more.)
 */

type Meta = Record<string, unknown>
const metaOf = (sub: { metadata: unknown }): Meta => (sub.metadata as Meta | null) ?? {}

/** The monthly ticket bar of a subscription (0 = not a refillable plan, e.g. an old manual grant). */
export function planCap(sub: { metadata: unknown }): number {
  const m = metaOf(sub)
  return findPlan(m.planId)?.tickets ?? (typeof m.ticketsPerCycle === 'number' ? m.ticketsPerCycle : 0)
}

/** Split a balance into pack and plan shares. */
export function splitBalance(balance: number, packTickets: unknown): { pack: number; plan: number } {
  const recorded = typeof packTickets === 'number' && isFinite(packTickets) ? packTickets : balance
  const pack = Math.max(0, Math.min(Math.floor(recorded), balance))
  return { pack, plan: Math.max(0, balance - pack) }
}

async function balanceOf(userId: number): Promise<number> {
  return (await prisma.ticket.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0
}

/** One metadata key set merged in place (a jsonb merge - never a stale read-modify-write over a concurrent claim). */
async function writeMeta(subId: number, patch: Meta) {
  await prisma.$executeRaw`UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb WHERE id = ${subId}`
}

/*
 * ── Exactly once, retry-safe (billing sweep 2026-10-23) ─────────────────────
 * start / refill / end used to read the balance, then write it, then write the
 * subscription's metadata - three separate statements with no claim:
 *  - endPlanTickets runs from settleEndedPlans on EVERY planTicketsState view;
 *    two views at the moment a plan ends both saw planTicketsOpen=true and
 *    both removed "the plan share" - the second one ate paid PACK tickets.
 *  - a crash between the credit and the metadata write (or a webhook retry)
 *    either lost the credit or could give it twice.
 * Now each one runs in ONE transaction that first CLAIMS the subscription
 * with a conditional UPDATE on its metadata (planTicketsOpen / planStartCredited
 * / the renewal's transaction id): only the request whose UPDATE changed a row
 * goes on, and if anything after the claim fails the whole thing rolls back,
 * so a retry finds it unclaimed and does it then.
 */

type PlanFill = { credited: number; before: number; after: number; already?: boolean }

/**
 * A plan starts (first payment). Everything the account already holds is pack
 * tickets - except, on a plan CHANGE, the old plan's unused plan tickets, which
 * count toward the new plan's bar (the new plan refills to its own number).
 * Returns the tickets credited and the balance before / after; `already` when
 * this subscription's start was credited before (a redelivered webhook).
 */
export async function startPlanTickets(sub: { id: number; userId: number; metadata: unknown }, replaced?: { id?: number; metadata: unknown } | null): Promise<PlanFill> {
  const cap = planCap(sub)
  return prisma.$transaction(async (tx) => {
    // The claim: never credited (no flag, and never filled - lastRefillAt marks plans started before the flag existed)
    const claimed = await tx.$executeRaw`
      UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || '{"planStartCredited":true}'::jsonb
      WHERE id = ${sub.id}
        AND COALESCE(metadata::jsonb ->> 'planStartCredited', 'false') <> 'true'
        AND (metadata::jsonb -> 'lastRefillAt') IS NULL`
    const before = (await tx.ticket.findUnique({ where: { userId: sub.userId }, select: { balance: true } }))?.balance ?? 0
    if (!claimed) return { credited: 0, before, after: before, already: true }
    /*
     * A plan change: the replaced plan's tickets are closed IN THIS
     * transaction, before the new bar is credited (review fix 2026-10-23).
     * Closed later, there was a window where the old plan looked ended
     * (expired, planTicketsOpen still true) and settleEndedPlans ->
     * endPlanTickets(old) took "balance - old.packTickets" - the NEW plan's
     * freshly credited bar with it.
     */
    if (replaced?.id && replaced.id !== sub.id) {
      const closed = JSON.stringify({ planTicketsOpen: false, replacedBy: sub.id })
      await tx.$executeRaw`UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${closed}::jsonb WHERE id = ${replaced.id}`
    }
    const { pack, plan } = replaced ? splitBalance(before, metaOf(replaced).packTickets) : { pack: before, plan: 0 }
    const credit = Math.max(0, cap - plan)
    const after = credit > 0
      ? (await tx.ticket.upsert({
          where: { userId: sub.userId },
          create: { userId: sub.userId, balance: credit, totalBought: credit, totalUsed: 0 },
          update: { balance: { increment: credit }, totalBought: { increment: credit } },
          select: { balance: true },
        })).balance
      : before
    const patch = JSON.stringify({ packTickets: pack, planTicketsOpen: true, lastRefillAt: new Date().toISOString() })
    await tx.$executeRaw`UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb WHERE id = ${sub.id}`
    return { credited: credit, before, after }
  })
}

/**
 * A renewal: top the plan share back up to the plan's bar.
 * With `claim` (a payment provider's renewal transaction id), the renewal is
 * claimed in the same transaction: the subscription's last transaction id
 * moves to this one only if it is not already this one - so a redelivered or
 * concurrent renewal event refills nothing (`already`), and a refill that
 * fails rolls the claim back for the provider's retry.
 */
export async function refillPlanTickets(
  sub: { id: number; userId: number; metadata: unknown },
  claim?: { ccbillTransactionId: string; nextBillingDate?: Date | null },
): Promise<PlanFill> {
  const cap = planCap(sub)
  return prisma.$transaction(async (tx) => {
    if (claim) {
      const won = await tx.subscription.updateMany({
        where: { id: sub.id, OR: [{ ccbillLastTransactionId: null }, { ccbillLastTransactionId: { not: claim.ccbillTransactionId } }] },
        data: { status: 'active', ccbillLastTransactionId: claim.ccbillTransactionId, ...(claim.nextBillingDate ? { nextBillingDate: claim.nextBillingDate } : {}) },
      })
      if (won.count !== 1) {
        const b = (await tx.ticket.findUnique({ where: { userId: sub.userId }, select: { balance: true } }))?.balance ?? 0
        return { credited: 0, before: b, after: b, already: true }
      }
    }
    // The split is read fresh, inside the transaction (the caller's copy may be stale)
    const fresh = await tx.subscription.findUnique({ where: { id: sub.id }, select: { metadata: true } })
    const before = (await tx.ticket.findUnique({ where: { userId: sub.userId }, select: { balance: true } }))?.balance ?? 0
    const { pack, plan } = splitBalance(before, metaOf(fresh ?? sub).packTickets)
    const credit = Math.max(0, cap - plan)
    const after = credit > 0
      ? (await tx.ticket.upsert({
          where: { userId: sub.userId },
          create: { userId: sub.userId, balance: credit, totalBought: credit, totalUsed: 0 },
          update: { balance: { increment: credit }, totalBought: { increment: credit } },
          select: { balance: true },
        })).balance
      : before
    const patch = JSON.stringify({ packTickets: pack, planTicketsOpen: true, lastRefillAt: new Date().toISOString() })
    await tx.$executeRaw`UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb WHERE id = ${sub.id}`
    return { credited: credit, before, after }
  })
}

/** The plan ended (expired, refunded, charged back): its unused plan tickets go; pack tickets stay. Exactly once per plan. */
export async function endPlanTickets(sub: { id: number; userId: number; metadata: unknown }): Promise<{ removed: number }> {
  if (metaOf(sub).planTicketsOpen !== true) return { removed: 0 }
  return prisma.$transaction(async (tx) => {
    // The claim: only the request that flips planTicketsOpen true -> false removes anything
    const claimed = await tx.$executeRaw`
      UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || '{"planTicketsOpen":false}'::jsonb
      WHERE id = ${sub.id} AND metadata::jsonb ->> 'planTicketsOpen' = 'true'`
    if (!claimed) return { removed: 0 }
    const fresh = await tx.subscription.findUnique({ where: { id: sub.id }, select: { metadata: true } })
    const balance = (await tx.ticket.findUnique({ where: { userId: sub.userId }, select: { balance: true } }))?.balance ?? 0
    const { pack, plan } = splitBalance(balance, metaOf(fresh ?? sub).packTickets)
    // Down to 0 at most - never a negative balance (same rule as lib/ticket-gate removeTicketsFloored)
    if (plan > 0) await tx.$executeRaw`UPDATE "Ticket" SET balance = GREATEST(0, balance - ${plan}) WHERE "userId" = ${sub.userId}`
    const patch = JSON.stringify({ planTicketsEndedAt: new Date().toISOString(), packTickets: pack, planTicketsRemoved: plan })
    await tx.$executeRaw`UPDATE "Subscription" SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb WHERE id = ${sub.id}`
    return { removed: plan }
  })
}

/**
 * Pack or bonus tickets were just added to the balance (call AFTER the
 * increment): while a plan is running they are recorded as pack tickets, so
 * the next refill or the plan's end never touches them.
 */
export async function notePackTickets(userId: number, added: number) {
  if (added <= 0) return
  const sub = await findDevTierSubscription(userId)
  if (!sub || metaOf(sub).planTicketsOpen !== true) return
  const balance = await balanceOf(userId)
  const { pack } = splitBalance(balance - added, metaOf(sub).packTickets)
  await writeMeta(sub.id, { packTickets: pack + added })
}

/**
 * Plans whose paid period is over but that never got an Expiration event
 * (or were ended by hand): close their plan tickets. Called when the account
 * looks at its tickets, so it can't be missed for long.
 */
export async function settleEndedPlans(userId: number) {
  const now = new Date()
  const ended = await prisma.subscription.findMany({
    where: { userId, status: { in: ['cancelled', 'expired'] }, endDate: { lt: now } },
    select: { id: true, userId: true, metadata: true },
  })
  for (const s of ended) if (metaOf(s).planTicketsOpen === true) await endPlanTickets(s)
}

export type PlanTicketsState = {
  active: boolean
  planId: string | null
  planName: string | null
  cap: number
  planRemaining: number
  packTickets: number
  balance: number
  renewsAt: string | null
  ending: boolean
  packDiscountPct: number
  /** Admin accounts: shown as Max (like /subscriptions) - nothing is billed or refilled */
  admin?: boolean
}

/**
 * The plan an ADMIN account is shown on (2026-10-13): Max unless the admin
 * picked another on /subscriptions - nothing is billed either way. Kept in
 * User.portalPreferences.adminPlanId (shallow-merged JSON, see
 * /api/user/preferences), so it needs no column of its own.
 */
export async function adminPlanOf(userId: number) {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`
    SELECT "portalPreferences"->>'adminPlanId' AS id FROM "User" WHERE id = ${userId}`
  return findPlan(rows[0]?.id) ?? findPlan('max')!
}
export async function setAdminPlan(userId: number, planId: string) {
  await prisma.$executeRaw`
    UPDATE "User" SET "portalPreferences" = COALESCE("portalPreferences"::jsonb, '{}'::jsonb) || ${JSON.stringify({ adminPlanId: planId })}::jsonb
    WHERE id = ${userId}`
}

/** What the recharge display shows. Admins see the plan they picked (Max by default). */
export async function planTicketsState(userId: number, opts: { isAdmin?: boolean } = {}): Promise<PlanTicketsState> {
  await settleEndedPlans(userId).catch(() => {})
  const [sub, balance] = await Promise.all([findDevTierSubscription(userId), balanceOf(userId)])
  if (opts.isAdmin) {
    const max = await adminPlanOf(userId)
    const plan = Math.min(balance, max.tickets)
    return { active: true, planId: max.id, planName: max.name, cap: max.tickets, planRemaining: plan, packTickets: balance - plan, balance, renewsAt: null, ending: false, packDiscountPct: max.packDiscountPct, admin: true }
  }
  const cap = sub ? planCap(sub) : 0
  if (!sub || cap <= 0) {
    return { active: !!sub, planId: null, planName: null, cap: 0, planRemaining: 0, packTickets: balance, balance, renewsAt: null, ending: false, packDiscountPct: sub ? packDiscountFor(null) : 0 }
  }
  const m = metaOf(sub)
  // A plan from before refills existed has no split yet: treat what it holds as plan tickets up to the bar
  const { pack, plan } = splitBalance(balance, typeof m.packTickets === 'number' ? m.packTickets : Math.max(0, balance - cap))
  const plan0 = findPlan(m.planId)
  return {
    active: true,
    planId: plan0?.id ?? null,
    planName: plan0?.name ?? (typeof m.planName === 'string' ? m.planName : 'Dev Tier'),
    cap,
    planRemaining: plan,
    packTickets: pack,
    balance,
    renewsAt: (sub.status === 'cancelled' ? sub.endDate : sub.nextBillingDate)?.toISOString() ?? null,
    ending: sub.status === 'cancelled' || !sub.autoRenew,
    packDiscountPct: packDiscountFor(m.planId),
  }
}

/*
 * ── A ticket pack's price, decided on the SERVER (billing sweep 2026-10-23) ──
 * The PayPal pack routes took the amount (and the ticket count) from the
 * browser: POST /api/tickets/purchase {ticketsCount: 825, amount: 1} made a
 * real $1 order for 825 tickets, and the capture credited whatever the
 * order's reference said. The price now comes only from here: the pack must
 * be one of TICKET_PACKAGES (lib/ticket-pricing - the shop's own list), the
 * plan discount is the account's own (packDiscountFor, the same rule the
 * shop shows), and a discount code is re-validated against the database.
 * Prices themselves are unchanged - this only computes them where the buyer
 * can't edit them.
 */
export type PackPrice =
  | { ok: true; tickets: number; usd: number; listUsd: number; planDiscountPct: number; code: { id: number; code: string } | null }
  | { ok: false; error: string }

export async function packPriceFor(
  userId: number, tickets: unknown, discountCode?: unknown,
  /** codeClaimed: the code's one use was already claimed for THIS order (a capture being credited late) - it must exist, not be unused. */
  opts: { codeClaimed?: boolean } = {},
): Promise<PackPrice> {
  const { TICKET_PACKAGES } = await import('@/lib/ticket-pricing')
  const pack = TICKET_PACKAGES.find(p => p.tickets === Number(tickets))
  if (!pack) return { ok: false, error: 'That is not one of the ticket packs' }
  const sub = await findDevTierSubscription(userId)
  const planDiscountPct = sub ? packDiscountFor(metaOf(sub).planId) : 0
  let usd = planDiscountPct ? packPriceAt(pack.freeTierPrice, planDiscountPct) : pack.freeTierPrice
  let code: { id: number; code: string } | null = null
  if (typeof discountCode === 'string' && discountCode.trim()) {
    const d = await prisma.discountCode.findUnique({ where: { code: discountCode.trim().toUpperCase() }, include: { usedBy: { where: { userId } } } })
    if (!d) return { ok: false, error: 'That discount code is not valid' }
    if (opts.codeClaimed) {
      if (!d.usedBy.length) return { ok: false, error: 'That discount code was not applied to this order' }
      /*
       * Review fix 2026-10-23: a usage row only proves the code was claimed
       * ONCE - not for this order. An order captured outside our capture
       * route at the discounted price could ride on the earlier claim. The
       * one use is already spent if any pack bought with it was credited (the
       * capture route re-checks this under a lock inside its credit transaction).
       */
      const spent = await prisma.ticketPurchase.count({ where: { userId, discountCodeUsed: d.code } })
      if (spent) return { ok: false, error: 'That discount code was already used on another purchase' }
    } else {
      if (!d.isActive) return { ok: false, error: 'That discount code is not valid' }
      if (d.expiresAt && d.expiresAt < new Date()) return { ok: false, error: 'That discount code has expired' }
      if (d.usedBy.length) return { ok: false, error: 'You have already used that discount code' }
      if (d.usageLimit !== null && d.timesUsed >= d.usageLimit) return { ok: false, error: 'That discount code has reached its limit' }
    }
    usd = d.type === 'percentage' ? usd * (1 - Math.min(100, Math.max(0, d.value)) / 100) : usd - Math.max(0, d.value)
    code = { id: d.id, code: d.code }
  }
  usd = Math.round(usd * 100) / 100
  if (!(usd >= 0.01)) return { ok: false, error: 'That discount leaves nothing to pay - contact support' }
  return { ok: true, tickets: pack.tickets, usd, listUsd: pack.freeTierPrice, planDiscountPct, code }
}
