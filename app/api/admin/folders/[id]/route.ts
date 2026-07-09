import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: rawId } = await params
  const id = parseInt(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const { name, parentId } = await req.json() as { name?: string; parentId?: number | null }
  const data: Record<string, unknown> = {}
  if (name     !== undefined) data.name     = name.trim()
  if (parentId !== undefined) data.parentId = parentId
  const folder = await prisma.datasetBucketFolder.update({ where: { id }, data })
  return NextResponse.json(folder)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: rawId } = await params
  const id = parseInt(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  // Buckets in folder get folderId set to null (onDelete: SetNull on schema)
  await prisma.datasetBucketFolder.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
