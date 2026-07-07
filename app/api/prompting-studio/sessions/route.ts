// app/api/prompting-studio/sessions/route.ts
// Manages saved sessions for prompting studio

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


// GET - List all saved sessions for user
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId' },
        { status: 400 }
      );
    }

    const sessions = await prisma.savedSession.findMany({
      where: { userId: parseInt(userId) },
      orderBy: { createdAt: 'desc' },
      take: 50, // Max 50 saved sessions
    });

    return NextResponse.json({
      success: true,
      sessions: sessions,
    });
  } catch (error) {
    console.error('Failed to fetch sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

// POST - Save new session
export async function POST(req: NextRequest) {
  try {
    const {
      userId,
      name,
      images,
      sharedReferenceImages,
      savedPrompts,
      scannerPanels,
      studioScanner,
      canvasMode,
      promptModel,
    } = await req.json();

    if (!userId || !name || !images) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check saved session limit
    const existingSessions = await prisma.savedSession.count({
      where: { userId: userId },
    });

    if (existingSessions >= 50) {
      return NextResponse.json(
        { error: 'Maximum 50 saved sessions allowed' },
        { status: 400 }
      );
    }

    // Create new session with complete state
    const session = await prisma.savedSession.create({
      data: {
        userId: userId,
        name: name,
        images: images,
        imageCount: images.length,
        sharedReferenceImages: sharedReferenceImages || [],
        savedPrompts: savedPrompts || [],
        scannerPanels: scannerPanels || [],
        studioScanner: studioScanner || {},
        canvasMode: canvasMode || 'studio',
        promptModel: promptModel || 'gemini-3-flash',
      },
    });

    return NextResponse.json({
      success: true,
      session: session,
    });
  } catch (error) {
    console.error('Failed to save session:', error);
    return NextResponse.json(
      { error: 'Failed to save session' },
      { status: 500 }
    );
  }
}
