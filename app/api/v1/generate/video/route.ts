// POST /api/v1/generate/video — video generation for API keys. The underlying
// route is dual-auth and enforces generate:video + tickets:spend + per-model
// permission; the key's user id always overrides the legacy body userId.
export { POST } from '@/app/api/video/generate/route'
