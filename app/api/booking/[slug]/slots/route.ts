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
    .select('id, display_name, title, bio, timezone, slot_minutes, slot_step_minutes, buffer_minutes, working_hours, active')
    .eq('slug', slug).maybeSingle();
  if (!member || !member.active) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  const u = new URL(req.url);
  const from = new Date(u.searchParams.get('from') || Date.now());
  const days = Math.min(31, Math.max(1, Number(u.searchParams.get('days') || 7)));
  const to = new Date(from.getTime() + days * 24 * 3600 * 1000);

  const { data: busyRows } = await admin.from('meetings')
    .select('starts_at, ends_at').eq('member_id', member.id).eq('status', 'upcoming')
    .gte('starts_at', new Date(from.getTime() - 24 * 3600 * 1000).toISOString())
    .lte('starts_at', new Date(to.getTime() + 24 * 3600 * 1000).toISOString());

  const slots = computeSlots({
    tz: member.timezone, workingHours: member.working_hours as WorkingHours,
    slotMinutes: member.slot_minutes, stepMinutes: member.slot_step_minutes ?? 30,
    bufferMinutes: member.buffer_minutes,
    fromUtc: from, toUtc: to,
    busy: (busyRows || []).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
  });

  return NextResponse.json({
    ok: true,
    member: { name: member.display_name, title: member.title, bio: member.bio, slotMinutes: member.slot_minutes, timezone: member.timezone },
    slots: slots.map((s) => s.toISOString()),
  });
}
