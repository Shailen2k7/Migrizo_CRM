// ============================================================================
// ROADMAP TEMPLATE — wrapped in the SAME shell() as SLA / Onboarding / Invoice,
// so the Migrizo logo header, white card and navy footer are byte-identical
// across every client email, forever. This file renders only the body.
// Every dynamic section is flexible-length and hides entirely when empty.
// ============================================================================
import type { RoadmapData } from '@/lib/roadmap/types';
import { renderSignatureHtml, renderSignatureText, type EmailSignature } from '@/lib/email/custom';

// ── Roadmap emails are always signed by the Operations Head, regardless of
// which team member clicks Send. This is a client-facing deliverable owned by
// operations, so the sign-off must be consistent for every client.
// The visa in the title follows the plan itself \u2014 an Innovator Founder client
// must never receive a "Global Talent Visa" signature.
export function roadmapVisaName(data: Pick<RoadmapData, 'route'>): string {
  return /innovator|founder/i.test(data.route || '')
    ? 'Innovator Founder Visa'
    : 'Global Talent Visa';
}

export function roadmapSignature(data: Pick<RoadmapData, 'route'>): EmailSignature {
  return {
    closing: 'Warm Regards,',
    name: 'Mansi Behl',
    title: `Operations Head \u2013 ${roadmapVisaName(data)}`,
    company: 'Migrizo Ventures Pvt Ltd',
    phone: '+91 9217428262',
    website: 'https://www.migrizo.com',
    email: 'info@migrizo.com',
  };
}
import { shell } from '@/lib/email/branded';

const NAVY = '#16294E';
const BLUE = '#506BD8';
const INK = '#1A1E27';
const MUTED = '#6B7280';
const LINE = '#E5E9F2';
const SOFT = '#F4F6FB';
const AMBER_BG = '#FFF7E6';
const AMBER_BD = '#F2DFAE';
const AMBER_TX = '#8A6206';
const GREEN_TX = '#0B7A48';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const h2 = (t: string) => `<h2 style="margin:26px 0 10px;font-size:15px;color:${NAVY};border-left:4px solid ${BLUE};padding-left:10px;">${t}</h2>`;

function bulletList(items: string[], color = BLUE): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items.map((it) => `
    <tr>
      <td width="16" valign="top" style="padding:3px 0;"><div style="width:7px;height:7px;border-radius:50%;background:${color};margin-top:6px;"></div></td>
      <td style="padding:3px 0;font-size:13.5px;line-height:1.6;color:${INK};">${esc(it)}</td>
    </tr>`).join('')}</table>`;
}

/** The full branded roadmap email — SLA shell + roadmap body. */
export function renderRoadmapEmail(data: RoadmapData): string {
  const firstName = data.client_name.split(/\s+/)[0] || data.client_name;

  const summaryStrip = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${SOFT};border:1px solid ${LINE};border-radius:12px;margin:16px 0 4px;">
    <tr>
      <td width="33%" style="padding:13px 15px;border-right:1px solid ${LINE};">
        <div style="font-size:10px;font-weight:800;letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Track</div>
        <div style="font-size:13.5px;font-weight:800;color:${NAVY};padding-top:4px;">${esc(data.grade)}</div>
        ${data.profile ? `<div style="font-size:10.5px;color:${MUTED};padding-top:2px;">${esc(data.profile)}</div>` : ''}
      </td>
      <td width="33%" style="padding:13px 15px;border-right:1px solid ${LINE};">
        <div style="font-size:10px;font-weight:800;letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Evidence today</div>
        <div style="font-size:13.5px;font-weight:800;color:${NAVY};padding-top:4px;">${esc(data.evidence_score)}</div>
      </td>
      <td style="padding:13px 15px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:.12em;color:${MUTED};text-transform:uppercase;">Timeline</div>
        <div style="font-size:13.5px;font-weight:800;color:${NAVY};padding-top:4px;">${esc(data.timeline)}</div>
      </td>
    </tr>
  </table>`;

  const weeksRows = data.roadmap.map((w, i) => `
    <tr>
      <td valign="top" width="84" style="padding:11px 12px 11px 0;border-top:1px solid ${LINE};">
        <div style="font-size:12px;font-weight:800;color:${BLUE};white-space:nowrap;">${esc(w.week)}</div>
      </td>
      <td valign="top" style="padding:11px 0;border-top:1px solid ${LINE};">
        <div style="font-size:13px;font-weight:600;line-height:1.55;color:${INK};">${esc(w.task)}</div>
        ${w.why ? `<div style="font-size:11.5px;line-height:1.5;color:${MUTED};padding-top:3px;">${esc(w.why)}${w.priority ? ` &nbsp;<span style="font-size:9.5px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:4px;${w.priority.toUpperCase().includes('ESSENTIAL') ? `background:#FEE2E2;color:#991B1B` : w.priority.toUpperCase().includes('IMPORTANT') ? `background:#FEF3C7;color:#92400E` : `background:#E0F2FE;color:#0369A1`}">${esc(w.priority.toUpperCase())}</span>` : ''}</div>` : (w.priority ? `<div style="padding-top:3px;"><span style="font-size:9.5px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:4px;${w.priority.toUpperCase().includes('ESSENTIAL') ? `background:#FEE2E2;color:#991B1B` : w.priority.toUpperCase().includes('IMPORTANT') ? `background:#FEF3C7;color:#92400E` : `background:#E0F2FE;color:#0369A1`}">${esc(w.priority.toUpperCase())}</span></div>` : '')}
      </td>
      <td valign="top" width="24" align="right" style="padding:11px 0;border-top:1px solid ${LINE};">
        <div style="font-size:10.5px;font-weight:800;color:#B9C2D8;">${String(i + 1).padStart(2, '0')}</div>
      </td>
    </tr>`).join('');

  const priority = data.priority_actions.length ? h2('Priority actions') + `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${SOFT};border:1px solid ${LINE};border-radius:12px;">
    <tr><td style="padding:14px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${data.priority_actions.map((p, i) => `
        <tr>
          <td width="27" valign="top" style="padding:4px 0;"><div style="width:19px;height:19px;border-radius:6px;background:${NAVY};color:#fff;font-size:10.5px;font-weight:800;line-height:19px;text-align:center;">${i + 1}</div></td>
          <td style="padding:4px 0 4px 9px;font-size:13px;font-weight:600;line-height:1.55;color:${INK};">${esc(p)}</td>
        </tr>`).join('')}</table>
    </td></tr>
  </table>` : '';

  const flags = data.red_flags.length ? h2('Watch-outs before submission') + `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${AMBER_BG};border:1px solid ${AMBER_BD};border-radius:12px;">
    <tr><td style="padding:13px 16px;">${data.red_flags.map((r) => `
      <div style="font-size:12.5px;line-height:1.6;color:${AMBER_TX};padding:2px 0;">&#9888;&nbsp; ${esc(r)}</div>`).join('')}
    </td></tr>
  </table>` : '';

  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:${NAVY};">Your personalised endorsement roadmap</h1>
    <p style="margin:0 0 4px;font-size:13px;color:${MUTED};">Prepared for <b style="color:${INK};">${esc(data.client_name)}</b> · ${esc(data.route)}</p>
    ${summaryStrip}

    ${h2('Our assessment')}
    <p style="margin:0 0 12px;font-size:13.5px;line-height:1.7;color:${INK};">Dear ${esc(firstName)},</p>
    <p style="margin:0 0 12px;font-size:13.5px;line-height:1.7;color:${INK};">${esc(data.assessment)}</p>

    ${data.strengths.length ? h2('Where you already stand strong') + bulletList(data.strengths, GREEN_TX) : ''}
    ${data.gaps.length ? h2('The gaps we will close') + bulletList(data.gaps, '#C2410C') : ''}
    ${priority}

    ${h2('Your week-by-week roadmap')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-bottom:1px solid ${LINE};">
      ${weeksRows}
    </table>

    ${data.publications.length ? h2('Recommended publications') + bulletList(data.publications) : ''}
    ${data.speaking.length ? h2('Recommended speaking &amp; visibility') + bulletList(data.speaking) : ''}
    ${flags}

    ${h2('How the endorsement works')}
    ${roadmapVisaName(data) === 'Innovator Founder Visa'
      ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:${INK};">The Innovator Founder Visa is decided at <b>endorsement</b>: an endorsing body assesses your business against three tests — <b>innovative</b>, <b>viable</b> and <b>scalable</b> — and satisfies itself that you are genuinely the founder who will run it day to day. The visa itself follows almost administratively. Every activity in this roadmap strengthens one specific piece of that case — nothing here is busywork.</p>`
      : `<p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:${INK};">The Global Talent route is decided at <b>Stage 1 — endorsement</b>: an expert body reviews your evidence and confirms you as a leader or emerging leader in your field. The visa itself follows almost administratively. Every activity in this roadmap strengthens one specific piece of that evidence file — nothing here is busywork.</p>`}

    <p style="margin:14px 0 0;font-size:13.5px;line-height:1.7;color:${INK};">Work through the weeks in order — each one feeds the next. Your Migrizo case officer will review progress with you at every milestone and adjust the plan as your evidence lands. When you're ready, simply reply to this email and we'll take the next step together.</p>

    ${renderSignatureHtml(roadmapSignature(data))}

    <p style="margin:18px 0 0;font-size:10.5px;line-height:1.6;color:#9AA3B2;border-top:1px solid ${LINE};padding-top:12px;">This roadmap is strategic guidance based on the documents you shared; it is not legal advice. Guidance is verified against live GOV.UK and endorsing-body rules at every review.</p>
  `;

  return shell(
    `Your ${roadmapVisaName(data)} Roadmap — ${data.client_name}`,
    body,
    `${data.grade} · ${data.evidence_score} · ${data.timeline}`,
  );
}

/** Plain-text fallback for the email. */
export function renderRoadmapText(data: RoadmapData): string {
  const L: string[] = [];
  L.push(`YOUR ${roadmapVisaName(data).toUpperCase()} ROADMAP — ${data.client_name}`);
  L.push(`${data.route} · ${data.grade} · Evidence: ${data.evidence_score} · ${data.timeline}`, '');
  L.push('OUR ASSESSMENT', data.assessment, '');
  if (data.strengths.length) L.push('STRENGTHS', ...data.strengths.map((s) => `• ${s}`), '');
  if (data.gaps.length) L.push('GAPS TO CLOSE', ...data.gaps.map((s) => `• ${s}`), '');
  if (data.priority_actions.length) L.push('PRIORITY ACTIONS', ...data.priority_actions.map((s, i) => `${i + 1}. ${s}`), '');
  L.push('WEEK-BY-WEEK ROADMAP', ...data.roadmap.map((w) => `${w.week}: ${w.task}${w.why ? ` (${w.why})` : ''}${w.priority ? ` [${w.priority}]` : ''}`), '');
  if (data.publications.length) L.push('RECOMMENDED PUBLICATIONS', ...data.publications.map((s) => `• ${s}`), '');
  if (data.speaking.length) L.push('RECOMMENDED SPEAKING', ...data.speaking.map((s) => `• ${s}`), '');
  if (data.red_flags.length) L.push('WATCH-OUTS', ...data.red_flags.map((s) => `! ${s}`), '');
  L.push('', renderSignatureText(roadmapSignature(data)));
  return L.join('\n');
}
