import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'

export const maxDuration = 300

function authOk(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false
  return req.headers.get('x-admin-password') === pass
}


const EDIT_TRAINER = 'fal-ai/flux-2-trainer/edit'

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { imageIds?: number[]; zipUrl?: string; modelId: string; config: Record<string, unknown>; name: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { imageIds, zipUrl, modelId, config, name } = body

  if (!modelId?.trim())
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  if (!name?.trim())
    return NextResponse.json({ error: 'name is required' }, { status: 400 })

  let jobConfig: Record<string, unknown>
  let imageCount: number

  if (modelId === EDIT_TRAINER) {
    if (!zipUrl?.trim())
      return NextResponse.json({ error: 'zipUrl is required for edit trainer' }, { status: 400 })
    jobConfig = { ...config, _zipUrl: zipUrl }
    imageCount = 0
  } else {
    if (!Array.isArray(imageIds) || imageIds.length === 0)
      return NextResponse.json({ error: 'imageIds must be a non-empty array' }, { status: 400 })

    const images = await prisma.generatedImage.findMany({
      where: { id: { in: imageIds } },
      select: { id: true },
    })
    if (images.length === 0)
      return NextResponse.json({ error: 'No images found for given imageIds' }, { status: 400 })

    jobConfig = { ...config, _imageIds: images.map(i => i.id) }
    imageCount = images.length
  }

  const job = await prisma.loraTrainingJob.create({
    data: {
      name: name.trim(),
      modelId,
      status: 'preparing',
      config: jobConfig as object,
      imageCount,
    },
  })

  // Kick off the prepare endpoint as an independent HTTP request
  // after() just launches it — the prepare endpoint has its own lifecycle
  after(async () => {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://prompt-protocol.vercel.app'
    try {
      await fetch(`${base}/api/admin/lora-training/prepare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': process.env.ADMIN_PASSWORD ?? '',
        },
        body: JSON.stringify({ jobId: job.id }),
        signal: AbortSignal.timeout(5_000), // just wait long enough to confirm it started
      })
    } catch {
      // Timeout or network error launching prepare — that's fine, prepare runs independently
    }
  })

  return NextResponse.json({ jobId: job.id })
}
