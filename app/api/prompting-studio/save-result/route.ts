// app/api/prompting-studio/save-result/route.ts
// Auto-saves test results to database

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


export async function POST(req: NextRequest) {
  try {
    const { 
      celebrityName, 
      baseStyle, 
      model, 
      userId,
      results // Array of test results
    } = await req.json();

    if (!celebrityName || !results || results.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create a test session
    const promptTest = await prisma.promptTest.create({
      data: {
        celebrityName,
        baseStyle,
        model,
        userId: userId || null,
      },
    });

    // Save all test results
    const testResults = await Promise.all(
      results.map((result: any) =>
        prisma.promptTestResult.create({
          data: {
            promptTestId: promptTest.id,
            level: result.level,
            prompt: result.prompt,
            status: result.status,
            imageUrl: result.imageUrl || null,
            errorMessage: result.error || null,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      testId: promptTest.id,
      resultCount: testResults.length,
    });
  } catch (error) {
    console.error('Failed to save test results:', error);
    return NextResponse.json(
      { error: 'Failed to save results' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve test results
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const celebrity = searchParams.get('celebrity');

    if (celebrity) {
      // Get all tests for a specific celebrity
      const tests = await prisma.promptTest.findMany({
        where: { celebrityName: celebrity },
        include: { results: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return NextResponse.json({ success: true, tests });
    }

    // Get recent tests
    const recentTests = await prisma.promptTest.findMany({
      include: {
        results: {
          select: {
            level: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ success: true, tests: recentTests });
  } catch (error) {
    console.error('Failed to fetch test results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch results' },
      { status: 500 }
    );
  }
}
