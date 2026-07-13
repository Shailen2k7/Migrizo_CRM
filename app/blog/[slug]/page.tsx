// PUBLIC BLOG POST — server-rendered with the full on-page SEO package:
// dynamic metadata, canonical, Open Graph/Twitter, Article JSON-LD schema.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { renderBlocks, blocksToText, ARTICLE_CSS, type BlogBlock } from '@/lib/blog/render';

export const dynamic = 'force-dynamic';

const BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://crm.migrizo.com';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

async function getPost(slug: string) {
  const { data } = await admin().from('blog_posts').select('*').eq('slug', slug).eq('status', 'published').maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: 'Article not found · Migrizo Blog' };
  const title = post.seo_title || `${post.title} · Migrizo Blog`;
  const description = post.seo_description || post.excerpt || blocksToText(post.content as BlogBlock[]).slice(0, 158);
  const url = `${BASE}/blog/${post.slug}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: {
      title, description, url, siteName: 'Migrizo', type: 'article',
      publishedTime: post.published_at || undefined,
      images: post.cover_url ? [{ url: post.cover_url, width: 1200, height: 630, alt: post.title }] : undefined,
    },
    twitter: { card: 'summary_large_image', title, description, images: post.cover_url ? [post.cover_url] : undefined },
  };
}

function fmtDate(d: string | null) {
  return d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d)) : '';
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  // fire-and-forget view counter
  void admin().from('blog_posts').update({ views: (post.views || 0) + 1 }).eq('id', post.id).then(() => {});

  const blocks = (post.content || []) as BlogBlock[];
  const html = renderBlocks(blocks);
  const description = post.seo_description || post.excerpt || blocksToText(blocks).slice(0, 158);

  // Article schema — what Google rich results + AI platforms read.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description,
    image: post.cover_url ? [post.cover_url] : undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { '@type': 'Organization', name: 'Migrizo', url: 'https://www.migrizo.com' },
    publisher: {
      '@type': 'Organization', name: 'Migrizo', url: 'https://www.migrizo.com',
      logo: { '@type': 'ImageObject', url: `${BASE}/migrizo-email-logo.png` },
    },
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />

      <header style={{ borderBottom: '1px solid #E5E9F2' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <a href="https://www.migrizo.com"><img src="/migrizo-email-logo.png" alt="Migrizo" style={{ height: 38 }} /></a>
          <nav style={{ display: 'flex', gap: 22, fontSize: 14, fontWeight: 600 }}>
            <a href="/blog" style={{ color: '#2B3450', textDecoration: 'none' }}>All articles</a>
            <a href="https://migrizo.com/check-eligibility" style={{ color: '#fff', background: '#3E56D4', padding: '8px 16px', borderRadius: 8, textDecoration: 'none' }}>Check Eligibility</a>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '44px 20px 60px' }}>
        <div style={{ fontSize: 12.5, color: '#8A90A0', marginBottom: 14 }}>
          <a href="/blog" style={{ color: '#3E56D4', textDecoration: 'none' }}>Blog</a> · {fmtDate(post.published_at)} · {post.reading_minutes} min read
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: '#16294E', lineHeight: 1.22, margin: '0 0 18px' }}>{post.title}</h1>
        {post.excerpt && <p style={{ fontSize: 18, color: '#6B7280', lineHeight: 1.65, margin: '0 0 26px' }}>{post.excerpt}</p>}
        {post.cover_url && <img src={post.cover_url} alt={post.title} style={{ width: '100%', height: 'auto', borderRadius: 16, marginBottom: 30, display: 'block' }} />}

        <article className="mgz-article" dangerouslySetInnerHTML={{ __html: html }} />

        {/* CTA */}
        <div style={{ marginTop: 46, background: 'linear-gradient(135deg,#16294E,#3E56D4)', borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Ready to explore your UK visa options?</div>
          <div style={{ fontSize: 14, color: '#C7D0E4', marginBottom: 18 }}>Check your Global Talent Visa eligibility in minutes — free and honest.</div>
          <a href="https://migrizo.com/check-eligibility" style={{ display: 'inline-block', background: '#F4C430', color: '#16294E', fontWeight: 800, fontSize: 15, padding: '13px 28px', borderRadius: 10, textDecoration: 'none' }}>Check Your Eligibility →</a>
        </div>
      </main>

      <footer style={{ background: '#16294E', padding: '26px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#C7D0E4' }}>© {new Date().getFullYear()} Migrizo · Smart. Fast. Reliable Visas · <a href="https://www.migrizo.com" style={{ color: '#F4C430' }}>www.migrizo.com</a></div>
      </footer>
    </div>
  );
}
