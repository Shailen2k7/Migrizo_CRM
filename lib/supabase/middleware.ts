import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Paths that must be reachable WITHOUT a logged-in user session.
// '/api/ingest' is the Meta → CRM webhook: it has no browser session (Make posts
// to it), and it protects itself with a shared secret, so it must skip the auth
// redirect. Without this line the middleware bounces the webhook to /login.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/ingest'];
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

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Public paths (login, auth callback, ingest webhook) skip the session check
  // entirely — no need to call Supabase for them.
  if (isPublic) return response;

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
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
