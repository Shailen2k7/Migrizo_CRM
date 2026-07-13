// Blog sitemap — submitted to Google Search Console for fast indexing.
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://crm.migrizo.com';

export async function GET() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: posts } = await admin.from('blog_posts')
    .select('slug, updated_at').eq('status', 'published').order('published_at', { ascending: false }).limit(500);
  const urls = [
    `<url><loc>${BASE}/blog</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...(posts || []).map((p) => `<url><loc>${BASE}/blog/${p.slug}</loc><lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod><priority>0.8</priority></url>`),
  ].join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  });
}
