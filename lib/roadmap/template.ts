// ============================================================================
// ROADMAP TEMPLATE — the fixed premium Migrizo shell.
// Same visual language as the CRM's other client emails (navy #16294E,
// blue #506BD8). Everything structural is fixed; only the slots change.
// Every dynamic section is flexible-length and HIDES ENTIRELY when empty,
// so a 4-week roadmap with no speaking events renders as cleanly as a
// 12-week one with everything.
// Email-safe: tables + inline styles only.
// ============================================================================
import type { RoadmapData } from '@/lib/roadmap/types';
import { renderSignatureHtml, renderSignatureText, type EmailSignature } from '@/lib/email/custom';

const NAVY = '#16294E';
const BLUE = '#506BD8';
const INK = '#1A1E27';
const MUTED = '#6B7280';
const LINE = '#E5E9F2';
const SOFT = '#F4F6FB';
const AMBER_BG = '#FFF7E6';
const AMBER_BD = '#F2DFAE';
const AMBER_TX = '#8A6206';
const GREEN_BG = '#EAF7F0';
const GREEN_BD = '#CBEBDA';
const GREEN_TX = '#0B7A48';

const F = "-apple-system,'Segoe UI',Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sectionTitle(label: string): string {
  return `<tr><td style="padding:26px 0 10px;">
    <div style="font:800 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:${BLUE};">${esc(label)}</div>
  </td></tr>`;
}

function bulletList(items: string[], color = BLUE): string {
  return items.map((it) => `
    <tr><td style="padding:0 0 9px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="16" valign="top" style="padding-top:7px;"><div style="width:7px;height:7px;border-radius:50%;background:${color};"></div></td>
        <td style="font:14px/1.6 ${F};color:${INK};">${esc(it)}</td>
      </tr></table>
    </td></tr>`).join('');
}

function card(inner: string, bg = SOFT, border = LINE): string {
  return `<tr><td style="padding:0 0 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${bg};border:1px solid ${border};border-radius:12px;">
      <tr><td style="padding:16px 18px;">${inner}</td></tr>
    </table>
  </td></tr>`;
}

/** The full branded roadmap HTML (email body). */
export function renderRoadmapEmail(data: RoadmapData, sig: EmailSignature): string {
  const firstName = data.client_name.split(/\s+/)[0] || data.client_name;

  const weeksRows = data.roadmap.map((w, i) => `
    <tr>
      <td valign="top" width="86" style="padding:12px 12px 12px 0;border-top:1px solid ${LINE};">
        <div style="font:800 12px/1.3 ${F};color:${BLUE};white-space:nowrap;">${esc(w.week)}</div>
      </td>
      <td valign="top" style="padding:12px 0;border-top:1px solid ${LINE};">
        <div style="font:600 13.5px/1.5 ${F};color:${INK};">${esc(w.task)}</div>
        ${w.why ? `<div style="font:12px/1.5 ${F};color:${MUTED};padding-top:3px;">${esc(w.why)}</div>` : ''}
      </td>
      <td valign="top" width="26" align="right" style="padding:12px 0;border-top:1px solid ${LINE};">
        <div style="font:800 11px/1.3 ${F};color:#B9C2D8;">${String(i + 1).padStart(2, '0')}</div>
      </td>
    </tr>`).join('');

  const strengths = data.strengths.length ? sectionTitle('Where you already stand strong') + bulletList(data.strengths, GREEN_TX) : '';
  const gaps = data.gaps.length ? sectionTitle('The gaps we will close') + bulletList(data.gaps, '#C2410C') : '';
  const priority = data.priority_actions.length
    ? sectionTitle('Priority actions') + card(
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${data.priority_actions.map((p, i) => `
          <tr><td style="padding:0 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td width="26" valign="top"><div style="width:19px;height:19px;border-radius:6px;background:${NAVY};color:#fff;font:800 10.5px/19px ${F};text-align:center;">${i + 1}</div></td>
              <td style="font:600 13.5px/1.55 ${F};color:${INK};padding-left:9px;">${esc(p)}</td>
            </tr></table>
          </td></tr>`).join('')}</table>`)
    : '';
  const pubs = data.publications.length ? sectionTitle('Recommended publications') + bulletList(data.publications) : '';
  const speaking = data.speaking.length ? sectionTitle('Recommended speaking & visibility') + bulletList(data.speaking) : '';
  const flags = data.red_flags.length
    ? sectionTitle('Watch-outs before submission') + card(
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${data.red_flags.map((r) => `
          <tr><td style="font:13px/1.6 ${F};color:${AMBER_TX};padding:0 0 7px;">&#9888;&nbsp; ${esc(r)}</td></tr>`).join('')}</table>`,
        AMBER_BG, AMBER_BD)
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F2F4F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};">

  <!-- header -->
  <tr><td style="background:${NAVY};padding:26px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:800 19px/1 ${F};color:#ffffff;">Migriz<span style="color:#8FA6F5;">o</span></td>
      <td align="right" style="font:700 10.5px/1 ${F};letter-spacing:.16em;color:#8FA6F5;text-transform:uppercase;">Global Talent Roadmap</td>
    </tr></table>
  </td></tr>

  <!-- title block -->
  <tr><td style="padding:32px 36px 0;">
    <div style="font:800 24px/1.25 ${F};color:${NAVY};letter-spacing:-.02em;">Your personalised endorsement roadmap</div>
    <div style="font:14px/1.6 ${F};color:${MUTED};padding-top:8px;">Prepared for <b style="color:${INK};">${esc(data.client_name)}</b> · ${esc(data.route)}</div>
  </td></tr>

  <!-- summary strip -->
  <tr><td style="padding:20px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINE};border-radius:12px;">
      <tr>
        <td width="33%" style="padding:14px 16px;border-right:1px solid ${LINE};">
          <div style="font:800 10px/1 ${F};letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Track</div>
          <div style="font:800 14px/1.4 ${F};color:${NAVY};padding-top:5px;">${esc(data.grade)}</div>
        </td>
        <td width="33%" style="padding:14px 16px;border-right:1px solid ${LINE};">
          <div style="font:800 10px/1 ${F};letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Evidence today</div>
          <div style="font:800 14px/1.4 ${F};color:${NAVY};padding-top:5px;">${esc(data.evidence_score)}</div>
        </td>
        <td style="padding:14px 16px;">
          <div style="font:800 10px/1 ${F};letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Timeline</div>
          <div style="font:800 14px/1.4 ${F};color:${NAVY};padding-top:5px;">${esc(data.timeline)}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- body -->
  <tr><td style="padding:6px 36px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

      ${sectionTitle('Our assessment')}
      <tr><td style="font:14.5px/1.7 ${F};color:${INK};">Dear ${esc(firstName)},<br/><br/>${esc(data.assessment)}</td></tr>

      ${strengths}
      ${gaps}
      ${priority}

      ${sectionTitle('Your week-by-week roadmap')}
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${LINE};">
          ${weeksRows}
        </table>
      </td></tr>

      ${pubs}
      ${speaking}
      ${flags}

      <!-- how endorsement works (fixed) -->
      ${sectionTitle('How the endorsement works')}
      ${card(`<div style="font:13px/1.7 ${F};color:${INK};">
        The Global Talent route is decided at <b>Stage 1 — endorsement</b>: an expert body reviews your evidence and confirms you as a leader (Talent) or emerging leader (Promise) in your field. The visa itself follows almost administratively. Every activity in this roadmap exists to strengthen one specific piece of that evidence file — nothing here is busywork.
      </div>`)}

      <!-- closing (fixed) -->
      <tr><td style="font:14.5px/1.7 ${F};color:${INK};padding-top:14px;">
        Work through the weeks in order — each one feeds the next. Your Migrizo case officer will review progress with you at every milestone and adjust the plan as your evidence lands. When you're ready, simply reply to this email and we'll take the next step together.
      </td></tr>

      <!-- signature -->
      <tr><td>${renderSignatureHtml(sig)}</td></tr>
    </table>
  </td></tr>

  <!-- footer -->
  <tr><td style="padding:18px 36px 26px;">
    <div style="border-top:1px solid ${LINE};padding-top:14px;font:11.5px/1.6 ${F};color:#9AA3B2;">
      ${esc(sig.company)} · <a href="${esc(sig.website)}" style="color:#9AA3B2;">${esc(sig.website.replace(/^https?:\/\//, ''))}</a><br/>
      This roadmap is strategic guidance based on the documents you shared; it is not legal advice. Guidance is verified against live GOV.UK and endorsing-body rules at every review.
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/** Plain-text fallback for the email. */
export function renderRoadmapText(data: RoadmapData, sig: EmailSignature): string {
  const L: string[] = [];
  L.push(`YOUR GLOBAL TALENT ROADMAP — ${data.client_name}`);
  L.push(`${data.route} · ${data.grade} · Evidence: ${data.evidence_score} · ${data.timeline}`, '');
  L.push('OUR ASSESSMENT', data.assessment, '');
  if (data.strengths.length) L.push('STRENGTHS', ...data.strengths.map((s) => `• ${s}`), '');
  if (data.gaps.length) L.push('GAPS TO CLOSE', ...data.gaps.map((s) => `• ${s}`), '');
  if (data.priority_actions.length) L.push('PRIORITY ACTIONS', ...data.priority_actions.map((s, i) => `${i + 1}. ${s}`), '');
  L.push('WEEK-BY-WEEK ROADMAP', ...data.roadmap.map((w) => `${w.week}: ${w.task}${w.why ? ` (${w.why})` : ''}`), '');
  if (data.publications.length) L.push('RECOMMENDED PUBLICATIONS', ...data.publications.map((s) => `• ${s}`), '');
  if (data.speaking.length) L.push('RECOMMENDED SPEAKING', ...data.speaking.map((s) => `• ${s}`), '');
  if (data.red_flags.length) L.push('WATCH-OUTS', ...data.red_flags.map((s) => `! ${s}`), '');
  L.push('', renderSignatureText(sig));
  return L.join('\n');
}
