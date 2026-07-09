import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


// PATCH — rename/update bucket
// Body: { name?, description?, color?, folderId? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: rawId } = await params
  const id = parseInt(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const body = await req.json() as { name?: string; description?: string; color?: string; folderId?: number | null }
  const data: Record<string, unknown> = {}
  if (body.name        !== undefined) data.name        = body.name.trim()
  if (body.description !== undefined) data.description = body.description
  if (body.color       !== undefined) data.color       = body.color
  if (body.folderId    !== undefined) data.folderId    = body.folderId

  const bucket = await prisma.datasetBucket.update({ where: { id }, data })
  return NextResponse.json(bucket)
}

// DELETE — delete bucket (images not deleted, just membership removed via cascade)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: rawId } = await params
  const id = parseInt(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  await prisma.datasetBucket.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
