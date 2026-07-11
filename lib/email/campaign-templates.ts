// =============================================================================
// CAMPAIGN TEMPLATE LIBRARY — 13 marketing emails for lead nurture.
// Visually rich, email-safe (inline CSS, table layout, no JS), on-brand with
// the Migrizo GTV email. Each returns { subject, html } given a first name.
// A {{name}} greeting personalises; an unsubscribe footer is appended by the
// send route (so it's always present and consistent).
// =============================================================================

const NAVY = '#16294E';
const BLUE = '#3E56D4';
const GOLD = '#F4C430';
const INK = '#2B3450';
const MUTED = '#6B7280';
const BG = '#EEF1F8';
const LOGO = 'https://crm.migrizo.com/migrizo-email-logo.png';
const WA = 'https://wa.me/447887348822';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shared shell: logo header, white body, navy footer. {{UNSUB}} placeholder is
// replaced by the send route with the real unsubscribe link.
function shell(bodyHtml: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:26px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#fff;border-radius:14px 14px 0 0;padding:24px 30px 18px;border-bottom:4px solid ${NAVY};" align="left">
        <img src="${LOGO}" alt="Migrizo" width="180" style="display:block;max-width:180px;height:auto;"/>
      </td></tr>
      <tr><td style="background:#fff;padding:30px 30px 34px;">${bodyHtml}</td></tr>
      <tr><td style="background:${NAVY};border-radius:0 0 14px 14px;padding:20px 30px;" align="left">
        <div style="font-size:13px;font-weight:700;color:#fff;">Migrizo</div>
        <div style="font-size:11.5px;color:#C7D0E4;margin-top:4px;line-height:1.6;">Smart. Fast. Reliable Visas · <a href="https://www.migrizo.com" style="color:${GOLD};text-decoration:none;">www.migrizo.com</a><br/><a href="mailto:info@migrizo.com" style="color:${GOLD};text-decoration:none;">info@migrizo.com</a> · <a href="${WA}" style="color:${GOLD};text-decoration:none;">+44 7887 348822</a></div>
        <div style="font-size:10px;color:#8FA0C4;margin-top:12px;line-height:1.6;">You're receiving this because you enquired about UK visa options with Migrizo.<br/>{{UNSUB}}</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ---- building blocks --------------------------------------------------------
const eyebrow = (t: string) => `<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:${BLUE};text-transform:uppercase;margin-bottom:10px;">${t}</div>`;
const h1 = (t: string) => `<h1 style="margin:0 0 14px;font-size:25px;line-height:1.25;color:${NAVY};font-weight:800;">${t}</h1>`;
const para = (t: string) => `<p style="margin:0 0 15px;font-size:14.5px;line-height:1.75;color:${INK};">${t}</p>`;
const greet = (name: string) => para(`Hi ${esc(name)},`);

function cta(label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr>
    <td align="center" bgcolor="${GOLD}" style="border-radius:10px;">
      <a href="${WA}" target="_blank" style="display:inline-block;padding:14px 30px;font-size:14.5px;font-weight:800;color:${NAVY};border-radius:10px;">${label}</a>
    </td></tr></table>`;
}

// Highlight callout box (for the emotional/stat lines)
function callout(inner: string, tint = '#EEF2FF', border = BLUE) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
    <td style="background:${tint};border-left:4px solid ${border};border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.65;color:${NAVY};font-weight:600;">${inner}</td>
  </tr></table>`;
}

// Numbered stat row (two big numbers side by side)
function statPair(a: string, al: string, b: string, bl: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>
    <td width="50%" style="padding:4px;"><div style="background:#FDECEC;border-radius:12px;padding:18px 10px;text-align:center;"><div style="font-size:34px;font-weight:800;color:#DC2626;">${a}</div><div style="font-size:12px;color:${MUTED};margin-top:2px;">${al}</div></div></td>
    <td width="50%" style="padding:4px;"><div style="background:#E6F7EE;border-radius:12px;padding:18px 10px;text-align:center;"><div style="font-size:34px;font-weight:800;color:#10B981;">${b}</div><div style="font-size:12px;color:${MUTED};margin-top:2px;">${bl}</div></div></td>
  </tr></table>`;
}

// Icon bullet list (icon left, text right — aligned, self-explanatory)
function iconList(items: [string, string, string][]) {
  const rows = items.map(([icon, title, desc]) => `<tr>
    <td width="46" valign="top" style="padding:7px 0;"><div style="width:36px;height:36px;border-radius:10px;background:#EEF2FF;text-align:center;line-height:36px;font-size:18px;">${icon}</div></td>
    <td valign="top" style="padding:7px 0 7px 12px;"><div style="font-size:14px;font-weight:700;color:${NAVY};">${title}</div>${desc ? `<div style="font-size:12.5px;color:${MUTED};line-height:1.55;margin-top:2px;">${desc}</div>` : ''}</td>
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;">${rows}</table>`;
}

export interface CampaignTemplate {
  key: string;
  track: string;
  name: string;         // internal label in the picker
  temperature: 'hot' | 'cold' | 'any';
  subject: string;      // {{name}} allowed
  build: (name: string) => string;  // returns full HTML
}

// =============================================================================
// THE 13 TEMPLATES
// =============================================================================
export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  // ---- 1. ANXIETY REFRAME ----
  {
    key: 'reframe_risk', track: 'Anxiety Reframe', name: 'The only real risk', temperature: 'any',
    subject: 'With the Global Talent Visa, not applying is the only real risk',
    build: (n) => shell(
      eyebrow('A quiet thought worth challenging') + h1('The only guaranteed way to fail is to not apply') + greet(n) +
      para('Most people who never make it to the UK are not rejected. They simply never apply — held back by a quiet "what if I\'m not good enough?"') +
      para('Here\'s the honest maths of it:') +
      statPair('0%', 'chance if you never apply', '~50%', 'chance with a strong, well-built profile') +
      callout('Not applying isn\'t the safe option. It\'s the only option that guarantees a "no".') +
      para('The UK Global Talent Visa rewards people who present their achievements well — and that\'s exactly what we build with you. A quick, honest profile review tells you where you really stand, with no pressure.') +
      cta('Get an honest profile review'),
      'Not applying is the one choice that guarantees a no.'),
  },
  {
    key: 'reframe_qualified', track: 'Anxiety Reframe', name: 'More qualified than you think', temperature: 'any',
    subject: 'You may be more UK-ready than you think',
    build: (n) => shell(
      eyebrow('You, reconsidered') + h1('You\'re probably more qualified than you think') + greet(n) +
      para('The biggest myth about the UK Global Talent Visa is that it\'s only for famous people or geniuses. It isn\'t. It\'s for people doing strong, real work — who present it the right way.') +
      iconList([
        ['🧑‍💻', 'You don\'t need to be famous', 'Solid experience, projects, or leadership counts.'],
        ['📄', 'You don\'t need a perfect CV', 'We shape and position your evidence for you.'],
        ['⏳', 'You\'re not "too late"', 'People apply at every career stage, every year.'],
      ]) +
      callout('The gap is rarely your profile. It\'s usually just how it\'s presented.', '#FFFBEB', GOLD) +
      para('Let us look at your profile honestly and tell you where you stand — it takes minutes and costs nothing.') +
      cta('Check where I stand'),
      'The UK Global Talent Visa isn\'t only for the famous.'),
  },
  // ---- 2. EDUCATIONAL ----
  {
    key: 'edu_what', track: 'Educational', name: 'What the visa is', temperature: 'cold',
    subject: 'The UK Global Talent Visa, explained simply',
    build: (n) => shell(
      eyebrow('The basics, in plain english') + h1('What the UK Global Talent Visa actually is') + greet(n) +
      para('It\'s one of the UK\'s most flexible routes — for talented people in tech, science, academia, and the arts. No employer, no sponsor, no job offer required.') +
      iconList([
        ['🚫', 'No job offer needed', 'You\'re not tied to any single company.'],
        ['💼', 'Full freedom', 'Work, freelance, consult, or build your own venture.'],
        ['👨‍👩‍👧', 'Family included', 'Spouse and children can join from day one.'],
        ['🇬🇧', 'Settlement pathway', 'A route to ILR and, later, British citizenship.'],
      ]) +
      para('It\'s a two-stage process — endorsement, then the visa itself — and Migrizo manages every step end to end.') +
      cta('See if it fits you'),
      'One of the UK\'s most flexible visa routes, explained.'),
  },
  {
    key: 'edu_qualify', track: 'Educational', name: 'Do you qualify (self-check)', temperature: 'any',
    subject: 'Could you qualify for the UK Global Talent Visa?',
    build: (n) => shell(
      eyebrow('A 2-minute self-check') + h1('Could you qualify? A quick self-check') + greet(n) +
      para('You may be closer than you think. If a few of these sound like you, it\'s worth a conversation:') +
      iconList([
        ['✅', 'You have 3+ years in your field', 'Tech, engineering, research, design, academia, or the arts.'],
        ['✅', 'You have some evidence of impact', 'Projects, roles, awards, publications, or media.'],
        ['✅', 'You can find 2–3 referees', 'Seniors who know and can vouch for your work.'],
        ['✅', 'You want flexibility in the UK', 'To work, freelance, or build — without a sponsor.'],
      ]) +
      callout('Ticked two or more? You likely have a real case worth building.') +
      cta('Get my eligibility checked'),
      'A quick self-check for the UK Global Talent Visa.'),
  },
  {
    key: 'edu_stages', track: 'Educational', name: 'Endorsement vs Visa', temperature: 'cold',
    subject: 'UK Global Talent Visa: the 2 stages explained',
    build: (n) => shell(
      eyebrow('How it actually works') + h1('The two stages, demystified') + greet(n) +
      para('The process is simpler than it looks. It\'s two clean stages:') +
      iconList([
        ['1️⃣', 'Endorsement', 'An approved UK body reviews your evidence and confirms your talent. This is where profile-building matters most — and where we focus.'],
        ['2️⃣', 'Visa application', 'Once endorsed, you apply to UKVI for the visa itself. Straightforward, and we guide the paperwork, IHS and dependants.'],
      ]) +
      para('Most people get stuck at stage one — not because they\'re unqualified, but because their evidence isn\'t mapped to what endorsers look for. That\'s exactly what we fix.') +
      cta('Understand my route'),
      'Endorsement, then visa — the two stages made simple.'),
  },
  // ---- 3. MYTH-BUSTERS ----
  {
    key: 'myth_five', track: 'Myth-busters', name: '5 myths', temperature: 'any',
    subject: 'What most people get wrong about the UK visa',
    build: (n) => shell(
      eyebrow('Myth vs reality') + h1('5 things people get wrong about this UK visa') + greet(n) +
      iconList([
        ['❌', '"I need a job offer"', 'You don\'t. This route needs no employer or sponsor.'],
        ['❌', '"It\'s only for the famous"', 'No. It\'s for strong professionals, presented well.'],
        ['❌', '"I\'m not senior enough"', 'People apply at many career stages, not just the top.'],
        ['❌', '"It takes years"', 'Endorsement decisions are often weeks, not years.'],
        ['❌', '"I can\'t bring my family"', 'Your spouse and children can come with you.'],
      ]) +
      callout('The biggest myth of all: that it\'s out of your reach. Often, it isn\'t.', '#FFFBEB', GOLD) +
      cta('Separate myth from my reality'),
      'The 5 biggest myths about the UK Global Talent Visa.'),
  },
  {
    key: 'myth_nojob', track: 'Myth-busters', name: 'No employer needed', temperature: 'cold',
    subject: 'The UK visa that doesn\'t need an employer',
    build: (n) => shell(
      eyebrow('Freedom, by design') + h1('A UK visa with no employer required') + greet(n) +
      para('Most UK work visas chain you to one sponsoring company. Lose the job, risk the visa. The Global Talent Visa is built differently.') +
      iconList([
        ['🔓', 'No sponsor, no lock-in', 'Your visa belongs to you, not an employer.'],
        ['💼', 'Work however you want', 'Employment, freelance, consulting, or your own company.'],
        ['🔄', 'Switch freely', 'Change roles or clients without touching your status.'],
      ]) +
      para('For founders, freelancers and ambitious professionals, that freedom is the whole point.') +
      cta('See if this route fits me'),
      'A UK visa that isn\'t tied to any employer.'),
  },
  // ---- 4. INSPIRATIONAL ----
  {
    key: 'insp_story', track: 'Inspirational', name: 'Engineer story', temperature: 'any',
    subject: 'How an engineer moved to the UK on this visa',
    build: (n) => shell(
      eyebrow('A path that might feel familiar') + h1('From a desk in India to a life in the UK') + greet(n) +
      para('A software engineer — good career, no fame, no employer waiting in the UK — assumed the Global Talent Visa was out of reach.') +
      para('It wasn\'t. With the right evidence, mapped the right way, the endorsement came through. Today they work freely in the UK, family alongside them, on a clear path to settlement.') +
      callout('The difference wasn\'t a bigger CV. It was presenting the same career the way endorsers recognise.') +
      para('Your story could read the same way. It starts with an honest look at your profile.') +
      cta('Start my UK story'),
      'How an ordinary engineer made the UK move.'),
  },
  {
    key: 'insp_map', track: 'Inspirational', name: '5-year map', temperature: 'cold',
    subject: 'Your UK path: Global Talent Visa to citizenship',
    build: (n) => shell(
      eyebrow('The long view') + h1('Your 5-year map: visa → ILR → citizenship') + greet(n) +
      para('The Global Talent Visa isn\'t just entry — it\'s the first step of a settled UK future.') +
      iconList([
        ['🛫', 'Year 0 — Arrive', 'Enter the UK with full work freedom, family included.'],
        ['🏡', 'Year 3 — ILR eligible', 'A fast track to Indefinite Leave to Remain.'],
        ['🇬🇧', 'Year 5–6 — Citizenship', 'Eligible to apply for British citizenship.'],
      ]) +
      para('A single decision now sets that whole path in motion.') +
      cta('Map my UK journey'),
      'Visa to ILR to citizenship — your UK map.'),
  },
  // ---- 5. CURIOSITY / FOMO ----
  {
    key: 'fomo_profiles', track: 'Curiosity', name: 'Profiles getting endorsed', temperature: 'any',
    subject: 'The kind of profile the UK is looking for',
    build: (n) => shell(
      eyebrow('Quietly getting approved') + h1('The profiles the UK is quietly endorsing') + greet(n) +
      para('You might be surprised who\'s getting through — not celebrities, but people who look a lot like you:') +
      iconList([
        ['💻', 'Software & AI engineers', 'Strong project and delivery track records.'],
        ['🔬', 'Researchers & academics', 'Publications, teaching, or lab work.'],
        ['🚀', 'Founders & product leaders', 'Traction, growth, or a built product.'],
        ['🎨', 'Designers & creatives', 'A portfolio that shows real impact.'],
      ]) +
      callout('If your work sits in any of these, a real case may already be within reach.') +
      cta('See if my profile fits'),
      'The kinds of profiles the UK is endorsing now.'),
  },
  {
    key: 'fomo_timing', track: 'Curiosity', name: 'Is now the time', temperature: 'hot',
    subject: 'Is now the right time for your UK move?',
    build: (n) => shell(
      eyebrow('A fair question') + h1('Is now the right time for your UK move?') + greet(n) +
      para('There\'s rarely a "perfect" moment — but waiting has a real, quiet cost:') +
      iconList([
        ['⏳', 'Time you don\'t get back', 'Every year you wait is a year off your settlement clock.'],
        ['📈', 'Careers that keep moving', 'The UK market rewards those who arrive sooner.'],
        ['🧭', 'Clarity beats guessing', 'A quick review replaces months of wondering.'],
      ]) +
      callout('You don\'t have to commit today. You just have to find out where you stand.') +
      cta('Find out where I stand'),
      'The quiet cost of waiting on your UK plans.'),
  },
  // ---- 6. NURTURE / CTA ----
  {
    key: 'cta_start', track: 'Nurture', name: 'What changes when you start', temperature: 'hot',
    subject: 'What changes once your UK application starts',
    build: (n) => shell(
      eyebrow('From thinking to moving') + h1('What changes the day you start') + greet(n) +
      para('The hardest part of the UK Global Talent Visa isn\'t the process. It\'s the leap from "someday" to "started". Here\'s what shifts the moment you do:') +
      iconList([
        ['🗺️', 'A clear roadmap', 'You know exactly what to do next — no more guessing.'],
        ['📄', 'Your evidence, handled', 'We build and position your profile with you.'],
        ['🤝', 'A team in your corner', 'One point of contact, all the way to landing.'],
      ]) +
      para('It begins with one honest, no-pressure conversation.') +
      cta('Start the conversation'),
      'What shifts the day you begin your UK application.'),
  },
  {
    key: 'cta_review', track: 'Nurture', name: 'Free profile review', temperature: 'any',
    subject: 'A profile review for your UK Global Talent Visa',
    build: (n) => shell(
      eyebrow('No pressure, just clarity') + h1('A profile review, reserved for you') + greet(n) +
      para('If you\'ve been curious about the UK Global Talent Visa but unsure whether you\'d qualify, this is the simplest next step.') +
      iconList([
        ['🔍', 'An honest assessment', 'We tell you plainly if you have a real case.'],
        ['🗺️', 'A clear next step', 'Whether it\'s a yes, a not-yet, or a no.'],
        ['🕒', 'A few minutes of your time', 'No commitment, no obligation.'],
      ]) +
      para('Reply to this email, or message us on WhatsApp — whichever is easier.') +
      cta('Book my profile review'),
      'A no-pressure review of your UK Global Talent Visa case.'),
  },
];

export const TEMPLATE_BY_KEY: Record<string, CampaignTemplate> =
  Object.fromEntries(CAMPAIGN_TEMPLATES.map((t) => [t.key, t]));
