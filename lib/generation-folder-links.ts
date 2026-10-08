import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * My Generations "Add to folder" (2026-10-07): a generation lives in ONE
 * folder (GeneratedImage.folderId, null = Unfiled) and can also be shown in
 * any number of others through GenerationFolderLink rows. Moving changes
 * where it lives; adding only puts it in more places.
 *
 * Raw SQL on purpose: the table was created out of band (like UserAsset), and
 * raw queries need no regenerated Prisma client on a running server. Every
 * query is scoped to the user, and writes only touch the user's own folders
 * and generations - the callers check folder ownership, and the INSERT reads
 * the images through a user-scoped SELECT.
 */

/** The generations shown in a folder through a link (not the ones living in it). */
export async function linkedImageIds(userId: number, folderId: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ imageId: number }[]>`
    SELECT "imageId" FROM "GenerationFolderLink" WHERE "userId" = ${userId} AND "folderId" = ${folderId}`
  return rows.map(r => r.imageId)
}

/** Shows `imageIds` in each of `folderIds` as well. Returns how many new links were made. */
export async function addLinks(userId: number, imageIds: number[], folderIds: number[]): Promise<number> {
  if (!imageIds.length || !folderIds.length) return 0
  // A generation already living in a folder needs no link to it
  const n = await prisma.$executeRaw`
    INSERT INTO "GenerationFolderLink" ("folderId", "imageId", "userId")
    SELECT f.id, g.id, ${userId}
    FROM "UserGenerationFolder" f
    CROSS JOIN "GeneratedImage" g
    WHERE f.id IN (${Prisma.join(folderIds)}) AND f."userId" = ${userId}
      AND g.id IN (${Prisma.join(imageIds)}) AND g."userId" = ${userId} AND g."isDeleted" = false
      AND (g."folderId" IS NULL OR g."folderId" <> f.id)
    ON CONFLICT DO NOTHING`
  return Number(n)
}

/** Takes `imageIds` out of `folderId` where they are only linked there. */
export async function removeLinks(userId: number, imageIds: number[], folderId: number): Promise<number> {
  if (!imageIds.length) return 0
  const n = await prisma.$executeRaw`
    DELETE FROM "GenerationFolderLink"
    WHERE "userId" = ${userId} AND "folderId" = ${folderId} AND "imageId" IN (${Prisma.join(imageIds)})`
  return Number(n)
}

/**
 * A folder being deleted: its linked generations go up to its parent, as the
 * ones living in it do (at the root they simply stay wherever they live).
 * The links themselves go with the folder (ON DELETE CASCADE).
 */
export async function carryLinksUp(userId: number, fromFolderId: number, toFolderId: number | null): Promise<void> {
  if (toFolderId === null) return
  await prisma.$executeRaw`
    INSERT INTO "GenerationFolderLink" ("folderId", "imageId", "userId")
    SELECT ${toFolderId}, l."imageId", ${userId}
    FROM "GenerationFolderLink" l
    JOIN "GeneratedImage" g ON g.id = l."imageId"
    WHERE l."userId" = ${userId} AND l."folderId" = ${fromFolderId}
      AND (g."folderId" IS NULL OR g."folderId" <> ${toFolderId})
    ON CONFLICT DO NOTHING`
}
