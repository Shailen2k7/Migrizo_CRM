import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Public paths: the login/auth pages, plus API endpoints that authenticate
// themselves with a shared secret instead of a user session (Meta lead ingest
// and the push-dispatch cron). Without these here, middleware redirects the
// unauthenticated POST to /login, which returns 405 Method Not Allowed.
// EVERY endpoint pg_cron calls MUST be listed here. When one is missing, the
// middleware answers the cron's POST with a 307 to /login, net.http_post does
// not follow redirects, and the job silently never runs — no error anywhere,
// because from Postgres's side the HTTP call "succeeded".
//
// That is exactly what happened to the three WhatsApp drains below: they were
// scheduled by migrations 058/067/076 but never added here, so T2/T3/T4 chase
// follow-ups, the T6 booking link and the sequence sends had never once fired
// in production. Found by curling the drain and reading the Location header.
//
// Listing a path here does NOT make it unauthenticated: every drain checks
// x-cron-secret against CRON_SECRET, or falls back to a logged-in campaign
// admin. Middleware is a session gate, and these callers have no session.
//
// If you schedule a new cron job, add its path here in the same commit.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/ingest', '/api/push/dispatch', '/api/campaigns/drain', '/api/sequences/tick', '/api/unsubscribe', '/book', '/api/booking', '/api/scheduler/remind', '/api/email/inbound', '/api/email/bounce', '/api/whatsapp/webhook', '/api/whatsapp/campaigns/run', '/api/whatsapp/intake/drain', '/api/whatsapp/automation/drain', '/api/whatsapp/sequences/drain'];
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
  //
  // WHY THIS IS WRAPPED: getSession() usually reads the cookie locally, but
  // when the token is due for refresh it calls Supabase over the network. If
  // that call fails or times out — Supabase under load, a cold edge worker, a
  // transient DNS blip — an unhandled rejection here takes down the whole
  // Netlify Edge Function and every visitor sees "edge function invocation
  // failed" instead of a page. Auth middleware must never be able to kill the
  // site. So we fail SOFT: treat the request as unauthenticated and let it
  // continue. Nothing is exposed by doing so, because the real check is the
  // (app) layout's server-side getUser() — that still runs and still redirects.
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    user = data.session?.user ?? null;
  } catch {
    // Degrade, do not crash. A public path proceeds; a private one falls
    // through to the redirect below, which is the safe direction to fail.
    user = null;
  }

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
