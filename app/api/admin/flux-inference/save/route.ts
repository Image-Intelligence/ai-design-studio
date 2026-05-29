import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

// POST /api/admin/flux-inference/save
// Saves a completed RunPod flux generation to GeneratedImage so it shows in /api/my-images
// Body: { r2Key: string, prompt: string }
// Returns: { id: number }
export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  const sessionUser = token ? await getUserFromSession(token) : null
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { r2Key?: string; prompt?: string; videoMetadata?: Record<string, unknown> }
  const { r2Key, prompt, videoMetadata } = body
  if (!r2Key) return NextResponse.json({ error: 'Missing r2Key' }, { status: 400 })

  // Idempotency: return existing record if already saved
  try {
    const existing = await prisma.generatedImage.findFirst({
      where: { userId: sessionUser.id, imageUrl: `${PUBLIC_URL}/${r2Key}` },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ id: existing.id })
  } catch {}

  const imageUrl = PUBLIC_URL ? `${PUBLIC_URL}/${r2Key}` : `/${r2Key}`

  const record = await prisma.generatedImage.create({
    data: {
      userId:             sessionUser.id,
      prompt:             prompt || '',
      imageUrl,
      model:              'custom-flux-lora',
      ticketCost:         0,
      referenceImageUrls: [],
      expiresAt:          new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
      ...(videoMetadata ? { videoMetadata: videoMetadata as object } : {}),
    },
    select: { id: true },
  })

  return NextResponse.json({ id: record.id })
}
