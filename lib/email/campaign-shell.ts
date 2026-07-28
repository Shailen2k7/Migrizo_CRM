// =============================================================================
// CAMPAIGN EMAIL SHELL (deliberately plain, built to land in the PRIMARY inbox)
//
// This used to inject a signature, booking link and footer into every email.
// It no longer does. The whole message, signature included, now lives in the
// template and is editable in the editor. All this file supplies is the HTML
// document, the fonts and the widths.
//
// The ONE exception is the unsubscribe line. If a template does not contain
// {{UNSUB_URL}} anywhere, a minimal unsubscribe footer is appended. That is a
// legal requirement and a hard deliverability requirement, so it cannot be
// deleted by accident. Include {{UNSUB_URL}} in your own wording and yours is
// used instead.
//
// Gmail sorts into Promotions on visual signals, so there are deliberately no
// images, no buttons, no coloured blocks and no background fills here.
// =============================================================================

const INK = '#222222';
const MUTED = '#777777';
const LINK = '#1A4FBF';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap editable template content in the plain Migrizo frame.
 * `contentHtml` is the full message including the signature; `preheader` shows
 * as the inbox preview line.
 */
export function wrapCampaignEmail(contentHtml: string, preheader: string): string {
  const hasUnsub = /\{\{\s*UNSUB_URL\s*\}\}/i.test(contentHtml);

  const fallbackUnsub = hasUnsub ? '' : `
    <p style="margin:26px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
      You received this because you enquired with Migrizo about the UK Global Talent Visa.
      <a href="{{UNSUB_URL}}" style="color:${MUTED};">Unsubscribe</a>
    </p>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#ffffff;}
  .wrap{max-width:640px;margin:0;padding:20px 18px 28px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    font-size:15px;line-height:1.7;color:${INK};}
  p{margin:0 0 15px;font-size:15px;line-height:1.7;color:${INK};}
  h3{font-size:16px;font-weight:600;margin:0 0 12px;}
  ul,ol{margin:0 0 15px;padding-left:22px;}
  li{margin-bottom:6px;}
  a{color:${LINK};}
  b,strong{font-weight:600;}
</style></head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <div class="wrap">
    ${contentHtml}${fallbackUnsub}
  </div>
</body></html>`;
}

/** Strip the content HTML down to a plain-text version for the text/plain part. */
export function campaignTextVersion(contentHtml: string): string {
  const text = contentHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&middot;/g, '.').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/\{\{\s*UNSUB_URL\s*\}\}/i.test(contentHtml)) return text;
  return text + `\n\nYou received this because you enquired with Migrizo about the UK Global Talent Visa.\nUnsubscribe: {{UNSUB_URL}}`;
}
