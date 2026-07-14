// ============================================================================
// CUSTOM EMAIL + SIGNATURE — shared by the compose API and the Settings UI.
// The signature is stored as structured fields (not raw HTML) so it renders
// beautifully and consistently on every email, and stays easy to edit.
// ============================================================================

export interface EmailSignature {
  closing: string;   // "Warm Regards,"
  name: string;      // "Shailen Pathak"
  title: string;     // "Lead Consultant – Global Talent Visa"
  company: string;   // "Migrizo Ventures Pvt Ltd"
  phone: string;     // "+44 7887 348822"
  website: string;   // "https://www.migrizo.com"
  email: string;     // "info@migrizo.com"
}

export const DEFAULT_SIGNATURE: EmailSignature = {
  closing: 'Warm Regards,',
  name: 'Shailen Pathak',
  title: 'Lead Consultant – Global Talent Visa',
  company: 'Migrizo Ventures Pvt Ltd',
  phone: '+44 7887 348822',
  website: 'https://www.migrizo.com',
  email: 'info@migrizo.com',
};

const NAVY = '#16294E';
const BLUE = '#506BD8';
const INK = '#1A1E27';
const MUTED = '#6B7280';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The signature block — an elegant card with a brand accent bar. */
export function renderSignatureHtml(sig: EmailSignature): string {
  const site = sig.website.replace(/^https?:\/\//, '');
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;border-collapse:collapse;">
    <tr>
      <td style="padding:0 0 10px;font:14px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;color:${INK};">${esc(sig.closing)}</td>
    </tr>
    <tr>
      <td style="border-left:3px solid ${BLUE};padding:2px 0 2px 14px;">
        <div style="font:700 15px/1.35 -apple-system,'Segoe UI',Arial,sans-serif;color:${NAVY};">${esc(sig.name)}</div>
        <div style="font:13px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;color:${MUTED};">${esc(sig.title)}</div>
        <div style="font:600 13px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:${NAVY};">${esc(sig.company)}</div>
        <div style="font:12.5px/1.7 -apple-system,'Segoe UI',Arial,sans-serif;color:${MUTED};padding-top:4px;">
          Phone / WhatsApp: <a href="tel:${esc(sig.phone.replace(/\s/g, ''))}" style="color:${BLUE};text-decoration:none;">${esc(sig.phone)}</a><br/>
          Website: <a href="${esc(sig.website)}" style="color:${BLUE};text-decoration:none;">${esc(site)}</a><br/>
          Email: <a href="mailto:${esc(sig.email)}" style="color:${BLUE};text-decoration:none;">${esc(sig.email)}</a>
        </div>
      </td>
    </tr>
  </table>`;
}

export function renderSignatureText(sig: EmailSignature): string {
  return `${sig.closing}\n${sig.name}\n${sig.title}\n${sig.company}\nPhone / WhatsApp: ${sig.phone}\nWebsite: ${sig.website}\nEmail: ${sig.email}`;
}

/** Wrap a plain-text message in the Migrizo email shell + signature. */
export function renderCustomEmail(opts: { bodyText: string; sig: EmailSignature }): { html: string; text: string } {
  const paragraphs = opts.bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font:15px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;color:${INK};">${esc(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F2F4F8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E5E9F2;">
        <tr><td style="height:4px;background:${NAVY};font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 36px 8px;">
          ${paragraphs}
          ${renderSignatureHtml(opts.sig)}
        </td></tr>
        <tr><td style="padding:18px 36px 26px;">
          <div style="border-top:1px solid #EDF0F6;padding-top:14px;font:11.5px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:#9AA3B2;">
            ${esc(opts.sig.company)} · <a href="${esc(opts.sig.website)}" style="color:#9AA3B2;">${esc(opts.sig.website.replace(/^https?:\/\//, ''))}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${opts.bodyText.trim()}\n\n${renderSignatureText(opts.sig)}`;
  return { html, text };
}
