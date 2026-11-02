import { updateSession } from '@/lib/supabase/middleware';
import { NextResponse, type NextRequest } from 'next/server';

// This function runs as a Netlify Edge Function in front of EVERY request. If
// it throws, visitors do not see a broken page — they see Netlify's "edge
// function invocation failed" screen, with no site at all behind it. That is
// far worse than any auth check failing.
//
// So this is the last line of defence: whatever happens inside updateSession
// (a Supabase timeout during token refresh, a cold-start hiccup, a bad cookie),
// the request is allowed to continue to the app. Security is not weakened —
// the (app) layout does its own server-side getUser() and redirects anyone who
// is not signed in.
export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch {
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    // All routes except static files and the favicon
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
