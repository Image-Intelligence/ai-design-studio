import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

type SyncResult = {
  subscriptionId: number;
  lsId: string;
  email: string;
  action: string;
  status: 'synced' | 'skipped' | 'failed' | 'discovered';
  error?: string;
};

const SUBSCRIPTION_VARIANT_MAP: Record<number, { tickets: number; billingCycle: string; price: number }> = {
  1377310: { tickets: 250,  billingCycle: 'biweekly', price: 20  },
  1377319: { tickets: 500,  billingCycle: 'monthly',  price: 40  },
  1377321: { tickets: 6000, billingCycle: 'yearly',   price: 480 },
}

async function fetchAllLsSubscriptions(apiKey: string, storeId: string): Promise<any[]> {
  const all: any[] = []
  let url = `https://api.lemonsqueezy.com/v1/subscriptions?filter[store_id]=${storeId}&page[size]=100`
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json' },
    })
    if (!res.ok) break
    const json = await res.json()
    all.push(...(json.data ?? []))
    url = json.links?.next ?? null
  }
  return all
}

// POST — bidirectional sync with LemonSqueezy for all subscriptions that have an lsSubscriptionId.
//
// What it does:
//   • LS sub exists, no DB record → discover & create (missed webhook recovery)
//   • Our DB active  + LS cancelled  → pull cancellation into DB
//     (unless metadata.manualOverrideAt is newer than LS updated_at — admin overrides are respected)
//   • Our DB active  + LS active     → update lsCurrentPeriodEnd / nextBillingDate from LS
//   • Our DB non-active + LS active  → push cancellation TO LS
//   • Both cancelled                 → no-op
export async function POST(req: NextRequest) {
  try {
    const password = req.headers.get('x-admin-password');
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lsApiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId  = process.env.LEMONSQUEEZY_STORE_ID;
    if (!lsApiKey) {
      return NextResponse.json({ error: 'LEMONSQUEEZY_API_KEY not configured' }, { status: 500 });
    }

    const results: SyncResult[] = [];

    // ── Phase 1: Discover LS subscriptions missing from our DB ────────────────
    // Catches cases where subscription_created webhook was never delivered.
    if (storeId) {
      const lsAllSubs = await fetchAllLsSubscriptions(lsApiKey, storeId)
      const knownLsIds = new Set(
        (await prisma.subscription.findMany({
          where: { lsSubscriptionId: { not: null } },
          select: { lsSubscriptionId: true },
        })).map(s => s.lsSubscriptionId!)
      )

      for (const lsSub of lsAllSubs) {
        const lsId = String(lsSub.id)
        if (knownLsIds.has(lsId)) continue

        const attrs      = lsSub.attributes
        const variantId  = attrs.variant_id as number
        const planInfo   = SUBSCRIPTION_VARIANT_MAP[variantId]
        if (!planInfo) continue // not one of our subscription variants

        const customData = attrs.custom_data ?? {}
        const userId     = parseInt(customData.user_id)
        if (!userId || isNaN(userId)) continue

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
        if (!user) continue

        const lsStatus  = attrs.status as string
        const renewsAt  = attrs.renews_at ? new Date(attrs.renews_at) : null
        const endsAt    = attrs.ends_at   ? new Date(attrs.ends_at)   : null
        const isActive  = !['cancelled', 'expired'].includes(lsStatus)

        try {
          // Reuse existing record for this user if one exists (avoids creating a duplicate)
          const existingForUser = await prisma.subscription.findFirst({
            where: { userId, tier: 'prompt-studio-dev' },
            orderBy: { createdAt: 'desc' },
          })

          const subData = {
            status:             isActive ? 'active' : lsStatus,
            startDate:          new Date(attrs.created_at),
            endDate:            endsAt ?? renewsAt,
            nextBillingDate:    renewsAt,
            billingAmount:      planInfo.price,
            billingCycle:       planInfo.billingCycle,
            autoRenew:          isActive,
            lsSubscriptionId:   lsId,
            lsVariantId:        variantId,
            lsCurrentPeriodEnd: renewsAt,
            cancelledAt:        !isActive ? new Date() : null,
            metadata: { ticketsPerCycle: planInfo.tickets, planId: planInfo.billingCycle, recoveredBySync: true },
          }

          const newSub = existingForUser
            ? await prisma.subscription.update({ where: { id: existingForUser.id }, data: subData })
            : await prisma.subscription.create({ data: { userId, tier: 'prompt-studio-dev', ...subData } })

          // Only deliver tickets if the subscription is still active
          if (isActive) {
            const ticketRecord = await prisma.ticket.findUnique({ where: { userId } })
            const prev = ticketRecord?.balance ?? 0
            await prisma.$transaction([
              prisma.ticket.upsert({
                where: { userId },
                update: { balance: { increment: planInfo.tickets }, totalBought: { increment: planInfo.tickets } },
                create: { userId, balance: planInfo.tickets, totalBought: planInfo.tickets },
              }),
              prisma.subscriptionTransaction.create({
                data: {
                  subscriptionId: newSub.id,
                  userId,
                  type: 'ticket_distribution',
                  ticketsAdded: planInfo.tickets,
                  previousBalance: prev,
                  newBalance: prev + planInfo.tickets,
                  description: `Dev Tier ${planInfo.billingCycle} — recovered by admin sync`,
                },
              }),
            ])
          }

          results.push({ subscriptionId: newSub.id, lsId, email: user.email, action: `discovered_and_created${isActive ? '+tickets' : '_cancelled'}`, status: 'discovered' })
        } catch (err: any) {
          results.push({ subscriptionId: 0, lsId, email: user.email, action: 'discover_failed', status: 'failed', error: err?.message })
        }
      }
    }

    // ── Phase 2: Reconcile existing DB records ─────────────────────────────────
    const allLsSubs = await prisma.subscription.findMany({
      where: { lsSubscriptionId: { not: null } },
      select: {
        id: true,
        lsSubscriptionId: true,
        status: true,
        cancelledAt: true,
        metadata: true,
        user: { select: { email: true } },
      },
    });

    for (const sub of allLsSubs) {
      try {
        const res = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions/${sub.lsSubscriptionId}`,
          {
            headers: {
              'Authorization': `Bearer ${lsApiKey}`,
              'Accept': 'application/vnd.api+json',
            },
          }
        );

        if (res.status === 404) {
          results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'not_found_on_ls', status: 'skipped' });
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'fetch_error', status: 'failed', error: `HTTP ${res.status}: ${text.substring(0, 100)}` });
          continue;
        }

        const lsData = await res.json();
        const attrs = lsData.data?.attributes;
        if (!attrs) {
          results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'parse_error', status: 'failed', error: 'Unexpected LS response' });
          continue;
        }

        const lsStatus: string    = attrs.status;
        const lsUpdatedAt         = attrs.updated_at ? new Date(attrs.updated_at) : null;
        const renewsAt            = attrs.renews_at  ? new Date(attrs.renews_at)  : null;
        const endsAt              = attrs.ends_at    ? new Date(attrs.ends_at)    : null;
        const lsIsActive          = !['cancelled', 'expired'].includes(lsStatus);
        const lsIsCancelled       = !lsIsActive;

        const meta: any           = sub.metadata ?? {};
        const manualOverrideAt    = meta.manualOverrideAt ? new Date(meta.manualOverrideAt) : null;
        // Admin override is "newer" only if it post-dates the last LS update
        const manualIsNewer       = !!(manualOverrideAt && lsUpdatedAt && manualOverrideAt > lsUpdatedAt);

        // ── Case 1: our DB active, LS cancelled ────────────────────────────────
        if (sub.status === 'active' && lsIsCancelled) {
          if (manualIsNewer) {
            results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'skip_manual_override', status: 'skipped' });
          } else {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { status: 'cancelled', cancelledAt: endsAt || new Date(), autoRenew: false },
            });
            results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'pulled_cancellation', status: 'synced' });
          }
          continue;
        }

        // ── Case 2: our DB non-active, LS active → push cancellation to LS ────
        if (sub.status !== 'active' && lsIsActive) {
          const cancelRes = await fetch(
            `https://api.lemonsqueezy.com/v1/subscriptions/${sub.lsSubscriptionId}`,
            {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${lsApiKey}`, 'Accept': 'application/vnd.api+json' },
            }
          );
          if (cancelRes.ok || cancelRes.status === 404) {
            results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'pushed_cancellation', status: 'synced' });
          } else {
            const text = await cancelRes.text().catch(() => '');
            results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'push_cancel_failed', status: 'failed', error: `HTTP ${cancelRes.status}: ${text.substring(0, 100)}` });
          }
          continue;
        }

        // ── Case 3: both active → update renewal dates ─────────────────────────
        if (sub.status === 'active' && lsIsActive) {
          if (renewsAt) {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { lsCurrentPeriodEnd: renewsAt, nextBillingDate: renewsAt },
            });
          }
          results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'updated_renewal', status: 'synced' });
          continue;
        }

        // ── Case 4: both cancelled → nothing to do ─────────────────────────────
        results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'already_in_sync', status: 'synced' });

      } catch (err: any) {
        results.push({ subscriptionId: sub.id, lsId: sub.lsSubscriptionId!, email: sub.user.email, action: 'error', status: 'failed', error: err?.message || 'Unknown error' });
      }
    }

    const synced     = results.filter(r => r.status === 'synced').length;
    const skipped    = results.filter(r => r.status === 'skipped').length;
    const failed     = results.filter(r => r.status === 'failed').length;
    const discovered = results.filter(r => r.status === 'discovered').length;

    return NextResponse.json({ success: true, synced, skipped, failed, discovered, results });
  } catch (error: any) {
    console.error('sync-ls error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
