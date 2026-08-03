// POST /api/v1/video/status — poll a non-queued FAL video job (falRequestId +
// falEndpoint path). Underlying route is dual-auth; bearer needs jobs:read.
export { POST } from '@/app/api/video/status/route'
