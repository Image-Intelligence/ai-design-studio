import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // Derive the user from the session cookie — never from a client-supplied
    // ?userId. Previously any caller could read any user's balance by id (IDOR).
    const token = (await cookies()).get('session')?.value;
    const sessionUser = token ? await getUserFromSession(token) : null;
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const userIdNum = sessionUser.id;

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
