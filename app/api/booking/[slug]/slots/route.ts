// PUBLIC: available slots for a member's booking page.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeSlots, type WorkingHours } from '@/lib/scheduler/slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: member } = await admin.from('scheduler_members')
    .select('id, workspace_id, display_name, title, bio, timezone, slot_minutes, slot_step_minutes, buffer_minutes, working_hours, active, min_notice_minutes, max_days_ahead, daily_meeting_cap, paused_message')
    .eq('slug', slug).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!member.active) {
    // Paused on purpose. Say so in the founder's own words rather than 404ing —
    // the person clicked a link we sent them.
    return NextResponse.json({
      ok: true, paused: true,
      member: { name: member.display_name, title: member.title, bio: member.bio, timezone: member.timezone },
      message: member.paused_message || 'Bookings are paused right now. Please check back shortly.',
      slots: [],
    });
  }

  // How far ahead the page will offer anything is a setting now, not a constant.
  const horizonDays = Math.min(180, Math.max(1, member.max_days_ahead ?? 30));
  const u = new URL(req.url);
  const from = new Date(u.searchParams.get('from') || Date.now());
  const days = Math.min(horizonDays, Math.max(1, Number(u.searchParams.get('days') || 7)));
  const horizonEnd = new Date(Date.now() + horizonDays * 24 * 3600 * 1000);
  const rawTo = new Date(from.getTime() + days * 24 * 3600 * 1000);
  const to = rawTo > horizonEnd ? horizonEnd : rawTo;

  const { data: busyRows } = await admin.from('meetings')
    .select('starts_at, ends_at').eq('member_id', member.id).eq('status', 'upcoming')
    .gte('starts_at', new Date(from.getTime() - 24 * 3600 * 1000).toISOString())
    .lte('starts_at', new Date(to.getTime() + 24 * 3600 * 1000).toISOString());

  // One-off exceptions: a blocked holiday, or different hours for one date.
  // Keyed by the member's own local date, which is how they were entered.
  const { data: ovRows } = await admin.from('scheduler_date_overrides')
    .select('on_date, windows')
    .eq('member_id', member.id)
    .gte('on_date', new Date(from.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10))
    .lte('on_date', new Date(to.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10));

  const dateOverrides: Record<string, [string, string][]> = {};
  for (const r of ovRows || []) {
    dateOverrides[String(r.on_date).slice(0, 10)] = (r.windows || []) as [string, string][];
  }

  const slots = computeSlots({
    tz: member.timezone, workingHours: member.working_hours as WorkingHours,
    slotMinutes: member.slot_minutes, stepMinutes: member.slot_step_minutes ?? 30,
    bufferMinutes: member.buffer_minutes,
    fromUtc: from, toUtc: to,
    busy: (busyRows || []).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
    minNoticeMinutes: member.min_notice_minutes ?? 60,
    dateOverrides,
    dailyCap: member.daily_meeting_cap ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    member: { name: member.display_name, title: member.title, bio: member.bio, slotMinutes: member.slot_minutes, timezone: member.timezone },
    horizonDays,
    slots: slots.map((s) => s.toISOString()),
  });
}
