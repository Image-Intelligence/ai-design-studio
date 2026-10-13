// Dev Tier subscription plans - plain data with no server imports, shared by
// lib/ccbill.ts (checkout + webhooks, authoritative) and the subscribe page
// (display), so the two can never quote different plans.

export type CcbillPlanId = 'creator' | 'pro' | 'max'

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
// Re-cut 2026-10-13 to THREE plans (Studio retired - nobody was on it).
// Every plan carries the same perks (20% off packs, 6 image + 2 video at once,
// 500 refs, every studio, tickets that never expire); they differ by tickets
// a month and the daily free AI text actions (lib/prompt-enhance). A bigger
// plan now buys tickets a little cheaper - $0.080 / $0.077 / $0.074 - which
// still clears ~30% after CCBill's cut against the $0.04 a ticket costs at
// most to serve:  $19.99/250, $49.99/650, $99.99/1350 (CCBill's $99.99 cap).
export const CCBILL_PLANS: CcbillPlan[] = [
  { id: 'creator', name: 'Creator', price: 19.99, periodDays: 30, cycle: 'monthly', tickets: 250 },
  { id: 'pro',     name: 'Pro',     price: 49.99, periodDays: 30, cycle: 'monthly', tickets: 650 },
  { id: 'max',     name: 'Max',     price: 99.99, periodDays: 30, cycle: 'monthly', tickets: 1350 },
]

/** USD per ticket a plan works out to. */
export const planUsdPerTicket = (p: CcbillPlan) => p.price / p.tickets
