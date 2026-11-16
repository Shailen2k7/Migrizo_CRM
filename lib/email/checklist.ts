// =============================================================================
// DOCUMENT CHECKLIST EMAIL — "what we need from you to start your case".
//
// The wording is editable from the lead drawer and saved per workspace, one
// template per visa (table client_email_templates, migration 130). Only the
// words change: the frame is always the branded shell (logo header + navy
// footer) used by every other client email, plus the sender's signature.
//
// The body is plain text, so anyone can edit it safely:
//   - a blank line starts a new paragraph
//   - lines starting "1." / "2)" become a numbered checklist
//   - lines starting "-" / "•" / "*" become a tick-box checklist
//   - {first_name} and {full_name} fill in the client's name
// The renderer is pure (no server-only imports) so the editor's live preview
// and the email that is actually sent come from the same function.
// =============================================================================

import { shell, visaKindOf } from '@/lib/email/branded';
import { renderSignatureHtml, renderSignatureText, type EmailSignature } from '@/lib/email/custom';

export type ChecklistVisa = 'gtv' | 'ifv';
export interface ChecklistTemplate { subject: string; body: string }

/** Row key in client_email_templates. */
export const checklistKey = (visa: ChecklistVisa) => `checklist_${visa}`;

export const CHECKLIST_DEFAULTS: Record<ChecklistVisa, ChecklistTemplate> = {
  gtv: {
    subject: 'Documents needed to start your UK Global Talent Visa case',
    body: `Dear {first_name},

To start your UK Global Talent Visa case, please share the following information:

1. Passport copy
2. Updated CV + LinkedIn
3. Your field — Tech, Research, Arts & Culture, etc.
4. Current job/company and role
5. Salary increment letters or promotion letters
6. Your key achievements and career highlights (if available)
7. Speaking engagements, conferences or judging experience (if available)

Once we receive this, we will review your profile and start on your case.`,
  },
  ifv: {
    subject: 'Documents needed to start your UK Innovator Founder Visa case',
    body: `Dear {first_name},

To start your UK Innovator Founder Visa case, please share the following information:

1. Updated CV/LinkedIn profile
2. Details of your business/startup idea (if you have)
3. Any previous business, entrepreneurial or relevant professional experience
4. Passport copy

Once we receive this, we will review your profile and start on your case.`,
  },
};

export const checklistVisaOf = (visa_type: string | null | undefined): ChecklistVisa => visaKindOf(visa_type);

const BLUE = '#506BD8';
const INK = '#1A1E27';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fill(s: string, lead: { full_name?: string | null }): string {
  const full = (lead.full_name || '').trim() || 'there';
  const first = full.split(/\s+/)[0];
  return s
    .replace(/\{\s*first_name\s*\}/gi, first)
    .replace(/\{\s*full_name\s*\}/gi, full)
    // The wording people paste in often says "(Client Name)" — honour it too.
    .replace(/\(\s*client\s*name\s*\)/gi, first);
}

const NUM_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET_RE = /^\s*[-•*]\s+(.*)$/;

function listBox(items: { mark: string; text: string; numbered: boolean }[]): string {
  const rows = items.map((it) => `
      <tr>
        <td width="34" valign="top" style="padding:6px 0;">
          ${it.numbered
            ? `<div style="width:22px;height:22px;border-radius:50%;background:#EEF2FF;color:${BLUE};font-weight:700;font-size:11.5px;text-align:center;line-height:22px;font-family:'Segoe UI',Arial,sans-serif;">${esc(it.mark)}</div>`
            : `<div style="width:15px;height:15px;margin-top:3px;border:1.8px solid ${BLUE};border-radius:4px;"></div>`}
        </td>
        <td valign="top" style="padding:7px 0 6px;font-size:13.5px;color:${INK};line-height:1.55;font-family:'Segoe UI',Arial,sans-serif;">${esc(it.text)}</td>
      </tr>`).join('');
  return `<div style="border:1.5px solid #D9DEE9;background:#FBFCFE;border-radius:12px;padding:10px 18px;margin:4px 0 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>`;
}

function para(lines: string[]): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:${INK};font-family:'Segoe UI',Arial,sans-serif;">${lines.map(esc).join('<br/>')}</p>`;
}

/** Plain-text body → email HTML blocks (paragraphs and checklists). */
export function bodyToHtml(body: string): string {
  const out: string[] = [];
  let paraBuf: string[] = [];
  let listBuf: { mark: string; text: string; numbered: boolean }[] = [];
  const flushPara = () => { if (paraBuf.length) { out.push(para(paraBuf)); paraBuf = []; } };
  const flushList = () => { if (listBuf.length) { out.push(listBox(listBuf)); listBuf = []; } };

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const n = line.match(NUM_RE);
    const b = n ? null : line.match(BULLET_RE);
    if (n || b) {
      flushPara();
      listBuf.push(n ? { mark: n[1], text: n[2].trim(), numbered: true } : { mark: '', text: b![1].trim(), numbered: false });
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      paraBuf.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

export function renderChecklist(
  lead: { full_name?: string | null },
  tpl: ChecklistTemplate,
  sig: EmailSignature,
): { subject: string; html: string; text: string } {
  const subject = fill(tpl.subject, lead).trim() || 'Documents needed to start your case';
  const body = fill(tpl.body, lead).trim();
  const html = shell(subject, `${bodyToHtml(body)}\n${renderSignatureHtml(sig)}`, 'What we need from you to start your case');
  const text = `${body}\n\n${renderSignatureText(sig)}`;
  return { subject, html, text };
}
