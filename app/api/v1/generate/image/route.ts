// POST /api/v1/generate/image — image generation for API keys. The underlying
// route is dual-auth and enforces generate:image + tickets:spend + per-model
// permission for bearer calls (queue path only).
export { POST } from '@/app/api/generate/route'
