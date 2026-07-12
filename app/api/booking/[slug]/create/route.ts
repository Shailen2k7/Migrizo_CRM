// PUBLIC: create a booking — validates the slot, queues the full reminder
// schedule, sends instant confirmation, notifies the team member (push),
// links to an existing lead by email/phone, and logs the activity timeline.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { computeSlots, type WorkingHours } from '@/lib/scheduler/slots';
import { renderMeetingEmail, type ReminderKind } from '@/lib/email/meeting-emails';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REMINDER_OFFSETS: { kind: ReminderKind; minutes: number }[] = [
  { kind: 'h24', minutes: -24 * 60 },
  { kind: 'h3', minutes: -3 * 60 },
  { kind: 'h1', minutes: -60 },
  { kind: 'm15', minutes: -15 },
  { kind: 'start', minutes: 0 },
  { kind: 'followup', minutes: 10 },
];

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: { startsAt?: string; name?: string; email?: string; phone?: string; tz?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 }); }
  const name = (body.name || '').trim(), email = (body.email || '').trim().toLowerCase();
  if (!name || !email.includes('@') || !body.startsAt) return NextResponse.json({ ok: false, reason: 'missing_fields' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: member } = await admin.from('scheduler_members')
    .select('*').eq('slug', slug).maybeSingle();
  if (!member || !member.active) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  // Re-validate the chosen slot is genuinely free (race-safe enough for Phase 1).
  const starts = new Date(body.startsAt);
  const ends = new Date(starts.getTime() + member.slot_minutes * 60000);
  const { data: busyRows } = await admin.from('meetings')
    .select('starts_at, ends_at').eq('member_id', member.id).eq('status', 'upcoming')
    .gte('starts_at', new Date(starts.getTime() - 24 * 3600 * 1000).toISOString())
    .lte('starts_at', new Date(starts.getTime() + 24 * 3600 * 1000).toISOString());
  const valid = computeSlots({
    tz: member.timezone, workingHours: member.working_hours as WorkingHours,
    slotMinutes: member.slot_minutes, bufferMinutes: member.buffer_minutes,
    fromUtc: new Date(starts.getTime() - 1), toUtc: new Date(starts.getTime() + 1 + member.slot_minutes * 60000),
    busy: (busyRows || []).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
  }).some((s) => s.getTime() === starts.getTime());
  if (!valid) return NextResponse.json({ ok: false, reason: 'slot_taken' }, { status: 409 });

  // Auto-link to an existing lead by email or phone.
  let leadId: string | null = null;
  const { data: byEmail } = await admin.from('leads').select('id').eq('workspace_id', member.workspace_id).ilike('email', email).limit(1);
  if (byEmail && byEmail.length) leadId = byEmail[0].id;
  if (!leadId && body.phone) {
    const { data: byPhone } = await admin.from('leads').select('id').eq('workspace_id', member.workspace_id).eq('phone', body.phone.trim()).limit(1);
    if (byPhone && byPhone.length) leadId = byPhone[0].id;
  }

  const token = randomBytes(18).toString('hex');
  const { data: meeting, error } = await admin.from('meetings').insert({
    workspace_id: member.workspace_id, member_id: member.id, lead_id: leadId,
    client_name: name, client_email: email, client_phone: body.phone || null,
    client_tz: body.tz || member.timezone,
    starts_at: starts.toISOString(), ends_at: ends.toISOString(),
    status: 'upcoming', notes: body.note || null,
    meet_link: member.meeting_link || null, manage_token: token,
  }).select('id').single();
  if (error || !meeting) return NextResponse.json({ ok: false, reason: error?.message }, { status: 500 });

  // Queue the reminder schedule (skip offsets already in the past).
  const now = Date.now();
  const rows = REMINDER_OFFSETS
    .map((o) => ({ meeting_id: meeting.id, workspace_id: member.workspace_id, kind: o.kind, send_at: new Date(starts.getTime() + o.minutes * 60000).toISOString() }))
    .filter((r) => new Date(r.send_at).getTime() > now - 60000);
  if (rows.length) await admin.from('meeting_reminders').insert(rows);

  await admin.from('meeting_activity').insert({
    meeting_id: meeting.id, workspace_id: member.workspace_id,
    event: 'booked', meta: { name, email, starts_at: starts.toISOString(), lead_id: leadId },
  });

  // Instant confirmation email (logged as a reminder row for delivery status).
  try {
    const apiKey = process.env.RESEND_API_KEY, from = process.env.NOTIFY_FROM;
    if (apiKey && from) {
      const mail = renderMeetingEmail({
        kind: 'confirm', clientName: name, memberName: member.display_name, title: member.title || 'Consultation',
        startsAt: starts, endsAt: ends, clientTz: body.tz || member.timezone,
        meetLink: member.meeting_link || null, manageToken: token,
      });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, reply_to: process.env.REPLY_TO || 'info@migrizo.com', to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      await admin.from('meeting_reminders').insert({
        meeting_id: meeting.id, workspace_id: member.workspace_id, kind: 'confirm',
        send_at: new Date().toISOString(), status: res.ok ? 'sent' : 'failed', attempts: 1,
        sent_at: res.ok ? new Date().toISOString() : null, error: res.ok ? null : `resend ${res.status}`,
      });
    }
  } catch { /* confirmation failure never blocks the booking */ }

  // Push-notify the team member on their devices.
  try {
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@migrizo.com', pub, priv);
      const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', member.user_id);
      const whenLocal = new Intl.DateTimeFormat('en-GB', { timeZone: member.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(starts);
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: '📅 New meeting booked', body: `${name} · ${whenLocal}`, url: '/meetings' })
          );
        } catch { /* stale subscription */ }
      }
    }
  } catch { /* non-blocking */ }

  return NextResponse.json({ ok: true, token, meetLink: member.meeting_link || null });
}
