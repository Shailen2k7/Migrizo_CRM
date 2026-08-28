// =============================================================================
// INTAKE ORCHESTRATOR — what happens the moment a lead's message arrives.
//
// Called by the webhook AFTER whatsapp_record_inbound has stored the message
// (and after the DB trigger has already cancelled any chase the reply should
// cancel). Jobs, in order:
//
//   1. T1 — if this lead has a chase waiting at step 1, answer their opening
//      message with the CV ask RIGHT NOW, free-form, while they are looking
//      at their phone. If Make's ingest hasn't created the chase row yet
//      (message beat the webhook race), create it for a fresh cold lead.
//      The ingest route ALSO calls fireT1IfWindowOpen() for the opposite
//      race — lead messaged first, form landed second — so whichever event
//      arrives last triggers the send, and T1 is seconds away either way.
//
//   2. CV as a FILE — PDF/DOCX through the text pipeline: extract, judge,
//      store the text, DELETE the file, then act on the verdict.
//
//   3. CV as a PHOTO — very common in India. The image(s) go to Claude's
//      vision model with an is-this-even-a-CV gate: a selfie or a payment
//      screenshot is left alone; a photographed CV gets the same judgement,
//      the same stored profile, and the same deletion as a PDF. Several
//      photos sent within minutes are read together as one document.
//
//   4. LinkedIn URL — recorded on the lead and flagged for a human. We
//      cannot read LinkedIn pages; pretending otherwise would manufacture
//      verdicts out of nothing.
//
// Verdict actions (T5 + document + T6, or T7) live in applyVerdictActions so
// the webhook, the image path and the old-chat backfill all behave identically.
//
// EVERYTHING here is best-effort: a failure logs, flags the conversation, and
// never breaks the webhook's 200 to Interakt.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getWaSettings, resolveSavedReply, fillPlaceholders, valuesFor, firstName,
  sendSessionText, sendProcessDocument, resolveProcessPdf,
  type WaSettings,
} from './outbound';
import {
  processCvMessage, processCvImages, recordLinkedInOnly,
  claimProfileJudgement, releaseProfileJudgement,
} from './profile';

const LINKEDIN_RE = /https?:\/\/(?:[\w.]*\.)?linkedin\.com\/in\/[\w\-%.]+/i;

// ── META'S PRE-FILLED FORM MESSAGE ──────────────────────────────────────────
// A person who taps through a Meta lead ad does not type their first message —
// WhatsApp pre-fills it for them, with the answers they just gave attached:
//
//     Hello! I filled out your form and would like to know more about your
//     business.
//
//     Full name: satpreet kaur
//     Field of expertise? ...: Other
//     Readiness to invest? ...: Maybe
//     Phone number: +918295033992
//     Email: priety8455@yahoo.in
//
// That is the strongest buying signal this system ever sees, and it means the
// same thing whether the sender is a brand-new number or a lead who has been
// sitting in the Cold campaign for six months. So it overrides every other
// consideration and restarts the chase.
//
// TWO independent tests, either sufficient. The greeting alone is not enough
// to rely on: DEPLOY-INTAKE-AUTOPILOT.md records it as "filled IN your form"
// while the messages arriving today say "filled OUT your form" — Meta has
// already reworded it once. The structural test is the insurance: two or more
// of the labelled answer lines is a shape no human types by hand.
const FORM_GREETING_RE = /filled\s+(?:out|in)\s+(?:your|the)\s+form/i;

const FORM_FIELD_RES: RegExp[] = [
  /^\s*full\s*name\s*:/im,
  /^\s*phone\s*number\s*:/im,
  /^\s*email\s*:/im,
  /field\s+of\s+expertise/i,
  /readiness\s+to\s+invest/i,
];

export function isMetaFormIntro(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 20) return false;
  if (FORM_GREETING_RE.test(t)) return true;
  return FORM_FIELD_RES.filter((re) => re.test(t)).length >= 2;
}

/**
 * The form block carries the contact details the person typed INTO the form,
 * which are not always the number they are messaging from — someone fills the
 * form on a laptop and then messages from their actual phone. Pulling them out
 * is what lets an orphan conversation find the lead it belongs to.
 */
export function contactsFromFormIntro(text: string): { phones: string[]; emails: string[] } {
  const t = text || '';
  const emails = Array.from(
    new Set((t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.toLowerCase()))
  );
  // Long digit runs only — a "Maybe" or a year must never be read as a phone.
  const phones = Array.from(
    new Set(
      (t.match(/\+?\d[\d\s()-]{8,}\d/g) || [])
        .map((p) => p.replace(/\D/g, ''))
        .filter((p) => p.length >= 10 && p.length <= 15)
    )
  );
  return { phones, emails };
}

export interface InboundContext {
  conversationId: string;
  phone: string;
  text: string;
  providerMsgId: string | null;
  media: { path: string | null; type: string | null; name: string | null; mime: string | null };
}

async function flagAttention(admin: SupabaseClient, conversationId: string): Promise<void> {
  await admin.from('whatsapp_conversations')
    .update({ needs_attention: true, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

// ── T1, given a WON claim ────────────────────────────────────────────────────
async function sendT1Claimed(
  admin: SupabaseClient,
  wsId: string,
  settings: WaSettings,
  claimedId: string,
  opts: { phone: string; leadId: string; first: string }
): Promise<string> {
  const dryRun = settings.dry_run !== false;
  const reply = await resolveSavedReply(admin, wsId, 't1');
  if (!reply) {
    await admin.rpc('wa_intake_advance', {
      p_intake_id: claimedId, p_ok: false, p_branch: 'session',
      p_error: 'Quick reply T1 not found — add it in WhatsApp → Quick replies', p_retry_hours: 1,
    });
    return 'quick_reply_missing';
  }
  // {{pdf}} in a body must never leak the raw "storage:" pointer or a
  // short-lived link — resolve to the long-lived form, only when needed.
  const pdfToken = reply.body.includes('{{pdf')
    ? (await resolveProcessPdf(admin, settings)).textUrl
    : null;
  const filled = fillPlaceholders(reply.body, valuesFor(1, {
    first: opts.first, video: settings.video_url, booking: settings.booking_url, pdf: pdfToken,
  }));
  if (filled.missing.length) {
    await admin.rpc('wa_intake_advance', {
      p_intake_id: claimedId, p_ok: false, p_branch: 'session',
      p_error: `T1 has unfilled placeholder(s): ${filled.missing.join(', ')}`, p_retry_hours: 1,
    });
    return 'missing_placeholders';
  }
  const res = await sendSessionText(admin, wsId, {
    phone: opts.phone, leadId: opts.leadId, body: filled.text, step: 'intake:T1', dryRun,
  });
  await admin.rpc('wa_intake_advance', {
    p_intake_id: claimedId, p_ok: res.ok, p_branch: 'session',
    p_error: res.ok ? null : `${res.code}: ${res.detail ?? ''}`.slice(0, 300),
  });
  return res.ok ? (dryRun ? 'sent_dry_run' : 'sent') : `failed:${res.code}`;
}

// The label a human sees in the inbox when someone we have already profiled
// comes back through the ad form. Kept short on purpose — it sits beside a
// lead's name in a narrow column.
const RETURNING_TAG = 'Returning';

// One T1 per number per day, however many form messages arrive.
//
// This is not caution for its own sake. The form-intro path deliberately
// bypasses the "have we sent T1 before" guard, which is the only thing that
// stood between a lead and a duplicate message. Interakt redelivers a webhook
// whenever our endpoint is slow or answers with anything but a 200, and people
// tap the ad's Send button twice on a bad connection. Both produce the same
// text twice, and without this window both would send T1 twice. Duplicate
// sends are what drags a number's WhatsApp quality rating down.
const T1_COOLDOWN_HOURS = 24;

/**
 * The conversation has no lead, and the message is Meta's form block — which
 * contains the name, phone and email the person actually typed. Someone fills
 * the form on a laptop and messages from their phone, so the number we are
 * chatting with is frequently NOT the number on the form, and the chat lands
 * orphaned. Match on what is written inside the message instead.
 *
 * Only ever LINKS an existing lead. It never creates one — an unknown number
 * sending a form block is not proof of a lead, and inventing rows here would
 * quietly fill the CRM with junk nobody asked for.
 */
async function linkLeadFromFormIntro(
  admin: SupabaseClient,
  wsId: string,
  conversationId: string,
  text: string
): Promise<string | null> {
  const { phones, emails } = contactsFromFormIntro(text);
  if (!phones.length && !emails.length) return null;

  // Email before phone: people mistype their own number far more often than
  // their own address. wa_find_lead_by_contact (078) does the comparison in
  // SQL through whatsapp_normalize_phone, the same way 040 has always matched.
  const attempts = [
    ...emails.map((e) => ({ p_phone: null as string | null, p_email: e as string | null })),
    ...phones.map((p) => ({ p_phone: p as string | null, p_email: null as string | null })),
  ];

  for (const a of attempts) {
    const { data: found } = await admin.rpc('wa_find_lead_by_contact', {
      p_workspace_id: wsId, p_phone: a.p_phone, p_email: a.p_email,
    });
    if (!found) continue;

    // `.is('lead_id', null)` is the guard that matters: if a human linked this
    // chat to someone while we were working, their decision stands.
    await admin
      .from('whatsapp_conversations')
      .update({ lead_id: found as string, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .is('lead_id', null);
    return found as string;
  }
  return null;
}

/**
 * Meta's pre-filled form message arrived. Cooldown, then returning-lead check,
 * then restart the chase and fire T1. Nothing about the lead's stage, age,
 * source or country is consulted anywhere in here — if a number messages us
 * through the form, we answer it.
 */
async function handleFormIntro(
  admin: SupabaseClient,
  wsId: string,
  settings: WaSettings,
  opts: {
    conversationId: string; phone: string; leadId: string;
    first: string; paused: boolean; hasProfile: boolean;
  }
): Promise<string> {
  // ── 1. Cooldown ───────────────────────────────────────────────────────────
  const since = new Date(Date.now() - T1_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data: recentT1, error: recentT1Error } = await admin
    .from('whatsapp_messages')
    .select('id')
    .eq('conversation_id', opts.conversationId)
    .eq('direction', 'out')
    .eq('sequence_step', 'intake:T1')
    .gte('created_at', since)
    .limit(1);

  // A failed lookup has not told us the cooldown is clear — it has told us
  // nothing. Sending on "nothing" is exactly the duplicate this guard exists
  // to prevent, so an error means we do not send.
  if (recentT1Error) return 'cooldown_check_failed';
  if (recentT1?.length) return 'cooldown';

  // ── 2. Someone we have already profiled ───────────────────────────────────
  // Their CV is on file. Asking for it again would be the single most obvious
  // way to look like a machine, so no automated message goes out at all: the
  // chat is tagged and pushed at a human instead.
  if (opts.hasProfile) {
    await admin
      .from('whatsapp_conversations')
      .update({
        tag: RETURNING_TAG,
        needs_attention: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.conversationId);
    return 'returning_tagged';
  }

  // ── 3. Restart the chase and answer now ───────────────────────────────────
  // wa_intake_restart (078) winds an in-flight chase back to step 1, revives a
  // finished one, or creates the first — and returns null for a suppressed
  // number, so an opt-out still wins over everything above.
  const { data: restartedId } = await admin.rpc('wa_intake_restart', {
    p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
  });
  if (!restartedId) return 'suppressed_or_bad_phone';

  // Still claimed atomically. The restart put a row at step 1; this decides
  // WHO sends it, so two webhooks arriving together still send exactly once.
  const { data: claimedId } = await admin.rpc('wa_intake_claim_one', {
    p_workspace_id: wsId, p_phone: opts.phone, p_track: 'chase', p_step: 1,
  });
  if (!claimedId) return 'already_handled';

  // Claimed but paused: the row stays leased at step 1 and the drain sends it
  // the moment sending resumes. Never dropped on the floor.
  if (opts.paused) return 'paused_queued';

  return sendT1Claimed(admin, wsId, settings, claimedId as string, {
    phone: opts.phone, leadId: opts.leadId, first: opts.first,
  });
}

/**
 * Called by the META INGEST route the moment a lead lands. If the person has
 * ALREADY messaged us (their form-to-WhatsApp hello beat Make's POST), the
 * 24h window is open and T1 must not wait for the cron — it goes now.
 * This closes the race that used to cost 10–15 minutes.
 */
export async function fireT1IfWindowOpen(
  admin: SupabaseClient,
  wsId: string,
  leadId: string,
  phone: string,
  leadName: string | null
): Promise<string> {
  const settings = await getWaSettings(admin);
  if (!settings || settings.sending_paused) return 'skipped';

  const { data: norm } = await admin.rpc('whatsapp_normalize_phone', { p_raw: phone, p_default_cc: '91' });
  if (!norm) return 'bad_phone';

  const { data: conv } = await admin
    .from('whatsapp_conversations')
    .select('id, last_inbound_at, last_outbound_at')
    .eq('workspace_id', wsId).eq('phone_e164', norm as string)
    .maybeSingle();
  const windowOpen = !!conv?.last_inbound_at &&
    Date.now() - new Date(conv.last_inbound_at).getTime() < 23 * 3600 * 1000;
  if (!windowOpen) return 'no_window_yet'; // the queued Branch-B row handles them

  const { data: claimedId } = await admin.rpc('wa_intake_claim_one', {
    p_workspace_id: wsId, p_phone: norm as string, p_track: 'chase', p_step: 1,
  });
  if (!claimedId) return 'already_handled';

  return sendT1Claimed(admin, wsId, settings, claimedId as string, {
    phone: norm as string, leadId, first: firstName(leadName),
  });
}

// ── VERDICT ACTIONS — one implementation for file, photo and backfill ───────
export async function applyVerdictActions(
  admin: SupabaseClient,
  wsId: string,
  settings: WaSettings,
  opts: {
    leadId: string; phone: string; first: string; conversationId: string;
    eligible: boolean; route?: string | null;
  }
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const dryRun = settings.dry_run !== false;
  const paused = settings.sending_paused === true;

  // The profile arrived — the ask-for-CV chase is over, whatever step it was on.
  await admin.from('wa_intake')
    .update({ status: 'replied', replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('workspace_id', wsId).eq('phone_e164', opts.phone)
    .eq('track', 'chase').eq('status', 'waiting');

  if (paused) {
    // Sending is paused (quality brake). The verdict is stamped — QUEUE the
    // outcome so it fires when sending resumes, and flag a human.
    await admin.rpc('wa_intake_enqueue', {
      p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
      p_track: 'verdict', p_first_step: opts.eligible ? 5 : 7, p_delay_minutes: 0,
    });
    await flagAttention(admin, opts.conversationId);
    out.verdict_queue = 'queued_paused';
    return out;
  }

  if (opts.eligible) {
    // T5 now…
    const pdf = await resolveProcessPdf(admin, settings);
    const t5 = await resolveSavedReply(admin, wsId, 't5');
    let t5Sent = false;
    if (t5) {
      const filled = fillPlaceholders(t5.body, valuesFor(5, {
        first: opts.first, route: opts.route, video: settings.video_url,
        booking: settings.booking_url, pdf: pdf.textUrl,
      }));
      if (!filled.missing.length) {
        const res = await sendSessionText(admin, wsId, {
          phone: opts.phone, leadId: opts.leadId, body: filled.text,
          step: 'intake:T5', dryRun,
        });
        t5Sent = res.ok;
        out.t5 = res.ok ? 'sent' : `failed:${res.code}`;
        // …the process document rides along…
        if (res.ok) {
          if (pdf.ok && pdf.url) {
            const doc = await sendProcessDocument(admin, wsId, {
              phone: opts.phone, leadId: opts.leadId,
              pdfUrl: pdf.url, step: 'intake:T5-doc', dryRun,
            });
            out.t5doc = doc.ok ? 'sent' : `failed:${doc.code}`;
          } else if (pdf.error) {
            out.t5doc = `skipped:${pdf.error}`;
          }
        }
      } else {
        out.t5 = `missing_placeholders:${filled.missing.join(',')}`;
      }
    } else {
      out.t5 = 'quick_reply_missing';
    }
    // T6 rides ONE minute behind a DELIVERED T5 (the founder's spec). If T5
    // failed, queue the pair from step 5 instead — the drain retries T5
    // first, then T6.
    await admin.rpc('wa_intake_enqueue', {
      p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
      p_track: 'verdict', p_first_step: t5Sent ? 6 : 5,
      p_delay_minutes: t5Sent ? 1 : 15,
    });
    if (!t5Sent) await flagAttention(admin, opts.conversationId);
  } else {
    // Honest no, plus the IFV door left open — T7, right now.
    const t7 = await resolveSavedReply(admin, wsId, 't7');
    let t7Sent = false;
    if (t7) {
      const filled = fillPlaceholders(t7.body, valuesFor(7, { first: opts.first }));
      if (!filled.missing.length) {
        const res = await sendSessionText(admin, wsId, {
          phone: opts.phone, leadId: opts.leadId, body: filled.text,
          step: 'intake:T7', dryRun,
        });
        t7Sent = res.ok;
        out.t7 = res.ok ? 'sent' : `failed:${res.code}`;
      } else {
        out.t7 = `missing_placeholders:${filled.missing.join(',')}`;
      }
    } else {
      out.t7 = 'quick_reply_missing';
    }
    if (!t7Sent) {
      await admin.rpc('wa_intake_enqueue', {
        p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
        p_track: 'verdict', p_first_step: 7, p_delay_minutes: 15,
      });
      await flagAttention(admin, opts.conversationId);
    }
  }
  return out;
}

// ── THE JUDGE — called by the DRAIN for verdict rows at step 4 ──────────────
// The heavy part of the pipeline (download, extract, AI verdict) lives here,
// in a cron invocation that can be killed and retried, never in the webhook.
export type JudgeOutcome =
  | { kind: 'eligible'; route: string | null }
  | { kind: 'not_eligible'; route: string | null }
  | { kind: 'defer'; reason: string }   // try again next tick, no strike
  | { kind: 'skip'; reason: string }    // terminal: nothing to judge, row done
  | { kind: 'error'; reason: string };  // transient: retry with a strike

export async function judgeQueuedCv(
  admin: SupabaseClient,
  wsId: string,
  row: { leadId: string; phoneE164: string; conversationId: string | null }
): Promise<JudgeOutcome> {
  const { data: lead } = await admin
    .from('leads')
    .select('id, full_name')
    .eq('id', row.leadId)
    .maybeSingle();
  if (!lead) return { kind: 'skip', reason: 'lead_gone' };
  if (!row.conversationId) return { kind: 'skip', reason: 'no_conversation' };

  // The newest inbound document in the last 24h is the CV to judge. Falling
  // back to photos below keeps both arrival shapes on one path.
  const daySince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: docs } = await admin
    .from('whatsapp_messages')
    .select('id, media_path, media_name, media_mime, provider_msg_id, created_at')
    .eq('conversation_id', row.conversationId)
    .eq('direction', 'in')
    .eq('media_type', 'document')
    .not('hidden', 'is', true)
    .gte('created_at', daySince)
    .order('created_at', { ascending: false })
    .limit(1);
  const doc = docs?.[0];

  if (doc) {
    // A document row with no stored file means capture is still fighting —
    // its retry or the backfill may land the bytes; judging now would fail
    // for a reason that fixes itself.
    if (!doc.media_path) return { kind: 'error', reason: 'file_not_stored_yet' };
    const verdict = await processCvMessage(admin, wsId, {
      leadId: lead.id, leadName: lead.full_name || 'the candidate',
      conversationId: row.conversationId, mediaPath: doc.media_path as string,
      mediaName: doc.media_name, mediaMime: doc.media_mime,
      providerMsgId: doc.provider_msg_id,
    });
    return mapVerdict(verdict);
  }

  // Photos. Same gathering the webhook used to do inline, minus the 20-second
  // sleep — the queue delay plus the cron tick IS the settle time now. If the
  // newest photo is under 45 seconds old, more pages may still be arriving:
  // wait one more tick rather than judge half a CV.
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data: imgs } = await admin
    .from('whatsapp_messages')
    .select('id, media_path, media_mime, created_at')
    .eq('conversation_id', row.conversationId)
    .eq('direction', 'in')
    .eq('media_type', 'image')
    .not('media_path', 'is', null)
    .not('hidden', 'is', true)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(4);
  const paths = (imgs ?? []).map((m) => ({ path: m.media_path as string, mime: m.media_mime as string | null }));
  if (!paths.length) return { kind: 'skip', reason: 'no_media_found' };

  const newest = imgs![imgs!.length - 1].created_at as string;
  if (Date.now() - new Date(newest).getTime() < 45_000) {
    return { kind: 'defer', reason: 'photos_still_arriving' };
  }

  if (!(await claimProfileJudgement(admin, lead.id))) {
    // Another run holds it. A crashed holder frees itself after 15 minutes
    // (the stale-claim rule), so waiting is safe and double-T5 is not.
    return { kind: 'defer', reason: 'judgement_held_elsewhere' };
  }
  try {
    const verdict = await processCvImages(admin, wsId, {
      leadId: lead.id, leadName: lead.full_name || 'the candidate',
      conversationId: row.conversationId, images: paths, claimHeld: true,
    });
    return mapVerdict(verdict);
  } catch (e) {
    try { await releaseProfileJudgement(admin, lead.id); } catch { /* best effort */ }
    return { kind: 'error', reason: e instanceof Error ? e.message : 'image_judge_threw' };
  }
}

function mapVerdict(v: { ok: boolean; eligible?: boolean; route?: string; skipped?: string }): JudgeOutcome {
  if (v.ok) {
    return v.eligible === true
      ? { kind: 'eligible', route: v.route ?? null }
      : { kind: 'not_eligible', route: v.route ?? null };
  }
  const s = v.skipped || 'unknown';
  // Transient troubles retry; everything else has already flagged a human
  // inside the profile pipeline and the row can rest.
  if (s === 'ai_unavailable' || s.startsWith('download_failed') || s === 'judgement_in_progress') {
    return s === 'judgement_in_progress'
      ? { kind: 'defer', reason: s }
      : { kind: 'error', reason: s };
  }
  return { kind: 'skip', reason: s };
}

// ── THE WEBHOOK ENTRY POINT ─────────────────────────────────────────────────
export async function handleInboundForIntake(
  admin: SupabaseClient,
  wsId: string,
  ctx: InboundContext
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const { data: conv } = await admin
    .from('whatsapp_conversations')
    .select('id, lead_id, phone_e164, last_outbound_at')
    .eq('id', ctx.conversationId)
    .maybeSingle();
  if (!conv) return { skipped: 'conversation_gone' };

  // Is this Meta's pre-filled form message? Everything below branches on it.
  const formIntro = !ctx.media.path && isMetaFormIntro(ctx.text);
  if (formIntro) out.form_intro = true;

  // An orphan conversation — someone messaging from a number that is not the
  // one they typed into the form — used to stop dead right here. When the
  // message carries their details, use them to find the lead they belong to.
  let leadId = conv.lead_id as string | null;
  if (!leadId && formIntro) {
    leadId = await linkLeadFromFormIntro(admin, wsId, conv.id, ctx.text);
    out.orphan_link = leadId ? 'matched' : 'no_match';
  }
  if (!leadId) return { ...out, skipped: 'no_lead_on_conversation' };

  const { data: lead } = await admin
    .from('leads')
    .select('id, full_name, stage, created_at, profile_received, eligibility_source, profile_text, profile_ai')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return { ...out, skipped: 'lead_gone' };

  const settings = await getWaSettings(admin);
  if (!settings) return { skipped: 'no_settings' };
  const first = firstName(lead.full_name);
  const paused = settings.sending_paused === true;

  const isDocument =
    ctx.media.path && ctx.media.type === 'document' &&
    (/(pdf|word|officedocument)/i.test(ctx.media.mime || '') ||
     /\.(pdf|docx?)$/i.test(ctx.media.name || ''));
  const isImage = !!ctx.media.path && ctx.media.type === 'image';
  const hasLinkedIn = !isDocument && LINKEDIN_RE.test(ctx.text);

  // ── 1. T1, inline ─────────────────────────────────────────────────────────
  // Skipped when the message IS the profile (file, photo or LinkedIn) —
  // answering a CV with "please send your CV" is the fastest way to look
  // like a robot. The verdict flow below answers those messages.
  if (!isDocument && !isImage && !hasLinkedIn) {
    try {
      // ── 1a. The form message overrides everything ───────────────────────
      // Someone who just tapped through the ad is not a "returning contact"
      // to be filtered out — they are the most live lead in the system. Their
      // stage, age and source stop being consulted at all, and an in-flight
      // chase is wound back to step 1 so they get T1 now and T2/T3/T4 after.
      if (formIntro) {
        out.t1 = await handleFormIntro(admin, wsId, settings, {
          conversationId: conv.id, phone: conv.phone_e164,
          leadId: lead.id, first, paused,
          hasProfile: !!(lead.profile_text || lead.profile_ai),
        });
        return out;
      }

      // Atomic claim (076): whoever wins this update sends T1; a second
      // webhook invocation seconds later, or a drain that leased the row,
      // loses and sends nothing.
      let { data: claimedId } = await admin.rpc('wa_intake_claim_one', {
        p_workspace_id: wsId, p_phone: conv.phone_e164, p_track: 'chase', p_step: 1,
      });

      // The message can beat Make's ingest POST — and plenty of legitimate
      // leads are older than any freshness window, already sitting in the Cold
      // campaign, or came in from a source nobody tagged. None of that is a
      // reason to leave a real person on read.
      //
      // So the guard is now the only question that actually matters: have we
      // ever sent THIS conversation its T1? If not, it gets one. Stage, age,
      // source and country are all irrelevant — if a number messages us, we
      // reply. wa_intake_enqueue still refuses suppressed numbers, and the
      // atomic claim below still means concurrent webhooks send exactly once.
      if (!claimedId) {
        const { data: priorT1, error: priorT1Error } = await admin
          .from('whatsapp_messages')
          .select('id')
          .eq('conversation_id', conv.id)
          .eq('direction', 'out')
          .eq('sequence_step', 'intake:T1')
          .limit(1);

        // A query that FAILED has not told us T1 was never sent — it told us
        // nothing. Treating that as "never sent" would re-fire T1 at someone
        // who already has it, so an error means we leave this to the drain.
        if (!priorT1Error && !priorT1?.length) {
          await admin.rpc('wa_intake_enqueue', {
            p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
            p_track: 'chase', p_first_step: 1, p_delay_minutes: 0,
          });
          ({ data: claimedId } = await admin.rpc('wa_intake_claim_one', {
            p_workspace_id: wsId, p_phone: conv.phone_e164, p_track: 'chase', p_step: 1,
          }));
        }
      }

      // Claimed but paused: leave the row leased — the drain sends T1 when
      // sending resumes. Never drop it on the floor.
      if (claimedId && !paused) {
        out.t1 = await sendT1Claimed(admin, wsId, settings, claimedId as string, {
          phone: conv.phone_e164, leadId: lead.id, first,
        });
      }
    } catch (e) {
      console.error('[intake] T1 step threw', e);
      out.t1 = 'error';
    }
  }

  // ── 2 + 3. A CV arrived (file or photos) — QUEUE the judgement ───────────
  // The verdict used to run right here, inside the webhook request. Netlify
  // kills a function at ~26 seconds, and an AI read of a full CV does not
  // reliably fit — one real lead's verdict died mid-flight leaving a stored
  // CV, a taken claim, and total silence. The webhook's job is now only to
  // acknowledge fast; the DRAIN judges (verdict track, step 4) on its next
  // tick, where a killed run simply retries instead of vanishing.
  //
  // Photos get a one-minute delay on purpose: a two-page CV arrives as two
  // webhook calls seconds apart, and judging page 1 alone produces a verdict
  // from half a document. By the time the drain picks the row up, the set has
  // settled — the 20-second in-request sleep this replaces was itself most of
  // Netlify's budget.
  if (isDocument || isImage) {
    try {
      // The profile arrived, so the ask-for-a-CV chase is over — including a
      // step-1 chase that never sent (the reply trigger only cancels rows
      // with sent_count >= 1, and T1 arriving AFTER their CV reads absurd).
      await admin.from('wa_intake')
        .update({ status: 'replied', replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('workspace_id', wsId).eq('phone_e164', conv.phone_e164)
        .eq('track', 'chase').eq('status', 'waiting');

      await admin.rpc('wa_intake_enqueue', {
        p_workspace_id: wsId, p_lead_id: lead.id, p_phone: conv.phone_e164,
        p_track: 'verdict', p_first_step: 4, p_delay_minutes: isImage ? 1 : 0,
      });
      out.cv = 'queued_for_judgement';
    } catch (e) {
      console.error('[intake] CV queue step threw', e);
      await flagAttention(admin, conv.id);
      out.cv = 'error';
    }
  }

  // ── 4. LinkedIn URL, no file ──────────────────────────────────────────────
  if (hasLinkedIn) {
    try {
      const url = ctx.text.match(LINKEDIN_RE)?.[0] ?? '';
      await recordLinkedInOnly(admin, wsId, { leadId: lead.id, conversationId: conv.id, url });
      out.linkedin = 'recorded_for_human';
    } catch (e) {
      console.error('[intake] linkedin step threw', e);
      out.linkedin = 'error';
    }
  }

  return out;
}
