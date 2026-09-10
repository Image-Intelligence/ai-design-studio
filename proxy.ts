import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Require a valid session cookie to access any /admin/* page.
// This is defense-in-depth — the individual API routes also enforce auth.
//
// Named `proxy` in a file called proxy.ts: Next 16 renamed the middleware
// convention and warns on the old one. The export name must match the
// filename (or be a default export) or Next silently finds no function —
// which for THIS file would mean every /admin page becoming public, so the
// rename is verified rather than assumed.
//
// One real difference: a proxy always runs on the Node.js runtime, where
// middleware defaulted to Edge. This file only reads a cookie and redirects,
// so nothing here depended on the Edge runtime.
export function proxy(request: NextRequest) {
  const session = request.cookies.get('session')?.value
  if (!session) {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    return NextResponse.redirect(home)
  }
  return NextResponse.next()
}

export const config = {
  // Only match page routes under /admin — not the API routes (those handle auth themselves)
  matcher: ['/admin/:path*'],
}
