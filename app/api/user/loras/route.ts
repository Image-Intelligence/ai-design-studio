import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteFromR2 } from '@/lib/r2'
import { jsonPrivate } from '@/lib/api-json'

async function getUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return null
  return getUserFromSession(token)
}

// GET — list user's LoRAs
export async function GET() {
  const user = await getUser()
  if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

  const loras = await prisma.userLora.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, loraUrl: true, modelIds: true, createdAt: true },
  })

  return jsonPrivate({ loras })
}

// POST — save a LoRA after upload
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

  let name: string, loraUrl: string, modelIds: string
  try {
    const body = await req.json() as { name?: string; loraUrl?: string; modelIds?: string }
    name = body.name?.trim() || ''
    loraUrl = body.loraUrl?.trim() || ''
    modelIds = body.modelIds?.trim() || 'flux-2,flux-1-dev,z-image-base,z-image-turbo'
  } catch {
    return jsonPrivate({ error: 'Invalid body' }, { status: 400 })
  }

  if (!name) return jsonPrivate({ error: 'Name is required' }, { status: 400 })
  if (!loraUrl.startsWith('http')) return jsonPrivate({ error: 'Invalid LoRA URL' }, { status: 400 })

  const count = await prisma.userLora.count({ where: { userId: user.id } })
  if (count >= 20) return jsonPrivate({ error: 'Max 20 LoRAs per account' }, { status: 400 })

  const lora = await prisma.userLora.create({
    data: { userId: user.id, name, loraUrl, modelIds },
    select: { id: true, name: true, loraUrl: true, modelIds: true, createdAt: true },
  })

  return jsonPrivate({ lora })
}

// DELETE — remove a LoRA (only owner can delete)
export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user) return jsonPrivate({ error: 'Not authenticated' }, { status: 401 })

  let id: number
  try {
    const body = await req.json() as { id?: number }
    id = Number(body.id)
    if (!id) throw new Error()
  } catch {
    return jsonPrivate({ error: 'Invalid body' }, { status: 400 })
  }

  const lora = await prisma.userLora.findUnique({ where: { id } })
  if (!lora || lora.userId !== user.id) {
    return jsonPrivate({ error: 'Not found' }, { status: 404 })
  }

  // Delete from R2 if it's in our bucket
  if (lora.loraUrl.includes('user-loras/')) {
    deleteFromR2(lora.loraUrl).catch(() => {})
  }

  await prisma.userLora.delete({ where: { id } })
  return jsonPrivate({ ok: true })
}
