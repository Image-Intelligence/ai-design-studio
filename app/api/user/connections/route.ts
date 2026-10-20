import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { disconnect, listConnections } from '@/lib/mcp/oauth'
import { checkIsAdmin } from '@/lib/admin-check'
import { CONNECTOR_ADMIN_ONLY } from '@/lib/nova/config'

/**
 * The apps connected to this account through the connector (ChatGPT, Claude -
 * lib/mcp/oauth). GET lists them; DELETE ?id=<connection> disconnects one at
 * once (its tokens stop working on the next call).
 */
async function me() {
  const t = (await cookies()).get('session')?.value
  const user = t ? await getUserFromSession(t) : null
  // Admin-only until the connector is public (CONNECTOR_ADMIN_ONLY)
  if (user && CONNECTOR_ADMIN_ONLY && !(await checkIsAdmin(user.email))) return null
  return user
}

export async function GET() {
  const user = await me()
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  return jsonPrivate({ connections: await listConnections(user.id) })
}

export async function DELETE(req: Request) {
  const user = await me()
  if (!user) return jsonPrivate({ error: 'Not signed in' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id || !(await disconnect(user.id, id))) return jsonPrivate({ error: 'Connection not found' }, { status: 404 })
  return jsonPrivate({ ok: true, connections: await listConnections(user.id) })
}
