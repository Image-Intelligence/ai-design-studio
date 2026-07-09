import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


// POST - Create new feedback
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, userEmail, type, subject, message } = body;

    if (!userEmail || !type || !subject || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId: userId || null,
        userEmail,
        type,
        subject,
        message,
        status: 'pending',
      },
    });

    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Feedback POST error:', error);
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  }
}

// GET - Get all feedback (admin only)
// Admin auth via header — never the query string (query strings leak into
// server/proxy access logs and browser history).
function checkAdmin(request: Request) {
  const pass = process.env.ADMIN_PASSWORD;
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false;
  return request.headers.get('x-admin-password') === pass;
}

export async function GET(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const feedbacks = await prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(feedbacks);
  } catch (error) {
    console.error('Feedback GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
  }
}

// PUT - Update feedback status (admin only) — single or bulk
export async function PUT(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const { id, ids, status, adminNotes } = body;

    // Bulk update
    if (Array.isArray(ids) && ids.length > 0) {
      const updateData: Record<string, unknown> = {};
      if (status !== undefined) updateData.status = status;
      if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

      const result = await prisma.feedback.updateMany({
        where: { id: { in: ids } },
        data: updateData,
      });
      return NextResponse.json({ success: true, count: result.count });
    }

    // Single update
    if (!id) {
      return NextResponse.json({ error: 'Missing feedback ID or IDs' }, { status: 400 });
    }

    const feedback = await prisma.feedback.update({
      where: { id },
      data: { status, adminNotes },
    });

    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Feedback PUT error:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
}

// DELETE - Delete feedback (admin only) — single (query params) or bulk (request body)
export async function DELETE(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('id');

    // Attempt to read body for bulk deletes
    let bodyIds: number[] | undefined;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const body = await request.json();
        bodyIds = body.ids;
      } catch {
        // no body or unparseable — fine
      }
    }

    // Bulk delete via body
    if (Array.isArray(bodyIds) && bodyIds.length > 0) {
      const result = await prisma.feedback.deleteMany({
        where: { id: { in: bodyIds } },
      });
      return NextResponse.json({ success: true, count: result.count });
    }

    // Single delete via query param
    if (!queryId) {
      return NextResponse.json({ error: 'Missing feedback ID' }, { status: 400 });
    }

    await prisma.feedback.delete({ where: { id: parseInt(queryId) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feedback DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete feedback' }, { status: 500 });
  }
}
