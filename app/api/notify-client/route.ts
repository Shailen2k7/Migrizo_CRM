import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildClientEmail, type NotifyEvent, type NotifyCase } from '@/lib/email/templates';

export const runtime = 'nodejs';

const VALID_EVENTS: NotifyEvent[] = ['phase_advanced', 'decision', 'custom'];

export async function POST(req: Request) {
  // 1) Must be a signed-in CRM user. RLS then scopes which cases they can read.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  // 2) Parse + validate input.
  let body: { caseId?: string; event?: string; note?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 }); }
  const caseId = body.caseId;
  const event = body.event as NotifyEvent;
  const note = body.note ?? null;
  if (!caseId || !VALID_EVENTS.includes(event)) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }

  // 3) Load the case (RLS ensures the user can only reach their own workspace's cases).
  const { data: c, error } = await supabase
    .from('cases')
    .select('client_name, client_email, visa_type, current_phase, decision, journey, owner_name')
    .eq('id', caseId)
    .single();
  if (error || !c) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  if (!c.client_email) return NextResponse.json({ ok: false, reason: 'no_email' });

  // 4) Resend must be configured.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM; // e.g. "Migrizo <updates@migrizo.com>"
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' });

  // 5) Build the route-aware email and send via the Resend REST API (no SDK needed).
  const email = buildClientEmail(c as NotifyCase, event, note);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [c.client_email],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, reason: 'send_failed', detail }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 });
  }

  // 6) Best-effort activity log (never blocks the response).
  try {
    await supabase.rpc('log_case_activity', {
      p_case_id: caseId,
      p_action: 'client_notified',
      p_meta: { event },
    });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true });
}
