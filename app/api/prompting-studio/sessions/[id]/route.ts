// app/api/prompting-studio/sessions/[id]/route.ts
// Manages individual saved session operations

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


// GET - Load specific session
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const awaitedParams = await params;
    const sessionId = parseInt(awaitedParams.id);

    const session = await prisma.savedSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session: session,
    });
  } catch (error) {
    console.error('Failed to load session:', error);
    return NextResponse.json(
      { error: 'Failed to load session' },
      { status: 500 }
    );
  }
}

// PATCH - Rename session
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const awaitedParams = await params;
    const sessionId = parseInt(awaitedParams.id);
    const body = await req.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Session name is required' },
        { status: 400 }
      );
    }

    const updatedSession = await prisma.savedSession.update({
      where: { id: sessionId },
      data: { name: name.trim() },
    });

    return NextResponse.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    console.error('Failed to rename session:', error);
    return NextResponse.json(
      { error: 'Failed to rename session' },
      { status: 500 }
    );
  }
}

// DELETE - Delete session
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const awaitedParams = await params;
    const sessionId = parseInt(awaitedParams.id);

    await prisma.savedSession.delete({
      where: { id: sessionId },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}
