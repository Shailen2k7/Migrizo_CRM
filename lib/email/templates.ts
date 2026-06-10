// =============================================================================
// CLIENT EMAIL TEMPLATES — pure, route-aware, zero server deps.
// Content is generated from lib/journey.ts so GTV and IFV read correctly with
// no duplicated copy. Used by app/api/notify-client/route.ts.
// =============================================================================
import {
  getJourney, getPhase, normalizeJourney, phasesCleared, allGatesPassed,
  normalizeVisaType, getRouteMeta, MACRO_STAGES,
  type Decision,
} from '@/lib/journey';

export type NotifyEvent = 'phase_advanced' | 'decision' | 'custom';

// The subset of a case this builder needs.
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

function firstName(full: string): string {
  return (full || 'there').trim().split(/\s+/)[0] || 'there';
}

// ---- shared layout -----------------------------------------------------------
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

// ---- main builder ------------------------------------------------------------
export function buildClientEmail(c: NotifyCase, event: NotifyEvent, note?: string | null): BuiltEmail {
  const visa = normalizeVisaType(c.visa_type);
  const route = getRouteMeta(visa);
  const journey = getJourney(visa);
  const state = normalizeJourney(c.journey);
  const phase = getPhase(c.current_phase as never, journey);
  const macroIdx = Math.max(0, MACRO_STAGES.findIndex((m) => m.key === phase.macro)) + 1;
  const cleared = phasesCleared(state, journey);
  const done = allGatesPassed(state, journey);

  const stageLabel = done ? 'Decision & landing' : phase.clientName;
  const stageSub = done
    ? 'Your journey with us is complete.'
    : `Stage ${macroIdx} of ${MACRO_STAGES.length} · ${cleared} of ${journey.length} steps cleared`;
  const box = statusBox(stageLabel, stageSub);
  const hi = `<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0 0 14px;">Hi ${esc(firstName(c.client_name))},</p>`;

  let heading = `An update on your ${route.label} application`;
  let bodyHtml = '';
  let textCore = '';

  if (event === 'phase_advanced') {
    heading = `Your case has moved to: ${stageLabel}`;
    bodyHtml = `${hi}
      <p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">Good news — there's been movement on your application. We've just advanced your case, and you're now at <strong>${esc(stageLabel)}</strong>.</p>
      <p style="font-size:13.5px;color:#3c3f46;line-height:1.6;margin:12px 0 0;">${esc(phase.clientBlurb)}</p>`;
    textCore = `Good news — your case has moved to: ${stageLabel}. ${phase.clientBlurb}`;
  } else if (event === 'decision') {
    const d = c.decision;
    if (d === 'approved') {
      heading = `Congratulations — you've been endorsed! 🎉`;
      bodyHtml = `${hi}<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">This is a huge milestone — your endorsement has come through. We'll now move into the visa application stage and guide you through every step.</p>`;
      textCore = `Congratulations — your endorsement has come through. We now move into the visa stage.`;
    } else if (d === 'rejected') {
      heading = `An update on your endorsement`;
      bodyHtml = `${hi}<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">We've received a decision on your endorsement, and unfortunately it wasn't successful this time. This isn't the end of the road — your case manager will reach out shortly to talk through your options and the strongest path forward.</p>`;
      textCore = `We've received your endorsement decision and it wasn't successful this time. Your case manager will be in touch about next steps.`;
    } else if (d === 'resubmission') {
      heading = `Next steps on your endorsement`;
      bodyHtml = `${hi}<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">The endorsing body has asked for a resubmission. That's a normal part of the process — we'll strengthen the areas raised and your case manager will walk you through what we need.</p>`;
      textCore = `The endorsing body has asked for a resubmission. We'll strengthen the application and guide you through it.`;
    } else {
      heading = `An update on your endorsement`;
      bodyHtml = `${hi}<p style="font-size:14.5px;color:#0f1115;line-height:1.6;margin:0;">There's an update on your endorsement. See where things stand below.</p>`;
      textCore = `There's an update on your endorsement.`;
    }
  } else {
    // custom note from the case manager
    heading = `A note about your ${route.short} application`;
    const safeNote = esc(note || '').replace(/\n/g, '<br/>');
    bodyHtml = `${hi}<div style="font-size:14.5px;color:#0f1115;line-height:1.65;margin:0;">${safeNote}</div>`;
    textCore = note || '';
  }

  const html = shell({ heading, bodyHtml, statusHtml: box.html, ownerName: c.owner_name });
  const text = [`Hi ${firstName(c.client_name)},`, '', textCore, '', box.text, '', '— The Migrizo Team']
    .join('\n');

  return { subject: heading.replace(/[🎉]/g, '').trim(), html, text };
}
