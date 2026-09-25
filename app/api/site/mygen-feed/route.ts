import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { checkAdminRequest } from '@/lib/admin-check'
import { MYGEN_FEED_DEFAULTS, sanitizeMyGenFeed } from '@/lib/mygen-feed-settings'

/**
 * The my-generations feed layout, site-wide (see lib/mygen-feed-settings.ts).
 *
 * GET is public: every visit to /my-generations reads it. It also says whether
 * the caller may edit it, so the page learns both in one request and only
 * admins get the Feed dropdown.
 *
 * POST is admin-only and replaces the whole setting (sanitised).
 */
export async function GET(req: Request) {
  let settings = MYGEN_FEED_DEFAULTS
  try {
    const rows = await prisma.$queryRaw<{ v: unknown }[]>`SELECT "myGenFeed" AS v FROM "SystemState" LIMIT 1`
    if (rows[0]?.v) settings = sanitizeMyGenFeed(rows[0].v)
  } catch {
    // Unreadable reads as the defaults; the feed must still render.
  }
  const canEdit = await checkAdminRequest(req)
  return NextResponse.json({ settings, canEdit }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const settings = sanitizeMyGenFeed(body?.settings)
  await prisma.$executeRaw`UPDATE "SystemState" SET "myGenFeed" = ${JSON.stringify(settings)}::jsonb`
  return NextResponse.json({ settings })
}
