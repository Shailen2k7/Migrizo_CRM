// =============================================================================
// CLIENT EMAIL TEMPLATES — pure, content built from lib/journey.ts.
// Used by app/api/notify-client/route.ts. Emails are manual-only ("Send update").
// =============================================================================
import {
  getJourney, getPhase, normalizeJourney, phasesCleared, allGatesPassed, normalizeVisaType,
  type Decision,
} from '@/lib/journey';

export type NotifyEvent = 'phase_advanced' | 'decision' | 'custom';

export interface NotifyCase {
  client_name: string;
  client_email: string | null;
  visa_type: string;
  current_phase: string;
  decision: Decision;
  journey: unknown;
  owner_name?: string | null;
}

export interface BuiltEmail { subject: string; html: string; text: string }

function esc(s: string): string {
  return (s || '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}
function firstName(full: string): string { return (full || 'there').trim().split(/\s+/)[0] || 'there'; }

function shell(opts: { heading: string; bodyHtml: string; statusHtml: string; ownerName?: string | null }): string {
  const { heading, bodyHtml, statusHtml, ownerName } = opts;
  return `
<div style="background:#f5f6f8;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ec;border-radius:14px;overflow:hidden;">
    <div style="background:#4F46E5;padding:18px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.01em;">Migrizo</div>
    </div>
    <div style="padding:24px;color:#0f1115;">
      <h1 style="font-size:19px;font-weight:800;margin:0 0 14px;line-height:1.3;">${esc(heading)}</h1>
      ${bodyHtml}
      ${statusHtml}
      <p style="font-size:13.5px;color:#3c3f46;line-height:1.6;margin:18px 0 0;">
        Questions about anything here? Just reply to this email${ownerName ? ` and ${esc(ownerName)} will get back to you` : ''}.
      </p>
      <p style="font-size:13.5px;color:#3c3f46;line-height:1.6;margin:14px 0 0;">Warm regards,<br/>The Migrizo Team</p>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #eef0f3;color:#9ca3af;font-size:11px;">
      You're receiving this because Migrizo is handling your UK visa application.
    </div>
  </div>
</div>`.trim();
}

function statusBox(label: string, sub: string): { html: string; text: string } {
  return {
    html: `
      <div style="margin:18px 0 0;background:#eef0ff;border:1px solid #dfe2ff;border-radius:10px;padding:14px 16px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#4F46E5;">Where things stand</div>
        <div style="font-size:15px;font-weight:800;color:#0f1115;margin-top:4px;">${esc(label)}</div>
        <div style="font-size:12.5px;color:#6b7280;margin-top:2px;">${esc(sub)}</div>
      </div>`,
    text: `Where things stand: ${label} — ${sub}`,
  };
}

export function buildClientEmail(c: NotifyCase, event: NotifyEvent, note?: string | null): BuiltEmail {
  const journey = getJourney(normalizeVisaType(c.visa_type));
  const state = normalizeJourney(c.journey);
  const phase = getPhase(c.current_phase as never, journey);
  const total = journey.length;
  const done = allGatesPassed(state, journey);
  const cleared = phasesCleared(state, journey);

  // e.g. "UK Global Talent" -> "your UK Global Talent application"
  const visaLabel = (c.visa_type && c.visa_type.trim()) ? c.visa_type.trim() : 'visa';
  const heading = `You got an update for your ${visaLabel} application`;

  const stageLabel = done ? 'Visa approved 🎉' : phase.name;
  const stageSub = done
    ? 'Your journey with us is complete.'
    : `Step ${phase.index} of ${total} · ${cleared} of ${total} steps cleared`;
  const box = statusBox(stageLabel, stageSub);

  const hi = `<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0 0 14px;">Hi ${esc(firstName(c.client_name))},</p>`;

  let bodyHtml: string;
  let textCore: string;
  if (event === 'custom' && note && note.trim()) {
    const safeNote = esc(note).replace(/\n/g, '<br/>');
    bodyHtml = `${hi}<div style="font-size:14.5px;color:#0f1115;line-height:1.65;margin:0;">${safeNote}</div>`;
    textCore = note;
  } else {
    bodyHtml = `${hi}<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">There's an update on your application. Here's where things stand right now.</p>`;
    textCore = "There's an update on your application.";
  }

  const html = shell({ heading, bodyHtml, statusHtml: box.html, ownerName: c.owner_name });
  const text = [`Hi ${firstName(c.client_name)},`, '', textCore, '', box.text, '', '— The Migrizo Team'].join('\n');

  return { subject: heading, html, text };
}
