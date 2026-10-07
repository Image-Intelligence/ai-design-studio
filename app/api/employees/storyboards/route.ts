import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { STORYBOARD_ASPECTS, sanitizeShots } from '@/lib/storyboard'

/**
 * Storyboard Studio - the account's storyboards (the workspace's tab strip).
 *
 *   GET   list: id, title, kind, last edit, shot count, runtime, a cover still
 *   POST  create: { title?, aspect?, story?, look?, shots? } - an empty board,
 *         or a pre-filled one (a script or another studio can hand one over)
 *
 * ADMIN ONLY, like the rest of the Studios section. Rows are scoped to the
 * signed-in admin's own user id.
 */
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  /*
   * Summarised in the database. Reading every board's whole shots array (each
   * with its prompts and still versions) to count them grew with every board,
   * and an account with hundreds would pass Accelerate's ~5MB response cap -
   * this returns a few numbers and one cover URL per board instead.
   */
  const rows = await prisma.$queryRaw<{ id: number; title: string; aspect: string; mode: string; updatedAt: Date; shotCount: number; seconds: number; cover: string | null }[]>`
    SELECT b.id, b.title, b.aspect, b.mode, b."updatedAt",
      COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.shots) = 'array' THEN b.shots END), 0)::int AS "shotCount",
      COALESCE((
        SELECT SUM(CASE WHEN jsonb_typeof(s->'duration') = 'number' THEN (s->>'duration')::float8 ELSE 0 END)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.shots) = 'array' THEN b.shots ELSE '[]'::jsonb END) AS s
      ), 0)::float8 AS seconds,
      (
        SELECT t.s->>'stillUrl'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.shots) = 'array' THEN b.shots ELSE '[]'::jsonb END) WITH ORDINALITY AS t(s, i)
        WHERE COALESCE(t.s->>'stillUrl', '') <> ''
        ORDER BY t.i LIMIT 1
      ) AS cover
    FROM "Storyboard" b
    WHERE b."userId" = ${user.id}
    ORDER BY b."updatedAt" DESC`
  // A cover is a 20px chip - send the still's ~40KB library thumbnail, not the
  // still itself (2-20MB each, one per board, all loading with the bar)
  const coverUrls = [...new Set(rows.map(r => r.cover).filter((c): c is string => !!c))]
  const thumbOf = new Map(coverUrls.length
    ? (await prisma.generatedImage.findMany({
        where: { userId: user.id, imageUrl: { in: coverUrls }, thumbnailUrl: { not: null } },
        select: { imageUrl: true, thumbnailUrl: true },
      })).map(t => [t.imageUrl, t.thumbnailUrl!] as const)
    : [])
  return jsonPrivate({
    storyboards: rows.map(r => ({
      id: r.id, title: r.title, aspect: r.aspect, mode: r.mode, updatedAt: r.updatedAt,
      shotCount: Number(r.shotCount) || 0,
      seconds: Number(r.seconds) || 0,
      cover: r.cover ? thumbOf.get(r.cover) ?? r.cover : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const aspect = (STORYBOARD_ASPECTS as readonly string[]).includes(String(body.aspect)) ? String(body.aspect) : '16:9'
  const row = await prisma.storyboard.create({
    data: {
      userId: user.id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'Untitled storyboard',
      story: typeof body.story === 'string' ? body.story.slice(0, 8000) : '',
      look: typeof body.look === 'string' ? body.look.slice(0, 2000) : '',
      aspect,
      shots: sanitizeShots(body.shots) as object[],
    },
  })
  return jsonPrivate({ storyboard: { ...row, shots: row.shots } })
}
