// =============================================================================
// MEETING EMAILS — branded confirmation, reminders, and follow-up.
// Every email carries: meeting details, the meeting link, one-click
// Reschedule + Cancel (tokenized), and Add-to-Google-Calendar.
// =============================================================================
import { googleCalendarUrl } from '@/lib/scheduler/slots';

const NAVY = '#16294E';
const BLUE = '#3E56D4';
const GOLD = '#F4C430';
const INK = '#2B3450';
const MUTED = '#6B7280';
const LOGO = 'https://crm.migrizo.com/migrizo-email-logo.png';
const SITE = 'https://crm.migrizo.com';

export type ReminderKind = 'confirm' | 'h24' | 'h3' | 'h1' | 'm15' | 'start' | 'followup';

export interface MeetingEmailInput {
  kind: ReminderKind;
  clientName: string;
  memberName: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  clientTz: string;      // shown in the client's own timezone
  meetLink: string | null;
  manageToken: string;
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function fmtWhen(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

const COPY: Record<ReminderKind, { subject: (s: string) => string; headline: string; line: string }> = {
  confirm:  { subject: (s) => `Confirmed: your Migrizo consultation — ${s}`, headline: 'Your meeting is confirmed', line: 'Thank you for booking. Here are your meeting details — we look forward to speaking with you.' },
  h24:      { subject: (s) => `Tomorrow: your Migrizo consultation — ${s}`, headline: 'Your meeting is tomorrow', line: 'A friendly reminder that your consultation is coming up tomorrow.' },
  h3:       { subject: (s) => `In 3 hours: your Migrizo consultation`, headline: 'Your meeting is in 3 hours', line: 'Your consultation starts in about 3 hours. The joining link is below.' },
  h1:       { subject: (s) => `In 1 hour: your Migrizo consultation`, headline: 'Your meeting is in 1 hour', line: 'Just one hour to go. Keep the joining link handy.' },
  m15:      { subject: (s) => `Starting soon: your Migrizo consultation`, headline: 'Starting in 15 minutes', line: 'Your consultation begins in 15 minutes. Click below when you\'re ready to join.' },
  start:    { subject: (s) => `We\'re live: join your Migrizo consultation`, headline: 'Your meeting is starting now', line: 'We\'re ready for you — join with the button below.' },
  followup: { subject: (s) => `We missed you — shall we reschedule?`, headline: 'We couldn\'t see you in the meeting', line: 'It looks like you weren\'t able to join. No problem at all — you can pick a new time in one click below, and we\'ll be happy to speak then.' },
};

export function renderMeetingEmail(m: MeetingEmailInput): { subject: string; html: string; text: string } {
  const c = COPY[m.kind];
  const when = fmtWhen(m.startsAt, m.clientTz || 'Asia/Kolkata');
  const dateShort = new Intl.DateTimeFormat('en-GB', { timeZone: m.clientTz || 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(m.startsAt);
  const mins = Math.round((m.endsAt.getTime() - m.startsAt.getTime()) / 60000);
  const manage = `${SITE}/book/manage/${m.manageToken}`;
  const gcal = googleCalendarUrl({
    title: `${m.title} — Migrizo`, start: m.startsAt, end: m.endsAt,
    details: `Consultation with ${m.memberName} (Migrizo).${m.meetLink ? ` Join: ${m.meetLink}` : ''}`,
    location: m.meetLink || 'Online',
  });

  const joinBtn = m.meetLink ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:340px;">
          <tr><td align="center" bgcolor="${GOLD}" style="border-radius:12px;">
            <a href="${m.meetLink}" target="_blank" style="display:block;padding:16px 20px;font-size:15px;font-weight:800;color:${NAVY};border-radius:12px;text-decoration:none;">&#128249;&nbsp; Join the Meeting</a>
          </td></tr>
        </table>
      </td></tr></table>` : '';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#EEF1F8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.line)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F8;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 6px 26px rgba(22,41,78,0.10);border-radius:16px;overflow:hidden;">
      <tr><td style="background:#ffffff;padding:26px 34px 0;" align="left">
        <img src="${LOGO}" alt="Migrizo" width="176" style="display:block;max-width:176px;height:auto;"/>
      </td></tr>
      <tr><td style="background:#ffffff;padding:14px 34px 0;"><div style="height:3px;width:100%;background:linear-gradient(90deg,${GOLD} 0%,${BLUE} 55%,${NAVY} 100%);border-radius:3px;"></div></td></tr>
      <tr><td style="background:#ffffff;padding:28px 34px 34px;">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:${NAVY};font-weight:800;">${c.headline}</h1>
        <p style="margin:0 0 18px;font-size:14.5px;line-height:1.75;color:${INK};">Dear ${esc(m.clientName)},<br/>${c.line}</p>

        <!-- Meeting details card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;"><tr>
          <td style="background:#F5F7FC;border:1px solid #E1E6F2;border-radius:14px;padding:20px 22px;">
            <div style="font-size:11px;font-weight:800;letter-spacing:1.3px;color:${BLUE};text-transform:uppercase;margin-bottom:10px;">Meeting details</div>
            <div style="font-size:16px;font-weight:800;color:${NAVY};margin-bottom:6px;">${esc(m.title)}</div>
            <div style="font-size:13.5px;color:${INK};line-height:1.9;">
              &#128197;&nbsp; <b>${when}</b><br/>
              &#9200;&nbsp; ${mins} minutes<br/>
              &#129333;&nbsp; With <b>${esc(m.memberName)}</b>, Migrizo${m.meetLink ? `<br/>&#128279;&nbsp; <a href="${m.meetLink}" style="color:${BLUE};">${m.meetLink}</a>` : ''}
            </div>
          </td>
        </tr></table>
        ${joinBtn}

        <!-- Action row: calendar / reschedule / cancel -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr><td align="center">
          <a href="${gcal}" target="_blank" style="display:inline-block;margin:4px 6px;padding:11px 16px;font-size:12.5px;font-weight:700;color:${BLUE};border:1.5px solid #C7D0F0;border-radius:9px;text-decoration:none;">&#128197;&nbsp;Add to Google Calendar</a>
          <a href="${manage}" target="_blank" style="display:inline-block;margin:4px 6px;padding:11px 16px;font-size:12.5px;font-weight:700;color:${INK};border:1.5px solid #D9DFF0;border-radius:9px;text-decoration:none;">&#128260;&nbsp;Reschedule</a>
          <a href="${manage}?intent=cancel" target="_blank" style="display:inline-block;margin:4px 6px;padding:11px 16px;font-size:12.5px;font-weight:700;color:#B91C1C;border:1.5px solid #F2C6C6;border-radius:9px;text-decoration:none;">&#10060;&nbsp;Cancel</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="background:${NAVY};padding:22px 34px;" align="left">
        <div style="font-size:14px;font-weight:800;color:#ffffff;">Migrizo</div>
        <div style="font-size:11.5px;color:#C7D0E4;margin-top:5px;line-height:1.7;">Smart. Fast. Reliable Visas &middot; <a href="https://www.migrizo.com" style="color:${GOLD};text-decoration:none;">www.migrizo.com</a> &middot; <a href="mailto:info@migrizo.com" style="color:${GOLD};text-decoration:none;">info@migrizo.com</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = `${c.headline}

Dear ${m.clientName},
${c.line}

${m.title}
When: ${when} (${mins} minutes)
With: ${m.memberName}, Migrizo
${m.meetLink ? `Join: ${m.meetLink}\n` : ''}Add to Google Calendar: ${gcal}
Reschedule: ${manage}
Cancel: ${manage}?intent=cancel

Migrizo · www.migrizo.com · info@migrizo.com`;

  return { subject: c.subject(dateShort), html, text };
}
