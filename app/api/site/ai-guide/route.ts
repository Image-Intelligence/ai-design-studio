import { NextResponse } from 'next/server'
import { checkAdminRequest } from '@/lib/admin-check'
import { getAiGuideEnabled, setAiGuideEnabled } from '@/lib/ai-guide'

/**
 * The AI Guide's site-wide switch.
 *
 * GET is public: every page that mounts the guide asks whether to show it.
 * POST is admin-only. Turning it off hides the guide for every account and
 * the guide's chat endpoint refuses requests while it is off, so a stale tab
 * cannot keep using it.
 */
export async function GET() {
  return NextResponse.json({ enabled: await getAiGuideEnabled() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  if (!await checkAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
  await setAiGuideEnabled(body.enabled)
  return NextResponse.json({ enabled: body.enabled })
}
