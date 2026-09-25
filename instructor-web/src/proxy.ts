import { NextResponse, type NextRequest } from 'next/server';

// Optimistic check only: no session cookie means straight to sign-in. The
// real check is the portal layout calling /auth/me, and the API guard on
// every request.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('nacolm_session')) {
    const url = new URL('/login', request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Not the sign-in page, the API passthrough (uploads must not be buffered
  // here), Next internals or static files.
  matcher: ['/((?!login|api|_next/|brand/|icon\\.png|favicon\\.ico).*)'],
};
