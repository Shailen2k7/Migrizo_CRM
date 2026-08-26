// =============================================================================
// THE ENGINE — POST /api/whatsapp/campaigns/run
// -----------------------------------------------------------------------------
// The ONE code path that sends campaign messages. Cron hits it every 5 minutes
// with x-cron-secret; the Campaigns screen's "Run engine now" button hits it as
// a logged-in admin; the "Send me a test" box hits it with { test: ... }.
// Three callers, one path — so a test proves the exact machinery cron uses.
//
// Every run, success or empty, writes a heartbeat onto whatsapp_settings
// (engine_last_run_at + engine_last_result). The screen shows that pulse.
// After a day lost to a silent 405, the rule is: the engine is either visibly
// alive on screen, or visibly broken on screen. Nothing in between.
//
// Discipline per send: record row first (a crash leaves a visible queued
// message, never a silent gap) → Interakt → attach provider id → advance.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { sendTemplate, renderTemplate } from '@/lib/whatsapp/interakt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 10;

interface Claimed {
  person_id: string; campaign_id: string; campaign_name: string; step_no: number;
  template_code: string; template_body: string;
  template_variables: Array<{ n: string; label?: string; default?: string }> | null;
  template_language: string | null; template_category: string | null;
  lead_id: string | null; phone_e164: string; lead_name: string;
}

const firstName = (n: string) =>
  n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin: SupabaseClient = createAdmin(url, key, { auth: { persistSession: false } });

  // ── who is calling: the scheduler, or a logged-in campaign admin ──────────
  const cronSecret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  let wsId: string | null = null;
  let runBy: string | null = null;

  if (cronSecret && given === cronSecret) {
    const { data: rows } = await admin.from('whatsapp_settings')
      .select('workspace_id, connected').order('connected', { ascending: false }).limit(1);
    wsId = rows?.[0]?.workspace_id ?? null;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
    const { data: member } = await supabase.from('workspace_members')
      .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
    const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
    if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });
    wsId = member.workspace_id as string;
    runBy = user.id;
  }
  if (!wsId) return NextResponse.json({ ok: true, sent: 0, note: 'no_workspace_configured' });

  let body: { test?: { campaignId?: string; phone?: string } } = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  // ── global gates, reported not swallowed ──────────────────────────────────
  const { data: gate } = await admin.rpc('whatsapp_can_send', { p_workspace_id: wsId });
  const g = (gate ?? {}) as { dry_run?: boolean; paused?: boolean; connected?: boolean; remaining?: number; reason?: string };
  const dryRun = g.dry_run !== false;

  const heartbeat = async (result: Record<string, unknown>) => {
    await admin.from('whatsapp_settings').update({
      engine_last_run_at: new Date().toISOString(),
      engine_last_result: result,
    }).eq('workspace_id', wsId);
  };

  /** One send, shared by the engine loop and the test button. */
  async function sendOne(row: Claimed, opts: { test?: boolean } = {}) {
    const vars = Array.isArray(row.template_variables) ? row.template_variables : [];
    const values: Record<string, string> = {};
    for (const v of vars) {
      values[v.n] = v.n === '1' ? (firstName(row.lead_name) || v.default || 'there') : (v.default ?? '');
    }
    const rendered = renderTemplate(row.template_body, vars, values);
    if (rendered.missing.length) {
      return { ok: false as const, detail: `template is missing variable ${rendered.missing.map((n) => `{{${n}}}`).join(', ')}` };
    }

    const { data: rec } = await admin.rpc('whatsapp_record_outbound', {
      p_workspace_id: wsId, p_phone: row.phone_e164, p_body: rendered.text,
      p_template_code: row.template_code, p_category: row.template_category,
      p_variables: values, p_sent_by: runBy, p_lead_id: row.lead_id,
      p_step: opts.test ? 'campaign:test' : `${row.campaign_id}:${row.step_no}`,
    });
    const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string };
    if (!r.ok || !r.message_id) {
      return { ok: false as const, detail: r.reason === 'suppressed'
        ? 'this number opted out — nothing can be sent to it'
        : (r.reason || 'could not record the message') };
    }

    const result = await sendTemplate({
      phone: row.phone_e164,
      template: { name: row.template_code, languageCode: row.template_language || 'en', bodyValues: rendered.bodyValues },
      callbackData: r.message_id,
      dryRun,
    });
    if (!result.ok) {
      await admin.from('whatsapp_messages').update({
        status: 'failed', error_code: result.code ?? 'send_failed',
        error_detail: (result.detail ?? '').slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', r.message_id);
      return { ok: false as const, detail: `${result.code ?? 'send_failed'}: ${result.detail ?? ''}`.slice(0, 300) };
    }
    if (result.providerId) {
      await admin.rpc('whatsapp_attach_provider_id', { p_message_id: r.message_id, p_provider_id: result.providerId });
    }
    return { ok: true as const, dryRun };
  }

  // ══ TEST MODE — prove the whole pipe in one click ══════════════════════════
  // Sends the campaign's FIRST message to the phone you typed, through the
  // exact code the engine uses, and reports Interakt's verbatim answer.
  if (body.test?.campaignId && body.test?.phone) {
    if (!runBy) return NextResponse.json({ ok: false, reason: 'test_requires_login' }, { status: 403 });
    const { data: step } = await admin.from('wa_campaign_steps')
      .select('step_no, template:whatsapp_templates(code, body, variables, language, category)')
      .eq('campaign_id', body.test.campaignId).eq('step_no', 1).maybeSingle();
    const tpl = (Array.isArray(step?.template) ? step?.template[0] : step?.template) as
      { code: string; body: string; variables: Claimed['template_variables']; language: string | null; category: string | null } | undefined;
    if (!tpl) return NextResponse.json({ ok: false, detail: 'This campaign has no message 1 yet.' });

    const { data: norm } = await admin.rpc('whatsapp_normalize_phone', { p_raw: body.test.phone, p_default_cc: '91' });
    if (!norm) return NextResponse.json({ ok: false, detail: 'That phone number does not look valid.' });

    const res = await sendOne({
      person_id: 'test', campaign_id: body.test.campaignId, campaign_name: 'test', step_no: 1,
      template_code: tpl.code, template_body: tpl.body, template_variables: tpl.variables,
      template_language: tpl.language, template_category: tpl.category,
      lead_id: null, phone_e164: norm as string, lead_name: 'there',
    }, { test: true });
    return NextResponse.json(res.ok
      ? { ok: true, dryRun, detail: dryRun
          ? 'Dry-run is ON — the message was logged but never left the CRM. Turn dry-run off in Settings to send for real.'
          : 'Sent. Check that phone — it should arrive within seconds.' }
      : { ok: false, detail: res.detail });
  }

  // ══ THE ENGINE LOOP ════════════════════════════════════════════════════════
  if (g.paused) {
    const out = { sent: 0, skipped: 'sending_paused' };
    await heartbeat(out);
    return NextResponse.json({ ok: true, ...out });
  }
  // Master switch (076): one toggle for the whole cold+hot engine. The intake
  // autopilot has its own drain and deliberately ignores this.
  const { data: masterRow } = await admin.from('whatsapp_settings')
    .select('campaigns_paused').eq('workspace_id', wsId).maybeSingle();
  if (masterRow?.campaigns_paused === true) {
    const out = { sent: 0, skipped: 'campaigns_paused' };
    await heartbeat(out);
    return NextResponse.json({ ok: true, ...out });
  }
  if (!dryRun && !g.connected) {
    const out = { sent: 0, skipped: 'not_connected' };
    await heartbeat(out);
    return NextResponse.json({ ok: true, ...out });
  }

  const { data: claimed, error: claimErr } = await admin.rpc('wa_claim', {
    p_workspace_id: wsId, p_batch: BATCH,
  });
  if (claimErr) {
    const missing = /does not exist|schema cache/i.test(claimErr.message);
    const out = { sent: 0, error: missing ? 'migration_062_not_applied' : claimErr.message };
    await heartbeat(out);
    return NextResponse.json({ ok: false, reason: out.error }, { status: 500 });
  }

  const rows = (claimed ?? []) as Claimed[];
  let sent = 0, failed = 0;
  const results: Array<{ who: string; step: number; ok: boolean; detail?: string }> = [];

  for (const row of rows) {
    const res = await sendOne(row);
    if (res.ok) {
      await admin.rpc('wa_advance', { p_person_id: row.person_id, p_ok: true });
      if (row.lead_id) {
        await admin.from('activity').insert({
          workspace_id: wsId, user_id: runBy, lead_id: row.lead_id,
          action: 'whatsapp_campaign_sent',
          meta: { campaign: row.campaign_name, step: row.step_no, template: row.template_code, dry_run: dryRun },
        });
      }
      sent++;
      results.push({ who: row.lead_name, step: row.step_no, ok: true });
    } else {
      await admin.rpc('wa_advance', { p_person_id: row.person_id, p_ok: false, p_error: res.detail });
      failed++;
      results.push({ who: row.lead_name, step: row.step_no, ok: false, detail: res.detail });
    }
  }

  const out = { claimed: rows.length, sent, failed, dryRun, remaining: g.remaining ?? null };
  await heartbeat({ ...out, results: results.slice(0, 10) });
  return NextResponse.json({ ok: true, ...out, results });
}
