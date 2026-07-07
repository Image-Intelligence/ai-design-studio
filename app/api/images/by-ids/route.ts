// app/api/images/by-ids/route.ts
// Fetch multiple images by their IDs (for optimized session loading)

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


export async function POST(req: NextRequest) {
  try {
    const { imageIds } = await req.json();
    
    if (!Array.isArray(imageIds)) {
      return NextResponse.json(
        { error: 'imageIds must be an array' },
        { status: 400 }
      );
    }
    
    // Fetch images from database
    const images = await prisma.generatedImage.findMany({
      where: {
        id: { in: imageIds }
      },
      select: {
        id: true,
        imageUrl: true,
        prompt: true,
        model: true,
        quality: true,
        aspectRatio: true,
        createdAt: true,
      }
    });
    
    return NextResponse.json({
      success: true,
      images
    });
  } catch (error) {
    console.error('Failed to fetch images by IDs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
