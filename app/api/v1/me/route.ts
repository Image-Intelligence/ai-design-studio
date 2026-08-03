import { NextResponse } from 'next/server'
import { authenticateApiKey, invalidKeyResponse } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'

export const dynamic = 'force-dynamic'

// GET /api/v1/me — identity check for the desktop app. Any valid key.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()

  return NextResponse.json({
    userId: auth.user.id,
    email: auth.user.email,
    name: auth.user.name,
    keyName: auth.keyName,
    permissions: auth.permissions,
    isAdmin: await checkIsAdmin(auth.user.email),
  })
}
