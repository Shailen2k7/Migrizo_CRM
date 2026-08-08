// =============================================================================
// DIAGNOSE — GET /api/whatsapp/diagnose
// -----------------------------------------------------------------------------
// One request that answers "why isn't WhatsApp working?" without a single
// screenshot. Open it in a browser tab while logged in as a campaign admin.
//
// It checks the whole chain in order and returns the FIRST broken link as
// `next_action`, in plain English, because a list of twelve green ticks and one
// red cross is still work for a human to read.
//
//   env       -> are the secrets on this deploy at all
//   settings  -> is there a settings row, is a number saved, is it connected
//   inbound   -> has Interakt ever actually called the webhook (migration 042)
//   templates -> is there anything Meta has approved that we may send
//   traffic   -> what has moved through the system so far
//
// Never returns a secret value. Only whether each one is present and its length,
// which is enough to catch a truncated paste without exposing the key.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { isConfigured } from '@/lib/whatsapp/interakt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const present = (v: string | undefined) =>
  v ? { set: true, length: v.length } : { set: false, length: 0 };

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const wsId = member.workspace_id as string;

  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: wsId });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  // ── env ───────────────────────────────────────────────────────────────────
  const env = {
    INTERAKT_API_KEY: present(process.env.INTERAKT_API_KEY),
    WHATSAPP_WEBHOOK_SECRET: present(
      process.env.WHATSAPP_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET
    ),
    SUPABASE_SERVICE_ROLE_KEY: present(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    interakt_client_ready: isConfigured(),
  };

  // ── everything else, in one parallel batch ────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = url && svc ? createAdmin(url, svc, { auth: { persistSession: false } }) : null;

  const [settingsRes, healthRes, tmplRes, convRes, msgRes, supRes] = await Promise.all([
    supabase.from('whatsapp_settings').select('*').eq('workspace_id', wsId).maybeSingle(),
    supabase.rpc('whatsapp_webhook_health'),
    supabase.from('whatsapp_templates').select('meta_status').eq('workspace_id', wsId),
    admin
      ? admin.from('whatsapp_conversations').select('workspace_id')
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('whatsapp_messages')
      .select('direction,status')
      .eq('workspace_id', wsId)
      .limit(5000),
    supabase.from('whatsapp_suppressions').select('phone_e164').eq('workspace_id', wsId),
  ]);

  const s = settingsRes.data as Record<string, unknown> | null;

  // Migration 042 not applied yet -> the RPC will not exist. Say so plainly
  // instead of returning a confusing null.
  const health = healthRes.error
    ? {
        ok: false,
        reason: /does not exist|schema cache/i.test(healthRes.error.message)
          ? 'migration_042_not_applied'
          : healthRes.error.message,
      }
    : (healthRes.data as Record<string, unknown>);

  const templates = (tmplRes.data ?? []) as { meta_status: string }[];
  const byStatus = templates.reduce<Record<string, number>>((acc, t) => {
    acc[t.meta_status] = (acc[t.meta_status] ?? 0) + 1;
    return acc;
  }, {});

  // Conversations counted with the service role and grouped by workspace. This
  // is the check that catches a webhook writing into a workspace the logged-in
  // user cannot see — invisible to any query that filters by workspace first.
  const allConvs = (convRes.data ?? []) as { workspace_id: string }[];
  const convsByWorkspace = allConvs.reduce<Record<string, number>>((acc, c) => {
    acc[c.workspace_id] = (acc[c.workspace_id] ?? 0) + 1;
    return acc;
  }, {});
  const mine = convsByWorkspace[wsId] ?? 0;
  const elsewhere = allConvs.length - mine;

  const msgs = (msgRes.data ?? []) as { direction: string; status: string }[];
  const traffic = {
    conversations_visible_to_you: mine,
    conversations_in_other_workspaces: elsewhere,
    messages_total: msgs.length,
    messages_in: msgs.filter((m) => m.direction === 'in').length,
    messages_out: msgs.filter((m) => m.direction === 'out').length,
    messages_failed: msgs.filter((m) => m.status === 'failed').length,
    suppressed_numbers: (supRes.data ?? []).length,
  };

  // ── the verdict: first broken link wins ───────────────────────────────────
  const webhookPath = '/api/whatsapp/webhook';
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ?? '';
  let next_action: string;

  if (!env.INTERAKT_API_KEY.set) {
    next_action =
      'INTERAKT_API_KEY is missing from this deploy. Add it in Netlify → Environment variables, then Clear cache and deploy site. Nothing can send until this is set.';
  } else if (!env.WHATSAPP_WEBHOOK_SECRET.set) {
    next_action =
      'WHATSAPP_WEBHOOK_SECRET is missing from this deploy. Add it in Netlify (same value as the ?key= in the Interakt webhook URL), then redeploy. Until then every Interakt call is rejected with 401.';
  } else if (!s) {
    next_action =
      'No whatsapp_settings row exists for your workspace. Run migration 040 again, or insert one — the bootstrap trigger only fires for new workspaces.';
  } else if (!s.phone_e164) {
    next_action =
      'No WhatsApp number saved. Set whatsapp_settings.phone_e164 to your number in digits only, e.g. 918287768657.';
  } else if (health && (health as Record<string, unknown>).reason === 'migration_042_not_applied') {
    next_action =
      'Migration 042 is not applied yet, so there is no webhook log to inspect. Run 042_whatsapp_webhook_log.sql in Supabase, then reload this page — it will then tell you exactly why inbound is not arriving.';
  } else if (health && typeof (health as Record<string, unknown>).verdict === 'string') {
    const v = String((health as Record<string, unknown>).verdict);
    next_action = v.startsWith('HEALTHY')
      ? byStatus.approved
        ? 'Everything is wired. Inbound is arriving and you have approved templates — you can start outbound.'
        : 'Inbound is working. No templates are approved yet, so you can only reply inside the 24-hour window. Submit your templates in Interakt to start cold outbound.'
      : v;
  } else if (!s.connected) {
    next_action =
      'The Interakt credential has never tested clean. POST /api/whatsapp/test-connection and check the reason it returns.';
  } else {
    next_action = 'No obvious break. Check traffic below against what you expect.';
  }

  if (elsewhere > 0) {
    next_action =
      `${elsewhere} conversation(s) exist under a DIFFERENT workspace_id than the one you are logged into, so they are invisible to you. ` +
      `Your workspace is ${wsId}. Point whatsapp_settings at the right workspace, or move those rows.`;
  }

  return NextResponse.json({
    ok: true,
    checked_at: new Date().toISOString(),
    your_workspace_id: wsId,
    next_action,
    webhook_url_should_be: base
      ? `${base}${webhookPath}?key=<WHATSAPP_WEBHOOK_SECRET>`
      : `https://<your-domain>${webhookPath}?key=<WHATSAPP_WEBHOOK_SECRET>`,
    env,
    settings: s
      ? {
          phone_e164: s.phone_e164,
          display_number: s.display_number,
          connected: s.connected,
          dry_run: s.dry_run,
          daily_cap: s.daily_cap,
          sending_paused: s.sending_paused,
          pause_reason: s.pause_reason,
          quality_rating: s.quality_rating,
          last_tested_at: s.last_tested_at,
          last_test_error: s.last_test_error,
        }
      : null,
    inbound: health,
    templates: { total: templates.length, by_meta_status: byStatus },
    traffic,
  });
}
