import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkAdminRequest } from '@/lib/admin-check'
// Admins only (2026-10-23 sweep): /api/admin/* is not covered by proxy.ts (it
// gates pages), so every route here checks for itself - this one did not.

// GET - Fetch all queue items
export async function GET(request: Request) {
  if (!await checkAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const modelId = searchParams.get('modelId');
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: any = {};
    if (status) where.status = status;
    if (modelId) where.modelId = modelId;

    const items = await prisma.generationQueue.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { queuedAt: 'asc' }
      ],
      take: limit
    });

    // Update queue positions for queued items
    const queuedItems = items.filter(item => item.status === 'queued');
    for (let i = 0; i < queuedItems.length; i++) {
      if (queuedItems[i].queuePosition !== i + 1) {
        await prisma.generationQueue.update({
          where: { id: queuedItems[i].id },
          data: { queuePosition: i + 1 }
        });
        queuedItems[i].queuePosition = i + 1;
      }
    }

    return NextResponse.json({ success: true, items });
  } catch (error) {
    console.error('Failed to fetch queue items:', error);
    return NextResponse.json({ error: 'Failed to fetch queue items' }, { status: 500 });
  }
}
