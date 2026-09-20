import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'

const ADMIN_EMAILS = new Set(['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'])

async function authOk(req: NextRequest): Promise<boolean> {
  const pass = process.env.ADMIN_PASSWORD
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false
  if (req.headers.get('x-admin-password') === pass) return true
  // Fallback: session cookie auth (portal-v2 pattern)
  const token = req.cookies.get('session')?.value
  if (token) {
    const user = await getUserFromSession(token)
    if (user && ADMIN_EMAILS.has(user.email.toLowerCase())) return true
  }
  return false
}

export async function GET(req: NextRequest) {
  if (!await authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const jobs = await prisma.loraTrainingJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    /*
     * Lift the skip list out of config so the Monitor does not have to know
     * where prepare hid it. Each entry is { id, reason }; the thumbnail comes
     * from /api/admin/dataset/thumb/<id>, which already signs and caches.
     */
    return NextResponse.json({
      jobs: jobs.map(j => ({
        ...j,
        skipped: ((j.config as { _skipped?: unknown } | null)?._skipped ?? []) as { id: number; reason: string }[],
      })),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[lora-training/jobs] DB error:', msg)
    return NextResponse.json({ jobs: [], error: msg })
  }
}
