// GET/POST /api/v1/references — reference library. Underlying route is
// dual-auth; bearer needs references:read (GET) / references:write (POST).
export { GET, POST } from '@/app/api/user/references/route'
