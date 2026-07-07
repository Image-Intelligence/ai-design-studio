// app/api/training/save-generation/route.ts
// Saves all user generations to training database

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


export async function POST(req: NextRequest) {
  try {
    const {
      userId,
      celebrityName,      // NEW
      enhancement,        // NEW
      prompt,
      model,
      quality,
      aspectRatio,
      imageUrl,
      success,
      errorMessage,
      isDiluted,          // NEW
      isGem,              // NEW
    } = await req.json();

    if (!userId || !prompt || !model) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Calculate approximate token count
    const promptTokens = Math.ceil(prompt.split(' ').length * 1.3);

    // Save to training database
    const trainingData = await prisma.generationTrainingData.create({
      data: {
        userId,
        celebrityName: celebrityName || null,  // NEW: Save name
        enhancement: enhancement || null,      // NEW: Save enhancement
        prompt,
        model,
        quality: quality || '2k',
        aspectRatio: aspectRatio || '1:1',
        imageUrl: imageUrl || '',
        success: success || false,
        errorMessage: errorMessage || null,
        promptTokens,
        isDiluted: isDiluted || false,         // NEW: Save diluted flag
        isGem: isGem || false,                 // NEW: Save gem flag
      },
    });

    return NextResponse.json({
      success: true,
      trainingId: trainingData.id,
    });
  } catch (error) {
    console.error('Failed to save training data:', error);
    return NextResponse.json(
      { error: 'Failed to save training data' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve training data for analysis
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const model = searchParams.get('model');
    const successOnly = searchParams.get('successOnly') === 'true';

    const where: any = {};
    if (userId) where.userId = parseInt(userId);
    if (model) where.model = model;
    if (successOnly) where.success = true;

    const trainingData = await prisma.generationTrainingData.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        celebrityName: true,  // NEW: Include in results
        enhancement: true,    // NEW: Include in results
        prompt: true,
        model: true,
        success: true,
        errorMessage: true,
        userRating: true,
        isDiluted: true,      // NEW: Include in results
        isGem: true,          // NEW: Include in results
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: trainingData,
      count: trainingData.length,
    });
  } catch (error) {
    console.error('Failed to fetch training data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch training data' },
      { status: 500 }
    );
  }
}
