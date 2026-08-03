import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'

/**
 * Session-based auth for the AI Chat Hub (admin-only while in development).
 * Chat data is user-owned, so this uses the session cookie + AdminAccount
 * check rather than the x-admin-password header — every chat-hub route must
 * also scope its queries by the returned user's id.
 */
export async function requireChatHubAdmin() {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return null
  const user = await getUserFromSession(token)
  if (!user) return null
  const isAdmin = await checkIsAdmin(user.email)
  if (!isAdmin) return null
  return user
}
