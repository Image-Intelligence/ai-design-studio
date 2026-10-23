import { NextResponse } from 'next/server';
import { syncActiveCounters } from '../stats/route';
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// POST - Force-sync all currentActive counters from ground truth.
// Fixes negative or drifted counters caused by double-decrements.
export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await syncActiveCounters();
    return NextResponse.json({ success: true, message: 'Active counters synced from queue ground truth' });
  } catch (error) {
    console.error('Failed to sync active counters:', error);
    return NextResponse.json({ error: 'Failed to sync counters' }, { status: 500 });
  }
}
