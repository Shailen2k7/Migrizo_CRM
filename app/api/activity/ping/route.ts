// ============================================================================
// ACTIVITY PING — POST /api/activity/ping
// Records one 30-second slice of activity for the signed-in user.
// Deliberately minimal: validate, insert, return. No heavy work on this path,
// because it runs every 30 seconds for every active user.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_SECTIONS = new Set([
  'dashboard', 'leads', 'pipeline', 'cases', 'payments', 'meetings',
  'learning', 'team-activity', 'settings', 'ai', 'daily-tracker', 'follow-ups', 'campaigns', 'blog-admin', 'other',
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { workspaceId?: string; section?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ ok: false }, { status: 400 });

  const section = ALLOWED_SECTIONS.has((body.section || '').toLowerCase())
    ? (body.section as string).toLowerCase()
    : 'other';

  // RLS also enforces this, but failing fast keeps the hot path cheap.
  const { error } = await supabase.from('activity_pings').insert({
    workspace_id: body.workspaceId,
    user_id: user.id,
    section,
  });

  if (error) return NextResponse.json({ ok: false }, { status: 200 }); // never surface noise to the client
  return NextResponse.json({ ok: true });
}
