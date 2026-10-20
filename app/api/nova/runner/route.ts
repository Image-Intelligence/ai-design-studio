import { after, NextResponse } from 'next/server'
import { novaSweep, runBackgroundTurn } from '@/lib/nova/runner'
import { getBaseUrl } from '@/app/api/admin/auto-caption/jobs/_processor'

/**
 * Nova Studio's background runner (lib/nova/runner) - server to server only,
 * behind the cron secret.
 *
 * POST { chatId } - carry on one waiting production. Answers at once and
 *   runs the turn in after(), so each turn has this function's full time.
 * GET - one sweep (the same pass /api/cron/drain-queue runs every minute;
 *   handy where the Vercel cron does not run, e.g. localhost).
 */
export const runtime = 'nodejs'
export const maxDuration = 300

const authorised = (req: Request) => !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await req.json().catch(() => ({})) as { chatId?: unknown }
  const id = Number(chatId)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'chatId required' }, { status: 400 })
  after(async () => {
    const r = await runBackgroundTurn(id).catch(e => `failed: ${String((e as Error)?.message || e).slice(0, 200)}`)
    console.log(`[nova runner] chat ${id}: ${r}`)
  })
  return NextResponse.json({ started: true }, { status: 202 })
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await novaSweep(getBaseUrl(req)))
}
