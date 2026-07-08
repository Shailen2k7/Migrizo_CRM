// =============================================================================
// PUSH DISPATCH — called by Supabase cron every minute (secured by CRON_SECRET).
// Finds follow-ups that are due and pushes a notification to the assigned
// user's devices (or the whole workspace if unassigned). Marks notified_at so
// each follow-up fires exactly once. Also supports ?test=1 for a manual test
// push to the signed-in user's devices.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const runtime = 'nodejs';

function configureWebPush(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@migrizo.com', pub, priv);
  return true;
}

type SubRow = { id: string; user_id: string; workspace_id: string; endpoint: string; p256dh: string; auth: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToSubs(admin: any, subs: SubRow[], payload: object): Promise<number> {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // 404/410 = subscription dead (user cleared site data / uninstalled) — prune it.
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }));
  return sent;
}

export async function POST(req: Request) {
  if (!configureWebPush()) return NextResponse.json({ ok: false, reason: 'vapid_not_configured' }, { status: 500 });

  const url = new URL(req.url);
  const isTest = url.searchParams.get('test') === '1';

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdminClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ---- TEST MODE: signed-in user pushes to their own devices -----------------
  if (isTest) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', user.id);
    if (!subs || subs.length === 0) return NextResponse.json({ ok: false, reason: 'no_subscriptions' });
    const sent = await sendToSubs(admin, subs as SubRow[], {
      title: '🔔 Migrizo test notification',
      body: 'Push notifications are working on this device.',
      url: '/daily-tracker',
      tag: 'migrizo-test',
    });
    return NextResponse.json({ ok: true, sent });
  }

  // ---- CRON MODE: secured by shared secret -----------------------------------
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Due window: anything scheduled up to now (and within the last 15 min as a
  // safety net for missed ticks), still pending, never notified.
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  const { data: due, error } = await admin
    .from('follow_ups')
    .select('id, workspace_id, lead_id, title, scheduled_at, channel, assigned_to')
    .eq('status', 'pending')
    .is('notified_at', null)
    .lte('scheduled_at', now.toISOString())
    .gte('scheduled_at', windowStart)
    .limit(50);
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ ok: true, dispatched: 0 });

  // Lead names for nice notification titles.
  const leadIds = Array.from(new Set(due.map((f) => f.lead_id)));
  const { data: leads } = await admin.from('leads').select('id, full_name, phone').in('id', leadIds);
  const leadById = new Map((leads || []).map((l) => [l.id, l]));

  let dispatched = 0;
  for (const f of due) {
    // Devices: assigned user's, else everyone in the workspace.
    let subsQuery = admin.from('push_subscriptions').select('*').eq('workspace_id', f.workspace_id);
    if (f.assigned_to) subsQuery = subsQuery.eq('user_id', f.assigned_to);
    const { data: subs } = await subsQuery;

    const lead = leadById.get(f.lead_id);
    const when = new Date(f.scheduled_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    if (subs && subs.length > 0) {
      const sent = await sendToSubs(admin, subs as SubRow[], {
        title: `📞 Follow-up: ${lead?.full_name || 'Lead'}`,
        body: `${f.title || 'Scheduled follow-up'} · ${when}${lead?.phone ? ` · ${lead.phone}` : ''}`,
        url: '/daily-tracker',
        tag: `followup-${f.id}`,
      });
      dispatched += sent;
    }
    // Mark notified even if the user has no devices — prevents pile-up storms
    // the moment they enable push later.
    await admin.from('follow_ups').update({ notified_at: now.toISOString() }).eq('id', f.id);
  }

  return NextResponse.json({ ok: true, dispatched, followUps: due.length });
}
