// GET /api/v1/tickets — ticket balance. The underlying route is dual-auth
// (bearer API key with tickets:read, or session cookie).
export { GET } from '@/app/api/user/tickets/route'
export const dynamic = 'force-dynamic'
