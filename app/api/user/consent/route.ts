// app/api/user/consent/route.ts
// API route for managing user consent preferences

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updateUserConsent } from '@/lib/prompt-intelligence';


export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const consent = await prisma.userConsent.findUnique({
      where: { userId: parseInt(userId) },
    });

    return NextResponse.json(consent || { optInTraining: false, optInAnalytics: true });
  } catch (error) {
    console.error('Failed to fetch consent:', error);
    return NextResponse.json({ error: 'Failed to fetch consent' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, optInTraining, optInAnalytics } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    await updateUserConsent(userId, optInTraining, optInAnalytics);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update consent:', error);
    return NextResponse.json({ error: 'Failed to update consent' }, { status: 500 });
  }
}
