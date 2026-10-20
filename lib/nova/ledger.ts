/**
 * Nova Studio - budgets and the spend ledger (server only).
 *
 * The user's LIMITS live in portalPreferences `novaBudget` (they set them, so
 * the browser may write them). What Nova has SPENT lives in `_nova`
 * {day, d, month, m}, written only here by one atomic jsonb UPDATE - the
 * preferences route strips `_nova` from every write - so a limit cannot be
 * dodged by resetting the counter.
 *
 * Spend is recorded for admins too (they are never charged, but the counters
 * and limits behave the same, so the studio can be tested end to end).
 */
import prisma from '@/lib/prisma'
import { sanitizeNovaBudget, type NovaBudget, type NovaSpend } from '@/lib/nova/config'

const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

export async function loadNovaBudget(userId: number): Promise<{ budget: NovaBudget; spend: NovaSpend }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { portalPreferences: true } })
  const p = (u?.portalPreferences ?? {}) as Record<string, any>
  const led = (p._nova ?? {}) as { day?: string; d?: number; month?: string; m?: number }
  return {
    budget: sanitizeNovaBudget(p.novaBudget),
    spend: {
      today: led.day === today() ? Number(led.d) || 0 : 0,
      month: led.month === thisMonth() ? Number(led.m) || 0 : 0,
    },
  }
}

export async function saveNovaBudget(userId: number, budget: NovaBudget): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "User"
    SET "portalPreferences" = COALESCE("portalPreferences"::jsonb, '{}'::jsonb) || jsonb_build_object('novaBudget', ${JSON.stringify(budget)}::jsonb)
    WHERE id = ${userId}`
}

/** Add tickets to today's and this month's spend (a new day / month starts from zero). */
export async function addNovaSpend(userId: number, tickets: number): Promise<NovaSpend> {
  const n = Math.max(0, Math.round(tickets))
  const day = today(), month = thisMonth()
  const rows = await prisma.$queryRaw<{ d: number; m: number }[]>`
    UPDATE "User"
    SET "portalPreferences" = jsonb_set(
      COALESCE("portalPreferences"::jsonb, '{}'::jsonb), '{_nova}',
      jsonb_build_object(
        'day', ${day}::text,
        'd', (CASE WHEN "portalPreferences"->'_nova'->>'day' = ${day}
                   THEN COALESCE(("portalPreferences"->'_nova'->>'d')::int, 0) ELSE 0 END) + ${n}::int,
        'month', ${month}::text,
        'm', (CASE WHEN "portalPreferences"->'_nova'->>'month' = ${month}
                   THEN COALESCE(("portalPreferences"->'_nova'->>'m')::int, 0) ELSE 0 END) + ${n}::int))
    WHERE id = ${userId}
    RETURNING ("portalPreferences"->'_nova'->>'d')::int AS d, ("portalPreferences"->'_nova'->>'m')::int AS m`
  return { today: rows[0]?.d ?? 0, month: rows[0]?.m ?? 0 }
}

/**
 * Room left under the user's limits, in tickets (Infinity = no limit). The
 * chat's own spend comes from the chat state; plans are checked separately.
 */
export function roomLeft(budget: NovaBudget, spend: NovaSpend, chatSpent: number): { room: number; which: string | null } {
  const limits: [number, string][] = []
  if (budget.perChat > 0) limits.push([budget.perChat - chatSpent, `this chat's limit of ${budget.perChat} tickets`])
  if (budget.daily > 0) limits.push([budget.daily - spend.today, `the daily limit of ${budget.daily} tickets`])
  if (budget.monthly > 0) limits.push([budget.monthly - spend.month, `the monthly limit of ${budget.monthly} tickets`])
  let best: [number, string | null] = [Infinity, null]
  for (const [r, w] of limits) if (r < best[0]) best = [r, w]
  return { room: Math.max(0, best[0]), which: best[1] }
}

/** What the user can spend right now: their balance less what running jobs hold (the same sum ticket-gate checks). */
export async function novaBalance(userId: number): Promise<number> {
  const t = await prisma.ticket.findUnique({ where: { userId }, select: { balance: true, reserved: true } })
  return Math.max(0, (t?.balance ?? 0) - Math.max(0, t?.reserved ?? 0))
}
