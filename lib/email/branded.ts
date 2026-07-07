// =============================================================================
// MIGRIZO BRANDED EMAIL TEMPLATES
// -----------------------------------------------------------------------------
// One base layout (logo header, brand colors, footer) + three renderers:
//   * renderOnboarding(lead)          — welcome email, auto-sent on kickstart paid
//   * renderSLA(lead)                 — full service agreement, one-click from drawer
//   * renderInvoice(lead, payment, n) — milestone invoice, one-click per payment
//
// All templates are table-based inline-styled HTML (the only thing Gmail/Outlook
// render reliably). Logo is served from the CRM's own /public folder.
// =============================================================================

import type { Lead, Payment } from '@/lib/types';
import { MILESTONE_META } from '@/lib/types';

// Brand palette (matches the Migrizo brochure system)
const NAVY = '#16294E';
const BLUE = '#506BD8';
const GOLD = '#F4DE35';
const INK = '#1A1E27';
const MUTED = '#6B7280';
const BG = '#F2F4F8';
const LOGO_URL = 'https://crm.migrizo.com/migrizo-email-logo.png';

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', GBP: '£', USD: '$' };
const CURRENCY_LOCALE: Record<string, string> = { INR: 'en-IN', GBP: 'en-GB', USD: 'en-US' };
function money(n: number, currency: string): string {
  const code = CURRENCY_SYMBOL[currency] ? currency : 'INR';
  return CURRENCY_SYMBOL[code] + (n ?? 0).toLocaleString(CURRENCY_LOCALE[code]);
}
function esc(s: string | null | undefined): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function today(): string {
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Base layout — every email is wrapped in this shell.
// ---------------------------------------------------------------------------
function shell(title: string, bodyHtml: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
        <!-- Header: white card with logo + navy accent bar -->
        <tr><td style="background:#ffffff;border-radius:14px 14px 0 0;padding:26px 32px 20px;border-bottom:4px solid ${NAVY};" align="left">
          <img src="${LOGO_URL}" alt="Migrizo — Smart. Fast. Reliable Visas" width="190" style="display:block;max-width:190px;height:auto;"/>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px;">
          ${bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:${NAVY};border-radius:0 0 14px 14px;padding:22px 32px;" align="left">
          <div style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Migrizo</div>
          <div style="font-size:11.5px;color:#C7D0E4;margin-top:4px;line-height:1.6;">
            Smart. Fast. Reliable Visas · <a href="https://www.migrizo.com" style="color:${GOLD};text-decoration:none;">www.migrizo.com</a><br/>
            WhatsApp: <a href="https://wa.me/919999311087" style="color:${GOLD};text-decoration:none;">+91 99993 11087</a>
          </div>
          <div style="font-size:10px;color:#8FA0C4;margin-top:10px;">This email was sent by Migrizo regarding your visa engagement. Please do not share confidential documents over email unless requested through official channels.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function h1(t: string) { return `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:${NAVY};">${t}</h1>`; }
function h2(t: string) { return `<h2 style="margin:26px 0 8px;font-size:15px;color:${NAVY};border-left:4px solid ${BLUE};padding-left:10px;">${t}</h2>`; }
function p(t: string) { return `<p style="margin:0 0 12px;font-size:13.5px;line-height:1.7;color:${INK};">${t}</p>`; }
function small(t: string) { return `<p style="margin:0 0 10px;font-size:11.5px;line-height:1.6;color:${MUTED};">${t}</p>`; }

// ---------------------------------------------------------------------------
// 1) ONBOARDING — auto-sent when the kickstart payment is marked paid.
// ---------------------------------------------------------------------------
export function renderOnboarding(lead: Pick<Lead, 'full_name' | 'visa_type'>): { subject: string; html: string; text: string } {
  const first = (lead.full_name || 'there').split(' ')[0];
  const visa = (lead.visa_type || '').toLowerCase().includes('ifv') || (lead.visa_type || '').toLowerCase().includes('innovator')
    ? 'Innovator Founder Visa' : 'Global Talent Visa';

  const steps = [
    ['1', 'Roadmap call', 'Your case manager schedules a kickoff call and walks you through your personalised roadmap.'],
    ['2', 'Document collection', 'We share a precise checklist. You upload; we structure everything to UK standards.'],
    ['3', 'Profile building', 'Evidence, recognition, publications and recommendation letters — built milestone by milestone.'],
    ['4', 'Submission & beyond', 'We prepare, review and submit — then guide you through the visa stage and landing in the UK.'],
  ].map(([n, t, d]) => `
    <tr>
      <td width="44" valign="top" style="padding:10px 0;">
        <div style="width:30px;height:30px;border-radius:50%;background:${BLUE};color:#fff;font-weight:700;font-size:13px;text-align:center;line-height:30px;">${n}</div>
      </td>
      <td valign="top" style="padding:10px 0;">
        <div style="font-size:13.5px;font-weight:700;color:${NAVY};">${t}</div>
        <div style="font-size:12.5px;color:${MUTED};line-height:1.6;margin-top:2px;">${d}</div>
      </td>
    </tr>`).join('');

  const body = `
    ${h1(`Welcome aboard, ${esc(first)} 🎉`)}
    ${p(`Your <b>${visa}</b> journey with Migrizo has officially begun. We've received your kickstart payment and your case is now active — thank you for trusting us with something this important.`)}
    <div style="background:${BG};border-radius:12px;padding:6px 18px;margin:18px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
    </div>
    ${h2('What we need from you now')}
    ${p(`Nothing yet — your case manager will reach out within <b>1 working day</b> with your kickoff call slot and document checklist. If anything is urgent in the meantime, just reply to this email or message us on WhatsApp.`)}
    ${p(`We're glad you're here. Let's build a winning case.`)}
    ${p(`— Team Migrizo`)}
  `;
  return {
    subject: `Welcome to Migrizo — your ${visa} journey starts now`,
    html: shell('Welcome to Migrizo', body, 'Your case is active. Here is what happens next.'),
    text: `Welcome aboard, ${first}! Your ${visa} journey with Migrizo has begun. Your case manager will reach out within 1 working day with your kickoff call and document checklist. — Team Migrizo`,
  };
}

// ---------------------------------------------------------------------------
// 2) SLA — full professional services agreement, autofilled from the lead.
//    Legal text is kept verbatim from the source agreement; only the visual
//    branding (logo, layout) is Migrizo. M4 references are part of the
//    contract's legal content and are intentionally preserved.
// ---------------------------------------------------------------------------
export function renderSLA(lead: Pick<Lead, 'full_name' | 'email' | 'phone'>): { subject: string; html: string; text: string } {
  const name = esc(lead.full_name);
  const email = esc(lead.email || '—');
  const phone = esc(lead.phone || '—');

  const kv = (k: string, v: string) => `
    <tr>
      <td style="padding:7px 12px;background:${BG};font-size:12px;font-weight:700;color:${NAVY};width:190px;border-bottom:2px solid #fff;">${k}</td>
      <td style="padding:7px 12px;background:#F8F9FC;font-size:12.5px;color:${INK};border-bottom:2px solid #fff;">${v}</td>
    </tr>`;

  const feeRow = (n: string, d: string, a: string, by: string) => `
    <tr>
      <td style="padding:8px 10px;font-size:12px;color:${MUTED};border-bottom:1px solid #E7EAF1;">${n}</td>
      <td style="padding:8px 10px;font-size:12.5px;color:${INK};border-bottom:1px solid #E7EAF1;line-height:1.5;">${d}</td>
      <td style="padding:8px 10px;font-size:12.5px;font-weight:700;color:${NAVY};border-bottom:1px solid #E7EAF1;white-space:nowrap;" align="right">${a}</td>
      <td style="padding:8px 10px;font-size:11.5px;color:${MUTED};border-bottom:1px solid #E7EAF1;white-space:nowrap;">${by}</td>
    </tr>`;

  const li = (t: string) => `<li style="font-size:12.5px;line-height:1.7;color:${INK};margin-bottom:6px;">${t}</li>`;

  const body = `
    ${h1('Global Talent Visa (UK) — Professional Services Agreement')}
    ${small(`Issued ${today()} · Please read carefully. Replying "I Agree" to this email, signing, or making the kickstart payment constitutes acceptance of this Agreement.`)}

    ${h2('1. Parties to this Agreement')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
      ${kv('Service Provider', 'M4 Investments Ltd (trading as Migrizo)')}
      ${kv('Head Office — Registered Address', 'Suite 39, Podium, 85 Ealing Cross, Ealing, London, W5 5BW, United Kingdom')}
      ${kv('Registered In', 'England &amp; Wales')}
      ${kv('Indian Partner', 'Migrizo Ventures Pvt Ltd. (Formerly known as Grownmind Educational Services Pvt Ltd)')}
      ${kv('Director', 'Jeet Choudhary')}
      ${kv('AVP — India Operations', 'Shailendra Pathak')}
      ${kv('Website', '<a href="https://www.migrizo.com" style="color:' + BLUE + ';">www.migrizo.com</a>')}
      ${kv('Telephone', '+44 7887 348822')}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      ${kv('Client Full Name', `<b>${name}</b>`)}
      ${kv('Email Address', email)}
      ${kv('Contact Number', phone)}
      ${kv('Nationality', 'Indian')}
    </table>
    ${p(`This Service Agreement ("Agreement") is entered into on the date last signed below between M4 Investments Ltd ("Migrizo" / "Service Provider") and the above-named individual ("Client"). Both parties agree to the terms and conditions set out herein.`)}

    ${h2('2. Authorisation of Indian Operations')}
    ${p(`M4 Investments Ltd, a company registered in England and Wales, hereby authorises and acknowledges that Migrizo Ventures Pvt Ltd. (Formerly known as Grownmind Educational Services Pvt Ltd), operating under the brand name Migrizo (accessible at www.migrizo.com), serves as its officially recognised Indian partner and subsidiary for the purposes of client acquisition, consultation, documentation support, and end-to-end immigration advisory services in India. All services rendered by Grownmind Educational Services Pvt Ltd under the Migrizo brand in relation to UK immigration matters, including but not limited to the Global Talent Visa, are conducted under the authority, oversight, and full accountability of M4 Investments Ltd. Clients engaging with Migrizo in India are hereby assured that they are engaging with a recognised representative of M4 Investments Ltd, and all commitments made by Migrizo under a duly executed Service Agreement are binding upon and backed by M4 Investments Ltd. Clients can make all the relevant payments of cases either in an Indian bank account or in a UK bank account.`)}

    ${h2('3. Purpose &amp; Scope of Services')}
    ${p(`Migrizo agrees to provide end-to-end advisory, documentation, and submission support services to assist the Client in applying for a Global Talent Visa under the UK Home Office immigration framework. The scope of engagement is described below.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.1 Profile Evaluation &amp; Eligibility Assessment</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Detailed review of the Client's professional profile against UK Global Talent endorsement criteria.`)}
      ${li(`Clear eligibility mapping to the relevant endorsing body (e.g., Tech Nation, UKRI, British Academy, Royal Society, Royal Academy of Engineering, Arts Council England).`)}
      ${li(`Identification of profile gaps and a structured action plan to address them.`)}
    </ul>
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.2 Roadmap Delivery</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`A customised, step-by-step roadmap outlining the Client's responsibilities and Migrizo's deliverables throughout the process.`)}
      ${li(`Clear timelines, milestones, and documentation checklists.`)}
    </ul>
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.3 Profile Building Support</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Project documentation, impact articulation, and recognition profiling.`)}
      ${li(`Publication of articles and media features through third-party PR agencies (managed and coordinated by Migrizo; PR costs are payable directly by the Client).`)}
      ${li(`Building relevant UK industry networks and connections to support the Client's professional visibility and post-landing opportunities.`)}
    </ul>
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.4 Supporting Document Preparation</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`UK-style CV drafting and optimisation.`)}
      ${li(`LinkedIn profile optimization.`)}
      ${li(`Cover letter preparation.`)}
      ${li(`Drafting of Personal Statement and structuring of evidence portfolio.`)}
      ${li(`Drafting of recommendation letter templates in the format accepted by UK endorsing bodies. (Note: The Client is responsible for securing actual letters from their referees — see Section 6.4.)`)}
      ${li(`Strong reference letter drafting support for senior referees.`)}
    </ul>
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.5 Endorsement Application</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Full preparation and submission of the endorsement application to the relevant UK endorsing body.`)}
      ${li(`Compilation and structuring of all supporting evidence.`)}
      ${li(`Communication management with the endorsing body, where applicable.`)}
    </ul>
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">3.6 Visa Application Support</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Complete guidance on filing the visa application with UK Visas &amp; Immigration (UKVI) following endorsement approval.`)}
      ${li(`Guidance on payment of Immigration Health Surcharge (IHS).`)}
      ${li(`Advice on dependant applications (spouse / children).`)}
      ${li(`Post-landing guidance: work setup, National Insurance Number, and ILR planning.`)}
    </ul>

    ${h2('4. Fee Schedule &amp; Payment Terms')}
    ${p(`The total professional fee payable to Migrizo for the end-to-end Global Talent Visa service is <b>£3,000</b> (Three Thousand Pounds Sterling). This is structured as milestone-based payments as detailed below. Certain government and third-party costs are payable directly by the Client and are not included in Migrizo's professional fee.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;border:1px solid #E7EAF1;border-radius:10px;overflow:hidden;">
      <tr style="background:${NAVY};">
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#fff;">#</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#fff;">Milestone / Description</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#fff;" align="right">Amount</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#fff;">Paid By</td>
      </tr>
      ${feeRow('1', 'Kickstart Fee — Engagement commencement, roadmap initiation', '£500', 'Client → Migrizo')}
      ${feeRow('2', 'Profile Building Commencement — Following roadmap delivery, profile development begins (50% of remaining professional fee)', '£1,250', 'Client → Migrizo')}
      ${feeRow('3', 'Endorsement Application Submission Fee — Due at the time of submission to UK Home Office', '£500', 'Client → Migrizo')}
      ${feeRow('4', 'Final Professional Fee Balance — Payable upon receipt of endorsement approval from UK Home Office', '£750', 'Client → Migrizo')}
      <tr style="background:#FBF7DE;">
        <td style="padding:8px 10px;"></td>
        <td style="padding:8px 10px;font-size:12.5px;font-weight:800;color:${NAVY};">TOTAL PROFESSIONAL FEE (Migrizo)</td>
        <td style="padding:8px 10px;font-size:13px;font-weight:800;color:${NAVY};" align="right">£3,000</td>
        <td style="padding:8px 10px;"></td>
      </tr>
      ${feeRow('5', 'Profile Building / PR Agency Costs — Paid directly to third-party PR agencies; varies by candidate profile (approx. £1,000–£1,500). Migrizo manages content and coordination.', '£1,000–£1,500', 'Client → PR Agency (Direct)')}
      ${feeRow('6', 'UK Government: Endorsement Application Fee', '£600', 'Client → UKVI')}
      ${feeRow('7', 'UK Government: Visa Application Fee', '£300', 'Client → UKVI')}
      ${feeRow('8', 'UK Government: Immigration Health Surcharge (IHS) — £1,035 per person per year (e.g., 3-year visa ≈ £3,105)', '£1,035/yr/person', 'Client → UKVI')}
    </table>
    ${p(`It is suggested to release the payment on time in phases for the smooth operations and process flow. Delay in payments might cause the nullify the agreement and company will not be liable to any responsibility in lieu of the successful application.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">Important Notes on Fees</div>
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`All payments to Migrizo (India) OR M4 Investment Ltd. (UK) must be made via bank transfer to the account details provided in the invoice issued at each milestone. Receipts will be issued for every payment received.`)}
      ${li(`PR Agency / Profile Building costs (Item 5 above) are variable and will be confirmed once the Client's profile has been assessed and a publishing plan is finalised. The £500 is indicative; candidates with existing publications, media coverage, or research papers may incur lower costs.`)}
      ${li(`Government fees (Items 6, 7 &amp; 8) are subject to change by the UK Home Office without notice. The Client is responsible for verifying the current fee schedule at www.gov.uk/global-talent prior to payment.`)}
      ${li(`IHS charges are calculated per person, per year, for the visa duration applied for. Dependants are charged separately.`)}
      ${li(`All fees are quoted in Pounds Sterling (£). International clients are responsible for any currency conversion or banking transaction charges.`)}
    </ul>

    ${h2('5. Cancellation &amp; Refund Policy')}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.1 Cancellation by the Client</div>
    ${p(`In the event that the Client elects to cancel, withdraw, or discontinue the engagement at any stage after the commencement of services, all fees paid to Migrizo or M4 Investments Ltd shall remain strictly non-refundable. The Client acknowledges that the services provided under this Agreement are advisory, strategic, and intellectual in nature, and are deemed to have been consumed upon delivery of consultation, roadmap planning, documentation support, or any related service component. The Client further acknowledges that services shall be deemed to have commenced and partially or substantially delivered upon the initiation of any consultation, communication of strategy, sharing of roadmap, allocation of internal resources, or engagement of personnel by Migrizo, irrespective of whether the overall scope of services has been fully completed.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.2 Nature of Services and Fee Structure</div>
    ${p(`The Client expressly agrees that all payments made under this Agreement are in consideration of professional time, expertise, resource allocation, and strategic guidance provided by Migrizo. Such services are non-tangible, non-returnable, and cannot be reversed once delivered. Accordingly, fees paid are not contingent upon any specific outcome, including but not limited to endorsement approval, visa grant, or immigration success.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.3 No Refund on Unsuccessful Outcome</div>
    ${p(`The Client understands and agrees that all decisions relating to endorsement and visa applications are made solely by the UK Home Office, UK Visas &amp; Immigration (UKVI), and/or relevant endorsing bodies. Migrizo has no control over such decisions. Therefore, under no circumstances shall any refund be issued in the event of an unsuccessful application, regardless of the reason, including where no fault, error, or omission is attributed to the Client. However, Migrizo will reapply next time with fresh evidence, narration, and fresh bundle of evidence without any cost and shall not charge anything for full strategy end to end. Client will only need to pay £561 for endorsement application fee on UK Home office website.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.4 External Factors and Policy Changes</div>
    ${p(`The Client acknowledges that immigration policies, endorsement criteria, and regulatory requirements may change at any time and are outside the control of Migrizo. Any such changes, including delays, refusals, or additional requirements imposed by authorities, shall not constitute grounds for any refund, compensation, or claim against Migrizo.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.5 Termination by Either Party</div>
    ${p(`In the event of termination of this Agreement by either the Client or Migrizo, for any reason whatsoever, all fees paid up to the date of termination shall remain non-refundable. Migrizo reserves the right to discontinue services where the Client fails to comply with obligations, delays communication, or engages in conduct that may affect the integrity of the application process, without any liability for refund.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.6 Waiver of Refund Claims</div>
    ${p(`By entering into this Agreement, the Client expressly waives any right to seek refunds, reversals, or chargebacks of fees paid, including through financial institutions, payment gateways, or legal proceedings, on the basis of dissatisfaction with outcomes, perceived service quality, or any other reason related to the application process.`)}
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin:12px 0 4px;">5.7 Service Satisfaction and Dispute Waiver</div>
    ${p(`The Client agrees that any dissatisfaction with the quality, speed, format, or perceived effectiveness of the services provided shall not constitute grounds for any refund, dispute, or chargeback. The Client acknowledges that the services rendered under this Agreement are advisory, strategic, and subjective in nature, and may vary based on individual profile, external factors, and regulatory assessment criteria. Accordingly, no claims shall arise on the basis of perceived service inadequacy or unmet expectations.`)}

    ${h2('6. Client Obligations')}
    ${p(`The Client acknowledges and agrees to the following obligations, all of which are essential to the success of the application:`)}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Provide accurate, complete, and truthful information, documents, and details as requested by Migrizo at each stage of the process.`)}
      ${li(`Complete all tasks and activities outlined in the personalised roadmap delivered by Migrizo. Non-completion of mandatory roadmap tasks shall constitute a material breach of this Agreement and shall not give rise to any refund, compensation, or claim against Migrizo under any circumstances.`)}
      ${li(`Actively participate in the profile-building process, including attending briefing sessions, providing timely feedback on drafts, and engaging with PR activities as directed.`)}
      ${li(`Ensure that all recommendation letter writers are genuine professional contacts who can authentically vouch for the Client's achievements and know the Client personally. Migrizo assists in drafting the content; the Client is solely responsible for the availability, authenticity, and willingness of referees.`)}
      ${li(`Respond to communications from Migrizo within a reasonable timeframe (typically 48–72 hours on working days) to avoid delays in the process.`)}
      ${li(`Notify Migrizo immediately of any material changes to personal circumstances (e.g., change of employer, criminal record, immigration history updates) that may affect the application.`)}
      ${li(`Comply with all UK immigration laws and UKVI requirements at all times.`)}
      ${li(`Make all payments in accordance with the fee schedule in Section 4. Delays in payment may result in delays to the service and/or suspension of work.`)}
    </ul>

    ${h2('7. No Guarantee of Outcome')}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Migrizo provides professional advisory, preparation, and submission services only. Migrizo does not guarantee the approval of any visa application, endorsement application, or any other immigration-related decision.`)}
      ${li(`All immigration decisions are made solely and exclusively by the UK Home Office, UK Visas &amp; Immigration (UKVI), and/or the relevant endorsing body. Migrizo has no influence, control, or relationship with any UK government official, Home Office caseworker, or endorsing body assessor.`)}
      ${li(`Approval or rejection of an application is entirely at the discretion of the UK Home Office and is subject to their due diligence processes, immigration rules, and applicable policies at the time of assessment.`)}
      ${li(`Any change in UK immigration policy, endorsement criteria, or Home Office guidelines after the commencement of this Agreement is beyond Migrizo's control and shall not constitute grounds for a refund or claim against Migrizo.`)}
      ${li(`Migrizo shall not be liable for any consequential loss, financial loss, loss of employment opportunity, or other damages arising from an unsuccessful visa or endorsement application.`)}
    </ul>

    ${h2('8. Confidentiality')}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Both parties agree to keep confidential all personal data, documents, and information exchanged under this Agreement and to use such information solely for the purposes of the immigration application.`)}
      ${li(`Migrizo will handle all Client data in accordance with applicable data protection laws, including the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.`)}
      ${li(`The Client consents to Migrizo storing, processing, and (where necessary) sharing their personal data with UK endorsing bodies, PR agencies, and UKVI solely for the purposes of this engagement.`)}
      ${li(`Migrizo will not disclose Client information to any third party for marketing or commercial purposes without explicit written consent.`)}
    </ul>

    ${h2('9. Limitation of Liability')}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`Migrizo's total aggregate liability to the Client under or in connection with this Agreement shall not exceed the total professional fees paid by the Client to Migrizo at the time the claim arises.`)}
      ${li(`Migrizo shall not be liable for: (a) delays caused by the Client's failure to provide required documents or complete roadmap tasks; (b) decisions made by UKVI, the Home Office, or any endorsing body; (c) changes in UK immigration rules or policies; (d) any indirect, consequential, or special loss.`)}
    </ul>

    ${h2('10. Intellectual Property')}
    ${p(`All content, documents, templates, strategies, and written materials prepared by Migrizo under this Agreement remain the intellectual property of M4 Investments Ltd. They are provided for the Client's personal use in connection with their visa application only and may not be reproduced, resold, or shared without Migrizo's express written consent.`)}

    ${h2('11. Governing Law &amp; Dispute Resolution')}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`This Agreement shall be governed by and construed in accordance with the laws of Uttar Pradesh, India.`)}
      ${li(`In the event of any dispute arising under or in connection with this Agreement, the parties shall first attempt to resolve the matter amicably through good-faith negotiation within 30 days of written notice.`)}
      ${li(`If the dispute cannot be resolved amicably, either party may refer the matter to mediation before commencing legal proceedings.`)}
      ${li(`The courts of Noida shall have exclusive jurisdiction over any disputes arising from this Agreement.`)}
    </ul>

    ${h2('12. General Provisions')}
    <ul style="margin:0 0 10px;padding-left:20px;">
      ${li(`<b>Entire Agreement:</b> This Agreement constitutes the entire understanding between the parties and supersedes all prior representations, discussions, or agreements relating to the subject matter herein.`)}
      ${li(`<b>Amendments:</b> Any amendments to this Agreement must be made in writing and signed by both parties.`)}
      ${li(`<b>Severability:</b> If any provision of this Agreement is found to be unenforceable, the remaining provisions shall continue in full force and effect.`)}
      ${li(`<b>Waiver:</b> Failure by either party to enforce any provision of this Agreement shall not constitute a waiver of that provision or any other right.`)}
      ${li(`<b>Notices:</b> All formal notices under this Agreement shall be sent by email to the addresses recorded at the head of this Agreement and shall be deemed received within 24 hours of sending.`)}
    </ul>

    ${h2('13. Declaration &amp; Acceptance')}
    ${p(`By signing below, both parties confirm that they have read, understood, and agree to be bound by all the terms and conditions of this Agreement.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
      <tr>
        <td width="48%" valign="top" style="background:${BG};border-radius:10px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.4px;">FOR AND ON BEHALF OF</div>
          <div style="font-size:12.5px;font-weight:800;color:${NAVY};margin-top:2px;">M4 INVESTMENTS LTD (Migrizo)</div>
          <div style="font-size:12px;color:${MUTED};margin-top:22px;border-top:1px solid #D9DEE9;padding-top:8px;">Signature</div>
          <div style="font-size:13px;font-weight:700;color:${INK};">Shailendra Pathak</div>
          <div style="font-size:11.5px;color:${MUTED};">AVP, M4 Investments Ltd, Migrizo</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:6px;">Date: ${today()}</div>
        </td>
        <td width="4%"></td>
        <td width="48%" valign="top" style="background:${BG};border-radius:10px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.4px;">CLIENT ACKNOWLEDGEMENT</div>
          <div style="font-size:12.5px;font-weight:800;color:${NAVY};margin-top:2px;">${name}</div>
          <div style="font-size:12px;color:${MUTED};margin-top:22px;border-top:1px solid #D9DEE9;padding-top:8px;">Signature</div>
          <div style="font-size:13px;font-weight:700;color:${INK};">${name}</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:6px;">Date: ____________</div>
        </td>
      </tr>
    </table>
    ${small(`To accept this Agreement, simply reply to this email with "I Agree", or sign and return a copy. M4 Investments Ltd | www.migrizo.com | +44 7887 348822 | Suite 39, Podium, 85 Ealing Cross, Ealing, London W5 5BW, United Kingdom`)}
  `;
  return {
    subject: `Migrizo — Your Global Talent Visa Service Agreement`,
    html: shell('Migrizo Service Agreement', body, 'Your professional services agreement — please review and accept.'),
    text: `Dear ${lead.full_name}, please find your Global Talent Visa Professional Services Agreement with Migrizo. Review the full terms in this email and reply "I Agree" to accept. — Team Migrizo`,
  };
}

// ---------------------------------------------------------------------------
// 3) INVOICE — world-class milestone invoice.
//    Company: Grownmind Educational Services Pvt Ltd · GSTIN 09AAECG9536E1ZF
//    Tax-inclusive, CGST/SGST 0% (matches the existing Zoho invoice treatment).
// ---------------------------------------------------------------------------
export function renderInvoice(
  lead: Pick<Lead, 'full_name' | 'email' | 'phone' | 'visa_type' | 'currency'>,
  payment: Pick<Payment, 'id' | 'milestone' | 'amount' | 'status' | 'paid_at' | 'created_at'>,
  invoiceNo: string,
): { subject: string; html: string; text: string } {
  const currency = lead.currency || 'INR';
  const amount = payment.amount || 0;
  const milestone = MILESTONE_META[payment.milestone]?.label || payment.milestone;
  const visa = (lead.visa_type || '').toLowerCase().includes('ifv') || (lead.visa_type || '').toLowerCase().includes('innovator')
    ? 'Innovator Founder Visa' : 'Global Talent Visa';
  const isPaid = payment.status === 'paid';
  const dateStr = new Date(payment.paid_at || payment.created_at || Date.now())
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const badge = isPaid
    ? `<span style="display:inline-block;background:#E6F7EE;color:#047857;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 14px;border-radius:999px;">PAID</span>`
    : `<span style="display:inline-block;background:#FEF3C7;color:#B45309;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 14px;border-radius:999px;">DUE ON RECEIPT</span>`;

  const trow = (k: string, v: string, strong = false) => `
    <tr>
      <td style="padding:6px 0;font-size:12.5px;color:${strong ? NAVY : MUTED};font-weight:${strong ? 800 : 400};">${k}</td>
      <td style="padding:6px 0;font-size:${strong ? '15px' : '12.5px'};color:${strong ? NAVY : INK};font-weight:${strong ? 800 : 600};" align="right">${v}</td>
    </tr>`;

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
      <tr>
        <td>
          ${h1('Tax Invoice')}
          <div style="font-size:12.5px;color:${MUTED};">Invoice <b style="color:${INK};">${esc(invoiceNo)}</b> · ${dateStr}</div>
        </td>
        <td align="right" valign="top">${badge}</td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td width="48%" valign="top" style="background:${BG};border-radius:10px;padding:14px 16px;">
          <div style="font-size:10.5px;font-weight:800;color:${MUTED};letter-spacing:0.6px;">FROM</div>
          <div style="font-size:13px;font-weight:800;color:${NAVY};margin-top:3px;">Grownmind Educational Services Pvt Ltd</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:2px;">GSTIN: 09AAECG9536E1ZF · India</div>
          <div style="font-size:11.5px;color:${MUTED};">Brand: Migrizo · www.migrizo.com</div>
        </td>
        <td width="4%"></td>
        <td width="48%" valign="top" style="background:${BG};border-radius:10px;padding:14px 16px;">
          <div style="font-size:10.5px;font-weight:800;color:${MUTED};letter-spacing:0.6px;">BILL TO</div>
          <div style="font-size:13px;font-weight:800;color:${NAVY};margin-top:3px;">${esc(lead.full_name)}</div>
          <div style="font-size:11.5px;color:${MUTED};margin-top:2px;">${esc(lead.email || '')}</div>
          <div style="font-size:11.5px;color:${MUTED};">${esc(lead.phone || '')}</div>
        </td>
      </tr>
    </table>

    <!-- Line item -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7EAF1;border-radius:12px;overflow:hidden;margin-bottom:16px;">
      <tr style="background:${NAVY};">
        <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#fff;">DESCRIPTION</td>
        <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#fff;" align="center">HSN/SAC</td>
        <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#fff;" align="right">AMOUNT</td>
      </tr>
      <tr>
        <td style="padding:14px;font-size:13px;color:${INK};line-height:1.5;">
          <b>${esc(milestone)} Fee — ${visa}</b><br/>
          <span style="font-size:11.5px;color:${MUTED};">Migrizo professional services · milestone payment</span>
        </td>
        <td style="padding:14px;font-size:12.5px;color:${MUTED};" align="center">998599</td>
        <td style="padding:14px;font-size:13.5px;font-weight:800;color:${NAVY};white-space:nowrap;" align="right">${money(amount, currency)}</td>
      </tr>
    </table>

    <!-- Totals -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
      <tr>
        <td width="52%" valign="top">
          <div style="font-size:11px;font-weight:800;color:${MUTED};letter-spacing:0.6px;margin-bottom:4px;">NOTES</div>
          <div style="font-size:12px;color:${INK};line-height:1.6;">Thank you for your trust in our services.</div>
        </td>
        <td width="48%" valign="top" style="background:${BG};border-radius:10px;padding:12px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${trow('Sub Total <span style="font-size:10.5px;">(Tax Inclusive)</span>', money(amount, currency))}
            ${trow('CGST (0%)', money(0, currency))}
            ${trow('SGST (0%)', money(0, currency))}
            <tr><td colspan="2" style="border-top:2px solid ${NAVY};padding-top:2px;"></td></tr>
            ${trow('Total', money(amount, currency), true)}
            ${isPaid ? trow('Balance Due', money(0, currency)) : trow('Balance Due', money(amount, currency), true)}
          </table>
        </td>
      </tr>
    </table>

    ${!isPaid ? `
    <!-- Bank details (only on unpaid invoices) -->
    <div style="border:1.5px solid ${GOLD};background:#FFFDF2;border-radius:12px;padding:14px 18px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:${NAVY};letter-spacing:0.6px;margin-bottom:6px;">PAYMENT DETAILS — BANK TRANSFER</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12.5px;color:${INK};line-height:1.9;">
        <tr><td style="color:${MUTED};padding-right:18px;">Account Name</td><td><b>Grownmind Educational Services Pvt Ltd</b></td></tr>
        <tr><td style="color:${MUTED};padding-right:18px;">Bank</td><td>ICICI Bank, Noida — Sector 63</td></tr>
        <tr><td style="color:${MUTED};padding-right:18px;">Account No</td><td><b>081605010665</b></td></tr>
        <tr><td style="color:${MUTED};padding-right:18px;">IFSC</td><td><b>ICIC0000816</b></td></tr>
        <tr><td style="color:${MUTED};padding-right:18px;">Branch Code</td><td>000816</td></tr>
        <tr><td style="color:${MUTED};padding-right:18px;">SWIFT</td><td>ICICINBBNRI</td></tr>
      </table>
      <div style="font-size:11px;color:${MUTED};margin-top:8px;">Please share the transfer confirmation on WhatsApp or by replying to this email.</div>
    </div>` : `
    <div style="background:#E6F7EE;border-radius:12px;padding:14px 18px;margin-bottom:14px;">
      <div style="font-size:12.5px;color:#047857;font-weight:700;">✓ Payment received — this invoice serves as your official receipt.</div>
    </div>`}

    <div style="font-size:11.5px;color:${MUTED};line-height:1.6;">
      Authorized Signatory: <b style="color:${INK};">Shailendra Pathak</b> · Grownmind Educational Services Pvt Ltd (Migrizo)
    </div>
  `;
  return {
    subject: `${isPaid ? 'Receipt' : 'Invoice'} ${invoiceNo} — ${milestone} · Migrizo`,
    html: shell(`Invoice ${invoiceNo}`, body, `${milestone} — ${money(amount, currency)} · ${isPaid ? 'Paid' : 'Due on receipt'}`),
    text: `${isPaid ? 'Receipt' : 'Invoice'} ${invoiceNo} from Migrizo (Grownmind Educational Services Pvt Ltd). ${milestone} Fee — ${visa}: ${money(amount, currency)}. ${isPaid ? 'Payment received, thank you.' : 'Bank: ICICI, A/C 081605010665, IFSC ICIC0000816.'}`,
  };
}
