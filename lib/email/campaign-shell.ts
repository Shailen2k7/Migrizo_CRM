// =============================================================================
// CAMPAIGN EMAIL SHELL — the fixed frame around every campaign email.
//
// Templates store ONLY their content (simple paragraphs). This shell supplies
// everything that must be identical on every send, no matter who edits the
// words:
//
//   • The Migrizo logo header (same as SLA / roadmap emails)
//   • A "GLOBAL TALENT VISA · UNITED KINGDOM" badge, so every email says
//     clearly what it is about before a single line of content
//   • Shailen's plain text signature block
//   • A booking CTA button + WhatsApp line
//   • The navy footer with a proper one-click unsubscribe BUTTON
//
// The drain route replaces {{UNSUB_URL}} with the real per-recipient link and
// also sets the RFC-8058 List-Unsubscribe headers.
// =============================================================================

const NAVY = '#16294E';
const BLUE = '#3E56D4';
const GOLD = '#F4C430';
const INK = '#2B3450';
const MUTED = '#6B7280';
const BG = '#EEF1F8';
const LOGO = 'https://crm.migrizo.com/migrizo-email-logo.png';
const BOOKING = 'https://crm.migrizo.com/book/shailen';
const WHATSAPP = 'https://wa.me/447887348822';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap editable template content in the fixed Migrizo campaign frame.
 * `contentHtml` is the template body (paragraphs); `preheader` shows as the
 * inbox preview line.
 */
export function wrapCampaignEmail(contentHtml: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @media only screen and (max-width:600px){
    .px{padding-left:24px !important;padding-right:24px !important;}
  }
  p{margin:0 0 16px;font-size:14.5px;line-height:1.85;color:${INK};}
</style></head>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 6px 26px rgba(22,41,78,0.10);border-radius:16px;overflow:hidden;">

      <!-- Header: logo + brand rule (identical to SLA / roadmap emails) -->
      <tr><td style="background:#ffffff;padding:26px 34px 0;" align="left">
        <img src="${LOGO}" alt="Migrizo" width="176" style="display:block;max-width:176px;height:auto;"/>
      </td></tr>
      <tr><td style="background:#ffffff;padding:14px 34px 0;"><div style="height:3px;width:100%;background:linear-gradient(90deg,${GOLD} 0%,${BLUE} 55%,${NAVY} 100%);border-radius:3px;"></div></td></tr>

      <!-- What this email is about — on EVERY email, before any content -->
      <tr><td style="background:#ffffff;padding:18px 34px 0;" align="left">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:#EEF2FF;border:1px solid #DCE3FF;border-radius:999px;padding:6px 14px;font-size:10.5px;font-weight:800;letter-spacing:1.4px;color:${BLUE};text-transform:uppercase;">Global Talent Visa &middot; United Kingdom</td>
        </tr></table>
      </td></tr>

      <!-- Editable content -->
      <tr><td class="px" style="background:#ffffff;padding:20px 34px 6px;">
        ${contentHtml}
      </td></tr>

      <!-- Booking CTA -->
      <tr><td class="px" style="background:#ffffff;padding:6px 34px 8px;" align="left">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${BLUE};border-radius:10px;">
            <a href="${BOOKING}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Book a 1-to-1 call &rarr;</a>
          </td>
        </tr></table>
        <div style="font-size:12.5px;color:${MUTED};margin-top:12px;">Prefer WhatsApp? Message us on <a href="${WHATSAPP}" style="color:${BLUE};text-decoration:none;font-weight:600;">+44 7887 348822</a></div>
      </td></tr>

      <!-- Signature: short and human. Name, title, Migrizo. Full contact
           details live in the footer so nothing repeats. -->
      <tr><td class="px" style="background:#ffffff;padding:16px 34px 30px;" align="left">
        <div style="border-top:1px solid #E8ECF5;padding-top:18px;">
          <div style="font-size:13.5px;color:${INK};margin-bottom:12px;">Warm regards,</div>
          <div style="font-size:14.5px;font-weight:700;color:${NAVY};">Shailen Pathak</div>
          <div style="font-size:13px;color:${INK};margin-top:4px;">Lead Consultant &ndash; Global Talent Visa</div>
          <div style="font-size:13px;font-weight:700;color:${INK};margin-top:2px;">Migrizo</div>
        </div>
      </td></tr>

      <!-- Footer: the brand block with full contact details + company name,
           and the one-click unsubscribe button. -->
      <tr><td style="background:${NAVY};padding:24px 34px;" align="left">
        <div style="font-size:14px;font-weight:800;color:#ffffff;letter-spacing:0.3px;">Migrizo</div>
        <div style="font-size:11.5px;color:#C7D0E4;margin-top:5px;line-height:1.7;">Smart. Fast. Reliable Visas &middot; <a href="https://www.migrizo.com" style="color:${GOLD};text-decoration:none;">www.migrizo.com</a><br/><a href="mailto:info@migrizo.com" style="color:${GOLD};text-decoration:none;">info@migrizo.com</a> &middot; <a href="${WHATSAPP}" style="color:${GOLD};text-decoration:none;">+44 7887 348822</a><br/>Migrizo Ventures Pvt Ltd.</div>
        <div style="border-top:1px solid #2C446E;margin-top:14px;padding-top:14px;">
          <div style="font-size:10.5px;color:#8FA0C4;line-height:1.6;margin-bottom:10px;">You're receiving this because you enquired with Migrizo about the UK Global Talent Visa.</div>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#22375C;border:1px solid #35507E;border-radius:8px;">
              <a href="{{UNSUB_URL}}" style="display:inline-block;padding:8px 16px;font-size:11.5px;font-weight:700;color:#C7D0E4;text-decoration:none;">Unsubscribe</a>
            </td>
          </tr></table>
        </div>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
}

/** Strip the content HTML down to a plain-text version for the text/plain part. */
export function campaignTextVersion(contentHtml: string): string {
  return contentHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rarr;/g, '->')
    .replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  + `\n\nBook a call: ${BOOKING}\nWhatsApp: +44 7887 348822\n\nWarm regards,\nShailen Pathak\nLead Consultant, Global Talent Visa\nMigrizo\n\nMigrizo | www.migrizo.com | info@migrizo.com | +44 7887 348822\nMigrizo Ventures Pvt Ltd.\n\nUnsubscribe: {{UNSUB_URL}}`;
}
