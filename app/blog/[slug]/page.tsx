// PUBLIC BLOG ARTICLE — served at blog.migrizo.com/:slug (rewritten from /blog/:slug).
// Full SEO package: dynamic metadata, canonical, OG/Twitter, Article JSON-LD.
// Layout: article + sticky sidebar (share, tags, related, newsletter, WhatsApp).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { renderBlocks, blocksToText, ARTICLE_CSS, type BlogBlock } from '@/lib/blog/render';
import { THEME_CSS, BLOG_BASE, fmtDate } from '@/lib/blog/theme';

export const dynamic = 'force-dynamic';

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
  if (!post) return { title: 'Article not found · Migrizo' };
  const title = post.seo_title || `${post.title} · Migrizo`;
  const description = post.seo_description || post.excerpt || blocksToText(post.content as BlogBlock[]).slice(0, 158);
  const url = `${BLOG_BASE}/${post.slug}`;
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

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  // fire-and-forget view counter
  void admin().from('blog_posts').update({ views: (post.views || 0) + 1 }).eq('id', post.id).then(() => {});

  // Related: latest published posts, preferring tag overlap with this one.
  const { data: others } = await admin().from('blog_posts')
    .select('title, slug, cover_url, published_at, tags')
    .eq('status', 'published').neq('id', post.id)
    .order('published_at', { ascending: false }).limit(12);
  const myTags: string[] = post.tags || [];
  const related = (others || [])
    .map((p) => ({ ...p, score: (p.tags || []).filter((t: string) => myTags.includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const allTags = Array.from(new Set((others || []).flatMap((p) => p.tags || []).concat(myTags))).slice(0, 10);

  const blocks = (post.content || []) as BlogBlock[];
  const html = renderBlocks(blocks);
  const description = post.seo_description || post.excerpt || blocksToText(blocks).slice(0, 158);
  const pageUrl = `${BLOG_BASE}/${post.slug}`;
  const encUrl = encodeURIComponent(pageUrl);
  const encTitle = encodeURIComponent(post.title);

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
      logo: { '@type': 'ImageObject', url: 'https://migrizo.com/assets/logo.png' },
    },
    mainEntityOfPage: pageUrl,
  };

  return (
    <div className="mgz">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS + ARTICLE_CSS }} />
      <div className="progress" id="mgz-prog"></div>

      <nav className="nav">
        <div className="nav-inner">
          <a className="nav-logo" href="https://migrizo.com">Migriz<em>o</em></a>
          <ul className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <li><a href={`${BLOG_BASE}/`}>All Articles</a></li>
            <li><a href="https://migrizo.com/about">About</a></li>
            <li><a href="https://migrizo.com/contact">Contact</a></li>
            <li><a className="nav-cta" href="https://migrizo.com/check-eligibility">Check Eligibility</a></li>
          </ul>
        </div>
      </nav>

      <div className="container">
        <div className="layout">

          {/* ═══════ ARTICLE ═══════ */}
          <article>
            <div className="crumb">
              <a href="https://migrizo.com">Home</a><span className="sep"></span>
              <a href={`${BLOG_BASE}/`}>Our Blog</a><span className="sep"></span>
              <span className="here">{myTags[0] || 'Article'}</span>
            </div>

            <h1 className="title">{post.title}</h1>

            <div className="meta-row">
              <span className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>M</span>
              <span className="who">Migrizo Team</span>
              {myTags[0] && <span className="chip">{myTags[0]}</span>}
              <span className="mpill">⏱ {post.reading_minutes || 5} min read</span>
              <span className="mpill">📅 {fmtDate(post.published_at)}</span>
            </div>

            {post.cover_url && (
              <div className="hero" style={{ position: 'relative' }}>
                <img src={post.cover_url} alt={post.title} />
              </div>
            )}

            {post.excerpt && <p style={{ fontSize: 18, color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 26px', fontWeight: 500 }}>{post.excerpt}</p>}

            <div className="mgz-article" dangerouslySetInnerHTML={{ __html: html }} />

            <div className="art-cta">
              <h3>See where your profile <em>actually stands</em></h3>
              <p>Take the free AI-powered eligibility check — your score out of 100 with feedback on weak areas, in under 3 minutes.</p>
              <a className="btn btn-em" href="https://migrizo.com/check-eligibility">Check Eligibility →</a>
            </div>
          </article>

          {/* ═══════ SIDEBAR ═══════ */}
          <aside className="side">

            <div className="panel">
              <div className="ph3">Share this article</div>
              <div className="share">
                <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">
                  <svg viewBox="0 0 24 24"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
                </a>
                <a href={`https://twitter.com/intent/tweet?url=${encUrl}&text=${encTitle}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X">
                  <svg viewBox="0 0 24 24"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z"/></svg>
                </a>
                <a href={`https://wa.me/?text=${encTitle}%20${encUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
                  <svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.1 4.5.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35zM12.05 21.79h-.01a9.8 9.8 0 0 1-4.99-1.37l-.36-.21-3.71.97.99-3.61-.23-.37a9.77 9.77 0 0 1-1.5-5.21c0-5.4 4.4-9.8 9.81-9.8a9.75 9.75 0 0 1 9.8 9.81c0 5.4-4.4 9.79-9.8 9.79zm8.34-18.13A11.72 11.72 0 0 0 12.05.21C5.56.21.28 5.49.28 11.98c0 2.08.54 4.1 1.57 5.89L.18 23.79l6.07-1.59a11.76 11.76 0 0 0 5.79 1.52h.01c6.49 0 11.77-5.28 11.77-11.77 0-3.15-1.22-6.1-3.43-8.29z"/></svg>
                </a>
                <button type="button" id="mgz-copy" data-url={pageUrl} aria-label="Copy link">
                  <svg viewBox="0 0 24 24"><path d="M10.59 13.41a1 1 0 0 1 0-1.41l3-3a1 1 0 0 1 1.41 1.41l-3 3a1 1 0 0 1-1.41 0zm-2.83 4.24a3 3 0 0 1 0-4.24l1.42-1.41L7.76 10.6l-1.41 1.4a5 5 0 1 0 7.07 7.07l1.41-1.41-1.41-1.41-1.41 1.4a3 3 0 0 1-4.25 0zm8.49-14.14L14.83 4.9l1.41 1.41 1.42-1.4a3 3 0 1 1 4.24 4.23l-1.41 1.42 1.41 1.41 1.41-1.41a5 5 0 0 0-7.07-7.07z"/></svg>
                </button>
              </div>
            </div>

            {allTags.length > 0 && (
              <div className="panel">
                <div className="ph3">All tags</div>
                <div className="tags">
                  {allTags.map((t) => <a key={t} href={`${BLOG_BASE}/?tag=${encodeURIComponent(t)}`}>{t}</a>)}
                </div>
              </div>
            )}

            {related.length > 0 && (
              <div className="panel">
                <div className="ph3">Related articles</div>
                <div className="rel">
                  {related.map((r) => (
                    <a key={r.slug} href={`${BLOG_BASE}/${r.slug}`}>
                      <span className="thumb">{r.cover_url ? <img src={r.cover_url} alt="" /> : null}</span>
                      <span><span className="rd">{fmtDate(r.published_at)}</span><span className="rt">{r.title}</span></span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="panel newsbox">
              <div className="ph3">Join our newsletter</div>
              <p>Endorsement strategy, route comparisons and evidence tactics — one email a week.</p>
              <form method="POST" action="/api/blog/subscribe">
                <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" />
                <input type="hidden" name="back" value={pageUrl} />
                <button className="btn btn-em" type="submit">Subscribe</button>
              </form>
            </div>

            <a className="panel wa" href="https://wa.me/447887348822?text=Hi%20Migrizo%2C%20I%20was%20reading%20your%20blog%20and%20have%20a%20question.">
              <span className="ic">
                <svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.1 4.5.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/></svg>
              </span>
              <span><span className="t1">Prefer to talk directly?</span><span className="t2">WhatsApp us — quick answers, no forms</span></span>
            </a>

          </aside>
        </div>

        {/* MORE ARTICLES */}
        {related.length > 0 && (
          <section className="more">
            <h2>Continue <em className="hl">reading</em></h2>
            <div className="grid" style={{ padding: 0 }}>
              {related.map((r) => (
                <a key={`m-${r.slug}`} className="card" href={`${BLOG_BASE}/${r.slug}`}>
                  <div className="card-media" style={{ position: 'relative' }}>
                    {r.cover_url
                      ? <img src={r.cover_url} alt={r.title} />
                      : <div className="ph-media" style={{ position: 'absolute', inset: 0 }}><div className="ring r1"></div><div className="ring r2"></div></div>}
                  </div>
                  <div className="card-body">
                    {(r.tags || [])[0] && <span className="chip" style={{ marginBottom: 2 }}>{(r.tags || [])[0]}</span>}
                    <h3>{r.title}</h3>
                    <div className="meta"><span>{fmtDate(r.published_at)}</span></div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

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

      <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var p=document.getElementById('mgz-prog');
  if(p && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    window.addEventListener('scroll',function(){
      var h=document.documentElement,max=h.scrollHeight-h.clientHeight;
      p.style.width=(max>0?(h.scrollTop/max*100):0)+'%';
    },{passive:true});
  }
  var c=document.getElementById('mgz-copy');
  if(c){c.addEventListener('click',function(){
    var u=c.getAttribute('data-url')||location.href;
    if(navigator.clipboard){navigator.clipboard.writeText(u);}
    c.style.borderColor='#00A96E';c.style.color='#008557';
    setTimeout(function(){c.style.borderColor='';c.style.color='';},1200);
  });}
})();` }} />
    </div>
  );
}
