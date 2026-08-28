// =============================================================================
// INTAKE DRAIN — POST /api/whatsapp/intake/drain
// -----------------------------------------------------------------------------
// Cron hits this every 5 minutes (pg_cron job migrizo-wa-intake, migration
// 076) with x-cron-secret. It walks the wa_intake queue: the T2–T4 chase
// nudges and the T6 booking-link follow-up. T1, T5 and T7 never come through
// here — they fire inline in the webhook the moment their trigger happens.
//
// BRANCH IS DECIDED PER SEND, from the conversation's real state:
//   window open  (inbound < 23h ago) → free-form quick-reply text, any hour.
//   window closed                    → Meta-approved template only, clamped
//                                      to the send window. If no template is
//                                      approved yet the row soft-retries every
//                                      24h and dies after 5 strikes — visible
//                                      in wa_intake_stats, never silent.
//
// Same discipline as the campaign engine: claim leases the row, advance moves
// it, every send records first and attaches the provider id after.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import {
  getWaSettings, resolveSavedReply, fillPlaceholders, valuesFor, firstName,
  sendSessionText, sendApprovedTemplate, sendProcessDocument, resolveProcessPdf,
} from '@/lib/whatsapp/outbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 10;
// 23h, not 24: a session send at 23:59 of the window is a send that arrives
// after it shut. The hour of slack is the difference between "clever" and
// "blocked by Meta".
const WINDOW_MS = 23 * 3600 * 1000;

interface ClaimedRow {
  intake_id: string; track: 'chase' | 'verdict'; next_step: number;
  lead_id: string | null; phone_e164: string; lead_name: string;
  lead_industry: string | null; fail_count: number;
  last_inbound_at: string | null; conversation_id: string | null;
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin: SupabaseClient = createAdmin(url, key, { auth: { persistSession: false } });

  // ── caller: cron, or a logged-in campaign admin poking it manually ────────
  const cronSecret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  let wsId: string | null = null;

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
  }
  if (!wsId) return NextResponse.json({ ok: true, sent: 0, note: 'no_workspace_configured' });

  const settings = await getWaSettings(admin);
  if (!settings) return NextResponse.json({ ok: true, sent: 0, note: 'no_settings' });
  const dryRun = settings.dry_run !== false;

  // sending_paused is the number-protection brake (quality drop) — it stops
  // the autopilot too. campaigns_paused deliberately does NOT: that switch is
  // for the wa_campaigns engine only.
  if (settings.sending_paused) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'sending_paused' });
  }
  if (!dryRun && !settings.connected) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'not_connected' });
  }

  const { data: claimed, error: claimErr } = await admin.rpc('wa_intake_claim', {
    p_workspace_id: wsId, p_batch: BATCH,
  });
  if (claimErr) {
    const missing = /does not exist|schema cache/i.test(claimErr.message);
    return NextResponse.json(
      { ok: false, reason: missing ? 'migration_076_not_applied' : claimErr.message },
      { status: 500 });
  }

  const rows = (claimed ?? []) as ClaimedRow[];
  let sent = 0, failed = 0, deferred = 0;
  const results: Array<Record<string, unknown>> = [];

  // Resolve the process PDF ONCE per run: {{pdf}} in message text gets the
  // long-lived link (never the raw "storage:" pointer), the T5 document
  // attachment gets the short fetch link.
  const pdfResolved = settings.pdf_url ? await resolveProcessPdf(admin, settings) : null;

  for (const row of rows) {
    const first = firstName(row.lead_name);
    const tKey = `t${row.next_step}`;
    const step = `intake:T${row.next_step}`;

    // A chase must never nag for a CV we already hold. A returning lead can
    // legitimately re-enter the chase (form re-submission → fresh T1), but
    // the moment their profile exists, the nudges stop for good.
    if (row.track === 'chase' && row.lead_id) {
      const { data: ld } = await admin.from('leads')
        .select('profile_received').eq('id', row.lead_id).maybeSingle();
      if (ld?.profile_received === 'cv' || ld?.profile_received === 'both') {
        await admin.from('wa_intake')
          .update({ status: 'done', last_error: null, updated_at: new Date().toISOString() })
          .eq('id', row.intake_id);
        results.push({ who: row.lead_name, step, ok: true, skipped: 'cv_already_on_file' });
        continue;
      }
    }
    const windowOpen =
      !!row.last_inbound_at &&
      Date.now() - new Date(row.last_inbound_at).getTime() < WINDOW_MS;

    // T5 normally fires inline in the webhook; it only reaches the drain when
    // that inline send couldn't happen (sending paused, quick reply missing).
    // Its {{2}} route lives in the AI verdict stored on the lead.
    let route: string | null = null;
    if (row.track === 'verdict' && row.next_step === 5 && row.lead_id) {
      const { data: ld } = await admin.from('leads')
        .select('profile_ai').eq('id', row.lead_id).maybeSingle();
      const ai = (ld?.profile_ai ?? null) as { route?: string } | null;
      route = ai?.route ?? null;
    }

    const values = valuesFor(row.next_step, {
      first,
      video: settings.video_url,
      booking: settings.booking_url,
      pdf: pdfResolved?.textUrl ?? null,
      route,
    });

    if (windowOpen) {
      // ── session branch: free-form, any hour ─────────────────────────────
      const reply = await resolveSavedReply(admin, wsId, tKey);
      if (!reply) {
        await admin.rpc('wa_intake_advance', {
          p_intake_id: row.intake_id, p_ok: false, p_branch: 'session',
          p_error: `Quick reply ${tKey.toUpperCase()} not found — add it in WhatsApp → Quick replies`,
          p_retry_hours: 1,
        });
        failed++; results.push({ who: row.lead_name, step, ok: false, why: 'quick_reply_missing' });
        continue;
      }
      const filled = fillPlaceholders(reply.body, values);
      if (filled.missing.length) {
        await admin.rpc('wa_intake_advance', {
          p_intake_id: row.intake_id, p_ok: false, p_branch: 'session',
          p_error: `${tKey.toUpperCase()} has unfilled placeholder(s): ${filled.missing.join(', ')} — set booking/video links in WhatsApp Settings`,
          p_retry_hours: 1,
        });
        failed++; results.push({ who: row.lead_name, step, ok: false, why: `missing:${filled.missing.join(',')}` });
        continue;
      }
      const res = await sendSessionText(admin, wsId, {
        phone: row.phone_e164, leadId: row.lead_id, body: filled.text, step, dryRun,
      });
      // T5 through the drain still carries the process document with it.
      if (res.ok && row.track === 'verdict' && row.next_step === 5 && pdfResolved?.ok && pdfResolved.url) {
        await sendProcessDocument(admin, wsId, {
          phone: row.phone_e164, leadId: row.lead_id,
          pdfUrl: pdfResolved.url, step: 'intake:T5-doc', dryRun,
        });
      }
      await admin.rpc('wa_intake_advance', {
        p_intake_id: row.intake_id, p_ok: res.ok, p_branch: 'session',
        p_error: res.ok ? null : `${res.code}: ${res.detail ?? ''}`.slice(0, 300),
      });
      if (res.ok) sent++; else failed++;
      results.push({ who: row.lead_name, step, ok: res.ok, branch: 'session', ...(res.ok ? {} : { why: res.code }) });
    } else {
      // ── template branch: approved templates only, inside the send window ──
      const { data: inWindow } = await admin.rpc('whatsapp_in_send_window', { p_workspace_id: wsId });
      if (inWindow === false) {
        // Not a failure — just not the hour for cold pings. Push to the next
        // window opening and move on.
        const { data: clamped } = await admin.rpc('whatsapp_clamp_to_window', {
          p_workspace_id: wsId, p_ts: new Date(Date.now() + 60_000).toISOString(),
        });
        await admin.from('wa_intake').update({
          next_send_at: (clamped as string) ?? new Date(Date.now() + 3600_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.intake_id);
        deferred++;
        results.push({ who: row.lead_name, step, ok: true, deferred: 'outside_send_window' });
        continue;
      }
      const res = await sendApprovedTemplate(admin, wsId, {
        phone: row.phone_e164, leadId: row.lead_id, tKey, values, step, dryRun,
      });
      await admin.rpc('wa_intake_advance', {
        p_intake_id: row.intake_id, p_ok: res.ok, p_branch: 'template',
        p_error: res.ok ? null : `${res.code}: ${res.detail ?? ''}`.slice(0, 300),
        // An unapproved template is a waiting game, not an error storm: retry
        // daily and let the 5-strike rule surface it if approval never comes.
        p_retry_hours: res.code === 'template_not_approved' || res.code === 'template_missing' ? 24 : 12,
      });
      if (res.ok) sent++; else failed++;
      results.push({ who: row.lead_name, step, ok: res.ok, branch: 'template', ...(res.ok ? {} : { why: res.code }) });
    }
  }

  return NextResponse.json({ ok: true, claimed: rows.length, sent, failed, deferred, dryRun, results });
}

// Browser probe.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'whatsapp intake drain', method: 'POST only' });
}
