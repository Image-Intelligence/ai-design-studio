import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveRequestUser, requireScopes } from '@/lib/api-key-auth';


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // Derive the user from the bearer API key or session cookie — never from a
    // client-supplied ?userId (IDOR).
    const resolved = await resolveRequestUser(req);
    if ('error' in resolved) return resolved.error;
    const { user, apiAuth } = resolved;
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'tickets:read');
      if (denied) return denied;
    }
    const userIdNum = user.id;

    const ticket = await prisma.ticket.findUnique({
      where: { userId: userIdNum }
    });

    if (!ticket) {
      return NextResponse.json({
        success: true,
        balance: 0
      });
    }

    // Effective balance = total balance minus any tickets reserved for in-flight jobs.
    // This is what users see — tickets are only "spent" when a generation succeeds.
    const effectiveBalance = Math.max(0, ticket.balance - (ticket.reserved || 0));
    return NextResponse.json({
      success: true,
      balance: effectiveBalance,
      reserved: ticket.reserved || 0,
    });

  } catch (error: any) {
    console.error('Error fetching ticket balance:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch tickets' },
      { status: 500 }
    );
  }
}
