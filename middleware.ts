import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Require a valid session cookie to access any /admin/* page.
// This is defense-in-depth — the individual API routes also enforce auth.
export function middleware(request: NextRequest) {
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
