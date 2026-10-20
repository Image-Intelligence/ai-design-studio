/**
 * Nova Studio - who may use it (server only).
 *
 * Admin-only while it is tested (2026-10-18, owner). Every route below
 * already treats the caller as an ordinary user where it matters - their own
 * rows, their tickets, the public models - so opening it up is this one flag
 * plus EMPLOYEE_ADMIN_ONLY.nova in lib/employees.ts.
 */
import { requireStudioUser } from '@/lib/studio-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { jsonPrivate } from '@/lib/api-json'

export const NOVA_ADMIN_ONLY = true

export async function requireNovaUser(): Promise<{ ok: true; user: { id: number; email: string }; isAdmin: boolean } | { ok: false; res: Response }> {
  const user = await requireStudioUser()
  if (!user?.email) return { ok: false, res: jsonPrivate({ error: 'Unauthorized' }, { status: 401 }) }
  const isAdmin = await checkIsAdmin(user.email)
  if (NOVA_ADMIN_ONLY && !isAdmin) return { ok: false, res: jsonPrivate({ error: 'Nova Studio is admin-only for now' }, { status: 403 }) }
  return { ok: true, user: { id: user.id, email: user.email }, isAdmin }
}

/**
 * The agent's chats come in two personas (2026-10-20, owner): Nova Studio
 * (source 'nova', admin-only while NOVA_ADMIN_ONLY) and Prism, the site's
 * guide (source 'prism' - one continuous chat per account, open to every
 * signed-in user). Both run the same engine (lib/nova/agent) and the same
 * routes; `sources` is which chats this caller may open, and every route
 * that takes a chat id finds it with `source: { in: sources }`.
 */
export type AgentUser = { ok: true; user: { id: number; email: string }; isAdmin: boolean; sources: ('nova' | 'prism')[] }
export async function requireAgentUser(): Promise<AgentUser | { ok: false; res: Response }> {
  const user = await requireStudioUser()
  if (!user?.email) return { ok: false, res: jsonPrivate({ error: 'Sign in to talk to Prism' }, { status: 401 }) }
  const isAdmin = await checkIsAdmin(user.email)
  return { ok: true, user: { id: user.id, email: user.email }, isAdmin, sources: isAdmin || !NOVA_ADMIN_ONLY ? ['nova', 'prism'] : ['prism'] }
}
