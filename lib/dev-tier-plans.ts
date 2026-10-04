// Dev Tier subscription plans - plain data with no server imports, shared by
// lib/ccbill.ts (checkout + webhooks, authoritative) and the subscribe page
// (display), so the two can never quote different plans.

export type CcbillPlanId = 'creator' | 'pro' | 'studio' | 'max'

export type CcbillPlan = {
  id: CcbillPlanId
  name: string
  price: number          // USD, charged per cycle
  periodDays: number     // recurring period in days
  cycle: 'monthly'       // what Subscription.billingCycle records
  tickets: number        // tickets credited per successful charge
}

// Server-authoritative plan catalog - only these plans can be purchased,
// whatever the client sends.
//
// Re-cut 2026-10-04: four monthly plans up to CCBill's $99.99 ceiling for a
// single charge (the biweekly $20 / monthly $40 pair is retired; yearly was
// dropped 2026-07). Every plan sells tickets at the $0.08 floor the model
// prices are built on (a ticket costs fal at most $0.04 -> 50% margin), so a
// bigger plan buys more tickets, not cheaper ones: $19.99/250, $39.99/500,
// $69.99/875, $99.99/1250 (each within 0.05% of $0.08 a ticket).
export const CCBILL_PLANS: CcbillPlan[] = [
  { id: 'creator', name: 'Creator', price: 19.99, periodDays: 30, cycle: 'monthly', tickets: 250 },
  { id: 'pro',     name: 'Pro',     price: 39.99, periodDays: 30, cycle: 'monthly', tickets: 500 },
  { id: 'studio',  name: 'Studio',  price: 69.99, periodDays: 30, cycle: 'monthly', tickets: 875 },
  { id: 'max',     name: 'Max',     price: 99.99, periodDays: 30, cycle: 'monthly', tickets: 1250 },
]

/** USD per ticket a plan works out to. */
export const planUsdPerTicket = (p: CcbillPlan) => p.price / p.tickets
