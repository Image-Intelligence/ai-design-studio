import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { STORYBOARD_ASPECTS, sanitizeShots, type StoryboardShot } from '@/lib/storyboard'

/**
 * Storyboard Studio - the account's storyboards (the workspace's tab strip).
 *
 *   GET   list: id, title, shot count, runtime, a cover still
 *   POST  create: { title?, aspect?, story?, look?, shots? } - an empty board,
 *         or a pre-filled one (a script or another studio can hand one over)
 *
 * ADMIN ONLY, like the rest of the Studios section. Rows are scoped to the
 * signed-in admin's own user id.
 */
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const rows = await prisma.storyboard.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, aspect: true, shots: true, updatedAt: true },
  })
  return jsonPrivate({
    storyboards: rows.map(r => {
      const shots = (Array.isArray(r.shots) ? r.shots : []) as StoryboardShot[]
      return {
        id: r.id, title: r.title, aspect: r.aspect, updatedAt: r.updatedAt,
        shotCount: shots.length,
        seconds: shots.reduce((a, s) => a + (Number(s?.duration) || 0), 0),
        cover: shots.find(s => s?.stillUrl)?.stillUrl ?? null,
      }
    }),
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
