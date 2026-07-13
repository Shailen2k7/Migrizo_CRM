// PUBLIC BLOG INDEX — server-rendered, SEO-complete.
import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://crm.migrizo.com';

export const metadata: Metadata = {
  title: 'Migrizo Blog — UK Global Talent Visa Insights & Guides',
  description: 'Expert guides on the UK Global Talent Visa, Innovator Founder Visa, endorsement strategy, and moving your career to the UK — from the Migrizo team.',
  alternates: { canonical: `${BASE}/blog` },
  openGraph: {
    title: 'Migrizo Blog — UK Visa Insights & Guides',
    description: 'Expert guides on the UK Global Talent Visa and building your UK future.',
    url: `${BASE}/blog`, siteName: 'Migrizo', type: 'website',
  },
};

function fmtDate(d: string | null) {
  return d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d)) : '';
}

export default async function BlogIndex() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: posts } = await admin.from('blog_posts')
    .select('title, slug, excerpt, cover_url, published_at, reading_minutes, tags')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(100);

  return (
    <div style={{ minHeight: '100vh', background: '#F6F8FC', fontFamily: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif" }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #E5E9F2' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <a href="https://www.migrizo.com"><img src="/migrizo-email-logo.png" alt="Migrizo" style={{ height: 38 }} /></a>
          <nav style={{ display: 'flex', gap: 22, fontSize: 14, fontWeight: 600 }}>
            <a href="https://www.migrizo.com" style={{ color: '#2B3450', textDecoration: 'none' }}>Home</a>
            <a href="https://www.migrizo.com/visa-uk-global-talent.html" style={{ color: '#2B3450', textDecoration: 'none' }}>Global Talent Visa</a>
            <a href="https://migrizo.com/check-eligibility" style={{ color: '#fff', background: '#3E56D4', padding: '8px 16px', borderRadius: 8, textDecoration: 'none' }}>Check Eligibility</a>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '44px 20px 72px' }}>
        <div style={{ textAlign: 'center', marginBottom: 42 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: '#3E56D4', textTransform: 'uppercase', marginBottom: 10 }}>The Migrizo Blog</div>
          <h1 style={{ fontSize: 38, fontWeight: 800, color: '#16294E', margin: '0 0 12px', lineHeight: 1.2 }}>UK Visa Insights &amp; Guides</h1>
          <p style={{ fontSize: 16, color: '#6B7280', maxWidth: 560, margin: '0 auto' }}>Expert, practical guidance on the UK Global Talent Visa, endorsements, and building your future in the UK.</p>
        </div>

        {(!posts || posts.length === 0) && (
          <div style={{ textAlign: 'center', color: '#8A90A0', padding: '60px 0', fontSize: 15 }}>Fresh articles are on the way — check back soon.</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 24 }}>
          {(posts || []).map((p) => (
            <a key={p.slug} href={`/blog/${p.slug}`} style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', textDecoration: 'none', boxShadow: '0 2px 12px rgba(22,41,78,0.06)', border: '1px solid #EBEEF5', display: 'flex', flexDirection: 'column' }}>
              {p.cover_url
                ? <img src={p.cover_url} alt={p.title} style={{ width: '100%', height: 190, objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: 190, background: 'linear-gradient(135deg,#3E56D4,#16294E)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#F4C430', fontWeight: 800, fontSize: 22 }}>Migrizo</span></div>}
              <div style={{ padding: '18px 20px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, color: '#8A90A0', marginBottom: 8 }}>{fmtDate(p.published_at)} · {p.reading_minutes} min read</div>
                <h2 style={{ fontSize: 18.5, fontWeight: 800, color: '#16294E', margin: '0 0 8px', lineHeight: 1.35 }}>{p.title}</h2>
                {p.excerpt && <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.65, margin: 0, flex: 1 }}>{p.excerpt.slice(0, 140)}{p.excerpt.length > 140 ? '…' : ''}</p>}
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#3E56D4', marginTop: 14 }}>Read article →</div>
              </div>
            </a>
          ))}
        </div>
      </main>

      <footer style={{ background: '#16294E', padding: '26px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#C7D0E4' }}>© {new Date().getFullYear()} Migrizo · Smart. Fast. Reliable Visas · <a href="https://www.migrizo.com" style={{ color: '#F4C430' }}>www.migrizo.com</a></div>
      </footer>
    </div>
  );
}
