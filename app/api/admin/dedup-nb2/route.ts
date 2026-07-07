import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// POST /api/admin/dedup-nb2
// Finds duplicate nano-banana-2 GeneratedImage rows (same imageUrl), keeps the
// earliest record per URL, hard-deletes the rest. Returns counts.
export async function POST() {
  try {
    const all = await prisma.generatedImage.findMany({
      where: { model: 'nano-banana-2' },
      orderBy: { id: 'asc' },
      select: { id: true, imageUrl: true },
    })

    // Group by imageUrl
    const seen = new Map<string, number>() // url → first id
    const toDelete: number[] = []

    for (const row of all) {
      if (seen.has(row.imageUrl)) {
        toDelete.push(row.id)
      } else {
        seen.set(row.imageUrl, row.id)
      }
    }

    if (toDelete.length === 0) {
      return NextResponse.json({ message: 'No duplicates found', deleted: 0 })
    }

    const { count } = await prisma.generatedImage.deleteMany({
      where: { id: { in: toDelete } },
    })

    return NextResponse.json({
      message: `Deleted ${count} duplicate record(s)`,
      deleted: count,
      kept: seen.size,
    })
  } catch (error: any) {
    console.error('dedup-nb2 error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
