// CCBill FlexForms integration (server-only — holds the form salt).
//
// SECURITY MODEL
// - Prices/periods are defined HERE, server-side. The client sends only a
//   plan id; it can never tamper with amounts.
// - The FlexForm URL carries an MD5 formDigest computed with the account's
//   salt (CCBill rejects mismatched pricing), so the salt must never reach
//   the client. MD5 is CCBill's required digest algorithm, not our choice.
// - Webhooks are verified with a shared secret in the URL (CCBill does not
//   sign payloads) + a clientAccnum match; the handler fails closed.
//
// SETUP (all in .env.local / Vercel env — nothing goes live until present):
//   CCBILL_CLIENT_ACCNUM   6-digit merchant account number
//   CCBILL_CLIENT_SUBACC   4-digit subaccount (e.g. 0000)
//   CCBILL_FLEXFORM_ID     FlexForm GUID from the FlexForms admin
//   CCBILL_SALT            "Dynamic Pricing" salt/encryption key from CCBill
//                          support (Account Info → sub account → Advanced)
//   CCBILL_WEBHOOK_SECRET  Long random string; the webhook URL registered in
//                          the CCBill admin must be
//                          https://<site>/api/webhooks/ccbill?secret=<this>
// Webhook events to enable in the CCBill admin: NewSaleSuccess,
// RenewalSuccess, Cancellation, Expiration, Chargeback, Refund.

import crypto from 'crypto'

export type CcbillPlan = {
  id: 'biweekly' | 'monthly'
  name: string
  price: number          // USD, charged per cycle
  periodDays: number     // recurring period in days
  tickets: number        // tickets credited per successful charge
}

// Server-authoritative plan catalog (yearly was dropped by product decision
// 2026-07 — only these plans can be purchased, whatever the client sends)
export const CCBILL_PLANS: CcbillPlan[] = [
  { id: 'biweekly', name: 'Biweekly Plan', price: 20, periodDays: 14, tickets: 250 },
  { id: 'monthly',  name: 'Monthly Plan',  price: 40, periodDays: 30, tickets: 500 },
]

export function getCcbillPlan(id: unknown): CcbillPlan | undefined {
  return CCBILL_PLANS.find(p => p.id === id)
}

const CURRENCY_USD = '840'
const FLEXFORM_BASE = 'https://api.ccbill.com/wap-frontflex/flexforms'

type CcbillConfig = {
  clientAccnum: string
  clientSubacc: string
  flexformId: string
  salt: string
}

function readConfig(): CcbillConfig | null {
  const clientAccnum = process.env.CCBILL_CLIENT_ACCNUM
  const clientSubacc = process.env.CCBILL_CLIENT_SUBACC
  const flexformId = process.env.CCBILL_FLEXFORM_ID
  const salt = process.env.CCBILL_SALT
  if (!clientAccnum || !clientSubacc || !flexformId || !salt) return null
  return { clientAccnum, clientSubacc, flexformId, salt }
}

export function ccbillConfigured(): boolean {
  return readConfig() !== null
}

// Recurring-transaction digest per CCBill's dynamic pricing spec:
// md5(initialPrice + initialPeriod + recurringPrice + recurringPeriod +
//     numRebills + currencyCode + salt)
export function buildFlexFormUrl(opts: {
  plan: CcbillPlan
  userId: number
}): string | null {
  const cfg = readConfig()
  if (!cfg) return null
  const initialPrice = opts.plan.price.toFixed(2)
  const initialPeriod = String(opts.plan.periodDays)
  const recurringPrice = initialPrice
  const recurringPeriod = initialPeriod
  const numRebills = '99' // 99 = rebill until cancelled
  const formDigest = crypto
    .createHash('md5')
    .update(initialPrice + initialPeriod + recurringPrice + recurringPeriod + numRebills + CURRENCY_USD + cfg.salt)
    .digest('hex')

  const params = new URLSearchParams({
    clientAccnum: cfg.clientAccnum,
    clientSubacc: cfg.clientSubacc,
    initialPrice,
    initialPeriod,
    recurringPrice,
    recurringPeriod,
    numRebills,
    currencyCode: CURRENCY_USD,
    formDigest,
    // Custom passthrough fields — echoed back on every webhook for this sub
    'X-userId': String(opts.userId),
    'X-planId': opts.plan.id,
  })
  return `${FLEXFORM_BASE}/${cfg.flexformId}?${params.toString()}`
}

// Constant-time webhook secret check (fail closed when unconfigured)
export function verifyWebhookSecret(provided: string | null): boolean {
  const expected = process.env.CCBILL_WEBHOOK_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function expectedClientAccnum(): string | null {
  return process.env.CCBILL_CLIENT_ACCNUM ?? null
}
