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
import { parseFormHello, type FormHello } from './formhello';

const LINKEDIN_RE = /https?:\/\/(?:[\w.]*\.)?linkedin\.com\/in\/[\w\-%.]+/i;

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
    // T6 rides 30 SECONDS behind a DELIVERED T5 (078: the drain runs every
    // minute, so the booking link lands 30–90s after the verdict). If T5
    // failed, queue the pair from step 5 instead — the drain retries T5
    // first, then T6.
    if (t5Sent) {
      await admin.rpc('wa_intake_enqueue_at', {
        p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
        p_track: 'verdict', p_first_step: 6,
        p_send_at: new Date(Date.now() + 30_000).toISOString(),
      });
    } else {
      await admin.rpc('wa_intake_enqueue', {
        p_workspace_id: wsId, p_lead_id: opts.leadId, p_phone: opts.phone,
        p_track: 'verdict', p_first_step: 5, p_delay_minutes: 15,
      });
      await flagAttention(admin, opts.conversationId);
    }
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

// ── LEAD FROM THE FORM BODY ─────────────────────────────────────────────────
// The form-hello message IS the lead record — name, email, the phone they
// typed. The WhatsApp sender id can be a different number entirely (VoIP,
// second SIM, wrong country code from Meta). So when a form-hello arrives on
// a conversation with no lead — or the wrong one — we find the lead by the
// form's own email/phone, or create it on the spot, and link the chat.
// Nobody who can message us is ever left floating.
async function ensureLeadFromForm(
  admin: SupabaseClient,
  wsId: string,
  conv: { id: string; lead_id: string | null; phone_e164: string },
  form: FormHello
): Promise<string | null> {
  // Already linked: enrich blanks from the form and keep the link.
  if (conv.lead_id) {
    const { data: cur } = await admin.from('leads')
      .select('id, full_name, email').eq('id', conv.lead_id).maybeSingle();
    if (cur) {
      const patch: Record<string, unknown> = {};
      if (!cur.email && form.email) patch.email = form.email;
      if ((!cur.full_name || /^\+?\d[\d\s]*$/.test(cur.full_name)) && form.fullName) {
        patch.full_name = form.fullName; // replace a phone-number-as-name
      }
      if (Object.keys(patch).length) await admin.from('leads').update(patch).eq('id', cur.id);
      return cur.id;
    }
  }

  // Find by the form's email… (escape LIKE wildcards — "john_doe@…" must not
  // match "johnxdoe@…" and silently link the wrong person's record)
  if (form.email) {
    const safeEmail = form.email.replace(/([%_\\])/g, '\\$1');
    const { data: byEmail } = await admin.from('leads')
      .select('id').eq('workspace_id', wsId).ilike('email', safeEmail).limit(1);
    if (byEmail?.length) {
      await admin.from('whatsapp_conversations')
        .update({ lead_id: byEmail[0].id, updated_at: new Date().toISOString() })
        .eq('id', conv.id);
      return byEmail[0].id;
    }
  }
  // …or by the phone typed INTO the form (last 10 digits)…
  if (form.phone) {
    const digits = form.phone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const { data: byPhone } = await admin.from('leads')
        .select('id, phone').eq('workspace_id', wsId).not('phone', 'is', null)
        .order('created_at', { ascending: false }).limit(5000);
      const hit = (byPhone ?? []).find((l) =>
        (l.phone || '').replace(/\D/g, '').slice(-10) === digits);
      if (hit) {
        await admin.from('whatsapp_conversations')
          .update({ lead_id: hit.id, updated_at: new Date().toISOString() })
          .eq('id', conv.id);
        return hit.id;
      }
    }
  }

  // …or create the lead right here. A form-hello with no CRM record means
  // Make's POST is missing or broken — the lead must not pay for that.
  const { data: created, error } = await admin.from('leads').insert({
    workspace_id: wsId,
    full_name: form.fullName || conv.phone_e164,
    phone: form.phone || conv.phone_e164,
    email: form.email,
    source: 'Meta Ads',
    stage: 'cold',
    tags: ['meta-lead', 'whatsapp-first'],
    intake: {
      ...(form.expertise ? { expertise: form.expertise } : {}),
      ...(form.readiness ? { investment_readiness: form.readiness } : {}),
    },
  }).select('id').single();
  if (error || !created) {
    console.error('[intake] lead auto-create failed', error?.message);
    return null;
  }
  await admin.from('whatsapp_conversations')
    .update({ lead_id: created.id, updated_at: new Date().toISOString() })
    .eq('id', conv.id);
  await admin.from('activity').insert({
    workspace_id: wsId, user_id: null, lead_id: created.id,
    action: 'lead_created',
    meta: { auto: true, source: 'whatsapp_form_hello', phone_on_form: form.phone, wa_number: conv.phone_e164 },
  });
  return created.id;
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
  if (!conv) return { skipped: 'no_conversation' };

  // The form-hello is authoritative: it links or CREATES the lead, whatever
  // number it arrived from.
  const form = parseFormHello(ctx.text);
  let leadId = conv.lead_id;
  if (form.isFormHello) {
    leadId = await ensureLeadFromForm(admin, wsId, conv, form);
    if (leadId) out.lead = conv.lead_id ? 'linked' : 'created_or_linked';
  } else if (!leadId && (ctx.text.trim().length > 0 || ctx.media.path)) {
    // A number nobody knows says "Hi" (or sends a CV straight away). The
    // founder rule stands: if a number can message us, we reply — so it gets
    // a minimal lead (named after its number until we learn better) and the
    // full ladder, instead of silence.
    const { data: created } = await admin.from('leads').insert({
      workspace_id: wsId,
      full_name: conv.phone_e164,
      phone: conv.phone_e164,
      source: 'WhatsApp',
      stage: 'cold',
      tags: ['whatsapp-inbound'],
    }).select('id').single();
    if (created) {
      await admin.from('whatsapp_conversations')
        .update({ lead_id: created.id, updated_at: new Date().toISOString() })
        .eq('id', conv.id);
      leadId = created.id;
      out.lead = 'created_minimal';
    }
  }
  if (!leadId) return { skipped: 'no_lead_on_conversation' };

  const { data: lead } = await admin
    .from('leads')
    .select('id, full_name, stage, created_at, profile_received, eligibility_source')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return { skipped: 'lead_gone' };

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
      // Atomic claim (076): whoever wins this update sends T1; a second
      // webhook invocation seconds later, or a drain that leased the row,
      // loses and sends nothing.
      let { data: claimedId } = await admin.rpc('wa_intake_claim_one', {
        p_workspace_id: wsId, p_phone: conv.phone_e164, p_track: 'chase', p_step: 1,
      });

      // FOUNDER RULES (v2): if a number can message us, we reply.
      //   * A FORM-HELLO always earns a T1 — even a returning customer who
      //     re-enquired through the form is starting a new enquiry. Deduped
      //     to one T1 per conversation per 24 hours, so webhook retries and
      //     double-submits cannot double-message.
      //   * Any OTHER first-ever message earns a T1 too (never sent one =
      //     never welcomed). Country, stage, lead age — irrelevant.
      // The only hard stops are the database's own: suppressions (opt-outs)
      // and the atomic claim (no concurrent double-T1).
      if (!claimedId) {
        const t1Query = admin
          .from('whatsapp_messages')
          .select('id, created_at')
          .eq('workspace_id', wsId)
          .eq('conversation_id', conv.id)
          .eq('direction', 'out')
          .eq('sequence_step', 'intake:T1')
          .order('created_at', { ascending: false })
          .limit(1);
        const { data: pastT1 } = await t1Query;
        const lastT1At = pastT1?.[0]?.created_at ? new Date(pastT1[0].created_at).getTime() : null;
        const t1Blocked = form.isFormHello
          ? (lastT1At !== null && Date.now() - lastT1At < 24 * 3600 * 1000)
          : lastT1At !== null;

        if (!t1Blocked) {
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

      // ── QUESTION → HUMAN ────────────────────────────────────────────────
      // They wrote actual words, it wasn't the form, and no T1 just went out
      // (meaning we've already welcomed them before): that is a human
      // conversation now. No auto-reply — light the amber flag and step back.
      // The chase (T2–T4) was already cancelled by the reply trigger.
      if (!form.isFormHello && !out.t1 && ctx.text.trim().length > 0) {
        await flagAttention(admin, conv.id);
        out.human = 'flagged_for_takeover';
      }
    } catch (e) {
      console.error('[intake] T1 step threw', e);
      out.t1 = 'error';
    }
  }

  // ── 2. CV as a file ───────────────────────────────────────────────────────
  if (isDocument) {
    try {
      const verdict = await processCvMessage(admin, wsId, {
        leadId: lead.id, leadName: lead.full_name || 'the candidate',
        conversationId: conv.id, mediaPath: ctx.media.path as string,
        mediaName: ctx.media.name, mediaMime: ctx.media.mime,
        providerMsgId: ctx.providerMsgId,
      });
      out.cv = verdict.ok ? (verdict.eligible ? 'eligible' : 'not_eligible') : verdict.skipped;
      if (verdict.ok) {
        Object.assign(out, await applyVerdictActions(admin, wsId, settings, {
          leadId: lead.id, phone: conv.phone_e164, first, conversationId: conv.id,
          eligible: verdict.eligible === true, route: verdict.route,
        }));
      }
    } catch (e) {
      console.error('[intake] CV pipeline threw', e);
      out.cv = 'error';
    }
  }

  // ── 3. CV as a photo ──────────────────────────────────────────────────────
  if (isImage) {
    try {
      // Two photos of a two-page CV arrive as two webhook invocations seconds
      // apart. ONE claims the judgement (atomic UPDATE on the lead); the
      // loser walks away. The winner then WAITS 20 seconds so the remaining
      // pages land, gathers everything from the last 20 minutes, and reads
      // them as ONE document. Without the claim: two verdicts, two T5s.
      // Without the wait: a verdict from half a CV.
      const claimed = await claimProfileJudgement(admin, lead.id);
      if (!claimed) {
        out.image_cv = 'another_invocation_holds_it';
      } else {
        await new Promise((r) => setTimeout(r, 20_000));

        const since = new Date(Date.now() - 20 * 60_000).toISOString();
        const { data: imgs } = await admin
          .from('whatsapp_messages')
          .select('id, media_path, media_mime')
          .eq('conversation_id', conv.id)
          .eq('direction', 'in')
          .eq('media_type', 'image')
          .not('media_path', 'is', null)
          .not('hidden', 'is', true)
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .limit(4);

        const paths = (imgs ?? []).map((m) => ({ path: m.media_path as string, mime: m.media_mime as string | null }));
        if (!paths.length) {
          await releaseProfileJudgement(admin, lead.id);
          out.image_cv = 'no_images_found';
        } else {
          const verdict = await processCvImages(admin, wsId, {
            leadId: lead.id, leadName: lead.full_name || 'the candidate',
            conversationId: conv.id, images: paths, claimHeld: true,
          });
          out.image_cv = verdict.ok
            ? (verdict.eligible ? 'eligible' : 'not_eligible')
            : verdict.skipped;
          if (verdict.ok) {
            Object.assign(out, await applyVerdictActions(admin, wsId, settings, {
              leadId: lead.id, phone: conv.phone_e164, first, conversationId: conv.id,
              eligible: verdict.eligible === true, route: verdict.route,
            }));
          }
        }
      }
    } catch (e) {
      console.error('[intake] image CV pipeline threw', e);
      try { await releaseProfileJudgement(admin, lead.id); } catch { /* best effort */ }
      out.image_cv = 'error';
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
