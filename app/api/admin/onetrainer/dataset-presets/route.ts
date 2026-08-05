import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

// Saved OneTrainer dataset compositions (image ids + per-image caption config).
// The table (TrainingDatasetPreset) was created via out-of-band DDL, so all
// access is raw SQL — the generated prisma client predates it.

// GET            → list presets (no data payload)
// GET ?id=<id>   → single preset with data
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(new URL(req.url).searchParams.get('id') ?? '')
  if (!isNaN(id)) {
    const rows = await prisma.$queryRaw<{ id: number; name: string; data: string; createdAt: Date }[]>`
      SELECT "id", "name", "data", "createdAt" FROM "TrainingDatasetPreset" WHERE "id" = ${id} LIMIT 1`
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    let data: unknown = null
    try { data = JSON.parse(rows[0].data) } catch {}
    return NextResponse.json({ id: rows[0].id, name: rows[0].name, createdAt: rows[0].createdAt, data })
  }
  const rows = await prisma.$queryRaw<{ id: number; name: string; createdAt: Date; size: number }[]>`
    SELECT "id", "name", "createdAt", LENGTH("data") as "size" FROM "TrainingDatasetPreset" ORDER BY "updatedAt" DESC`
  return NextResponse.json({ presets: rows })
}

// POST { name, data } → save a new preset
export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { name?: string; data?: unknown } | null
  const name = (body?.name ?? '').trim().slice(0, 80)
  if (!name || body?.data === undefined) return NextResponse.json({ error: 'name and data required' }, { status: 400 })
  const serialized = JSON.stringify(body.data)
  // 20MB: a 5,000-image composition with long prompts serializes to several MB —
  // the old 2MB cap silently rejected big datasets
  if (serialized.length > 20_000_000) {
    return NextResponse.json({ error: `Preset too large (${Math.round(serialized.length / 1e6)}MB > 20MB)` }, { status: 413 })
  }
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "TrainingDatasetPreset" ("name", "data", "updatedAt") VALUES (${name}, ${serialized}, NOW()) RETURNING "id"`
  return NextResponse.json({ id: rows[0]?.id, name })
}

// DELETE ?id=<id>
export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt(new URL(req.url).searchParams.get('id') ?? '')
  if (isNaN(id)) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.$executeRaw`DELETE FROM "TrainingDatasetPreset" WHERE "id" = ${id}`
  return NextResponse.json({ ok: true })
}
