import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// POST - Clear completed queue items (optionally for a specific model)
export async function POST(request: Request) {
  if (!await checkAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}));
    const { modelId } = body;

    const whereClause: any = {
      OR: [
        { status: 'completed' },
        { status: 'cancelled' }
      ]
    };

    // If modelId is provided, only clear for that model
    if (modelId) {
      whereClause.modelId = modelId;
    }

    const result = await prisma.generationQueue.deleteMany({
      where: whereClause
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count
    });
  } catch (error) {
    console.error('Failed to clear completed items:', error);
    return NextResponse.json({ error: 'Failed to clear completed items' }, { status: 500 });
  }
}
