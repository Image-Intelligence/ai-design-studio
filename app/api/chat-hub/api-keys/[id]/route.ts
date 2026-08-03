import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { sanitizePermissions } from '@/lib/api-key-permissions'

const KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  permissions: true,
  disabled: true,
  lastUsedAt: true,
  createdAt: true,
} as const

// PATCH /api/chat-hub/api-keys/[id] — rename, edit permissions, enable/disable.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await prisma.apiKey.findFirst({ where: { id, userId: user.id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Key not found' }, { status: 404 })

  let body: any
  try { body = await req.json() } catch { body = {} }

  const data: Record<string, unknown> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 60) {
      return NextResponse.json({ error: 'Key name must be 1-60 characters' }, { status: 400 })
    }
    data.name = name
  }
  if (typeof body?.disabled === 'boolean') data.disabled = body.disabled
  if (body?.permissions !== undefined) {
    const isAdmin = await checkIsAdmin(user.email)
    data.permissions = sanitizePermissions(body.permissions, isAdmin)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.apiKey.update({ where: { id }, data, select: KEY_SELECT })
  return NextResponse.json(updated)
}

// DELETE /api/chat-hub/api-keys/[id] — hard delete; linked apps lose access
// on their very next request (no caching in the auth path).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const deleted = await prisma.apiKey.deleteMany({ where: { id, userId: user.id } })
  if (deleted.count === 0) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
