// =============================================================================
// BLOG RENDER ENGINE — shared by the editor preview and the public pages.
// Content is stored as typed blocks; this renders them to clean, semantic,
// SEO-friendly HTML. Images auto-settle: any size fits the column, centered.
// =============================================================================

export interface BlogBlock {
  id: string;
  type: 'p' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'image' | 'divider';
  text?: string;        // p/h2/h3/quote: text with inline markdown; ul/ol: one item per line
  url?: string;         // image
  caption?: string;     // image
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markdown: **bold**, *italic*, [text](url). Escapes everything else. */
export function inlineMd(raw: string): string {
  let s = esc(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

/** Blocks → article HTML. Image styling makes ANY image size settle cleanly. */
export function renderBlocks(blocks: BlogBlock[]): string {
  return blocks.map((b) => {
    switch (b.type) {
      case 'h2': return `<h2>${inlineMd(b.text || '')}</h2>`;
      case 'h3': return `<h3>${inlineMd(b.text || '')}</h3>`;
      case 'quote': return `<blockquote>${inlineMd(b.text || '')}</blockquote>`;
      case 'ul': return `<ul>${(b.text || '').split('\n').filter((l) => l.trim()).map((l) => `<li>${inlineMd(l.trim())}</li>`).join('')}</ul>`;
      case 'ol': return `<ol>${(b.text || '').split('\n').filter((l) => l.trim()).map((l) => `<li>${inlineMd(l.trim())}</li>`).join('')}</ol>`;
      case 'image':
        if (!b.url) return '';
        return `<figure><img src="${esc(b.url)}" alt="${esc(b.caption || 'Blog image')}" loading="lazy" />${b.caption ? `<figcaption>${inlineMd(b.caption)}</figcaption>` : ''}</figure>`;
      case 'divider': return '<hr />';
      default: {
        const t = (b.text || '').trim();
        return t ? `<p>${inlineMd(t).replace(/\n/g, '<br/>')}</p>` : '';
      }
    }
  }).join('\n');
}

/** Plain text of the post (for reading time + description fallbacks). */
export function blocksToText(blocks: BlogBlock[]): string {
  return blocks.map((b) => b.text || '').join(' ').replace(/\s+/g, ' ').trim();
}

export function readingMinutes(blocks: BlogBlock[]): number {
  const words = blocksToText(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function slugify(title: string): string {
  return title.toLowerCase().trim()
    .replace(/['".,!?:;()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '');
}

/** The article CSS used on public pages — Migrizo website skin (emerald/ink,
    Plus Jakarta Sans inherited from the page shell). Images always settle:
    max-width 100% (big shrinks to column), width auto (small stays natural),
    centered, rounded, lazy-loaded. */
export const ARTICLE_CSS = `
  .mgz-article{font-size:16.5px;line-height:1.78;color:#1F2E29;}
  .mgz-article p{margin:0 0 22px;}
  .mgz-article h2{font-size:clamp(1.4rem,2.4vw,1.8rem);font-weight:800;letter-spacing:-.028em;color:#0E1F1A;margin:38px 0 14px;line-height:1.25;}
  .mgz-article h3{font-size:1.15rem;font-weight:700;letter-spacing:-.015em;color:#0E1F1A;margin:28px 0 10px;line-height:1.35;}
  .mgz-article ul,.mgz-article ol{margin:0 0 22px 4px;padding-left:0;list-style:none;}
  .mgz-article ul li{position:relative;padding-left:26px;margin:0 0 10px;}
  .mgz-article ul li::before{content:'';position:absolute;left:2px;top:9px;width:8px;height:8px;border-radius:50%;background:#00A96E;}
  .mgz-article ol{list-style:decimal;padding-left:26px;}
  .mgz-article ol li{margin:0 0 10px;padding-left:6px;}
  .mgz-article ol li::marker{color:#008557;font-weight:800;}
  .mgz-article a{color:#008557;font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(0,169,110,.35);}
  .mgz-article a:hover{text-decoration-color:#008557;}
  .mgz-article strong{color:#0E1F1A;font-weight:700;}
  .mgz-article blockquote{margin:30px 0;padding:4px 0 4px 22px;border-left:3px solid #00A96E;font-size:19px;font-weight:600;letter-spacing:-.015em;color:#0E1F1A;line-height:1.5;font-style:normal;}
  .mgz-article hr{border:0;height:1px;background:#E5EDE9;margin:36px 0;}
  .mgz-article figure{margin:30px 0;text-align:center;}
  .mgz-article img{max-width:100%;width:auto;height:auto;max-height:640px;display:inline-block;border-radius:14px;box-shadow:0 4px 16px rgba(14,31,26,.05),0 1px 3px rgba(14,31,26,.04);}
  .mgz-article figcaption{font-size:13px;color:#6B7B76;margin-top:10px;}
`;
