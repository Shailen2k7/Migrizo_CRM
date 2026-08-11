// =============================================================================
// AUTOMATION DRAIN — POST /api/whatsapp/automation/drain
// -----------------------------------------------------------------------------
// The worker behind the new-lead journey. Cron hits this every minute with
// x-cron-secret (scheduled by migration 051); a logged-in campaign admin can
// also call it bare — the Automation tab's "Run now" button.
//
// Job kinds:
//   welcome     approved template (default fresh_lead_01) to a brand-new lead;
//               🔥 priority journeys (eligible field + willing to pay) also
//               push-notify the whole team the moment the welcome goes out
//   assets      the guide+video message, then the booking-link message
//               (free text — the lead's reply opened the 24h window)
//   reminder    re-send the welcome template at +24h / +48h of silence
//   cold_enrol  still silent after both reminders → enrol into the chosen
//               cold sequence (eligible fields only), else stop quietly
//   faq         the Q&A brain — see route rules below
//   notify      push the team ("wrong-field lead replied — review needed")
//
// THE Q&A BRAIN'S RULES (in priority order, enforced in code):
//   1. Discounts/negotiation, complaints, ready-to-pay, guarantees
//        → NEVER answered by AI. Flag "needs reply" + push a human.
//   2. Message matches a saved Q&A → send the founder's answer WORD-FOR-WORD.
//        The AI only picks which saved answer fits — it never composes.
//   3. Casual chatter ("ok", "thanks", sent a file) → stay silent.
//   4. A real question nothing matches → flag + push. Silence beats guessing.
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
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Job {
  id: string; workspace_id: string; journey_id: string;
  kind: 'welcome' | 'assets' | 'faq' | 'reminder' | 'cold_enrol' | 'notify' | 'eligibility';
  payload: { message_id?: string; conversation_id?: string; n?: number; reason?: string };
  attempts: number;
}
interface Journey {
  id: string; workspace_id: string; lead_id: string; conversation_id: string | null;
  phone_e164: string; stage: string; priority: boolean; field: string | null;
  readiness: string | null; reminders_sent: number;
}
interface AutoCfg {
  enabled: boolean; welcome_template_code: string;
  pdf_url: string | null; video_url: string | null; booking_url: string | null;
  eligible_message: string; booking_message: string;
  auto_faq: boolean; cold_sequence_id: string | null;
  reminder_hours_1: number; reminder_hours_2: number; priority_push: boolean;
}
interface Faq { id: string; title: string; question: string; keywords: string[]; answer: string; times_used: number }

const firstName = (n: string) =>
  n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

function fillTokens(text: string, t: { name?: string; pdf?: string; video?: string; booking?: string }): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, t.name ?? '')
    .replace(/\{\{\s*pdf\s*\}\}/gi, t.pdf ?? '')
    .replace(/\{\{\s*video\s*\}\}/gi, t.video ?? '')
    .replace(/\{\{\s*booking\s*\}\}/gi, t.booking ?? '')
    .replace(/[ \t]+\n/g, '\n').trim();
}

// Sensitive topics — checked BEFORE any Q&A matching, in plain code, so a
// regex nobody can prompt-inject decides what never gets an automated reply.
// (The standard price quote is a saved Q&A and is allowed; discount/negotiation
// wording below overrides it and goes to a human.)
const SENSITIVE = [
  /discount|negotiat|cheaper|best price|lower price|price kam|kam kar|reduce.*(fee|price|cost)|installment|emi\b/i,
  /complain|complaint|unhappy|disappointed|frustrat|angry|worst|scam|fraud|refund|money back|cheat/i,
  /ready to pay|want to pay|make (the )?payment|paid|payment done|proceed with payment|send.*account|bank detail|how (do|to) i pay/i,
  /guarantee|guaranteed|assur(e|ance).*(visa|endorsement|success)|100%|pakka|sure shot|kitna chance|success rate/i,
];
const sensitiveHit = (text: string) => SENSITIVE.some((re) => re.test(text));

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

  /** Record → sendText. Used by assets and Q&A answers. */
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

  /** Record → sendTemplate. Used by welcome and reminders. */
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

  /** Has the lead said anything since the welcome? (reminder/cold gate) */
  async function leadHasReplied(j: Journey): Promise<boolean> {
    if (!j.conversation_id) {
      const { data: conv } = await admin.from('whatsapp_conversations')
        .select('id, last_inbound_at').eq('workspace_id', wsId).eq('phone_e164', j.phone_e164).maybeSingle();
      return Boolean(conv?.last_inbound_at);
    }
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('last_inbound_at').eq('id', j.conversation_id).maybeSingle();
    return Boolean(conv?.last_inbound_at);
  }

  for (const job of jobs) {
    const { data: jRow } = await admin.from('whatsapp_journeys').select('*').eq('id', job.journey_id).maybeSingle();
    const j = jRow as Journey | null;
    if (!j) { await fail(job.id, 'journey_missing'); failed++; continue; }

    try {
      // ════ WELCOME ════════════════════════════════════════════════════════
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

        await admin.from('whatsapp_journeys').update({
          stage: 'awaiting_reply', conversation_id: res.convId ?? j.conversation_id,
        }).eq('id', j.id);

        // Reminder 1 arms the moment the welcome goes out.
        await admin.from('whatsapp_auto_jobs').insert({
          workspace_id: wsId, journey_id: j.id, kind: 'reminder', payload: { n: 1 },
          due_at: new Date(Date.now() + cfg.reminder_hours_1 * 3600_000).toISOString(),
        });

        // 🔥 Hot lane: eligible field + willing to pay → the team hears about it now.
        if (j.priority && cfg.priority_push) {
          const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
          await pushWorkspace(admin, wsId!, '🔥 Hot lead — willing to pay',
            `${lead?.full_name ?? 'New lead'} · ${j.field ?? 'eligible'} · welcome sent, jump in early`);
        }
        await activity(j.lead_id, 'whatsapp_auto_welcome_sent', { dry_run: dryRun, priority: j.priority });
        await done(job.id); sent++; remaining--;
        results.push({ kind: job.kind, ok: true, priority: j.priority, dryRun });
      }

      // ════ REMINDER (re-send the welcome at +24h / +48h of silence) ═══════
      else if (job.kind === 'reminder') {
        const n = job.payload.n ?? 1;
        if (['booked', 'stopped', 'not_eligible'].includes(j.stage) || await leadHasReplied(j)) {
          await done(job.id); results.push({ kind: job.kind, note: 'lead_active' }); continue;
        }
        if (remaining <= 0) { await defer(job, 'daily_cap', 30); deferred++; continue; }

        const res = await sendWelcomeTemplate(j, `auto:reminder_${n}`);
        if (res.suppressed) {
          await admin.from('whatsapp_journeys').update({ stage: 'stopped', stop_reason: 'suppressed' }).eq('id', j.id);
          await done(job.id); continue;
        }
        if (!res.ok) { await fail(job.id, res.permanent ?? res.err!, !res.permanent && res.retry); failed++; continue; }

        await admin.from('whatsapp_journeys').update({ reminders_sent: n }).eq('id', j.id);
        if (n === 1) {
          const gap = Math.max(1, cfg.reminder_hours_2 - cfg.reminder_hours_1);
          await admin.from('whatsapp_auto_jobs').insert({
            workspace_id: wsId, journey_id: j.id, kind: 'reminder', payload: { n: 2 },
            due_at: new Date(Date.now() + gap * 3600_000).toISOString(),
          });
        } else {
          // Both reminders out. One more day of silence → cold sequence (or stop).
          await admin.from('whatsapp_auto_jobs').insert({
            workspace_id: wsId, journey_id: j.id, kind: 'cold_enrol',
            due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
          });
        }
        await activity(j.lead_id, 'whatsapp_auto_reminder_sent', { n, dry_run: dryRun });
        await done(job.id); sent++; remaining--;
        results.push({ kind: job.kind, n, ok: true });
      }

      // ════ COLD ENROL (silent after both reminders) ═══════════════════════
      else if (job.kind === 'cold_enrol') {
        if (['booked', 'stopped', 'not_eligible'].includes(j.stage) || await leadHasReplied(j)) {
          await done(job.id); results.push({ kind: job.kind, note: 'lead_active' }); continue;
        }
        const eligible = ['tech', 'research', 'engineering', 'art'].includes(j.field ?? '');
        if (eligible && cfg.cold_sequence_id) {
          await admin.from('whatsapp_sequence_enrollments').upsert({
            workspace_id: wsId, sequence_id: cfg.cold_sequence_id,
            lead_id: j.lead_id, phone_e164: j.phone_e164,
            status: 'active', current_step: 0,
            next_send_at: new Date().toISOString(),   // claim_due clamps to the send window
          }, { onConflict: 'sequence_id,phone_e164', ignoreDuplicates: true });
          await admin.from('whatsapp_journeys').update({ stage: 'stopped', stop_reason: 'cold_sequence' }).eq('id', j.id);
          await activity(j.lead_id, 'whatsapp_auto_cold_enrolled', { sequence_id: cfg.cold_sequence_id });
          results.push({ kind: job.kind, enrolled: true });
        } else {
          await admin.from('whatsapp_journeys').update({ stage: 'stopped', stop_reason: 'no_reply' }).eq('id', j.id);
          results.push({ kind: job.kind, enrolled: false, why: eligible ? 'no_cold_sequence_chosen' : 'field_not_eligible' });
        }
        await done(job.id);
      }

      // ════ ASSETS — guide + video, then the booking link ══════════════════
      else if (job.kind === 'assets') {
        if (['booked', 'stopped'].includes(j.stage)) { await done(job.id); continue; }
        const missing = [
          !cfg.pdf_url && 'PDF link', !cfg.video_url && 'video link', !cfg.booking_url && 'booking link',
        ].filter(Boolean);
        if (missing.length) { await fail(job.id, `fill in the ${missing.join(', ')} on the Automation tab first`); failed++; continue; }
        if (remaining < 2) { await defer(job, 'daily_cap', 30); deferred++; continue; }

        const { data: conv } = await admin.from('whatsapp_conversations')
          .select('last_inbound_at').eq('id', j.conversation_id ?? '').maybeSingle();
        const open = conv?.last_inbound_at
          ? Date.now() - new Date(conv.last_inbound_at).getTime() < WINDOW_MS : false;
        if (!open) {
          await fail(job.id, 'their 24h window closed before the assets went out — send a template from the inbox');
          if (j.conversation_id) await admin.from('whatsapp_conversations').update({ needs_attention: true }).eq('id', j.conversation_id);
          failed++; continue;
        }

        const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
        const tokens = {
          name: firstName(lead?.full_name ?? ''),
          pdf: cfg.pdf_url!, video: cfg.video_url!, booking: cfg.booking_url!,
        };
        const m1 = await sendFree(j, fillTokens(cfg.eligible_message, tokens), 'auto:assets');
        if (!m1.ok) { await fail(job.id, m1.err!, m1.retry); failed++; continue; }
        sent++; remaining--;
        const m2 = await sendFree(j, fillTokens(cfg.booking_message, tokens), 'auto:booking');
        if (!m2.ok) { await fail(job.id, `guide sent, booking message failed: ${m2.err}`, m2.retry); failed++; continue; }
        sent++; remaining--;

        await admin.from('whatsapp_journeys').update({ stage: 'waiting_booking' }).eq('id', j.id);
        await activity(j.lead_id, 'whatsapp_auto_assets_sent', { dry_run: dryRun });
        await done(job.id);
        results.push({ kind: job.kind, ok: true, dryRun });
      }

      // ════ NOTIFY — the team must look at this one ════════════════════════
      else if (job.kind === 'notify') {
        const { data: lead } = await admin.from('leads').select('full_name, industry').eq('id', j.lead_id).maybeSingle();
        await pushWorkspace(admin, wsId!, '👀 Lead needs a human',
          `${lead?.full_name ?? 'A lead'} (${lead?.industry ?? 'field unknown'}) replied — outside the 4 GTV fields, review before promising anything`);
        await done(job.id);
        results.push({ kind: job.kind, ok: true });
      }

      // ════ Q&A BRAIN ══════════════════════════════════════════════════════
      else if (job.kind === 'faq') {
        if (!cfg.auto_faq) { await done(job.id); continue; }
        const { data: msg } = await admin.from('whatsapp_messages')
          .select('body, conversation_id').eq('id', job.payload.message_id ?? '').maybeSingle();
        const text = (msg?.body ?? '').trim();
        const convId = msg?.conversation_id ?? job.payload.conversation_id ?? null;
        if (!text) { await done(job.id); continue; }

        const escalate = async (why: string, title: string) => {
          if (convId) await admin.from('whatsapp_conversations').update({ needs_attention: true }).eq('id', convId);
          const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
          await pushWorkspace(admin, wsId!, title, `${lead?.full_name ?? 'A lead'}: “${text.slice(0, 90)}”`);
          await activity(j.lead_id, 'whatsapp_qa_escalated', { why, conversation_id: convId, text: text.slice(0, 200) });
          await done(job.id);
          results.push({ kind: job.kind, escalated: why });
        };

        // Rule 1 — the four always-human topics. Code, not AI, decides this.
        if (sensitiveHit(text)) { await escalate('sensitive_topic', '💬 Reply needed — sensitive question'); continue; }

        const { data: faqRows } = await admin.from('whatsapp_faqs')
          .select('*').eq('workspace_id', wsId).eq('active', true).order('sort_order');
        const faqs = (faqRows ?? []) as Faq[];

        // Rule 2 — find the founder's matching Q&A (AI picks, never writes).
        const picked = await matchQa(text, faqs);
        if (picked.action === 'answer' && picked.faq) {
          // Once per Q&A per chat per 24h.
          const { data: recent } = await admin.from('activity')
            .select('id').eq('workspace_id', wsId).eq('action', 'whatsapp_faq_answered')
            .eq('meta->>faq_id', picked.faq.id).eq('meta->>conversation_id', convId ?? '')
            .gte('created_at', new Date(Date.now() - WINDOW_MS).toISOString()).limit(1);
          if (recent?.length) { await done(job.id); results.push({ kind: job.kind, note: 'already_answered' }); continue; }
          if (remaining <= 0) { await defer(job, 'daily_cap', 30); deferred++; continue; }

          const { data: lead } = await admin.from('leads').select('full_name').eq('id', j.lead_id).maybeSingle();
          const answer = fillTokens(picked.faq.answer, {
            name: firstName(lead?.full_name ?? ''),
            pdf: cfg.pdf_url ?? '', video: cfg.video_url ?? '', booking: cfg.booking_url ?? '',
          });
          const res = await sendFree(j, answer, 'auto:qa');
          if (!res.ok) { await fail(job.id, res.err!, res.retry); failed++; continue; }
          sent++; remaining--;
          await admin.from('whatsapp_faqs').update({ times_used: picked.faq.times_used + 1 }).eq('id', picked.faq.id);
          await activity(j.lead_id, 'whatsapp_faq_answered', {
            faq_id: picked.faq.id, faq: picked.faq.title, conversation_id: convId, dry_run: dryRun,
          });
          await done(job.id);
          results.push({ kind: job.kind, answered: picked.faq.title, dryRun });
        } else if (picked.action === 'human') {
          // Rule 4 — a real question with no saved answer.
          await escalate('no_match', '❓ Reply needed — new question');
        } else {
          // Rule 3 — chatter. Silence is a feature.
          await done(job.id);
          results.push({ kind: job.kind, note: 'ignored' });
        }
      }

      // legacy job kind from the 050 draft, drained harmlessly
      else { await done(job.id); results.push({ kind: job.kind, note: 'legacy_skipped' }); }
    } catch (e) {
      await fail(job.id, (e as Error).message, true); failed++;
      results.push({ kind: job.kind, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, claimed: jobs.length, sent, failed, deferred, dryRun, results });
}

// ═════ Q&A MATCHING — AI picks a saved answer; it NEVER composes one ════════
type QaVerdict = { action: 'answer' | 'human' | 'ignore'; faq?: Faq };

async function matchQa(text: string, faqs: Faq[]): Promise<QaVerdict> {
  const lower = text.toLowerCase();

  // Fast path: strong keyword overlap decides without an API call.
  let best: Faq | null = null, bestScore = 0;
  for (const f of faqs) {
    const score = (f.keywords ?? []).filter((k) => k && lower.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  if (best && bestScore >= 2) return { action: 'answer', faq: best };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || faqs.length === 0) {
    // No AI available: single-keyword hit still answers; a question mark with
    // no match goes to a human; anything else stays silent.
    if (best && bestScore >= 1) return { action: 'answer', faq: best };
    return /[?？]|kya|how|what|when|why|can i|kitna/i.test(text)
      ? { action: 'human' } : { action: 'ignore' };
  }

  try {
    const list = faqs.map((f, i) => `${i + 1}. ${f.title} — example: "${f.question || f.keywords.join(', ')}"`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content:
`You route WhatsApp messages for a UK-visa consultancy. You may ONLY pick from the saved answers below — never invent a reply.

SAVED ANSWERS:
${list}

LEAD'S MESSAGE (may be Hindi/Hinglish): "${text.slice(0, 500)}"

Rules:
- The message clearly asks something a saved answer covers → {"action":"answer","index":N}
- Casual chatter, greetings, thanks, confirmations, or they just sent a file → {"action":"ignore"}
- A real question none of the saved answers covers, or anything about discounts, complaints, payments, or guarantees → {"action":"human"}
When unsure between answer and human, choose human.

Reply with ONLY the JSON.`,
        }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return best && bestScore >= 1 ? { action: 'answer', faq: best } : { action: 'human' };
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const raw = (json.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { action: 'human' };
    const parsed = JSON.parse(m[0]) as { action?: string; index?: number };
    if (parsed.action === 'answer' && parsed.index && faqs[parsed.index - 1]) {
      return { action: 'answer', faq: faqs[parsed.index - 1] };
    }
    if (parsed.action === 'ignore') return { action: 'ignore' };
    return { action: 'human' };
  } catch {
    // AI down → keyword hit answers, an apparent question goes to a human.
    if (best && bestScore >= 1) return { action: 'answer', faq: best };
    return /[?？]/.test(text) ? { action: 'human' } : { action: 'ignore' };
  }
}
