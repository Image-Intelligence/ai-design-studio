import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromSession } from '@/lib/auth';
import { cookies } from 'next/headers';


export async function GET(request: Request) {
  try {
    // Check authentication
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const user = await getUserFromSession(token);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }

    // Parse pagination parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;

    // Get total count for pagination (videos only — all video models, not deleted)
    const total = await prisma.generatedImage.count({
      where: {
        userId: user.id,
        model: { in: ['wan-2.5', 'kling-v3', 'kling-o3'] },
        isDeleted: false,
      }
    });

    // Fetch paginated user's generated videos (not deleted, ordered by newest first)
    const videos = await prisma.generatedImage.findMany({
      where: {
        userId: user.id,
        model: { in: ['wan-2.5', 'kling-v3', 'kling-o3'] },
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit
    });

    return NextResponse.json({
      success: true,
      videos: videos.map(vid => {
        const metadata = vid.videoMetadata as any;
        return {
          id: vid.id,
          prompt: vid.prompt,
          videoUrl: vid.imageUrl, // Video URL stored in imageUrl field
          thumbnailUrl: metadata?.thumbnailUrl || vid.imageUrl,
          model: vid.model,
          duration: metadata?.duration || '5',
          resolution: metadata?.resolution || '1080p',
          createdAt: vid.createdAt,
          expiresAt: vid.expiresAt,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error: any) {
    console.error('Error fetching generated videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}
