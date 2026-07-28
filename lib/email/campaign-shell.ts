// =============================================================================
// CAMPAIGN EMAIL SHELL (deliberately plain, built to land in the PRIMARY inbox)
//
// Gmail sorts into Promotions on visual signals. The previous version of this
// file had every single one of them: a logo image, a coloured category badge,
// a gradient rule, a filled CTA button and a dark branded footer block. That is
// why every email landed in Promotions regardless of the words inside it.
//
// This version looks like a message a person typed in their own mail client:
//   - No images at all
//   - No background colours, no coloured blocks, no buttons
//   - System font, ordinary paragraph spacing
//   - Exactly two links (book a call, unsubscribe)
//   - A plain typed signature
//
// It is less pretty. It reaches the inbox, which is the entire point of a cold
// email. Templates supply only their paragraphs; this supplies the rest.
//
// The sending routes replace {{UNSUB_URL}} with the real per-recipient link and
// also set the RFC-8058 List-Unsubscribe headers.
// =============================================================================

const INK = '#222222';
const MUTED = '#777777';
const LINK = '#1A4FBF';
const BOOKING = 'https://crm.migrizo.com/book/shailen';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap editable template content in the plain Migrizo frame.
 * `contentHtml` is the template body (paragraphs); `preheader` shows as the
 * inbox preview line.
 */
export function wrapCampaignEmail(contentHtml: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#ffffff;}
  .wrap{max-width:580px;margin:0 auto;padding:22px 20px 30px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    font-size:15px;line-height:1.7;color:${INK};}
  p{margin:0 0 15px;font-size:15px;line-height:1.7;color:${INK};}
  a{color:${LINK};}
  b,strong{font-weight:600;}
</style></head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <div class="wrap">

    ${contentHtml}

    <p style="margin-top:20px;">You can book a time with me here:<br/>
      <a href="${BOOKING}">${BOOKING}</a>
    </p>

    <p style="margin-top:22px;">Warm regards,<br/>
      Shailen Pathak<br/>
      Lead Consultant, Global Talent Visa<br/>
      Migrizo<br/>
      WhatsApp +44 7887 348822
    </p>

    <p style="margin-top:26px;font-size:12px;line-height:1.6;color:${MUTED};">
      Migrizo Ventures Pvt Ltd. &middot; www.migrizo.com &middot; info@migrizo.com<br/>
      You received this because you enquired with Migrizo about the UK Global Talent Visa.
      <a href="{{UNSUB_URL}}" style="color:${MUTED};">Unsubscribe</a>
    </p>

  </div>
</body></html>`;
}

/** Strip the content HTML down to a plain-text version for the text/plain part. */
export function campaignTextVersion(contentHtml: string): string {
  return contentHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&middot;/g, '.').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  + `\n\nYou can book a time with me here:\n${BOOKING}\n\nWarm regards,\nShailen Pathak\nLead Consultant, Global Talent Visa\nMigrizo\nWhatsApp +44 7887 348822\n\nMigrizo Ventures Pvt Ltd. | www.migrizo.com | info@migrizo.com\nYou received this because you enquired with Migrizo about the UK Global Talent Visa.\nUnsubscribe: {{UNSUB_URL}}`;
}
