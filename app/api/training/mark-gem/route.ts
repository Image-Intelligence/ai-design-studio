// app/api/training/mark-gem/route.ts
// Marks images as gems (high quality) for AI training

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


export async function POST(req: NextRequest) {
  try {
    const { prompt, imageUrl, isGem } = await req.json();

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
        isGem: isGem,
      },
    });

    return NextResponse.json({
      success: true,
      isGem: isGem,
    });
  } catch (error) {
    console.error('Failed to mark as gem:', error);
    return NextResponse.json(
      { error: 'Failed to update' },
      { status: 500 }
    );
  }
}
