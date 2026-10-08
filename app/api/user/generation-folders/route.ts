import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { carryLinksUp } from '@/lib/generation-folder-links'

// Per-user nested-folder tree for organizing generated images (my-generations).
// Mirrors app/api/user/reference-folders/route.ts. Deleting a folder re-parents
// its contents (images + child folders) to the deleted folder's parent — nothing
// inside is ever lost.

async function getAuthUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return null
  return getUserFromSession(token)
}

const MAX_DEPTH = 20

// Walk up from parentId; returns false if a cycle is found or depth exceeded
async function isValidParentChain(userId: number, startId: number | null, selfId?: number): Promise<boolean> {
  let cur = startId
  let depth = 0
  while (cur !== null && depth < MAX_DEPTH) {
    if (selfId !== undefined && cur === selfId) return false // cycle
    const f = await prisma.userGenerationFolder.findFirst({
      where: { id: cur, userId },
      select: { parentId: true },
    })
    if (!f) return false // not found / not owned
    cur = f.parentId
    depth++
  }
  return cur === null
}

/*
 * Folder cards (2026-10-07): each folder's newest few pictures and how many
 * things are in it - its own generations plus the ones added to it ("Add to
 * folder" links). One query for the whole tree: a window over every filed
 * generation, four per folder. A folder with nothing of its own shows its
 * subfolders' pictures instead (the admin dataset page's folders do the same).
 * Not feed material is left out as the feed leaves it out (dataset uploads,
 * 3D meshes); sound files count but have no picture to show.
 */
const PREVIEWS = 4
type Peek = { fid: number; id: number; thumb: string | null; video_thumb: string | null; image_url: string; cnt: number }
async function folderPeeks(userId: number): Promise<Peek[]> {
  return prisma.$queryRaw<Peek[]>`
    WITH items AS (
      SELECT g."folderId" AS fid, g.id, g."createdAt", g."thumbnailUrl", g."videoMetadata", g."imageUrl", g.model
      FROM "GeneratedImage" g
      WHERE g."userId" = ${userId} AND g."folderId" IS NOT NULL AND g."isDeleted" = false AND g."isHidden" = false
      UNION ALL
      SELECT l."folderId", g.id, g."createdAt", g."thumbnailUrl", g."videoMetadata", g."imageUrl", g.model
      FROM "GenerationFolderLink" l JOIN "GeneratedImage" g ON g.id = l."imageId"
      WHERE l."userId" = ${userId} AND g."isDeleted" = false AND g."isHidden" = false
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY fid ORDER BY "createdAt" DESC, id DESC) AS rn,
             COUNT(*) OVER (PARTITION BY fid) AS cnt
      FROM items
      WHERE model <> '__upload__' AND model NOT LIKE '3d:%'
    )
    SELECT fid, id, "thumbnailUrl" AS thumb, "videoMetadata"->>'thumbnailUrl' AS video_thumb, "imageUrl" AS image_url, cnt::int AS cnt
    FROM ranked WHERE rn <= ${PREVIEWS * 2}`
}

const AUDIO_RE = /\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|$)/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i
/** A picture a card can draw: the stored thumbnail, a video's poster, else the image's own thumb route. */
const peekUrl = (p: Peek): string | null =>
  p.thumb || p.video_thumb || (AUDIO_RE.test(p.image_url) || VIDEO_RE.test(p.image_url) ? null : `/api/images/${p.id}?thumb=1`)

function withPreviews(folders: { id: number; name: string; parentId: number | null }[], peeks: Peek[]) {
  const own = new Map<number, { previews: string[]; count: number }>()
  for (const p of peeks) {
    const e = own.get(p.fid) ?? { previews: [], count: p.cnt }
    const url = peekUrl(p)
    if (url && e.previews.length < PREVIEWS && !e.previews.includes(url)) e.previews.push(url)
    own.set(p.fid, e)
  }
  const kids = new Map<number, number[]>()
  for (const f of folders) if (f.parentId != null) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id])
  // Nothing of its own: pictures from its subfolders, nearest first
  const borrowed = (id: number, depth = 0): string[] => {
    if (depth > 20) return []
    const out: string[] = []
    for (const k of kids.get(id) ?? []) {
      for (const u of own.get(k)?.previews.length ? own.get(k)!.previews.slice(0, 1) : borrowed(k, depth + 1).slice(0, 1)) if (!out.includes(u)) out.push(u)
      if (out.length >= PREVIEWS) break
    }
    // Still room (few subfolders): fill from the first ones' other pictures
    for (const k of kids.get(id) ?? []) {
      if (out.length >= PREVIEWS) break
      for (const u of own.get(k)?.previews ?? []) { if (out.length >= PREVIEWS) break; if (!out.includes(u)) out.push(u) }
    }
    return out
  }
  return folders.map(f => {
    const o = own.get(f.id)
    const previews = o?.previews.length ? o.previews : borrowed(f.id)
    return { ...f, count: o?.count ?? 0, subfolders: kids.get(f.id)?.length ?? 0, previews, previewsFromSubfolders: !o?.previews.length && previews.length > 0 }
  })
}

// GET — the user's full folder list (flat; the client builds the tree)
export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const [folders, peeks] = await Promise.all([
      prisma.userGenerationFolder.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, parentId: true },
      }),
      folderPeeks(user.id),
    ])
    return jsonPrivate({ folders: withPreviews(folders, peeks) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('generation-folders GET error:', error)
    return jsonPrivate({ error: 'Server error' }, { status: 500 })
  }
}

// POST — create folder { name, parentId? }
export async function POST(req: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
    if (!name) return jsonPrivate({ error: 'Name required' }, { status: 400 })
    const parentId = typeof body.parentId === 'number' ? body.parentId : null

    if (parentId !== null && !(await isValidParentChain(user.id, parentId))) {
      return jsonPrivate({ error: 'Invalid parent folder' }, { status: 400 })
    }

    const folder = await prisma.userGenerationFolder.create({
      data: { userId: user.id, name, parentId },
      select: { id: true, name: true, parentId: true },
    })
    return jsonPrivate({ folder })
  } catch (error) {
    console.error('generation-folders POST error:', error)
    return jsonPrivate({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH — rename and/or move { id, name?, parentId? }
export async function PATCH(req: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const id = typeof body?.id === 'number' ? body.id : null
    if (id === null) return jsonPrivate({ error: 'id required' }, { status: 400 })

    const existing = await prisma.userGenerationFolder.findFirst({ where: { id, userId: user.id } })
    if (!existing) return jsonPrivate({ error: 'Not found' }, { status: 404 })

    const data: { name?: string; parentId?: number | null } = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60)
    if ('parentId' in body) {
      const parentId = typeof body.parentId === 'number' ? body.parentId : null
      // Reject moving a folder into itself or its own subtree (cycle check)
      if (parentId !== null && !(await isValidParentChain(user.id, parentId, id))) {
        return jsonPrivate({ error: 'Invalid parent folder' }, { status: 400 })
      }
      data.parentId = parentId
    }
    if (Object.keys(data).length === 0) return jsonPrivate({ error: 'Nothing to update' }, { status: 400 })

    const folder = await prisma.userGenerationFolder.update({
      where: { id },
      data,
      select: { id: true, name: true, parentId: true },
    })
    return jsonPrivate({ folder })
  } catch (error) {
    console.error('generation-folders PATCH error:', error)
    return jsonPrivate({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE ?id= — re-parent contents to the deleted folder's parent, then delete
export async function DELETE(req: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = parseInt(searchParams.get('id') || '')
    if (isNaN(id)) return jsonPrivate({ error: 'id required' }, { status: 400 })

    const folder = await prisma.userGenerationFolder.findFirst({ where: { id, userId: user.id } })
    if (!folder) return jsonPrivate({ error: 'Not found' }, { status: 404 })

    // Pictures only added to this folder go up to its parent too (the links
    // themselves are removed with the folder)
    await carryLinksUp(user.id, id, folder.parentId)
    await prisma.$transaction([
      prisma.generatedImage.updateMany({
        where: { folderId: id, userId: user.id },
        data: { folderId: folder.parentId },
      }),
      prisma.userGenerationFolder.updateMany({
        where: { parentId: id, userId: user.id },
        data: { parentId: folder.parentId },
      }),
      prisma.userGenerationFolder.delete({ where: { id } }),
    ])
    return jsonPrivate({ ok: true })
  } catch (error) {
    console.error('generation-folders DELETE error:', error)
    return jsonPrivate({ error: 'Server error' }, { status: 500 })
  }
}
