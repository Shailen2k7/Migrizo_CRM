import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Public paths: the login/auth pages, plus API endpoints that authenticate
// themselves with a shared secret instead of a user session (Meta lead ingest
// and the push-dispatch cron). Without these here, middleware redirects the
// unauthenticated POST to /login, which returns 405 Method Not Allowed.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/ingest', '/api/push/dispatch', '/api/campaigns/drain', '/api/unsubscribe', '/book', '/api/booking', '/api/scheduler/remind', '/api/email/inbound'];
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // If env vars are placeholder, skip auth checks (build phase or misconfigured)
  if (url === PLACEHOLDER_URL) return response;

  // PERF: getSession() reads the JWT from the cookie locally (no network hop)
  // and only contacts Supabase when the token actually needs refreshing
  // (~once an hour). getUser() was a network round-trip on EVERY request —
  // pages, prefetches, API calls — which stacked with Netlify cold starts.
  // Real verification still happens server-side in the (app) layout's getUser().
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const u = request.nextUrl.clone();
    u.pathname = '/login';
    u.searchParams.set('next', path);
    return NextResponse.redirect(u);
  }

  if (user && path === '/login') {
    const u = request.nextUrl.clone();
    u.pathname = '/dashboard';
    return NextResponse.redirect(u);
  }

  return response;
}
