import { updateSession } from '@/lib/supabase/middleware';
import { NextResponse, type NextRequest } from 'next/server';

// ============================================================================
// HOST ROUTING
// blog.migrizo.com  → public blog (homepage at /, articles at /:slug)
// crm.migrizo.com   → the CRM app; its old /blog/* URLs 301 to the blog domain
// ============================================================================
const BLOG_BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://blog.migrizo.com';

export async function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  const path = request.nextUrl.pathname;
  const isBlogHost = host === 'blog.migrizo.com' || host.startsWith('blog.');

  if (isBlogHost) {
    // Newsletter signups are the only API allowed on the public blog host.
    if (path === '/api/blog/subscribe') return NextResponse.next();

    // The CRM does not exist on this host.
    if (path.startsWith('/api') || path.startsWith('/login') || path.startsWith('/auth')) {
      return new NextResponse('Not found', { status: 404 });
    }

    const url = request.nextUrl.clone();
    const isBlogPath = path === '/blog' || path.startsWith('/blog/');
    if (path === '/') url.pathname = '/blog';
    else if (path === '/sitemap.xml') url.pathname = '/blog/sitemap.xml';
    else if (path === '/robots.txt') url.pathname = '/blog/robots.txt';
    else if (isBlogPath) {
      // Normalize blog.migrizo.com/blog/... → blog.migrizo.com/... (single canonical URL)
      const rest = path === '/blog' ? '/' : path.slice('/blog'.length);
      return NextResponse.redirect(`${BLOG_BASE}${rest}${request.nextUrl.search}`, 301);
    }
    else url.pathname = `/blog${path}`; // includes /blog-admin → /blog/blog-admin → 404 (CRM never serves here)
    return NextResponse.rewrite(url);
  }

  // On the CRM host: public blog URLs permanently moved to the blog domain.
  // (/blog-admin is NOT matched — startsWith('/blog/') and exact '/blog' only.)
  if (path === '/blog' || path.startsWith('/blog/')) {
    const rest = path === '/blog' ? '/' : path.slice('/blog'.length);
    return NextResponse.redirect(`${BLOG_BASE}${rest}${request.nextUrl.search}`, 301);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // All routes except static files and the favicon
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
