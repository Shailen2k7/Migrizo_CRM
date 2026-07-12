// PUBLIC (token-secured): fetch, reschedule, or cancel a meeting.
// The token comes from the confirmation/reminder emails — one click.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeSlots, type WorkingHours } from '@/lib/scheduler/slots';
import { renderMeetingEmail } from '@/lib/email/meeting-emails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadByToken(db: NonNullable<ReturnType<typeof admin>>, token: string) {
  const { data: m } = await db.from('meetings').select('*').eq('manage_token', token).maybeSingle();
  if (!m) return null;
  const { data: member } = await db.from('scheduler_members').select('*').eq('id', m.member_id).single();
  return { m, member };
}

export async function GET(req: Request) {
  const db = admin(); if (!db) return NextResponse.json({ ok: false }, { status: 500 });
  const token = new URL(req.url).searchParams.get('token') || '';
  const loaded = await loadByToken(db, token);
  if (!loaded) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  const { m, member } = loaded;
  return NextResponse.json({
    ok: true,
    meeting: {
      title: member.title, memberName: member.display_name, slug: member.slug,
      startsAt: m.starts_at, endsAt: m.ends_at, status: m.status,
      clientName: m.client_name, clientTz: m.client_tz, meetLink: m.meet_link,
    },
  });
}

export async function POST(req: Request) {
  const db = admin(); if (!db) return NextResponse.json({ ok: false }, { status: 500 });
  let body: { token?: string; action?: 'cancel' | 'reschedule'; newStartsAt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 }); }
  const loaded = await loadByToken(db, body.token || '');
  if (!loaded) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  const { m, member } = loaded;
  if (m.status !== 'upcoming') return NextResponse.json({ ok: false, reason: 'not_upcoming' }, { status: 400 });

  if (body.action === 'cancel') {
    await db.from('meetings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', m.id);
    await db.from('meeting_reminders').update({ status: 'skipped' }).eq('meeting_id', m.id).eq('status', 'queued');
    await db.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: m.workspace_id, event: 'cancelled', meta: { by: 'client' } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reschedule' && body.newStartsAt) {
    const starts = new Date(body.newStartsAt);
    const ends = new Date(starts.getTime() + member.slot_minutes * 60000);
    // validate new slot (excluding this meeting itself from busy)
    const { data: busyRows } = await db.from('meetings')
      .select('id, starts_at, ends_at').eq('member_id', member.id).eq('status', 'upcoming').neq('id', m.id)
      .gte('starts_at', new Date(starts.getTime() - 24 * 3600 * 1000).toISOString())
      .lte('starts_at', new Date(starts.getTime() + 24 * 3600 * 1000).toISOString());
    const valid = computeSlots({
      tz: member.timezone, workingHours: member.working_hours as WorkingHours,
      slotMinutes: member.slot_minutes, bufferMinutes: member.buffer_minutes,
      fromUtc: new Date(starts.getTime() - 1), toUtc: new Date(starts.getTime() + 1 + member.slot_minutes * 60000),
      busy: (busyRows || []).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
    }).some((s) => s.getTime() === starts.getTime());
    if (!valid) return NextResponse.json({ ok: false, reason: 'slot_taken' }, { status: 409 });

    await db.from('meetings').update({ starts_at: starts.toISOString(), ends_at: ends.toISOString(), updated_at: new Date().toISOString() }).eq('id', m.id);
    // re-queue reminders for the new time
    await db.from('meeting_reminders').update({ status: 'skipped' }).eq('meeting_id', m.id).eq('status', 'queued');
    const OFF: { kind: 'h24' | 'h3' | 'h1' | 'm15' | 'start' | 'followup'; minutes: number }[] = [
      { kind: 'h24', minutes: -1440 }, { kind: 'h3', minutes: -180 }, { kind: 'h1', minutes: -60 },
      { kind: 'm15', minutes: -15 }, { kind: 'start', minutes: 0 }, { kind: 'followup', minutes: 10 },
    ];
    const now = Date.now();
    const rows = OFF.map((o) => ({ meeting_id: m.id, workspace_id: m.workspace_id, kind: o.kind, send_at: new Date(starts.getTime() + o.minutes * 60000).toISOString() }))
      .filter((r) => new Date(r.send_at).getTime() > now - 60000);
    if (rows.length) await db.from('meeting_reminders').insert(rows);
    await db.from('meeting_activity').insert({ meeting_id: m.id, workspace_id: m.workspace_id, event: 'rescheduled', meta: { by: 'client', to: starts.toISOString() } });

    // send a fresh confirmation for the new time
    try {
      const apiKey = process.env.RESEND_API_KEY, from = process.env.NOTIFY_FROM;
      if (apiKey && from) {
        const mail = renderMeetingEmail({
          kind: 'confirm', clientName: m.client_name, memberName: member.display_name, title: member.title || 'Consultation',
          startsAt: starts, endsAt: ends, clientTz: m.client_tz || member.timezone,
          meetLink: m.meet_link, manageToken: m.manage_token,
        });
        await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, reply_to: process.env.REPLY_TO || 'info@migrizo.com', to: [m.client_email], subject: mail.subject, html: mail.html, text: mail.text }),
        });
      }
    } catch { /* non-blocking */ }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, reason: 'bad_action' }, { status: 400 });
}
