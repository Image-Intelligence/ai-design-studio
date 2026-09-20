import { NextResponse } from 'next/server'
import { VIDEO_MODEL_IDS, VIDEO_FILE_EXTS } from '@/lib/fal-video-endpoints'
import prisma from '@/lib/prisma'
import { deleteFromR2 } from '@/lib/r2'
import { resolveRequestUser, requireScopes } from '@/lib/api-key-auth'
import { jsonPrivate } from '@/lib/api-json'


export async function GET(request: Request) {
  try {
    // Check authentication — bearer API key (desktop app) or session cookie
    const resolved = await resolveRequestUser(request)
    if ('error' in resolved) return resolved.error
    const { user, apiAuth } = resolved
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'feed:read')
      if (denied) return denied
    }

    // Parse pagination parameters
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit
    const type = searchParams.get('type') // 'image' | 'video' | null (all)
    const showHidden = searchParams.get('hidden') === 'true' // hidden-only view
    // Folder scope: absent → all folders; 'root' → unfiled only (folderId null);
    // numeric → that folder. A scalar folderId key composes safely alongside the
    // type filter's OR and the cursor's AND (no key collision).
    const folderIdParam = searchParams.get('folderId')
    const folderFilter =
      folderIdParam === null || folderIdParam === '' ? {}
      : folderIdParam === 'root' ? { folderId: null }
      : { folderId: parseInt(folderIdParam) }
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

    // Video detection: known video model names OR videoMetadata.isVideo=true
    // (set by the chat hub + video pipeline) — the JSON flag is authoritative,
    // so new video models can't leak into the image feed if this list lags.
    // Keep in sync with the model ids in app/api/video/generate/route.ts — a video
    // model missing here leaks its videos into the image feed (the image side can
    // only exclude by model name, see note below)
    // Single source of truth — see lib/fal-video-endpoints.ts. Hand-maintaining
    // a second copy here is what let new video models leak into the image feed.
    const VIDEO_MODELS = VIDEO_MODEL_IDS
    // NOTE: the image side must stay a plain notIn — `NOT (json = true)` is
    // NULL (not true) for rows without videoMetadata in SQL's 3-valued logic,
    // which silently empties the whole image feed.
    const isVideoJson = { videoMetadata: { path: ['isVideo'], equals: true } }
    // Belt and braces: exclude by model AND by file extension, so a video model
    // that nobody remembered to list still cannot appear among the images.
    const notVideoFile = VIDEO_FILE_EXTS.map(e => ({ NOT: { imageUrl: { endsWith: e } } }))
    const isVideoFile = VIDEO_FILE_EXTS.map(e => ({ imageUrl: { endsWith: e } }))
    const typeFilter = type === 'image'
      ? { AND: [{ model: { notIn: VIDEO_MODELS } }, ...notVideoFile] }
      : type === 'video'
      ? { OR: [{ model: { in: VIDEO_MODELS } }, isVideoJson, ...isVideoFile] }
      : {}

    /*
     * Fast path: fetch an exact set of rows by id.
     *
     * A completed queue row records the ids of the images it produced
     * (`parameters.completedImageIds`), which is the only job-to-image link
     * that is exact, present today, and independent of the fal webhook. A
     * client holding a finished job can therefore ask for precisely its own
     * results instead of guessing from "the newest few".
     */
    const idsParam = searchParams.get('ids')
    if (idsParam) {
      const wanted = idsParam.split(',').map(v => parseInt(v.trim(), 10))
        .filter(n => Number.isFinite(n)).slice(0, 60)
      if (wanted.length === 0) return jsonPrivate({ success: true, images: [] })
      const rows = await prisma.generatedImage.findMany({
        // userId scoped: an id from another account must not resolve.
        where: { userId: user.id, isDeleted: false, id: { in: wanted } },
        orderBy: { createdAt: 'desc' },
      })
      const byIdMapped = rows.map(img => ({
        id: img.id,
        prompt: img.prompt,
        imageUrl: img.imageUrl,
        thumbnailUrl: img.thumbnailUrl || null,
        model: img.model,
        referenceImageUrls: img.referenceImageUrls || [],
        createdAt: img.createdAt,
        expiresAt: img.expiresAt,
        quality: img.quality || null,
        aspectRatio: img.aspectRatio || null,
        videoMetadata: img.videoMetadata || null,
        loraUrl: (img.videoMetadata as any)?.loraUrl || null,
        loraName: (img.videoMetadata as any)?.loraName || null,
        loraScale: (img.videoMetadata as any)?.loraScale ?? null,
        refStrength: (img.videoMetadata as any)?.refStrength ?? null,
        falRequestId: img.falRequestId || null,
        folderId: img.folderId ?? null,
      }))
      await attachGptRenderer(byIdMapped, user.id)
      await attachSeedvrSettings(byIdMapped, user.id)
      return jsonPrivate({ success: true, images: byIdMapped })
    }

    // Fast path: fetch by specific FAL request IDs (used by iOS restore to detect completed-while-closed jobs)
    if (falRequestIdsParam) {
      const ids = falRequestIdsParam.split(',').map(s => s.trim()).filter(Boolean)
      const images = await prisma.generatedImage.findMany({
        where: { userId: user.id, isDeleted: false, falRequestId: { in: ids } },
        orderBy: { createdAt: 'desc' },
      })
      const byReqMapped = images.map(img => ({
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
        loraScale: (img.videoMetadata as any)?.loraScale ?? null,
        refStrength: (img.videoMetadata as any)?.refStrength ?? null,
          falRequestId: img.falRequestId || null,
          folderId: img.folderId ?? null,
      }))
      await attachGptRenderer(byReqMapped, user.id)
      await attachSeedvrSettings(byReqMapped, user.id)
      return jsonPrivate({ success: true, images: byReqMapped })
    }

    // ?models=a,b,c → only these model ids (the Feed dropdown's per-model
    // include/exclude). Empty/absent = no model filtering.
    const modelsParam = searchParams.get('models')
    const modelList = modelsParam
      ? modelsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100)
      : []
    const modelFilter = modelList.length > 0 ? { model: { in: modelList } } : {}

    const baseWhere = {
      userId: user.id,
      isDeleted: false,
      // Normal feed excludes hidden items; ?hidden=true shows only hidden items
      isHidden: showHidden,
      ...typeFilter,
      ...folderFilter,
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

    // Two kinds of GeneratedImage row are not feed material.
    //
    // Dataset uploads (model '__upload__') are TRAINING DATA, not generations.
    // A single 260-image dataset upload buried the user's actual generations
    // ~11 pages deep in this time-sorted feed. They stay fully browsable on
    // /admin/dataset.
    //
    // 3D assets (model '3d:<id>') are MESHES. Their imageUrl points at a .glb
    // or .ply, which an <img> cannot draw, so every one of them rendered as an
    // empty tile in the picture feed. They have their own library in the 3D
    // Studio, which knows how to display them.
    const uploadWhere = {
      AND: [
        { model: { not: '__upload__' } },
        { NOT: { model: { startsWith: '3d:' } } },
      ],
    }

    // AND-combine instead of spreading: the type filter, upload filter and the
    // cursor predicate all use model/OR/AND keys that a plain spread would
    // silently clobber
    const where = hasCursor
      ? { AND: [baseWhere, cursorWhere, uploadWhere, modelFilter] }
      : { AND: [baseWhere, uploadWhere, modelFilter] }

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
      // Lets a client match a finished job to ITS image instead of guessing.
      falRequestId: img.falRequestId || null,
      referenceImageUrls: img.referenceImageUrls || [],
      createdAt: img.createdAt,
      expiresAt: img.expiresAt,
      quality: img.quality || null,
      aspectRatio: img.aspectRatio || null,
      videoMetadata: img.videoMetadata || null,
      loraUrl: (img.videoMetadata as any)?.loraUrl || null,
      loraName: (img.videoMetadata as any)?.loraName || null,
        loraScale: (img.videoMetadata as any)?.loraScale ?? null,
        refStrength: (img.videoMetadata as any)?.refStrength ?? null,
      folderId: img.folderId ?? null,
    }))

    await attachGptRenderer(mapped, user.id)
    await attachSeedvrSettings(mapped, user.id)

    // Cursor mode: no expensive total count; "more" = we filled a full page. Also
    // hand back the next cursor so the client doesn't have to reconstruct it.
    if (cursorMode) {
      const last = images[images.length - 1]
      return jsonPrivate({
        success: true,
        images: mapped,
        hasMore: images.length === limit,
        nextCursor: last ? { before: last.createdAt, beforeId: last.id } : null,
      })
    }

    // Page mode (unchanged) — used by callers that still pass ?page=.
    // Count with the SAME filter as the list, or totalPages overshoots by the
    // number of excluded dataset uploads.
    const total = await prisma.generatedImage.count({ where: { AND: [baseWhere, uploadWhere, modelFilter] } })
    return jsonPrivate({
      success: true,
      images: mapped,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })

  } catch (error: any) {
    console.error('Error fetching generated images:', error)
    return jsonPrivate(
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
    const resolved = await resolveRequestUser(request)
    if ('error' in resolved) return resolved.error
    const { user, apiAuth } = resolved
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'feed:manage')
      if (denied) return denied
    }

    const body = await request.json()
    const ids: number[] = Array.isArray(body.ids)
      ? body.ids.filter((n: unknown) => typeof n === 'number')
      : []

    if (ids.length === 0) {
      return jsonPrivate({ error: 'No image IDs provided' }, { status: 400 })
    }

    // Move action: reassign the images' folder. folderId null = unfiled (root).
    // Destination folder ownership is verified before the update.
    if (body.action === 'move') {
      const folderId: number | null = typeof body.folderId === 'number' ? body.folderId : null
      if (folderId !== null) {
        const owned = await prisma.userGenerationFolder.count({ where: { id: folderId, userId: user.id } })
        if (owned === 0) return jsonPrivate({ error: 'Invalid folder' }, { status: 400 })
      }
      const moved = await prisma.generatedImage.updateMany({
        where: { id: { in: ids }, userId: user.id, isDeleted: false },
        data: { folderId },
      })
      return jsonPrivate({ success: true, moved: moved.count })
    }

    // Default action: hide/unhide.
    const hidden: boolean = body.hidden
    if (typeof hidden !== 'boolean') {
      return jsonPrivate({ error: 'hidden must be a boolean' }, { status: 400 })
    }

    // User-scoped where prevents any cross-user modification
    const result = await prisma.generatedImage.updateMany({
      where: { id: { in: ids }, userId: user.id, isDeleted: false },
      data: { isHidden: hidden },
    })

    return jsonPrivate({ success: true, updated: result.count })
  } catch (error: any) {
    console.error('Error updating image visibility:', error)
    return jsonPrivate({ error: 'Failed to update images' }, { status: 500 })
  }
}

// DELETE /api/my-images
// Body: { ids: number[] }
// Soft-deletes the specified images after verifying they belong to the user.
export async function DELETE(request: Request) {
  try {
    const resolved = await resolveRequestUser(request)
    if ('error' in resolved) return resolved.error
    const { user, apiAuth } = resolved
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'feed:manage')
      if (denied) return denied
    }

    const body = await request.json()
    const ids: number[] = body.ids

    if (!Array.isArray(ids) || ids.length === 0) {
      return jsonPrivate({ error: 'No image IDs provided' }, { status: 400 })
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

    return jsonPrivate({ success: true, deleted: result.count })
  } catch (error: any) {
    console.error('Error deleting images:', error)
    return jsonPrivate({ error: 'Failed to delete images' }, { status: 500 })
  }
}

/**
 * Fill in which GPT Image 2.5 renderer produced an image.
 *
 * The image row learns this from the fal webhook — but fal delivers webhooks
 * to APP_URL, which is production, so a row written while you were testing
 * locally comes back with videoMetadata null and the sunburst/flare answer
 * lost on every refresh. It is also simply absent from every row generated
 * before the webhook started recording it.
 *
 * The queue row does know: it was written by the server that submitted the
 * job, and it stores the exact endpoint that ran. The webhook backdates the
 * image to `queueItem.createdAt`, so the two share a timestamp to the
 * millisecond — an exact join key that works today, with no deploy and no
 * backfill. falRequestId is preferred where it exists; the timestamp is the
 * fallback that covers everything else.
 *
 * Runs only when a GPT image is actually missing the field, so the normal
 * feed costs nothing.
 */
async function attachSeedvrSettings(mapped: any[], userId: number) {
  /*
   * Same mechanism as attachGptRenderer: the queue row knows what the run was
   * given, the image row does not (the webhook that would record it runs in
   * production). The seed matters most — an upscale is only repeatable if you
   * can read the number it used.
   */
  const needing = mapped.filter(m =>
    typeof m.model === 'string' && m.model === 'seedvr2-upscale' &&
    !(m.videoMetadata && (m.videoMetadata as any).seedvrSeed != null))
  if (needing.length === 0) return

  try {
    const rows = await prisma.generationQueue.findMany({
      where: {
        userId,
        modelId: 'seedvr2-upscale',
        createdAt: { in: needing.map(m => m.createdAt) },
      },
      select: { falRequestId: true, createdAt: true, parameters: true },
    })
    if (rows.length === 0) return
    const byReq = new Map<string, any>()
    const byMs = new Map<number, any>()
    for (const r of rows) {
      if (r.falRequestId) byReq.set(r.falRequestId, r)
      byMs.set(r.createdAt.getTime(), r)
    }
    for (const m of needing) {
      const row = (m.falRequestId && byReq.get(m.falRequestId))
        || byMs.get(new Date(m.createdAt).getTime())
      if (!row) continue
      const p = (row.parameters as any) ?? {}
      m.videoMetadata = {
        ...(m.videoMetadata ?? {}),
        ...(p.falSeed != null ? { seedvrSeed: p.falSeed } : {}),
        ...(p.falUpscaleMode ? { seedvrMode: p.falUpscaleMode } : {}),
        ...(p.falUpscaleFactor != null ? { seedvrFactor: p.falUpscaleFactor } : {}),
        ...(p.falTargetResolution ? { seedvrTarget: p.falTargetResolution } : {}),
        ...(p.falNoiseScale != null ? { seedvrNoise: p.falNoiseScale } : {}),
        ...(p.falOutputFormat ? { seedvrFormat: p.falOutputFormat } : {}),
      }
    }
  } catch {
    // Cosmetic enrichment — never fail the feed over it.
  }
}

async function attachGptRenderer(mapped: any[], userId: number) {
  const needing = mapped.filter(m =>
    typeof m.model === 'string' && m.model.includes('gpt-image-2.5') &&
    !(m.videoMetadata && (m.videoMetadata as any).gptVariant))
  if (needing.length === 0) return

  try {
    const rows = await prisma.generationQueue.findMany({
      where: {
        userId,
        modelId: { contains: 'gpt-image-2.5' },
        createdAt: { in: needing.map(m => m.createdAt) },
      },
      select: { falRequestId: true, createdAt: true, parameters: true },
    })
    if (rows.length === 0) return

    const byReq = new Map<string, any>()
    const byMs = new Map<number, any>()
    for (const r of rows) {
      if (r.falRequestId) byReq.set(r.falRequestId, r)
      byMs.set(r.createdAt.getTime(), r)
    }

    for (const m of needing) {
      const row = (m.falRequestId && byReq.get(m.falRequestId))
        || byMs.get(new Date(m.createdAt).getTime())
      if (!row) continue
      const params = (row.parameters as any) ?? {}
      const endpoint = String(params.falEndpoint ?? '')
      if (!endpoint.includes('/gpt-image-2.5/')) continue
      m.videoMetadata = {
        ...(m.videoMetadata ?? {}),
        gptVariant: endpoint.includes('/flare/') ? 'flare' : 'sunburst',
        ...(params.falQuality ? { gptQuality: params.falQuality } : {}),
        ...(params.falImageSize ? { gptImageSize: params.falImageSize } : {}),
      }
    }
  } catch {
    // Cosmetic enrichment — never fail the feed over it.
  }
}
