// Shared admin-password check for /api/admin/* (and other admin-gated) routes.
//
// FAIL-CLOSED: if ADMIN_PASSWORD is not configured, every request is denied.
// The previous per-route copies of this function failed OPEN (missing env var
// meant every request was allowed) — one misconfigured environment would have
// exposed every admin endpoint. Works with both Request and NextRequest.
export function checkAuth(req: Request): boolean {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return false
  return req.headers.get('x-admin-password') === pass
}
