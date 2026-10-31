import { NextRequest, NextResponse } from "next/server";

/**
 * Keeps each part of MigRizo on its own address once the site is live:
 *
 *   SITE_URL   the public website: home, jobs, talent, hire talent, pricing
 *   APP_URL    sign in, sign up, and the candidate and employer dashboards
 *   ADMIN_URL  the admin area (admins sign in here too)
 *
 * A page opened on the wrong address is sent to the right one. Only page
 * visits move; form posts, server actions and /api calls are left alone, so
 * nothing already in flight breaks. Any other address (localhost, or the
 * *.netlify.app preview) is left alone too, so the whole site still works
 * there before the domain is connected.
 *
 * Each address keeps its own sign-in cookie, so an admin session is never
 * sent to the public site or the dashboards.
 */

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
};

const SITE_URL = process.env.SITE_URL || "";
const APP_URL = process.env.APP_URL || "";
const ADMIN_URL = process.env.ADMIN_URL || "";

const APP_PATHS = ["/candidate", "/employer"];
const AUTH_PATHS = ["/login", "/signup", "/claim"];
const ADMIN_PATHS = ["/admin"];

const under = (path: string, bases: string[]) => bases.some((b) => path === b || path.startsWith(b + "/"));

export function middleware(req: NextRequest) {
  const site = hostOf(SITE_URL);
  const app = hostOf(APP_URL);
  const admin = hostOf(ADMIN_URL);
  if (!site || !app || !admin || new Set([site, app, admin]).size < 3) return NextResponse.next();
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").toLowerCase();
  const known = host === site || host === app || host === admin || host === `www.${site}`;
  if (!known) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  let target: string | null = null;

  if (under(pathname, ADMIN_PATHS)) {
    if (host !== admin) target = ADMIN_URL;
  } else if (under(pathname, APP_PATHS)) {
    if (host !== app) target = APP_URL;
  } else if (under(pathname, AUTH_PATHS)) {
    if (host !== app && host !== admin) target = APP_URL;
  } else if (host === app) {
    // The bare app address is the way in.
    return NextResponse.redirect(new URL(pathname === "/" ? "/login" : pathname + search, pathname === "/" ? APP_URL : SITE_URL), 307);
  } else if (host === admin) {
    return NextResponse.redirect(new URL(pathname === "/" ? "/admin" : pathname + search, pathname === "/" ? ADMIN_URL : SITE_URL), 307);
  } else if (host !== site) {
    // www and anything else we own lands on the main address.
    target = SITE_URL;
  }

  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(pathname + search, target), 307);
}

export const config = {
  // Pages only: never API routes, build files or anything with a file extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
