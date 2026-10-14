import prisma from '@/lib/prisma'
import { findPlan, packDiscountFor } from '@/lib/dev-tier-plans'
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

async function adjust(userId: number, delta: number): Promise<{ before: number; after: number }> {
  const before = await balanceOf(userId)
  if (delta === 0) return { before, after: before }
  const t = await prisma.ticket.upsert({
    where: { userId },
    create: { userId, balance: Math.max(0, delta), totalBought: Math.max(0, delta), totalUsed: 0 },
    update: delta > 0
      ? { balance: { increment: delta }, totalBought: { increment: delta } }
      : { balance: { decrement: -delta } },
    select: { balance: true },
  })
  return { before, after: t.balance }
}

async function writeMeta(subId: number, patch: Meta) {
  const sub = await prisma.subscription.findUnique({ where: { id: subId }, select: { metadata: true } })
  await prisma.subscription.update({ where: { id: subId }, data: { metadata: { ...metaOf(sub ?? { metadata: null }), ...patch } as any } })
}

/**
 * A plan starts (first payment). Everything the account already holds is pack
 * tickets - except, on a plan CHANGE, the old plan's unused plan tickets, which
 * count toward the new plan's bar (the new plan refills to its own number).
 * Returns the tickets credited and the balance before / after.
 */
export async function startPlanTickets(sub: { id: number; userId: number; metadata: unknown }, replaced?: { metadata: unknown } | null) {
  const cap = planCap(sub)
  const balance = await balanceOf(sub.userId)
  const { pack, plan } = replaced ? splitBalance(balance, metaOf(replaced).packTickets) : { pack: balance, plan: 0 }
  const credit = Math.max(0, cap - plan)
  const bal = await adjust(sub.userId, credit)
  await writeMeta(sub.id, { packTickets: pack, planTicketsOpen: true, lastRefillAt: new Date().toISOString() })
  return { credited: credit, ...bal }
}

/** A renewal: top the plan share back up to the plan's bar. */
export async function refillPlanTickets(sub: { id: number; userId: number; metadata: unknown }) {
  const cap = planCap(sub)
  const balance = await balanceOf(sub.userId)
  const { pack, plan } = splitBalance(balance, metaOf(sub).packTickets)
  const credit = Math.max(0, cap - plan)
  const bal = await adjust(sub.userId, credit)
  await writeMeta(sub.id, { packTickets: pack, planTicketsOpen: true, lastRefillAt: new Date().toISOString() })
  return { credited: credit, ...bal }
}

/** The plan ended (expired, refunded, charged back): its unused plan tickets go; pack tickets stay. */
export async function endPlanTickets(sub: { id: number; userId: number; metadata: unknown }) {
  if (metaOf(sub).planTicketsOpen !== true) return { removed: 0 }
  const balance = await balanceOf(sub.userId)
  const { pack, plan } = splitBalance(balance, metaOf(sub).packTickets)
  if (plan > 0) await adjust(sub.userId, -plan)
  await writeMeta(sub.id, { planTicketsOpen: false, planTicketsEndedAt: new Date().toISOString(), packTickets: pack, planTicketsRemoved: plan })
  return { removed: plan }
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
