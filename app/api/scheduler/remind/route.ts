// CRON: drain due meeting reminders — throttled, retried, fully logged.
// - Skips reminders whose meeting is no longer 'upcoming'
// - 'followup' only sends if the meeting is STILL 'upcoming' 10 minutes in
//   (mark the meeting Completed in the CRM to suppress it)
// - Failed sends retry up to 3 times on subsequent cron runs
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMeetingEmail, type ReminderKind } from '@/lib/email/meeting-emails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 30;
const MAX_ATTEMPTS = 3;

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) return NextResponse.json({ ok: false }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY, from = process.env.NOTIFY_FROM;
  if (!url || !key || !apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: due } = await admin.from('meeting_reminders')
    .select('id, meeting_id, workspace_id, kind, attempts')
    .eq('status', 'queued').lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true }).limit(BATCH);
  if (!due || due.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const meetingIds = Array.from(new Set(due.map((r) => r.meeting_id)));
  const { data: meetings } = await admin.from('meetings').select('*').in('id', meetingIds);
  const meetingById = new Map((meetings || []).map((m) => [m.id, m]));
  const memberIds = Array.from(new Set((meetings || []).map((m) => m.member_id)));
  const { data: members } = await admin.from('scheduler_members').select('*').in('id', memberIds);
  const memberById = new Map((members || []).map((m) => [m.id, m]));

  let sent = 0, failed = 0, skipped = 0;
  for (const r of due) {
    const m = meetingById.get(r.meeting_id);
    const member = m ? memberById.get(m.member_id) : null;
    if (!m || !member || m.status !== 'upcoming') {
      await admin.from('meeting_reminders').update({ status: 'skipped' }).eq('id', r.id);
      skipped++; continue;
    }
    try {
      const mail = renderMeetingEmail({
        kind: r.kind as ReminderKind, clientName: m.client_name, memberName: member.display_name,
        title: member.title || 'Consultation', startsAt: new Date(m.starts_at), endsAt: new Date(m.ends_at),
        clientTz: m.client_tz || member.timezone, meetLink: m.meet_link, manageToken: m.manage_token,
      });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, reply_to: process.env.REPLY_TO || 'info@migrizo.com', to: [m.client_email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
      await admin.from('meeting_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq('id', r.id);
      await admin.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: r.workspace_id, event: 'reminder_sent', meta: { kind: r.kind } });
      sent++;
    } catch (e) {
      const attempts = r.attempts + 1;
      await admin.from('meeting_reminders').update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        attempts, error: (e as Error).message,
      }).eq('id', r.id);
      if (attempts >= MAX_ATTEMPTS) {
        await admin.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: r.workspace_id, event: 'email_failed', meta: { kind: r.kind, error: (e as Error).message } });
      }
      failed++;
    }
  }
  return NextResponse.json({ ok: true, sent, failed, skipped });
}
