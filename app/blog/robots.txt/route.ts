// robots.txt for blog.migrizo.com (rewritten from /blog/robots.txt).
const BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://blog.migrizo.com';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
  });
}
