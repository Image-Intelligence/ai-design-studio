// GET /api/v1/feed — session feed (generated images/videos). Underlying route
// is dual-auth; bearer needs feed:read. Same query params as /api/my-images
// (cursor=1, type, limit, before/beforeId ...).
export { GET } from '@/app/api/my-images/route'
