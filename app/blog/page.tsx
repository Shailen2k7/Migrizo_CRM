// PUBLIC BLOG HOMEPAGE — served at blog.migrizo.com/ (rewritten from /blog).
// Server-rendered, SEO-complete, styled identically to migrizo.com.
import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import { THEME_CSS, BLOG_BASE, fmtDate } from '@/lib/blog/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Insights & Guides — Migrizo | Global Talent & Extraordinary Ability Visas',
  description: 'Practitioner-grade guides on the UK Global Talent Visa, Innovator Founder route, US EB-1A and Australia NIV — from the Migrizo team.',
  alternates: { canonical: `${BLOG_BASE}/` },
  openGraph: {
    title: 'Migrizo Insights — Global Mobility for Exceptional Talent',
    description: 'Guides on the UK Global Talent Visa, Innovator Founder, US EB-1A and more.',
    url: `${BLOG_BASE}/`, siteName: 'Migrizo', type: 'website',
  },
};

type PostRow = {
  title: string; slug: string; excerpt: string | null; cover_url: string | null;
  published_at: string | null; reading_minutes: number | null; tags: string[] | null;
};

function Nav() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="nav-logo" href="https://migrizo.com">Migriz<em>o</em></a>
        <ul className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <li><a href="https://migrizo.com/visa-uk-global-talent">Visas</a></li>
          <li><a href="https://migrizo.com/recruiters">For Employers</a></li>
          <li><a href="https://migrizo.com/about">About</a></li>
          <li><a href="https://migrizo.com/contact">Contact</a></li>
          <li><a className="nav-cta" href="https://migrizo.com/check-eligibility">Check Eligibility</a></li>
        </ul>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <h4>Migriz<em>o</em></h4>
            <p>Global careers for exceptional talent. Merit-based visas to the UK, US and Australia — zero commission, one Case Officer per client.</p>
            <div className="footer-contact">
              <div>UK · +44 7887 348822</div>
              <div>India · +91 9999 311 087</div>
              <div>info@migrizo.com</div>
            </div>
          </div>
          <div>
            <h5>Visas</h5>
            <ul>
              <li><a href="https://migrizo.com/visa-uk-global-talent">UK Global Talent</a></li>
              <li><a href="https://migrizo.com/visa-innovator-founder">UK Innovator Founder</a></li>
              <li><a href="https://migrizo.com/visa-us-eb1a">US EB-1A Green Card</a></li>
              <li><a href="https://migrizo.com/visa-us-o1a">US O-1A</a></li>
              <li><a href="https://migrizo.com/visa-au-niv858">Australia NIV 858</a></li>
            </ul>
          </div>
          <div>
            <h5>Migrizo</h5>
            <ul>
              <li><a href="https://migrizo.com/about">About</a></li>
              <li><a href="https://migrizo.com/recruiters">For Employers</a></li>
              <li><a href="https://migrizo.com/contact">Contact</a></li>
              <li><a href="https://migrizo.com/check-eligibility">Check Eligibility</a></li>
            </ul>
          </div>
          <div>
            <h5>Legal</h5>
            <ul>
              <li><a href="https://migrizo.com/privacy">Privacy Policy</a></li>
              <li><a href="https://migrizo.com/terms">Terms Of Service</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Migrizo. All rights reserved.</span>
          <span>Suite 39, Podium, 85 Ealing Cross, London W5 5BW</span>
        </div>
      </div>
    </footer>
  );
}

function MintMedia({ label }: { label?: string }) {
  return (
    <div className="ph-media" style={{ position: 'absolute', inset: 0 }}>
      <div className="ring r1"></div><div className="ring r2"></div>
      {label && <span className="brandmark">{label}</span>}
    </div>
  );
}

export default async function BlogHome({ searchParams }: { searchParams: Promise<{ tag?: string; subscribed?: string }> }) {
  const { tag, subscribed } = await searchParams;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await admin.from('blog_posts')
    .select('title, slug, excerpt, cover_url, published_at, reading_minutes, tags')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(100);

  const all = (data || []) as PostRow[];
  const tagSet = Array.from(new Set(all.flatMap((p) => p.tags || []))).slice(0, 10);
  const posts = tag ? all.filter((p) => (p.tags || []).includes(tag)) : all;
  const featured = posts[0];
  const rest = posts.slice(1);

  return (
    <div className="mgz">
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <Nav />

      <div className="container">
        <div className="page-head">
          <div className="crumb"><a href="https://migrizo.com">Home</a><span className="sep"></span><span className="here">Latest Articles</span></div>
          <div className="pill"><span className="dot"></span>Insights &amp; Guides</div>
          <h1>Global mobility <em className="hl">insights</em> for exceptional talent</h1>
          <p className="lede">Practitioner-grade guides on the UK Global Talent Visa, Innovator Founder route, US EB-1A and more — written by the team that prepares these applications every day.</p>
        </div>

        {posts.length === 0 && <div className="empty">Fresh articles are on the way — check back soon.</div>}

        {featured && (
          <section className="featured">
            <a className="feat-card" href={`${BLOG_BASE}/${featured.slug}`}>
              <div className="feat-body">
                {(featured.tags || [])[0] && <span className="chip">{(featured.tags || [])[0]}</span>}
                <h2>{featured.title}</h2>
                {featured.excerpt && <p>{featured.excerpt.slice(0, 180)}{(featured.excerpt || '').length > 180 ? '…' : ''}</p>}
                <div className="meta">
                  <span className="avatar">M</span><span>Migrizo Team</span>
                  <span className="sep"></span><span>{fmtDate(featured.published_at)}</span>
                  <span className="sep"></span><span>{featured.reading_minutes || 5} min read</span>
                </div>
                <span className="readlink">Read article <span className="arw">→</span></span>
              </div>
              <div className="feat-media" style={{ position: 'relative' }}>
                {featured.cover_url
                  ? <img src={featured.cover_url} alt={featured.title} />
                  : <MintMedia label="Featured" />}
              </div>
            </a>
          </section>
        )}

        {tagSet.length > 0 && (
          <div className="tagbar">
            <a className={!tag ? 'on' : ''} href={`${BLOG_BASE}/`}>All</a>
            {tagSet.map((t) => (
              <a key={t} className={tag === t ? 'on' : ''} href={`${BLOG_BASE}/?tag=${encodeURIComponent(t)}`}>{t}</a>
            ))}
          </div>
        )}

        <div className="grid">
          {rest.map((p) => (
            <a key={p.slug} className="card" href={`${BLOG_BASE}/${p.slug}`}>
              <div className="card-media" style={{ position: 'relative' }}>
                {p.cover_url
                  ? <img src={p.cover_url} alt={p.title} />
                  : <MintMedia label={((p.tags || [])[0] || 'Migrizo').toUpperCase()} />}
              </div>
              <div className="card-body">
                <h3>{p.title}</h3>
                {p.excerpt && <p>{p.excerpt.slice(0, 140)}{(p.excerpt || '').length > 140 ? '…' : ''}</p>}
                <div className="meta"><span>{fmtDate(p.published_at)}</span><span className="sep"></span><span>{p.reading_minutes || 5} min read</span></div>
              </div>
            </a>
          ))}
        </div>

        <div className="cta-banner">
          <h2>Get insights that <em>move your case forward</em></h2>
          <p>One email a week. Endorsement strategy, route comparisons and evidence-building tactics — no spam, unsubscribe anytime.</p>
          {subscribed
            ? <div className="subok">You're in — welcome aboard. Watch your inbox.</div>
            : (
              <form className="subrow" method="POST" action="/api/blog/subscribe">
                <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" />
                <input type="hidden" name="back" value={`${BLOG_BASE}/`} />
                <button className="btn btn-em" type="submit">Subscribe</button>
              </form>
            )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
