import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { generateApiKey } from '@/lib/api-key-auth'
import { sanitizePermissions, DEFAULT_PERMISSIONS } from '@/lib/api-key-permissions'

const KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  permissions: true,
  disabled: true,
  lastUsedAt: true,
  createdAt: true,
} as const

// GET /api/chat-hub/api-keys — this user's keys. Hashes never leave the server.
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    select: KEY_SELECT,
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ keys }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST /api/chat-hub/api-keys — create a key. The plaintext key is returned
// ONCE here and never again (only its SHA-256 hash is stored).
export async function POST(req: Request) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { body = {} }

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 60) {
    return NextResponse.json({ error: 'Key name must be 1-60 characters' }, { status: 400 })
  }

  const isAdmin = await checkIsAdmin(user.email)
  const permissions = body?.permissions !== undefined
    ? sanitizePermissions(body.permissions, isAdmin)
    : DEFAULT_PERMISSIONS

  const { key, keyHash, keyPrefix } = generateApiKey()
  const created = await prisma.apiKey.create({
    data: { userId: user.id, name, keyHash, keyPrefix, permissions },
    select: KEY_SELECT,
  })

  return NextResponse.json({ key, ...created })
}
