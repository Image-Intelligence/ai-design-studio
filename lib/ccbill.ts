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
//   CCBILL_DATALINK_USERNAME / CCBILL_DATALINK_PASSWORD
//                          (optional) a DataLink user from the CCBill admin -
//                          lets /subscriptions cancel a plan's renewal itself.
//                          Without it the page sends people to CCBill's own
//                          cancellation page, which always works.
// Webhook events to enable in the CCBill admin: NewSaleSuccess,
// RenewalSuccess, Cancellation, Expiration, Chargeback, Refund.

import crypto from 'crypto'

// The plan catalog lives in lib/dev-tier-plans.ts (plain data, so the
// subscribe page can import the very same list); re-exported here.
import { CCBILL_PLANS, type CcbillPlan } from '@/lib/dev-tier-plans'
export { CCBILL_PLANS, type CcbillPlan, type CcbillPlanId } from '@/lib/dev-tier-plans'

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
  /**
   * A plan change (2026-10-08): our Subscription.id this purchase replaces.
   * The old one is cancelled only AFTER the new payment succeeds (webhook
   * NewSaleSuccess), so a declined card never leaves anyone without a plan.
   */
  replacesSubscriptionId?: number
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
    ...(opts.replacesSubscriptionId ? { 'X-replaces': String(opts.replacesSubscriptionId) } : {}),
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

// ── DataLink: cancelling a renewal from our side ───────────────────────────
// CCBill's Subscription Management service (DataLink). The call below follows
// the form CCBill documents to merchants (subscriptionManagement.cgi,
// action=cancelSubscription, a "1" result on success) - CONFIRM the exact
// parameters with CCBill when DataLink is switched on; until both env vars
// exist nothing here runs and the page falls back to CCBill's own
// cancellation page (support.ccbill.com).
const DATALINK_URL = 'https://datalink.ccbill.com/utils/subscriptionManagement.cgi'

export function ccbillDatalinkConfigured(): boolean {
  return !!(process.env.CCBILL_DATALINK_USERNAME && process.env.CCBILL_DATALINK_PASSWORD
    && process.env.CCBILL_CLIENT_ACCNUM && process.env.CCBILL_CLIENT_SUBACC)
}

/** Stop a subscription's future rebills. Access to the paid period is untouched. */
export async function ccbillCancelSubscription(subscriptionId: string): Promise<{ ok: boolean; detail?: string }> {
  if (!ccbillDatalinkConfigured()) return { ok: false, detail: 'DataLink is not configured' }
  const params = new URLSearchParams({
    clientAccnum: process.env.CCBILL_CLIENT_ACCNUM!,
    clientSubacc: process.env.CCBILL_CLIENT_SUBACC!,
    username: process.env.CCBILL_DATALINK_USERNAME!,
    password: process.env.CCBILL_DATALINK_PASSWORD!,
    action: 'cancelSubscription',
    subscriptionId,
  })
  try {
    const res = await fetch(`${DATALINK_URL}?${params}`, { signal: AbortSignal.timeout(20_000) })
    const text = (await res.text()).trim()
    // The response is a tiny CSV ("results" then 1 / 0 / a negative error code)
    const lines = text.split(/\r?\n/).map(l => l.replace(/"/g, '').trim()).filter(Boolean)
    const ok = res.ok && lines.includes('1')
    return ok ? { ok: true } : { ok: false, detail: text.slice(0, 200) || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}

/** Where a customer cancels or manages a CCBill purchase themselves. */
export const CCBILL_SUPPORT_URL = 'https://support.ccbill.com'
