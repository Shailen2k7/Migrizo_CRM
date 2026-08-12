// =============================================================================
// AUTOMATION DRAIN — POST /api/whatsapp/automation/drain
// -----------------------------------------------------------------------------
// MANUAL MODE (2026-08-12). The engine's only automatic message to a live or
// incoming lead is the FIRST TOUCH; after that a human owns the conversation.
//
// Job kinds still handled:
//   welcome        approved template to an ad-form lead. 🔥 priority journeys
//                  (eligible field + willing to pay) also push the team.
//   inbound_intro  someone messaged US first (click-to-WhatsApp, saved number,
//                  website button). Send the intro asking for CV + LinkedIn —
//                  free text, because their message opened the 24h window.
//                  A file-only opener is flagged to a human instead (asking a
//                  person who just sent their CV to send a CV reads as a bot).
//   notify         push the team.
//
// Everything else (assets / faq / reminder / cold_enrol) is legacy from the
// old full-journey model: drained harmlessly, never created again. The cold &
// hot follow-up sequences are enrolled by whatsapp_stage_autoenrol() in SQL
// and sent by the sequences drain — not here.
//
// Invariants: record before send · whatsapp_can_send gates every send ·
// suppression wins · cap exhaustion defers jobs, never burns them.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { sendTemplate, sendText, renderTemplate } from '@/lib/whatsapp/interakt';
import webpush from 'web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 8;

interface Job {
  id: string; workspace_id: string; journey_id: string;
  kind: 'welcome' | 'assets' | 'faq' | 'reminder' | 'cold_enrol' | 'notify' | 'eligibility' | 'inbound_intro';
  payload: { message_id?: string; conversation_id?: string; n?: number; reason?: string };
  attempts: number;
}
interface Journey {
  id: string; workspace_id: string; lead_id: string; conversation_id: string | null;
  phone_e164: string; stage: string; priority: boolean; field: string | null;
  readiness: string | null; entry_source: string;
}
interface AutoCfg {
  enabled: boolean; welcome_template_code: string;
  pdf_url: string | null; video_url: string | null; booking_url: string | null;
  inbound_enabled: boolean; inbound_intro_message: string;
  priority_push: boolean;
}

const firstName = (n: string) =>
  n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

/**
 * Inbound leads are created as "WhatsApp 9199…" because we genuinely do not
 * know their name yet. Greeting someone by their own phone number reads like a
 * robot, so those become "there" — "Hi there, thanks for reaching out".
 */
const greetName = (n: string | null | undefined) => {
  const raw = (n ?? '').trim();
  if (!raw || /^whatsapp\s/i.test(raw) || /^[+\d\s-]+$/.test(raw)) return 'there';
  return firstName(raw);
};

function fillTokens(text: string, t: { name?: string; pdf?: string; video?: string; booking?: string }): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, t.name ?? '')
    .replace(/\{\{\s*pdf\s*\}\}/gi, t.pdf ?? '')
    .replace(/\{\{\s*video\s*\}\}/gi, t.video ?? '')
    .replace(/\{\{\s*booking\s*\}\}/gi, t.booking ?? '')
    .replace(/[ \t]+\n/g, '\n').trim();
}

/** Push to every registered device in the workspace. Fire-and-forget safe. */
async function pushWorkspace(admin: SupabaseClient, wsId: string, title: string, body: string, url = '/whatsapp') {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@migrizo.com', pub, priv);
    const { data: subs } = await admin.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth').eq('workspace_id', wsId);
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url }),
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }));
  } catch { /* pushes never block the pipeline */ }
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin: SupabaseClient = createAdmin(url, key, { auth: { persistSession: false } });

  // ── auth: cron secret, or a logged-in campaign admin (Run now) ────────────
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
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    const { data: member } = await supabase.from('workspace_members')
      .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
    const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
    if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });
    wsId = member.workspace_id;
  }
  if (!wsId) return NextResponse.json({ ok: true, claimed: 0, note: 'no workspace' });

  const { data: cfgRow } = await admin.from('whatsapp_automation')
    .select('*').eq('workspace_id', wsId).maybeSingle();
  const cfg = cfgRow as AutoCfg | null;
  if (!cfg?.enabled) return NextResponse.json({ ok: true, claimed: 0, skipped: 'automation_disabled' });

  const { data: gate } = await admin.rpc('whatsapp_can_send', { p_workspace_id: wsId });
  const g = (gate ?? {}) as { dry_run?: boolean; paused?: boolean; connected?: boolean; remaining?: number };
  const dryRun = g.dry_run !== false;
  if (g.paused) return NextResponse.json({ ok: true, claimed: 0, skipped: 'sending_paused' });
  if (!dryRun && !g.connected) return NextResponse.json({ ok: true, claimed: 0, skipped: 'not_connected' });
  let remaining = dryRun ? Number.MAX_SAFE_INTEGER : (g.remaining ?? 0);

  const { data: claimed, error: claimErr } = await admin.rpc('whatsapp_auto_claim', {
    p_workspace_id: wsId, p_batch: BATCH,
  });
  if (claimErr) {
    return NextResponse.json({
      ok: false,
      reason: /does not exist|schema cache/i.test(claimErr.message) ? 'migration_051_not_applied' : claimErr.message,
    }, { status: 500 });
  }

  const jobs = (claimed ?? []) as Job[];
  const results: Array<Record<string, unknown>> = [];
  let sent = 0, failed = 0, deferred = 0;

  const done = (id: string) => admin.rpc('whatsapp_auto_complete', { p_job_id: id, p_ok: true });
  const fail = (id: string, err: string, retry = false) =>
    admin.rpc('whatsapp_auto_complete', { p_job_id: id, p_ok: false, p_error: err, p_retry: retry });
  const defer = (job: Job, why: string, minutes: number) =>
    admin.from('whatsapp_auto_jobs').update({
      status: 'queued', claimed_at: null, error: why,
      attempts: Math.max(0, job.attempts - 1),
      due_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    }).eq('id', job.id);
  const activity = (leadId: string | null, action: string, meta: Record<string, unknown>) =>
    admin.from('activity').insert({ workspace_id: wsId, user_id: null, lead_id: leadId, action, meta });

  /** Record → sendText. Used by the inbound intro. */
  async function sendFree(j: Journey, body: string, step: string): Promise<{ ok: boolean; err?: string; retry?: boolean }> {
    const { data: rec } = await admin.rpc('whatsapp_record_outbound', {
      p_workspace_id: wsId, p_phone: j.phone_e164, p_body: body,
      p_sent_by: null, p_lead_id: j.lead_id, p_step: step,
    });
    const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string };
    if (!r.ok || !r.message_id) return { ok: false, err: r.reason || 'record_failed' };
    const result = await sendText({ phone: j.phone_e164, message: body, callbackData: r.message_id, dryRun });
    if (result.ok) {
      if (result.providerId) {
        await admin.rpc('whatsapp_attach_provider_id', { p_message_id: r.message_id, p_provider_id: result.providerId });
      }
      return { ok: true };
    }
    await admin.from('whatsapp_messages').update({
      status: 'failed', error_code: result.code ?? 'send_failed', error_detail: result.detail ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', r.message_id);
    const transient = /timeout|fetch failed|5\d\d/i.test(result.detail ?? result.code ?? '');
    return { ok: false, err: result.detail || result.code || 'send_failed', retry: transient };
  }

  /** Record → sendTemplate. Used by the welcome. */
  async function sendWelcomeTemplate(j: Journey, step: string): Promise<{ ok: boolean; suppressed?: boolean; convId?: string; err?: string; retry?: boolean; permanent?: string }> {
    const { data: tpl } = await admin.from('whatsapp_templates')
      .select('code, body, variables, language, category, meta_status, active')
      .eq('workspace_id', wsId).eq('code', cfg!.welcome_template_code).maybeSingle();
    if (!tpl || !tpl.active) return { ok: false, permanent: `welcome template "${cfg!.welcome_template_code}" not found or retired` };
    if (!dryRun && tpl.meta_status !== 'approved') {
      return { ok: false, permanent: `welcome template is "${tpl.meta_status}" — approve it in the Templates tab first` };
    }
    const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
    const vars = Array.isArray(tpl.variables) ? tpl.variables as Array<{ n: string; default?: string }> : [];
    const values: Record<string, string> = {};
    for (const v of vars) values[v.n] = v.n === '1' ? firstName(lead?.full_name ?? 'there') : (v.default ?? '');
    const rendered = renderTemplate(tpl.body, vars, values);

    const { data: rec } = await admin.rpc('whatsapp_record_outbound', {
      p_workspace_id: wsId, p_phone: j.phone_e164, p_body: rendered.text,
      p_template_code: tpl.code, p_category: tpl.category, p_variables: values,
      p_sent_by: null, p_lead_id: j.lead_id, p_step: step,
    });
    const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string; conversation_id?: string };
    if (!r.ok || !r.message_id) {
      if (r.reason === 'suppressed') return { ok: false, suppressed: true };
      return { ok: false, err: r.reason || 'record_failed', retry: true };
    }
    const result = await sendTemplate({
      phone: j.phone_e164,
      template: { name: tpl.code, languageCode: tpl.language || 'en', bodyValues: rendered.bodyValues },
      callbackData: r.message_id, dryRun,
    });
    if (!result.ok) {
      await admin.from('whatsapp_messages').update({
        status: 'failed', error_code: result.code ?? 'send_failed', error_detail: result.detail ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', r.message_id);
      const transient = /timeout|fetch failed|5\d\d/i.test(result.detail ?? result.code ?? '');
      return { ok: false, err: result.detail || result.code || 'send_failed', retry: transient };
    }
    if (result.providerId) {
      await admin.rpc('whatsapp_attach_provider_id', { p_message_id: r.message_id, p_provider_id: result.providerId });
    }
    return { ok: true, convId: r.conversation_id };
  }

  for (const job of jobs) {
    const { data: jRow } = await admin.from('whatsapp_journeys').select('*').eq('id', job.journey_id).maybeSingle();
    const j = jRow as Journey | null;
    if (!j) { await fail(job.id, 'journey_missing'); failed++; continue; }

    try {
      // ════ WELCOME — the first touch for an ad-form lead ═══════════════════
      if (job.kind === 'welcome') {
        if (j.stage !== 'welcome_queued') { await done(job.id); results.push({ kind: job.kind, note: 'stage_moved_on' }); continue; }
        if (remaining <= 0) { await defer(job, 'daily_cap', 30); deferred++; continue; }

        const res = await sendWelcomeTemplate(j, 'auto:welcome');
        if (res.suppressed) {
          await admin.from('whatsapp_journeys').update({ stage: 'stopped', stop_reason: 'suppressed' }).eq('id', j.id);
          await done(job.id); results.push({ kind: job.kind, note: 'suppressed' }); continue;
        }
        if (!res.ok) {
          if (res.permanent) { await fail(job.id, res.permanent); failed++; }
          else { await fail(job.id, res.err!, res.retry); failed++; }
          continue;
        }

        // First touch delivered. From here a human owns the conversation —
        // no reminders, no assets, nothing queued behind it.
        await admin.from('whatsapp_journeys').update({
          stage: 'awaiting_reply', conversation_id: res.convId ?? j.conversation_id,
        }).eq('id', j.id);

        // 🔥 Hot lane: eligible field + willing to pay → the team hears now.
        if (j.priority && cfg.priority_push) {
          const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
          await pushWorkspace(admin, wsId!, '🔥 Hot lead — willing to pay',
            `${lead?.full_name ?? 'New lead'} · ${j.field ?? 'eligible'} · welcome sent, jump in early`);
        }
        await activity(j.lead_id, 'whatsapp_auto_welcome_sent', { dry_run: dryRun, priority: j.priority });
        await done(job.id); sent++; remaining--;
        results.push({ kind: job.kind, ok: true, priority: j.priority, dryRun });
      }

      // ════ INBOUND INTRO — they messaged US first ═════════════════════════
      else if (job.kind === 'inbound_intro') {
        if (!cfg.inbound_enabled) { await done(job.id); continue; }
        if (j.stage !== 'intro_queued') { await done(job.id); results.push({ kind: job.kind, note: 'stage_moved_on' }); continue; }

        const { data: msg } = await admin.from('whatsapp_messages')
          .select('body, media_path, conversation_id').eq('id', job.payload.message_id ?? '').maybeSingle();
        const text = (msg?.body ?? '').trim();
        const convId = msg?.conversation_id ?? job.payload.conversation_id ?? j.conversation_id ?? null;

        const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
        const name = greetName(lead?.full_name);

        // Someone typing STOP as their opener is not a lead.
        if (/^(stop|unsubscribe|remove me)\b/i.test(text)) {
          await admin.from('whatsapp_journeys').update({ stage: 'stopped', stop_reason: 'not_a_lead' }).eq('id', j.id);
          await done(job.id); results.push({ kind: job.kind, note: 'opt_out_opener' }); continue;
        }

        // They opened by sending a document — asking for a CV would be absurd.
        // Flag it and let a human answer like a human.
        if (!text && msg?.media_path) {
          if (convId) await admin.from('whatsapp_conversations').update({ needs_attention: true }).eq('id', convId);
          await admin.from('whatsapp_journeys').update({ stage: 'handed_over' }).eq('id', j.id);
          await pushWorkspace(admin, wsId!, '📎 New enquiry — sent a file', `${j.phone_e164}: opened the chat with an attachment`);
          await activity(j.lead_id, 'whatsapp_inbound_escalated', { why: 'opened_with_file', conversation_id: convId });
          await done(job.id); results.push({ kind: job.kind, escalated: 'opened_with_file' }); continue;
        }

        if (remaining <= 0) { await defer(job, 'daily_cap', 15); deferred++; continue; }

        const intro = fillTokens(cfg.inbound_intro_message, {
          name, pdf: cfg.pdf_url ?? '', video: cfg.video_url ?? '', booking: cfg.booking_url ?? '',
        });
        const r = await sendFree(j, intro, 'auto:inbound_intro');
        if (!r.ok) { await fail(job.id, r.err!, r.retry); failed++; continue; }
        sent++; remaining--;

        await admin.from('whatsapp_journeys').update({ stage: 'awaiting_reply' }).eq('id', j.id);

        // A click-to-WhatsApp ad can arrive fully tagged, so this lead may be
        // just as hot as a form lead — the trigger set priority before we ran.
        if (j.priority && cfg.priority_push) {
          await pushWorkspace(admin, wsId!, '🔥 Hot lead — willing to pay',
            `${greetName(lead?.full_name)} · ${j.field ?? 'eligible'} · messaged us directly, jump in early`);
        }
        await activity(j.lead_id, 'whatsapp_inbound_intro_sent', { dry_run: dryRun });
        await done(job.id);
        results.push({ kind: job.kind, ok: true, dryRun });
      }

      // ════ NOTIFY — the team must look at this one ════════════════════════
      else if (job.kind === 'notify') {
        const { data: lead } = await admin.from('leads').select('full_name, industry').eq('id', j.lead_id).maybeSingle();
        await pushWorkspace(admin, wsId!, '👀 Lead needs a human',
          `${lead?.full_name ?? 'A lead'} (${lead?.industry ?? 'field unknown'}) replied — open the chat`);
        await done(job.id);
        results.push({ kind: job.kind, ok: true });
      }

      // legacy kinds from the old full-journey model, drained harmlessly
      else { await done(job.id); results.push({ kind: job.kind, note: 'legacy_skipped' }); }
    } catch (e) {
      await fail(job.id, (e as Error).message, true); failed++;
      results.push({ kind: job.kind, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, claimed: jobs.length, sent, failed, deferred, dryRun, results });
}
