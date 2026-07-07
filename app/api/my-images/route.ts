import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { deleteFromR2 } from '@/lib/r2'


export async function GET(request: Request) {
  try {
    // Check authentication
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    // Parse pagination parameters
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit
    const type = searchParams.get('type') // 'image' | 'video' | null (all)
    const showHidden = searchParams.get('hidden') === 'true' // hidden-only view
    const falRequestIdsParam = searchParams.get('falRequestIds') // comma-separated list
    // Cursor (keyset) pagination — the feed sends the last item it has (createdAt + id).
    // Loading "everything older than this cursor" is O(limit) at any depth, unlike
    // skip/OFFSET which slows down the deeper you scroll. Falls back to page/skip
    // when no cursor is provided (keeps other callers working).
    const beforeParam = searchParams.get('before')     // ISO createdAt of last loaded item
    const beforeIdParam = searchParams.get('beforeId') // id of last loaded item (tiebreak)
    // cursorMode = the caller wants keyset responses (hasMore/nextCursor) — set on
    // EVERY feed request, including the first (which has no before yet = start at newest).
    // hasCursor = an actual bookmark is present to page from.
    const cursorMode = searchParams.get('cursor') === '1'
    const hasCursor = !!beforeParam && !!beforeIdParam

    const VIDEO_MODELS = ['wan-2.5', 'kling-v3', 'kling-o3', 'kling-v3-motion', 'seedance-1.5', 'seedance-2.0', 'seedance-2.0-fast', 'lipsync-v3']
    const typeFilter = type === 'image'
      ? { model: { notIn: VIDEO_MODELS } }
      : type === 'video'
      ? { model: { in: VIDEO_MODELS } }
      : {}

    // Fast path: fetch by specific FAL request IDs (used by iOS restore to detect completed-while-closed jobs)
    if (falRequestIdsParam) {
      const ids = falRequestIdsParam.split(',').map(s => s.trim()).filter(Boolean)
      const images = await prisma.generatedImage.findMany({
        where: { userId: user.id, isDeleted: false, falRequestId: { in: ids } },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json({
        success: true,
        images: images.map(img => ({
          id: img.id,
          prompt: img.prompt,
          imageUrl: img.imageUrl,
          model: img.model,
          referenceImageUrls: img.referenceImageUrls || [],
          createdAt: img.createdAt,
          expiresAt: img.expiresAt,
          quality: img.quality || null,
          aspectRatio: img.aspectRatio || null,
          videoMetadata: img.videoMetadata || null,
          loraUrl: (img.videoMetadata as any)?.loraUrl || null,
          loraName: (img.videoMetadata as any)?.loraName || null,
          falRequestId: img.falRequestId || null,
        })),
      })
    }

    const baseWhere = {
      userId: user.id,
      isDeleted: false,
      // Normal feed excludes hidden items; ?hidden=true shows only hidden items
      isHidden: showHidden,
      ...typeFilter,
    }

    // Keyset predicate: rows strictly "older" than the cursor, using id as a tiebreak
    // for rows sharing the same createdAt timestamp.
    const beforeDate = hasCursor ? new Date(beforeParam!) : null
    const cursorWhere = hasCursor
      ? {
          OR: [
            { createdAt: { lt: beforeDate! } },
            { createdAt: beforeDate!, id: { lt: parseInt(beforeIdParam!) } },
          ],
        }
      : {}

    const where = { ...baseWhere, ...cursorWhere }

    const images = await prisma.generatedImage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Cursor mode reads straight from the cursor (no skip); page mode keeps skip
      ...(cursorMode ? {} : { skip }),
      take: limit,
    })

    const mapped = images.map(img => ({
      id: img.id,
      prompt: img.prompt,
      imageUrl: img.imageUrl,
      thumbnailUrl: img.thumbnailUrl || null, // pre-generated CDN thumb, when available
      model: img.model,
      referenceImageUrls: img.referenceImageUrls || [],
      createdAt: img.createdAt,
      expiresAt: img.expiresAt,
      quality: img.quality || null,
      aspectRatio: img.aspectRatio || null,
      videoMetadata: img.videoMetadata || null,
      loraUrl: (img.videoMetadata as any)?.loraUrl || null,
      loraName: (img.videoMetadata as any)?.loraName || null,
    }))

    // Cursor mode: no expensive total count; "more" = we filled a full page. Also
    // hand back the next cursor so the client doesn't have to reconstruct it.
    if (cursorMode) {
      const last = images[images.length - 1]
      return NextResponse.json({
        success: true,
        images: mapped,
        hasMore: images.length === limit,
        nextCursor: last ? { before: last.createdAt, beforeId: last.id } : null,
      })
    }

    // Page mode (unchanged) — used by callers that still pass ?page=
    const total = await prisma.generatedImage.count({ where: baseWhere })
    return NextResponse.json({
      success: true,
      images: mapped,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })

  } catch (error: any) {
    console.error('Error fetching generated images:', error)
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    )
  }
}

// PATCH /api/my-images
// Body: { ids: number[], hidden: boolean }
// Hides or unhides the specified generations. Fully reversible — the DB row and
// the stored file are untouched; only the isHidden flag changes.
export async function PATCH(request: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const user = await getUserFromSession(token)
    if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const body = await request.json()
    const ids: number[] = body.ids
    const hidden: boolean = body.hidden

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No image IDs provided' }, { status: 400 })
    }
    if (typeof hidden !== 'boolean') {
      return NextResponse.json({ error: 'hidden must be a boolean' }, { status: 400 })
    }

    // User-scoped where prevents any cross-user modification
    const result = await prisma.generatedImage.updateMany({
      where: { id: { in: ids }, userId: user.id, isDeleted: false },
      data: { isHidden: hidden },
    })

    return NextResponse.json({ success: true, updated: result.count })
  } catch (error: any) {
    console.error('Error updating image visibility:', error)
    return NextResponse.json({ error: 'Failed to update images' }, { status: 500 })
  }
}

// DELETE /api/my-images
// Body: { ids: number[] }
// Soft-deletes the specified images after verifying they belong to the user.
export async function DELETE(request: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const user = await getUserFromSession(token)
    if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const body = await request.json()
    const ids: number[] = body.ids

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No image IDs provided' }, { status: 400 })
    }

    // Fetch blob URLs before soft-deleting so we can remove them from Vercel Blob
    const images = await prisma.generatedImage.findMany({
      where: { id: { in: ids }, userId: user.id, isDeleted: false },
      select: { id: true, imageUrl: true },
    })

    // Only delete images that belong to this user — prevents any cross-user deletion
    const result = await prisma.generatedImage.updateMany({
      where: { id: { in: ids }, userId: user.id },
      data: { isDeleted: true },
    })

    // Hard-delete the actual files from Vercel Blob storage (non-fatal if it fails)
    if (images.length > 0) {
      try {
        await deleteFromR2(images.map(img => img.imageUrl))
      } catch (blobErr) {
        console.error('Blob deletion failed (non-fatal):', blobErr)
      }
    }

    return NextResponse.json({ success: true, deleted: result.count })
  } catch (error: any) {
    console.error('Error deleting images:', error)
    return NextResponse.json({ error: 'Failed to delete images' }, { status: 500 })
  }
}
