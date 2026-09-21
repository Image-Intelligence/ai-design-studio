import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getUserRefLimit } from '@/lib/ref-limits'
import { resolveRequestUser, requireScopes } from '@/lib/api-key-auth'
import { jsonPrivate } from '@/lib/api-json'

/**
 * Copy references the user already owns.
 *
 * A duplicate points at the SAME R2 object - nothing is re-uploaded, because
 * the picture is not what is being copied. What is being copied is everything
 * around it: the folder it sits in and, more to the point, its layer stack. A
 * composed reference is work, and wanting a second version of it to take in a
 * different direction is the reason this exists.
 *
 * The layer stack is why this is a route rather than two client calls to the
 * existing POST and ref-layers: `layers` was added by out-of-band DDL and is
 * not on the generated client, so the copy has to be raw SQL - and doing it in
 * one INSERT ... SELECT means the copies are made under the same advisory lock
 * that enforces the library limit, instead of racing it.
 */
export async function POST(req: Request) {
  try {
    const resolved = await resolveRequestUser(req)
    if ('error' in resolved) return resolved.error
    const { user, apiAuth } = resolved
    if (apiAuth) {
      const denied = requireScopes(apiAuth, 'references:write')
      if (denied) return denied
    }

    const body = await req.json().catch(() => null)
    const ids: number[] = Array.isArray(body?.ids)
      ? body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
      : []
    if (ids.length === 0 || ids.length > 100) {
      return jsonPrivate({ error: 'ids must be 1-100 reference ids' }, { status: 400 })
    }
    const unique = [...new Set(ids)]

    /*
     * An explicit destination folder, or null for the root. Absent means "keep
     * each copy beside its original", which is the useful default: duplicating
     * inside a folder should not scatter the copies to the root.
     */
    const intoRoot = body?.folderId === null
    const intoFolder = typeof body?.folderId === 'number' ? body.folderId : null
    if (intoFolder !== null) {
      const owned = await prisma.userRefFolder.count({ where: { id: intoFolder, userId: user.id } })
      if (owned !== 1) return jsonPrivate({ error: 'Invalid folder' }, { status: 400 })
    }

    const limit = await getUserRefLimit(user.id, user.email)

    const created = await prisma.$transaction(async (tx) => {
      // Same lock the create path takes, so two batches cannot both pass the
      // count check and put the library over its limit between them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.id})`

      // Only rows this account still holds. Anything else is silently not
      // copied rather than failing the batch: a stale id from a list the user
      // has since pruned should not lose them the rest of the selection.
      const sources = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "UserReference"
        WHERE id IN (${Prisma.join(unique)}) AND "userId" = ${user.id} AND "isCleared" = false`
      const copies = Number(sources[0]?.n ?? 0)
      if (copies === 0) return []

      const count = await tx.userReference.count({ where: { userId: user.id, isCleared: false } })
      if (count + copies > limit) {
        throw Object.assign(new Error('limit'), { code: 'REF_LIMIT', count, limit, wanted: copies })
      }

      /*
       * One INSERT ... SELECT. The url is shared deliberately; layers and
       * source come along; folderId is the caller's choice or the original's.
       * createdAt is NOW() so the copies sort as new, which is where someone
       * who just pressed duplicate will look for them.
       */
      const folderExpr = intoRoot
        ? Prisma.sql`NULL`
        : intoFolder !== null
          ? Prisma.sql`${intoFolder}`
          : Prisma.sql`"folderId"`
      return tx.$queryRaw<{ id: number; url: string; folderId: number | null; createdAt: Date }[]>`
        INSERT INTO "UserReference" ("userId", "url", "folderId", "layers", "source", "isCleared", "createdAt", "updatedAt")
        SELECT "userId", "url", ${folderExpr}, "layers", "source", false, NOW(), NOW()
        FROM "UserReference"
        WHERE id IN (${Prisma.join(unique)}) AND "userId" = ${user.id} AND "isCleared" = false
        RETURNING id, url, "folderId", "createdAt"`
    }, {
      // The same 15s ceiling the create path uses; Accelerate rejects more.
      timeout: 15_000,
    })

    return jsonPrivate({ references: created, count: created.length })
  } catch (error: unknown) {
    const e = error as { code?: string; count?: number; limit?: number; wanted?: number }
    if (e?.code === 'REF_LIMIT') {
      return jsonPrivate({
        error: `That would put your library at ${(e.count ?? 0) + (e.wanted ?? 0)} of ${e.limit}. Remove some references first.`,
        limitHit: true,
      }, { status: 409 })
    }
    console.error('references duplicate error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
