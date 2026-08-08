// =============================================================================
// DRAIN — POST /api/whatsapp/sequences/drain
// -----------------------------------------------------------------------------
// The cron half. Point your scheduler at:
//
//   POST https://<domain>/api/whatsapp/sequences/drain
//   header  x-cron-secret: <CRON_SECRET>
//
// every 10 minutes. Each run: claim a small batch of due enrollments (Postgres
// enforces window, caps and suppression before a row is ever returned), send
// each via Interakt, advance or retry. A logged-in campaign admin may also call
// it with no header — that is the Settings tab's "Run now" button, which makes
// the whole engine testable in dry-run without waiting for a cron.
//
// Pacing maths: batch 10 every 10 min inside a 9-hour window = up to 540
// sends/day of theoretical throughput. The real ceiling is always the daily
// cap, so the batch size never needs tuning — the cap is the knob.
//
// Every send:  record row first (crash leaves a visible queued message, never a
// silent gap) -> Interakt -> attach provider id -> activity row -> advance.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { sendTemplate, renderTemplate } from '@/lib/whatsapp/interakt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 10;

interface ClaimedRow {
  enrollment_id: string;
  sequence_id: string;
  sequence_name: string;
  step_no: number;
  wait_days: number;
  template_id: string;
  template_code: string;
  template_body: string;
  template_variables: Array<{ n: string; label?: string; default?: string }> | null;
  template_language: string | null;
  template_category: string | null;
  lead_id: string | null;
  phone_e164: string;
  lead_name: string;
}

const firstName = (n: string) =>
  n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin: SupabaseClient = createAdmin(url, key, { auth: { persistSession: false } });

  // ── auth: cron secret, or a logged-in campaign admin (the Run-now button) ──
  const cronSecret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  let wsId: string | null = null;
  let runBy: string | null = null;

  if (cronSecret && given === cronSecret) {
    // Single-workspace model: resolve from settings, same as the webhook does.
    const { data: rows } = await admin
      .from('whatsapp_settings')
      .select('workspace_id, connected')
      .order('connected', { ascending: false })
      .limit(1);
    wsId = rows?.[0]?.workspace_id ?? null;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
    const { data: member } = await supabase
      .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
    const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
    if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });
    wsId = member.workspace_id as string;
    runBy = user.id;
  }
  if (!wsId) return NextResponse.json({ ok: true, sent: 0, reason: 'no_workspace_configured' });

  // ── global gates the claim cannot see: paused / disconnected ──────────────
  const { data: gate } = await admin.rpc('whatsapp_can_send', { p_workspace_id: wsId });
  const g = (gate ?? {}) as { dry_run?: boolean; paused?: boolean; connected?: boolean; reason?: string; remaining?: number };
  const dryRun = g.dry_run !== false;
  if (g.paused) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'sending_paused', detail: g.reason ?? null });
  }
  if (!dryRun && !g.connected) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'not_connected' });
  }

  // ── claim: Postgres applies window, caps and suppression atomically ───────
  const { data: claimed, error: claimErr } = await admin.rpc('whatsapp_claim_due', {
    p_workspace_id: wsId,
    p_batch: BATCH,
  });
  if (claimErr) {
    const missing = /does not exist|schema cache/i.test(claimErr.message);
    return NextResponse.json(
      { ok: false, reason: missing ? 'migration_047_not_applied' : claimErr.message },
      { status: 500 }
    );
  }

  const rows = (claimed ?? []) as ClaimedRow[];
  let sent = 0, failed = 0;
  const results: Array<{ lead: string; step: number; ok: boolean; detail?: string }> = [];

  for (const row of rows) {
    // {{1}} is the lead's first name by convention; every other variable falls
    // back to the default the template declares. A template whose variables
    // cannot all be filled is a build error, not a lead error — retry later.
    const vars = Array.isArray(row.template_variables) ? row.template_variables : [];
    const values: Record<string, string> = {};
    for (const v of vars) {
      values[v.n] = v.n === '1'
        ? (firstName(row.lead_name) || v.default || '')
        : (v.default ?? '');
    }
    const rendered = renderTemplate(row.template_body, vars, values);
    if (rendered.missing.length) {
      await admin.rpc('whatsapp_advance_enrollment', {
        p_enrollment_id: row.enrollment_id, p_ok: false,
        p_error: `missing variable ${rendered.missing.map((n) => `{{${n}}}`).join(', ')}`,
      });
      failed++;
      results.push({ lead: row.lead_name, step: row.step_no, ok: false, detail: 'missing_variables' });
      continue;
    }

    // Record first, send second — same discipline as the manual send route.
    const { data: rec, error: recErr } = await admin.rpc('whatsapp_record_outbound', {
      p_workspace_id: wsId,
      p_phone: row.phone_e164,
      p_body: rendered.text,
      p_template_code: row.template_code,
      p_category: row.template_category,
      p_variables: values,
      p_sent_by: runBy,
      p_lead_id: row.lead_id,
      p_step: `${row.sequence_id}:${row.step_no}`,   // provenance + per-seq cap counting
    });
    const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string; conversation_id?: string };
    if (recErr || !r.ok || !r.message_id) {
      // 'suppressed' here means the opt-out landed in the microseconds since
      // claim — the trigger already stopped the enrollment; do not advance.
      const reason = recErr?.message ?? r.reason ?? 'record_failed';
      if (reason !== 'suppressed') {
        await admin.rpc('whatsapp_advance_enrollment', {
          p_enrollment_id: row.enrollment_id, p_ok: false, p_error: reason,
        });
      }
      failed++;
      results.push({ lead: row.lead_name, step: row.step_no, ok: false, detail: reason });
      continue;
    }

    const result = await sendTemplate({
      phone: row.phone_e164,
      template: {
        name: row.template_code,
        languageCode: row.template_language || 'en',
        bodyValues: rendered.bodyValues,
      },
      callbackData: r.message_id,
      dryRun,
    });

    if (result.ok && result.providerId) {
      await admin.rpc('whatsapp_attach_provider_id', {
        p_message_id: r.message_id, p_provider_id: result.providerId,
      });
      if (row.lead_id) {
        await admin.from('activity').insert({
          workspace_id: wsId,
          user_id: runBy,
          lead_id: row.lead_id,
          action: 'whatsapp_sequence_sent',
          meta: {
            sequence: row.sequence_name,
            step: row.step_no,
            template: row.template_code,
            conversation_id: r.conversation_id,
            dry_run: Boolean(result.dryRun),
            preview: rendered.text.slice(0, 180),
          },
        });
      }
      await admin.rpc('whatsapp_advance_enrollment', {
        p_enrollment_id: row.enrollment_id, p_ok: true, p_error: null,
      });
      sent++;
      results.push({ lead: row.lead_name, step: row.step_no, ok: true });
    } else {
      await admin.from('whatsapp_messages').update({
        status: 'failed',
        error_code: result.code ?? 'unknown',
        error_detail: (result.detail ?? '').slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', r.message_id);
      await admin.rpc('whatsapp_advance_enrollment', {
        p_enrollment_id: row.enrollment_id, p_ok: false,
        p_error: `${result.code ?? 'send_failed'}: ${result.detail ?? ''}`.slice(0, 400),
      });
      failed++;
      results.push({ lead: row.lead_name, step: row.step_no, ok: false, detail: result.code });
    }
  }

  return NextResponse.json({
    ok: true,
    claimed: rows.length,
    sent,
    failed,
    dryRun,
    remainingToday: g.remaining ?? null,
    results,
  });
}
