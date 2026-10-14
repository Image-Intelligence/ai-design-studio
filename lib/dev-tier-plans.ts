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
  tickets: number        // the plan's monthly ticket bar: each renewal REFILLS to it (lib/plan-tickets)
  packDiscountPct: number // off every ticket pack while on this plan
}

// Server-authoritative plan catalog - only these plans can be purchased,
// whatever the client sends.
//
// Re-cut 2026-10-13 to THREE plans (Studio retired - nobody was on it).
// Shared perks: 6 image + 2 video at once, 500 refs, every studio. They differ
// by the monthly ticket bar, the daily free AI text actions (lib/prompt-enhance)
// and the pack discount - 10% / 15% / 20% (owner, 2026-10-13: only the top
// tier gets 20%). Plan tickets are a BAR, not a pile: each renewal refills the
// account back up to the plan's tickets and plan tickets end with the plan;
// pack (and bonus) tickets never expire (lib/plan-tickets). A bigger
// plan now buys tickets a little cheaper - $0.080 / $0.077 / $0.074 - which
// still clears ~30% after CCBill's cut against the $0.04 a ticket costs at
// most to serve:  $19.99/250, $49.99/650, $99.99/1350 (CCBill's $99.99 cap).
export const CCBILL_PLANS: CcbillPlan[] = [
  { id: 'creator', name: 'Creator', price: 19.99, periodDays: 30, cycle: 'monthly', tickets: 250,  packDiscountPct: 10 },
  { id: 'pro',     name: 'Pro',     price: 49.99, periodDays: 30, cycle: 'monthly', tickets: 650,  packDiscountPct: 15 },
  { id: 'max',     name: 'Max',     price: 99.99, periodDays: 30, cycle: 'monthly', tickets: 1350, packDiscountPct: 20 },
]

/** A plan by id (client-safe twin of lib/ccbill getCcbillPlan). */
export const findPlan = (id: unknown): CcbillPlan | undefined => CCBILL_PLANS.find(p => p.id === id)

/** The pack discount for a plan id; a Dev Tier account with no known plan (a manual grant) gets the lowest. */
export const packDiscountFor = (planId: unknown): number =>
  findPlan(planId)?.packDiscountPct ?? Math.min(...CCBILL_PLANS.map(p => p.packDiscountPct))

/** A pack's price at a discount, to the cent. */
export const packPriceAt = (freeTierPrice: number, discountPct: number): number =>
  Math.round(freeTierPrice * (100 - discountPct)) / 100

/** USD per ticket a plan works out to. */
export const planUsdPerTicket = (p: CcbillPlan) => p.price / p.tickets
