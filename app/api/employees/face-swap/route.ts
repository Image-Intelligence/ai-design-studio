import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { fal } from '@/lib/fal-client'
import { uploadToR2 } from '@/lib/r2'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'
import { startStudioJob, finishStudioJob, failStudioJob } from '@/lib/studio-activity'

export const runtime = 'nodejs'
export const maxDuration = 300

fal.config({ credentials: process.env.FAL_KEY! })

/**
 * Face Swap Studio — the whole employee, as one call.
 *
 * The chat employee reaches this model through edit_image's face_swap op after
 * a conversation about which photo is which. The workspace has no conversation:
 * the user says which image is the face and which is the body by WHICH BOX THEY
 * DROP IT IN, so there is nothing left to infer and nothing to prompt.
 *
 * ADMIN ONLY while the job is unpriced — no tickets are charged yet, so this
 * must not be reachable by a regular account.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkIsAdmin(user.email))) {
    return jsonPrivate({ error: 'Employees are not available on this account yet' }, { status: 403 })
  }
  if (!process.env.FAL_KEY) {
    return jsonPrivate({ error: 'FAL_KEY is not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const faceUrl = typeof body.faceUrl === 'string' ? body.faceUrl : ''
  const bodyUrl = typeof body.bodyUrl === 'string' ? body.bodyUrl : ''
  if (!faceUrl.startsWith('https://') || !bodyUrl.startsWith('https://')) {
    return jsonPrivate({ error: 'Both a face image and a body image are required' }, { status: 400 })
  }

  // The feed's generating tile for it (lib/studio-activity)
  const track = await startStudioJob({ userId: user.id, modelType: 'image', modelId: 'face-swap', prompt: 'Face Swap Studio', studio: 'face-swap' })
  try {
    // base = the image that KEEPS its body/outfit; swap = the face donor.
    const result: any = await fal.subscribe('fal-ai/face-swap', {
      input: { base_image_url: bodyUrl, swap_image_url: faceUrl },
      logs: false,
    })
    const outUrl: string | undefined = result?.data?.image?.url ?? result?.image?.url
    if (!outUrl) { await failStudioJob(track, 'The model returned no image'); return jsonPrivate({ error: 'The model returned no image' }, { status: 502 }) }

    // Re-host: a fal url expires, and everything else in the feed is on R2.
    const fetched = await fetch(outUrl, { signal: AbortSignal.timeout(60_000) })
    if (!fetched.ok) throw new Error(`could not fetch the result (${fetched.status})`)
    const bytes = Buffer.from(await fetched.arrayBuffer())
    const key = `face-swap/${user.id}-${Date.now()}.jpg`
    const hosted = await uploadToR2(key, bytes, 'image/jpeg')

    const saved = await prisma.generatedImage.create({
      data: {
        userId: user.id,
        imageUrl: hosted,
        prompt: 'Face Swap Studio',
        model: 'face-swap',
        ticketCost: 0, // unpriced while admin-only
        // Same effectively-never expiry the rest of the feed uses
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
      },
      select: { id: true, imageUrl: true },
    })

    await finishStudioJob(track, [saved.id], saved.imageUrl)
    return jsonPrivate({ url: saved.imageUrl, id: saved.id })
  } catch (err: any) {
    await failStudioJob(track, String(err?.message || err))
    return jsonPrivate(
      { error: String(err?.message || err).slice(0, 300) },
      { status: 500 },
    )
  }
}
