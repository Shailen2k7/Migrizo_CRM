// =============================================================================
// PUSH SUBSCRIBE — saves this device's push subscription for the signed-in user
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try { sub = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ ok: false, reason: 'bad_subscription' }, { status: 400 });
  }

  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ ok: false }, { status: 403 });

  // Upsert on endpoint: re-enabling on the same device just refreshes the row.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      workspace_id: member.workspace_id,
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: 'endpoint' }
  );
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
