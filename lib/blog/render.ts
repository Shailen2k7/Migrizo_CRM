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

/** The article CSS used on public pages — images always settle:
    max-width 100% (big shrinks to column), width auto (small stays natural),
    centered, rounded, lazy-loaded. */
export const ARTICLE_CSS = `
  .mgz-article{font-size:17px;line-height:1.85;color:#2B3450;}
  .mgz-article p{margin:0 0 20px;}
  .mgz-article h2{font-size:26px;font-weight:800;color:#16294E;margin:36px 0 14px;line-height:1.3;}
  .mgz-article h3{font-size:20px;font-weight:700;color:#16294E;margin:28px 0 10px;line-height:1.35;}
  .mgz-article ul,.mgz-article ol{margin:0 0 20px;padding-left:26px;}
  .mgz-article li{margin:0 0 8px;}
  .mgz-article a{color:#3E56D4;text-decoration:underline;text-underline-offset:2px;}
  .mgz-article blockquote{margin:24px 0;padding:16px 22px;border-left:4px solid #F4C430;background:#F8F9FC;border-radius:0 12px 12px 0;font-style:italic;color:#16294E;}
  .mgz-article hr{border:0;height:1px;background:#E5E9F2;margin:32px 0;}
  .mgz-article figure{margin:26px 0;text-align:center;}
  .mgz-article img{max-width:100%;width:auto;height:auto;max-height:640px;display:inline-block;border-radius:14px;box-shadow:0 4px 18px rgba(22,41,78,0.08);}
  .mgz-article figcaption{font-size:13px;color:#8A90A0;margin-top:10px;}
`;
