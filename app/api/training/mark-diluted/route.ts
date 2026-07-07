// app/api/training/mark-diluted/route.ts
// Marks images as diluted for AI training

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


export async function POST(req: NextRequest) {
  try {
    const { prompt, imageUrl, isDiluted } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Missing prompt' },
        { status: 400 }
      );
    }

    // Update training data record
    await prisma.generationTrainingData.updateMany({
      where: {
        prompt: prompt,
        ...(imageUrl && { imageUrl: imageUrl }),
      },
      data: {
        isDiluted: isDiluted,
      },
    });

    return NextResponse.json({
      success: true,
      isDiluted: isDiluted,
    });
  } catch (error) {
    console.error('Failed to mark as diluted:', error);
    return NextResponse.json(
      { error: 'Failed to update' },
      { status: 500 }
    );
  }
}
